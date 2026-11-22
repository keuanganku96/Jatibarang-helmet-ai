create table if not exists public.staff_pin_credentials (
  staff_profile_id uuid primary key references public.staff_profiles(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  pin_hash text not null,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.staff_pin_credentials enable row level security;
revoke all on public.staff_pin_credentials from public, anon, authenticated;

create table if not exists public.staff_devices (
  device_id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  device_label text not null default 'Perangkat kasir',
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists staff_devices_business_idx on public.staff_devices(business_id,branch_id);
alter table public.staff_devices enable row level security;
revoke all on public.staff_devices from public, anon, authenticated;

create table if not exists public.staff_pin_audit (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  staff_profile_id uuid references public.staff_profiles(id) on delete set null,
  device_id uuid,
  event_type text not null check (event_type in ('created','pin_changed','login_success','login_failed','device_paired','device_revoked')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists staff_pin_audit_business_date_idx on public.staff_pin_audit(business_id,created_at desc);
alter table public.staff_pin_audit enable row level security;
revoke all on public.staff_pin_audit from public, anon, authenticated;

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