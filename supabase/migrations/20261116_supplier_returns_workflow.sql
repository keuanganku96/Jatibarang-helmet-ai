-- SMART POS JATIBARANG: supplier purchase returns.
-- Draft returns do not change stock. Only Owner/Admin approval reduces inventory.
-- Return quantities are capped against the original received purchase line.

create table if not exists public.supplier_returns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  warehouse_id uuid not null references public.warehouses(id),
  purchase_id uuid not null references public.purchase_orders(id),
  supplier_id uuid not null references public.suppliers(id),
  return_no text not null,
  status text not null default 'draft' check (status in ('draft','approved','cancelled')),
  reason text not null,
  notes text,
  total numeric(14,2) not null default 0 check (total >= 0),
  created_by uuid not null references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (business_id, return_no)
);

create table if not exists public.supplier_return_items (
  id uuid primary key default gen_random_uuid(),
  supplier_return_id uuid not null references public.supplier_returns(id) on delete cascade,
  business_id uuid not null references public.businesses(id) on delete cascade,
  purchase_item_id uuid not null references public.purchase_items(id),
  product_id uuid not null references public.products(id),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  line_total numeric(14,2) not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create index if not exists supplier_returns_purchase_idx on public.supplier_returns(purchase_id,status);
create index if not exists supplier_returns_branch_date_idx on public.supplier_returns(business_id,branch_id,created_at desc);
create index if not exists supplier_return_items_header_idx on public.supplier_return_items(supplier_return_id);
alter table public.supplier_returns enable row level security;
alter table public.supplier_return_items enable row level security;

create policy supplier_returns_read_management on public.supplier_returns
for select to authenticated using (
  private.smartpos_has_business_role(business_id,array['owner','admin','manager']::text[])
  and private.smartpos_can_access_branch(business_id,branch_id)
);
create policy supplier_return_items_read_management on public.supplier_return_items
for select to authenticated using (
  private.smartpos_has_business_role(business_id,array['owner','admin','manager']::text[])
  and exists(select 1 from public.supplier_returns r where r.id=supplier_return_id
    and r.business_id=supplier_return_items.business_id
    and private.smartpos_can_access_branch(r.business_id,r.branch_id))
);
revoke all on table public.supplier_returns,public.supplier_return_items from anon,authenticated;
grant select on table public.supplier_returns,public.supplier_return_items to authenticated;

create or replace function public.create_supplier_return(
  p_purchase_id uuid,p_items jsonb,p_reason text,p_notes text default null
) returns uuid language plpgsql security definer set search_path=''
as $function$
declare
  v_po public.purchase_orders%rowtype; v_id uuid; v_no text; v_item record;
  v_cost numeric; v_product_id uuid; v_purchased_quantity numeric; v_returned numeric; v_total numeric:=0;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into v_po from public.purchase_orders where id=p_purchase_id for update;
  if not found or v_po.status<>'received' or v_po.supplier_id is null then
    raise exception 'Pembelian tidak ditemukan, belum diterima, atau tidak memiliki pemasok.';
  end if;
  if not private.smartpos_has_business_role(v_po.business_id,array['owner','admin','manager']::text[])
     or not private.smartpos_can_access_branch(v_po.business_id,v_po.branch_id) then
    raise exception 'Akses retur pembelian ditolak.' using errcode='42501';
  end if;
  if coalesce(length(btrim(p_reason)),0)=0 or length(p_reason)>300 then raise exception 'Alasan retur wajib diisi (maksimal 300 karakter).'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>500 then
    raise exception 'Daftar barang retur tidak valid.';
  end if;
  if exists(select 1 from jsonb_to_recordset(p_items) as x(purchase_item_id uuid,quantity numeric)
    where x.purchase_item_id is null or x.quantity is null or x.quantity<=0) then raise exception 'Barang dan jumlah retur harus valid.'; end if;
  if exists(select purchase_item_id from jsonb_to_recordset(p_items) as x(purchase_item_id uuid,quantity numeric)
    group by purchase_item_id having count(*)>1) then raise exception 'Baris pembelian yang sama tidak boleh ganda.'; end if;

  v_no:='SR-'||to_char(now() at time zone 'Asia/Jakarta','YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  insert into public.supplier_returns(business_id,branch_id,warehouse_id,purchase_id,supplier_id,return_no,reason,notes,created_by)
  values(v_po.business_id,v_po.branch_id,v_po.warehouse_id,v_po.id,v_po.supplier_id,v_no,btrim(p_reason),nullif(left(coalesce(p_notes,''),1000),''),auth.uid())
  returning id into v_id;

  for v_item in select x.purchase_item_id,x.quantity from jsonb_to_recordset(p_items) as x(purchase_item_id uuid,quantity numeric) order by x.purchase_item_id loop
    select pi.unit_cost,pi.product_id,pi.quantity into v_cost,v_product_id,v_purchased_quantity
    from public.purchase_items pi where pi.id=v_item.purchase_item_id and pi.purchase_id=v_po.id and pi.business_id=v_po.business_id for update;
    if not found then raise exception 'Salah satu barang bukan bagian dari pembelian ini.'; end if;
    select coalesce(sum(ri.quantity),0) into v_returned from public.supplier_return_items ri
    join public.supplier_returns r on r.id=ri.supplier_return_id
    where ri.purchase_item_id=v_item.purchase_item_id and r.status='approved';
    if v_item.quantity+v_returned>v_purchased_quantity then raise exception 'Jumlah retur melebihi sisa barang yang dapat dikembalikan.'; end if;
    insert into public.supplier_return_items(supplier_return_id,business_id,purchase_item_id,product_id,quantity,unit_cost,line_total)
    values(v_id,v_po.business_id,v_item.purchase_item_id,v_product_id,v_item.quantity,v_cost,round(v_item.quantity*v_cost,2));
    v_total:=v_total+round(v_item.quantity*v_cost,2);
  end loop;
  update public.supplier_returns set total=v_total where id=v_id;
  insert into public.audit_logs(business_id,user_id,action,table_name,record_id,details)
  values(v_po.business_id,auth.uid(),'supplier_return_created','supplier_returns',v_id,
    jsonb_build_object('purchase_id',v_po.id,'return_no',v_no,'total',v_total,'reason',p_reason));
  return v_id;
end;
$function$;

create or replace function public.approve_supplier_return(p_return_id uuid)
returns void language plpgsql security definer set search_path=''
as $function$
declare
  v_return public.supplier_returns%rowtype; v_po public.purchase_orders%rowtype;
  v_item record; v_stock numeric; v_already_returned numeric; v_purchased numeric;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into v_return from public.supplier_returns where id=p_return_id for update;
  if not found then raise exception 'Dokumen retur pemasok tidak ditemukan.'; end if;
  select * into v_po from public.purchase_orders where id=v_return.purchase_id for update;
  if not found or v_po.status<>'received' then raise exception 'Pembelian asal tidak lagi valid.'; end if;
  if not private.smartpos_has_business_role(v_return.business_id,array['owner','admin']::text[])
     or not private.smartpos_can_access_branch(v_return.business_id,v_return.branch_id) then
    raise exception 'Persetujuan retur hanya dapat dilakukan Owner/Admin.' using errcode='42501';
  end if;
  if v_return.status<>'draft' then raise exception 'Dokumen retur sudah diproses.'; end if;

  for v_item in select * from public.supplier_return_items where supplier_return_id=v_return.id order by purchase_item_id loop
    select pi.quantity into v_purchased from public.purchase_items pi where pi.id=v_item.purchase_item_id for update;
    select coalesce(sum(ri.quantity),0) into v_already_returned from public.supplier_return_items ri
    join public.supplier_returns r on r.id=ri.supplier_return_id
    where ri.purchase_item_id=v_item.purchase_item_id and r.status='approved';
    if v_already_returned+v_item.quantity>v_purchased then raise exception 'Jumlah retur yang disetujui sebelumnya membuat jumlah retur melebihi pembelian.'; end if;
  end loop;

  for v_item in select * from public.supplier_return_items where supplier_return_id=v_return.id order by product_id loop
    select coalesce(i.quantity,0) into v_stock from public.inventory i
    where i.product_id=v_item.product_id and i.warehouse_id=v_return.warehouse_id for update;
    if not found then v_stock:=0; end if;
    if v_stock<v_item.quantity then raise exception 'Stok tidak cukup untuk retur salah satu barang. Dokumen tidak diproses.'; end if;
  end loop;

  for v_item in select * from public.supplier_return_items where supplier_return_id=v_return.id order by product_id loop
    update public.inventory set quantity=quantity-v_item.quantity,updated_at=now()
    where product_id=v_item.product_id and warehouse_id=v_return.warehouse_id;
    insert into public.stock_movements(business_id,product_id,warehouse_id,movement_type,quantity_change,reference_type,reference_id,notes,created_by)
    values(v_return.business_id,v_item.product_id,v_return.warehouse_id,'return',-v_item.quantity,'supplier_return',v_return.id,'Retur ke pemasok '||v_return.return_no,auth.uid());
  end loop;
  update public.supplier_returns set status='approved',approved_by=auth.uid(),approved_at=now() where id=v_return.id;
  insert into public.audit_logs(business_id,user_id,action,table_name,record_id,details)
  values(v_return.business_id,auth.uid(),'supplier_return_approved','supplier_returns',v_return.id,
    jsonb_build_object('return_no',v_return.return_no,'purchase_id',v_return.purchase_id,'total',v_return.total));
end;
$function$;

create or replace function public.cancel_supplier_return(p_return_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=''
as $function$
declare v_return public.supplier_returns%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into v_return from public.supplier_returns where id=p_return_id for update;
  if not found then raise exception 'Dokumen retur tidak ditemukan.'; end if;
  if not private.smartpos_has_business_role(v_return.business_id,array['owner','admin']::text[])
     or not private.smartpos_can_access_branch(v_return.business_id,v_return.branch_id) then raise exception 'Akses pembatalan ditolak.' using errcode='42501'; end if;
  if v_return.status<>'draft' then raise exception 'Hanya retur draft yang dapat dibatalkan.'; end if;
  if coalesce(length(btrim(p_reason)),0)=0 then raise exception 'Alasan pembatalan wajib diisi.'; end if;
  update public.supplier_returns set status='cancelled',notes=concat_ws(E'\\n',notes,'Pembatalan: '||left(p_reason,500)) where id=v_return.id;
  insert into public.audit_logs(business_id,user_id,action,table_name,record_id,details)
  values(v_return.business_id,auth.uid(),'supplier_return_cancelled','supplier_returns',v_return.id,jsonb_build_object('reason',left(p_reason,500)));
end;
$function$;

revoke all on function public.create_supplier_return(uuid,jsonb,text,text) from public,anon;
revoke all on function public.approve_supplier_return(uuid) from public,anon;
revoke all on function public.cancel_supplier_return(uuid,text) from public,anon;
grant execute on function public.create_supplier_return(uuid,jsonb,text,text) to authenticated;
grant execute on function public.approve_supplier_return(uuid) to authenticated;
grant execute on function public.cancel_supplier_return(uuid,text) to authenticated;
comment on table public.supplier_returns is 'Supplier return documents; stock is reduced only after Owner/Admin approval.';
