-- SMART POS JATIBARANG: sales targets and branch performance
-- Daily, ISO-weekly (Monday start), and monthly targets.

create table if not exists public.sales_targets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid null references public.branches(id) on delete cascade,
  period_type text not null check (period_type in ('daily','weekly','monthly')),
  period_start date not null,
  target_amount numeric(14,2) not null default 0 check (target_amount >= 0),
  target_transactions integer not null default 0 check (target_transactions >= 0),
  notes text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_targets_period_alignment check (
    period_type = 'daily'
    or (period_type = 'weekly' and extract(isodow from period_start) = 1)
    or (period_type = 'monthly' and extract(day from period_start) = 1)
  )
);

create unique index if not exists sales_targets_scope_period_uidx
  on public.sales_targets (
    business_id, period_type, period_start,
    (coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
  );
create index if not exists sales_targets_business_period_idx
  on public.sales_targets (business_id, period_start desc);
create index if not exists sales_targets_branch_period_idx
  on public.sales_targets (branch_id, period_start desc);

alter table public.sales_targets enable row level security;

create policy sales_targets_read_management
  on public.sales_targets for select to authenticated
  using (
    private.smartpos_has_business_role(business_id, array['owner','admin','manager']::text[])
    and private.smartpos_can_access_branch(business_id, branch_id)
  );

create policy sales_targets_insert_management
  on public.sales_targets for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and private.smartpos_has_business_role(business_id, array['owner','admin','manager']::text[])
    and private.smartpos_can_access_branch(business_id, branch_id)
    and (branch_id is not null or private.smartpos_has_business_role(business_id, array['owner','admin']::text[]))
  );

create policy sales_targets_update_management
  on public.sales_targets for update to authenticated
  using (
    private.smartpos_has_business_role(business_id, array['owner','admin','manager']::text[])
    and private.smartpos_can_access_branch(business_id, branch_id)
    and (branch_id is not null or private.smartpos_has_business_role(business_id, array['owner','admin']::text[]))
  )
  with check (
    private.smartpos_has_business_role(business_id, array['owner','admin','manager']::text[])
    and private.smartpos_can_access_branch(business_id, branch_id)
    and (branch_id is not null or private.smartpos_has_business_role(business_id, array['owner','admin']::text[]))
  );

revoke all on table public.sales_targets from anon, authenticated;
grant select on table public.sales_targets to authenticated;
grant insert (business_id, branch_id, period_type, period_start, target_amount, target_transactions, notes, created_by, updated_at)
  on public.sales_targets to authenticated;
grant update (target_amount, target_transactions, notes, updated_at)
  on public.sales_targets to authenticated;

create or replace function public.save_sales_target(
  p_business_id uuid,
  p_branch_id uuid,
  p_period_type text,
  p_period_start date,
  p_target_amount numeric,
  p_target_transactions integer default 0,
  p_notes text default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if not private.smartpos_has_business_role(p_business_id, array['owner','admin','manager']::text[]) then
    raise exception 'Insufficient business role' using errcode = '42501';
  end if;
  if not private.smartpos_can_access_branch(p_business_id, p_branch_id) then
    raise exception 'Branch access denied' using errcode = '42501';
  end if;
  if p_branch_id is null and not private.smartpos_has_business_role(p_business_id, array['owner','admin']::text[]) then
    raise exception 'Only Owner/Admin can set business-wide targets' using errcode = '42501';
  end if;
  if p_period_type not in ('daily','weekly','monthly') then
    raise exception 'Invalid period type' using errcode = '22023';
  end if;
  if p_period_start is null or p_target_amount is null or p_target_amount < 0 or coalesce(p_target_transactions,0) < 0 then
    raise exception 'Invalid target values' using errcode = '22023';
  end if;
  if p_period_type = 'weekly' and extract(isodow from p_period_start) <> 1 then
    raise exception 'Weekly period must start on Monday' using errcode = '22023';
  end if;
  if p_period_type = 'monthly' and extract(day from p_period_start) <> 1 then
    raise exception 'Monthly period must start on day 1' using errcode = '22023';
  end if;
  if p_branch_id is not null and not exists (
    select 1 from public.branches b where b.id = p_branch_id and b.business_id = p_business_id
  ) then
    raise exception 'Branch does not belong to business' using errcode = '22023';
  end if;

  insert into public.sales_targets (
    business_id, branch_id, period_type, period_start, target_amount,
    target_transactions, notes, created_by, updated_at
  ) values (
    p_business_id, p_branch_id, p_period_type, p_period_start, p_target_amount,
    coalesce(p_target_transactions,0), nullif(btrim(p_notes),''), auth.uid(), now()
  )
  on conflict (
    business_id, period_type, period_start,
    (coalesce(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
  )
  do update set
    target_amount = excluded.target_amount,
    target_transactions = excluded.target_transactions,
    notes = excluded.notes,
    updated_at = now()
  returning id into v_id;
  return v_id;
end;
$function$;

create or replace function public.get_sales_target_progress(p_target_id uuid)
returns table (
  target_id uuid, business_id uuid, branch_id uuid, period_type text,
  period_start date, period_end date, target_amount numeric,
  target_transactions integer, actual_sales numeric,
  actual_transactions bigint, achievement_percent numeric
)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_target public.sales_targets%rowtype;
  v_end date;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select * into v_target from public.sales_targets st where st.id = p_target_id;
  if not found then
    raise exception 'Sales target not found' using errcode = 'P0002';
  end if;
  if not private.smartpos_has_business_role(v_target.business_id, array['owner','admin','manager']::text[])
     or not private.smartpos_can_access_branch(v_target.business_id, v_target.branch_id) then
    raise exception 'Access denied' using errcode = '42501';
  end if;

  v_end := case v_target.period_type
    when 'daily' then v_target.period_start + 1
    when 'weekly' then v_target.period_start + 7
    else (v_target.period_start + interval '1 month')::date
  end;

  return query
  select v_target.id, v_target.business_id, v_target.branch_id, v_target.period_type,
    v_target.period_start, v_end, v_target.target_amount, v_target.target_transactions,
    coalesce(sum(s.total),0)::numeric, count(s.id)::bigint,
    case when v_target.target_amount > 0
      then round((coalesce(sum(s.total),0) / v_target.target_amount) * 100, 2)
      else 0::numeric end
  from public.sales s
  where s.business_id = v_target.business_id
    and (v_target.branch_id is null or s.branch_id = v_target.branch_id)
    and s.created_at >= v_target.period_start::timestamptz
    and s.created_at < v_end::timestamptz
    and s.status in ('paid','partial');
end;
$function$;

revoke all on function public.save_sales_target(uuid,uuid,text,date,numeric,integer,text) from public, anon;
revoke all on function public.get_sales_target_progress(uuid) from public, anon;
grant execute on function public.save_sales_target(uuid,uuid,text,date,numeric,integer,text) to authenticated;
grant execute on function public.get_sales_target_progress(uuid) to authenticated;

comment on table public.sales_targets is 'Business and branch sales targets by day, ISO week (Monday start), or calendar month.';
comment on function public.get_sales_target_progress(uuid) is 'Returns sales revenue and transaction count against a saved target for the selected period.';
