-- =====================================================================
-- Sailor Pension Entry — core schema
--   profiles         one row per login (RA or admin), created automatically
--   records          one row per pension file; the full form is stored as JSON in `data`
--   record_versions  a snapshot of every save: who, when, what (never edited, never deleted by users)
-- Who-did-what is stamped by the database from the login, so it can't be typed or faked.
-- =====================================================================

-- ---------- profiles ----------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text not null default '',
  role         text not null default 'ra' check (role in ('ra', 'admin')),
  active       boolean not null default false,   -- an admin switches this on before the person can see or save anything
  created_at   timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- Make a profile whenever a login is created (Supabase dashboard > Authentication > Add user).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, coalesce(new.email, ''),
          coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(new.email, ''), '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active);
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and role = 'admin');
$$;

-- Admins can't lock themselves out by accident.
create or replace function public.profiles_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.id = auth.uid() and (new.role <> old.role or new.active <> old.active) then
    raise exception 'You can''t change your own role or switch off your own account. Ask another admin.';
  end if;
  new.id := old.id; new.email := old.email; new.created_at := old.created_at;
  return new;
end $$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public.profiles_guard();

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (public.is_active_user() or id = auth.uid());
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Anyone signed in may change their own display name (and nothing else).
create or replace function public.set_my_display_name(p_name text)
returns void language sql security definer set search_path = public as $$
  update public.profiles set display_name = left(trim(p_name), 60) where id = auth.uid();
$$;

-- ---------- records ----------
create table if not exists public.records (
  uid         text primary key check (uid ~ '^r[a-z0-9]{4,40}$'),
  sailor_id   text,                 -- copied out of `data` by the trigger, for listing and joins
  sailor_name text,
  status      text,
  data        jsonb not null,
  version     int not null default 1,
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,          -- soft delete (admins only); the history stays
  deleted_by  uuid references public.profiles (id)
);
create index if not exists records_sailor_id_idx on public.records (sailor_id);
create index if not exists records_updated_at_idx on public.records (updated_at desc);
alter table public.records enable row level security;

-- Stamp who/when, bump the version, keep the summary columns in step with the JSON.
create or replace function public.records_stamp()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.version    := 1;
    new.deleted_at := null; new.deleted_by := null;
  else
    if new.uid <> old.uid then raise exception 'A record''s id can''t change.'; end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if new.deleted_at is distinct from old.deleted_at then
      if not public.is_admin() then raise exception 'Only an admin can delete or restore a record.'; end if;
      new.deleted_by := case when new.deleted_at is null then null else auth.uid() end;
    else
      new.deleted_by := old.deleted_by;
    end if;
    if new.data is not distinct from old.data and new.deleted_at is not distinct from old.deleted_at then
      -- nothing changed: keep the old stamps and version, so no empty history entry is written
      new.version := old.version; new.updated_by := old.updated_by; new.updated_at := old.updated_at;
      return new;
    end if;
    new.version := old.version + 1;
  end if;
  new.updated_by  := auth.uid();
  new.updated_at  := now();
  new.sailor_id   := nullif(trim(new.data #>> '{meta,file,sailor_id}'), '');
  new.sailor_name := nullif(trim(new.data #>> '{personal,names,0,name}'), '');
  new.status      := nullif(trim(new.data #>> '{meta,file,status}'), '');
  return new;
end $$;
drop trigger if exists records_stamp on public.records;
create trigger records_stamp before insert or update on public.records
  for each row execute function public.records_stamp();

drop policy if exists records_read on public.records;
create policy records_read on public.records for select to authenticated using (public.is_active_user());
drop policy if exists records_insert on public.records;
create policy records_insert on public.records for insert to authenticated with check (public.is_active_user());
drop policy if exists records_update on public.records;
create policy records_update on public.records for update to authenticated
  using (public.is_active_user()) with check (public.is_active_user());
-- No delete policy: rows are never hard-deleted from the app. Admins soft-delete instead.

-- ---------- history ----------
create table if not exists public.record_versions (
  id         bigint generated always as identity primary key,
  record_uid text not null references public.records (uid) on delete cascade,
  version    int not null,
  action     text not null check (action in ('create', 'edit', 'delete', 'restore')),
  data       jsonb not null,
  edited_by  uuid references public.profiles (id),
  edited_at  timestamptz not null default now(),
  unique (record_uid, version)
);
create index if not exists record_versions_editor_idx on public.record_versions (edited_by, edited_at);
alter table public.record_versions enable row level security;

create or replace function public.records_log_version()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_action text;
begin
  if tg_op = 'INSERT' then
    v_action := 'create';
  elsif new.version = old.version then
    return null;                                   -- no change, nothing to log
  elsif new.deleted_at is distinct from old.deleted_at then
    v_action := case when new.deleted_at is null then 'restore' else 'delete' end;
  else
    v_action := 'edit';
  end if;
  insert into public.record_versions (record_uid, version, action, data, edited_by, edited_at)
  values (new.uid, new.version, v_action, new.data, new.updated_by, new.updated_at);
  return null;
end $$;
drop trigger if exists records_log_version on public.records;
create trigger records_log_version after insert or update on public.records
  for each row execute function public.records_log_version();

drop policy if exists versions_read on public.record_versions;
create policy versions_read on public.record_versions for select to authenticated using (public.is_active_user());
-- No insert/update/delete policies: only the trigger writes here.

-- ---------- saving, with a check that nobody else saved in the meantime ----------
-- p_base_version = the version the RA opened (0 for a brand-new record).
-- Returns {ok, version, updated_at} or {ok:false, conflict:true, version, updated_by, updated_at}.
create or replace function public.save_record(p_uid text, p_data jsonb, p_base_version int)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare cur public.records%rowtype; v_ver int; v_at timestamptz; v_by text;
begin
  if not public.is_active_user() then
    raise exception 'Your account isn''t active yet. Ask an admin to switch it on.' using errcode = '42501';
  end if;
  select * into cur from public.records where uid = p_uid for update;
  if not found then
    insert into public.records (uid, data) values (p_uid, p_data) returning version, updated_at into v_ver, v_at;
    return jsonb_build_object('ok', true, 'version', v_ver, 'updated_at', v_at, 'created', true);
  end if;
  if cur.deleted_at is not null then
    raise exception 'An admin deleted this record. Ask them to restore it.';
  end if;
  if cur.version <> coalesce(p_base_version, 0) then
    select display_name into v_by from public.profiles where id = cur.updated_by;
    return jsonb_build_object('ok', false, 'conflict', true, 'version', cur.version,
                              'updated_by', v_by, 'updated_at', cur.updated_at);
  end if;
  update public.records set data = p_data where uid = p_uid returning version, updated_at into v_ver, v_at;
  return jsonb_build_object('ok', true, 'version', v_ver, 'updated_at', v_at);
end $$;

create or replace function public.set_record_deleted(p_uid text, p_deleted boolean)
returns void language sql security invoker set search_path = public as $$
  update public.records set deleted_at = case when p_deleted then now() else null end where uid = p_uid;
$$;

-- ---------- field-level changes between versions ----------
create or replace function public.jsonb_flatten(j jsonb, prefix text[] default '{}')
returns table (path text[], value text) language plpgsql immutable as $$
declare k text; v jsonb; i int;
begin
  if jsonb_typeof(j) = 'object' then
    for k, v in select * from jsonb_each(j) loop
      return query select * from public.jsonb_flatten(v, prefix || k);
    end loop;
  elsif jsonb_typeof(j) = 'array' then
    for i in 0 .. jsonb_array_length(j) - 1 loop
      return query select * from public.jsonb_flatten(j -> i, prefix || i::text);
    end loop;
  elsif j is not null and jsonb_typeof(j) <> 'null' and coalesce(j #>> '{}', '') <> '' then
    path := prefix; value := j #>> '{}'; return next;
  end if;
end $$;

-- Every field that changed in every save of one record. Ignores bookkeeping keys (starting with "_")
-- and the automatic minutes counter.
create or replace function public.record_changes(p_uid text)
returns table (version int, action text, edited_at timestamptz, edited_by text,
               path text, old_value text, new_value text)
language sql stable security invoker set search_path = public as $$
  with v as (
    select rv.version, rv.action, rv.edited_at, rv.edited_by, rv.data,
           lag(rv.data) over (order by rv.version) as prev
    from public.record_versions rv where rv.record_uid = p_uid
  )
  select v.version, v.action, v.edited_at, coalesce(p.display_name, '?'),
         d.path, d.old_value, d.new_value
  from v
  left join public.profiles p on p.id = v.edited_by
  cross join lateral (
    select array_to_string(coalesce(n.path, o.path), '.') as path, o.value as old_value, n.value as new_value
    from public.jsonb_flatten(v.data) n
    full outer join public.jsonb_flatten(coalesce(v.prev, '{}'::jsonb)) o on n.path = o.path
    where n.value is distinct from o.value
      and left((coalesce(n.path, o.path))[1], 1) <> '_'
      and array_to_string(coalesce(n.path, o.path), '.') <> 'meta.file.minutes'
  ) d
  order by v.version, d.path;
$$;

-- ---------- permissions on functions ----------
revoke execute on function public.save_record(text, jsonb, int), public.set_record_deleted(text, boolean),
  public.record_changes(text), public.set_my_display_name(text) from public, anon;
grant execute on function public.save_record(text, jsonb, int), public.set_record_deleted(text, boolean),
  public.record_changes(text), public.set_my_display_name(text) to authenticated;
