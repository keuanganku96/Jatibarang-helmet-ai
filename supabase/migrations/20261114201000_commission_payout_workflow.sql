-- Atomic staff commission payout workflow
create table if not exists public.commission_payouts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  staff_user_id uuid not null references auth.users(id),
  amount numeric(14,2) not null check (amount > 0),
  ledger_count integer not null check (ledger_count > 0),
  cash_entry_id uuid references public.cash_entries(id) on delete set null,
  notes text,
  paid_by uuid not null references auth.users(id),
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists commission_payouts_branch_paid_idx
  on public.commission_payouts(business_id, branch_id, paid_at desc);
create index if not exists commission_payouts_staff_paid_idx
  on public.commission_payouts(business_id, staff_user_id, paid_at desc);
alter table public.commission_payouts enable row level security;
drop policy if exists commission_payouts_read_branch on public.commission_payouts;
create policy commission_payouts_read_branch on public.commission_payouts
  for select to authenticated using (public.can_access_branch(business_id, branch_id));
grant select on public.commission_payouts to authenticated;
revoke insert, update, delete on public.commission_payouts from public, anon, authenticated;
alter table public.commission_ledger
  add column if not exists payout_id uuid references public.commission_payouts(id) on delete set null;
create index if not exists commission_ledger_payout_idx
  on public.commission_ledger(payout_id) where payout_id is not null;
create or replace function public.pay_staff_commissions(
  p_branch_id uuid, p_staff_user_id uuid, p_notes text default null
)
returns table(payout_id uuid, paid_amount numeric, paid_items integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_business_id uuid; v_amount numeric(14,2); v_count integer;
  v_payout_id uuid; v_cash_id uuid; v_staff_name text;
begin
  if auth.uid() is null then raise exception 'Sesi login tidak valid'; end if;
  select sp.business_id, sp.full_name into v_business_id, v_staff_name
  from public.staff_profiles sp
  join public.business_members bm on bm.business_id=sp.business_id
    and bm.user_id=sp.user_id and bm.is_active=true
  where sp.user_id=p_staff_user_id and sp.branch_id=p_branch_id
  order by sp.created_at limit 1;
  if v_business_id is null then raise exception 'Profil karyawan aktif pada cabang ini tidak ditemukan'; end if;
  if not private.smartpos_has_business_role(v_business_id,array['owner','admin','manager']::text[]) then
    raise exception 'Hanya Owner/Admin/Manager yang dapat membayar komisi';
  end if;
  if not private.smartpos_can_access_branch(v_business_id,p_branch_id) then
    raise exception 'Tidak memiliki akses ke cabang ini';
  end if;
  perform cl.id from public.commission_ledger cl
  where cl.business_id=v_business_id and cl.branch_id=p_branch_id
    and cl.staff_user_id=p_staff_user_id and cl.status='pending'
  order by cl.created_at,cl.id for update;
  select coalesce(sum(cl.commission_amount),0)::numeric(14,2),count(*)::integer
    into v_amount,v_count
  from public.commission_ledger cl
  where cl.business_id=v_business_id and cl.branch_id=p_branch_id
    and cl.staff_user_id=p_staff_user_id and cl.status='pending';
  if v_count=0 or v_amount<=0 then raise exception 'Tidak ada komisi tertunda untuk karyawan ini'; end if;
  insert into public.commission_payouts(business_id,branch_id,staff_user_id,amount,ledger_count,notes,paid_by)
  values(v_business_id,p_branch_id,p_staff_user_id,v_amount,v_count,
    nullif(left(trim(coalesce(p_notes,'')),500),''),auth.uid()) returning id into v_payout_id;
  insert into public.cash_entries(business_id,branch_id,entry_type,category,description,amount,reference_type,reference_id,created_by)
  values(v_business_id,p_branch_id,'expense','Komisi Karyawan',
    'Pembayaran komisi - '||coalesce(v_staff_name,left(p_staff_user_id::text,8)),
    v_amount,'commission_payout',v_payout_id,auth.uid()) returning id into v_cash_id;
  update public.commission_payouts set cash_entry_id=v_cash_id where id=v_payout_id;
  update public.commission_ledger set status='paid',paid_at=now(),paid_by=auth.uid(),payout_id=v_payout_id
  where business_id=v_business_id and branch_id=p_branch_id
    and staff_user_id=p_staff_user_id and status='pending';
  insert into public.audit_logs(business_id,user_id,action,table_name,record_id,details)
  values(v_business_id,auth.uid(),'commission.payout.completed','commission_payouts',v_payout_id,
    jsonb_build_object('branch_id',p_branch_id,'staff_user_id',p_staff_user_id,
      'amount',v_amount,'ledger_count',v_count,'cash_entry_id',v_cash_id));
  return query select v_payout_id,v_amount,v_count;
end;
$$;
revoke all on function public.pay_staff_commissions(uuid,uuid,text) from public,anon;
grant execute on function public.pay_staff_commissions(uuid,uuid,text) to authenticated;