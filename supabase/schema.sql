-- Run this entire file in Supabase Dashboard > SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.activation_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  code_hint text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  used_by uuid
);

create table if not exists public.room_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 28),
  joined_at timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

create table if not exists public.messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

alter table public.activation_codes enable row level security;
alter table public.room_members enable row level security;
alter table public.messages enable row level security;

-- No direct browser access to activation codes. Edge Functions use service role.
revoke all on public.activation_codes from anon, authenticated;
-- Member list/count is private: only the owner can read it, via the admin-codes Edge Function.
revoke all on public.room_members from anon, authenticated;
grant select, insert on public.messages to authenticated;

create or replace function public.is_room_member()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.room_members where user_id = auth.uid());
$$;
revoke all on function public.is_room_member() from public;
grant execute on function public.is_room_member() to authenticated;

drop policy if exists "Members can see members" on public.room_members;

drop policy if exists "Members can read messages" on public.messages;
create policy "Members can read messages" on public.messages
for select to authenticated using (public.is_room_member());

drop policy if exists "Members can send messages" on public.messages;
create policy "Members can send messages" on public.messages
for insert to authenticated with check (
  user_id = auth.uid() and public.is_room_member()
);

-- Enable realtime updates for the chat tables.
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
when undefined_object then null;
end $$;
