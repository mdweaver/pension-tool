-- Extra options for the form's lists (Sex, Complexion, State, ...), promoted by an admin from the values RAs typed.
-- Everyone who is switched on can read them (the form adds them to its drop-downs); only admins add or remove them.
-- Removing an option never changes saved records: a value that is no longer listed simply counts as typed text.
create table if not exists public.list_options (
  list       text not null check (list ~ '^[A-Z]{2,20}$' and list <> 'QC'),   -- name of the list in js/schema.js (CODES); never the quality codes
  value      text not null check (value = btrim(value) and char_length(value) between 1 and 200),
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  primary key (list, value)
);
create unique index if not exists list_options_ci_idx on public.list_options (list, lower(value));
alter table public.list_options enable row level security;

-- who and when come from the login, never from the browser
create or replace function public.list_options_stamp()
returns trigger language plpgsql set search_path = public as $$
begin
  new.created_by := auth.uid();
  new.created_at := now();
  return new;
end $$;
drop trigger if exists list_options_stamp on public.list_options;
create trigger list_options_stamp before insert on public.list_options
  for each row execute function public.list_options_stamp();

drop policy if exists list_options_read on public.list_options;
create policy list_options_read on public.list_options for select to authenticated using (public.is_active_user());
drop policy if exists list_options_insert on public.list_options;
create policy list_options_insert on public.list_options for insert to authenticated with check (public.is_admin());
drop policy if exists list_options_delete on public.list_options;
create policy list_options_delete on public.list_options for delete to authenticated using (public.is_admin());
-- no update policy: change an option by removing it and adding the new one

grant select, insert, delete on public.list_options to authenticated;
revoke all on public.list_options from anon;
