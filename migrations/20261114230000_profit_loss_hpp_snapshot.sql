-- Capture product cost at the moment of checkout and provide a role-scoped P&L summary.
alter table public.sale_items
  add column if not exists unit_cost numeric(14,2);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sale_items'::regclass
      and conname = 'sale_items_unit_cost_nonnegative'
  ) then
    alter table public.sale_items
      add constraint sale_items_unit_cost_nonnegative
      check (unit_cost is null or unit_cost >= 0);
  end if;
end
$$;

create or replace function private.smartpos_checkout_sale_impl(
  p_business_id uuid, p_branch_id uuid, p_warehouse_id uuid,
  p_customer_id uuid, p_items jsonb, p_payment_method text
)
returns table(sale_id uuid, invoice_no text, total numeric)
language plpgsql security definer set search_path to ''
as $function$
declare
 v_sale_id uuid; v_invoice_no text; v_subtotal numeric:=0; v_discount numeric:=0;
 v_item record; v_product record; v_inventory record; v_inventory_count integer;
 v_quantity numeric; v_item_discount numeric; v_line_total numeric; v_updated_count integer;
 v_membership_percent numeric:=0; v_membership_discount numeric:=0;
begin
 if auth.uid() is null then raise exception 'Silakan masuk terlebih dahulu.'; end if;
 if not private.smartpos_has_business_role(p_business_id,array['owner','admin','manager','cashier']::text[]) then raise exception 'Akses kasir tidak diizinkan.'; end if;
 if p_branch_id is null or not private.smartpos_can_access_branch(p_business_id,p_branch_id) then raise exception 'Akses ke cabang ini tidak diizinkan.'; end if;
 if not exists(select 1 from public.branches b where b.id=p_branch_id and b.business_id=p_business_id and b.is_active) then raise exception 'Cabang tidak ditemukan atau tidak aktif.'; end if;
 if not exists(select 1 from public.warehouses w where w.id=p_warehouse_id and w.business_id=p_business_id and w.branch_id=p_branch_id and w.is_active) then raise exception 'Gudang tidak ditemukan, tidak aktif, atau bukan milik cabang ini.'; end if;
 if p_customer_id is not null and not exists(select 1 from public.customers c where c.id=p_customer_id and c.business_id=p_business_id) then raise exception 'Pelanggan tidak valid.'; end if;
 if p_items is null or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)=0 then raise exception 'Keranjang belanja kosong atau tidak valid.'; end if;
 if exists(select 1 from jsonb_to_recordset(p_items) as x(product_id uuid,quantity numeric,discount_amount numeric) where x.product_id is null or x.quantity is null or x.quantity<=0 or coalesce(x.discount_amount,0)<0) then raise exception 'Produk, jumlah, atau diskon tidak valid.'; end if;
 if coalesce(p_payment_method,'') not in ('Tunai','Transfer bank','QRIS','Debit') then raise exception 'Metode pembayaran tidak valid.'; end if;
 for v_item in
  select x.product_id,sum(x.quantity)::numeric quantity,sum(coalesce(x.discount_amount,0))::numeric discount_amount
  from jsonb_to_recordset(p_items) as x(product_id uuid,quantity numeric,discount_amount numeric)
  group by x.product_id order by x.product_id
 loop
  select p.name,p.selling_price,p.cost_price,p.is_active into v_product
  from public.products p where p.id=v_item.product_id and p.business_id=p_business_id for share;
  if not found or v_product.is_active is not true then raise exception 'Produk tidak ditemukan atau tidak aktif.'; end if;
  select count(*)::integer into v_inventory_count from public.inventory i where i.business_id=p_business_id and i.product_id=v_item.product_id and i.warehouse_id=p_warehouse_id;
  if v_inventory_count<>1 then raise exception 'Data stok produk % belum siap atau duplikat.',v_product.name; end if;
  select i.id,i.quantity into v_inventory from public.inventory i where i.business_id=p_business_id and i.product_id=v_item.product_id and i.warehouse_id=p_warehouse_id for update;
  if not found or v_inventory.quantity<v_item.quantity then raise exception 'Stok % tidak mencukupi. Tersedia: %.',v_product.name,coalesce(v_inventory.quantity,0); end if;
  if v_item.discount_amount>(v_product.selling_price*v_item.quantity) then raise exception 'Diskon produk % melebihi nilai barang.',v_product.name; end if;
  v_subtotal:=v_subtotal+(v_product.selling_price*v_item.quantity);
  v_discount:=v_discount+v_item.discount_amount;
 end loop;
 if p_customer_id is not null then
  select mt.discount_percent into v_membership_percent
  from public.customers c join public.membership_tiers mt
    on mt.business_id=c.business_id and mt.tier_code=c.membership_tier and mt.is_active
  where c.id=p_customer_id and c.business_id=p_business_id;
 end if;
 v_membership_discount:=round(greatest(0,v_subtotal-v_discount)*coalesce(v_membership_percent,0)/100,2);
 v_discount:=v_discount+v_membership_discount;
 v_invoice_no:='JH-'||to_char(now() at time zone 'Asia/Jakarta','YYYYMMDD-HH24MISS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
 insert into public.sales(business_id,branch_id,customer_id,invoice_no,status,subtotal,discount,tax,total,cashier_id)
 values(p_business_id,p_branch_id,p_customer_id,v_invoice_no,'paid',v_subtotal,v_discount,0,v_subtotal-v_discount,auth.uid())
 returning id into v_sale_id;
 for v_item in
  select x.product_id,sum(x.quantity)::numeric quantity,sum(coalesce(x.discount_amount,0))::numeric discount_amount
  from jsonb_to_recordset(p_items) as x(product_id uuid,quantity numeric,discount_amount numeric)
  group by x.product_id order by x.product_id
 loop
  select p.name,p.selling_price,p.cost_price into v_product
  from public.products p where p.id=v_item.product_id and p.business_id=p_business_id;
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
 insert into public.sale_payments(business_id,sale_id,payment_method,amount,payment_status)
 values(p_business_id,v_sale_id,p_payment_method,v_subtotal-v_discount,'completed');
 insert into public.cash_entries(business_id,branch_id,entry_type,category,description,amount,reference_type,reference_id,created_by)
 values(p_business_id,p_branch_id,'income','Penjualan','Pembayaran '||v_invoice_no,v_subtotal-v_discount,'sale',v_sale_id,auth.uid());
 insert into public.audit_logs(business_id,user_id,action,table_name,record_id,details)
 values(p_business_id,auth.uid(),'sale.checkout','sales',v_sale_id,
  jsonb_build_object('invoice_no',v_invoice_no,'total',v_subtotal-v_discount,'discount',v_discount,'membership_discount',v_membership_discount,'branch_id',p_branch_id,'warehouse_id',p_warehouse_id));
 return query select v_sale_id,v_invoice_no,v_subtotal-v_discount;
end;
$function$;

create or replace function public.get_profit_loss_summary(
 p_business_id uuid,p_branch_id uuid,p_start_at timestamptz,p_end_at timestamptz
)
returns table(
 sales_count bigint,revenue numeric,hpp numeric,gross_profit numeric,
 operating_expenses numeric,other_income numeric,net_profit numeric,
 missing_cost_items bigint,missing_cost_sales bigint
)
language plpgsql stable security invoker set search_path to ''
as $function$
declare
 v_missing_items bigint; v_missing_sales bigint; v_known_hpp numeric;
 v_revenue numeric; v_sales_count bigint; v_expenses numeric; v_other_income numeric;
begin
 if auth.uid() is null then raise exception 'Silakan masuk terlebih dahulu.'; end if;
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
  select s.id,s.total from public.sales s
  where s.business_id=p_business_id and s.status='paid'
   and (p_branch_id is null or s.branch_id=p_branch_id)
   and (p_start_at is null or s.created_at>=p_start_at)
   and (p_end_at is null or s.created_at<p_end_at)
 ), cost_summary as (
  select
   count(*) filter (where si.id is null or si.unit_cost is null)::bigint as missing_items,
   count(distinct fs.id) filter (where si.id is null or si.unit_cost is null)::bigint as missing_sales,
   coalesce(sum(si.unit_cost*si.quantity) filter (where si.unit_cost is not null),0)::numeric as known_hpp
  from filtered_sales fs left join public.sale_items si on si.sale_id=fs.id
 )
 select (select count(*) from filtered_sales)::bigint,
  coalesce((select sum(total) from filtered_sales),0)::numeric,
  cs.missing_items,cs.missing_sales,cs.known_hpp
 into v_sales_count,v_revenue,v_missing_items,v_missing_sales,v_known_hpp
 from cost_summary cs;
 select coalesce(sum(ce.amount),0)::numeric into v_expenses
 from public.cash_entries ce
 where ce.business_id=p_business_id and ce.entry_type='expense'
  and ce.category<>'Pembayaran Supplier'
  and (p_branch_id is null or ce.branch_id=p_branch_id)
  and (p_start_at is null or ce.created_at>=p_start_at)
  and (p_end_at is null or ce.created_at<p_end_at);
 select coalesce(sum(ce.amount),0)::numeric into v_other_income
 from public.cash_entries ce
 where ce.business_id=p_business_id and ce.entry_type='income'
  and ce.category='Pendapatan lain'
  and (p_branch_id is null or ce.branch_id=p_branch_id)
  and (p_start_at is null or ce.created_at>=p_start_at)
  and (p_end_at is null or ce.created_at<p_end_at);
 sales_count:=v_sales_count; revenue:=v_revenue;
 hpp:=case when v_missing_items>0 or v_missing_sales>0 then null else v_known_hpp end;
 gross_profit:=case when v_missing_items>0 or v_missing_sales>0 then null else v_revenue-v_known_hpp end;
 operating_expenses:=v_expenses; other_income:=v_other_income;
 net_profit:=case when v_missing_items>0 or v_missing_sales>0 then null else v_revenue-v_known_hpp-v_expenses+v_other_income end;
 missing_cost_items:=v_missing_items; missing_cost_sales:=v_missing_sales;
 return next;
end;
$function$;

revoke all on function public.get_profit_loss_summary(uuid,uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.get_profit_loss_summary(uuid,uuid,timestamptz,timestamptz) to authenticated;
