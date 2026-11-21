create table if not exists public.stock_opnames (
 id uuid primary key default gen_random_uuid(),
 business_id uuid not null references public.businesses(id) on delete cascade,
 branch_id uuid not null references public.branches(id),
 warehouse_id uuid not null references public.warehouses(id),
 opname_no text not null,
 status text not null default 'draft' check(status in ('draft','approved','cancelled')),
 notes text,total_lines integer not null default 0,total_difference numeric(14,2) not null default 0,
 created_by uuid references auth.users(id),approved_by uuid references auth.users(id),approved_at timestamptz,
 created_at timestamptz not null default now(),unique(business_id,opname_no)
);
create table if not exists public.stock_opname_items (
 id uuid primary key default gen_random_uuid(),opname_id uuid not null references public.stock_opnames(id) on delete cascade,
 business_id uuid not null references public.businesses(id) on delete cascade,product_id uuid not null references public.products(id),
 system_quantity numeric(14,3) not null,counted_quantity numeric(14,3) not null check(counted_quantity>=0),
 difference numeric(14,3) not null,created_at timestamptz not null default now(),unique(opname_id,product_id)
);
create index if not exists stock_opnames_branch_created_idx on public.stock_opnames(business_id,branch_id,created_at desc);
create index if not exists stock_opname_items_opname_idx on public.stock_opname_items(opname_id);
alter table public.stock_opnames enable row level security;
alter table public.stock_opname_items enable row level security;
drop policy if exists stock_opnames_read_branch on public.stock_opnames;
create policy stock_opnames_read_branch on public.stock_opnames for select to authenticated using(public.can_access_branch(business_id,branch_id));
drop policy if exists stock_opname_items_read_branch on public.stock_opname_items;
create policy stock_opname_items_read_branch on public.stock_opname_items for select to authenticated using(exists(select 1 from public.stock_opnames o where o.id=opname_id and public.can_access_branch(o.business_id,o.branch_id)));
grant select on public.stock_opnames,public.stock_opname_items to authenticated;
create or replace function public.create_stock_opname(p_branch_id uuid,p_warehouse_id uuid,p_items jsonb,p_notes text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_business_id uuid; v_opname_id uuid; v_no text;
begin
 if auth.uid() is null then raise exception 'Sesi login tidak valid'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>1000 then raise exception 'Daftar produk opname tidak valid'; end if;
 select business_id into v_business_id from public.business_members where user_id=auth.uid() and is_active=true order by created_at limit 1;
 if v_business_id is null then raise exception 'Anggota bisnis tidak ditemukan'; end if;
 if not private.smartpos_can_access_branch(v_business_id,p_branch_id) then raise exception 'Tidak memiliki akses ke cabang ini'; end if;
 if not exists(select 1 from public.warehouses w where w.id=p_warehouse_id and w.business_id=v_business_id and w.branch_id=p_branch_id and w.is_active=true) then raise exception 'Gudang tidak valid untuk cabang aktif'; end if;
 if exists(select 1 from (select (x->>'product_id')::uuid pid from jsonb_array_elements(p_items) x) q group by pid having count(*)>1) then raise exception 'Produk duplikat dalam opname'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where coalesce((x->>'counted_quantity')::numeric,-1)<0) then raise exception 'Jumlah fisik tidak boleh negatif'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) x left join public.products p on p.id=(x->>'product_id')::uuid and p.business_id=v_business_id and p.is_active=true where p.id is null) then raise exception 'Ada produk yang tidak valid'; end if;
 v_no:='SO-'||to_char(now() at time zone 'Asia/Jakarta','YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,5));
 insert into public.stock_opnames(business_id,branch_id,warehouse_id,opname_no,notes,created_by,total_lines)
 values(v_business_id,p_branch_id,p_warehouse_id,v_no,nullif(left(coalesce(p_notes,''),1000),''),auth.uid(),jsonb_array_length(p_items)) returning id into v_opname_id;
 insert into public.stock_opname_items(opname_id,business_id,product_id,system_quantity,counted_quantity,difference)
 select v_opname_id,v_business_id,p.id,coalesce(i.quantity,0),(x->>'counted_quantity')::numeric,(x->>'counted_quantity')::numeric-coalesce(i.quantity,0)
 from jsonb_array_elements(p_items) x join public.products p on p.id=(x->>'product_id')::uuid and p.business_id=v_business_id
 left join public.inventory i on i.product_id=p.id and i.warehouse_id=p_warehouse_id;
 update public.stock_opnames o set total_difference=(select coalesce(sum(abs(difference)),0) from public.stock_opname_items i where i.opname_id=o.id) where o.id=v_opname_id;
 insert into public.audit_logs(business_id,user_id,action,table_name,record_id,details)
 values(v_business_id,auth.uid(),'stock_opname_created','stock_opnames',v_opname_id,jsonb_build_object('branch_id',p_branch_id,'warehouse_id',p_warehouse_id,'lines',jsonb_array_length(p_items)));
 return v_opname_id;
end; $$;
create or replace function public.approve_stock_opname(p_opname_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_op public.stock_opnames%rowtype; v_item record;
begin
 if auth.uid() is null then raise exception 'Sesi login tidak valid'; end if;
 select * into v_op from public.stock_opnames where id=p_opname_id for update;
 if not found then raise exception 'Dokumen stok opname tidak ditemukan'; end if;
 if not private.smartpos_has_business_role(v_op.business_id,array['owner','admin']) then raise exception 'Persetujuan stok opname hanya dapat dilakukan Owner/Admin'; end if;
 if not private.smartpos_can_access_branch(v_op.business_id,v_op.branch_id) then raise exception 'Tidak memiliki akses ke cabang ini'; end if;
 if v_op.status<>'draft' then raise exception 'Dokumen opname sudah diproses'; end if;
 for v_item in select * from public.stock_opname_items where opname_id=v_op.id order by product_id loop
   perform 1 from public.inventory where product_id=v_item.product_id and warehouse_id=v_op.warehouse_id for update;
   insert into public.inventory(business_id,product_id,warehouse_id,quantity) values(v_op.business_id,v_item.product_id,v_op.warehouse_id,v_item.counted_quantity)
   on conflict(product_id,warehouse_id) do update set quantity=excluded.quantity,updated_at=now();
   if v_item.difference<>0 then
     insert into public.stock_movements(business_id,product_id,warehouse_id,movement_type,quantity_change,reference_type,reference_id,notes,created_by)
     values(v_op.business_id,v_item.product_id,v_op.warehouse_id,'adjustment',v_item.difference,'stock_opname',v_op.id,'Penyesuaian hasil stok opname',auth.uid());
   end if;
 end loop;
 update public.stock_opnames set status='approved',approved_by=auth.uid(),approved_at=now() where id=v_op.id;
 insert into public.audit_logs(business_id,user_id,action,table_name,record_id,details)
 values(v_op.business_id,auth.uid(),'stock_opname_approved','stock_opnames',v_op.id,jsonb_build_object('warehouse_id',v_op.warehouse_id,'total_lines',v_op.total_lines,'total_difference',v_op.total_difference));
end; $$;
revoke all on function public.create_stock_opname(uuid,uuid,jsonb,text) from public,anon;
revoke all on function public.approve_stock_opname(uuid) from public,anon;
grant execute on function public.create_stock_opname(uuid,uuid,jsonb,text) to authenticated;
grant execute on function public.approve_stock_opname(uuid) to authenticated;