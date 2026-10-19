-- =====================================================================
-- Explicit privileges, so the app works with Supabase's
-- "Automatically expose new tables" setting OFF (recommended).
-- Privileges only open the door; the row-level security policies in
-- 20261019000100_core.sql still decide what each person can see or change.
-- =====================================================================
grant usage on schema public to anon, authenticated;

-- signed-in people
grant select, update on public.profiles to authenticated;           -- update limited to admins by policy
grant select, insert, update on public.records to authenticated;    -- no delete: soft delete only
grant select on public.record_versions to authenticated;            -- written only by the history trigger
grant select on public.records_overview, public.ra_activity, public.record_fields to authenticated;

grant execute on function
  public.is_active_user(), public.is_admin(),
  public.save_record(text, jsonb, int), public.set_record_deleted(text, boolean),
  public.record_changes(text), public.set_my_display_name(text),
  public.jsonb_flatten(jsonb, text[])
to authenticated;

-- not signed in: only the keep-alive ping
grant execute on function public.keepalive_ping() to anon;

-- belt and braces: nothing else for anon, even if the setting is later switched on
revoke all on public.profiles, public.records, public.record_versions, public.keepalive from anon;
revoke all on public.records_overview, public.ra_activity, public.record_fields from anon;
revoke execute on function
  public.save_record(text, jsonb, int), public.set_record_deleted(text, boolean),
  public.record_changes(text), public.set_my_display_name(text)
from anon;
