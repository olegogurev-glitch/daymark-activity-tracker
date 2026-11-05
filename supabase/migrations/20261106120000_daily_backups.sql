-- One automatic copy of each user's data per day, kept for 30 days. It protects against a
-- bad sync or a mistake, but not against losing the whole project: downloaded backups do that.
-- Only the project owner can read these, through the SQL Editor.
create table if not exists public.tracker_backups (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.tracker_backups enable row level security;
revoke all on public.tracker_backups from public, anon, authenticated;

create or replace function public.tracker_daily_backup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (now() at time zone 'utc')::date;
begin
  insert into public.tracker_backups (user_id, day, data)
  values (new.user_id, today, new.data)
  on conflict (user_id, day) do update set data = excluded.data, created_at = now();
  delete from public.tracker_backups where user_id = new.user_id and day < today - 30;
  return null;
exception when others then
  -- A failed copy must never stop someone's sync.
  return null;
end;
$$;

revoke all on function public.tracker_daily_backup() from public, anon, authenticated;

drop trigger if exists tracker_daily_backup on public.tracker_data;
create trigger tracker_daily_backup
  after insert or update on public.tracker_data
  for each row execute function public.tracker_daily_backup();
