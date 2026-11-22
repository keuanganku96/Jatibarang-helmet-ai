create table if not exists public.staff_attendance (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  user_id uuid not null,
  work_date date not null default (now() at time zone 'Asia/Jakarta')::date,
  clock_in_at timestamptz not null default now(),
  clock_out_at timestamptz,
  clock_in_note text,
  clock_out_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, branch_id, user_id, work_date)
);
create index if not exists staff_attendance_branch_date_idx on public.staff_attendance(business_id,branch_id,work_date desc);
create index if not exists staff_attendance_branch_id_idx on public.staff_attendance(branch_id);
alter table public.staff_attendance enable row level security;
drop policy if exists staff_attendance_read_branch on public.staff_attendance;
create policy staff_attendance_read_branch on public.staff_attendance for select to authenticated
using (public.can_access_branch(business_id,branch_id));
grant select on public.staff_attendance to authenticated;

create table if not exists public.cash_register_sessions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  cashier_id uuid not null,
  opened_at timestamptz not null default now(),
  opening_float numeric(14,2) not null default 0 check (opening_float >= 0),
  closed_at timestamptz,
  expected_cash numeric(14,2),
  counted_cash numeric(14,2),
  cash_difference numeric(14,2),
  cash_sales numeric(14,2),
  cash_outflows numeric(14,2),
  opening_note text,
  closing_note text,
  status text not null default 'open' check (status in ('open','closed')),
  created_at timestamptz not null default now(),
  constraint cash_register_sessions_close_check check (
    (status='open' and closed_at is null and counted_cash is null)
    or (status='closed' and closed_at is not null and counted_cash is not null and expected_cash is not null)
  )
);
create unique index if not exists cash_register_one_open_per_cashier_branch
on public.cash_register_sessions(business_id,branch_id,cashier_id) where status='open';
create index if not exists cash_register_branch_opened_idx on public.cash_register_sessions(business_id,branch_id,opened_at desc);
create index if not exists cash_register_sessions_branch_id_idx on public.cash_register_sessions(branch_id);
alter table public.cash_register_sessions enable row level security;
drop policy if exists cash_register_read_branch on public.cash_register_sessions;
create policy cash_register_read_branch on public.cash_register_sessions for select to authenticated
using (public.can_access_branch(business_id,branch_id));
grant select on public.cash_register_sessions to authenticated;

create or replace function public.record_staff_attendance(p_branch_id uuid,p_action text,p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_member record; v_attendance_id uuid; v_today date := (now() at time zone 'Asia/Jakarta')::date;
begin
  if auth.uid() is null then raise exception 'Sesi login tidak valid'; end if;
  if p_action not in ('clock_in','clock_out') then raise exception 'Aksi absensi tidak valid'; end if;
  select business_id,branch_id,role into v_member from public.business_members
  where user_id=auth.uid() and is_active=true order by created_at limit 1;
  if not found then raise exception 'Anggota bisnis tidak ditemukan'; end if;
  if not private.smartpos_can_access_branch(v_member.business_id,p_branch_id) then raise exception 'Tidak memiliki akses ke cabang ini'; end if;
  if p_action='clock_in' then
    insert into public.staff_attendance(business_id,branch_id,user_id,work_date,clock_in_note)
    values(v_member.business_id,p_branch_id,auth.uid(),v_today,nullif(left(coalesce(p_note,''),500),''))
    on conflict (business_id,branch_id,user_id,work_date) do update
      set clock_in_note=coalesce(excluded.clock_in_note,staff_attendance.clock_in_note)
      where staff_attendance.clock_out_at is null
    returning id into v_attendance_id;
    if v_attendance_id is null then raise exception 'Absensi hari ini sudah ditutup'; end if;
  else
    update public.staff_attendance set clock_out_at=now(),clock_out_note=nullif(left(coalesce(p_note,''),500),''),updated_at=now()
    where business_id=v_member.business_id and branch_id=p_branch_id and user_id=auth.uid()
      and work_date=v_today and clock_out_at is null returning id into v_attendance_id;
    if v_attendance_id is null then raise exception 'Belum ada absen masuk aktif hari ini'; end if;
  end if;
  insert into public.audit_logs(business_id,user_id,action,table_name,record_id,details)
  values(v_member.business_id,auth.uid(),'attendance_'||p_action,'staff_attendance',v_attendance_id,
    jsonb_build_object('branch_id',p_branch_id,'work_date',v_today,'note',p_note));
  return v_attendance_id;
end; $$;

create or replace function public.open_cash_register(p_branch_id uuid,p_opening_float numeric,p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_business_id uuid; v_session_id uuid;
begin
  if auth.uid() is null then raise exception 'Sesi login tidak valid'; end if;
  if p_opening_float is null or p_opening_float < 0 then raise exception 'Modal awal kas tidak valid'; end if;
  select business_id into v_business_id from public.business_members
  where user_id=auth.uid() and is_active=true order by created_at limit 1;
  if v_business_id is null then raise exception 'Anggota bisnis tidak ditemukan'; end if;
  if not private.smartpos_can_access_branch(v_business_id,p_branch_id) then raise exception 'Tidak memiliki akses ke cabang ini'; end if;
  insert into public.cash_register_sessions(business_id,branch_id,cashier_id,opening_float,opening_note)
  values(v_business_id,p_branch_id,auth.uid(),p_opening_float,nullif(left(coalesce(p_note,''),500),'')) returning id into v_session_id;
  insert into public.audit_logs(business_id,user_id,action,table_name,record_id,details)
  values(v_business_id,auth.uid(),'cash_register_open','cash_register_sessions',v_session_id,jsonb_build_object('branch_id',p_branch_id,'opening_float',p_opening_float));
  return v_session_id;
exception when unique_violation then raise exception 'Masih ada shift kasir yang terbuka. Tutup shift sebelumnya terlebih dahulu.';
end; $$;

create or replace function public.close_cash_register(p_session_id uuid,p_counted_cash numeric,p_note text default null)
returns table(expected_cash numeric,cash_difference numeric,cash_sales numeric,cash_outflows numeric)
language plpgsql security definer set search_path = '' as $$
declare v_session public.cash_register_sessions%rowtype; v_sales numeric(14,2); v_outflows numeric(14,2); v_expected numeric(14,2);
begin
  if auth.uid() is null then raise exception 'Sesi login tidak valid'; end if;
  if p_counted_cash is null or p_counted_cash < 0 then raise exception 'Uang fisik terhitung tidak valid'; end if;
  select * into v_session from public.cash_register_sessions where id=p_session_id for update;
  if not found then raise exception 'Shift kasir tidak ditemukan'; end if;
  if v_session.cashier_id<>auth.uid() and not private.smartpos_has_business_role(v_session.business_id,array['owner','admin','manager']) then
    raise exception 'Tidak berhak menutup shift kasir ini';
  end if;
  if not private.smartpos_can_access_branch(v_session.business_id,v_session.branch_id) then raise exception 'Tidak memiliki akses ke cabang ini'; end if;
  if v_session.status<>'open' then raise exception 'Shift ini sudah ditutup'; end if;
  select coalesce(sum(sp.amount),0) into v_sales from public.sale_payments sp
  join public.sales s on s.id=sp.sale_id and s.business_id=sp.business_id
  where sp.business_id=v_session.business_id and s.branch_id=v_session.branch_id
    and s.cashier_id=v_session.cashier_id and s.status='paid' and sp.payment_status='completed'
    and sp.payment_method='Tunai' and sp.created_at>=v_session.opened_at and sp.created_at<=now();
  select coalesce(sum(ce.amount),0) into v_outflows from public.cash_entries ce
  where ce.business_id=v_session.business_id and ce.branch_id=v_session.branch_id
    and ce.created_by=v_session.cashier_id and ce.entry_type='expense'
    and ce.created_at>=v_session.opened_at and ce.created_at<=now();
  v_expected:=v_session.opening_float+v_sales-v_outflows;
  update public.cash_register_sessions set closed_at=now(),expected_cash=v_expected,counted_cash=p_counted_cash,
    cash_difference=p_counted_cash-v_expected,cash_sales=v_sales,cash_outflows=v_outflows,
    closing_note=nullif(left(coalesce(p_note,''),500),''),status='closed' where id=p_session_id;
  insert into public.audit_logs(business_id,user_id,action,table_name,record_id,details)
  values(v_session.business_id,auth.uid(),'cash_register_close','cash_register_sessions',p_session_id,
    jsonb_build_object('expected_cash',v_expected,'counted_cash',p_counted_cash,'cash_difference',p_counted_cash-v_expected,'cash_sales',v_sales,'cash_outflows',v_outflows));
  return query select v_expected,p_counted_cash-v_expected,v_sales,v_outflows;
end; $$;

revoke all on function public.record_staff_attendance(uuid,text,text) from public,anon;
revoke all on function public.open_cash_register(uuid,numeric,text) from public,anon;
revoke all on function public.close_cash_register(uuid,numeric,text) from public,anon;
grant execute on function public.record_staff_attendance(uuid,text,text) to authenticated;
grant execute on function public.open_cash_register(uuid,numeric,text) to authenticated;
grant execute on function public.close_cash_register(uuid,numeric,text) to authenticated;
