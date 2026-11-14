drop policy if exists suppliers_select_members on public.suppliers;
create policy suppliers_select_management_roles on public.suppliers for select to authenticated
using (private.smartpos_has_business_role(business_id,array['owner','admin','manager']::text[]));
drop policy if exists commission_rules_read_business on public.commission_rules;
create policy commission_rules_read_management_roles on public.commission_rules for select to authenticated
using (private.smartpos_has_business_role(business_id,array['owner','admin','manager']::text[]));
drop policy if exists commission_payouts_read_branch on public.commission_payouts;
create policy commission_payouts_read_management_roles on public.commission_payouts for select to authenticated
using (public.can_access_branch(business_id,branch_id) and private.smartpos_has_business_role(business_id,array['owner','admin','manager']::text[]));
drop policy if exists sale_payments_select_assigned on public.sale_payments;
create policy sale_payments_select_by_role_and_cashier on public.sale_payments for select to authenticated
using (exists(select 1 from public.sales s where s.id=sale_payments.sale_id and s.business_id=sale_payments.business_id
and public.can_access_branch(s.business_id,s.branch_id)
and (private.smartpos_has_business_role(s.business_id,array['owner','admin','manager']::text[]) or s.cashier_id=(select auth.uid()))));
drop policy if exists stock_opnames_read_branch on public.stock_opnames;
create policy stock_opnames_read_management_roles on public.stock_opnames for select to authenticated
using (public.can_access_branch(business_id,branch_id) and private.smartpos_has_business_role(business_id,array['owner','admin','manager']::text[]));
drop policy if exists stock_opname_items_read_branch on public.stock_opname_items;
create policy stock_opname_items_read_management_roles on public.stock_opname_items for select to authenticated
using (exists(select 1 from public.stock_opnames o where o.id=stock_opname_items.opname_id
and public.can_access_branch(o.business_id,o.branch_id)
and private.smartpos_has_business_role(o.business_id,array['owner','admin','manager']::text[])));
drop policy if exists stock_transfers_read_branches on public.stock_transfers;
create policy stock_transfers_read_management_roles on public.stock_transfers for select to authenticated
using (public.can_access_branch(business_id,from_branch_id) and public.can_access_branch(business_id,to_branch_id)
and private.smartpos_has_business_role(business_id,array['owner','admin','manager']::text[]));
drop policy if exists stock_transfer_items_read_branches on public.stock_transfer_items;
create policy stock_transfer_items_read_management_roles on public.stock_transfer_items for select to authenticated
using (exists(select 1 from public.stock_transfers t where t.id=stock_transfer_items.transfer_id
and public.can_access_branch(t.business_id,t.from_branch_id) and public.can_access_branch(t.business_id,t.to_branch_id)
and private.smartpos_has_business_role(t.business_id,array['owner','admin','manager']::text[])));
drop policy if exists purchase_items_select_assigned on public.purchase_items;
create policy purchase_items_select_management_roles on public.purchase_items for select to authenticated
using (exists(select 1 from public.purchase_orders po where po.id=purchase_items.purchase_id
and po.business_id=purchase_items.business_id and public.can_access_branch(po.business_id,po.branch_id)
and private.smartpos_has_business_role(po.business_id,array['owner','admin','manager']::text[])));