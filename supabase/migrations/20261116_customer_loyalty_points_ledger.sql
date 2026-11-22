create table if not exists public.loyalty_programs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null unique references public.businesses(id) on delete cascade,
  is_enabled boolean not null default false,
  earn_amount_per_point numeric(14,2),
  redemption_value_per_point numeric(14,2),
  minimum_redeem_points integer not null default 1,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loyalty_earn_amount_positive check (earn_amount_per_point is null or earn_amount_per_point > 0),
  constraint loyalty_redeem_value_positive check (redemption_value_per_point is null or redemption_value_per_point > 0),
  constraint loyalty_minimum_positive check (minimum_redeem_points > 0)
);

create table if not exists public.loyalty_point_ledger (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete restrict,
  branch_id uuid references public.branches(id) on delete set null,
  event_type text not null check (event_type in ('earn','redeem','adjustment','reversal')),
  points_delta integer not null check (points_delta <> 0),
  reference_type text not null,
  reference_id uuid not null,
  description text,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint loyalty_ledger_event_sign check (
    (event_type in ('earn','adjustment') and points_delta > 0)
    or (event_type in ('redeem','reversal') and points_delta < 0)
  )
);
create unique index if not exists loyalty_ledger_idempotency
on public.loyalty_point_ledger(business_id,event_type,reference_type,reference_id);
create index if not exists loyalty_ledger_customer_history
on public.loyalty_point_ledger(business_id,customer_id,created_at desc);

alter table public.loyalty_programs enable row level security;
alter table public.loyalty_point_ledger enable row level security;
drop policy if exists loyalty_programs_read on public.loyalty_programs;
create policy loyalty_programs_read on public.loyalty_programs for select to authenticated
using (private.smartpos_has_business_role(business_id,array['owner','admin','manager','cashier']::text[]));
drop policy if exists loyalty_ledger_read on public.loyalty_point_ledger;
create policy loyalty_ledger_read on public.loyalty_point_ledger for select to authenticated
using (private.smartpos_has_business_role(business_id,array['owner','admin','manager','cashier']::text[])
and (branch_id is null or private.smartpos_can_access_branch(business_id,branch_id)));
revoke insert, update, delete on public.loyalty_programs from anon, authenticated;
revoke insert, update, delete on public.loyalty_point_ledger from anon, authenticated;
grant select on public.loyalty_programs, public.loyalty_point_ledger to authenticated;

create or replace function public.configure_loyalty_program(
 p_business_id uuid,p_is_enabled boolean,p_earn_amount_per_point numeric,
 p_redemption_value_per_point numeric,p_minimum_redeem_points integer default 1
) returns void language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if not private.smartpos_has_business_role(p_business_id,array['owner','admin']::text[]) then
  raise exception 'Hanya Owner/Admin yang dapat mengatur program poin.' using errcode='42501';
 end if;
 if p_minimum_redeem_points is null or p_minimum_redeem_points < 1 then raise exception 'Minimum penukaran harus minimal 1 poin.'; end if;
 if p_is_enabled and (p_earn_amount_per_point is null or p_earn_amount_per_point <= 0
   or p_redemption_value_per_point is null or p_redemption_value_per_point <= 0) then
  raise exception 'Nilai perolehan dan nilai tukar poin wajib diisi positif sebelum program diaktifkan.';
 end if;
 insert into public.loyalty_programs(business_id,is_enabled,earn_amount_per_point,redemption_value_per_point,minimum_redeem_points,updated_by,updated_at)
 values(p_business_id,p_is_enabled,p_earn_amount_per_point,p_redemption_value_per_point,p_minimum_redeem_points,auth.uid(),now())
 on conflict(business_id) do update set is_enabled=excluded.is_enabled,
 earn_amount_per_point=excluded.earn_amount_per_point,redemption_value_per_point=excluded.redemption_value_per_point,
 minimum_redeem_points=excluded.minimum_redeem_points,updated_by=excluded.updated_by,updated_at=now();
end; $$;

create or replace function public.redeem_loyalty_points(
 p_customer_id uuid,p_points integer,p_branch_id uuid,p_reference_id uuid,p_description text default null
) returns integer language plpgsql security definer set search_path = '' as $$
declare v_business_id uuid; v_balance bigint; v_minimum integer; v_enabled boolean;
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_points is null or p_points<=0 or p_reference_id is null then raise exception 'Jumlah poin dan referensi penukaran tidak valid.'; end if;
 select c.business_id into v_business_id from public.customers c where c.id=p_customer_id for update;
 if not found then raise exception 'Pelanggan tidak ditemukan.'; end if;
 if not private.smartpos_has_business_role(v_business_id,array['owner','admin','manager','cashier']::text[])
 or (p_branch_id is not null and not private.smartpos_can_access_branch(v_business_id,p_branch_id)) then
  raise exception 'Akses penukaran poin ditolak.' using errcode='42501';
 end if;
 select lp.is_enabled,lp.minimum_redeem_points into v_enabled,v_minimum from public.loyalty_programs lp where lp.business_id=v_business_id;
 if not coalesce(v_enabled,false) then raise exception 'Program loyalty belum diaktifkan.'; end if;
 if p_points<coalesce(v_minimum,1) then raise exception 'Jumlah poin di bawah minimum penukaran.'; end if;
 select coalesce(sum(points_delta),0) into v_balance from public.loyalty_point_ledger where business_id=v_business_id and customer_id=p_customer_id;
 if v_balance<p_points then raise exception 'Poin pelanggan tidak mencukupi. Saldo: %.',v_balance; end if;
 insert into public.loyalty_point_ledger(business_id,customer_id,branch_id,event_type,points_delta,reference_type,reference_id,description,created_by)
 values(v_business_id,p_customer_id,p_branch_id,'redeem',-p_points,'manual_redemption',p_reference_id,left(coalesce(p_description,'Penukaran poin'),500),auth.uid());
 return v_balance-p_points;
exception when unique_violation then raise exception 'Referensi penukaran ini sudah pernah diproses.';
end; $$;

create or replace function private.smartpos_award_loyalty_points()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_program public.loyalty_programs%rowtype; v_points integer;
begin
 if new.customer_id is null or new.status<>'paid' then return new; end if;
 if tg_op='UPDATE' and old.status='paid' then return new; end if;
 select * into v_program from public.loyalty_programs where business_id=new.business_id and is_enabled=true;
 if not found or v_program.earn_amount_per_point is null then return new; end if;
 v_points:=floor(greatest(new.total,0)/v_program.earn_amount_per_point)::integer;
 if v_points<=0 then return new; end if;
 insert into public.loyalty_point_ledger(business_id,customer_id,branch_id,event_type,points_delta,reference_type,reference_id,description)
 values(new.business_id,new.customer_id,new.branch_id,'earn',v_points,'sale',new.id,'Poin dari invoice '||new.invoice_no)
 on conflict(business_id,event_type,reference_type,reference_id) do nothing;
 return new;
end; $$;

create or replace function private.smartpos_reverse_loyalty_points()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_sale public.sales%rowtype; v_earned integer; v_total_refunded numeric;
 v_target_reversed integer; v_already_reversed integer; v_delta integer;
begin
 if new.refund_amount is null or new.refund_amount<=0 then return new; end if;
 select * into v_sale from public.sales where id=new.sale_id;
 if not found or v_sale.customer_id is null or v_sale.total<=0 then return new; end if;
 select coalesce(sum(points_delta),0)::integer into v_earned from public.loyalty_point_ledger
 where business_id=v_sale.business_id and reference_type='sale' and reference_id=v_sale.id and event_type='earn';
 if v_earned<=0 then return new; end if;
 select coalesce(sum(refund_amount),0) into v_total_refunded from public.sale_returns where sale_id=v_sale.id and refund_amount>0;
 v_target_reversed:=least(v_earned,floor(v_earned*least(v_total_refunded/v_sale.total,1))::integer);
 select coalesce(-sum(points_delta),0)::integer into v_already_reversed from public.loyalty_point_ledger
 where business_id=v_sale.business_id and customer_id=v_sale.customer_id and event_type='reversal'
 and reference_type='sale_return' and reference_id in(select id from public.sale_returns where sale_id=v_sale.id);
 v_delta:=v_target_reversed-v_already_reversed;
 if v_delta>0 then
  insert into public.loyalty_point_ledger(business_id,customer_id,branch_id,event_type,points_delta,reference_type,reference_id,description,created_by)
  values(v_sale.business_id,v_sale.customer_id,v_sale.branch_id,'reversal',-v_delta,'sale_return',new.id,
   'Pembatalan poin akibat retur '||new.return_no,new.created_by)
  on conflict(business_id,event_type,reference_type,reference_id) do nothing;
 end if;
 return new;
end; $$;

drop trigger if exists trg_sales_award_loyalty_points on public.sales;
create trigger trg_sales_award_loyalty_points after insert or update of status on public.sales
for each row execute function private.smartpos_award_loyalty_points();
drop trigger if exists trg_sale_returns_reverse_loyalty_points on public.sale_returns;
create trigger trg_sale_returns_reverse_loyalty_points after insert or update of refund_amount on public.sale_returns
for each row execute function private.smartpos_reverse_loyalty_points();

revoke all on function public.configure_loyalty_program(uuid,boolean,numeric,numeric,integer) from public,anon;
revoke all on function public.redeem_loyalty_points(uuid,integer,uuid,uuid,text) from public,anon;
grant execute on function public.configure_loyalty_program(uuid,boolean,numeric,numeric,integer) to authenticated;
grant execute on function public.redeem_loyalty_points(uuid,integer,uuid,uuid,text) to authenticated;
