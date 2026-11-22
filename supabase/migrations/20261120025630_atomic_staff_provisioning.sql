-- Atomically persist the database side of staff provisioning.
-- Auth user creation remains an Auth Admin API operation in the Edge Function.
-- This function is deliberately callable only by service_role.
CREATE OR REPLACE FUNCTION public.create_staff_records_from_edge(
  p_business_id uuid,
  p_branch_id uuid,
  p_user_id uuid,
  p_employee_code text,
  p_full_name text,
  p_phone text,
  p_job_title text,
  p_role text,
  p_commission_type text,
  p_commission_value numeric,
  p_pin_hash text,
  p_created_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
DECLARE
  v_profile_id uuid := pg_catalog.gen_random_uuid();
  v_employee_code text := upper(trim(coalesce(p_employee_code, '')));
  v_full_name text := trim(coalesce(p_full_name, ''));
  v_commission_type text := coalesce(p_commission_type, 'none');
  v_commission_value numeric := coalesce(p_commission_value, 0);
BEGIN
  IF p_business_id IS NULL OR p_branch_id IS NULL
     OR p_user_id IS NULL OR p_created_by IS NULL THEN
    RAISE EXCEPTION 'Identitas bisnis, cabang, akun, dan pembuat wajib diisi';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.business_members bm
    WHERE bm.business_id = p_business_id
      AND bm.user_id = p_created_by
      AND bm.is_active = true
      AND bm.role IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Hanya Owner/Admin aktif yang dapat membuat karyawan';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.branches b
    WHERE b.id = p_branch_id
      AND b.business_id = p_business_id
      AND b.is_active = true
  ) THEN
    RAISE EXCEPTION 'Cabang tidak ditemukan atau tidak aktif pada bisnis tujuan';
  END IF;

  IF p_role IS NULL OR p_role NOT IN ('cashier', 'staff', 'manager') THEN
    RAISE EXCEPTION 'Peran karyawan tidak valid';
  END IF;

  IF v_employee_code !~ '^[A-Z0-9_-]{2,32}$' THEN
    RAISE EXCEPTION 'Kode karyawan tidak valid';
  END IF;

  IF length(v_full_name) < 2 OR length(v_full_name) > 120 THEN
    RAISE EXCEPTION 'Nama karyawan wajib diisi (2–120 karakter)';
  END IF;

  IF v_commission_type NOT IN ('percent', 'per_unit', 'none')
     OR v_commission_value < 0
     OR v_commission_value > 100000000 THEN
    RAISE EXCEPTION 'Pengaturan komisi karyawan tidak valid';
  END IF;

  IF p_pin_hash IS NULL
     OR p_pin_hash !~ '^pbkdf2-sha256\$310000\$[A-Za-z0-9+/]+={0,2}\$[A-Za-z0-9+/]+={0,2}$' THEN
    RAISE EXCEPTION 'Hash PIN tidak valid atau tidak menggunakan format PBKDF2 yang diharapkan';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_user_id) THEN
    RAISE EXCEPTION 'Akun Auth karyawan tidak ditemukan';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.business_members bm
    WHERE bm.business_id = p_business_id AND bm.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Akun sudah terdaftar pada bisnis ini';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.staff_profiles sp
    WHERE sp.business_id = p_business_id AND sp.employee_code = v_employee_code
  ) THEN
    RAISE EXCEPTION 'Kode karyawan sudah digunakan pada bisnis ini';
  END IF;

  -- These writes and both audit records commit or roll back together.
  INSERT INTO public.business_members (
    business_id, user_id, branch_id, role, is_active
  )
  VALUES (
    p_business_id, p_user_id, p_branch_id, p_role, true
  );

  INSERT INTO public.staff_profiles (
    id, business_id, user_id, branch_id, employee_code, full_name,
    phone, job_title, commission_type, commission_value
  )
  VALUES (
    v_profile_id, p_business_id, p_user_id, p_branch_id, v_employee_code, v_full_name,
    nullif(left(trim(coalesce(p_phone, '')), 30), ''),
    nullif(left(trim(coalesce(p_job_title, '')), 80), ''),
    v_commission_type, v_commission_value
  );

  INSERT INTO public.staff_pin_credentials (
    staff_profile_id, business_id, pin_hash
  )
  VALUES (
    v_profile_id, p_business_id, p_pin_hash
  );

  INSERT INTO public.staff_pin_audit (
    business_id, staff_profile_id, event_type, details
  )
  VALUES (
    p_business_id, v_profile_id, 'created',
    jsonb_build_object(
      'created_by', p_created_by,
      'employee_code', v_employee_code,
      'branch_id', p_branch_id
    )
  );

  INSERT INTO public.audit_logs (
    business_id, user_id, action, table_name, record_id, details
  )
  VALUES (
    p_business_id, p_created_by, 'staff_created',
    'staff_profiles', v_profile_id,
    jsonb_build_object(
      'target_user_id', p_user_id,
      'employee_code', v_employee_code,
      'branch_id', p_branch_id,
      'role', p_role
    )
  );

  RETURN v_profile_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_staff_records_from_edge(
  uuid, uuid, uuid, text, text, text, text, text, text, numeric, text, uuid
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_staff_records_from_edge(
  uuid, uuid, uuid, text, text, text, text, text, text, numeric, text, uuid
) TO service_role;
