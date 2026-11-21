-- Rollback-only test for staff device PIN throttling.
-- Run in a non-production SQL session with permission to SET ROLE.
begin;
set local role service_role;

do $test$
declare
  v_business_id uuid;
  v_branch_id uuid;
  v_approved_by uuid;
  v_device_id uuid := gen_random_uuid();
  v_result record;
  i integer;
begin
  select b.id, br.id, bm.user_id
    into v_business_id, v_branch_id, v_approved_by
  from public.businesses b
  join public.branches br
    on br.business_id = b.id and br.is_active = true
  join public.business_members bm
    on bm.business_id = b.id and bm.is_active = true
   and bm.role in ('owner', 'admin')
  order by b.created_at
  limit 1;

  if v_business_id is null or v_branch_id is null or v_approved_by is null then
    raise exception 'Test requires an active business, branch, and Owner/Admin membership';
  end if;

  insert into public.staff_devices (device_id, business_id, branch_id, device_label, approved_by)
  values (v_device_id, v_business_id, v_branch_id, 'ROLLBACK-ONLY PIN RATE TEST', v_approved_by);

  for i in 1..10 loop
    select * into v_result
    from public.record_staff_device_pin_attempt(v_business_id, v_device_id, false);

    if i < 10 and (v_result.failed_attempts <> i or v_result.locked_until is not null) then
      raise exception 'Unexpected counter state at attempt %', i;
    end if;
    if i = 10 and (v_result.failed_attempts <> 10 or v_result.locked_until is null or v_result.locked_until <= now()) then
      raise exception 'Device did not lock on the tenth failure';
    end if;
  end loop;

  select * into v_result
  from public.record_staff_device_pin_attempt(v_business_id, v_device_id, false);
  if v_result.failed_attempts <> 10 or v_result.locked_until is null then
    raise exception 'A locked device accepted another failure';
  end if;

  select * into v_result
  from public.record_staff_device_pin_attempt(v_business_id, v_device_id, true);
  if v_result.failed_attempts <> 0 or v_result.locked_until is not null then
    raise exception 'Successful authentication did not clear the device counter';
  end if;

  if has_function_privilege('anon', 'public.record_staff_device_pin_attempt(uuid,uuid,boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_staff_device_pin_attempt(uuid,uuid,boolean)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.record_staff_device_pin_attempt(uuid,uuid,boolean)', 'EXECUTE') then
    raise exception 'Function execute grants are not restricted to service_role';
  end if;

  if has_table_privilege('anon', 'public.staff_device_pin_limits', 'SELECT')
     or has_table_privilege('authenticated', 'public.staff_device_pin_limits', 'SELECT')
     or not has_table_privilege('service_role', 'public.staff_device_pin_limits', 'SELECT') then
    raise exception 'Table grants are not restricted to service_role';
  end if;

  raise notice 'PASS: per-device lockout, reset, and service_role-only permissions';
end;
$test$;

rollback;
