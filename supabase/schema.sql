-- Plan Together storage: one key/value table, used only from the server with the service-role key.
-- Run this once in the Supabase SQL editor.
create table if not exists public.kv (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- Lock the table down: no access through the public (anon) API.
alter table public.kv enable row level security;
