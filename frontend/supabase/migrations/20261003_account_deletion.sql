-- ============================================================================
-- Account deletion: real columns, owner-only request/cancel, status read
-- ============================================================================
-- Settings -> Your Data -> Delete wrote profiles.deletion_requested_at, which
-- did not exist, so every request failed and nothing was ever purged.
--
-- This migration adds:
--   * profiles.deletion_requested_at  when the owner asked for deletion. The
--     purge job (/api/retention?action=purge-deletions, daily cron) acts on rows
--     where this is older than 30 days, then clears it.
--   * profiles.account_deleted_at     when the purge job last closed the account
--     (the profile row is kept as an anonymized marker because orders, payments
--     and auction settlements reference profiles.wallet_address; deleting it
--     would cascade-delete auction_settlements and is blocked by other FKs).
--   * request_account_deletion() / cancel_account_deletion() /
--     my_account_deletion_status(): SECURITY DEFINER, identity taken from the
--     signed JWT claim `wallet_address` (minted by /api/mint-session), never from
--     an argument. Granted to `authenticated` only.
--   * A guard trigger so browser roles cannot write either column directly (for
--     example back-dating the request to skip the 30-day grace). The RPCs run as
--     the function owner and the purge job runs as service_role, so both pass.
--
-- REVERSIBILITY:
--   drop trigger if exists profiles_guard_deletion_columns on public.profiles;
--   drop function if exists public.profiles_guard_deletion_columns();
--   drop function if exists public.request_account_deletion();
--   drop function if exists public.cancel_account_deletion();
--   drop function if exists public.my_account_deletion_status();
--   (the two columns can stay; they are nullable and unused without the job)
-- ============================================================================

begin;

alter table public.profiles
  add column if not exists deletion_requested_at timestamptz,
  add column if not exists account_deleted_at   timestamptz;

comment on column public.profiles.deletion_requested_at is
  'Owner requested account deletion at this time. Purged by /api/retention?action=purge-deletions 30 days later, which then clears it. Set/cleared only via request_account_deletion() / cancel_account_deletion().';
comment on column public.profiles.account_deleted_at is
  'Set by the purge job when the account was closed and its personal data removed. The row is kept as an anonymized marker for retained order/payment records.';

create index if not exists profiles_deletion_requested_at_idx
  on public.profiles (deletion_requested_at)
  where deletion_requested_at is not null;

-- Caller identity: public.current_wallet() (existing; lower(auth.jwt() ->>
-- 'wallet_address')), the same helper the orders/offers owner policies use.

-- ── Guard: browser roles may not write the deletion columns directly ────────
create or replace function public.profiles_guard_deletion_columns()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      if new.deletion_requested_at is not null or new.account_deleted_at is not null then
        raise exception 'deletion fields are set by the account deletion functions only'
          using errcode = 'insufficient_privilege';
      end if;
    elsif new.deletion_requested_at is distinct from old.deletion_requested_at
       or new.account_deleted_at is distinct from old.account_deleted_at then
      raise exception 'use request_account_deletion() or cancel_account_deletion()'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_deletion_columns on public.profiles;
create trigger profiles_guard_deletion_columns
  before insert or update on public.profiles
  for each row execute function public.profiles_guard_deletion_columns();

-- ── Owner RPCs ──────────────────────────────────────────────────────────────
-- Profiles exist in mixed wallet casing (legacy checksummed rows), so match on
-- lower(); the JWT claim is already lowercase.
create or replace function public.request_account_deletion()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wallet text := public.current_wallet();
  v_requested timestamptz;
begin
  if v_wallet is null then
    raise exception 'sign in to manage your account' using errcode = 'insufficient_privilege';
  end if;

  -- Keep the original request time if one is already pending, so repeating the
  -- request cannot push the purge date back or forward. The CTE tolerates a
  -- wallet stored twice in different casing (none today) instead of erroring.
  with u as (
    update public.profiles
       set deletion_requested_at = coalesce(deletion_requested_at, now()),
           updated_at = now()
     where lower(wallet_address) = v_wallet
    returning deletion_requested_at
  )
  select min(deletion_requested_at) into v_requested from u;

  if v_requested is null then
    raise exception 'no profile found for this account' using errcode = 'no_data_found';
  end if;

  return jsonb_build_object(
    'pending', true,
    'requested_at', v_requested,
    'purge_after', v_requested + interval '30 days'
  );
end;
$$;

create or replace function public.cancel_account_deletion()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wallet text := public.current_wallet();
  v_found boolean;
begin
  if v_wallet is null then
    raise exception 'sign in to manage your account' using errcode = 'insufficient_privilege';
  end if;

  with u as (
    update public.profiles
       set deletion_requested_at = null,
           updated_at = now()
     where lower(wallet_address) = v_wallet
    returning 1
  )
  select count(*) > 0 into v_found from u;

  if not v_found then
    raise exception 'no profile found for this account' using errcode = 'no_data_found';
  end if;

  return jsonb_build_object('pending', false);
end;
$$;

create or replace function public.my_account_deletion_status()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select jsonb_build_object(
              'pending', p.deletion_requested_at is not null,
              'requested_at', p.deletion_requested_at,
              'purge_after', p.deletion_requested_at + interval '30 days',
              'account_deleted_at', p.account_deleted_at)
       from public.profiles p
      where lower(p.wallet_address) = public.current_wallet()
      order by p.deletion_requested_at desc nulls last
      limit 1),
    jsonb_build_object('pending', false)
  );
$$;

revoke all on function public.request_account_deletion()   from public, anon, authenticated;
revoke all on function public.cancel_account_deletion()    from public, anon, authenticated;
revoke all on function public.my_account_deletion_status() from public, anon, authenticated;
grant execute on function public.request_account_deletion()   to authenticated, service_role;
grant execute on function public.cancel_account_deletion()    to authenticated, service_role;
grant execute on function public.my_account_deletion_status() to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.request_account_deletion()', 'execute') then
    raise exception 'anon can execute request_account_deletion';
  end if;
  if not has_function_privilege('authenticated', 'public.request_account_deletion()', 'execute') then
    raise exception 'authenticated cannot execute request_account_deletion';
  end if;
end;
$$;

commit;
