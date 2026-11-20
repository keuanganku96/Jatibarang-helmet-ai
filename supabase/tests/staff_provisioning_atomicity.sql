-- Rollback-only checks for server-side staff provisioning.
BEGIN;
SET LOCAL ROLE service_role;

DO $test$
DECLARE
  v_business_id uuid;
  v_branch_id uuid;
  v_owner_id uuid;
  v_test_user_id uuid := pg_catalog.gen_random_uuid();
  v_hash text := 'pbkdf2-sha256$310000$' || repeat('A',22) || '==' || '$' || repeat('B',43) || '=';
  v_proc regprocedure :=
    'public.create_staff_records_from_edge(uuid,uuid,uuid,text,text,text,text,text,text,numeric,text,uuid)'::regprocedure;
BEGIN
  IF has_function_privilege('anon', v_proc, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon unexpectedly has EXECUTE on staff provisioning RPC';
  END IF;
  IF has_function_privilege('authenticated', v_proc, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated unexpectedly has EXECUTE on staff provisioning RPC';
  END IF;
  IF NOT has_function_privilege('service_role', v_proc, 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role is missing EXECUTE on staff provisioning RPC';
  END IF;

  SELECT bm.business_id, b.id, bm.user_id
  INTO v_business_id, v_branch_id, v_owner_id
  FROM public.business_members bm
  JOIN public.branches b ON b.business_id = bm.business_id AND b.is_active = true
  WHERE bm.role = 'owner' AND bm.is_active = true
  LIMIT 1;

  IF v_business_id IS NULL OR v_branch_id IS NULL OR v_owner_id IS NULL THEN
    RAISE EXCEPTION 'No active Owner and branch available for rollback-only tests';
  END IF;

  BEGIN
    PERFORM public.create_staff_records_from_edge(
      v_business_id, v_branch_id, v_test_user_id,
      'ATOMIC-STAFF-TEST', 'Test Karyawan', NULL, NULL,
      'cashier', 'none', 0, 'invalid-hash', pg_catalog.gen_random_uuid()
    );
    RAISE EXCEPTION 'TEST_FAILURE: non-owner actor was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'TEST_FAILURE: non-owner actor was accepted' THEN
      RAISE;
    END IF;
    IF SQLERRM NOT LIKE '%Owner/Admin aktif%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.create_staff_records_from_edge(
      v_business_id, v_branch_id, v_test_user_id,
      'ATOMIC-STAFF-TEST', 'Test Karyawan', NULL, NULL,
      'cashier', 'none', 0, 'invalid-hash', v_owner_id
    );
    RAISE EXCEPTION 'TEST_FAILURE: invalid PIN hash was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'TEST_FAILURE: invalid PIN hash was accepted' THEN
      RAISE;
    END IF;
    IF SQLERRM NOT LIKE '%Hash PIN tidak valid%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.create_staff_records_from_edge(
      v_business_id, v_branch_id, v_owner_id,
      'ATOMIC-OWNER-TEST', 'Test Karyawan', NULL, NULL,
      'cashier', 'none', 0, v_hash, v_owner_id
    );
    RAISE EXCEPTION 'TEST_FAILURE: existing Owner was accepted as new staff';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'TEST_FAILURE: existing Owner was accepted as new staff' THEN
      RAISE;
    END IF;
    IF SQLERRM NOT LIKE '%sudah terdaftar pada bisnis ini%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.create_staff_records_from_edge(
      v_business_id, v_branch_id, v_test_user_id,
      'ATOMIC-STAFF-TEST', 'Test Karyawan', NULL, NULL,
      'cashier', 'none', 0, v_hash, v_owner_id
    );
    RAISE EXCEPTION 'TEST_FAILURE: non-existent Auth ID was accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  IF EXISTS (
    SELECT 1 FROM public.business_members
    WHERE business_id = v_business_id AND user_id = v_test_user_id
  ) OR EXISTS (
    SELECT 1 FROM public.staff_profiles
    WHERE business_id = v_business_id AND employee_code IN ('ATOMIC-STAFF-TEST','ATOMIC-OWNER-TEST')
  ) THEN
    RAISE EXCEPTION 'A failed provisioning attempt left partial staff records';
  END IF;
END;
$test$;

ROLLBACK;
