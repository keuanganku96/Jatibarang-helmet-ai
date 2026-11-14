create table if not exists public.staff_profiles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  branch_id uuid not null references public.branches(id),
  employee_code text not null,
  full_name text not null,
  phone text,
  job_title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id,user_id),
  unique (business_id,employee_code)
);
create index if not exists staff_profiles_branch_idx on public.staff_profiles(business_id,branch_id);
alter table public.staff_profiles enable row level security;
drop policy if exists staff_profiles_read_branch on public.staff_profiles;
create policy staff_profiles_read_branch on public.staff_profiles for select to authenticated using (public.can_access_branch(business_id,branch_id));
revoke all on public.staff_profiles from public,anon,authenticated;
grant select on public.staff_profiles to authenticated;
create or replace function public.save_staff_profile(p_user_id uuid,p_branch_id uuid,p_employee_code text,p_full_name text,p_phone text default null,p_job_title text default null,p_role text default 'cashier',p_is_active boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor record; v_target record; v_profile_id uuid; v_code text := upper(trim(coalesce(p_employee_code,''))); v_name text := trim(coalesce(p_full_name,''));
begin
 if auth.uid() is null then raise exception 'Sesi login tidak valid'; end if;
 select business_id,role,branch_id into v_actor from public.business_members where user_id=auth.uid() and is_active=true order by created_at limit 1;
 if not found or v_actor.role not in ('owner','admin') then raise exception 'Hanya Owner/Admin yang dapat mengelola data karyawan'; end if;
 select business_id,role,branch_id,is_active into v_target from public.business_members where user_id=p_user_id for update;
 if not found or v_target.business_id<>v_actor.business_id then raise exception 'Akun karyawan tidak terdaftar pada bisnis ini'; end if;
 if v_target.role='owner' then raise exception 'Peran Owner utama tidak dapat diubah dari menu karyawan'; end if;
 if v_actor.role='admin' and v_target.role='admin' then raise exception 'Admin tidak dapat mengubah akun Admin lain'; end if;
 if p_role not in ('admin','manager','cashier','staff') then raise exception 'Peran karyawan tidak valid'; end if;
 if v_actor.role='admin' and p_role='admin' then raise exception 'Admin tidak dapat memberikan peran Admin'; end if;
 if p_user_id=auth.uid() and not coalesce(p_is_active,true) then raise exception 'Anda tidak dapat menonaktifkan akun sendiri'; end if;
 if v_name='' or length(v_name)>120 then raise exception 'Nama karyawan wajib diisi (maksimal 120 karakter)'; end if;
 if v_code='' or length(v_code)>32 or v_code !~ '^[A-Z0-9_-]+$' then raise exception 'Kode karyawan wajib berisi huruf, angka, tanda hubung, atau garis bawah (maksimal 32 karakter)'; end if;
 if p_branch_id is null or not exists(select 1 from public.branches b where b.id=p_branch_id and b.business_id=v_actor.business_id and b.is_active=true) then raise exception 'Cabang karyawan tidak valid'; end if;
 insert into public.staff_profiles(business_id,user_id,branch_id,employee_code,full_name,phone,job_title)
 values(v_actor.business_id,p_user_id,p_branch_id,v_code,v_name,nullif(trim(coalesce(p_phone,'')),''),nullif(trim(coalesce(p_job_title,'')),''))
 on conflict (business_id,user_id) do update set branch_id=excluded.branch_id,employee_code=excluded.employee_code,full_name=excluded.full_name,phone=excluded.phone,job_title=excluded.job_title,updated_at=now()
 returning id into v_profile_id;
 update public.business_members set branch_id=p_branch_id,role=p_role,is_active=coalesce(p_is_active,true) where user_id=p_user_id and business_id=v_actor.business_id;
 insert into public.audit_logs(business_id,user_id,action,table_name,record_id,details)
 values(v_actor.business_id,auth.uid(),'staff_profile_upsert','staff_profiles',v_profile_id,jsonb_build_object('target_user_id',p_user_id,'branch_id',p_branch_id,'employee_code',v_code,'role',p_role,'is_active',p_is_active));
 return v_profile_id;
end; $$;
revoke all on function public.save_staff_profile(uuid,uuid,text,text,text,text,text,boolean) from public,anon;
grant execute on function public.save_staff_profile(uuid,uuid,text,text,text,text,text,boolean) to authenticated;