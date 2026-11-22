
create or replace function public.process_sale_return(
 p_sale_id uuid,p_items jsonb,p_reason text,p_refund_method text,p_restock boolean default true
)
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
 if p_refund_method is null or p_refund_method not in ('Tunai','Transfer bank','QRIS','Debit') then raise exception 'Metode pengembalian dana tidak valid.'; end if;
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
 insert into public.audit_logs(business_id,user_id,action,table_name,record_id,details)
 values(v_sale.business_id,auth.uid(),'sale.return','sale_returns',v_return_id,jsonb_build_object('invoice_no',v_sale.invoice_no,'return_no',v_return_no,'refund_amount',round(v_total_refund,2),'reason',trim(p_reason),'restock',coalesce(p_restock,true),'refund_method',p_refund_method));
 return query select v_return_id,v_return_no,round(v_total_refund,2);
end;
$function$;

create or replace function public.get_profit_loss_summary_v2(
 p_business_id uuid,p_branch_id uuid,p_start_at timestamptz,p_end_at timestamptz
)
returns table(
 sales_count bigint,revenue numeric,hpp numeric,gross_profit numeric,
 commission_expenses numeric,operating_expenses numeric,other_income numeric,
 net_profit numeric,missing_cost_items bigint,missing_cost_sales bigint
)
language plpgsql stable set search_path=''
as $function$
declare
 v_missing_items bigint; v_missing_sales bigint; v_known_hpp numeric;
 v_gross_revenue numeric; v_sales_count bigint; v_commissions numeric;
 v_expenses numeric; v_other_income numeric; v_refunds numeric; v_returned_hpp numeric;
begin
 if auth.uid() is null then raise exception 'Silakan masuk terlebih dahulu.'; end if;
 if not private.smartpos_has_business_role(p_business_id,array['owner','admin','manager']::text[]) then raise exception 'Laporan laba rugi hanya dapat diakses Owner, Admin, atau Manager.'; end if;
 if p_branch_id is null then
  if not private.smartpos_has_business_role(p_business_id,array['owner','admin']::text[]) then raise exception 'Hanya Owner/Admin yang dapat melihat konsolidasi seluruh cabang.'; end if;
 elsif not private.smartpos_can_access_branch(p_business_id,p_branch_id) then raise exception 'Akses ke cabang ini tidak diizinkan.'; end if;

 with filtered_sales as (
  select s.id,s.total from public.sales s
  where s.business_id=p_business_id and s.status in ('paid','refunded')
   and (p_branch_id is null or s.branch_id=p_branch_id)
   and (p_start_at is null or s.created_at>=p_start_at)
   and (p_end_at is null or s.created_at<p_end_at)
 ), cost_summary as (
  select count(*) filter(where si.id is null or si.unit_cost is null)::bigint missing_items,
   count(distinct fs.id) filter(where si.id is null or si.unit_cost is null)::bigint missing_sales,
   coalesce(sum(si.unit_cost*si.quantity) filter(where si.unit_cost is not null),0)::numeric known_hpp
  from filtered_sales fs left join public.sale_items si on si.sale_id=fs.id
 )
 select (select count(*) from filtered_sales)::bigint,
  coalesce((select sum(total) from filtered_sales),0)::numeric,
  cs.missing_items,cs.missing_sales,cs.known_hpp
 into v_sales_count,v_gross_revenue,v_missing_items,v_missing_sales,v_known_hpp
 from cost_summary cs;

 select coalesce(sum(r.refund_amount),0)::numeric,
  coalesce(sum(ri.cost_amount) filter(where r.restock and ri.cost_amount is not null),0)::numeric
 into v_refunds,v_returned_hpp
 from public.sale_returns r left join public.sale_return_items ri on ri.return_id=r.id
 where r.business_id=p_business_id
  and (p_branch_id is null or r.branch_id=p_branch_id)
  and (p_start_at is null or r.created_at>=p_start_at)
  and (p_end_at is null or r.created_at<p_end_at);

 select coalesce(sum(cl.commission_amount),0)::numeric into v_commissions
 from public.commission_ledger cl join public.sales s on s.id=cl.sale_id
 where cl.business_id=p_business_id and s.status in ('paid','refunded')
  and (p_branch_id is null or cl.branch_id=p_branch_id)
  and (p_start_at is null or s.created_at>=p_start_at)
  and (p_end_at is null or s.created_at<p_end_at);

 select coalesce(sum(ce.amount),0)::numeric into v_expenses
 from public.cash_entries ce
 where ce.business_id=p_business_id and ce.entry_type='expense'
  and ce.category not in ('Pembayaran Supplier','Komisi Karyawan','Retur Penjualan')
  and (p_branch_id is null or ce.branch_id=p_branch_id)
  and (p_start_at is null or ce.created_at>=p_start_at)
  and (p_end_at is null or ce.created_at<p_end_at);

 select coalesce(sum(ce.amount),0)::numeric into v_other_income
 from public.cash_entries ce
 where ce.business_id=p_business_id and ce.entry_type='income' and ce.category='Pendapatan lain'
  and (p_branch_id is null or ce.branch_id=p_branch_id)
  and (p_start_at is null or ce.created_at>=p_start_at)
  and (p_end_at is null or ce.created_at<p_end_at);

 sales_count:=v_sales_count;
 revenue:=v_gross_revenue-v_refunds;
 hpp:=case when v_missing_items>0 or v_missing_sales>0 then null else greatest(0,v_known_hpp-v_returned_hpp) end;
 gross_profit:=case when v_missing_items>0 or v_missing_sales>0 then null else (v_gross_revenue-v_refunds)-greatest(0,v_known_hpp-v_returned_hpp) end;
 commission_expenses:=v_commissions;
 operating_expenses:=v_expenses;
 other_income:=v_other_income;
 net_profit:=case when v_missing_items>0 or v_missing_sales>0 then null else (v_gross_revenue-v_refunds)-greatest(0,v_known_hpp-v_returned_hpp)-v_commissions-v_expenses+v_other_income end;
 missing_cost_items:=v_missing_items; missing_cost_sales:=v_missing_sales;
 return next;
end;
$function$;
