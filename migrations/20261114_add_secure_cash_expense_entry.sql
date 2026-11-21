-- Add a permission-checked cash expense entry operation for the finance module.
create or replace function public.record_cash_expense(
  p_business_id uuid,
  p_branch_id uuid,
  p_category text,
  p_description text,
  p_amount numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry_id uuid;
  v_category text := nullif(btrim(p_category), '');
  v_description text := nullif(btrim(p_description), '');
begin
  if auth.uid() is null then
    raise exception 'Silakan masuk terlebih dahulu.';
  end if;
  if not private.smartpos_has_business_role(p_business_id, array['owner', 'admin', 'manager']::text[]) then
    raise exception 'Hanya Owner, Admin, atau Manager yang dapat mencatat pengeluaran.';
  end if;
  if p_branch_id is null or not private.smartpos_can_access_branch(p_business_id, p_branch_id) then
    raise exception 'Akses ke cabang ini tidak diizinkan.';
  end if;
  if not exists (select 1 from public.branches b where b.id=p_branch_id and b.business_id=p_business_id and b.is_active=true) then
    raise exception 'Cabang tidak ditemukan atau tidak aktif.';
  end if;
  if v_category is null or length(v_category)>80 then
    raise exception 'Kategori pengeluaran wajib diisi (maksimal 80 karakter).';
  end if;
  if v_description is null or length(v_description)>500 then
    raise exception 'Keterangan pengeluaran wajib diisi (maksimal 500 karakter).';
  end if;
  if p_amount is null or p_amount<=0 or p_amount>1000000000000 then
    raise exception 'Nominal pengeluaran harus lebih dari nol dan dalam batas wajar.';
  end if;
  insert into public.cash_entries(business_id,branch_id,entry_type,category,description,amount,reference_type,created_by)
  values(p_business_id,p_branch_id,'expense',v_category,v_description,p_amount,'manual_expense',auth.uid())
  returning id into v_entry_id;
  insert into public.audit_logs(business_id,user_id,action,table_name,record_id,details)
  values(p_business_id,auth.uid(),'cash.expense.create','cash_entries',v_entry_id,
    jsonb_build_object('branch_id',p_branch_id,'category',v_category,'amount',p_amount));
  return v_entry_id;
end;
$$;
revoke all on function public.record_cash_expense(uuid,uuid,text,text,numeric) from public, anon;
grant execute on function public.record_cash_expense(uuid,uuid,text,text,numeric) to authenticated;
