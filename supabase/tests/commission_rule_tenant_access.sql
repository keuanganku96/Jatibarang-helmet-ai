-- SMART POS JATIBARANG
-- Transactional smoke test for commission tenant isolation.
--
-- Run this script in the Supabase SQL Editor as a database owner/admin.
-- It uses the existing active Owner, business, branch, and product as fixtures.
-- Every successful write is rolled back. No business data is retained.
--
-- The test covers:
-- 1. Explicit-tenant RPC accepts an authorized Owner.
-- 2. Backward-compatible RPC accepts an authorized Owner.
-- 3. Both RPCs reject a non-member.
-- 4. anon cannot execute either RPC; authenticated can.
--
-- Do not remove the ROLLBACK statements.

BEGIN;
SELECT
  set_config('smartpos_test.owner_id', bm.user_id::text, true),
  set_config('smartpos_test.business_id', bm.business_id::text, true)
FROM public.business_members bm
WHERE bm.role = 'owner' AND bm.is_active = true
ORDER BY bm.created_at
LIMIT 1;

SELECT set_config('smartpos_test.branch_id', b.id::text, true)
FROM public.branches b
WHERE b.business_id = current_setting('smartpos_test.business_id')::uuid
  AND b.is_active = true
ORDER BY b.created_at
LIMIT 1;

SELECT set_config('smartpos_test.product_id', p.id::text, true)
FROM public.products p
WHERE p.business_id = current_setting('smartpos_test.business_id')::uuid
  AND p.is_active = true
ORDER BY p.created_at
LIMIT 1;

SELECT set_config('request.jwt.claim.sub', current_setting('smartpos_test.owner_id'), true);
SET LOCAL ROLE authenticated;

SELECT public.save_commission_rule_for_business(
  current_setting('smartpos_test.business_id')::uuid,
  current_setting('smartpos_test.branch_id')::uuid,
  current_setting('smartpos_test.product_id')::uuid,
  'percent',
  0.01,
  true
) AS explicit_tenant_write;

SELECT public.save_commission_rule(
  current_setting('smartpos_test.branch_id')::uuid,
  current_setting('smartpos_test.product_id')::uuid,
  'percent',
  0.01,
  true
) AS legacy_wrapper_write;

ROLLBACK;

BEGIN;
SELECT set_config('smartpos_test.business_id', bm.business_id::text, true)
FROM public.business_members bm
WHERE bm.role = 'owner' AND bm.is_active = true
ORDER BY bm.created_at
LIMIT 1;

SELECT set_config('smartpos_test.branch_id', b.id::text, true)
FROM public.branches b
WHERE b.business_id = current_setting('smartpos_test.business_id')::uuid
  AND b.is_active = true
ORDER BY b.created_at
LIMIT 1;

SELECT set_config('smartpos_test.product_id', p.id::text, true)
FROM public.products p
WHERE p.business_id = current_setting('smartpos_test.business_id')::uuid
  AND p.is_active = true
ORDER BY p.created_at
LIMIT 1;

-- A syntactically valid UUID that is not an active business member.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000000', true);
SET LOCAL ROLE authenticated;

DO $test$
DECLARE
  v_business uuid := current_setting('smartpos_test.business_id')::uuid;
  v_branch uuid := current_setting('smartpos_test.branch_id')::uuid;
  v_product uuid := current_setting('smartpos_test.product_id')::uuid;
  v_blocked boolean;
BEGIN
  v_blocked := false;
  BEGIN
    PERFORM public.save_commission_rule_for_business(
      v_business, v_branch, v_product, 'percent', 0.01, true
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'Hanya Owner/Admin aktif pada bisnis tujuan%' THEN
      v_blocked := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'TEST_FAILED: explicit RPC allowed a non-member';
  END IF;

  v_blocked := false;
  BEGIN
    PERFORM public.save_commission_rule(
      v_branch, v_product, 'percent', 0.01, true
    );
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'Hanya Owner/Admin aktif pada bisnis tujuan%' THEN
      v_blocked := true;
    ELSE
      RAISE;
    END IF;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'TEST_FAILED: legacy wrapper allowed a non-member';
  END IF;
END
$test$;

ROLLBACK;

DO $acl$
BEGIN
  IF has_function_privilege(
       'anon',
       'public.save_commission_rule_for_business(uuid,uuid,uuid,text,numeric,boolean)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'anon',
       'public.save_commission_rule(uuid,uuid,text,numeric,boolean)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'TEST_FAILED: anon can execute commission RPC';
  END IF;

  IF NOT has_function_privilege(
       'authenticated',
       'public.save_commission_rule_for_business(uuid,uuid,uuid,text,numeric,boolean)',
       'EXECUTE'
     )
     OR NOT has_function_privilege(
       'authenticated',
       'public.save_commission_rule(uuid,uuid,text,numeric,boolean)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'TEST_FAILED: authenticated cannot execute commission RPC';
  END IF;
END
$acl$;

SELECT
  'PASS: explicit and legacy RPC allow Owner, reject non-member, anon EXECUTE revoked, authenticated EXECUTE granted; all writes rolled back.'
  AS test_result;
