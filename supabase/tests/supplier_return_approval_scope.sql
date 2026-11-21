-- Read-only security assertions for supplier-return approval.
-- The unauthenticated call must fail before reading or mutating a return.
BEGIN;
DO $test$
DECLARE
  v_fn regprocedure;
  v_definition text;
BEGIN
  v_fn := to_regprocedure('public.approve_supplier_return(uuid)');
  IF v_fn IS NULL THEN RAISE EXCEPTION 'TEST FAILED: function missing'; END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED: anon can execute supplier-return approval';
  END IF;
  IF NOT has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED: authenticated cannot execute supplier-return approval';
  END IF;

  SELECT lower(pg_get_functiondef(v_fn)) INTO v_definition;
  IF position('v_po.business_id is distinct from v_return.business_id' IN v_definition) = 0
     OR position('v_po.branch_id is distinct from v_return.branch_id' IN v_definition) = 0
     OR position('v_po.warehouse_id is distinct from v_return.warehouse_id' IN v_definition) = 0
     OR position('v_po.supplier_id is distinct from v_return.supplier_id' IN v_definition) = 0
     OR position('pi.purchase_id = v_return.purchase_id' IN v_definition) = 0
     OR position('i.business_id = v_return.business_id' IN v_definition) = 0
     OR position('and i.warehouse_id = v_return.warehouse_id' IN v_definition) = 0 THEN
    RAISE EXCEPTION 'TEST FAILED: tenant, purchase, or warehouse guard missing';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '{}', true);
  BEGIN
    PERFORM public.approve_supplier_return('00000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'TEST_ASSERTION: unauthenticated invocation unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'TEST_ASSERTION: unauthenticated invocation unexpectedly succeeded' THEN RAISE; END IF;
    IF SQLERRM <> 'Authentication required' THEN
      RAISE EXCEPTION 'TEST FAILED: unexpected unauthenticated error: %', SQLERRM;
    END IF;
  END;
END;
$test$;
ROLLBACK;
