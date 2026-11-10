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


-- ===== v2: member email (owner-only), profile photos, safe avatar URLs =====
-- NOTE: the avatar URL check below contains this project's URL. Change it if you use another Supabase project.
alter table public.room_members add column if not exists email text;
alter table public.messages add column if not exists avatar_url text;
alter table public.messages drop constraint if exists messages_avatar_url_len;
alter table public.messages add constraint messages_avatar_url_len check (avatar_url is null or char_length(avatar_url) <= 500);

drop policy if exists "Members can send messages" on public.messages;
create policy "Members can send messages" on public.messages
for insert to authenticated with check (
  user_id = auth.uid() and public.is_room_member()
  and (avatar_url is null or avatar_url like ('https://qvbrmbtuqvoksciauswd.supabase.co/storage/v1/object/public/avatars/' || auth.uid()::text || '/%'))
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars member insert" on storage.objects;
create policy "avatars member insert" on storage.objects for insert to authenticated
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text and public.is_room_member());
drop policy if exists "avatars member update" on storage.objects;
create policy "avatars member update" on storage.objects for update to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text and public.is_room_member())
with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text and public.is_room_member());
drop policy if exists "avatars member select own" on storage.objects;
create policy "avatars member select own" on storage.objects for select to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "avatars member delete" on storage.objects;
create policy "avatars member delete" on storage.objects for delete to authenticated
using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

revoke execute on function public.is_room_member() from anon;
