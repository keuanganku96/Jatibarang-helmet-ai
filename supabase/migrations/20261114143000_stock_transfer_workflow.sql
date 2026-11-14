create table if not exists public.stock_transfers (
 id uuid primary key default gen_random_uuid(),business_id uuid not null references public.businesses(id) on delete cascade,
 from_branch_id uuid not null references public.branches(id),to_branch_id uuid not null references public.branches(id),
 from_warehouse_id uuid not null references public.warehouses(id),to_warehouse_id uuid not null references public.warehouses(id),
 transfer_no text not null,status text not null default 'draft' check(status in ('draft','approved','cancelled')),
 notes text,total_lines integer not null default 0,created_by uuid references auth.users(id),
 approved_by uuid references auth.users(id),approved_at timestamptz,created_at timestamptz not null default now(),
 unique(business_id,transfer_no),check(from_warehouse_id<>to_warehouse_id)
);
create table if not exists public.stock_transfer_items (
 id uuid primary key default gen_random_uuid(),transfer_id uuid not null references public.stock_transfers(id) on delete cascade,
 business_id uuid not null references public.businesses(id) on delete cascade,product_id uuid not null references public.products(id),
 quantity numeric(14,3) not null check(quantity>0),created_at timestamptz not null default now(),unique(transfer_id,product_id)
);
create index if not exists stock_transfers_created_idx on public.stock_transfers(business_id,created_at desc);
create index if not exists stock_transfer_items_transfer_idx on public.stock_transfer_items(transfer_id);
alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_items enable row level security;
drop policy if exists stock_transfers_read_branches on public.stock_transfers;
create policy stock_transfers_read_branches on public.stock_transfers for select to authenticated
using(public.can_access_branch(business_id,from_branch_id) and public.can_access_branch(business_id,to_branch_id));
drop policy if exists stock_transfer_items_read_branches on public.stock_transfer_items;
create policy stock_transfer_items_read_branches on public.stock_transfer_items for select to authenticated
using(exists(select 1 from public.stock_transfers t where t.id=transfer_id and public.can_access_branch(t.business_id,t.from_branch_id) and public.can_access_branch(t.business_id,t.to_branch_id)));
revoke all on public.stock_transfers,public.stock_transfer_items from public,anon,authenticated;
grant select on public.stock_transfers,public.stock_transfer_items to authenticated;

create or replace function public.create_stock_transfer(p_from_warehouse_id uuid,p_to_warehouse_id uuid,p_items jsonb,p_notes text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_business_id uuid; v_from_branch uuid; v_to_branch uuid; v_id uuid; v_no text;
begin
 if auth.uid() is null then raise exception 'Sesi login tidak valid'; end if;
 if p_items is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>500 then raise exception 'Daftar barang transfer tidak valid'; end if;
 select business_id,branch_id into v_business_id,v_from_branch from public.warehouses where id=p_from_warehouse_id and is_active=true;
 select branch_id into v_to_branch from public.warehouses where id=p_to_warehouse_id and business_id=v_business_id and is_active=true;
 if v_business_id is null or v_to_branch is null then raise exception 'Gudang asal atau tujuan tidak valid'; end if;
 if p_from_warehouse_id=p_to_warehouse_id then raise exception 'Gudang asal dan tujuan harus berbeda'; end if;
 if not private.smartpos_can_access_branch(v_business_id,v_from_branch) or not private.smartpos_can_access_branch(v_business_id,v_to_branch) then raise exception 'Tidak memiliki akses ke kedua cabang'; end if;
 if exists(select 1 from (select (x->>'product_id')::uuid pid from jsonb_array_elements(p_items) x) q group by pid having count(*)>1) then raise exception 'Produk duplikat dalam transfer'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) x where coalesce((x->>'quantity')::numeric,0)<=0) then raise exception 'Jumlah transfer harus lebih dari nol'; end if;
 if exists(select 1 from jsonb_array_elements(p_items) x left join public.products p on p.id=(x->>'product_id')::uuid and p.business_id=v_business_id and p.is_active=true where p.id is null) then raise exception 'Ada produk tidak valid'; end if;
 v_no:='TR-'||to_char(now() at time zone 'Asia/Jakarta','YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,5));
 insert into public.stock_transfers(business_id,from_branch_id,to_branch_id,from_warehouse_id,to_warehouse_id,transfer_no,notes,total_lines,created_by)
 values(v_business_id,v_from_branch,v_to_branch,p_from_warehouse_id,p_to_warehouse_id,v_no,nullif(left(coalesce(p_notes,''),1000),''),jsonb_array_length(p_items),auth.uid()) returning id into v_id;
 insert into public.stock_transfer_items(transfer_id,business_id,product_id,quantity)
 select v_id,v_business_id,p.id,(x->>'quantity')::numeric from jsonb_array_elements(p_items) x
 join public.products p on p.id=(x->>'product_id')::uuid and p.business_id=v_business_id;
 insert into public.audit_logs(business_id,user_id,action,table_name,record_id,details)
 values(v_business_id,auth.uid(),'stock_transfer_created','stock_transfers',v_id,jsonb_build_object('from_branch_id',v_from_branch,'to_branch_id',v_to_branch,'lines',jsonb_array_length(p_items)));
 return v_id;
end; $$;

create or replace function public.approve_stock_transfer(p_transfer_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v public.stock_transfers%rowtype; i record; v_stock numeric(14,3);
begin
 if auth.uid() is null then raise exception 'Sesi login tidak valid'; end if;
 select * into v from public.stock_transfers where id=p_transfer_id for update;
 if not found then raise exception 'Dokumen transfer tidak ditemukan'; end if;
 if not private.smartpos_has_business_role(v.business_id,array['owner','admin','manager']) then raise exception 'Hanya Owner/Admin/Manager yang dapat menyetujui transfer'; end if;
 if not private.smartpos_can_access_branch(v.business_id,v.from_branch_id) or not private.smartpos_can_access_branch(v.business_id,v.to_branch_id) then raise exception 'Tidak memiliki akses ke kedua cabang'; end if;
 if v.status<>'draft' then raise exception 'Transfer sudah diproses'; end if;
 for i in select * from public.stock_transfer_items where transfer_id=v.id order by product_id loop
   select coalesce(quantity,0) into v_stock from public.inventory where product_id=i.product_id and warehouse_id=v.from_warehouse_id for update;
   if not found then v_stock:=0; end if;
   if v_stock<i.quantity then raise exception 'Stok tidak cukup untuk salah satu barang. Transfer dibatalkan.'; end if;
 end loop;
 for i in select * from public.stock_transfer_items where transfer_id=v.id order by product_id loop
   update public.inventory set quantity=quantity-i.quantity,updated_at=now() where product_id=i.product_id and warehouse_id=v.from_warehouse_id;
   insert into public.inventory(business_id,product_id,warehouse_id,quantity) values(v.business_id,i.product_id,v.to_warehouse_id,i.quantity)
   on conflict(product_id,warehouse_id) do update set quantity=inventory.quantity+excluded.quantity,updated_at=now();
   insert into public.stock_movements(business_id,product_id,warehouse_id,movement_type,quantity_change,reference_type,reference_id,notes,created_by)
   values(v.business_id,i.product_id,v.from_warehouse_id,'transfer_out',-i.quantity,'stock_transfer',v.id,'Transfer keluar ke gudang tujuan',auth.uid()),
         (v.business_id,i.product_id,v.to_warehouse_id,'transfer_in',i.quantity,'stock_transfer',v.id,'Transfer masuk dari gudang asal',auth.uid());
 end loop;
 update public.stock_transfers set status='approved',approved_by=auth.uid(),approved_at=now() where id=v.id;
 insert into public.audit_logs(business_id,user_id,action,table_name,record_id,details)
 values(v.business_id,auth.uid(),'stock_transfer_approved','stock_transfers',v.id,jsonb_build_object('from_warehouse_id',v.from_warehouse_id,'to_warehouse_id',v.to_warehouse_id,'lines',v.total_lines));
end; $$;
revoke all on function public.create_stock_transfer(uuid,uuid,jsonb,text) from public,anon;
revoke all on function public.approve_stock_transfer(uuid) from public,anon;
grant execute on function public.create_stock_transfer(uuid,uuid,jsonb,text) to authenticated;
grant execute on function public.approve_stock_transfer(uuid) to authenticated;