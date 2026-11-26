-- End-to-end rollback test for receivable payment idempotency.
-- This temporarily adjusts one existing paid invoice inside a transaction,
-- exercises the RPC twice, then always rolls every test change back.

BEGIN;

DO $test$
DECLARE
  v_fn regprocedure := 'public.record_sale_payment(uuid,text,numeric,text,uuid)'::regprocedure;
  v_legacy_fn regprocedure := 'public.record_sale_payment(uuid,text,numeric,text)'::regprocedure;
  v_sale_id uuid;
  v_business_id uuid;
  v_user_id uuid;
  v_paid_before numeric;
  v_payment_count_before bigint;
  v_cash_count_before bigint;
  v_audit_count_before bigint;
  v_payment_count_after bigint;
  v_cash_count_after bigint;
  v_audit_count_after bigint;
  v_first record;
  v_second record;
  v_key uuid := '8f1d9e54-5c35-4f2e-9b62-2d9f9b2e7a31';
BEGIN
  IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_fn, 'EXECUTE')
     OR has_function_privilege('service_role', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'Hak akses RPC lima argumen tidak sesuai.';
  END IF;

  IF NOT has_function_privilege('authenticated', v_legacy_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_legacy_fn, 'EXECUTE')
     OR has_function_privilege('service_role', v_legacy_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'Hak akses RPC kompatibilitas tidak sesuai.';
  END IF;

  SELECT s.id, s.business_id, bm.user_id
    INTO v_sale_id, v_business_id, v_user_id
  FROM public.sales s
  JOIN public.business_members bm
    ON bm.business_id = s.business_id
   AND bm.is_active = true
   AND bm.role IN ('owner', 'admin')
  WHERE s.status = 'paid'
  ORDER BY s.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tidak ditemukan invoice lunas untuk uji rollback.';
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

  SELECT coalesce(sum(sp.amount), 0)::numeric
    INTO v_paid_before
  FROM public.sale_payments sp
  WHERE sp.sale_id = v_sale_id
    AND sp.business_id = v_business_id
    AND sp.payment_status = 'completed';

  SELECT count(*) INTO v_payment_count_before
  FROM public.sale_payments sp
  WHERE sp.sale_id = v_sale_id
    AND sp.business_id = v_business_id;

  SELECT count(*) INTO v_cash_count_before
  FROM public.cash_entries ce
  WHERE ce.reference_type = 'sale_payment'
    AND ce.reference_id IN (
      SELECT sp.id FROM public.sale_payments sp
      WHERE sp.sale_id = v_sale_id AND sp.business_id = v_business_id
    );

  SELECT count(*) INTO v_audit_count_before
  FROM public.audit_logs al
  WHERE al.business_id = v_business_id
    AND al.action = 'sale.payment_received'
    AND al.table_name = 'sales'
    AND al.record_id = v_sale_id;

  -- Make a temporary one-rupiah receivable. The outer transaction rolls this back.
  UPDATE public.sales
  SET total = v_paid_before + 2, status = 'partial'
  WHERE id = v_sale_id
    AND business_id = v_business_id;

  SELECT * INTO v_first
  FROM public.record_sale_payment(
    v_sale_id, 'Tunai', 1, 'IDEMPOTENCY-ROLLBACK-TEST', v_key
  );

  SELECT * INTO v_second
  FROM public.record_sale_payment(
    v_sale_id, 'Tunai', 1, 'IDEMPOTENCY-ROLLBACK-TEST', v_key
  );

  IF v_first.paid_amount IS DISTINCT FROM v_second.paid_amount
     OR v_first.balance_due IS DISTINCT FROM v_second.balance_due
     OR v_first.balance_due <> 1 THEN
    RAISE EXCEPTION 'Retry dengan kunci sama tidak mengembalikan hasil pembayaran yang sama.';
  END IF;

  SELECT count(*) INTO v_payment_count_after
  FROM public.sale_payments sp
  WHERE sp.sale_id = v_sale_id
    AND sp.business_id = v_business_id;

  SELECT count(*) INTO v_cash_count_after
  FROM public.cash_entries ce
  WHERE ce.reference_type = 'sale_payment'
    AND ce.reference_id IN (
      SELECT sp.id FROM public.sale_payments sp
      WHERE sp.sale_id = v_sale_id AND sp.business_id = v_business_id
    );

  SELECT count(*) INTO v_audit_count_after
  FROM public.audit_logs al
  WHERE al.business_id = v_business_id
    AND al.action = 'sale.payment_received'
    AND al.table_name = 'sales'
    AND al.record_id = v_sale_id;

  IF v_payment_count_after <> v_payment_count_before + 1
     OR v_cash_count_after <> v_cash_count_before + 1
     OR v_audit_count_after <> v_audit_count_before + 1 THEN
    RAISE EXCEPTION 'Retry membuat pembayaran, kas, atau audit ganda.';
  END IF;

  BEGIN
    SELECT * INTO v_second
    FROM public.record_sale_payment(
      v_sale_id, 'Tunai', 2, 'IDEMPOTENCY-ROLLBACK-TEST', v_key
    );
    RAISE EXCEPTION 'TEST_FAILED_KEY_REUSE_WITH_DIFFERENT_PAYLOAD_WAS_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'TEST_FAILED_KEY_REUSE_WITH_DIFFERENT_PAYLOAD_WAS_ACCEPTED' THEN
      RAISE;
    END IF;
    IF position('Kunci idempotensi sudah digunakan' IN SQLERRM) = 0 THEN
      RAISE;
    END IF;
  END;

  RAISE NOTICE 'PASS: retry hanya menghasilkan satu pembayaran, satu kas masuk, satu audit; payload berbeda ditolak.';
END;
$test$;

ROLLBACK;
