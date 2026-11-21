alter table public.products
  add column if not exists variant_parent_id uuid references public.products(id) on delete restrict,
  add column if not exists variant_label text;

create index if not exists products_variant_parent_idx
  on public.products(business_id, variant_parent_id) where variant_parent_id is not null;

create or replace function public.create_product_variant(
  p_parent_product_id uuid,
  p_branch_id uuid,
  p_warehouse_id uuid,
  p_variant_label text,
  p_sku text,
  p_barcode text,
  p_cost_price numeric,
  p_selling_price numeric,
  p_min_stock numeric,
  p_initial_quantity numeric
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent public.products%rowtype;
  v_new_id uuid;
begin
  if auth.uid() is null then raise exception 'Silakan masuk terlebih dahulu.'; end if;
  select * into v_parent from public.products
   where id=p_parent_product_id and is_active=true for share;
  if not found then raise exception 'Produk induk tidak ditemukan atau tidak aktif.'; end if;
  if not private.smartpos_has_business_role(v_parent.business_id,array['owner','admin','manager']::text[]) then
    raise exception 'Akses mengelola varian produk tidak diizinkan.';
  end if;
  if p_branch_id is null or not private.smartpos_can_access_branch(v_parent.business_id,p_branch_id) then
    raise exception 'Akses ke cabang ini tidak diizinkan.';
  end if;
  if nullif(trim(coalesce(p_variant_label,'')),'') is null or length(trim(p_variant_label))>100 then
    raise exception 'Nama varian wajib diisi (maksimal 100 karakter).';
  end if;
  if coalesce(p_cost_price,-1)<0 or coalesce(p_selling_price,-1)<0 or coalesce(p_min_stock,-1)<0 or coalesce(p_initial_quantity,-1)<0 then
    raise exception 'Harga dan stok varian tidak boleh negatif.';
  end if;
  if exists(select 1 from public.products where business_id=v_parent.business_id and is_active
    and nullif(trim(coalesce(p_sku,'')),'') is not null and lower(sku)=lower(trim(p_sku))) then
    raise exception 'SKU sudah digunakan produk lain.';
  end if;
  if exists(select 1 from public.products where business_id=v_parent.business_id and is_active
    and nullif(trim(coalesce(p_barcode,'')),'') is not null and barcode=trim(p_barcode)) then
    raise exception 'Barcode sudah digunakan produk lain.';
  end if;
  v_new_id:=private.smartpos_create_product_with_stock_impl(
    v_parent.business_id,p_branch_id,p_warehouse_id,
    v_parent.name||' - '||trim(p_variant_label),p_sku,p_barcode,
    (select c.name from public.categories c where c.id=v_parent.category_id),
    v_parent.unit,coalesce(p_cost_price,v_parent.cost_price),
    coalesce(p_selling_price,v_parent.selling_price),
    coalesce(p_min_stock,v_parent.min_stock),coalesce(p_initial_quantity,0)
  );
  update public.products set
    variant_parent_id=v_parent.id, variant_label=trim(p_variant_label),
    discount_type=v_parent.discount_type, discount_value=v_parent.discount_value,
    warranty_months=v_parent.warranty_months,
    warranty_coverage_percent=v_parent.warranty_coverage_percent,
    warranty_max_amount=v_parent.warranty_max_amount,
    warranty_min_claim=v_parent.warranty_min_claim,
    warranty_max_claims=v_parent.warranty_max_claims,
    warranty_terms=v_parent.warranty_terms
  where id=v_new_id and business_id=v_parent.business_id;
  insert into public.audit_logs(business_id,user_id,action,table_name,record_id,details)
  values(v_parent.business_id,auth.uid(),'product.variant_created','products',v_new_id,
    jsonb_build_object('parent_product_id',v_parent.id,'variant_label',trim(p_variant_label),'sku',p_sku,'barcode',p_barcode));
  return v_new_id;
end;
$$;

revoke all on function public.create_product_variant(uuid,uuid,uuid,text,text,text,numeric,numeric,numeric,numeric) from public, anon;
grant execute on function public.create_product_variant(uuid,uuid,uuid,text,text,text,numeric,numeric,numeric,numeric) to authenticated;
