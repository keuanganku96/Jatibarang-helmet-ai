
alter table public.sales drop constraint if exists sales_status_check;
alter table public.sales add constraint sales_status_check check (status = any (array['draft','paid','partial','void','refunded']::text[]));
alter table public.sales add column if not exists due_date date;
alter table public.sales add column if not exists receivable_notes text;

create or replace function private.smartpos_create_sale_commissions()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
 if new.status not in ('paid','partial') or (tg_op='UPDATE' and old.status in ('paid','partial')) or new.cashier_id is null then return new; end if;
 perform private.smartpos_record_sale_commissions(new.id);
 return new;
end;
$function$;

drop trigger if exists smartpos_sales_membership_update on public.sales;
create or replace function private.smartpos_update_customer_membership()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare v_customer_id uuid; v_tier text;
begin
 if new.customer_id is null or new.status not in ('paid','partial') then return new; end if;
 insert into public.member_transactions(business_id,customer_id,sale_id,amount)
 values(new.business_id,new.customer_id,new.id,new.total) on conflict (sale_id) do nothing;
 if not found then return new; end if;
 update public.customers c set total_transactions=c.total_transactions+1,total_spend=c.total_spend+new.total,membership_updated_at=now()
 where c.id=new.customer_id and c.business_id=new.business_id returning c.id into v_customer_id;
 if v_customer_id is null then raise exception 'Pelanggan tidak ditemukan untuk pembaruan membership.'; end if;
 select mt.tier_code into v_tier from public.membership_tiers mt join public.customers c on c.id=new.customer_id and c.business_id=new.business_id
 where mt.business_id=new.business_id and mt.is_active and c.total_transactions>=mt.min_transactions and c.total_spend>=mt.min_spend
 order by case mt.tier_code when 'platinum' then 3 when 'gold' then 2 else 1 end desc limit 1;
 update public.customers set membership_tier=coalesce(v_tier,'silver'),membership_updated_at=now() where id=new.customer_id and business_id=new.business_id;
 return new;
end;
$function$;
create trigger smartpos_sales_membership_update after insert or update of status on public.sales
for each row execute function private.smartpos_update_customer_membership();

create or replace function public.checkout_sale_with_payments(
 p_business_id uuid,p_branch_id uuid,p_warehouse_id uuid,p_customer_id uuid,
 p_items jsonb,p_payments jsonb,p_due_date date default null,p_receivable_notes text default null
)
returns table(sale_id uuid,invoice_no text,total numeric,paid_amount numeric,balance_due numeric,status text)
language plpgsql security definer set search_path=''
as $function$
declare
 v_sale_id uuid; v_invoice_no text; v_subtotal numeric:=0; v_discount numeric:=0;
 v_item record; v_product record; v_inventory record; v_inventory_count integer;
 v_quantity numeric; v_item_discount numeric; v_line_total numeric; v_updated_count integer;
 v_membership_percent numeric:=0; v_membership_discount numeric:=0;
 v_total numeric:=0; v_paid numeric:=0; v_payment record; v_payment_id uuid; v_status text;
begin
 if auth.uid() is null then raise exception 'Silakan masuk terlebih dahulu.'; end if;
 if not private.smartpos_has_business_role(p_business_id,array['owner','admin','manager','cashier']::text[]) then raise exception 'Akses kasir tidak diizinkan.'; end if;
 if p_branch_id is null or not private.smartpos_can_access_branch(p_business_id,p_branch_id) then raise exception 'Akses ke cabang ini tidak diizinkan.'; end if;
 if not exists(select 1 from public.branches b where b.id=p_branch_id and b.business_id=p_business_id and b.is_active) then raise exception 'Cabang tidak ditemukan atau tidak aktif.'; end if;
 if not exists(select 1 from public.warehouses w where w.id=p_warehouse_id and w.business_id=p_business_id and w.branch_id=p_branch_id and w.is_active) then raise exception 'Gudang tidak ditemukan, tidak aktif, atau bukan milik cabang ini.'; end if;
 if p_customer_id is not null and not exists(select 1 from public.customers c where c.id=p_customer_id and c.business_id=p_business_id) then raise exception 'Pelanggan tidak valid.'; end if;
 if p_items is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)=0 then raise exception 'Keranjang belanja kosong atau tidak valid.'; end if;
 if exists(select 1 from jsonb_to_recordset(p_items) x(product_id uuid,quantity numeric,discount_amount numeric) where x.product_id is null or x.quantity is null or x.quantity<=0 or coalesce(x.discount_amount,0)<0) then raise exception 'Produk, jumlah, atau diskon tidak valid.'; end if;
 if p_payments is null or jsonb_typeof(p_payments) is distinct from 'array' then raise exception 'Rincian pembayaran tidak valid.'; end if;
 if exists(select 1 from jsonb_to_recordset(p_payments) x(payment_method text,amount numeric,payment_reference text) where x.amount is null or x.amount<=0 or x.payment_method not in ('Tunai','Transfer bank','QRIS','Debit')) then raise exception 'Metode atau nominal pembayaran tidak valid.'; end if;
 for v_item in select x.product_id,sum(x.quantity)::numeric quantity,sum(coalesce(x.discount_amount,0))::numeric discount_amount
 from jsonb_to_recordset(p_items) x(product_id uuid,quantity numeric,discount_amount numeric) group by x.product_id order by x.product_id loop
  select p.name,p.selling_price,p.cost_price,p.is_active into v_product from public.products p where p.id=v_item.product_id and p.business_id=p_business_id for share;
  if not found or v_product.is_active is not true then raise exception 'Produk tidak ditemukan atau tidak aktif.'; end if;
  select count(*)::integer into v_inventory_count from public.inventory i where i.business_id=p_business_id and i.product_id=v_item.product_id and i.warehouse_id=p_warehouse_id;
  if v_inventory_count<>1 then raise exception 'Data stok produk % belum siap atau duplikat.',v_product.name; end if;
  select i.id,i.quantity into v_inventory from public.inventory i where i.business_id=p_business_id and i.product_id=v_item.product_id and i.warehouse_id=p_warehouse_id for update;
  if not found or v_inventory.quantity<v_item.quantity then raise exception 'Stok % tidak mencukupi. Tersedia: %.',v_product.name,coalesce(v_inventory.quantity,0); end if;
  if v_item.discount_amount>(v_product.selling_price*v_item.quantity) then raise exception 'Diskon produk % melebihi nilai barang.',v_product.name; end if;
  v_subtotal:=v_subtotal+(v_product.selling_price*v_item.quantity); v_discount:=v_discount+v_item.discount_amount;
 end loop;
 if p_customer_id is not null then
  select mt.discount_percent into v_membership_percent from public.customers c join public.membership_tiers mt on mt.business_id=c.business_id and mt.tier_code=c.membership_tier and mt.is_active
  where c.id=p_customer_id and c.business_id=p_business_id;
 end if;
 v_membership_discount:=round(greatest(0,v_subtotal-v_discount)*coalesce(v_membership_percent,0)/100,2); v_discount:=v_discount+v_membership_discount; v_total:=v_subtotal-v_discount;
 select coalesce(sum(x.amount),0)::numeric into v_paid from jsonb_to_recordset(p_payments) x(payment_method text,amount numeric,payment_reference text);
 if v_paid>v_total then raise exception 'Total pembayaran melebihi nilai transaksi.'; end if;
 if v_paid<v_total and p_customer_id is null then raise exception 'Pilih pelanggan untuk mencatat sisa pembayaran sebagai piutang.'; end if;
 if v_paid<v_total and p_due_date is null then raise exception 'Tanggal jatuh tempo wajib diisi untuk transaksi piutang.'; end if;
 v_status:=case when v_paid>=v_total then 'paid' else 'partial' end;
 v_invoice_no:='JH-'||to_char(now() at time zone 'Asia/Jakarta','YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
 insert into public.sales(business_id,branch_id,customer_id,invoice_no,status,subtotal,discount,tax,total,cashier_id,due_date,receivable_notes)
 values(p_business_id,p_branch_id,p_customer_id,v_invoice_no,v_status,v_subtotal,v_discount,0,v_total,auth.uid(),case when v_status='partial' then p_due_date else null end,nullif(trim(p_receivable_notes),''))
 returning id into v_sale_id;
 for v_item in select x.product_id,sum(x.quantity)::numeric quantity,sum(coalesce(x.discount_amount,0))::numeric discount_amount
 from jsonb_to_recordset(p_items) x(product_id uuid,quantity numeric,discount_amount numeric) group by x.product_id order by x.product_id loop
  select p.name,p.selling_price,p.cost_price into v_product from public.products p where p.id=v_item.product_id and p.business_id=p_business_id;
  select i.id,i.quantity into v_inventory from public.inventory i where i.business_id=p_business_id and i.product_id=v_item.product_id and i.warehouse_id=p_warehouse_id;
  v_quantity:=v_item.quantity; v_item_discount:=v_item.discount_amount; v_line_total:=(v_product.selling_price*v_quantity)-v_item_discount;
  update public.inventory set quantity=quantity-v_quantity,updated_at=now() where id=v_inventory.id and quantity>=v_quantity;
  get diagnostics v_updated_count=row_count;
  if v_updated_count<>1 then raise exception 'Stok berubah saat transaksi diproses. Silakan muat ulang.'; end if;
  insert into public.sale_items(business_id,sale_id,product_id,product_name,quantity,unit_price,unit_cost,discount,line_total)
  values(p_business_id,v_sale_id,v_item.product_id,v_product.name,v_quantity,v_product.selling_price,v_product.cost_price,v_item_discount,v_line_total);
  insert into public.stock_movements(business_id,product_id,warehouse_id,movement_type,quantity_change,reference_type,reference_id,created_by)
  values(p_business_id,v_item.product_id,p_warehouse_id,'sale',-v_quantity,'sale',v_sale_id,auth.uid());
 end loop;
 for v_payment in select x.payment_method,x.amount,x.payment_reference from jsonb_to_recordset(p_payments) x(payment_method text,amount numeric,payment_reference text) loop
  insert into public.sale_payments(business_id,sale_id,payment_method,amount,payment_reference,payment_status)
  values(p_business_id,v_sale_id,v_payment.payment_method,v_payment.amount,nullif(trim(v_payment.payment_reference),''),'completed') returning id into v_payment_id;
  insert into public.cash_entries(business_id,branch_id,entry_type,category,description,amount,reference_type,reference_id,created_by)
  values(p_business_id,p_branch_id,'income','Penjualan','Pembayaran invoice '||v_invoice_no||' ('||v_payment.payment_method||')',v_payment.amount,'sale_payment',v_payment_id,auth.uid());
 end loop;
 insert into public.audit_logs(business_id,user_id,action,table_name,record_id,details)
 values(p_business_id,auth.uid(),'sale.checkout','sales',v_sale_id,jsonb_build_object('invoice_no',v_invoice_no,'total',v_total,'paid_amount',v_paid,'balance_due',v_total-v_paid,'status',v_status,'branch_id',p_branch_id,'warehouse_id',p_warehouse_id));
 return query select v_sale_id,v_invoice_no,v_total,v_paid,v_total-v_paid,v_status;
end;
$function$;

create or replace function public.record_sale_payment(p_sale_id uuid,p_payment_method text,p_amount numeric,p_payment_reference text default null)
returns table(sale_id uuid,invoice_no text,total numeric,paid_amount numeric,balance_due numeric,status text)
language plpgsql security definer set search_path=''
as $function$
declare v_sale record; v_paid numeric; v_balance numeric; v_payment_id uuid; v_status text;
begin
 if auth.uid() is null then raise exception 'Silakan masuk terlebih dahulu.'; end if;
 select s.id,s.business_id,s.branch_id,s.invoice_no,s.total,s.status into v_sale from public.sales s where s.id=p_sale_id for update;
 if not found then raise exception 'Invoice tidak ditemukan.'; end if;
 if not private.smartpos_has_business_role(v_sale.business_id,array['owner','admin','manager','cashier']::text[]) then raise exception 'Akses pembayaran tidak diizinkan.'; end if;
 if not private.smartpos_can_access_branch(v_sale.business_id,v_sale.branch_id) then raise exception 'Akses ke cabang ini tidak diizinkan.'; end if;
 if v_sale.status not in ('partial','paid') then raise exception 'Invoice ini tidak dapat menerima pembayaran.'; end if;
 if p_payment_method not in ('Tunai','Transfer bank','QRIS','Debit') or p_amount is null or p_amount<=0 then raise exception 'Metode atau nominal pembayaran tidak valid.'; end if;
 select coalesce(sum(sp.amount),0)::numeric into v_paid from public.sale_payments sp where sp.sale_id=p_sale_id and sp.payment_status='completed';
 v_balance:=greatest(0,v_sale.total-v_paid); if p_amount>v_balance then raise exception 'Pembayaran melebihi sisa piutang sebesar %.',v_balance; end if;
 insert into public.sale_payments(business_id,sale_id,payment_method,amount,payment_reference,payment_status)
 values(v_sale.business_id,p_sale_id,p_payment_method,p_amount,nullif(trim(p_payment_reference),''),'completed') returning id into v_payment_id;
 insert into public.cash_entries(business_id,branch_id,entry_type,category,description,amount,reference_type,reference_id,created_by)
 values(v_sale.business_id,v_sale.branch_id,'income','Pengembalian piutang','Pembayaran piutang invoice '||v_sale.invoice_no||' ('||p_payment_method||')',p_amount,'sale_payment',v_payment_id,auth.uid());
 v_paid:=v_paid+p_amount; v_balance:=greatest(0,v_sale.total-v_paid); v_status:=case when v_balance<=0 then 'paid' else 'partial' end;
 update public.sales set status=v_status where id=p_sale_id;
 insert into public.audit_logs(business_id,user_id,action,table_name,record_id,details)
 values(v_sale.business_id,auth.uid(),'sale.payment_received','sales',p_sale_id,jsonb_build_object('invoice_no',v_sale.invoice_no,'payment_amount',p_amount,'payment_method',p_payment_method,'paid_amount',v_paid,'balance_due',v_balance,'status',v_status));
 return query select p_sale_id,v_sale.invoice_no,v_sale.total,v_paid,v_balance,v_status;
end;
$function$;

revoke all on function public.checkout_sale_with_payments(uuid,uuid,uuid,uuid,jsonb,jsonb,date,text) from public,anon;
grant execute on function public.checkout_sale_with_payments(uuid,uuid,uuid,uuid,jsonb,jsonb,date,text) to authenticated;
revoke all on function public.record_sale_payment(uuid,text,numeric,text) from public,anon;
grant execute on function public.record_sale_payment(uuid,text,numeric,text) to authenticated;

do $block$
declare v_def text;
begin
 select pg_get_functiondef('public.get_profit_loss_summary_v2(uuid,uuid,timestamptz,timestamptz)'::regprocedure) into v_def;
 v_def:=replace(v_def,'s.status in (''paid'',''refunded'')','s.status in (''paid'',''partial'',''refunded'')');
 execute v_def;
end;
$block$;

create index if not exists sales_receivables_branch_due_idx on public.sales(business_id,branch_id,due_date,created_at) where status='partial';
create index if not exists sale_payments_sale_completed_idx on public.sale_payments(sale_id,created_at) where payment_status='completed';