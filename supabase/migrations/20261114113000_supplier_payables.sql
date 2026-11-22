-- Supplier payables and partial payment tracking
alter table public.purchase_orders
 add column if not exists supplier_invoice_no text,
 add column if not exists due_date date,
 add column if not exists amount_paid numeric(14,2) not null default 0 check(amount_paid>=0),
 add column if not exists payable_tracking_enabled boolean not null default false;

create table if not exists public.supplier_payments(
 id uuid primary key default gen_random_uuid(),business_id uuid not null references public.businesses(id) on delete cascade,
 branch_id uuid not null references public.branches(id),purchase_id uuid not null references public.purchase_orders(id) on delete restrict,
 supplier_id uuid not null references public.suppliers(id) on delete restrict,amount numeric(14,2) not null check(amount>0),
 payment_method text not null default 'Tunai',reference_no text,notes text,cash_entry_id uuid references public.cash_entries(id) on delete set null,
 created_by uuid references auth.users(id),created_at timestamptz not null default now());
create index if not exists supplier_payments_purchase_idx on public.supplier_payments(purchase_id,created_at desc);
create index if not exists supplier_payments_business_idx on public.supplier_payments(business_id,branch_id,created_at desc);
alter table public.supplier_payments enable row level security;
drop policy if exists supplier_payments_select_branch_members on public.supplier_payments;
create policy supplier_payments_select_branch_members on public.supplier_payments for select to authenticated using(public.can_access_branch(business_id,branch_id));
grant select on public.supplier_payments to authenticated;

drop function if exists public.receive_purchase(uuid,uuid,uuid,uuid,jsonb,text);
create function public.receive_purchase(
 p_business_id uuid,p_branch_id uuid,p_warehouse_id uuid,p_supplier_id uuid,p_items jsonb,
 p_notes text default null,p_supplier_invoice_no text default null,p_due_date date default null,
 p_initial_payment numeric default 0,p_payment_method text default 'Tunai',p_payment_reference text default null
) returns table(purchase_id uuid,purchase_no text,total numeric)
language plpgsql security definer set search_path='' as $$
declare v_purchase_id uuid; v_purchase_no text; v_total numeric; v_payment_id uuid; v_cash_id uuid;
begin
 if p_initial_payment is null or p_initial_payment<0 then raise exception 'Pembayaran awal tidak valid.'; end if;
 if nullif(trim(coalesce(p_supplier_invoice_no,'')),'') is not null and length(trim(p_supplier_invoice_no))>100 then raise exception 'Nomor invoice supplier maksimal 100 karakter.'; end if;
 if p_due_date is not null and p_due_date<current_date then raise exception 'Tanggal jatuh tempo tidak boleh sebelum hari ini.'; end if;
 if p_initial_payment>0 and p_supplier_id is null then raise exception 'Pilih pemasok untuk mencatat pembayaran pembelian.'; end if;
 if coalesce(trim(p_payment_method),'') not in ('Tunai','Transfer bank','QRIS','Debit') then raise exception 'Metode pembayaran tidak valid.'; end if;
 select x.purchase_id,x.purchase_no,x.total into v_purchase_id,v_purchase_no,v_total
 from private.smartpos_receive_purchase_impl(p_business_id,p_branch_id,p_warehouse_id,p_supplier_id,p_items,p_notes) x;
 if p_initial_payment>v_total then raise exception 'Pembayaran awal melebihi total pembelian.'; end if;
 update public.purchase_orders set supplier_invoice_no=nullif(trim(p_supplier_invoice_no),''),due_date=p_due_date,payable_tracking_enabled=(p_supplier_id is not null) where id=v_purchase_id and business_id=p_business_id;
 if p_initial_payment>0 then
  insert into public.supplier_payments(business_id,branch_id,purchase_id,supplier_id,amount,payment_method,reference_no,notes,created_by)
  values(p_business_id,p_branch_id,v_purchase_id,p_supplier_id,p_initial_payment,p_payment_method,nullif(trim(p_payment_reference),''),'Pembayaran awal pembelian',auth.uid()) returning id into v_payment_id;
  insert into public.cash_entries(business_id,branch_id,entry_type,category,description,amount,reference_type,reference_id,created_by)
  values(p_business_id,p_branch_id,'expense','Pembayaran Supplier','Pembayaran awal pembelian '||v_purchase_no,p_initial_payment,'supplier_payment',v_payment_id,auth.uid()) returning id into v_cash_id;
  update public.supplier_payments set cash_entry_id=v_cash_id where id=v_payment_id;
  update public.purchase_orders set amount_paid=p_initial_payment where id=v_purchase_id;
 end if;
 insert into public.audit_logs(business_id,user_id,action,table_name,record_id,details)
 values(p_business_id,auth.uid(),'supplier.payable.created','purchase_orders',v_purchase_id,
 jsonb_build_object('supplier_id',p_supplier_id,'invoice_no',p_supplier_invoice_no,'due_date',p_due_date,'total',v_total,'initial_payment',p_initial_payment));
 return query select v_purchase_id,v_purchase_no,v_total;
end; $$;
revoke all on function public.receive_purchase(uuid,uuid,uuid,uuid,jsonb,text,text,date,numeric,text,text) from public,anon;
grant execute on function public.receive_purchase(uuid,uuid,uuid,uuid,jsonb,text,text,date,numeric,text,text) to authenticated;

create or replace function public.record_supplier_payment(p_purchase_id uuid,p_amount numeric,p_payment_method text default 'Tunai',p_reference_no text default null,p_notes text default null)
returns table(payment_id uuid,remaining_balance numeric)
language plpgsql security definer set search_path='' as $$
declare v_po public.purchase_orders%rowtype; v_payment_id uuid; v_cash_id uuid; v_paid numeric; v_remaining numeric;
begin
 if auth.uid() is null then raise exception 'Silakan masuk terlebih dahulu.'; end if;
 if p_amount is null or p_amount<=0 or p_amount>1000000000000 then raise exception 'Nominal pembayaran harus lebih dari nol.'; end if;
 if coalesce(trim(p_payment_method),'') not in ('Tunai','Transfer bank','QRIS','Debit') then raise exception 'Metode pembayaran tidak valid.'; end if;
 select * into v_po from public.purchase_orders where id=p_purchase_id for update;
 if not found or v_po.supplier_id is null or not v_po.payable_tracking_enabled then raise exception 'Tagihan pemasok tidak ditemukan.'; end if;
 if not private.smartpos_has_business_role(v_po.business_id,array['owner','admin','manager']::text[]) then raise exception 'Akses pembayaran pemasok tidak diizinkan.'; end if;
 if not private.smartpos_can_access_branch(v_po.business_id,v_po.branch_id) then raise exception 'Akses ke cabang ini tidak diizinkan.'; end if;
 if v_po.status<>'received' then raise exception 'Hanya pembelian yang sudah diterima dapat dibayar.'; end if;
 select coalesce(sum(sp.amount),0) into v_paid from public.supplier_payments sp where sp.purchase_id=v_po.id;
 v_remaining:=v_po.total-v_paid;
 if p_amount>v_remaining then raise exception 'Pembayaran melebihi sisa hutang: %',to_char(v_remaining,'FM999G999G999G990D00'); end if;
 insert into public.supplier_payments(business_id,branch_id,purchase_id,supplier_id,amount,payment_method,reference_no,notes,created_by)
 values(v_po.business_id,v_po.branch_id,v_po.id,v_po.supplier_id,p_amount,p_payment_method,nullif(trim(p_reference_no),''),nullif(trim(p_notes),''),auth.uid()) returning id into v_payment_id;
 insert into public.cash_entries(business_id,branch_id,entry_type,category,description,amount,reference_type,reference_id,created_by)
 values(v_po.business_id,v_po.branch_id,'expense','Pembayaran Supplier','Pembayaran hutang pembelian '||v_po.purchase_no,p_amount,'supplier_payment',v_payment_id,auth.uid()) returning id into v_cash_id;
 update public.supplier_payments set cash_entry_id=v_cash_id where id=v_payment_id;
 update public.purchase_orders set amount_paid=v_paid+p_amount where id=v_po.id;
 insert into public.audit_logs(business_id,user_id,action,table_name,record_id,details)
 values(v_po.business_id,auth.uid(),'supplier.payment.recorded','supplier_payments',v_payment_id,
 jsonb_build_object('purchase_id',v_po.id,'amount',p_amount,'payment_method',p_payment_method,'remaining_balance',v_remaining-p_amount));
 return query select v_payment_id,v_remaining-p_amount;
end; $$;
revoke all on function public.record_supplier_payment(uuid,numeric,text,text,text) from public,anon;
grant execute on function public.record_supplier_payment(uuid,numeric,text,text,text) to authenticated;
