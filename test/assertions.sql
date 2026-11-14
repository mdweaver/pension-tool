-- Automated checks of the database rules. Stops with "FAILED: ..." at the first rule that breaks.
-- Run by test/run_sql_tests.sh on a throwaway database (never on the real project).
\set ON_ERROR_STOP 1
\set QUIET 1
set client_min_messages = warning;
\o /dev/null

create schema testkit;
grant usage on schema testkit to anon, authenticated;
create function testkit.ok(cond boolean, msg text) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAILED: %', msg; end if;
  raise warning 'ok  %', msg;
end $$;
-- the statement must raise an error matching pattern
create function testkit.fails(stmt text, pattern text, msg text) returns void language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm ~* pattern then raise warning 'ok  %', msg; return; end if;
    raise exception 'FAILED: % (unexpected error: %)', msg, sqlerrm;
  end;
  raise exception 'FAILED: % (it was allowed but should have been refused)', msg;
end $$;
-- run a statement and ignore any error (used where either an error or "0 rows changed" is acceptable)
create function testkit.try(stmt text) returns void language plpgsql as $$
begin execute stmt; exception when others then null; end $$;
-- number of rows a query returns, or 0 if it is refused
create function testkit.visible(q text) returns bigint language plpgsql as $$
declare n bigint;
begin execute 'select count(*) from (' || q || ') x' into n; return n; exception when others then return 0; end $$;
grant execute on all functions in schema testkit to anon, authenticated;

\set admin '00000000-0000-0000-0000-00000000000a'
\set ra1 '00000000-0000-0000-0000-0000000000a1'
\set ra2 '00000000-0000-0000-0000-0000000000a2'
\set stranger '00000000-0000-0000-0000-0000000000ff'
insert into auth.users (id, email) values (:'admin', 'admin@test.edu'), (:'ra1', 'ra1@test.edu'), (:'ra2', 'ra2@test.edu'), (:'stranger', 'stranger@x.com');
select testkit.ok((select count(*) from profiles where not active and role = 'ra') = 4, 'every new login gets a profile that starts inactive');
update profiles set role = 'admin', active = true where id = :'admin';

-- inactive person
set role authenticated; select set_config('request.jwt.claim.sub', :'ra1', false);
select testkit.fails($q$select save_record('rtest001', '{}', 0)$q$, 'active yet', 'an inactive account cannot save');
select testkit.ok(testkit.visible('select 1 from records') = 0, 'an inactive account sees no records');
reset role;

-- admin switches RAs on
set role authenticated; select set_config('request.jwt.claim.sub', :'admin', false);
update profiles set active = true, display_name = 'Ada' where id = :'ra1';
update profiles set active = true, display_name = 'Ben' where id = :'ra2';
select testkit.ok((select count(*) from profiles where active) = 3, 'an admin can activate accounts');
select testkit.fails(format($q$update profiles set role = 'ra' where id = %L$q$, :'admin'), 'own role', 'an admin cannot demote themselves');
reset role;

-- RA creates a record; cannot fake authorship or promote themselves
set role authenticated; select set_config('request.jwt.claim.sub', :'ra1', false);
select testkit.ok((save_record('rtest001', '{"meta":{"file":{"sailor_id":"S-1","status":"P","minutes":"1"}},"personal":{"names":[{"name":"DOE, JOHN"}]}}', 0) ->> 'version')::int = 1, 'an active RA can create a record (version 1)');
select testkit.try(format($q$update records set created_by = %L, updated_by = %L where uid = 'rtest001'$q$, :'ra2', :'ra2'));
select testkit.try($q$update profiles set role = 'admin' where id = auth.uid()$q$);
reset role;
select testkit.ok((select created_by = :'ra1'::uuid and updated_by = :'ra1'::uuid from records where uid = 'rtest001'), 'creator and editor are stamped from the login and cannot be overwritten');
select testkit.ok((select role from profiles where id = :'ra1') = 'ra', 'an RA cannot make themselves admin');
select testkit.ok((select sailor_id = 'S-1' and sailor_name = 'DOE, JOHN' from records where uid = 'rtest001'), 'summary columns are filled from the form data');

-- second RA edits; first RA's stale save is refused
set role authenticated; select set_config('request.jwt.claim.sub', :'ra2', false);
select testkit.ok((save_record('rtest001', '{"meta":{"file":{"sailor_id":"S-1","status":"P","minutes":"9"}},"personal":{"names":[{"name":"DOE, JOHN H"}]}}', 1) ->> 'version')::int = 2, 'a save from the current version goes through (version 2)');
select testkit.ok((save_record('rtest001', (select data from records where uid = 'rtest001'), 2) ->> 'version')::int = 2, 'saving unchanged data does not create a new version');
reset role;
set role authenticated; select set_config('request.jwt.claim.sub', :'ra1', false);
select testkit.ok((save_record('rtest001', '{"meta":{"file":{"sailor_id":"S-1"}}}', 1) ->> 'conflict')::boolean, 'a save from a stale copy is refused as a conflict');
select testkit.ok((save_record('rtest001', '{}', 1) ->> 'updated_by') = 'Ben', 'the conflict names who saved in between');
-- RA cannot delete or touch history
select testkit.try($q$delete from records where uid = 'rtest001'$q$);
select testkit.ok(testkit.visible($q$select 1 from records where uid = 'rtest001'$q$) = 1, 'an RA cannot hard-delete a record');
select testkit.fails($q$select set_record_deleted('rtest001', true)$q$, 'only an admin', 'an RA cannot soft-delete a record');
select testkit.try($q$insert into record_versions (record_uid, version, action, data) values ('rtest001', 99, 'edit', '{}')$q$);
select testkit.try($q$delete from record_versions$q$);
select testkit.try($q$update record_versions set edited_by = null$q$);
-- history and field-level changes
select testkit.ok(exists (select 1 from record_changes('rtest001') where version = 2 and path = 'personal.names.0.name' and old_value = 'DOE, JOHN' and new_value = 'DOE, JOHN H' and edited_by = 'Ben'), 'field-level history shows who changed what, before and after');
select testkit.ok(not exists (select 1 from record_changes('rtest001') where path = 'meta.file.minutes'), 'the minutes counter is left out of the change log');
reset role;
select testkit.ok((select count(*) from records where uid = 'rtest001') = 1, 'records cannot be hard-deleted by an RA');
select testkit.ok((select string_agg(action || ':' || edited_by::text, ',' order by version) from record_versions where record_uid = 'rtest001') = 'create:' || :'ra1' || ',edit:' || :'ra2', 'history holds exactly one entry per real save, with the right person, untouched by the RA');

-- admin soft-deletes and restores
set role authenticated; select set_config('request.jwt.claim.sub', :'admin', false);
select set_record_deleted('rtest001', true);
reset role;
set role authenticated; select set_config('request.jwt.claim.sub', :'ra2', false);
select testkit.fails($q$select save_record('rtest001', '{}', 3)$q$, 'deleted', 'a deleted record cannot be saved');
reset role;
set role authenticated; select set_config('request.jwt.claim.sub', :'admin', false);
select set_record_deleted('rtest001', false);
select testkit.ok((select string_agg(action, ',' order by version) from record_versions where record_uid = 'rtest001') = 'create,edit,delete,restore', 'delete and restore are recorded in the history');
select testkit.ok((select n_editors from records_overview where uid = 'rtest001') = 3 and (select created_by_name from records_overview where uid = 'rtest001') = 'Ada', 'records_overview names the creator and counts editors');
select testkit.ok((select sum(saves) from ra_activity) >= 1 and (select sum(records_created) from ra_activity) = 1, 'ra_activity summarises work per person');
select testkit.ok(exists (select 1 from record_fields where record_uid = 'rtest001' and section = 'personal' and "group" = 'names' and "row" = 1 and field = 'name' and value = 'DOE, JOHN H'), 'record_fields gives the long-format data');
reset role;

-- signed-out visitor and a stray account
set role anon;
select testkit.ok(testkit.visible('select 1 from records') = 0 and testkit.visible('select 1 from record_versions') = 0 and testkit.visible('select 1 from profiles') = 0, 'a signed-out visitor sees nothing');
select testkit.fails($q$select save_record('rzzzz1', '{}', 0)$q$, 'permission denied|active yet', 'a signed-out visitor cannot save');
select testkit.ok(keepalive_ping() is not null, 'the keep-alive ping works without signing in');
reset role;
set role authenticated; select set_config('request.jwt.claim.sub', :'stranger', false);
select testkit.ok(testkit.visible('select 1 from records') = 0 and testkit.visible('select 1 from record_versions') = 0, 'an account nobody activated sees nothing');
reset role;
-- extra sources in a one-off block and in a repeat block show up as subgroup / subrow
set role authenticated; select set_config('request.jwt.claim.sub', :'admin', false);
select save_record('rtest002', '{"_uid":"rtest002","meta":{"file":{"sailor_id":"S-2"}},"personal":{"death":{"srcs":[{"field":"date","url":"https://x/1","note":"p. 1"},{"field":"","url":"https://x/2","note":""}]},"names":[{"name":"A","srcs":[{"field":"","url":"https://x/3","note":""}]}]}}', 0);
select testkit.ok((select count(*) from record_fields where record_uid = 'rtest002' and "group" = 'death' and subgroup = 'srcs' and field = 'url' and subrow in (1,2)) = 2, 'record_fields numbers extra sources in one-off blocks');
select testkit.ok(exists (select 1 from record_fields where record_uid = 'rtest002' and "group" = 'names' and "row" = 1 and subgroup = 'srcs' and subrow = 1 and field = 'url'), 'record_fields numbers extra sources in repeat blocks');
reset role;
-- list options: admins promote typed values into the form's lists; everyone active reads them
set role authenticated; select set_config('request.jwt.claim.sub', :'ra2', false);
select testkit.fails($q$insert into list_options (list, value) values ('MF', 'Unknown')$q$, 'row-level security|permission denied', 'an RA cannot add a list option');
select testkit.ok(testkit.visible('select 1 from list_options') = 0, 'there are no list options yet');
reset role;
set role authenticated; select set_config('request.jwt.claim.sub', :'admin', false);
insert into list_options (list, value, created_by) values ('MF', 'Unknown', :'ra2');
select testkit.ok((select created_by = :'admin'::uuid and created_at is not null from list_options where list = 'MF'), 'who added an option comes from the login, not the browser');
select testkit.fails($q$insert into list_options (list, value) values ('MF', 'UNKNOWN')$q$, 'duplicate key', 'the same option cannot be added twice, whatever the capitals');
select testkit.fails($q$insert into list_options (list, value) values ('QC', 'Z')$q$, 'check constraint', 'quality codes cannot be extended');
select testkit.fails($q$insert into list_options (list, value) values ('MF', ' padded ')$q$, 'check constraint', 'options are stored trimmed');
reset role;
set role authenticated; select set_config('request.jwt.claim.sub', :'ra2', false);
select testkit.ok(testkit.visible('select 1 from list_options') = 1, 'an RA can read the list options');
select testkit.try($q$delete from list_options$q$);
select testkit.ok(testkit.visible('select 1 from list_options') = 1, 'an RA cannot remove a list option');
reset role;
set role anon;
select testkit.ok(testkit.visible('select 1 from list_options') = 0, 'a signed-out visitor sees no list options');
reset role;
set role authenticated; select set_config('request.jwt.claim.sub', :'admin', false);
delete from list_options where list = 'MF' and value = 'Unknown';
select testkit.ok(testkit.visible('select 1 from list_options') = 0, 'an admin can remove a list option');
reset role;
\echo ALL DATABASE ASSERTIONS PASSED
