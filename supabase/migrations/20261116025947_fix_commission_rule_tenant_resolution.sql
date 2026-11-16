-- SMART POS JATIBARANG
-- Harden commission-rule tenant resolution.
-- Derive the legacy RPC tenant from its branch/product target and reject
-- ambiguous global writes instead of selecting the oldest membership.

CREATE OR REPLACE FUNCTION public.save_commission_rule_for_business(
  p_business_id uuid,
  p_branch_id uuid,
  p_product_id uuid,
  p_commission_type text,
  p_commission_value numeric,
  p_is_active boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sesi login tidak valid';
  END IF;

  IF p_business_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.businesses b WHERE b.id = p_business_id
  ) THEN
    RAISE EXCEPTION 'Bisnis tidak valid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.business_members bm
    WHERE bm.business_id = p_business_id
      AND bm.user_id = auth.uid()
      AND bm.is_active = true
      AND bm.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Hanya Owner/Admin aktif pada bisnis tujuan yang dapat mengatur komisi';
  END IF;

  IF p_commission_type IS NULL
     OR p_commission_type NOT IN ('percent', 'per_unit', 'none')
     OR p_commission_value IS NULL
     OR p_commission_value < 0
     OR p_commission_value > 100000000 THEN
    RAISE EXCEPTION 'Aturan komisi tidak valid';
  END IF;

  IF p_branch_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.branches b
      WHERE b.id = p_branch_id
        AND b.business_id = p_business_id
        AND b.is_active = true
    ) THEN
      RAISE EXCEPTION 'Cabang tidak valid untuk bisnis tujuan';
    END IF;

    IF NOT private.smartpos_can_access_branch(p_business_id, p_branch_id) THEN
      RAISE EXCEPTION 'Tidak memiliki akses ke cabang tujuan';
    END IF;
  END IF;

  IF p_product_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.products p
    WHERE p.id = p_product_id
      AND p.business_id = p_business_id
      AND p.is_active = true
  ) THEN
    RAISE EXCEPTION 'Produk tidak valid untuk bisnis tujuan';
  END IF;

  INSERT INTO public.commission_rules (
    business_id,
    branch_id,
    product_id,
    commission_type,
    commission_value,
    is_active
  )
  VALUES (
    p_business_id,
    p_branch_id,
    p_product_id,
    p_commission_type,
    p_commission_value,
    COALESCE(p_is_active, true)
  )
  ON CONFLICT (business_id, branch_id, product_id)
  DO UPDATE SET
    commission_type = EXCLUDED.commission_type,
    commission_value = EXCLUDED.commission_value,
    is_active = EXCLUDED.is_active,
    updated_at = now()
  RETURNING id INTO v_id;

  INSERT INTO public.audit_logs (
    business_id,
    user_id,
    action,
    table_name,
    record_id,
    details
  )
  VALUES (
    p_business_id,
    auth.uid(),
    'commission_rule_upsert',
    'commission_rules',
    v_id,
    jsonb_build_object(
      'branch_id', p_branch_id,
      'product_id', p_product_id,
      'commission_type', p_commission_type,
      'commission_value', p_commission_value,
      'is_active', COALESCE(p_is_active, true)
    )
  );

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.save_commission_rule_for_business(uuid, uuid, uuid, text, numeric, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_commission_rule_for_business(uuid, uuid, uuid, text, numeric, boolean)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.save_commission_rule(
  p_branch_id uuid,
  p_product_id uuid,
  p_commission_type text,
  p_commission_value numeric,
  p_is_active boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_business_id uuid;
  v_membership_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sesi login tidak valid';
  END IF;

  IF p_branch_id IS NOT NULL THEN
    SELECT b.business_id
      INTO v_business_id
    FROM public.branches b
    WHERE b.id = p_branch_id
      AND b.is_active = true;

    IF v_business_id IS NULL THEN
      RAISE EXCEPTION 'Cabang tidak valid';
    END IF;
  ELSIF p_product_id IS NOT NULL THEN
    SELECT p.business_id
      INTO v_business_id
    FROM public.products p
    WHERE p.id = p_product_id
      AND p.is_active = true;

    IF v_business_id IS NULL THEN
      RAISE EXCEPTION 'Produk tidak valid';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM public.business_members bm
      WHERE bm.user_id = auth.uid()
        AND bm.is_active = true
        AND bm.role IN ('owner', 'admin')
    ) THEN
      RAISE EXCEPTION 'Hanya Owner/Admin yang dapat mengatur komisi';
    END IF;

    SELECT count(DISTINCT bm.business_id)
      INTO v_membership_count
    FROM public.business_members bm
    WHERE bm.user_id = auth.uid()
      AND bm.is_active = true
      AND bm.role IN ('owner', 'admin');

    IF v_membership_count <> 1 THEN
      RAISE EXCEPTION 'Bisnis tujuan tidak dapat ditentukan. Pilih cabang atau produk agar aturan komisi tidak masuk ke bisnis yang salah.';
    END IF;

    SELECT bm.business_id
      INTO v_business_id
    FROM public.business_members bm
    WHERE bm.user_id = auth.uid()
      AND bm.is_active = true
      AND bm.role IN ('owner', 'admin')
    ORDER BY bm.created_at
    LIMIT 1;
  END IF;

  RETURN public.save_commission_rule_for_business(
    v_business_id,
    p_branch_id,
    p_product_id,
    p_commission_type,
    p_commission_value,
    p_is_active
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.save_commission_rule(uuid, uuid, text, numeric, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_commission_rule(uuid, uuid, text, numeric, boolean)
  TO authenticated;

COMMENT ON FUNCTION public.save_commission_rule_for_business(uuid, uuid, uuid, text, numeric, boolean)
  IS 'Upserts a commission rule only within the explicitly supplied business after Owner/Admin and branch/product validation.';

COMMENT ON FUNCTION public.save_commission_rule(uuid, uuid, text, numeric, boolean)
  IS 'Backward-compatible wrapper; derives the tenant from the branch/product and rejects ambiguous global writes.';
