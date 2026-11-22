-- SMART POS JATIBARANG
-- Enforce least-privilege writes through authenticated atomic RPCs.
-- Branch-bound members can only read/operate in their assigned branch.
-- No existing business rows are changed or deleted by this migration.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA private TO authenticated;

-- Internal authorization helpers. The private schema is not exposed through the
-- Supabase Data API; public invoker wrappers below are used by RLS and the app.
CREATE OR REPLACE FUNCTION private.smartpos_is_business_member(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_members bm
    WHERE bm.business_id = p_business_id
      AND bm.user_id = auth.uid()
      AND bm.is_active = true
  );
$function$;

CREATE OR REPLACE FUNCTION private.smartpos_is_business_owner(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_members bm
    WHERE bm.business_id = p_business_id
      AND bm.user_id = auth.uid()
      AND bm.role = 'owner'
      AND bm.is_active = true
  );
$function$;

CREATE OR REPLACE FUNCTION private.smartpos_has_business_role(p_business_id uuid, p_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_members bm
    WHERE bm.business_id = p_business_id
      AND bm.user_id = auth.uid()
      AND bm.is_active = true
      AND bm.role = ANY (COALESCE(p_roles, ARRAY[]::text[]))
  );
$function$;

CREATE OR REPLACE FUNCTION private.smartpos_can_access_branch(p_business_id uuid, p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_members bm
    WHERE bm.business_id = p_business_id
      AND bm.user_id = auth.uid()
      AND bm.is_active = true
      AND (
        bm.role IN ('owner', 'admin')
        OR (p_branch_id IS NOT NULL AND bm.branch_id = p_branch_id)
      )
  );
$function$;

-- Keep the existing public helper signatures, but make them invoker wrappers.
CREATE OR REPLACE FUNCTION public.is_business_member(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT private.smartpos_is_business_member(p_business_id);
$function$;

CREATE OR REPLACE FUNCTION public.is_business_owner(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT private.smartpos_is_business_owner(p_business_id);
$function$;

CREATE OR REPLACE FUNCTION public.can_access_branch(p_business_id uuid, p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT private.smartpos_can_access_branch(p_business_id, p_branch_id);
$function$;

-- Internal atomic sale. Prices are read from the database, inventory rows are
-- locked in stable order, and every related write commits or rolls back together.
CREATE OR REPLACE FUNCTION private.smartpos_checkout_sale_impl(
  p_business_id uuid,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_payment_method text
)
RETURNS TABLE(sale_id uuid, invoice_no text, total numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_sale_id uuid;
  v_invoice_no text;
  v_subtotal numeric := 0;
  v_item record;
  v_product record;
  v_inventory record;
  v_inventory_count integer;
  v_quantity numeric;
  v_line_total numeric;
  v_updated_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Silakan masuk terlebih dahulu.';
  END IF;

  IF NOT private.smartpos_has_business_role(
    p_business_id,
    ARRAY['owner', 'admin', 'manager', 'cashier']::text[]
  ) THEN
    RAISE EXCEPTION 'Akses kasir tidak diizinkan.';
  END IF;

  IF p_branch_id IS NULL
     OR NOT private.smartpos_can_access_branch(p_business_id, p_branch_id) THEN
    RAISE EXCEPTION 'Akses ke cabang ini tidak diizinkan.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.branches b
    WHERE b.id = p_branch_id
      AND b.business_id = p_business_id
      AND b.is_active = true
  ) THEN
    RAISE EXCEPTION 'Cabang tidak ditemukan atau tidak aktif.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.warehouses w
    WHERE w.id = p_warehouse_id
      AND w.business_id = p_business_id
      AND w.branch_id = p_branch_id
      AND w.is_active = true
  ) THEN
    RAISE EXCEPTION 'Gudang tidak ditemukan, tidak aktif, atau bukan milik cabang ini.';
  END IF;

  IF p_customer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.customers c
    WHERE c.id = p_customer_id
      AND c.business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'Pelanggan tidak valid.';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Format keranjang belanja tidak valid.';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Keranjang belanja kosong.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items) AS x(product_id uuid, quantity numeric)
    WHERE x.product_id IS NULL OR x.quantity IS NULL OR x.quantity <= 0
  ) THEN
    RAISE EXCEPTION 'Setiap produk harus memiliki jumlah lebih dari nol.';
  END IF;

  IF COALESCE(p_payment_method, '') NOT IN ('Tunai', 'Transfer bank', 'QRIS', 'Debit') THEN
    RAISE EXCEPTION 'Metode pembayaran tidak valid.';
  END IF;

  -- Validate and lock every required stock row before writing the sale.
  FOR v_item IN
    SELECT x.product_id, SUM(x.quantity)::numeric AS quantity
    FROM jsonb_to_recordset(p_items) AS x(product_id uuid, quantity numeric)
    GROUP BY x.product_id
    ORDER BY x.product_id
  LOOP
    IF v_item.product_id IS NULL OR v_item.quantity IS NULL OR v_item.quantity <= 0 THEN
      RAISE EXCEPTION 'Produk atau jumlah barang tidak valid.';
    END IF;

    SELECT p.name, p.selling_price, p.is_active
    INTO v_product
    FROM public.products p
    WHERE p.id = v_item.product_id
      AND p.business_id = p_business_id
    FOR SHARE;

    IF NOT FOUND OR v_product.is_active IS NOT TRUE THEN
      RAISE EXCEPTION 'Produk tidak ditemukan atau tidak aktif.';
    END IF;

    SELECT COUNT(*)::integer
    INTO v_inventory_count
    FROM public.inventory i
    WHERE i.business_id = p_business_id
      AND i.product_id = v_item.product_id
      AND i.warehouse_id = p_warehouse_id;

    IF v_inventory_count <> 1 THEN
      RAISE EXCEPTION 'Data stok produk % belum siap atau duplikat.', v_product.name;
    END IF;

    SELECT i.id, i.quantity
    INTO v_inventory
    FROM public.inventory i
    WHERE i.business_id = p_business_id
      AND i.product_id = v_item.product_id
      AND i.warehouse_id = p_warehouse_id
    FOR UPDATE;

    IF NOT FOUND OR v_inventory.quantity < v_item.quantity THEN
      RAISE EXCEPTION 'Stok % tidak mencukupi. Tersedia: %.',
        v_product.name, COALESCE(v_inventory.quantity, 0);
    END IF;

    v_subtotal := v_subtotal + (v_product.selling_price * v_item.quantity);
  END LOOP;

  v_invoice_no := 'JH-' ||
    to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD-HH24MISS') ||
    '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  INSERT INTO public.sales (
    business_id, branch_id, customer_id, invoice_no, status,
    subtotal, discount, tax, total, cashier_id
  ) VALUES (
    p_business_id, p_branch_id, p_customer_id, v_invoice_no, 'paid',
    v_subtotal, 0, 0, v_subtotal, auth.uid()
  )
  RETURNING id INTO v_sale_id;

  FOR v_item IN
    SELECT x.product_id, SUM(x.quantity)::numeric AS quantity
    FROM jsonb_to_recordset(p_items) AS x(product_id uuid, quantity numeric)
    GROUP BY x.product_id
    ORDER BY x.product_id
  LOOP
    SELECT p.name, p.selling_price
    INTO v_product
    FROM public.products p
    WHERE p.id = v_item.product_id
      AND p.business_id = p_business_id;

    SELECT i.id, i.quantity
    INTO v_inventory
    FROM public.inventory i
    WHERE i.business_id = p_business_id
      AND i.product_id = v_item.product_id
      AND i.warehouse_id = p_warehouse_id;

    v_quantity := v_item.quantity;
    v_line_total := v_product.selling_price * v_quantity;

    UPDATE public.inventory
    SET quantity = quantity - v_quantity,
        updated_at = now()
    WHERE id = v_inventory.id
      AND quantity >= v_quantity;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count <> 1 THEN
      RAISE EXCEPTION 'Stok berubah saat transaksi diproses. Silakan muat ulang.';
    END IF;

    INSERT INTO public.sale_items (
      business_id, sale_id, product_id, product_name,
      quantity, unit_price, discount, line_total
    ) VALUES (
      p_business_id, v_sale_id, v_item.product_id, v_product.name,
      v_quantity, v_product.selling_price, 0, v_line_total
    );

    INSERT INTO public.stock_movements (
      business_id, product_id, warehouse_id, movement_type,
      quantity_change, reference_type, reference_id, created_by
    ) VALUES (
      p_business_id, v_item.product_id, p_warehouse_id, 'sale',
      -v_quantity, 'sale', v_sale_id, auth.uid()
    );
  END LOOP;

  INSERT INTO public.sale_payments (
    business_id, sale_id, payment_method, amount, payment_status
  ) VALUES (
    p_business_id, v_sale_id, p_payment_method, v_subtotal, 'completed'
  );

  INSERT INTO public.cash_entries (
    business_id, branch_id, entry_type, category, description,
    amount, reference_type, reference_id, created_by
  ) VALUES (
    p_business_id, p_branch_id, 'income', 'Penjualan',
    'Pembayaran ' || v_invoice_no, v_subtotal, 'sale', v_sale_id, auth.uid()
  );

  INSERT INTO public.audit_logs (
    business_id, user_id, action, table_name, record_id, details
  ) VALUES (
    p_business_id, auth.uid(), 'sale.checkout', 'sales', v_sale_id,
    jsonb_build_object(
      'invoice_no', v_invoice_no,
      'total', v_subtotal,
      'branch_id', p_branch_id,
      'warehouse_id', p_warehouse_id
    )
  );

  RETURN QUERY SELECT v_sale_id, v_invoice_no, v_subtotal;
END;
$function$;

-- Internal product creation and opening stock. Product, inventory and movement
-- are one transaction; the warehouse must belong to the member's branch.
CREATE OR REPLACE FUNCTION private.smartpos_create_product_with_stock_impl(
  p_business_id uuid,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_name text,
  p_sku text,
  p_barcode text,
  p_category text,
  p_unit text,
  p_cost_price numeric,
  p_selling_price numeric,
  p_min_stock numeric,
  p_initial_quantity numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_category_id uuid;
  v_product_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Silakan masuk terlebih dahulu.';
  END IF;

  IF NOT private.smartpos_has_business_role(
    p_business_id, ARRAY['owner', 'admin', 'manager']::text[]
  ) THEN
    RAISE EXCEPTION 'Hanya Owner, Admin, atau Manager yang dapat menambah produk.';
  END IF;

  IF p_branch_id IS NULL
     OR NOT private.smartpos_can_access_branch(p_business_id, p_branch_id) THEN
    RAISE EXCEPTION 'Akses ke cabang ini tidak diizinkan.';
  END IF;

  IF NULLIF(trim(COALESCE(p_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Nama produk wajib diisi.';
  END IF;

  IF COALESCE(p_cost_price, 0) < 0
     OR COALESCE(p_selling_price, 0) < 0
     OR COALESCE(p_min_stock, 0) < 0
     OR COALESCE(p_initial_quantity, 0) < 0 THEN
    RAISE EXCEPTION 'Harga dan stok tidak boleh negatif.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = p_branch_id
      AND b.business_id = p_business_id
      AND b.is_active = true
  ) THEN
    RAISE EXCEPTION 'Cabang tidak valid.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.warehouses w
    WHERE w.id = p_warehouse_id
      AND w.business_id = p_business_id
      AND w.branch_id = p_branch_id
      AND w.is_active = true
  ) THEN
    RAISE EXCEPTION 'Gudang tidak valid.';
  END IF;

  IF NULLIF(trim(COALESCE(p_category, '')), '') IS NOT NULL THEN
    SELECT c.id INTO v_category_id
    FROM public.categories c
    WHERE c.business_id = p_business_id
      AND lower(c.name) = lower(trim(p_category))
    LIMIT 1;

    IF v_category_id IS NULL THEN
      INSERT INTO public.categories (business_id, name)
      VALUES (p_business_id, trim(p_category))
      RETURNING id INTO v_category_id;
    END IF;
  END IF;

  INSERT INTO public.products (
    business_id, category_id, sku, barcode, name, unit,
    cost_price, selling_price, min_stock, is_active
  ) VALUES (
    p_business_id, v_category_id,
    NULLIF(trim(COALESCE(p_sku, '')), ''),
    NULLIF(trim(COALESCE(p_barcode, '')), ''),
    trim(p_name),
    COALESCE(NULLIF(trim(COALESCE(p_unit, '')), ''), 'pcs'),
    COALESCE(p_cost_price, 0),
    COALESCE(p_selling_price, 0),
    COALESCE(p_min_stock, 0),
    true
  )
  RETURNING id INTO v_product_id;

  INSERT INTO public.inventory (business_id, product_id, warehouse_id, quantity)
  VALUES (p_business_id, v_product_id, p_warehouse_id, COALESCE(p_initial_quantity, 0));

  IF COALESCE(p_initial_quantity, 0) > 0 THEN
    INSERT INTO public.stock_movements (
      business_id, product_id, warehouse_id, movement_type,
      quantity_change, reference_type, notes, created_by
    ) VALUES (
      p_business_id, v_product_id, p_warehouse_id, 'opening',
      p_initial_quantity, 'product', 'Stok awal produk', auth.uid()
    );
  END IF;

  INSERT INTO public.audit_logs (
    business_id, user_id, action, table_name, record_id, details
  ) VALUES (
    p_business_id, auth.uid(), 'product.create', 'products', v_product_id,
    jsonb_build_object(
      'branch_id', p_branch_id,
      'warehouse_id', p_warehouse_id,
      'initial_quantity', COALESCE(p_initial_quantity, 0)
    )
  );

  RETURN v_product_id;
END;
$function$;

-- Internal purchase receiving. The supplier, products, branch and warehouse
-- are all checked against the same business before any stock is added.
CREATE OR REPLACE FUNCTION private.smartpos_receive_purchase_impl(
  p_business_id uuid,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_supplier_id uuid,
  p_items jsonb,
  p_notes text DEFAULT NULL::text
)
RETURNS TABLE(purchase_id uuid, purchase_no text, total numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_purchase_id uuid;
  v_purchase_no text;
  v_total numeric := 0;
  v_item record;
  v_product record;
  v_line_total numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Silakan masuk terlebih dahulu.';
  END IF;

  IF NOT private.smartpos_has_business_role(
    p_business_id, ARRAY['owner', 'admin', 'manager']::text[]
  ) THEN
    RAISE EXCEPTION 'Hanya Owner, Admin, atau Manager yang dapat mencatat pembelian.';
  END IF;

  IF p_branch_id IS NULL
     OR NOT private.smartpos_can_access_branch(p_business_id, p_branch_id) THEN
    RAISE EXCEPTION 'Akses ke cabang ini tidak diizinkan.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = p_branch_id
      AND b.business_id = p_business_id
      AND b.is_active = true
  ) THEN
    RAISE EXCEPTION 'Cabang pembelian tidak valid.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.warehouses w
    WHERE w.id = p_warehouse_id
      AND w.business_id = p_business_id
      AND w.branch_id = p_branch_id
      AND w.is_active = true
  ) THEN
    RAISE EXCEPTION 'Gudang penerimaan tidak valid.';
  END IF;

  IF p_supplier_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.suppliers s
    WHERE s.id = p_supplier_id
      AND s.business_id = p_business_id
  ) THEN
    RAISE EXCEPTION 'Pemasok tidak valid.';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Format daftar barang pembelian tidak valid.';
  END IF;

  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Daftar barang pembelian masih kosong.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_to_recordset(p_items) AS x(product_id uuid, quantity numeric, unit_cost numeric)
    WHERE x.product_id IS NULL
       OR x.quantity IS NULL
       OR x.quantity <= 0
       OR x.unit_cost IS NULL
       OR x.unit_cost < 0
  ) THEN
    RAISE EXCEPTION 'Produk, jumlah, atau harga modal tidak valid.';
  END IF;

  IF EXISTS (
    SELECT x.product_id
    FROM jsonb_to_recordset(p_items) AS x(product_id uuid, quantity numeric, unit_cost numeric)
    GROUP BY x.product_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Produk yang sama hanya boleh dimasukkan satu kali.';
  END IF;

  FOR v_item IN
    SELECT x.product_id, x.quantity, x.unit_cost
    FROM jsonb_to_recordset(p_items) AS x(product_id uuid, quantity numeric, unit_cost numeric)
    ORDER BY x.product_id
  LOOP
    SELECT p.name INTO v_product
    FROM public.products p
    WHERE p.id = v_item.product_id
      AND p.business_id = p_business_id
      AND p.is_active = true
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Produk tidak ditemukan atau tidak aktif.';
    END IF;

    v_total := v_total + (v_item.quantity * v_item.unit_cost);
  END LOOP;

  v_purchase_no := 'PO-' ||
    to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD-HH24MISS') ||
    '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  INSERT INTO public.purchase_orders (
    business_id, branch_id, supplier_id, warehouse_id,
    purchase_no, status, total, notes, created_by
  ) VALUES (
    p_business_id, p_branch_id, p_supplier_id, p_warehouse_id,
    v_purchase_no, 'received', v_total,
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    auth.uid()
  )
  RETURNING id INTO v_purchase_id;

  FOR v_item IN
    SELECT x.product_id, x.quantity, x.unit_cost
    FROM jsonb_to_recordset(p_items) AS x(product_id uuid, quantity numeric, unit_cost numeric)
    ORDER BY x.product_id
  LOOP
    v_line_total := v_item.quantity * v_item.unit_cost;

    INSERT INTO public.purchase_items (
      business_id, purchase_id, product_id, quantity, unit_cost, line_total
    ) VALUES (
      p_business_id, v_purchase_id, v_item.product_id,
      v_item.quantity, v_item.unit_cost, v_line_total
    );

    INSERT INTO public.inventory (business_id, product_id, warehouse_id, quantity)
    VALUES (p_business_id, v_item.product_id, p_warehouse_id, v_item.quantity)
    ON CONFLICT (product_id, warehouse_id)
    DO UPDATE SET
      quantity = public.inventory.quantity + EXCLUDED.quantity,
      updated_at = now();

    UPDATE public.products
    SET cost_price = v_item.unit_cost,
        updated_at = now()
    WHERE id = v_item.product_id
      AND business_id = p_business_id;

    INSERT INTO public.stock_movements (
      business_id, product_id, warehouse_id, movement_type,
      quantity_change, reference_type, reference_id, notes, created_by
    ) VALUES (
      p_business_id, v_item.product_id, p_warehouse_id, 'purchase',
      v_item.quantity, 'purchase', v_purchase_id,
      'Penerimaan ' || v_purchase_no, auth.uid()
    );
  END LOOP;

  INSERT INTO public.audit_logs (
    business_id, user_id, action, table_name, record_id, details
  ) VALUES (
    p_business_id, auth.uid(), 'purchase.receive', 'purchase_orders', v_purchase_id,
    jsonb_build_object(
      'purchase_no', v_purchase_no,
      'total', v_total,
      'branch_id', p_branch_id,
      'warehouse_id', p_warehouse_id
    )
  );

  RETURN QUERY SELECT v_purchase_id, v_purchase_no, v_total;
END;
$function$;

-- Customer creation is available to signed-in operational staff only.
CREATE OR REPLACE FUNCTION private.smartpos_create_customer_impl(
  p_business_id uuid,
  p_name text,
  p_phone text DEFAULT NULL::text,
  p_email text DEFAULT NULL::text,
  p_address text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_customer_id uuid;
BEGIN
  IF auth.uid() IS NULL
     OR NOT private.smartpos_has_business_role(
       p_business_id, ARRAY['owner', 'admin', 'manager', 'cashier']::text[]
     ) THEN
    RAISE EXCEPTION 'Akses untuk menambah pelanggan tidak diizinkan.';
  END IF;

  IF NULLIF(trim(COALESCE(p_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Nama pelanggan wajib diisi.';
  END IF;

  INSERT INTO public.customers (business_id, name, phone, email, address)
  VALUES (
    p_business_id,
    trim(p_name),
    NULLIF(trim(COALESCE(p_phone, '')), ''),
    NULLIF(trim(COALESCE(p_email, '')), ''),
    NULLIF(trim(COALESCE(p_address, '')), '')
  )
  RETURNING id INTO v_customer_id;

  INSERT INTO public.audit_logs (
    business_id, user_id, action, table_name, record_id, details
  ) VALUES (
    p_business_id, auth.uid(), 'customer.create', 'customers', v_customer_id, '{}'::jsonb
  );

  RETURN v_customer_id;
END;
$function$;

-- Supplier creation is restricted to management roles.
CREATE OR REPLACE FUNCTION private.smartpos_create_supplier_impl(
  p_business_id uuid,
  p_name text,
  p_phone text DEFAULT NULL::text,
  p_email text DEFAULT NULL::text,
  p_address text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_supplier_id uuid;
BEGIN
  IF auth.uid() IS NULL
     OR NOT private.smartpos_has_business_role(
       p_business_id, ARRAY['owner', 'admin', 'manager']::text[]
     ) THEN
    RAISE EXCEPTION 'Akses untuk menambah pemasok tidak diizinkan.';
  END IF;

  IF NULLIF(trim(COALESCE(p_name, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Nama pemasok wajib diisi.';
  END IF;

  INSERT INTO public.suppliers (business_id, name, phone, email, address)
  VALUES (
    p_business_id,
    trim(p_name),
    NULLIF(trim(COALESCE(p_phone, '')), ''),
    NULLIF(trim(COALESCE(p_email, '')), ''),
    NULLIF(trim(COALESCE(p_address, '')), '')
  )
  RETURNING id INTO v_supplier_id;

  INSERT INTO public.audit_logs (
    business_id, user_id, action, table_name, record_id, details
  ) VALUES (
    p_business_id, auth.uid(), 'supplier.create', 'suppliers', v_supplier_id, '{}'::jsonb
  );

  RETURN v_supplier_id;
END;
$function$;

-- Public API wrappers stay SECURITY INVOKER. Elevated work lives in private.
CREATE OR REPLACE FUNCTION public.checkout_sale(
  p_business_id uuid,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_payment_method text
)
RETURNS TABLE(sale_id uuid, invoice_no text, total numeric)
LANGUAGE sql
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT *
  FROM private.smartpos_checkout_sale_impl(
    p_business_id, p_branch_id, p_warehouse_id, p_customer_id, p_items, p_payment_method
  );
$function$;

CREATE OR REPLACE FUNCTION public.create_product_with_stock(
  p_business_id uuid,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_name text,
  p_sku text,
  p_barcode text,
  p_category text,
  p_unit text,
  p_cost_price numeric,
  p_selling_price numeric,
  p_min_stock numeric,
  p_initial_quantity numeric
)
RETURNS uuid
LANGUAGE sql
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT private.smartpos_create_product_with_stock_impl(
    p_business_id, p_branch_id, p_warehouse_id, p_name, p_sku, p_barcode,
    p_category, p_unit, p_cost_price, p_selling_price, p_min_stock, p_initial_quantity
  );
$function$;

CREATE OR REPLACE FUNCTION public.receive_purchase(
  p_business_id uuid,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_supplier_id uuid,
  p_items jsonb,
  p_notes text DEFAULT NULL::text
)
RETURNS TABLE(purchase_id uuid, purchase_no text, total numeric)
LANGUAGE sql
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT *
  FROM private.smartpos_receive_purchase_impl(
    p_business_id, p_branch_id, p_warehouse_id, p_supplier_id, p_items, p_notes
  );
$function$;

CREATE OR REPLACE FUNCTION public.create_customer(
  p_business_id uuid,
  p_name text,
  p_phone text DEFAULT NULL::text,
  p_email text DEFAULT NULL::text,
  p_address text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE sql
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT private.smartpos_create_customer_impl(
    p_business_id, p_name, p_phone, p_email, p_address
  );
$function$;

CREATE OR REPLACE FUNCTION public.create_supplier(
  p_business_id uuid,
  p_name text,
  p_phone text DEFAULT NULL::text,
  p_email text DEFAULT NULL::text,
  p_address text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE sql
SECURITY INVOKER
SET search_path TO ''
AS $function$
  SELECT private.smartpos_create_supplier_impl(
    p_business_id, p_name, p_phone, p_email, p_address
  );
$function$;

-- Only authenticated users can execute the public RPCs. Internal functions
-- are granted for invocation by the public wrappers and RLS helper wrappers.
REVOKE ALL ON FUNCTION private.smartpos_is_business_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.smartpos_is_business_owner(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.smartpos_has_business_role(uuid, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.smartpos_can_access_branch(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.smartpos_checkout_sale_impl(uuid, uuid, uuid, uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.smartpos_create_product_with_stock_impl(uuid, uuid, uuid, text, text, text, text, text, numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.smartpos_receive_purchase_impl(uuid, uuid, uuid, uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.smartpos_create_customer_impl(uuid, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.smartpos_create_supplier_impl(uuid, text, text, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION private.smartpos_is_business_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.smartpos_is_business_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.smartpos_has_business_role(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION private.smartpos_can_access_branch(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.smartpos_checkout_sale_impl(uuid, uuid, uuid, uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.smartpos_create_product_with_stock_impl(uuid, uuid, uuid, text, text, text, text, text, numeric, numeric, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION private.smartpos_receive_purchase_impl(uuid, uuid, uuid, uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.smartpos_create_customer_impl(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.smartpos_create_supplier_impl(uuid, text, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.is_business_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_business_owner(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_access_branch(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.checkout_sale(uuid, uuid, uuid, uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_product_with_stock(uuid, uuid, uuid, text, text, text, text, text, numeric, numeric, numeric, numeric) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.receive_purchase(uuid, uuid, uuid, uuid, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_customer(uuid, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_supplier(uuid, text, text, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_business_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_business_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_branch(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.checkout_sale(uuid, uuid, uuid, uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_product_with_stock(uuid, uuid, uuid, text, text, text, text, text, numeric, numeric, numeric, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_purchase(uuid, uuid, uuid, uuid, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_customer(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_supplier(uuid, text, text, text, text) TO authenticated;

-- Revoke direct table writes from API roles. Atomic SECURITY DEFINER functions
-- above are the only write path for operational POS tables.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT INSERT, UPDATE ON TABLE public.businesses, public.business_members, public.user_profiles TO authenticated;

-- Prevent future public-schema objects from becoming writable/executable by
-- API roles merely because they were created by a migration.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- Replace broad business-wide write policies with read policies and branch
-- filters. The private atomic functions bypass RLS only after validating scope.
DROP POLICY IF EXISTS audit_logs_insert_members ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_select_members ON public.audit_logs;
CREATE POLICY audit_logs_select_owners
  ON public.audit_logs FOR SELECT TO authenticated
  USING (public.is_business_owner(business_id));

DROP POLICY IF EXISTS branches_member_access ON public.branches;
CREATE POLICY branches_select_assigned
  ON public.branches FOR SELECT TO authenticated
  USING (public.can_access_branch(business_id, id));

DROP POLICY IF EXISTS warehouses_member_access ON public.warehouses;
CREATE POLICY warehouses_select_assigned
  ON public.warehouses FOR SELECT TO authenticated
  USING (public.can_access_branch(business_id, branch_id));

DROP POLICY IF EXISTS categories_member_access ON public.categories;
CREATE POLICY categories_select_members
  ON public.categories FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));

DROP POLICY IF EXISTS products_member_access ON public.products;
CREATE POLICY products_select_members
  ON public.products FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));

DROP POLICY IF EXISTS customers_member_access ON public.customers;
CREATE POLICY customers_select_members
  ON public.customers FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));

DROP POLICY IF EXISTS suppliers_member_access ON public.suppliers;
CREATE POLICY suppliers_select_members
  ON public.suppliers FOR SELECT TO authenticated
  USING (public.is_business_member(business_id));

DROP POLICY IF EXISTS inventory_member_access ON public.inventory;
CREATE POLICY inventory_select_assigned
  ON public.inventory FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.warehouses w
      WHERE w.id = inventory.warehouse_id
        AND w.business_id = inventory.business_id
        AND public.can_access_branch(w.business_id, w.branch_id)
    )
  );

DROP POLICY IF EXISTS stock_movements_insert_members ON public.stock_movements;
DROP POLICY IF EXISTS stock_movements_select_members ON public.stock_movements;
CREATE POLICY stock_movements_select_assigned
  ON public.stock_movements FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.warehouses w
      WHERE w.id = stock_movements.warehouse_id
        AND w.business_id = stock_movements.business_id
        AND public.can_access_branch(w.business_id, w.branch_id)
    )
  );

DROP POLICY IF EXISTS sales_member_access ON public.sales;
CREATE POLICY sales_select_assigned
  ON public.sales FOR SELECT TO authenticated
  USING (public.can_access_branch(business_id, branch_id));

DROP POLICY IF EXISTS sale_items_member_access ON public.sale_items;
CREATE POLICY sale_items_select_assigned
  ON public.sale_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.sales s
      WHERE s.id = sale_items.sale_id
        AND s.business_id = sale_items.business_id
        AND public.can_access_branch(s.business_id, s.branch_id)
    )
  );

DROP POLICY IF EXISTS sale_payments_member_access ON public.sale_payments;
CREATE POLICY sale_payments_select_assigned
  ON public.sale_payments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.sales s
      WHERE s.id = sale_payments.sale_id
        AND s.business_id = sale_payments.business_id
        AND public.can_access_branch(s.business_id, s.branch_id)
    )
  );

DROP POLICY IF EXISTS purchase_orders_member_access ON public.purchase_orders;
CREATE POLICY purchase_orders_select_assigned
  ON public.purchase_orders FOR SELECT TO authenticated
  USING (public.can_access_branch(business_id, branch_id));

DROP POLICY IF EXISTS purchase_items_member_access ON public.purchase_items;
CREATE POLICY purchase_items_select_assigned
  ON public.purchase_items FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.purchase_orders po
      WHERE po.id = purchase_items.purchase_id
        AND po.business_id = purchase_items.business_id
        AND public.can_access_branch(po.business_id, po.branch_id)
    )
  );

DROP POLICY IF EXISTS cash_entries_member_access ON public.cash_entries;
CREATE POLICY cash_entries_select_assigned
  ON public.cash_entries FOR SELECT TO authenticated
  USING (public.can_access_branch(business_id, branch_id));

-- Keep the existing owner/business onboarding and self-profile policies. Their
-- table grants above still require an authenticated session.
NOTIFY pgrst, 'reload schema';
