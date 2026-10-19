\set ON_ERROR_STOP 0
\pset footer off
-- three logins
insert into auth.users (id, email) values
 ('00000000-0000-0000-0000-00000000000a','admin@ubc.ca'),
 ('00000000-0000-0000-0000-0000000000a1','ra1@ubc.ca'),
 ('00000000-0000-0000-0000-0000000000a2','ra2@ubc.ca'),
 ('00000000-0000-0000-0000-0000000000ff','stranger@x.com');
\echo == profiles made automatically, all inactive
select email, role, active from profiles order by email;
-- bootstrap the first admin (as postgres, like the SQL editor)
update profiles set role='admin', active=true where email='admin@ubc.ca';

\echo == T1 inactive RA cannot read or save
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select count(*) as visible_profiles from profiles;
select save_record('rabc123', '{"meta":{"file":{"sailor_id":"S1"}}}', 0);
reset role;

\echo == T2 admin activates RAs through the table (RLS update)
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update profiles set active = true, display_name = 'Ada RA' where email = 'ra1@ubc.ca';
update profiles set active = true, display_name = 'Ben RA' where email = 'ra2@ubc.ca';
\echo == T3 admin cannot demote self
update profiles set role = 'ra' where email = 'admin@ubc.ca';
reset role;

\echo == T4 RA1 creates a record; trigger stamps creator, sailor_id, name
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select save_record('rabc123', '{"_uid":"rabc123","meta":{"file":{"sailor_id":"S-001","status":"P","minutes":"3"}},"personal":{"names":[{"name":"JOHNSON, HENRY"}]},"family":{"children":[{"name":"WILLIAM","sex":"M"}]}}', 0);
\echo == T5 RA1 cannot make an RA an admin
update profiles set role='admin' where email='ra1@ubc.ca';
select role from profiles where email='ra1@ubc.ca';
\echo == T6 RA1 cannot fake updated_by / created_by via direct update
update records set created_by = '00000000-0000-0000-0000-0000000000a2', updated_by='00000000-0000-0000-0000-0000000000a2', data = jsonb_set(data,'{meta,file,status}','"C"') where uid='rabc123';
select uid, version, status, (select email from profiles where id=created_by) creator, (select email from profiles where id=updated_by) last_editor from records;
reset role;

\echo == T7 RA2 edits with the right base version (2) -> v3
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
select save_record('rabc123', '{"_uid":"rabc123","_modified":"x","meta":{"file":{"sailor_id":"S-001","status":"C","minutes":"9"}},"personal":{"names":[{"name":"JOHNSON, HENRY T"}]},"family":{"children":[{"name":"WILLIAM","sex":"M"},{"name":"ROSA","sex":"F"}]}}', 2);
\echo == T8 RA1 saves from a stale copy (base 2) -> conflict naming Ben RA
reset role; set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select save_record('rabc123', '{"meta":{"file":{"sailor_id":"S-001"}}}', 2) - 'updated_at';
\echo == T9 saving identical data creates no new version
reset role; set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
select save_record('rabc123', (select data from records where uid='rabc123'), 3) - 'updated_at';
\echo == T10 RA cannot delete (hard or soft) or write history
delete from records where uid='rabc123';
select set_record_deleted('rabc123', true);
insert into record_versions(record_uid, version, action, data) values ('rabc123', 99, 'edit', '{}');
delete from record_versions;
reset role;

\echo == T11 history with editors
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
select version, action, (select display_name from profiles where id=edited_by) as who from record_versions order by version;
\echo == T12 field-level changes (minutes and _keys ignored)
select version, edited_by, path, old_value, new_value from record_changes('rabc123') where version > 1;
reset role;

\echo == T13 admin soft-deletes then restores; RA save on deleted record refused
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select set_record_deleted('rabc123', true);
reset role; set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select save_record('rabc123', '{}', 4);
reset role; set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select set_record_deleted('rabc123', false);
select version, action from record_versions order by version;
\echo == T14 views
select display_name, records_created, saves, records_touched from ra_activity order by display_name;
select sailor_id, sailor_name, version, created_by_name, updated_by_name, n_editors from records_overview;
select section, "group", "row", field, value from record_fields order by 1,2,3,4;
reset role;

\echo == T15 anon (not signed in) sees nothing, can only ping
set role anon;
select count(*) from records;
select save_record('rzzzz1', '{}', 0);
select keepalive_ping() is not null as ping_ok;
select * from keepalive;
reset role;
\echo == T16 stranger who signed up somehow is inactive and blocked
set role authenticated; set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ff';
select count(*) as records_seen from records;
select count(*) as history_seen from record_versions;
