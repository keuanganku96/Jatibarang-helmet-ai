-- Keep auth.uid() evaluation outside per-row RLS evaluation.
-- This changes only expression evaluation; policy roles, commands, and access
-- semantics remain unchanged.

BEGIN;

ALTER POLICY business_create_owner
  ON public.businesses
  WITH CHECK (created_by = (SELECT auth.uid()));

ALTER POLICY profile_select_self
  ON public.user_profiles
  USING (id = (SELECT auth.uid()));

ALTER POLICY profile_insert_self
  ON public.user_profiles
  WITH CHECK (id = (SELECT auth.uid()));

ALTER POLICY profile_update_self
  ON public.user_profiles
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

ALTER POLICY members_add_self_as_owner
  ON public.business_members
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND role = 'owner'
    AND EXISTS (
      SELECT 1
      FROM public.businesses b
      WHERE b.id = business_members.business_id
        AND b.created_by = (SELECT auth.uid())
    )
  );

DO $verify$
DECLARE
  v_missing text;
  v_count integer;
BEGIN
  SELECT count(*)
    INTO v_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (
      (tablename = 'businesses' AND policyname = 'business_create_owner')
      OR (tablename = 'user_profiles' AND policyname IN (
        'profile_select_self', 'profile_insert_self', 'profile_update_self'
      ))
      OR (tablename = 'business_members' AND policyname = 'members_add_self_as_owner')
    );

  IF v_count <> 5 THEN
    RAISE EXCEPTION 'Expected 5 RLS policies to remain; found %', v_count;
  END IF;

  SELECT string_agg(tablename || '.' || policyname, ', ')
    INTO v_missing
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (
      (tablename = 'businesses' AND policyname = 'business_create_owner'
        AND coalesce(with_check, '') NOT ILIKE '%select auth.uid()%')
      OR (tablename = 'user_profiles' AND policyname = 'profile_select_self'
        AND coalesce(qual, '') NOT ILIKE '%select auth.uid()%')
      OR (tablename = 'user_profiles' AND policyname = 'profile_insert_self'
        AND coalesce(with_check, '') NOT ILIKE '%select auth.uid()%')
      OR (tablename = 'user_profiles' AND policyname = 'profile_update_self'
        AND (coalesce(qual, '') NOT ILIKE '%select auth.uid()%'
          OR coalesce(with_check, '') NOT ILIKE '%select auth.uid()%'))
      OR (tablename = 'business_members' AND policyname = 'members_add_self_as_owner'
        AND coalesce(with_check, '') NOT ILIKE '%select auth.uid()%')
    );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'RLS initplan optimization verification failed for: %', v_missing;
  END IF;
END
$verify$;

COMMIT;
