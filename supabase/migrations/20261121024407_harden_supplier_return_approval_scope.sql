-- Harden supplier-return approval against cross-tenant and cross-warehouse references.
-- Draft creation remains unchanged. Approval performs all stock changes and audit writes atomically.

CREATE OR REPLACE FUNCTION public.approve_supplier_return(p_return_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_return public.supplier_returns%rowtype;
  v_po public.purchase_orders%rowtype;
  v_purchase_item public.purchase_items%rowtype;
  v_item record;
  v_inventory_id uuid;
  v_stock numeric;
  v_already_returned numeric;
  v_item_count integer;
  v_total_count integer;
  v_items_total numeric;
  v_updated_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING errcode = '42501';
  END IF;

  SELECT * INTO v_return
  FROM public.supplier_returns
  WHERE id = p_return_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Dokumen retur pemasok tidak ditemukan.';
  END IF;

  IF NOT private.smartpos_has_business_role(v_return.business_id, ARRAY['owner', 'admin']::text[])
     OR NOT private.smartpos_can_access_branch(v_return.business_id, v_return.branch_id) THEN
    RAISE EXCEPTION 'Persetujuan retur hanya dapat dilakukan Owner/Admin.'
      USING errcode = '42501';
  END IF;

  IF v_return.status <> 'draft' THEN
    RAISE EXCEPTION 'Dokumen retur sudah diproses.';
  END IF;

  SELECT * INTO v_po
  FROM public.purchase_orders
  WHERE id = v_return.purchase_id
  FOR UPDATE;

  IF NOT FOUND OR v_po.status <> 'received' THEN
    RAISE EXCEPTION 'Pembelian asal tidak lagi valid.';
  END IF;

  -- Re-check every denormalized tenant/location reference at approval time.
  IF v_po.business_id IS DISTINCT FROM v_return.business_id
     OR v_po.branch_id IS DISTINCT FROM v_return.branch_id
     OR v_po.warehouse_id IS DISTINCT FROM v_return.warehouse_id
     OR v_po.supplier_id IS DISTINCT FROM v_return.supplier_id THEN
    RAISE EXCEPTION 'Bisnis, cabang, gudang, atau pemasok retur tidak cocok dengan pembelian asal.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.branches b
    WHERE b.id = v_return.branch_id
      AND b.business_id = v_return.business_id
      AND b.is_active = true
  ) THEN
    RAISE EXCEPTION 'Cabang retur tidak ditemukan atau tidak aktif.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.warehouses w
    WHERE w.id = v_return.warehouse_id
      AND w.business_id = v_return.business_id
      AND w.branch_id = v_return.branch_id
      AND w.is_active = true
  ) THEN
    RAISE EXCEPTION 'Gudang retur tidak ditemukan, tidak aktif, atau bukan milik cabang pembelian.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.suppliers s
    WHERE s.id = v_return.supplier_id
      AND s.business_id = v_return.business_id
  ) THEN
    RAISE EXCEPTION 'Pemasok retur tidak cocok dengan bisnis.';
  END IF;

  SELECT
    count(*) FILTER (WHERE sri.business_id = v_return.business_id)::integer,
    count(*)::integer,
    coalesce(sum(sri.line_total), 0)::numeric
  INTO v_item_count, v_total_count, v_items_total
  FROM public.supplier_return_items sri
  WHERE sri.supplier_return_id = v_return.id;

  IF v_total_count = 0 OR v_item_count <> v_total_count THEN
    RAISE EXCEPTION 'Detail retur kosong atau memiliki referensi bisnis yang tidak cocok.';
  END IF;

  IF v_items_total IS DISTINCT FROM v_return.total THEN
    RAISE EXCEPTION 'Total detail retur tidak cocok dengan total dokumen.';
  END IF;

  -- Lock and validate original purchase lines in a deterministic order.
  FOR v_item IN
    SELECT sri.purchase_item_id, sri.product_id, sri.business_id,
           sri.quantity, sri.unit_cost, sri.line_total
    FROM public.supplier_return_items sri
    WHERE sri.supplier_return_id = v_return.id
    ORDER BY sri.purchase_item_id
    FOR UPDATE
  LOOP
    IF v_item.business_id IS DISTINCT FROM v_return.business_id THEN
      RAISE EXCEPTION 'Detail retur berasal dari bisnis yang berbeda.';
    END IF;

    SELECT pi.* INTO v_purchase_item
    FROM public.purchase_items pi
    WHERE pi.id = v_item.purchase_item_id
      AND pi.business_id = v_return.business_id
      AND pi.purchase_id = v_return.purchase_id
      AND pi.product_id = v_item.product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Barang retur bukan bagian dari pembelian dan bisnis asal.';
    END IF;

    IF v_item.unit_cost IS DISTINCT FROM v_purchase_item.unit_cost
       OR v_item.line_total IS DISTINCT FROM round(v_item.quantity * v_purchase_item.unit_cost, 2) THEN
      RAISE EXCEPTION 'Harga modal atau nilai detail retur tidak cocok dengan pembelian asal.';
    END IF;

    SELECT coalesce(sum(ri.quantity), 0)::numeric INTO v_already_returned
    FROM public.supplier_return_items ri
    JOIN public.supplier_returns r ON r.id = ri.supplier_return_id
    WHERE ri.purchase_item_id = v_item.purchase_item_id
      AND ri.business_id = v_return.business_id
      AND r.business_id = v_return.business_id
      AND r.purchase_id = v_return.purchase_id
      AND r.status = 'approved';

    IF v_already_returned + v_item.quantity > v_purchase_item.quantity THEN
      RAISE EXCEPTION 'Jumlah retur yang disetujui sebelumnya membuat jumlah retur melebihi pembelian.';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.products p
      WHERE p.id = v_item.product_id
        AND p.business_id = v_return.business_id
    ) THEN
      RAISE EXCEPTION 'Produk retur bukan milik bisnis pembelian.';
    END IF;
  END LOOP;

  -- Lock each stock row once, in product order, and validate aggregate quantity.
  FOR v_item IN
    SELECT sri.product_id, sum(sri.quantity)::numeric AS quantity
    FROM public.supplier_return_items sri
    WHERE sri.supplier_return_id = v_return.id
      AND sri.business_id = v_return.business_id
    GROUP BY sri.product_id
    ORDER BY sri.product_id
  LOOP
    SELECT i.id, i.quantity INTO v_inventory_id, v_stock
    FROM public.inventory i
    WHERE i.business_id = v_return.business_id
      AND i.product_id = v_item.product_id
      AND i.warehouse_id = v_return.warehouse_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Catatan stok gudang asal tidak ditemukan untuk produk retur.';
    END IF;

    IF v_stock < v_item.quantity THEN
      RAISE EXCEPTION 'Stok tidak cukup untuk retur salah satu barang. Dokumen tidak diproses.';
    END IF;
  END LOOP;

  -- Apply each original return line only to the validated business/warehouse.
  FOR v_item IN
    SELECT sri.product_id, sri.quantity
    FROM public.supplier_return_items sri
    WHERE sri.supplier_return_id = v_return.id
      AND sri.business_id = v_return.business_id
    ORDER BY sri.product_id, sri.purchase_item_id
  LOOP
    UPDATE public.inventory
    SET quantity = quantity - v_item.quantity, updated_at = now()
    WHERE business_id = v_return.business_id
      AND product_id = v_item.product_id
      AND warehouse_id = v_return.warehouse_id;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    IF v_updated_count <> 1 THEN
      RAISE EXCEPTION 'Perubahan stok retur tidak dapat dipastikan. Dokumen dibatalkan.';
    END IF;

    INSERT INTO public.stock_movements (
      business_id, product_id, warehouse_id, movement_type,
      quantity_change, reference_type, reference_id, notes, created_by
    )
    VALUES (
      v_return.business_id, v_item.product_id, v_return.warehouse_id,
      'return', -v_item.quantity, 'supplier_return', v_return.id,
      'Retur ke pemasok ' || v_return.return_no, auth.uid()
    );
  END LOOP;

  UPDATE public.supplier_returns
  SET status = 'approved', approved_by = auth.uid(), approved_at = now()
  WHERE id = v_return.id
    AND business_id = v_return.business_id
    AND status = 'draft';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count <> 1 THEN
    RAISE EXCEPTION 'Status dokumen retur berubah. Persetujuan dibatalkan.';
  END IF;

  INSERT INTO public.audit_logs (
    business_id, user_id, action, table_name, record_id, details
  )
  VALUES (
    v_return.business_id, auth.uid(), 'supplier_return_approved',
    'supplier_returns', v_return.id,
    jsonb_build_object(
      'return_no', v_return.return_no,
      'purchase_id', v_return.purchase_id,
      'total', v_return.total,
      'branch_id', v_return.branch_id,
      'warehouse_id', v_return.warehouse_id
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.approve_supplier_return(uuid)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.approve_supplier_return(uuid)
TO authenticated;
