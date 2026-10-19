-- =====================================================================
-- Views for tracking RAs and for analysis. security_invoker = the viewer's own permissions apply.
-- =====================================================================

-- Who did what, per person per day.
create or replace view public.ra_activity with (security_invoker = true) as
select p.display_name,
       p.email,
       (rv.edited_at at time zone 'America/Vancouver')::date            as day,
       count(*) filter (where rv.action = 'create')                       as records_created,
       count(*) filter (where rv.action = 'edit')                         as saves,
       count(distinct rv.record_uid)                                      as records_touched,
       min(rv.edited_at)                                                  as first_save,
       max(rv.edited_at)                                                  as last_save
from public.record_versions rv
join public.profiles p on p.id = rv.edited_by
group by p.display_name, p.email, (rv.edited_at at time zone 'America/Vancouver')::date;

-- Records with the names of who made and last changed them.
create or replace view public.records_overview with (security_invoker = true) as
select r.uid, r.sailor_id, r.sailor_name, r.status, r.version,
       r.created_at, c.display_name as created_by_name,
       r.updated_at, u.display_name as updated_by_name,
       (select count(distinct rv.edited_by) from public.record_versions rv where rv.record_uid = r.uid) as n_editors,
       r.deleted_at
from public.records r
left join public.profiles c on c.id = r.created_by
left join public.profiles u on u.id = r.updated_by;

-- All data in long format: one row per filled field (same layout as the tool's CSV export).
create or replace view public.record_fields with (security_invoker = true) as
select r.uid     as record_uid,
       r.sailor_id,
       f.path[1] as section,
       f.path[2] as "group",
       case when f.path[3] ~ '^\d+$' then f.path[3]::int + 1 end                              as "row",
       case when array_length(f.path, 1) = 6 then f.path[4] end                               as subgroup,
       case when array_length(f.path, 1) = 6 and f.path[5] ~ '^\d+$' then f.path[5]::int + 1 end as subrow,
       f.path[array_length(f.path, 1)] as field,
       f.value
from public.records r
cross join lateral public.jsonb_flatten(r.data) f
where r.deleted_at is null
  and left(f.path[1], 1) <> '_';

revoke all on public.ra_activity, public.records_overview, public.record_fields from anon;
grant select on public.ra_activity, public.records_overview, public.record_fields to authenticated;
