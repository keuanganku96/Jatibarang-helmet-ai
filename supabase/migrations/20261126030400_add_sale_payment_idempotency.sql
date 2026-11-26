-- Make receivable-payment retries idempotent without changing existing payment rows.
-- Existing rows keep a NULL key; new clients send a UUID persisted locally until a definitive response.

BEGIN;

ALTER TABLE public.sale_payments
  ADD COLUMN IF NOT EXISTS idempotency_key uuid;

CREATE UNIQUE INDEX IF NOT EXISTS sale_payments_business_idempotency_key_uidx
  ON public.sale_payments (business_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.sale_payments.idempotency_key IS
  'Client-generated request UUID used to prevent duplicate receivable payments after network retries.';

CREATE OR REPLACE FUNCTION public.record_sale_payment(
  p_sale_id uuid,
  p_payment_method text,
  p_amount numeric,
  p_payment_reference text,
  p_idempotency_key uuid
)
RETURNS TABLE(
  sale_id uuid,
  invoice_no text,
  total numeric,
  paid_amount numeric,
  balance_due numeric,
  status text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_sale record;
  v_existing record;
  v_paid numeric;
  v_balance numeric;
  v_payment_id uuid;
  v_status text;
  v_reference text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Silakan masuk terlebih dahulu.';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Kunci permintaan pembayaran wajib diisi.';
  END IF;

  IF p_payment_method IS NULL
     OR p_payment_method NOT IN ('Tunai', 'Transfer bank', 'QRIS', 'Debit')
     OR p_amount IS NULL
     OR p_amount <= 0
     OR p_amount <> pg_catalog.trunc(p_amount) THEN
    RAISE EXCEPTION 'Metode atau nominal pembayaran tidak valid.';
  END IF;

  v_reference := nullif(pg_catalog.btrim(p_payment_reference), '');

  SELECT s.id, s.business_id, s.branch_id, s.invoice_no, s.total, s.status
    INTO v_sale
  FROM public.sales s
  WHERE s.id = p_sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice tidak ditemukan.';
  END IF;

  IF NOT private.smartpos_has_business_role(
    v_sale.business_id,
    ARRAY['owner', 'admin', 'manager', 'cashier']::text[]
  ) THEN
    RAISE EXCEPTION 'Akses pembayaran tidak diizinkan.';
  END IF;

  IF NOT private.smartpos_can_access_branch(v_sale.business_id, v_sale.branch_id) THEN
    RAISE EXCEPTION 'Akses ke cabang ini tidak diizinkan.';
  END IF;

  -- Serialize reuse of the same key, including accidental reuse on another invoice.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_sale.business_id::text || ':' || p_idempotency_key::text,
      0
    )
  );

  SELECT sp.id, sp.sale_id, sp.payment_method, sp.amount, sp.payment_reference
    INTO v_existing
  FROM public.sale_payments sp
  WHERE sp.business_id = v_sale.business_id
    AND sp.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.sale_id IS DISTINCT FROM p_sale_id
       OR v_existing.payment_method IS DISTINCT FROM p_payment_method
       OR v_existing.amount IS DISTINCT FROM p_amount
       OR v_existing.payment_reference IS DISTINCT FROM v_reference THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'Kunci idempotensi sudah digunakan dengan data pembayaran berbeda. Periksa riwayat pembayaran sebelum membuat pembayaran baru.';
    END IF;

    SELECT coalesce(sum(sp.amount), 0)::numeric
      INTO v_paid
    FROM public.sale_payments sp
    WHERE sp.sale_id = p_sale_id
      AND sp.business_id = v_sale.business_id
      AND sp.payment_status = 'completed';

    v_balance := greatest(0, v_sale.total - v_paid);
    v_status := v_sale.status;

    RETURN QUERY
      SELECT p_sale_id, v_sale.invoice_no, v_sale.total, v_paid, v_balance, v_status;
    RETURN;
  END IF;

  IF v_sale.status NOT IN ('partial', 'paid') THEN
    RAISE EXCEPTION 'Invoice ini tidak dapat menerima pembayaran.';
  END IF;

  SELECT coalesce(sum(sp.amount), 0)::numeric
    INTO v_paid
  FROM public.sale_payments sp
  WHERE sp.sale_id = p_sale_id
    AND sp.business_id = v_sale.business_id
    AND sp.payment_status = 'completed';

  v_balance := greatest(0, v_sale.total - v_paid);

  IF p_amount > v_balance THEN
    RAISE EXCEPTION 'Pembayaran melebihi sisa piutang sebesar %.', v_balance;
  END IF;

  INSERT INTO public.sale_payments(
    business_id, sale_id, payment_method, amount, payment_reference,
    payment_status, idempotency_key
  )
  VALUES (
    v_sale.business_id, p_sale_id, p_payment_method, p_amount, v_reference,
    'completed', p_idempotency_key
  )
  RETURNING id INTO v_payment_id;

  INSERT INTO public.cash_entries(
    business_id, branch_id, entry_type, category, description, amount,
    reference_type, reference_id, created_by
  )
  VALUES (
    v_sale.business_id,
    v_sale.branch_id,
    'income',
    'Pengembalian piutang',
    'Pembayaran piutang invoice ' || v_sale.invoice_no || ' (' || p_payment_method || ')',
    p_amount,
    'sale_payment',
    v_payment_id,
    auth.uid()
  );

  v_paid := v_paid + p_amount;
  v_balance := greatest(0, v_sale.total - v_paid);
  v_status := CASE WHEN v_balance <= 0 THEN 'paid' ELSE 'partial' END;

  UPDATE public.sales
  SET status = v_status
  WHERE id = p_sale_id
    AND business_id = v_sale.business_id;

  INSERT INTO public.audit_logs(
    business_id, user_id, action, table_name, record_id, details
  )
  VALUES (
    v_sale.business_id,
    auth.uid(),
    'sale.payment_received',
    'sales',
    p_sale_id,
    pg_catalog.jsonb_build_object(
      'invoice_no', v_sale.invoice_no,
      'payment_id', v_payment_id,
      'idempotency_key', p_idempotency_key,
      'payment_amount', p_amount,
      'payment_method', p_payment_method,
      'paid_amount', v_paid,
      'balance_due', v_balance,
      'status', v_status
    )
  );

  RETURN QUERY
    SELECT p_sale_id, v_sale.invoice_no, v_sale.total, v_paid, v_balance, v_status;
END;
$function$;

-- Compatibility for older clients: keep the four-argument RPC, but make it an
-- invoker wrapper. The elevated mutation is performed only by the authenticated
-- five-argument function above.
CREATE OR REPLACE FUNCTION public.record_sale_payment(
  p_sale_id uuid,
  p_payment_method text,
  p_amount numeric,
  p_payment_reference text DEFAULT NULL::text
)
RETURNS TABLE(
  sale_id uuid,
  invoice_no text,
  total numeric,
  paid_amount numeric,
  balance_due numeric,
  status text
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
BEGIN
  RETURN QUERY
    SELECT *
    FROM public.record_sale_payment(
      p_sale_id,
      p_payment_method,
      p_amount,
      p_payment_reference,
      pg_catalog.gen_random_uuid()
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_sale_payment(uuid, text, numeric, text, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_sale_payment(uuid, text, numeric, text, uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.record_sale_payment(uuid, text, numeric, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_sale_payment(uuid, text, numeric, text)
  TO authenticated;

DO $verify$
DECLARE
  v_new_fn regprocedure := 'public.record_sale_payment(uuid,text,numeric,text,uuid)'::regprocedure;
  v_legacy_fn regprocedure := 'public.record_sale_payment(uuid,text,numeric,text)'::regprocedure;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sale_payments'
      AND column_name = 'idempotency_key'
      AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'Kolom idempotency_key belum tersedia.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'sale_payments_business_idempotency_key_uidx'
  ) THEN
    RAISE EXCEPTION 'Unique index idempotensi belum tersedia.';
  END IF;

  IF NOT has_function_privilege('authenticated', v_new_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_new_fn, 'EXECUTE')
     OR has_function_privilege('service_role', v_new_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'Hak akses RPC pembayaran idempoten tidak sesuai.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = v_new_fn
      AND (
        NOT p.prosecdef
        OR NOT (coalesce(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=""']::text[])
      )
  ) THEN
    RAISE EXCEPTION 'Konfigurasi SECURITY DEFINER atau search_path RPC baru tidak sesuai.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = v_legacy_fn
      AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'RPC kompatibilitas lama harus SECURITY INVOKER.';
  END IF;

  IF NOT has_function_privilege('authenticated', v_legacy_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_legacy_fn, 'EXECUTE')
     OR has_function_privilege('service_role', v_legacy_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'Hak akses RPC kompatibilitas tidak sesuai.';
  END IF;
END;
$verify$;

COMMIT;
