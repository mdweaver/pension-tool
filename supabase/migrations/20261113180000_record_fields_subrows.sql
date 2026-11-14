-- "More sources" lists can sit inside one-off blocks too (path: section.group.srcs.N.field, 5 parts).
-- Teach record_fields to report them as subgroup / subrow. Same columns as before; safe to re-run.
create or replace view public.record_fields with (security_invoker = true) as
select r.uid     as record_uid,
       r.sailor_id,
       f.path[1] as section,
       f.path[2] as "group",
       case when f.path[3] ~ '^\d+$' then f.path[3]::int + 1 end as "row",
       case when array_length(f.path, 1) = 6 then f.path[4]
            when array_length(f.path, 1) = 5 and f.path[4] ~ '^\d+$' and f.path[3] !~ '^\d+$' then f.path[3] end as subgroup,
       case when array_length(f.path, 1) = 6 and f.path[5] ~ '^\d+$' then f.path[5]::int + 1
            when array_length(f.path, 1) = 5 and f.path[4] ~ '^\d+$' and f.path[3] !~ '^\d+$' then f.path[4]::int + 1 end as subrow,
       f.path[array_length(f.path, 1)] as field,
       f.value
from public.records r
cross join lateral public.jsonb_flatten(r.data) f
where r.deleted_at is null
  and left(f.path[1], 1) <> '_';

revoke all on public.record_fields from anon;
grant select on public.record_fields to authenticated;
