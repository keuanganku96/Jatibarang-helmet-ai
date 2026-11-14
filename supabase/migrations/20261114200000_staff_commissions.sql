-- SMART POS staff commissions
alter table public.staff_profiles add column if not exists commission_type text not null default 'percent', add column if not exists commission_value numeric(12,4) not null default 0;
alter table public.staff_profiles drop constraint if exists staff_profiles_commission_type_check;
alter table public.staff_profiles add constraint staff_profiles_commission_type_check check (commission_type in ('percent','per_unit','none'));
alter table public.staff_profiles drop constraint if exists staff_profiles_commission_value_check;
alter table public.staff_profiles add constraint staff_profiles_commission_value_check check (commission_value>=0 and commission_value<=100000000);
create table if not exists public.commission_rules(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.businesses(id) on delete cascade,branch_id uuid references public.branches(id) on delete cascade,product_id uuid references public.products(id) on delete cascade,commission_type text not null check(commission_type in ('percent','per_unit','none')),commission_value numeric(12,4) not null default 0 check(commission_value>=0 and commission_value<=100000000),is_active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique nulls not distinct(business_id,branch_id,product_id));
create index if not exists commission_rules_lookup_idx on public.commission_rules(business_id,branch_id,product_id) where is_active;
alter table public.commission_rules enable row level security;
drop policy if exists commission_rules_read_business on public.commission_rules;
create policy commission_rules_read_business on public.commission_rules for select to authenticated using(public.is_business_member(business_id));
revoke all on public.commission_rules from public,anon,authenticated; grant select on public.commission_rules to authenticated;
create table if not exists public.commission_ledger(id uuid primary key default gen_random_uuid(),business_id uuid not null references public.businesses(id) on delete cascade,branch_id uuid not null references public.branches(id),sale_id uuid not null references public.sales(id) on delete cascade,sale_item_id uuid not null references public.sale_items(id) on delete cascade,staff_user_id uuid not null references auth.users(id),product_id uuid references public.products(id),product_name text not null,quantity numeric(14,3) not null,commission_base numeric(14,2) not null,commission_amount numeric(14,2) not null,commission_type text not null,commission_rate numeric(12,4) not null,status text not null default 'pending' check(status in ('pending','paid','cancelled')),paid_at timestamptz,paid_by uuid references auth.users(id),created_at timestamptz not null default now(),unique(sale_item_id));
create index if not exists commission_ledger_staff_date_idx on public.commission_ledger(business_id,branch_id,staff_user_id,created_at desc);
alter table public.commission_ledger enable row level security;
drop policy if exists commission_ledger_read_branch on public.commission_ledger;
create policy commission_ledger_read_branch on public.commission_ledger for select to authenticated using(public.can_access_branch(business_id,branch_id));
revoke all on public.commission_ledger from public,anon,authenticated; grant select on public.commission_ledger to authenticated;

create or replace function public.save_commission_rule(p_branch_id uuid,p_product_id uuid,p_commission_type text,p_commission_value numeric,p_is_active boolean default true)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_business uuid; v_id uuid;
begin
 if auth.uid() is null then raise exception 'Sesi login tidak valid'; end if;
 select business_id into v_business from public.business_members where user_id=auth.uid() and is_active=true and role in ('owner','admin') order by created_at limit 1;
 if v_business is null then raise exception 'Hanya Owner/Admin yang dapat mengatur komisi'; end if;
 if p_commission_type not in ('percent','per_unit','none') or p_commission_value<0 or p_commission_value>100000000 then raise exception 'Aturan komisi tidak valid'; end if;
 if p_branch_id is not null and not exists(select 1 from public.branches where id=p_branch_id and business_id=v_business) then raise exception 'Cabang tidak valid'; end if;
 if p_product_id is not null and not exists(select 1 from public.products where id=p_product_id and business_id=v_business) then raise exception 'Produk tidak valid'; end if;
 insert into public.commission_rules(business_id,branch_id,product_id,commission_type,commission_value,is_active) values(v_business,p_branch_id,p_product_id,p_commission_type,p_commission_value,coalesce(p_is_active,true))
 on conflict(business_id,branch_id,product_id) do update set commission_type=excluded.commission_type,commission_value=excluded.commission_value,is_active=excluded.is_active,updated_at=now() returning id into v_id;
 insert into public.audit_logs(business_id,user_id,action,table_name,record_id,details) values(v_business,auth.uid(),'commission_rule_upsert','commission_rules',v_id,jsonb_build_object('branch_id',p_branch_id,'product_id',p_product_id,'commission_type',p_commission_type,'commission_value',p_commission_value,'is_active',p_is_active));
 return v_id;
end; $$;
revoke all on function public.save_commission_rule(uuid,uuid,text,numeric,boolean) from public,anon; grant execute on function public.save_commission_rule(uuid,uuid,text,numeric,boolean) to authenticated;

create or replace function private.smartpos_create_sale_commissions()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_staff public.staff_profiles%rowtype; v_item record; v_rule record; v_type text; v_rate numeric; v_base numeric; v_amount numeric; v_total_base numeric;
begin
 if new.status<>'paid' or (tg_op='UPDATE' and old.status='paid') or new.cashier_id is null then return new; end if;
 select * into v_staff from public.staff_profiles where business_id=new.business_id and user_id=new.cashier_id and branch_id=new.branch_id;
 if not found then return new; end if;
 select coalesce(sum(line_total),0) into v_total_base from public.sale_items where sale_id=new.id;
 if v_total_base<=0 then return new; end if;
 for v_item in select id,product_id,product_name,quantity,line_total from public.sale_items where sale_id=new.id loop
  v_type:=v_staff.commission_type; v_rate:=v_staff.commission_value;
  select commission_type,commission_value into v_rule from public.commission_rules where business_id=new.business_id and is_active=true and (branch_id is null or branch_id=new.branch_id) and (product_id is null or product_id=v_item.product_id) order by (branch_id is not null) desc,(product_id is not null) desc limit 1;
  if found then v_type:=v_rule.commission_type; v_rate:=v_rule.commission_value; end if;
  v_base:=round(v_item.line_total*(new.total/v_total_base),2);
  v_amount:=case when v_type='percent' then round(v_base*v_rate/100,2) when v_type='per_unit' then round(v_item.quantity*v_rate,2) else 0 end;
  if v_amount>0 then insert into public.commission_ledger(business_id,branch_id,sale_id,sale_item_id,staff_user_id,product_id,product_name,quantity,commission_base,commission_amount,commission_type,commission_rate) values(new.business_id,new.branch_id,new.id,v_item.id,new.cashier_id,v_item.product_id,v_item.product_name,v_item.quantity,v_base,v_amount,v_type,v_rate) on conflict(sale_item_id) do nothing; end if;
 end loop;
 return new;
end; $$;
drop trigger if exists smartpos_sales_create_commissions on public.sales;
create trigger smartpos_sales_create_commissions after insert or update of status on public.sales for each row execute function private.smartpos_create_sale_commissions();
revoke all on function private.smartpos_create_sale_commissions() from public,anon,authenticated;

drop function if exists public.save_staff_profile(uuid,uuid,text,text,text,text,text,boolean);
create function public.save_staff_profile(p_user_id uuid,p_branch_id uuid,p_employee_code text,p_full_name text,p_phone text default null,p_job_title text default null,p_role text default 'cashier',p_is_active boolean default true,p_commission_type text default 'percent',p_commission_value numeric default 0)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor record; v_target record; v_profile_id uuid; v_code text:=upper(trim(coalesce(p_employee_code,''))); v_name text:=trim(coalesce(p_full_name,''));
begin
 if auth.uid() is null then raise exception 'Sesi login tidak valid'; end if;
 select business_id,role,branch_id into v_actor from public.business_members where user_id=auth.uid() and is_active=true order by created_at limit 1;
 if not found or v_actor.role not in ('owner','admin') then raise exception 'Hanya Owner/Admin yang dapat mengelola data karyawan'; end if;
 select business_id,role,branch_id,is_active into v_target from public.business_members where user_id=p_user_id and business_id=v_actor.business_id for update;
 if not found or v_target.business_id<>v_actor.business_id then raise exception 'Akun karyawan tidak terdaftar pada bisnis ini'; end if;
 if v_target.role='owner' then raise exception 'Peran Owner utama tidak dapat diubah dari menu karyawan'; end if;
 if v_actor.role='admin' and v_target.role='admin' then raise exception 'Admin tidak dapat mengubah akun Admin lain'; end if;
 if p_role not in ('admin','manager','cashier','staff') then raise exception 'Peran karyawan tidak valid'; end if;
 if v_actor.role='admin' and p_role='admin' then raise exception 'Admin tidak dapat memberikan peran Admin'; end if;
 if p_user_id=auth.uid() and not coalesce(p_is_active,true) then raise exception 'Anda tidak dapat menonaktifkan akun sendiri'; end if;
 if v_name='' or length(v_name)>120 then raise exception 'Nama karyawan wajib diisi'; end if;
 if v_code='' or length(v_code)>32 or v_code !~ '^[A-Z0-9_-]+$' then raise exception 'Kode karyawan tidak valid'; end if;
 if p_branch_id is null or not exists(select 1 from public.branches where id=p_branch_id and business_id=v_actor.business_id and is_active=true) then raise exception 'Cabang karyawan tidak valid'; end if;
 if p_commission_type not in ('percent','per_unit','none') or p_commission_value<0 or p_commission_value>100000000 then raise exception 'Pengaturan komisi tidak valid'; end if;
 insert into public.staff_profiles(business_id,user_id,branch_id,employee_code,full_name,phone,job_title,commission_type,commission_value) values(v_actor.business_id,p_user_id,p_branch_id,v_code,v_name,nullif(trim(coalesce(p_phone,'')),''),nullif(trim(coalesce(p_job_title,'')),''),p_commission_type,p_commission_value)
 on conflict(business_id,user_id) do update set branch_id=excluded.branch_id,employee_code=excluded.employee_code,full_name=excluded.full_name,phone=excluded.phone,job_title=excluded.job_title,commission_type=excluded.commission_type,commission_value=excluded.commission_value,updated_at=now() returning id into v_profile_id;
 update public.business_members set branch_id=p_branch_id,role=p_role,is_active=coalesce(p_is_active,true) where user_id=p_user_id and business_id=v_actor.business_id;
 insert into public.audit_logs(business_id,user_id,action,table_name,record_id,details) values(v_actor.business_id,auth.uid(),'staff_profile_upsert','staff_profiles',v_profile_id,jsonb_build_object('target_user_id',p_user_id,'branch_id',p_branch_id,'employee_code',v_code,'role',p_role,'is_active',p_is_active,'commission_type',p_commission_type,'commission_value',p_commission_value));
 return v_profile_id;
end; $$;
revoke all on function public.save_staff_profile(uuid,uuid,text,text,text,text,text,boolean,text,numeric) from public,anon; grant execute on function public.save_staff_profile(uuid,uuid,text,text,text,text,text,boolean,text,numeric) to authenticated;
