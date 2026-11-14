-- SMART POS JATIBARANG: product warranty setup, automatic issuance, claims and review
alter table public.products
  add column if not exists warranty_months integer not null default 0 check (warranty_months between 0 and 120),
  add column if not exists warranty_coverage_percent numeric(5,2) not null default 0 check (warranty_coverage_percent between 0 and 100),
  add column if not exists warranty_max_amount numeric(14,2),
  add column if not exists warranty_min_claim numeric(14,2) not null default 0 check (warranty_min_claim >= 0),
  add column if not exists warranty_max_claims integer not null default 1 check (warranty_max_claims between 1 and 20),
  add column if not exists warranty_terms text;

create table if not exists public.warranties (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete restrict,
  sale_item_id uuid not null unique references public.sale_items(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete set null,
  product_id uuid not null references public.products(id) on delete restrict,
  product_name text not null, invoice_no text not null, warranty_code text not null unique,
  purchase_date timestamptz not null, expires_at timestamptz not null,
  quantity numeric(14,3) not null check (quantity > 0),
  purchase_value numeric(14,2) not null check (purchase_value >= 0),
  coverage_percent numeric(5,2) not null check (coverage_percent between 0 and 100),
  max_coverage_amount numeric(14,2),
  min_claim_amount numeric(14,2) not null default 0,
  max_claims integer not null default 1 check (max_claims between 1 and 20),
  terms text, claims_used integer not null default 0 check (claims_used >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.warranty_claims (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  warranty_id uuid not null references public.warranties(id) on delete restrict,
  claim_no text not null unique, claim_description text not null,
  coverage_value numeric(14,2) not null check (coverage_value >= 0),
  status text not null default 'submitted' check (status in ('submitted','approved','rejected','used','cancelled')),
  processed_by uuid references auth.users(id) on delete set null,
  processed_at timestamptz, resolution_notes text,
  created_at timestamptz not null default now()
);

create index if not exists warranties_business_expiry_idx on public.warranties(business_id,expires_at);
create index if not exists warranties_customer_idx on public.warranties(customer_id);
create index if not exists warranty_claims_warranty_idx on public.warranty_claims(warranty_id,created_at desc);

alter table public.warranties enable row level security;
alter table public.warranty_claims enable row level security;

drop policy if exists warranties_select_branch_members on public.warranties;
create policy warranties_select_branch_members on public.warranties for select to authenticated
using (exists (select 1 from public.sales s where s.id=warranties.sale_id
  and s.business_id=warranties.business_id and public.can_access_branch(s.business_id,s.branch_id)));

drop policy if exists warranty_claims_select_branch_members on public.warranty_claims;
create policy warranty_claims_select_branch_members on public.warranty_claims for select to authenticated
using (exists (select 1 from public.warranties w join public.sales s
  on s.id=w.sale_id and s.business_id=w.business_id
  where w.id=warranty_claims.warranty_id and w.business_id=warranty_claims.business_id
  and public.can_access_branch(s.business_id,s.branch_id)));

grant select on public.warranties,public.warranty_claims to authenticated;

create or replace function private.smartpos_create_warranty_from_sale_item()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_sale public.sales%rowtype; v_product public.products%rowtype; v_warranty_id uuid;
begin
  select * into v_sale from public.sales where id=new.sale_id and business_id=new.business_id;
  if not found or v_sale.status<>'paid' then return new; end if;
  select * into v_product from public.products where id=new.product_id and business_id=new.business_id;
  if not found or coalesce(v_product.warranty_months,0)<=0 then return new; end if;
  insert into public.warranties(
    business_id,sale_id,sale_item_id,customer_id,product_id,product_name,invoice_no,
    warranty_code,purchase_date,expires_at,quantity,purchase_value,coverage_percent,
    max_coverage_amount,min_claim_amount,max_claims,terms
  ) values (
    new.business_id,new.sale_id,new.id,v_sale.customer_id,new.product_id,new.product_name,
    v_sale.invoice_no,'JHW-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)),
    v_sale.created_at,v_sale.created_at+make_interval(months=>v_product.warranty_months),
    new.quantity,greatest(0,new.line_total),v_product.warranty_coverage_percent,
    v_product.warranty_max_amount,v_product.warranty_min_claim,v_product.warranty_max_claims,
    v_product.warranty_terms
  ) on conflict(sale_item_id) do nothing returning id into v_warranty_id;
  if v_warranty_id is not null then
    insert into public.audit_logs(business_id,user_id,action,table_name,record_id,details)
    values(new.business_id,auth.uid(),'warranty.created','warranties',v_warranty_id,
      jsonb_build_object('sale_id',new.sale_id,'sale_item_id',new.id,'product_id',new.product_id));
  end if;
  return new;
end; $$;

drop trigger if exists smartpos_sale_item_create_warranty on public.sale_items;
create trigger smartpos_sale_item_create_warranty after insert on public.sale_items
for each row execute function private.smartpos_create_warranty_from_sale_item();

drop function if exists public.create_product_with_stock_discounted(uuid,uuid,uuid,text,text,text,text,text,numeric,numeric,numeric,numeric,text,numeric);
create function public.create_product_with_stock_discounted(
 p_business_id uuid,p_branch_id uuid,p_warehouse_id uuid,p_name text,p_sku text,p_barcode text,
 p_category text,p_unit text,p_cost_price numeric,p_selling_price numeric,p_min_stock numeric,
 p_initial_quantity numeric,p_discount_type text,p_discount_value numeric,
 p_warranty_months integer default 0,p_warranty_coverage_percent numeric default 0,
 p_warranty_max_amount numeric default null,p_warranty_min_claim numeric default 0,
 p_warranty_max_claims integer default 1,p_warranty_terms text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_product_id uuid;
begin
 if auth.uid() is null then raise exception 'Silakan masuk terlebih dahulu.'; end if;
 if not private.smartpos_has_business_role(p_business_id,array['owner','admin','manager']::text[]) then
  raise exception 'Akses mengelola produk tidak diizinkan.';
 end if;
 if coalesce(p_discount_type,'none') not in ('none','percent','fixed') or coalesce(p_discount_value,0)<0
   or (p_discount_type='percent' and p_discount_value>100) then raise exception 'Pengaturan diskon produk tidak valid.'; end if;
 if coalesce(p_warranty_months,0) not between 0 and 120
   or coalesce(p_warranty_coverage_percent,0) not between 0 and 100
   or coalesce(p_warranty_min_claim,0)<0 or coalesce(p_warranty_max_claims,1) not between 1 and 20
   or (p_warranty_max_amount is not null and p_warranty_max_amount<0) then
  raise exception 'Pengaturan garansi tidak valid.';
 end if;
 v_product_id:=private.smartpos_create_product_with_stock_impl(
  p_business_id,p_branch_id,p_warehouse_id,p_name,p_sku,p_barcode,p_category,p_unit,
  p_cost_price,p_selling_price,p_min_stock,p_initial_quantity);
 update public.products set discount_type=coalesce(p_discount_type,'none'),
  discount_value=coalesce(p_discount_value,0),warranty_months=coalesce(p_warranty_months,0),
  warranty_coverage_percent=coalesce(p_warranty_coverage_percent,0),
  warranty_max_amount=p_warranty_max_amount,warranty_min_claim=coalesce(p_warranty_min_claim,0),
  warranty_max_claims=coalesce(p_warranty_max_claims,1),warranty_terms=nullif(trim(p_warranty_terms),'')
 where id=v_product_id and business_id=p_business_id;
 return v_product_id;
end; $$;

revoke all on function public.create_product_with_stock_discounted(uuid,uuid,uuid,text,text,text,text,text,numeric,numeric,numeric,numeric,text,numeric,integer,numeric,numeric,numeric,integer,text) from public,anon;
grant execute on function public.create_product_with_stock_discounted(uuid,uuid,uuid,text,text,text,text,text,numeric,numeric,numeric,numeric,text,numeric,integer,numeric,numeric,numeric,integer,text) to authenticated;

create or replace function public.submit_warranty_claim(p_warranty_id uuid,p_claim_description text)
returns table(claim_id uuid,claim_no text,coverage_value numeric,status text)
language plpgsql security definer set search_path='' as $$
declare v_w public.warranties%rowtype; v_sale public.sales%rowtype;
 v_claim_id uuid; v_claim_no text; v_claim_count integer; v_coverage numeric(14,2);
begin
 if auth.uid() is null then raise exception 'Silakan masuk terlebih dahulu.'; end if;
 if nullif(trim(p_claim_description),'') is null or length(trim(p_claim_description))>2000 then
  raise exception 'Keterangan klaim wajib diisi (maksimal 2.000 karakter).';
 end if;
 select * into v_w from public.warranties where id=p_warranty_id for update;
 if not found then raise exception 'Data garansi tidak ditemukan.'; end if;
 select * into v_sale from public.sales where id=v_w.sale_id and business_id=v_w.business_id;
 if not found or not public.can_access_branch(v_sale.business_id,v_sale.branch_id) then
  raise exception 'Anda tidak memiliki akses ke cabang transaksi ini.';
 end if;
 if now()>v_w.expires_at then raise exception 'Masa garansi sudah berakhir.'; end if;
 select count(*) into v_claim_count from public.warranty_claims
  where warranty_id=v_w.id and status in ('submitted','approved','used');
 if v_claim_count>=v_w.max_claims then raise exception 'Jumlah klaim aktif sudah mencapai batas garansi.'; end if;
 v_coverage:=round(v_w.purchase_value*v_w.coverage_percent/100,2);
 if v_w.max_coverage_amount is not null then v_coverage:=least(v_coverage,v_w.max_coverage_amount); end if;
 if v_coverage<v_w.min_claim_amount then raise exception 'Nilai perlindungan di bawah minimal klaim yang ditetapkan.'; end if;
 v_claim_no:='KLG-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12));
 insert into public.warranty_claims(business_id,warranty_id,claim_no,claim_description,coverage_value,status)
 values(v_w.business_id,v_w.id,v_claim_no,trim(p_claim_description),v_coverage,'submitted') returning id into v_claim_id;
 insert into public.audit_logs(business_id,user_id,action,table_name,record_id,details)
 values(v_w.business_id,auth.uid(),'warranty.claim_submitted','warranty_claims',v_claim_id,
  jsonb_build_object('warranty_id',v_w.id,'coverage_value',v_coverage,'claim_no',v_claim_no));
 return query select v_claim_id,v_claim_no,v_coverage,'submitted'::text;
end; $$;

revoke all on function public.submit_warranty_claim(uuid,text) from public,anon;
grant execute on function public.submit_warranty_claim(uuid,text) to authenticated;

create or replace function public.review_warranty_claim(p_claim_id uuid,p_decision text,p_notes text default null)
returns void language plpgsql security definer set search_path='' as $$
declare v_claim public.warranty_claims%rowtype; v_w public.warranties%rowtype; v_sale public.sales%rowtype;
begin
 if auth.uid() is null then raise exception 'Silakan masuk terlebih dahulu.'; end if;
 if p_decision not in ('approved','rejected') then raise exception 'Keputusan klaim tidak valid.'; end if;
 select * into v_claim from public.warranty_claims where id=p_claim_id for update;
 if not found then raise exception 'Klaim tidak ditemukan.'; end if;
 select * into v_w from public.warranties where id=v_claim.warranty_id for update;
 select * into v_sale from public.sales where id=v_w.sale_id and business_id=v_w.business_id;
 if not found or not public.can_access_branch(v_sale.business_id,v_sale.branch_id) then
  raise exception 'Anda tidak memiliki akses ke cabang transaksi ini.';
 end if;
 if not private.smartpos_has_business_role(v_claim.business_id,array['owner','admin']::text[]) then
  raise exception 'Hanya Owner/Admin yang dapat menyetujui klaim.';
 end if;
 if v_claim.status<>'submitted' then raise exception 'Klaim sudah diproses.'; end if;
 if p_decision='approved' then
  if now()>v_w.expires_at then raise exception 'Masa garansi sudah berakhir.'; end if;
  if v_w.claims_used>=v_w.max_claims then raise exception 'Batas klaim telah tercapai.'; end if;
  update public.warranties set claims_used=claims_used+1 where id=v_w.id;
 end if;
 update public.warranty_claims set status=p_decision,processed_by=auth.uid(),processed_at=now(),
  resolution_notes=nullif(trim(p_notes),'') where id=v_claim.id;
 insert into public.audit_logs(business_id,user_id,action,table_name,record_id,details)
 values(v_claim.business_id,auth.uid(),'warranty.claim_'||p_decision,'warranty_claims',v_claim.id,
  jsonb_build_object('warranty_id',v_w.id,'claim_no',v_claim.claim_no,'notes',p_notes));
end; $$;

revoke all on function public.review_warranty_claim(uuid,text,text) from public,anon;
grant execute on function public.review_warranty_claim(uuid,text,text) to authenticated;
