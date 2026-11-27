-- Rollback-only integration test for supplier-payment idempotency.
-- A temporary supplier and two purchase orders are created inside this transaction.
-- All test rows and all payment side effects are rolled back at the end.

BEGIN;

DO $test$
DECLARE
  v_fn regprocedure := 'public.record_supplier_payment(uuid,numeric,text,text,text,uuid)'::regprocedure;
  v_legacy_fn regprocedure := 'public.record_supplier_payment(uuid,numeric,text,text,text)'::regprocedure;
  v_business_id uuid;
  v_branch_id uuid;
  v_warehouse_id uuid;
  v_user_id uuid;
  v_supplier_id uuid := pg_catalog.gen_random_uuid();
  v_purchase_id uuid := pg_catalog.gen_random_uuid();
  v_second_purchase_id uuid := pg_catalog.gen_random_uuid();
  v_purchase_no text := 'TEST-SUPPLIER-PAY-' || pg_catalog.substr(pg_catalog.gen_random_uuid()::text, 1, 8);
  v_second_purchase_no text := 'TEST-SUPPLIER-PAY-' || pg_catalog.substr(pg_catalog.gen_random_uuid()::text, 1, 8);
  v_key uuid := '5e3e0a8b-32e6-4f9d-b4a2-0f9a4a2c81c7';
  v_first record;
  v_second record;
  v_legacy record;
  v_payment_count bigint;
  v_cash_count bigint;
  v_audit_count bigint;
BEGIN
  IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'Hak akses RPC enam argumen tidak sesuai.';
  END IF;

  IF NOT has_function_privilege('authenticated', v_legacy_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_legacy_fn, 'EXECUTE')
     OR has_function_privilege('service_role', v_legacy_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'Hak akses RPC kompatibilitas tidak sesuai.';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid = v_legacy_fn AND p.prosecdef) THEN
    RAISE EXCEPTION 'RPC kompatibilitas harus SECURITY INVOKER.';
  END IF;

  SELECT b.id, bm.user_id, br.id, w.id
    INTO v_business_id, v_user_id, v_branch_id, v_warehouse_id
  FROM public.businesses b
  JOIN public.business_members bm
    ON bm.business_id = b.id
   AND bm.is_active = true
   AND bm.role IN ('owner', 'admin')
  JOIN public.branches br
    ON br.business_id = b.id
   AND br.is_active = true
  JOIN public.warehouses w
    ON w.business_id = b.id
   AND w.branch_id = br.id
   AND w.is_active = true
  ORDER BY b.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tidak ditemukan bisnis, Owner/Admin aktif, cabang, dan gudang untuk pengujian.';
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
  VALUES (v_supplier_id, v_business_id, 'TEST SUPPLIER IDEMPOTENCY');

  INSERT INTO public.purchase_orders(
    id, business_id, branch_id, supplier_id, warehouse_id,
    purchase_no, status, total, created_by, amount_paid, payable_tracking_enabled
  )
  VALUES
    (v_purchase_id, v_business_id, v_branch_id, v_supplier_id, v_warehouse_id,
     v_purchase_no, 'received', 2, v_user_id, 0, true),
    (v_second_purchase_id, v_business_id, v_branch_id, v_supplier_id, v_warehouse_id,
     v_second_purchase_no, 'received', 10, v_user_id, 0, true);

  SELECT * INTO v_first
  FROM public.record_supplier_payment(
    v_purchase_id, 1, 'Tunai', 'IDEMPOTENCY-ROLLBACK-TEST',
    'Test retry', v_key
  );

  SELECT * INTO v_second
  FROM public.record_supplier_payment(
    v_purchase_id, 1, 'Tunai', 'IDEMPOTENCY-ROLLBACK-TEST',
    'Test retry', v_key
  );

  IF v_first.payment_id IS DISTINCT FROM v_second.payment_id
     OR v_first.remaining_balance IS DISTINCT FROM v_second.remaining_balance
     OR v_first.remaining_balance <> 1 THEN
    RAISE EXCEPTION 'Retry dengan kunci sama tidak mengembalikan hasil pembayaran yang sama.';
  END IF;

  SELECT count(*) INTO v_payment_count
  FROM public.supplier_payments
  WHERE purchase_id = v_purchase_id
    AND business_id = v_business_id;

  SELECT count(*) INTO v_cash_count
  FROM public.cash_entries
  WHERE reference_type = 'supplier_payment'
    AND reference_id IN (
      SELECT id FROM public.supplier_payments
      WHERE purchase_id = v_purchase_id AND business_id = v_business_id
    );

  SELECT count(*) INTO v_audit_count
  FROM public.audit_logs
  WHERE business_id = v_business_id
    AND action = 'supplier.payment.recorded'
    AND table_name = 'supplier_payments'
    AND record_id IN (
      SELECT id FROM public.supplier_payments
      WHERE purchase_id = v_purchase_id AND business_id = v_business_id
    );

  IF v_payment_count <> 1 OR v_cash_count <> 1 OR v_audit_count <> 1 THEN
    RAISE EXCEPTION 'Retry membuat pembayaran, pengeluaran kas, atau audit log ganda.';
  END IF;

  BEGIN
    PERFORM *
    FROM public.record_supplier_payment(
      v_purchase_id, 1.5, 'Tunai', 'IDEMPOTENCY-ROLLBACK-TEST',
      'Test retry', v_key
    );
    RAISE EXCEPTION 'TEST_FAILED_KEY_REUSE_WITH_DIFFERENT_AMOUNT_WAS_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'TEST_FAILED_KEY_REUSE_WITH_DIFFERENT_AMOUNT_WAS_ACCEPTED' THEN
      RAISE;
    END IF;
    IF pg_catalog.position('Kunci idempotensi sudah digunakan' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM *
    FROM public.record_supplier_payment(
      v_second_purchase_id, 1, 'Tunai', 'IDEMPOTENCY-ROLLBACK-TEST',
      'Test retry', v_key
    );
    RAISE EXCEPTION 'TEST_FAILED_KEY_REUSE_ON_DIFFERENT_PURCHASE_WAS_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'TEST_FAILED_KEY_REUSE_ON_DIFFERENT_PURCHASE_WAS_ACCEPTED' THEN
      RAISE;
    END IF;
    IF pg_catalog.position('Kunci idempotensi sudah digunakan' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;

  SELECT * INTO v_legacy
  FROM public.record_supplier_payment(
    v_second_purchase_id, 1, 'Transfer bank', 'LEGACY-WRAPPER-TEST', 'Legacy compatibility'
  );

  IF v_legacy.remaining_balance <> 9 THEN
    RAISE EXCEPTION 'RPC kompatibilitas lama tidak menghasilkan sisa hutang yang benar.';
  END IF;

  RAISE NOTICE 'PASS: retry satu kunci menghasilkan satu pembayaran/kas/audit; nominal dan invoice berbeda ditolak; wrapper lama tetap berfungsi.';
END;
$test$;

ROLLBACK;
