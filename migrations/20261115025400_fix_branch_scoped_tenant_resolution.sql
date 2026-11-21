-- SMART POS JATIBARANG
-- Resolve the tenant from the requested branch instead of choosing the user's
-- oldest active business membership. This prevents ambiguous cross-tenant
-- context for branch-scoped operations while preserving the existing RPC API.

CREATE OR REPLACE FUNCTION public.create_stock_opname(
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_items jsonb,
  p_notes text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_business_id uuid;
  v_opname_id uuid;
  v_no text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Sesi login tidak valid';
  END IF;
  IF p_branch_id IS NULL OR p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'Cabang dan gudang wajib dipilih';
  END IF;
  SELECT b.business_id INTO v_business_id
  FROM public.branches b
  WHERE b.id = p_branch_id AND b.is_active = true;
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Cabang tidak ditemukan atau tidak aktif';
  END IF;
  IF NOT private.smartpos_can_access_branch(v_business_id, p_branch_id) THEN
    RAISE EXCEPTION 'Tidak memiliki akses ke cabang ini';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.warehouses w
    WHERE w.id = p_warehouse_id
      AND w.business_id = v_business_id
      AND w.branch_id = p_branch_id
      AND w.is_active = true
  ) THEN
    RAISE EXCEPTION 'Gudang tidak valid untuk cabang yang dipilih';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Daftar produk opname tidak valid';
  END IF;
  IF jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 1000 THEN
    RAISE EXCEPTION 'Jumlah baris opname harus antara 1 dan 1000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT (x->>'product_id')::uuid AS product_id
      FROM jsonb_array_elements(p_items) x
    ) q
    GROUP BY product_id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Produk duplikat dalam opname';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) x
    WHERE COALESCE((x->>'counted_quantity')::numeric, -1) < 0
  ) THEN
    RAISE EXCEPTION 'Jumlah fisik tidak boleh negatif';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) x
    LEFT JOIN public.products p
      ON p.id = (x->>'product_id')::uuid
     AND p.business_id = v_business_id
     AND p.is_active = true
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Ada produk yang tidak valid';
  END IF;
  v_no := 'SO-' ||
    to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD-HH24MISS') ||
    '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));
  INSERT INTO public.stock_opnames (
    business_id, branch_id, warehouse_id, opname_no, notes, created_by, total_lines
  )
  VALUES (
    v_business_id, p_branch_id, p_warehouse_id, v_no,
    nullif(left(coalesce(p_notes, ''), 1000), ''),
    auth.uid(), jsonb_array_length(p_items)
  )
  RETURNING id INTO v_opname_id;
  INSERT INTO public.stock_opname_items (
    opname_id, business_id, product_id, system_quantity, counted_quantity, difference
  )
  SELECT v_opname_id, v_business_id, p.id, coalesce(i.quantity, 0),
    (x->>'counted_quantity')::numeric,
    (x->>'counted_quantity')::numeric - coalesce(i.quantity, 0)
  FROM jsonb_array_elements(p_items) x
  JOIN public.products p
    ON p.id = (x->>'product_id')::uuid AND p.business_id = v_business_id
  LEFT JOIN public.inventory i
    ON i.business_id = v_business_id
   AND i.product_id = p.id
   AND i.warehouse_id = p_warehouse_id;
  UPDATE public.stock_opnames o
  SET total_difference = (
    SELECT coalesce(sum(abs(difference)), 0)
    FROM public.stock_opname_items i WHERE i.opname_id = o.id
  )
  WHERE o.id = v_opname_id;
  INSERT INTO public.audit_logs (
    business_id, user_id, action, table_name, record_id, details
  )
  VALUES (
    v_business_id, auth.uid(), 'stock_opname_created',
    'stock_opnames', v_opname_id,
    jsonb_build_object('branch_id', p_branch_id, 'warehouse_id', p_warehouse_id,
      'lines', jsonb_array_length(p_items))
  );
  RETURN v_opname_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.open_cash_register(
  p_branch_id uuid, p_opening_float numeric, p_note text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_business_id uuid;
  v_session_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sesi login tidak valid'; END IF;
  IF p_branch_id IS NULL THEN RAISE EXCEPTION 'Cabang wajib dipilih'; END IF;
  IF p_opening_float IS NULL OR p_opening_float < 0 THEN
    RAISE EXCEPTION 'Modal awal kas tidak valid';
  END IF;
  SELECT b.business_id INTO v_business_id
  FROM public.branches b
  WHERE b.id = p_branch_id AND b.is_active = true;
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Cabang tidak ditemukan atau tidak aktif';
  END IF;
  IF NOT private.smartpos_can_access_branch(v_business_id, p_branch_id) THEN
    RAISE EXCEPTION 'Tidak memiliki akses ke cabang ini';
  END IF;
  INSERT INTO public.cash_register_sessions (
    business_id, branch_id, cashier_id, opening_float, opening_note
  )
  VALUES (
    v_business_id, p_branch_id, auth.uid(), p_opening_float,
    nullif(left(coalesce(p_note, ''), 500), '')
  )
  RETURNING id INTO v_session_id;
  INSERT INTO public.audit_logs (
    business_id, user_id, action, table_name, record_id, details
  )
  VALUES (
    v_business_id, auth.uid(), 'cash_register_open',
    'cash_register_sessions', v_session_id,
    jsonb_build_object('branch_id', p_branch_id, 'opening_float', p_opening_float)
  );
  RETURN v_session_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'Masih ada shift kasir yang terbuka. Tutup shift sebelumnya terlebih dahulu.';
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_staff_attendance(
  p_branch_id uuid, p_action text, p_note text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_business_id uuid;
  v_attendance_id uuid;
  v_today date := (now() AT TIME ZONE 'Asia/Jakarta')::date;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sesi login tidak valid'; END IF;
  IF p_action NOT IN ('clock_in', 'clock_out') THEN
    RAISE EXCEPTION 'Aksi absensi tidak valid';
  END IF;
  IF p_branch_id IS NULL THEN RAISE EXCEPTION 'Cabang wajib dipilih'; END IF;
  SELECT b.business_id INTO v_business_id
  FROM public.branches b
  WHERE b.id = p_branch_id AND b.is_active = true;
  IF v_business_id IS NULL THEN
    RAISE EXCEPTION 'Cabang tidak ditemukan atau tidak aktif';
  END IF;
  IF NOT private.smartpos_can_access_branch(v_business_id, p_branch_id) THEN
    RAISE EXCEPTION 'Tidak memiliki akses ke cabang ini';
  END IF;
  IF p_action = 'clock_in' THEN
    INSERT INTO public.staff_attendance (
      business_id, branch_id, user_id, work_date, clock_in_note
    )
    VALUES (
      v_business_id, p_branch_id, auth.uid(), v_today,
      nullif(left(coalesce(p_note, ''), 500), '')
    )
    ON CONFLICT (business_id, branch_id, user_id, work_date)
    DO UPDATE SET
      clock_in_note = coalesce(excluded.clock_in_note, public.staff_attendance.clock_in_note)
    WHERE public.staff_attendance.clock_out_at IS NULL
    RETURNING id INTO v_attendance_id;
    IF v_attendance_id IS NULL THEN
      RAISE EXCEPTION 'Absensi hari ini sudah ditutup';
    END IF;
  ELSE
    UPDATE public.staff_attendance
    SET clock_out_at = now(),
        clock_out_note = nullif(left(coalesce(p_note, ''), 500), ''),
        updated_at = now()
    WHERE business_id = v_business_id
      AND branch_id = p_branch_id
      AND user_id = auth.uid()
      AND work_date = v_today
      AND clock_out_at IS NULL
    RETURNING id INTO v_attendance_id;
    IF v_attendance_id IS NULL THEN
      RAISE EXCEPTION 'Belum ada absen masuk aktif hari ini';
    END IF;
  END IF;
  INSERT INTO public.audit_logs (
    business_id, user_id, action, table_name, record_id, details
  )
  VALUES (
    v_business_id, auth.uid(), 'attendance_' || p_action,
    'staff_attendance', v_attendance_id,
    jsonb_build_object('branch_id', p_branch_id, 'work_date', v_today, 'note', p_note)
  );
  RETURN v_attendance_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_staff_profile(
  p_user_id uuid, p_branch_id uuid, p_employee_code text, p_full_name text,
  p_phone text DEFAULT NULL::text, p_job_title text DEFAULT NULL::text,
  p_role text DEFAULT 'cashier'::text, p_is_active boolean DEFAULT true,
  p_commission_type text DEFAULT 'percent'::text, p_commission_value numeric DEFAULT 0
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_business_id uuid;
  v_actor record;
  v_target record;
  v_profile_id uuid;
  v_code text := upper(trim(coalesce(p_employee_code, '')));
  v_name text := trim(coalesce(p_full_name, ''));
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sesi login tidak valid'; END IF;
  IF p_user_id IS NULL OR p_branch_id IS NULL THEN
    RAISE EXCEPTION 'Akun dan cabang karyawan wajib dipilih';
  END IF;
  SELECT b.business_id INTO v_business_id
  FROM public.branches b
  WHERE b.id = p_branch_id AND b.is_active = true;
  IF v_business_id IS NULL THEN RAISE EXCEPTION 'Cabang karyawan tidak valid'; END IF;
  SELECT business_id, role, branch_id INTO v_actor
  FROM public.business_members
  WHERE user_id = auth.uid() AND business_id = v_business_id AND is_active = true;
  IF NOT FOUND OR v_actor.role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Hanya Owner/Admin pada bisnis cabang ini yang dapat mengelola karyawan';
  END IF;
  SELECT business_id, role, branch_id, is_active INTO v_target
  FROM public.business_members
  WHERE user_id = p_user_id AND business_id = v_business_id
  FOR UPDATE;
  IF NOT FOUND OR v_target.business_id <> v_business_id THEN
    RAISE EXCEPTION 'Akun karyawan tidak terdaftar pada bisnis cabang ini';
  END IF;
  IF v_target.role = 'owner' THEN
    RAISE EXCEPTION 'Peran Owner utama tidak dapat diubah dari menu karyawan';
  END IF;
  IF v_actor.role = 'admin' AND v_target.role = 'admin' THEN
    RAISE EXCEPTION 'Admin tidak dapat mengubah akun Admin lain';
  END IF;
  IF coalesce(p_role, '') NOT IN ('admin', 'manager', 'cashier', 'staff') THEN
    RAISE EXCEPTION 'Peran karyawan tidak valid';
  END IF;
  IF v_actor.role = 'admin' AND p_role = 'admin' THEN
    RAISE EXCEPTION 'Admin tidak dapat memberikan peran Admin';
  END IF;
  IF p_user_id = auth.uid() AND NOT coalesce(p_is_active, true) THEN
    RAISE EXCEPTION 'Anda tidak dapat menonaktifkan akun sendiri';
  END IF;
  IF v_name = '' OR length(v_name) > 120 THEN
    RAISE EXCEPTION 'Nama karyawan wajib diisi (maksimal 120 karakter)';
  END IF;
  IF v_code = '' OR length(v_code) > 32 OR v_code !~ '^[A-Z0-9_-]+$' THEN
    RAISE EXCEPTION 'Kode karyawan tidak valid';
  END IF;
  IF p_commission_type IS NULL
     OR p_commission_type NOT IN ('percent', 'per_unit', 'none')
     OR p_commission_value IS NULL
     OR p_commission_value < 0
     OR p_commission_value > 100000000 THEN
    RAISE EXCEPTION 'Pengaturan komisi tidak valid';
  END IF;
  INSERT INTO public.staff_profiles (
    business_id, user_id, branch_id, employee_code, full_name,
    phone, job_title, commission_type, commission_value
  )
  VALUES (
    v_business_id, p_user_id, p_branch_id, v_code, v_name,
    nullif(trim(coalesce(p_phone, '')), ''),
    nullif(trim(coalesce(p_job_title, '')), ''),
    p_commission_type, p_commission_value
  )
  ON CONFLICT (business_id, user_id)
  DO UPDATE SET
    branch_id = excluded.branch_id,
    employee_code = excluded.employee_code,
    full_name = excluded.full_name,
    phone = excluded.phone,
    job_title = excluded.job_title,
    commission_type = excluded.commission_type,
    commission_value = excluded.commission_value,
    updated_at = now()
  RETURNING id INTO v_profile_id;
  UPDATE public.business_members
  SET branch_id = p_branch_id,
      role = p_role,
      is_active = coalesce(p_is_active, true)
  WHERE user_id = p_user_id AND business_id = v_business_id;
  INSERT INTO public.audit_logs (
    business_id, user_id, action, table_name, record_id, details
  )
  VALUES (
    v_business_id, auth.uid(), 'staff_profile_upsert',
    'staff_profiles', v_profile_id,
    jsonb_build_object(
      'target_user_id', p_user_id, 'branch_id', p_branch_id,
      'employee_code', v_code, 'role', p_role, 'is_active', p_is_active,
      'commission_type', p_commission_type, 'commission_value', p_commission_value
    )
  );
  RETURN v_profile_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_stock_opname(uuid, uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_stock_opname(uuid, uuid, jsonb, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.open_cash_register(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.open_cash_register(uuid, numeric, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_staff_attendance(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_staff_attendance(uuid, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.save_staff_profile(uuid, uuid, text, text, text, text, text, boolean, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_staff_profile(uuid, uuid, text, text, text, text, text, boolean, text, numeric) TO authenticated, service_role;
