create or replace function public.record_staff_pin_failure(p_staff_profile_id uuid)
returns table(failed_attempts integer, locked_until timestamptz)
language plpgsql security definer set search_path = ''
as $$
begin
  return query
  update public.staff_pin_credentials c
  set failed_attempts = c.failed_attempts + 1,
      locked_until = case when c.failed_attempts + 1 >= 5 then now() + interval '10 minutes' else c.locked_until end,
      updated_at = now()
  where c.staff_profile_id = p_staff_profile_id
  returning c.failed_attempts, c.locked_until;
end;
$$;
revoke all on function public.record_staff_pin_failure(uuid) from public, anon, authenticated;
grant execute on function public.record_staff_pin_failure(uuid) to service_role;

create or replace function public.reset_staff_pin_failures(p_staff_profile_id uuid)
returns void language sql security definer set search_path = ''
as $$
  update public.staff_pin_credentials
  set failed_attempts = 0, locked_until = null, updated_at = now()
  where staff_profile_id = p_staff_profile_id;
$$;
revoke all on function public.reset_staff_pin_failures(uuid) from public, anon, authenticated;
grant execute on function public.reset_staff_pin_failures(uuid) to service_role;