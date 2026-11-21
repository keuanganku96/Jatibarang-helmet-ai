-- Product photo storage and secure product editing for SMART POS JATIBARANG.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('product-images','product-images',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=true,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists "Product images upload by business managers" on storage.objects;
create policy "Product images upload by business managers"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'product-images'
  and exists (
    select 1 from public.business_members bm
    where bm.business_id::text = (storage.foldername(name))[1]
      and bm.user_id = (select auth.uid())
      and bm.is_active = true
      and bm.role in ('owner','admin','manager')
  )
);

drop policy if exists "Product images delete by business managers" on storage.objects;
create policy "Product images delete by business managers"
on storage.objects for delete to authenticated
using (
  bucket_id = 'product-images'
  and exists (
    select 1 from public.business_members bm
    where bm.business_id::text = (storage.foldername(name))[1]
      and bm.user_id = (select auth.uid())
      and bm.is_active = true
      and bm.role in ('owner','admin','manager')
  )
);

create or replace function public.update_product_details(
  p_product_id uuid,
  p_name text,
  p_sku text,
  p_barcode text,
  p_category text,
  p_unit text,
  p_cost_price numeric,
  p_selling_price numeric,
  p_min_stock numeric,
  p_discount_type text,
  p_discount_value numeric,
  p_warranty_months integer default 0,
  p_warranty_coverage_percent numeric default 0,
  p_warranty_max_amount numeric default null,
  p_warranty_min_claim numeric default 0,
  p_warranty_max_claims integer default 1,
  p_warranty_terms text default null,
  p_image_url text default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_business_id uuid;
  v_category_id uuid;
  v_product_id uuid;
begin
  if auth.uid() is null then raise exception 'Silakan masuk terlebih dahulu.'; end if;
  select business_id into v_business_id
  from public.products where id = p_product_id and is_active = true
  for update;
  if v_business_id is null then raise exception 'Produk tidak ditemukan atau tidak aktif.'; end if;
  if not private.smartpos_has_business_role(v_business_id,array['owner','admin','manager']::text[]) then
    raise exception 'Akses mengelola produk tidak diizinkan.';
  end if;
  if nullif(trim(coalesce(p_name,'')),'') is null or length(trim(p_name)) > 180 then
    raise exception 'Nama produk wajib diisi (maksimal 180 karakter).';
  end if;
  if coalesce(p_cost_price,-1) < 0 or coalesce(p_selling_price,-1) < 0 or coalesce(p_min_stock,-1) < 0 then
    raise exception 'Harga dan stok minimum tidak boleh negatif.';
  end if;
  if coalesce(p_discount_type,'none') not in ('none','percent','fixed')
    or coalesce(p_discount_value,0) < 0
    or (p_discount_type='percent' and p_discount_value>100) then
    raise exception 'Pengaturan diskon produk tidak valid.';
  end if;
  if coalesce(p_warranty_months,0) not between 0 and 120
    or coalesce(p_warranty_coverage_percent,0) not between 0 and 100
    or coalesce(p_warranty_min_claim,0)<0
    or coalesce(p_warranty_max_claims,1) not between 1 and 20
    or (p_warranty_max_amount is not null and p_warranty_max_amount<0) then
    raise exception 'Pengaturan garansi tidak valid.';
  end if;
  if p_image_url is not null and length(p_image_url)>2048 then
    raise exception 'Alamat foto produk terlalu panjang.';
  end if;
  select id into v_category_id
  from public.categories
  where business_id=v_business_id and lower(name)=lower(trim(coalesce(p_category,'')))
  limit 1;
  if v_category_id is null and nullif(trim(coalesce(p_category,'')),'') is not null then
    insert into public.categories(business_id,name)
    values(v_business_id,left(trim(p_category),100))
    returning id into v_category_id;
  end if;
  update public.products set
    name=trim(p_name),
    sku=nullif(trim(coalesce(p_sku,'')),''),
    barcode=nullif(trim(coalesce(p_barcode,'')),''),
    category_id=v_category_id,
    unit=coalesce(nullif(trim(p_unit),''),'pcs'),
    cost_price=p_cost_price,
    selling_price=p_selling_price,
    min_stock=p_min_stock,
    discount_type=coalesce(p_discount_type,'none'),
    discount_value=coalesce(p_discount_value,0),
    warranty_months=coalesce(p_warranty_months,0),
    warranty_coverage_percent=coalesce(p_warranty_coverage_percent,0),
    warranty_max_amount=p_warranty_max_amount,
    warranty_min_claim=coalesce(p_warranty_min_claim,0),
    warranty_max_claims=coalesce(p_warranty_max_claims,1),
    warranty_terms=nullif(trim(coalesce(p_warranty_terms,'')),''),
    image_url=p_image_url,
    updated_at=now()
  where id=p_product_id and business_id=v_business_id
  returning id into v_product_id;
  insert into public.audit_logs(business_id,user_id,action,table_name,record_id,details)
  values(v_business_id,auth.uid(),'product_updated','products',v_product_id,
    jsonb_build_object('name',trim(p_name),'image_updated',p_image_url is not null));
  return v_product_id;
end;
$function$;

revoke all on function public.update_product_details(uuid,text,text,text,text,text,numeric,numeric,numeric,text,numeric,integer,numeric,numeric,numeric,integer,text,text) from public,anon;
grant execute on function public.update_product_details(uuid,text,text,text,text,text,numeric,numeric,numeric,text,numeric,integer,numeric,numeric,numeric,integer,text,text) to authenticated;
