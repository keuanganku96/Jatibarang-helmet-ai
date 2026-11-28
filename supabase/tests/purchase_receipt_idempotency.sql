-- Rollback-only integration test for purchase receiving idempotency.
-- All supplier, purchase, stock, payment, cash and audit changes are rolled back.

BEGIN;

DO $test$
DECLARE
  v_new_fn regprocedure := 'public.receive_purchase(uuid,uuid,uuid,uuid,jsonb,text,text,date,numeric,text,text,uuid)'::regprocedure;
  v_legacy_fn regprocedure := 'public.receive_purchase(uuid,uuid,uuid,uuid,jsonb,text,text,date,numeric,text,text)'::regprocedure;
  v_business_id uuid;
  v_branch_id uuid;
  v_warehouse_id uuid;
  v_product_id uuid;
  v_user_id uuid;
  v_supplier_id uuid := pg_catalog.gen_random_uuid();
  v_key uuid := 'a31c2e76-8a4f-4aef-9e6f-6b2c9d9a14f0';
  v_items jsonb;
  v_first record;
  v_second record;
  v_legacy record;
  v_legacy_key uuid;
  v_stock_before numeric;
  v_stock_after numeric;
  v_purchase_count bigint;
  v_item_count bigint;
  v_movement_count bigint;
  v_payment_count bigint;
  v_cash_count bigint;
  v_purchase_audit_count bigint;
  v_payable_audit_count bigint;
BEGIN
  IF NOT has_function_privilege('authenticated', v_new_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_new_fn, 'EXECUTE')
     OR has_function_privilege('service_role', v_new_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'Hak akses RPC 12 argumen tidak sesuai.';
  END IF;
  IF NOT has_function_privilege('authenticated', v_legacy_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_legacy_fn, 'EXECUTE')
     OR has_function_privilege('service_role', v_legacy_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'Hak akses RPC kompatibilitas 11 argumen tidak sesuai.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=v_legacy_fn AND p.prosecdef) THEN
    RAISE EXCEPTION 'RPC kompatibilitas harus SECURITY INVOKER.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid=v_new_fn AND p.prosecdef
      AND coalesce(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=""']::text[]
  ) THEN
    RAISE EXCEPTION 'RPC idempoten harus SECURITY DEFINER dengan search_path kosong.';
  END IF;

  SELECT b.id, bm.user_id, br.id, w.id, p.id
    INTO v_business_id, v_user_id, v_branch_id, v_warehouse_id, v_product_id
  FROM public.businesses b
  JOIN public.business_members bm
    ON bm.business_id=b.id AND bm.is_active=true AND bm.role IN ('owner','admin')
  JOIN public.branches br ON br.business_id=b.id AND br.is_active=true
  JOIN public.warehouses w ON w.business_id=b.id AND w.branch_id=br.id AND w.is_active=true
  JOIN public.products p ON p.business_id=b.id AND p.is_active=true
  ORDER BY b.created_at DESC, p.created_at
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tidak ditemukan bisnis, Owner/Admin aktif, cabang, gudang, dan produk aktif untuk pengujian.';
  END IF;

  PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_user_id::text, true);
  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object('sub', v_user_id, 'role', 'authenticated')::text,
    true
  );
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  IF auth.uid() IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'JWT test context tidak terbaca oleh auth.uid().';
  END IF;

  INSERT INTO public.suppliers(id, business_id, name)
  VALUES (v_supplier_id, v_business_id, 'TEST PURCHASE IDEMPOTENCY');

  v_items := pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object('product_id', v_product_id, 'quantity', 1, 'unit_cost', 1000)
  );

  SELECT coalesce((SELECT i.quantity FROM public.inventory i
    WHERE i.business_id=v_business_id AND i.product_id=v_product_id
      AND i.warehouse_id=v_warehouse_id),0) INTO v_stock_before;

  SELECT * INTO v_first FROM public.receive_purchase(
    v_business_id, v_branch_id, v_warehouse_id, v_supplier_id,
    v_items, 'Test retry', 'TEST-IDEMPOTENCY', NULL,
    500, 'Tunai', 'TEST-INITIAL-PAYMENT', v_key
  );
  SELECT * INTO v_second FROM public.receive_purchase(
    v_business_id, v_branch_id, v_warehouse_id, v_supplier_id,
    v_items, 'Test retry', 'TEST-IDEMPOTENCY', NULL,
    500, 'Tunai', 'TEST-INITIAL-PAYMENT', v_key
  );

  IF v_first.purchase_id IS DISTINCT FROM v_second.purchase_id
     OR v_first.purchase_no IS DISTINCT FROM v_second.purchase_no
     OR v_first.total IS DISTINCT FROM v_second.total
     OR v_first.total<>1000 THEN
    RAISE EXCEPTION 'Retry dengan kunci sama tidak mengembalikan pembelian yang sama.';
  END IF;

  SELECT count(*) INTO v_purchase_count FROM public.purchase_orders
  WHERE business_id=v_business_id AND idempotency_key=v_key AND idempotency_payload IS NOT NULL;
  SELECT count(*) INTO v_item_count FROM public.purchase_items
  WHERE business_id=v_business_id AND purchase_id=v_first.purchase_id;
  SELECT count(*) INTO v_movement_count FROM public.stock_movements
  WHERE business_id=v_business_id AND reference_type='purchase' AND reference_id=v_first.purchase_id;
  SELECT count(*) INTO v_payment_count FROM public.supplier_payments
  WHERE business_id=v_business_id AND purchase_id=v_first.purchase_id;
  SELECT count(*) INTO v_cash_count
  FROM public.cash_entries ce JOIN public.supplier_payments sp ON sp.id=ce.reference_id
  WHERE ce.business_id=v_business_id AND ce.reference_type='supplier_payment'
    AND sp.purchase_id=v_first.purchase_id;
  SELECT count(*) INTO v_purchase_audit_count FROM public.audit_logs
  WHERE business_id=v_business_id AND action='purchase.receive'
    AND table_name='purchase_orders' AND record_id=v_first.purchase_id;
  SELECT count(*) INTO v_payable_audit_count FROM public.audit_logs
  WHERE business_id=v_business_id AND action='supplier.payable.created'
    AND table_name='purchase_orders' AND record_id=v_first.purchase_id;
  SELECT coalesce((SELECT i.quantity FROM public.inventory i
    WHERE i.business_id=v_business_id AND i.product_id=v_product_id
      AND i.warehouse_id=v_warehouse_id),0) INTO v_stock_after;

  IF v_purchase_count<>1 OR v_item_count<>1 OR v_movement_count<>1
     OR v_payment_count<>1 OR v_cash_count<>1
     OR v_purchase_audit_count<>1 OR v_payable_audit_count<>1
     OR v_stock_after IS DISTINCT FROM v_stock_before+1 THEN
    RAISE EXCEPTION 'Retry menggandakan pembelian, item, stok, pembayaran, kas, atau audit.';
  END IF;

  BEGIN
    PERFORM * FROM public.receive_purchase(
      v_business_id, v_branch_id, v_warehouse_id, v_supplier_id,
      pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object('product_id',v_product_id,'quantity',2,'unit_cost',1000)
      ),
      'Test retry', 'TEST-IDEMPOTENCY', NULL, 500, 'Tunai', 'TEST-INITIAL-PAYMENT', v_key
    );
    RAISE EXCEPTION 'TEST_FAILED_KEY_REUSE_WITH_DIFFERENT_PAYLOAD_WAS_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM='TEST_FAILED_KEY_REUSE_WITH_DIFFERENT_PAYLOAD_WAS_ACCEPTED' THEN RAISE; END IF;
    IF position('Kunci idempotensi sudah digunakan' IN SQLERRM)=0 THEN RAISE; END IF;
  END;

  -- Existing production clients still call the 11-argument signature.
  SELECT * INTO v_legacy FROM public.receive_purchase(
    v_business_id, v_branch_id, v_warehouse_id, v_supplier_id,
    v_items, 'Legacy compatibility test', 'TEST-LEGACY', NULL, 0, 'Tunai', NULL
  );
  SELECT idempotency_key INTO v_legacy_key FROM public.purchase_orders
  WHERE id=v_legacy.purchase_id AND business_id=v_business_id;
  IF v_legacy.purchase_id IS NULL OR v_legacy.purchase_id=v_first.purchase_id OR v_legacy_key IS NULL THEN
    RAISE EXCEPTION 'RPC kompatibilitas lama tidak berhasil meneruskan pembelian.';
  END IF;

  RAISE NOTICE 'PASS: retry menghasilkan satu pembelian/stok/pembayaran/kas/audit; payload berbeda ditolak; RPC lama tetap kompatibel.';
END;
$test$;

ROLLBACK;
SELECT 'PASS: purchase receipt idempotency integration test rolled back cleanly.' AS result;
