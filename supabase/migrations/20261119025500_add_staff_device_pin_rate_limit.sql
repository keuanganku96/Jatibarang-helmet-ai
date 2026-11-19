-- Device-level throttling for staff PIN login.
-- Complements the existing per-employee five-attempt lockout and prevents
-- cycling through employee codes on one paired device.

create table if not exists public.staff_device_pin_limits (
  business_id uuid not null,
  device_id uuid not null,
  failed_attempts integer not null default 0
    check (failed_attempts >= 0 and failed_attempts <= 10),
  window_started_at timestamptz,
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (business_id, device_id)
);

comment on table public.staff_device_pin_limits is
  'Server-only rolling failure counters for staff PIN authentication, scoped to a paired device and business.';

alter table public.staff_device_pin_limits enable row level security;

revoke all on table public.staff_device_pin_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.staff_device_pin_limits to service_role;

create policy staff_device_pin_limits_service_role_access
  on public.staff_device_pin_limits
  for all
  to service_role
  using (true)
  with check (true);

create or replace function public.record_staff_device_pin_attempt(
  p_business_id uuid,
  p_device_id uuid,
  p_success boolean
)
returns table(failed_attempts integer, locked_until timestamptz)
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_failed_attempts integer;
  v_window_started_at timestamptz;
  v_locked_until timestamptz;
  v_now timestamptz := clock_timestamp();
begin
  if p_business_id is null or p_device_id is null or p_success is null then
    raise exception 'Parameter pembatasan PIN perangkat tidak valid';
  end if;

  if not exists (
    select 1
    from public.staff_devices d
    join public.branches b
      on b.id = d.branch_id
     and b.business_id = d.business_id
     and b.is_active = true
    where d.business_id = p_business_id
      and d.device_id = p_device_id
      and d.revoked_at is null
  ) then
    raise exception 'Perangkat kasir tidak aktif atau tidak terdaftar pada bisnis ini';
  end if;

  insert into public.staff_device_pin_limits (
    business_id, device_id, failed_attempts, window_started_at, locked_until, updated_at
  )
  values (p_business_id, p_device_id, 0, null, null, v_now)
  on conflict (business_id, device_id) do nothing;

  select l.failed_attempts, l.window_started_at, l.locked_until
    into v_failed_attempts, v_window_started_at, v_locked_until
  from public.staff_device_pin_limits l
  where l.business_id = p_business_id
    and l.device_id = p_device_id
  for update;

  if p_success then
    update public.staff_device_pin_limits l
       set failed_attempts = 0,
           window_started_at = null,
           locked_until = null,
           updated_at = v_now
     where l.business_id = p_business_id
       and l.device_id = p_device_id;

    return query select 0, null::timestamptz;
    return;
  end if;

  if v_locked_until is not null and v_locked_until > v_now then
    return query select v_failed_attempts, v_locked_until;
    return;
  end if;

  if v_window_started_at is null
     or v_window_started_at <= v_now - interval '15 minutes' then
    v_failed_attempts := 1;
    v_window_started_at := v_now;
    v_locked_until := null;
  else
    v_failed_attempts := v_failed_attempts + 1;
    if v_failed_attempts >= 10 then
      v_locked_until := v_now + interval '15 minutes';
    else
      v_locked_until := null;
    end if;
  end if;

  update public.staff_device_pin_limits l
     set failed_attempts = v_failed_attempts,
         window_started_at = v_window_started_at,
         locked_until = v_locked_until,
         updated_at = v_now
   where l.business_id = p_business_id
     and l.device_id = p_device_id;

  return query select v_failed_attempts, v_locked_until;
end;
$function$;

revoke all on function public.record_staff_device_pin_attempt(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.record_staff_device_pin_attempt(uuid, uuid, boolean)
  to service_role;

comment on function public.record_staff_device_pin_attempt(uuid, uuid, boolean) is
  'Atomically increments or clears paired-device PIN login failures. Callable only by service_role.';
