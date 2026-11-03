-- Daymark personal tracker sync table
-- Run in Supabase Dashboard → SQL Editor for your project.
create table if not exists public.tracker_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.tracker_data enable row level security;
revoke all on public.tracker_data from anon;
grant select, insert, update, delete on public.tracker_data to authenticated;

drop policy if exists "Users can read their own tracker data" on public.tracker_data;
create policy "Users can read their own tracker data"
  on public.tracker_data for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own tracker data" on public.tracker_data;
create policy "Users can create their own tracker data"
  on public.tracker_data for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own tracker data" on public.tracker_data;
create policy "Users can update their own tracker data"
  on public.tracker_data for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can delete their own tracker data" on public.tracker_data;
create policy "Users can delete their own tracker data"
  on public.tracker_data for delete to authenticated
  using ((select auth.uid()) = user_id);
