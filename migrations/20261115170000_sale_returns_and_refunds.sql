-- Controlled sale returns and refunds with stock restoration and audit trail.
create table if not exists public.sale_returns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  sale_id uuid not null references public.sales(id),
  return_no text not null,
  reason text not null,
  refund_method text not null check (refund_method in ('Tunai','Transfer bank','QRIS','Debit')),
  refund_amount numeric(14,2) not null default 0 check (refund_amount >= 0),
  restock boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (business_id, return_no)
);
create table if not exists public.sale_return_items (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  return_id uuid not null references public.sale_returns(id) on delete cascade,
  sale_item_id uuid not null references public.sale_items(id),
  product_id uuid not null references public.products(id),
  product_name text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  refund_amount numeric(14,2) not null check (refund_amount >= 0),
  cost_amount numeric(14,2),
  created_at timestamptz not null default now()
);
create index if not exists sale_returns_business_branch_created_idx on public.sale_returns(business_id, branch_id, created_at desc);
create index if not exists sale_returns_sale_idx on public.sale_returns(sale_id);
create index if not exists sale_return_items_sale_item_idx on public.sale_return_items(sale_item_id);
alter table public.sale_returns enable row level security;
alter table public.sale_return_items enable row level security;
drop policy if exists sale_returns_manager_read on public.sale_returns;
create policy sale_returns_manager_read on public.sale_returns for select to authenticated
using (private.smartpos_has_business_role(business_id,array['owner','admin','manager']::text[]) and private.smartpos_can_access_branch(business_id,branch_id));
drop policy if exists sale_return_items_manager_read on public.sale_return_items;
create policy sale_return_items_manager_read on public.sale_return_items for select to authenticated
using (exists (select 1 from public.sale_returns r where r.id=return_id and private.smartpos_has_business_role(r.business_id,array['owner','admin','manager']::text[]) and private.smartpos_can_access_branch(r.business_id,r.branch_id)));
revoke all on public.sale_returns from anon, authenticated;
revoke all on public.sale_return_items from anon, authenticated;
grant select on public.sale_returns, public.sale_return_items to authenticated;
create or replace function public.process_sale_return(p_sale_id uuid,p_items jsonb,p_reason text,p_refund_method text,p_restock boolean default true)
returns table(return_id uuid,return_no text,refund_amount numeric)
language plpgsql security definer set search_path=''
as $function$
declare
 v_sale record; v_item record; v_sale_item record; v_return_id uuid; v_return_no text;
 v_sold numeric; v_already_returned numeric; v_refund numeric; v_cost numeric;
 v_total_refund numeric:=0; v_total_line numeric:=0; v_warehouse_id uuid; v_inventory_id uuid;
begin
 if auth.uid() is null then raise exception 'Silakan masuk terlebih dahulu.'; end if;
 select s.id,s.business_id,s.branch_id,s.invoice_no,s.status,s.total into v_sale
 from public.sales s where s.id=p_sale_id for update;
 if not found then raise exception 'Transaksi tidak ditemukan.'; end if;
 if not private.smartpos_has_business_role(v_sale.business_id,array['owner','admin','manager']::text[]) then raise exception 'Retur hanya dapat diproses Owner, Admin, atau Manager.'; end if;
 if not private.smartpos_can_access_branch(v_sale.business_id,v_sale.branch_id) then raise exception 'Akses ke cabang transaksi ini tidak diizinkan.'; end if;
 if v_sale.status not in ('paid','refunded') then raise exception 'Hanya transaksi lunas yang dapat diretur.'; end if;
 if coalesce(length(trim(p_reason)),0)<3 then raise exception 'Alasan retur wajib diisi minimal 3 karakter.'; end if;
 if p_refund_method not in ('Tunai','Transfer bank','QRIS','Debit') then raise exception 'Metode pengembalian dana tidak valid.'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Pilih minimal satu barang yang diretur.'; end if;
 if exists(select 1 from jsonb_to_recordset(p_items) x(sale_item_id uuid,quantity numeric) where x.sale_item_id is null or x.quantity is null or x.quantity<=0) then raise exception 'Barang atau jumlah retur tidak valid.'; end if;
 if (select count(*) from jsonb_to_recordset(p_items) x(sale_item_id uuid,quantity numeric))<>(select count(distinct sale_item_id) from jsonb_to_recordset(p_items) x(sale_item_id uuid,quantity numeric)) then raise exception 'Barang yang sama tidak boleh dimasukkan dua kali.'; end if;
 select coalesce(sum(si.line_total),0) into v_total_line from public.sale_items si where si.sale_id=p_sale_id;
 if v_total_line<=0 and v_sale.total>0 then raise exception 'Nilai detail transaksi tidak valid untuk retur.'; end if;
 v_return_no:='RET-'||to_char(now() at time zone 'Asia/Jakarta','YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,5));
 insert into public.sale_returns(business_id,branch_id,sale_id,return_no,reason,refund_method,restock,created_by)
 values(v_sale.business_id,v_sale.branch_id,p_sale_id,v_return_no,trim(p_reason),p_refund_method,coalesce(p_restock,true),auth.uid()) returning id into v_return_id;
 for v_item in select x.sale_item_id,x.quantity from jsonb_to_recordset(p_items) x(sale_item_id uuid,quantity numeric) order by x.sale_item_id loop
  select si.id,si.product_id,si.product_name,si.quantity,si.line_total,si.unit_cost into v_sale_item
  from public.sale_items si where si.id=v_item.sale_item_id and si.sale_id=p_sale_id for update;
  if not found then raise exception 'Barang yang dipilih bukan bagian dari transaksi ini.'; end if;
  select coalesce(sum(ri.quantity),0) into v_already_returned from public.sale_return_items ri where ri.sale_item_id=v_sale_item.id;
  v_sold:=v_sale_item.quantity-v_already_returned;
  if v_item.quantity>v_sold then raise exception 'Jumlah retur % melebihi sisa barang yang dapat diretur (%).',v_sale_item.product_name,v_sold; end if;
  v_refund:=round((v_sale_item.line_total/nullif(v_sale_item.quantity,0))*v_item.quantity*case when v_total_line>0 then v_sale.total/v_total_line else 0 end,2);
  v_cost:=case when v_sale_item.unit_cost is null then null else round(v_sale_item.unit_cost*v_item.quantity,2) end;
  if coalesce(p_restock,true) then
   select sm.warehouse_id into v_warehouse_id from public.stock_movements sm where sm.reference_type='sale' and sm.reference_id=p_sale_id and sm.product_id=v_sale_item.product_id order by sm.created_at desc limit 1;
   if v_warehouse_id is null then raise exception 'Gudang asal barang % tidak ditemukan; retur stok dibatalkan.',v_sale_item.product_name; end if;
   select i.id into v_inventory_id from public.inventory i where i.business_id=v_sale.business_id and i.product_id=v_sale_item.product_id and i.warehouse_id=v_warehouse_id for update;
   if v_inventory_id is null then raise exception 'Catatan persediaan asal tidak ditemukan untuk %.',v_sale_item.product_name; end if;
   update public.inventory set quantity=quantity+v_item.quantity,updated_at=now() where id=v_inventory_id;
   insert into public.stock_movements(business_id,product_id,warehouse_id,movement_type,quantity_change,reference_type,reference_id,notes,created_by)
   values(v_sale.business_id,v_sale_item.product_id,v_warehouse_id,'sale_return',v_item.quantity,'sale_return',v_return_id,'Retur invoice '||v_sale.invoice_no,auth.uid());
  end if;
  insert into public.sale_return_items(business_id,return_id,sale_item_id,product_id,product_name,quantity,refund_amount,cost_amount)
  values(v_sale.business_id,v_return_id,v_sale_item.id,v_sale_item.product_id,v_sale_item.product_name,v_item.quantity,v_refund,v_cost);
  v_total_refund:=v_total_refund+v_refund;
 end loop;
 update public.sale_returns set refund_amount=round(v_total_refund,2) where id=v_return_id;
 insert into public.cash_entries(business_id,branch_id,entry_type,category,description,amount,reference_type,reference_id,created_by)
 values(v_sale.business_id,v_sale.branch_id,'expense','Retur Penjualan','Pengembalian dana invoice '||v_sale.invoice_no||' ('||v_return_no||')',round(v_total_refund,2),'sale_return',v_return_id,auth.uid());
 if not exists(select 1 from public.sale_items si where si.sale_id=p_sale_id and si.quantity>(select coalesce(sum(ri.quantity),0) from public.sale_return_items ri where ri.sale_item_id=si.id)) then update public.sales set status='refunded' where id=p_sale_id; end if;
 insert into public.audit_logs(business_id,user_id,action,table_name,record_id,details)
 values(v_sale.business_id,auth.uid(),'sale.return','sale_returns',v_return_id,jsonb_build_object('invoice_no',v_sale.invoice_no,'return_no',v_return_no,'refund_amount',round(v_total_refund,2),'reason',trim(p_reason),'restock',coalesce(p_restock,true),'refund_method',p_refund_method));
 return query select v_return_id,v_return_no,round(v_total_refund,2);
end;
$function$;
revoke all on function public.process_sale_return(uuid,jsonb,text,text,boolean) from public,anon;
grant execute on function public.process_sale_return(uuid,jsonb,text,text,boolean) to authenticated;
