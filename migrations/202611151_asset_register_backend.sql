create table if not exists public.fixed_assets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid not null references public.branches(id) on delete restrict,
  asset_code text not null,
  asset_name text not null,
  category text not null default 'Peralatan toko',
  description text,
  serial_number text,
  acquired_on date not null default current_date,
  acquisition_cost numeric(18,2) not null check (acquisition_cost >= 0),
  residual_value numeric(18,2) not null default 0 check (residual_value >= 0),
  useful_life_months integer not null default 0 check (useful_life_months >= 0),
  status text not null default 'active' check (status in ('active','maintenance','disposed','lost')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fixed_assets_residual_lte_cost check (residual_value <= acquisition_cost),
  constraint fixed_assets_code_unique unique (business_id, asset_code)
);
create index if not exists fixed_assets_branch_status_idx on public.fixed_assets(business_id,branch_id,status);
create index if not exists fixed_assets_acquired_idx on public.fixed_assets(business_id,acquired_on desc);
create table if not exists public.fixed_asset_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  asset_id uuid not null references public.fixed_assets(id) on delete restrict,
  event_type text not null check (event_type in ('created','status_changed','note')),
  old_status text,
  new_status text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists fixed_asset_events_asset_idx on public.fixed_asset_events(asset_id,created_at desc);
alter table public.fixed_assets enable row level security;
alter table public.fixed_asset_events enable row level security;
drop policy if exists fixed_assets_read_management on public.fixed_assets;
create policy fixed_assets_read_management on public.fixed_assets for select to authenticated
using (private.smartpos_has_business_role(business_id,array['owner','admin','manager']::text[]) and private.smartpos_can_access_branch(business_id,branch_id));
drop policy if exists fixed_asset_events_read_management on public.fixed_asset_events;
create policy fixed_asset_events_read_management on public.fixed_asset_events for select to authenticated
using (private.smartpos_has_business_role(business_id,array['owner','admin','manager']::text[]) and exists (
 select 1 from public.fixed_assets a where a.id=fixed_asset_events.asset_id and private.smartpos_can_access_branch(a.business_id,a.branch_id)
));
revoke insert,update,delete on public.fixed_assets from anon,authenticated;
revoke insert,update,delete on public.fixed_asset_events from anon,authenticated;
grant select on public.fixed_assets,public.fixed_asset_events to authenticated;
create or replace function public.create_fixed_asset(
 p_business_id uuid,p_branch_id uuid,p_asset_code text,p_asset_name text,p_category text,
 p_description text,p_serial_number text,p_acquired_on date,p_acquisition_cost numeric,
 p_residual_value numeric,p_useful_life_months integer,p_notes text
) returns uuid language plpgsql security definer set search_path=''
as $$
declare v_id uuid;
begin
 if auth.uid() is null or not private.smartpos_has_business_role(p_business_id,array['owner','admin','manager']::text[]) then raise exception 'Hanya Owner, Admin, atau Manager yang dapat mencatat aset.'; end if;
 if not private.smartpos_can_access_branch(p_business_id,p_branch_id) then raise exception 'Akses cabang tidak diizinkan.'; end if;
 if not exists(select 1 from public.branches b where b.id=p_branch_id and b.business_id=p_business_id and b.is_active) then raise exception 'Cabang tidak aktif atau tidak ditemukan.'; end if;
 if coalesce(trim(p_asset_code),'')='' or coalesce(trim(p_asset_name),'')='' then raise exception 'Kode dan nama aset wajib diisi.'; end if;
 if length(trim(p_asset_code))>60 or length(trim(p_asset_name))>180 then raise exception 'Kode atau nama aset terlalu panjang.'; end if;
 if p_acquisition_cost is null or p_acquisition_cost<0 or coalesce(p_residual_value,0)<0 or coalesce(p_residual_value,0)>p_acquisition_cost or coalesce(p_useful_life_months,0)<0 then raise exception 'Nilai perolehan, residu, atau umur manfaat tidak valid.'; end if;
 insert into public.fixed_assets(business_id,branch_id,asset_code,asset_name,category,description,serial_number,acquired_on,acquisition_cost,residual_value,useful_life_months,notes,created_by)
 values(p_business_id,p_branch_id,trim(p_asset_code),trim(p_asset_name),coalesce(nullif(trim(p_category),''),'Peralatan toko'),nullif(trim(p_description),''),nullif(trim(p_serial_number),''),coalesce(p_acquired_on,current_date),p_acquisition_cost,coalesce(p_residual_value,0),coalesce(p_useful_life_months,0),nullif(trim(p_notes),''),auth.uid()) returning id into v_id;
 insert into public.fixed_asset_events(business_id,asset_id,event_type,new_status,notes,created_by) values(p_business_id,v_id,'created','active','Aset didaftarkan',auth.uid());
 insert into public.audit_logs(business_id,user_id,action,table_name,record_id,details) values(p_business_id,auth.uid(),'asset.created','fixed_assets',v_id,jsonb_build_object('asset_code',trim(p_asset_code),'asset_name',trim(p_asset_name),'branch_id',p_branch_id,'acquisition_cost',p_acquisition_cost));
 return v_id;
end; $$;
create or replace function public.update_fixed_asset_status(p_asset_id uuid,p_new_status text,p_notes text default null)
returns void language plpgsql security definer set search_path=''
as $$
declare v_asset public.fixed_assets%rowtype;
begin
 if auth.uid() is null then raise exception 'Silakan masuk terlebih dahulu.'; end if;
 select * into v_asset from public.fixed_assets where id=p_asset_id for update;
 if not found then raise exception 'Aset tidak ditemukan.'; end if;
 if not private.smartpos_has_business_role(v_asset.business_id,array['owner','admin','manager']::text[]) or not private.smartpos_can_access_branch(v_asset.business_id,v_asset.branch_id) then raise exception 'Akses mengubah aset tidak diizinkan.'; end if;
 if p_new_status not in ('active','maintenance','disposed','lost') then raise exception 'Status aset tidak valid.'; end if;
 if v_asset.status='disposed' and p_new_status<>'disposed' then raise exception 'Aset yang sudah dilepas tidak dapat diaktifkan kembali melalui perubahan status biasa.'; end if;
 update public.fixed_assets set status=p_new_status,notes=coalesce(nullif(trim(p_notes),''),notes),updated_at=now() where id=p_asset_id;
 insert into public.fixed_asset_events(business_id,asset_id,event_type,old_status,new_status,notes,created_by) values(v_asset.business_id,p_asset_id,'status_changed',v_asset.status,p_new_status,nullif(trim(p_notes),''),auth.uid());
 insert into public.audit_logs(business_id,user_id,action,table_name,record_id,details) values(v_asset.business_id,auth.uid(),'asset.status_changed','fixed_assets',p_asset_id,jsonb_build_object('old_status',v_asset.status,'new_status',p_new_status,'notes',p_notes));
end; $$;
revoke all on function public.create_fixed_asset(uuid,uuid,text,text,text,text,text,date,numeric,numeric,integer,text) from public,anon;
grant execute on function public.create_fixed_asset(uuid,uuid,text,text,text,text,text,date,numeric,numeric,integer,text) to authenticated;
revoke all on function public.update_fixed_asset_status(uuid,text,text) from public,anon;
grant execute on function public.update_fixed_asset_status(uuid,text,text) to authenticated;
