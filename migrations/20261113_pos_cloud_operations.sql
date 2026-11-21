-- SMART POS JATIBARANG: atomic cloud operations
-- Snapshot of live RPC definitions as of 2026-11-13.
-- Reapplying recreates these functions and their access grants.
CREATE OR REPLACE FUNCTION public.checkout_sale(p_business_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_customer_id uuid, p_items jsonb, p_payment_method text)
 RETURNS TABLE(sale_id uuid, invoice_no text, total numeric)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_sale_id uuid;
  v_invoice_no text;
  v_subtotal numeric := 0;
  v_item record;
  v_product record;
  v_inventory record;
  v_inventory_count integer;
  v_quantity numeric;
  v_line_total numeric;
begin
  if auth.uid() is null then
    raise exception 'Silakan masuk terlebih dahulu.';
  end if;

  if not public.is_business_member(p_business_id) then
    raise exception 'Akses bisnis tidak diizinkan.';
  end if;

  if jsonb_typeof(p_items) is distinct from 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'Keranjang belanja kosong.';
  end if;

  if p_payment_method not in ('Tunai', 'Transfer bank', 'QRIS', 'Debit') then
    raise exception 'Metode pembayaran tidak valid.';
  end if;

  if not exists (
    select 1 from public.warehouses w
    where w.id = p_warehouse_id
      and w.business_id = p_business_id
      and w.is_active = true
      and (p_branch_id is null or w.branch_id = p_branch_id)
  ) then
    raise exception 'Gudang tidak ditemukan atau tidak aktif.';
  end if;

  if p_customer_id is not null and not exists (
    select 1 from public.customers c
    where c.id = p_customer_id and c.business_id = p_business_id
  ) then
    raise exception 'Pelanggan tidak valid.';
  end if;

  -- Lock inventory rows in a stable order and validate all quantities first.
  for v_item in
    select x.product_id, sum(x.quantity)::numeric as quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity numeric)
    group by x.product_id
    order by x.product_id
  loop
    if v_item.product_id is null or v_item.quantity is null or v_item.quantity <= 0 then
      raise exception 'Produk atau jumlah barang tidak valid.';
    end if;

    select p.name, p.selling_price, p.is_active
      into v_product
    from public.products p
    where p.id = v_item.product_id
      and p.business_id = p_business_id
    for share;

    if not found or v_product.is_active is not true then
      raise exception 'Produk tidak ditemukan atau tidak aktif.';
    end if;

    select count(*)::integer into v_inventory_count
    from public.inventory i
    where i.business_id = p_business_id
      and i.product_id = v_item.product_id
      and i.warehouse_id = p_warehouse_id;

    if v_inventory_count <> 1 then
      raise exception 'Data stok produk % belum siap atau duplikat.', v_product.name;
    end if;

    select i.id, i.quantity
      into v_inventory
    from public.inventory i
    where i.business_id = p_business_id
      and i.product_id = v_item.product_id
      and i.warehouse_id = p_warehouse_id
    for update;

    if v_inventory.quantity < v_item.quantity then
      raise exception 'Stok % tidak mencukupi. Tersedia: %.', v_product.name, v_inventory.quantity;
    end if;

    v_subtotal := v_subtotal + (v_product.selling_price * v_item.quantity);
  end loop;

  v_invoice_no := 'JH-' || to_char(now() at time zone 'Asia/Jakarta', 'YYYYMMDD-HH24MISS')
                  || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  insert into public.sales (
    business_id, branch_id, customer_id, invoice_no, status,
    subtotal, discount, tax, total, cashier_id
  ) values (
    p_business_id, p_branch_id, p_customer_id, v_invoice_no, 'paid',
    v_subtotal, 0, 0, v_subtotal, auth.uid()
  ) returning id into v_sale_id;

  for v_item in
    select x.product_id, sum(x.quantity)::numeric as quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity numeric)
    group by x.product_id
    order by x.product_id
  loop
    select p.name, p.selling_price
      into v_product
    from public.products p
    where p.id = v_item.product_id
      and p.business_id = p_business_id;

    select i.id, i.quantity
      into v_inventory
    from public.inventory i
    where i.business_id = p_business_id
      and i.product_id = v_item.product_id
      and i.warehouse_id = p_warehouse_id;

    v_quantity := v_item.quantity;
    v_line_total := v_product.selling_price * v_quantity;

    update public.inventory
    set quantity = quantity - v_quantity,
        updated_at = now()
    where id = v_inventory.id;

    insert into public.sale_items (
      business_id, sale_id, product_id, product_name,
      quantity, unit_price, discount, line_total
    ) values (
      p_business_id, v_sale_id, v_item.product_id, v_product.name,
      v_quantity, v_product.selling_price, 0, v_line_total
    );

    insert into public.stock_movements (
      business_id, product_id, warehouse_id, movement_type,
      quantity_change, reference_type, reference_id, created_by
    ) values (
      p_business_id, v_item.product_id, p_warehouse_id, 'sale',
      -v_quantity, 'sale', v_sale_id, auth.uid()
    );
  end loop;

  insert into public.sale_payments (
    business_id, sale_id, payment_method, amount, payment_status
  ) values (
    p_business_id, v_sale_id, p_payment_method, v_subtotal, 'completed'
  );

  insert into public.cash_entries (
    business_id, branch_id, entry_type, category, description,
    amount, reference_type, reference_id, created_by
  ) values (
    p_business_id, p_branch_id, 'income', 'Penjualan',
    'Pembayaran ' || v_invoice_no, v_subtotal, 'sale', v_sale_id, auth.uid()
  );

  return query select v_sale_id, v_invoice_no, v_subtotal;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_product_with_stock(p_business_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_name text, p_sku text, p_barcode text, p_category text, p_unit text, p_cost_price numeric, p_selling_price numeric, p_min_stock numeric, p_initial_quantity numeric)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_category_id uuid;
  v_product_id uuid;
begin
  if auth.uid() is null then raise exception 'Silakan masuk terlebih dahulu.'; end if;

  if not exists (
    select 1 from public.business_members bm
    where bm.business_id = p_business_id and bm.user_id = auth.uid()
      and bm.is_active = true and bm.role in ('owner', 'admin', 'manager')
  ) then raise exception 'Hanya Owner, Admin, atau Manager yang dapat menambah produk.'; end if;

  if nullif(trim(p_name), '') is null then raise exception 'Nama produk wajib diisi.'; end if;
  if coalesce(p_cost_price,0) < 0 or coalesce(p_selling_price,0) < 0
     or coalesce(p_min_stock,0) < 0 or coalesce(p_initial_quantity,0) < 0 then
    raise exception 'Harga dan stok tidak boleh negatif.';
  end if;

  if not exists (select 1 from public.branches b where b.id=p_branch_id and b.business_id=p_business_id and b.is_active=true) then
    raise exception 'Cabang tidak valid.';
  end if;
  if not exists (select 1 from public.warehouses w where w.id=p_warehouse_id and w.business_id=p_business_id and w.branch_id=p_branch_id and w.is_active=true) then
    raise exception 'Gudang tidak valid.';
  end if;

  if nullif(trim(p_category),'') is not null then
    select c.id into v_category_id from public.categories c
    where c.business_id=p_business_id and lower(c.name)=lower(trim(p_category)) limit 1;
    if v_category_id is null then
      insert into public.categories (business_id,name) values (p_business_id,trim(p_category))
      returning id into v_category_id;
    end if;
  end if;

  insert into public.products (business_id,category_id,sku,barcode,name,unit,cost_price,selling_price,min_stock,is_active)
  values (p_business_id,v_category_id,nullif(trim(p_sku),''),nullif(trim(p_barcode),''),trim(p_name),
    coalesce(nullif(trim(p_unit),''),'pcs'),coalesce(p_cost_price,0),coalesce(p_selling_price,0),
    coalesce(p_min_stock,0),true)
  returning id into v_product_id;

  insert into public.inventory (business_id,product_id,warehouse_id,quantity)
  values (p_business_id,v_product_id,p_warehouse_id,coalesce(p_initial_quantity,0));

  if coalesce(p_initial_quantity,0)>0 then
    insert into public.stock_movements (business_id,product_id,warehouse_id,movement_type,quantity_change,reference_type,notes,created_by)
    values (p_business_id,v_product_id,p_warehouse_id,'opening',p_initial_quantity,'product','Stok awal produk',auth.uid());
  end if;

  return v_product_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.receive_purchase(p_business_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_supplier_id uuid, p_items jsonb, p_notes text DEFAULT NULL::text)
 RETURNS TABLE(purchase_id uuid, purchase_no text, total numeric)
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_purchase_id uuid;
  v_purchase_no text;
  v_total numeric := 0;
  v_item record;
  v_product record;
  v_line_total numeric;
begin
  if auth.uid() is null then raise exception 'Silakan masuk terlebih dahulu.'; end if;

  if not exists (
    select 1 from public.business_members bm
    where bm.business_id = p_business_id and bm.user_id = auth.uid()
      and bm.is_active = true and bm.role in ('owner','admin','manager')
  ) then raise exception 'Hanya Owner, Admin, atau Manager yang dapat mencatat pembelian.'; end if;

  if not exists (
    select 1 from public.branches b
    where b.id = p_branch_id and b.business_id = p_business_id and b.is_active = true
  ) then raise exception 'Cabang pembelian tidak valid.'; end if;

  if not exists (
    select 1 from public.warehouses w
    where w.id = p_warehouse_id and w.business_id = p_business_id
      and w.branch_id = p_branch_id and w.is_active = true
  ) then raise exception 'Gudang penerimaan tidak valid.'; end if;

  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers s
    where s.id = p_supplier_id and s.business_id = p_business_id
  ) then raise exception 'Pemasok tidak valid.'; end if;

  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Daftar barang pembelian masih kosong.';
  end if;

  if exists (
    select 1 from jsonb_to_recordset(p_items) as x(product_id uuid, quantity numeric, unit_cost numeric)
    where x.product_id is null or x.quantity is null or x.quantity <= 0
      or x.unit_cost is null or x.unit_cost < 0
  ) then raise exception 'Produk, jumlah, atau harga modal tidak valid.'; end if;

  if exists (
    select x.product_id
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity numeric, unit_cost numeric)
    group by x.product_id having count(*) > 1
  ) then raise exception 'Produk yang sama hanya boleh dimasukkan satu kali.'; end if;

  for v_item in
    select x.product_id, x.quantity, x.unit_cost
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity numeric, unit_cost numeric)
    order by x.product_id
  loop
    select p.name into v_product
    from public.products p
    where p.id = v_item.product_id and p.business_id = p_business_id and p.is_active = true
    for share;
    if not found then raise exception 'Produk tidak ditemukan atau tidak aktif.'; end if;
    v_total := v_total + (v_item.quantity * v_item.unit_cost);
  end loop;

  v_purchase_no := 'PO-' || to_char(now() at time zone 'Asia/Jakarta','YYYYMMDD-HH24MISS')
                   || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  insert into public.purchase_orders (
    business_id, branch_id, supplier_id, warehouse_id,
    purchase_no, status, total, notes, created_by
  ) values (
    p_business_id, p_branch_id, p_supplier_id, p_warehouse_id,
    v_purchase_no, 'received', v_total, nullif(trim(coalesce(p_notes,'')),''),
    auth.uid()
  ) returning id into v_purchase_id;

  for v_item in
    select x.product_id, x.quantity, x.unit_cost
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity numeric, unit_cost numeric)
    order by x.product_id
  loop
    v_line_total := v_item.quantity * v_item.unit_cost;

    insert into public.purchase_items (
      business_id, purchase_id, product_id, quantity, unit_cost, line_total
    ) values (
      p_business_id, v_purchase_id, v_item.product_id,
      v_item.quantity, v_item.unit_cost, v_line_total
    );

    insert into public.inventory (business_id, product_id, warehouse_id, quantity)
    values (p_business_id, v_item.product_id, p_warehouse_id, v_item.quantity)
    on conflict (product_id, warehouse_id)
    do update set quantity = public.inventory.quantity + excluded.quantity,
                  updated_at = now();

    update public.products
    set cost_price = v_item.unit_cost, updated_at = now()
    where id = v_item.product_id and business_id = p_business_id;

    insert into public.stock_movements (
      business_id, product_id, warehouse_id, movement_type,
      quantity_change, reference_type, reference_id, notes, created_by
    ) values (
      p_business_id, v_item.product_id, p_warehouse_id, 'purchase',
      v_item.quantity, 'purchase', v_purchase_id, 'Penerimaan ' || v_purchase_no, auth.uid()
    );
  end loop;

  return query select v_purchase_id, v_purchase_no, v_total;
end;
$function$
;

revoke all on function public.checkout_sale(uuid,uuid,uuid,uuid,jsonb,text) from public;
revoke all on function public.checkout_sale(uuid,uuid,uuid,uuid,jsonb,text) from anon;
grant execute on function public.checkout_sale(uuid,uuid,uuid,uuid,jsonb,text) to authenticated;

revoke all on function public.create_product_with_stock(uuid,uuid,uuid,text,text,text,text,text,numeric,numeric,numeric,numeric) from public;
revoke all on function public.create_product_with_stock(uuid,uuid,uuid,text,text,text,text,text,numeric,numeric,numeric,numeric) from anon;
grant execute on function public.create_product_with_stock(uuid,uuid,uuid,text,text,text,text,text,numeric,numeric,numeric,numeric) to authenticated;

revoke all on function public.receive_purchase(uuid,uuid,uuid,uuid,jsonb,text) from public;
revoke all on function public.receive_purchase(uuid,uuid,uuid,uuid,jsonb,text) from anon;
grant execute on function public.receive_purchase(uuid,uuid,uuid,uuid,jsonb,text) to authenticated;
