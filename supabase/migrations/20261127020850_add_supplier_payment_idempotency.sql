-- Make supplier-payable retries idempotent without changing existing payment rows.
-- Existing rows keep a NULL key; new clients persist a UUID until a definitive response.

BEGIN;

ALTER TABLE public.supplier_payments
  ADD COLUMN IF NOT EXISTS idempotency_key uuid;

CREATE UNIQUE INDEX IF NOT EXISTS supplier_payments_business_idempotency_key_uidx
  ON public.supplier_payments (business_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.supplier_payments.idempotency_key IS
  'Client-generated request UUID used to prevent duplicate supplier-payable payments after network retries.';

CREATE OR REPLACE FUNCTION public.record_supplier_payment(
  p_purchase_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_reference_no text,
  p_notes text,
  p_idempotency_key uuid
)
RETURNS TABLE(payment_id uuid, remaining_balance numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_po public.purchase_orders%rowtype;
  v_existing public.supplier_payments%rowtype;
  v_payment_id uuid;
  v_cash_id uuid;
  v_paid numeric;
  v_remaining numeric;
  v_method text;
  v_reference text;
  v_notes text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Silakan masuk terlebih dahulu.';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Kunci permintaan pembayaran wajib diisi.';
  END IF;

  v_method := nullif(pg_catalog.btrim(p_payment_method), '');
  v_reference := nullif(pg_catalog.btrim(p_reference_no), '');
  v_notes := nullif(pg_catalog.btrim(p_notes), '');

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount > 1000000000000 THEN
    RAISE EXCEPTION 'Nominal pembayaran harus lebih dari nol.';
  END IF;

  IF v_method IS NULL OR v_method NOT IN ('Tunai', 'Transfer bank', 'QRIS', 'Debit') THEN
    RAISE EXCEPTION 'Metode pembayaran tidak valid.';
  END IF;

  SELECT po.*
    INTO v_po
  FROM public.purchase_orders po
  WHERE po.id = p_purchase_id
  FOR UPDATE;

  IF NOT FOUND OR v_po.supplier_id IS NULL OR NOT v_po.payable_tracking_enabled THEN
    RAISE EXCEPTION 'Tagihan pemasok tidak ditemukan.';
  END IF;

  IF NOT private.smartpos_has_business_role(
    v_po.business_id,
    ARRAY['owner', 'admin', 'manager']::text[]
  ) THEN
    RAISE EXCEPTION 'Akses pembayaran pemasok tidak diizinkan.';
  END IF;

  IF NOT private.smartpos_can_access_branch(v_po.business_id, v_po.branch_id) THEN
    RAISE EXCEPTION 'Akses ke cabang ini tidak diizinkan.';
  END IF;

  -- Serialize reuse of the same key across invoices in one business.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      v_po.business_id::text || ':' || p_idempotency_key::text,
      0
    )
  );

  SELECT sp.*
    INTO v_existing
  FROM public.supplier_payments sp
  WHERE sp.business_id = v_po.business_id
    AND sp.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.purchase_id IS DISTINCT FROM p_purchase_id
       OR v_existing.amount IS DISTINCT FROM p_amount
       OR v_existing.payment_method IS DISTINCT FROM v_method
       OR v_existing.reference_no IS DISTINCT FROM v_reference
       OR v_existing.notes IS DISTINCT FROM v_notes THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'Kunci idempotensi sudah digunakan dengan data pembayaran berbeda. Periksa riwayat pembayaran sebelum membuat pembayaran baru.';
    END IF;

    SELECT coalesce(sum(sp.amount), 0)::numeric
      INTO v_paid
    FROM public.supplier_payments sp
    WHERE sp.purchase_id = p_purchase_id
      AND sp.business_id = v_po.business_id;

    v_remaining := greatest(0, v_po.total - v_paid);

    RETURN QUERY SELECT v_existing.id, v_remaining;
    RETURN;
  END IF;

  IF v_po.status <> 'received' THEN
    RAISE EXCEPTION 'Hanya pembelian yang sudah diterima dapat dibayar.';
  END IF;

  SELECT coalesce(sum(sp.amount), 0)::numeric
    INTO v_paid
  FROM public.supplier_payments sp
  WHERE sp.purchase_id = p_purchase_id
    AND sp.business_id = v_po.business_id;

  v_remaining := greatest(0, v_po.total - v_paid);

  IF p_amount > v_remaining THEN
    RAISE EXCEPTION 'Pembayaran melebihi sisa hutang: %',
      to_char(v_remaining, 'FM999G999G999G990D00');
  END IF;

  INSERT INTO public.supplier_payments(
    business_id,
    branch_id,
    purchase_id,
    supplier_id,
    amount,
    payment_method,
    reference_no,
    notes,
    created_by,
    idempotency_key
  )
  VALUES (
    v_po.business_id,
    v_po.branch_id,
    v_po.id,
    v_po.supplier_id,
    p_amount,
    v_method,
    v_reference,
    v_notes,
    auth.uid(),
    p_idempotency_key
  )
  RETURNING id INTO v_payment_id;

  INSERT INTO public.cash_entries(
    business_id,
    branch_id,
    entry_type,
    category,
    description,
    amount,
    reference_type,
    reference_id,
    created_by
  )
  VALUES (
    v_po.business_id,
    v_po.branch_id,
    'expense',
    'Pembayaran Supplier',
    'Pembayaran hutang pembelian ' || v_po.purchase_no,
    p_amount,
    'supplier_payment',
    v_payment_id,
    auth.uid()
  )
  RETURNING id INTO v_cash_id;

  UPDATE public.supplier_payments
  SET cash_entry_id = v_cash_id
  WHERE id = v_payment_id
    AND business_id = v_po.business_id;

  UPDATE public.purchase_orders
  SET amount_paid = v_paid + p_amount
  WHERE id = v_po.id
    AND business_id = v_po.business_id;

  INSERT INTO public.audit_logs(
    business_id,
    user_id,
    action,
    table_name,
    record_id,
    details
  )
  VALUES (
    v_po.business_id,
    auth.uid(),
    'supplier.payment.recorded',
    'supplier_payments',
    v_payment_id,
    pg_catalog.jsonb_build_object(
      'purchase_id', v_po.id,
      'amount', p_amount,
      'payment_method', v_method,
      'idempotency_key', p_idempotency_key,
      'remaining_balance', v_remaining - p_amount
    )
  );

  RETURN QUERY SELECT v_payment_id, v_remaining - p_amount;
END;
$function$;

-- Compatibility for older clients. The elevated mutation remains in the
-- authenticated six-argument RPC; this wrapper uses a fresh key per legacy call.
CREATE OR REPLACE FUNCTION public.record_supplier_payment(
  p_purchase_id uuid,
  p_amount numeric,
  p_payment_method text DEFAULT 'Tunai'::text,
  p_reference_no text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text
)
RETURNS TABLE(payment_id uuid, remaining_balance numeric)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
BEGIN
  RETURN QUERY
    SELECT *
    FROM public.record_supplier_payment(
      p_purchase_id,
      p_amount,
      p_payment_method,
      p_reference_no,
      p_notes,
      pg_catalog.gen_random_uuid()
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_supplier_payment(uuid, numeric, text, text, text, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_supplier_payment(uuid, numeric, text, text, text, uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION public.record_supplier_payment(uuid, numeric, text, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_supplier_payment(uuid, numeric, text, text, text)
  TO authenticated;

DO $verify$
DECLARE
  v_new_fn regprocedure := 'public.record_supplier_payment(uuid,numeric,text,text,text,uuid)'::regprocedure;
  v_legacy_fn regprocedure := 'public.record_supplier_payment(uuid,numeric,text,text,text)'::regprocedure;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'supplier_payments'
      AND column_name = 'idempotency_key'
      AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'Kolom idempotency_key belum tersedia.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'supplier_payments_business_idempotency_key_uidx'
  ) THEN
    RAISE EXCEPTION 'Unique index idempotensi belum tersedia.';
  END IF;

  IF NOT has_function_privilege('authenticated', v_new_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_new_fn, 'EXECUTE')
     OR has_function_privilege('service_role', v_new_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'Hak akses RPC pembayaran pemasok idempoten tidak sesuai.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    WHERE p.oid = v_new_fn
      AND (
        NOT p.prosecdef
        OR NOT (coalesce(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=""']::text[])
      )
  ) THEN
    RAISE EXCEPTION 'Konfigurasi SECURITY DEFINER atau search_path RPC baru tidak sesuai.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
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
