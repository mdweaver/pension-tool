-- Keep-alive for the Supabase free tier (projects pause after ~7 days without activity).
-- The scheduled GitHub Action calls keepalive_ping(), which writes one timestamp row,
-- so each ping is real database activity, not just a hit on the API gateway.
create table if not exists public.keepalive (
  id        int primary key default 1 check (id = 1),
  pinged_at timestamptz not null default now(),
  ping_count bigint not null default 0
);
alter table public.keepalive enable row level security;   -- no policies: nobody can read/write it directly

create or replace function public.keepalive_ping()
returns timestamptz
language sql
security definer
set search_path = public
as $$
  insert into public.keepalive (id, pinged_at, ping_count) values (1, now(), 1)
  on conflict (id) do update set pinged_at = excluded.pinged_at, ping_count = keepalive.ping_count + 1
  returning pinged_at;
$$;

revoke all on function public.keepalive_ping() from public;
grant execute on function public.keepalive_ping() to anon;   -- the only thing the public key can do with it
