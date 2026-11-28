-- Prevent duplicate purchase receiving and initial supplier payments on network retries.
-- Existing purchase rows remain unchanged; legacy 11-argument clients stay compatible.

BEGIN;

ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS idempotency_key uuid,
  ADD COLUMN IF NOT EXISTS idempotency_payload jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS purchase_orders_business_idempotency_key_uidx
  ON public.purchase_orders (business_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.purchase_orders.idempotency_key IS
  'Client-generated UUID used to prevent duplicate purchase receiving after network retries.';
COMMENT ON COLUMN public.purchase_orders.idempotency_payload IS
  'Normalized request snapshot used only to verify that an idempotent retry matches the original purchase receiving request.';

CREATE OR REPLACE FUNCTION public.receive_purchase(
  p_business_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_supplier_id uuid,
  p_items jsonb, p_notes text, p_supplier_invoice_no text, p_due_date date,
  p_initial_payment numeric, p_payment_method text, p_payment_reference text,
  p_idempotency_key uuid
)
RETURNS TABLE(purchase_id uuid, purchase_no text, total numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_existing public.purchase_orders%rowtype;
  v_purchase_id uuid;
  v_purchase_no text;
  v_total numeric;
  v_payment_id uuid;
  v_cash_id uuid;
  v_payload jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Silakan masuk terlebih dahulu.';
  END IF;
  IF p_business_id IS NULL OR NOT private.smartpos_has_business_role(
    p_business_id, ARRAY['owner', 'admin', 'manager']::text[]
  ) THEN
    RAISE EXCEPTION 'Hanya Owner, Admin, atau Manager yang dapat mencatat pembelian.';
  END IF;
  IF p_branch_id IS NULL OR NOT private.smartpos_can_access_branch(p_business_id, p_branch_id) THEN
    RAISE EXCEPTION 'Akses ke cabang ini tidak diizinkan.';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Kunci permintaan penerimaan pembelian wajib diisi.';
  END IF;
  IF p_items IS NULL OR pg_catalog.jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Daftar barang pembelian masih kosong atau tidak valid.';
  END IF;
  IF p_initial_payment IS NULL OR p_initial_payment < 0 OR p_initial_payment > 1000000000000 THEN
    RAISE EXCEPTION 'Pembayaran awal tidak valid.';
  END IF;
  IF nullif(pg_catalog.btrim(coalesce(p_supplier_invoice_no, '')), '') IS NOT NULL
     AND pg_catalog.length(pg_catalog.btrim(p_supplier_invoice_no)) > 100 THEN
    RAISE EXCEPTION 'Nomor invoice supplier maksimal 100 karakter.';
  END IF;
  IF p_due_date IS NOT NULL AND p_due_date < current_date THEN
    RAISE EXCEPTION 'Tanggal jatuh tempo tidak boleh sebelum hari ini.';
  END IF;
  IF p_initial_payment > 0 AND p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'Pilih pemasok untuk mencatat pembayaran pembelian.';
  END IF;
  IF coalesce(pg_catalog.btrim(p_payment_method), '') NOT IN ('Tunai', 'Transfer bank', 'QRIS', 'Debit') THEN
    RAISE EXCEPTION 'Metode pembayaran tidak valid.';
  END IF;

  v_payload := pg_catalog.jsonb_build_object(
    'branch_id', p_branch_id,
    'warehouse_id', p_warehouse_id,
    'supplier_id', p_supplier_id,
    'items', p_items,
    'notes', nullif(pg_catalog.btrim(coalesce(p_notes, '')), ''),
    'supplier_invoice_no', nullif(pg_catalog.btrim(coalesce(p_supplier_invoice_no, '')), ''),
    'due_date', p_due_date,
    'initial_payment', p_initial_payment,
    'payment_method', pg_catalog.btrim(p_payment_method),
    'payment_reference', nullif(pg_catalog.btrim(coalesce(p_payment_reference, '')), '')
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_business_id::text || ':' || p_idempotency_key::text, 0)
  );

  SELECT po.* INTO v_existing
  FROM public.purchase_orders po
  WHERE po.business_id = p_business_id AND po.idempotency_key = p_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.idempotency_payload IS DISTINCT FROM v_payload THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'Kunci idempotensi sudah digunakan dengan data penerimaan berbeda. Periksa riwayat pembelian sebelum mengirim permintaan baru.';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.purchase_no, v_existing.total;
    RETURN;
  END IF;

  SELECT x.purchase_id, x.purchase_no, x.total
    INTO v_purchase_id, v_purchase_no, v_total
  FROM private.smartpos_receive_purchase_impl(
    p_business_id, p_branch_id, p_warehouse_id, p_supplier_id, p_items, p_notes
  ) AS x;

  IF p_initial_payment > v_total THEN
    RAISE EXCEPTION 'Pembayaran awal melebihi total pembelian.';
  END IF;

  UPDATE public.purchase_orders
  SET supplier_invoice_no = nullif(pg_catalog.btrim(coalesce(p_supplier_invoice_no, '')), ''),
      due_date = p_due_date,
      payable_tracking_enabled = (p_supplier_id IS NOT NULL),
      idempotency_key = p_idempotency_key,
      idempotency_payload = v_payload
  WHERE id = v_purchase_id AND business_id = p_business_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pembelian yang baru dibuat tidak dapat diverifikasi.';
  END IF;

  IF p_initial_payment > 0 THEN
    INSERT INTO public.supplier_payments(
      business_id, branch_id, purchase_id, supplier_id, amount,
      payment_method, reference_no, notes, created_by
    )
    VALUES (
      p_business_id, p_branch_id, v_purchase_id, p_supplier_id, p_initial_payment,
      pg_catalog.btrim(p_payment_method),
      nullif(pg_catalog.btrim(coalesce(p_payment_reference, '')), ''),
      'Pembayaran awal pembelian', auth.uid()
    )
    RETURNING id INTO v_payment_id;

    INSERT INTO public.cash_entries(
      business_id, branch_id, entry_type, category, description,
      amount, reference_type, reference_id, created_by
    )
    VALUES (
      p_business_id, p_branch_id, 'expense', 'Pembayaran Supplier',
      'Pembayaran awal pembelian ' || v_purchase_no, p_initial_payment,
      'supplier_payment', v_payment_id, auth.uid()
    )
    RETURNING id INTO v_cash_id;

    UPDATE public.supplier_payments
    SET cash_entry_id = v_cash_id
    WHERE id = v_payment_id AND business_id = p_business_id;

    UPDATE public.purchase_orders
    SET amount_paid = p_initial_payment
    WHERE id = v_purchase_id AND business_id = p_business_id;
  END IF;

  INSERT INTO public.audit_logs(
    business_id, user_id, action, table_name, record_id, details
  )
  VALUES (
    p_business_id, auth.uid(), 'supplier.payable.created', 'purchase_orders', v_purchase_id,
    pg_catalog.jsonb_build_object(
      'supplier_id', p_supplier_id,
      'invoice_no', nullif(pg_catalog.btrim(coalesce(p_supplier_invoice_no, '')), ''),
      'due_date', p_due_date,
      'total', v_total,
      'initial_payment', p_initial_payment,
      'idempotency_key', p_idempotency_key
    )
  );

  RETURN QUERY SELECT v_purchase_id, v_purchase_no, v_total;
END;
$function$;

-- Preserve the old RPC signature for the production client until it is updated.
CREATE OR REPLACE FUNCTION public.receive_purchase(
  p_business_id uuid, p_branch_id uuid, p_warehouse_id uuid, p_supplier_id uuid,
  p_items jsonb, p_notes text DEFAULT NULL::text,
  p_supplier_invoice_no text DEFAULT NULL::text, p_due_date date DEFAULT NULL::date,
  p_initial_payment numeric DEFAULT 0, p_payment_method text DEFAULT 'Tunai'::text,
  p_payment_reference text DEFAULT NULL::text
)
RETURNS TABLE(purchase_id uuid, purchase_no text, total numeric)
LANGUAGE plpgsql SECURITY INVOKER SET search_path TO ''
AS $function$
BEGIN
  RETURN QUERY
  SELECT * FROM public.receive_purchase(
    p_business_id, p_branch_id, p_warehouse_id, p_supplier_id, p_items, p_notes,
    p_supplier_invoice_no, p_due_date, p_initial_payment, p_payment_method,
    p_payment_reference, pg_catalog.gen_random_uuid()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.receive_purchase(uuid, uuid, uuid, uuid, jsonb, text, text, date, numeric, text, text, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.receive_purchase(uuid, uuid, uuid, uuid, jsonb, text, text, date, numeric, text, text, uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION public.receive_purchase(uuid, uuid, uuid, uuid, jsonb, text, text, date, numeric, text, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.receive_purchase(uuid, uuid, uuid, uuid, jsonb, text, text, date, numeric, text, text)
  TO authenticated;

DO $verify$
DECLARE
  v_new_fn regprocedure := 'public.receive_purchase(uuid,uuid,uuid,uuid,jsonb,text,text,date,numeric,text,text,uuid)'::regprocedure;
  v_legacy_fn regprocedure := 'public.receive_purchase(uuid,uuid,uuid,uuid,jsonb,text,text,date,numeric,text,text)'::regprocedure;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='purchase_orders'
      AND column_name='idempotency_key' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='purchase_orders'
      AND column_name='idempotency_payload' AND data_type='jsonb'
  ) THEN
    RAISE EXCEPTION 'Kolom idempotensi penerimaan pembelian belum tersedia.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname='public' AND indexname='purchase_orders_business_idempotency_key_uidx'
  ) THEN
    RAISE EXCEPTION 'Unique index idempotensi penerimaan pembelian belum tersedia.';
  END IF;
  IF NOT has_function_privilege('authenticated', v_new_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_new_fn, 'EXECUTE')
     OR has_function_privilege('service_role', v_new_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'Hak akses RPC penerimaan pembelian baru tidak sesuai.';
  END IF;
  IF NOT has_function_privilege('authenticated', v_legacy_fn, 'EXECUTE')
     OR has_function_privilege('anon', v_legacy_fn, 'EXECUTE')
     OR has_function_privilege('service_role', v_legacy_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'Hak akses RPC kompatibilitas penerimaan pembelian tidak sesuai.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid=v_new_fn
      AND (NOT p.prosecdef OR NOT (coalesce(p.proconfig, ARRAY[]::text[]) @> ARRAY['search_path=""']::text[]))
  ) THEN
    RAISE EXCEPTION 'Konfigurasi SECURITY DEFINER atau search_path RPC baru tidak sesuai.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.oid=v_legacy_fn AND p.prosecdef) THEN
    RAISE EXCEPTION 'RPC kompatibilitas lama harus SECURITY INVOKER.';
  END IF;
END;
$verify$;

COMMIT;
