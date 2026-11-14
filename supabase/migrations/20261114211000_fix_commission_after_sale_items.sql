create or replace function private.smartpos_record_sale_commissions(p_sale_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_sale public.sales%rowtype; v_staff public.staff_profiles%rowtype;
  v_item record; v_rule record; v_type text; v_rate numeric; v_base numeric; v_amount numeric; v_total_base numeric;
begin
  select * into v_sale from public.sales where id=p_sale_id;
  if not found or v_sale.status <> 'paid' or v_sale.cashier_id is null then return; end if;
  select * into v_staff from public.staff_profiles
  where business_id=v_sale.business_id and user_id=v_sale.cashier_id and branch_id=v_sale.branch_id;
  if not found then return; end if;
  select coalesce(sum(line_total),0) into v_total_base from public.sale_items where sale_id=v_sale.id;
  if v_total_base <= 0 then return; end if;
  for v_item in select id,product_id,product_name,quantity,line_total from public.sale_items where sale_id=v_sale.id loop
    v_type:=v_staff.commission_type; v_rate:=v_staff.commission_value;
    select commission_type,commission_value into v_rule from public.commission_rules
    where business_id=v_sale.business_id and is_active=true
      and (branch_id is null or branch_id=v_sale.branch_id)
      and (product_id is null or product_id=v_item.product_id)
    order by (branch_id is not null) desc,(product_id is not null) desc limit 1;
    if found then v_type:=v_rule.commission_type; v_rate:=v_rule.commission_value; end if;
    v_base:=round(v_item.line_total*(v_sale.total/v_total_base),2);
    v_amount:=case when v_type='percent' then round(v_base*v_rate/100,2)
      when v_type='per_unit' then round(v_item.quantity*v_rate,2) else 0 end;
    if v_amount>0 then
      insert into public.commission_ledger(business_id,branch_id,sale_id,sale_item_id,staff_user_id,product_id,product_name,quantity,commission_base,commission_amount,commission_type,commission_rate)
      values(v_sale.business_id,v_sale.branch_id,v_sale.id,v_item.id,v_sale.cashier_id,v_item.product_id,v_item.product_name,v_item.quantity,v_base,v_amount,v_type,v_rate)
      on conflict(sale_item_id) do nothing;
    end if;
  end loop;
end;
$$;
revoke all on function private.smartpos_record_sale_commissions(uuid) from public,anon,authenticated;
create or replace function private.smartpos_create_sale_commissions()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if new.status <> 'paid' or (tg_op='UPDATE' and old.status='paid') or new.cashier_id is null then return new; end if;
  perform private.smartpos_record_sale_commissions(new.id);
  return new;
end;
$$;
revoke all on function private.smartpos_create_sale_commissions() from public,anon,authenticated;
create or replace function private.smartpos_create_sale_item_commissions()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  perform private.smartpos_record_sale_commissions(new.sale_id);
  return new;
end;
$$;
revoke all on function private.smartpos_create_sale_item_commissions() from public,anon,authenticated;
drop trigger if exists smartpos_sale_items_create_commissions on public.sale_items;
create constraint trigger smartpos_sale_items_create_commissions
after insert on public.sale_items deferrable initially deferred
for each row execute function private.smartpos_create_sale_item_commissions();