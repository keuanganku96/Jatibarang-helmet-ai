drop policy if exists cash_entries_select_assigned on public.cash_entries;
create policy cash_entries_select_finance_roles on public.cash_entries for select to authenticated
using (public.can_access_branch(business_id,branch_id) and private.smartpos_has_business_role(business_id,array['owner','admin','manager']::text[]));
drop policy if exists purchase_orders_select_assigned on public.purchase_orders;
create policy purchase_orders_select_management_roles on public.purchase_orders for select to authenticated
using (public.can_access_branch(business_id,branch_id) and private.smartpos_has_business_role(business_id,array['owner','admin','manager']::text[]));
drop policy if exists supplier_payments_select_branch_members on public.supplier_payments;
create policy supplier_payments_select_management_roles on public.supplier_payments for select to authenticated
using (public.can_access_branch(business_id,branch_id) and private.smartpos_has_business_role(business_id,array['owner','admin','manager']::text[]));
drop policy if exists sales_select_assigned on public.sales;
create policy sales_select_by_role_and_cashier on public.sales for select to authenticated
using (public.can_access_branch(business_id,branch_id) and (private.smartpos_has_business_role(business_id,array['owner','admin','manager']::text[]) or cashier_id=(select auth.uid())));
drop policy if exists sale_items_select_assigned on public.sale_items;
create policy sale_items_select_by_role_and_cashier on public.sale_items for select to authenticated
using (exists(select 1 from public.sales s where s.id=sale_items.sale_id and s.business_id=sale_items.business_id
and public.can_access_branch(s.business_id,s.branch_id)
and (private.smartpos_has_business_role(s.business_id,array['owner','admin','manager']::text[]) or s.cashier_id=(select auth.uid()))));
drop policy if exists staff_attendance_read_branch on public.staff_attendance;
create policy staff_attendance_read_self_or_management on public.staff_attendance for select to authenticated
using (public.can_access_branch(business_id,branch_id) and (private.smartpos_has_business_role(business_id,array['owner','admin','manager']::text[]) or user_id=(select auth.uid())));
drop policy if exists cash_register_read_branch on public.cash_register_sessions;
create policy cash_register_read_self_or_management on public.cash_register_sessions for select to authenticated
using (public.can_access_branch(business_id,branch_id) and (private.smartpos_has_business_role(business_id,array['owner','admin','manager']::text[]) or cashier_id=(select auth.uid())));
drop policy if exists commission_ledger_read_branch on public.commission_ledger;
create policy commission_ledger_read_self_or_management on public.commission_ledger for select to authenticated
using (public.can_access_branch(business_id,branch_id) and (private.smartpos_has_business_role(business_id,array['owner','admin','manager']::text[]) or staff_user_id=(select auth.uid())));
drop policy if exists staff_profiles_read_branch on public.staff_profiles;
create policy staff_profiles_read_self_or_management on public.staff_profiles for select to authenticated
using (public.can_access_branch(business_id,branch_id) and (private.smartpos_has_business_role(business_id,array['owner','admin','manager']::text[]) or user_id=(select auth.uid())));