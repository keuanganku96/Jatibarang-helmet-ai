create or replace function public.get_profit_loss_summary_v2(
  p_business_id uuid,
  p_branch_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz
)
returns table(
  sales_count bigint,
  revenue numeric,
  hpp numeric,
  gross_profit numeric,
  commission_expenses numeric,
  operating_expenses numeric,
  other_income numeric,
  net_profit numeric,
  missing_cost_items bigint,
  missing_cost_sales bigint
)
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_missing_items bigint;
  v_missing_sales bigint;
  v_known_hpp numeric;
  v_revenue numeric;
  v_sales_count bigint;
  v_commissions numeric;
  v_expenses numeric;
  v_other_income numeric;
begin
  if auth.uid() is null then
    raise exception 'Silakan masuk terlebih dahulu.';
  end if;
  if not private.smartpos_has_business_role(p_business_id,array['owner','admin','manager']::text[]) then
    raise exception 'Laporan laba rugi hanya dapat diakses Owner, Admin, atau Manager.';
  end if;
  if p_branch_id is null then
    if not private.smartpos_has_business_role(p_business_id,array['owner','admin']::text[]) then
      raise exception 'Hanya Owner/Admin yang dapat melihat konsolidasi seluruh cabang.';
    end if;
  elsif not private.smartpos_can_access_branch(p_business_id,p_branch_id) then
    raise exception 'Akses ke cabang ini tidak diizinkan.';
  end if;

  with filtered_sales as (
    select s.id,s.total
    from public.sales s
    where s.business_id=p_business_id
      and s.status='paid'
      and (p_branch_id is null or s.branch_id=p_branch_id)
      and (p_start_at is null or s.created_at>=p_start_at)
      and (p_end_at is null or s.created_at<p_end_at)
  ),
  cost_summary as (
    select
      count(*) filter (where si.id is null or si.unit_cost is null)::bigint as missing_items,
      count(distinct fs.id) filter (where si.id is null or si.unit_cost is null)::bigint as missing_sales,
      coalesce(sum(si.unit_cost*si.quantity) filter (where si.unit_cost is not null),0)::numeric as known_hpp
    from filtered_sales fs
    left join public.sale_items si on si.sale_id=fs.id
  )
  select
    (select count(*) from filtered_sales)::bigint,
    coalesce((select sum(total) from filtered_sales),0)::numeric,
    cs.missing_items,cs.missing_sales,cs.known_hpp
  into v_sales_count,v_revenue,v_missing_items,v_missing_sales,v_known_hpp
  from cost_summary cs;

  select coalesce(sum(cl.commission_amount),0)::numeric
  into v_commissions
  from public.commission_ledger cl
  join public.sales s on s.id=cl.sale_id
  where cl.business_id=p_business_id
    and s.status='paid'
    and (p_branch_id is null or cl.branch_id=p_branch_id)
    and (p_start_at is null or s.created_at>=p_start_at)
    and (p_end_at is null or s.created_at<p_end_at);

  select coalesce(sum(ce.amount),0)::numeric into v_expenses
  from public.cash_entries ce
  where ce.business_id=p_business_id
    and ce.entry_type='expense'
    and ce.category not in ('Pembayaran Supplier','Komisi Karyawan')
    and (p_branch_id is null or ce.branch_id=p_branch_id)
    and (p_start_at is null or ce.created_at>=p_start_at)
    and (p_end_at is null or ce.created_at<p_end_at);

  select coalesce(sum(ce.amount),0)::numeric into v_other_income
  from public.cash_entries ce
  where ce.business_id=p_business_id
    and ce.entry_type='income'
    and ce.category='Pendapatan lain'
    and (p_branch_id is null or ce.branch_id=p_branch_id)
    and (p_start_at is null or ce.created_at>=p_start_at)
    and (p_end_at is null or ce.created_at<p_end_at);

  sales_count:=v_sales_count;
  revenue:=v_revenue;
  hpp:=case when v_missing_items>0 or v_missing_sales>0 then null else v_known_hpp end;
  gross_profit:=case when v_missing_items>0 or v_missing_sales>0 then null else v_revenue-v_known_hpp end;
  commission_expenses:=v_commissions;
  operating_expenses:=v_expenses;
  other_income:=v_other_income;
  net_profit:=case when v_missing_items>0 or v_missing_sales>0 then null
    else v_revenue-v_known_hpp-v_commissions-v_expenses+v_other_income end;
  missing_cost_items:=v_missing_items;
  missing_cost_sales:=v_missing_sales;
  return next;
end;
$function$;

revoke all on function public.get_profit_loss_summary_v2(uuid,uuid,timestamptz,timestamptz) from public, anon;
grant execute on function public.get_profit_loss_summary_v2(uuid,uuid,timestamptz,timestamptz) to authenticated;
