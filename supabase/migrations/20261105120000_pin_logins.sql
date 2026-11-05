-- Login + PIN sign-in. Only the pin-auth server function can touch this table:
-- row level security is on with no policies, and the app's public roles have no access.
create table if not exists public.pin_logins (
  login text primary key,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  pin_hash text not null,
  failed_attempts integer not null default 0,
  lock_count integer not null default 0,
  locked_until timestamptz,
  -- Set by hand to let someone who forgot their PIN choose a new one (see README).
  reset_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pin_logins enable row level security;
revoke all on public.pin_logins from public, anon, authenticated;
grant select, insert, update, delete on public.pin_logins to service_role;

-- Counts the attempt BEFORE the PIN is checked, in one locked step, so parallel guesses
-- can't slip past the limit. The fifth try in a row starts a lock of 15 minutes, doubling
-- each time up to 24 hours. Returns no row for an unknown login.
create or replace function public.pin_begin_attempt(p_login text)
returns table (user_id uuid, pin_hash text, locked_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec public.pin_logins%rowtype;
begin
  select * into rec from public.pin_logins l where l.login = p_login for update;
  if not found then
    return;
  end if;

  if rec.locked_until is not null and rec.locked_until > now() then
    return query select rec.user_id, null::text, ceil(extract(epoch from rec.locked_until - now()))::integer;
    return;
  end if;

  if rec.failed_attempts + 1 >= 5 then
    update public.pin_logins l
       set failed_attempts = 0,
           lock_count = rec.lock_count + 1,
           locked_until = now() + least(interval '15 minutes' * power(2, least(rec.lock_count, 10)), interval '24 hours'),
           updated_at = now()
     where l.login = p_login;
  else
    update public.pin_logins l
       set failed_attempts = rec.failed_attempts + 1,
           updated_at = now()
     where l.login = p_login;
  end if;

  return query select rec.user_id, rec.pin_hash, 0;
end;
$$;

create or replace function public.pin_attempt_succeeded(p_login text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.pin_logins l
     set failed_attempts = 0, lock_count = 0, locked_until = null, updated_at = now()
   where l.login = p_login;
$$;

-- Functions are callable by everyone unless this is revoked.
revoke all on function public.pin_begin_attempt(text) from public, anon, authenticated;
revoke all on function public.pin_attempt_succeeded(text) from public, anon, authenticated;
grant execute on function public.pin_begin_attempt(text) to service_role;
grant execute on function public.pin_attempt_succeeded(text) to service_role;
