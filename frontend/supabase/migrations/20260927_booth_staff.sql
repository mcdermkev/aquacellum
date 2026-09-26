-- ============================================================================
-- Booth staff: helpers who can ring up sales for a seller's booth.
-- Aquashella feedback §5.6. Tier A: this is an authorization boundary.
-- ============================================================================
-- What a helper CAN do (decided 2026-09-26): record cash sales against the
-- seller's stock, and start card sales (guest checkout, which anyone can do).
-- What stays seller-only: +/- stock adjust, confirming a card pickup (releases
-- money), publishing tanks, and managing helpers. Those endpoints keep checking
-- that the session wallet IS the seller, so this table grants nothing to them.
--
-- Joining is by QR: the seller shows a code, the helper scans it and signs in.
-- The code is a random 32-byte token; only its SHA-256 is stored, so a database
-- read cannot mint a working invite. Single use, 15-minute expiry.
--
-- Both tables are server-only (service role). No browser policies: every read
-- and write goes through api/storefront-detail.js, which checks the session.
-- ============================================================================

begin;

create table if not exists public.booth_staff_invites (
  token_hash      text primary key check (char_length(token_hash) = 64),
  seller_wallet   text not null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  used_at         timestamptz,
  used_by_wallet  text,
  revoked_at      timestamptz,
  constraint booth_staff_invites_expiry_after_create check (expires_at > created_at)
);

create index if not exists idx_booth_staff_invites_seller
  on public.booth_staff_invites (seller_wallet, created_at desc);

create table if not exists public.booth_staff (
  id              uuid primary key default gen_random_uuid(),
  seller_wallet   text not null,
  staff_wallet    text not null,
  added_at        timestamptz not null default now(),
  revoked_at      timestamptz,
  constraint booth_staff_not_self check (lower(seller_wallet) <> lower(staff_wallet))
);

-- At most one ACTIVE membership per (seller, helper). A removed helper can be
-- re-invited; that inserts a fresh row.
create unique index if not exists uq_booth_staff_active
  on public.booth_staff (lower(seller_wallet), lower(staff_wallet))
  where revoked_at is null;

create index if not exists idx_booth_staff_staff_active
  on public.booth_staff (lower(staff_wallet))
  where revoked_at is null;

alter table public.booth_staff_invites enable row level security;
alter table public.booth_staff enable row level security;

drop policy if exists "service_role full access on booth_staff_invites" on public.booth_staff_invites;
create policy "service_role full access on booth_staff_invites"
  on public.booth_staff_invites for all using (auth.role() = 'service_role');

drop policy if exists "service_role full access on booth_staff" on public.booth_staff;
create policy "service_role full access on booth_staff"
  on public.booth_staff for all using (auth.role() = 'service_role');

-- Belt and braces: Supabase grants table privileges to anon/authenticated by
-- default. RLS already blocks them; revoking makes it explicit.
revoke all on public.booth_staff_invites from anon, authenticated;
revoke all on public.booth_staff from anon, authenticated;

-- Redeem an invite atomically: exactly one helper can use a code, even if two
-- phones scan it in the same instant. Returns the seller wallet the helper now
-- works for, or raises:
--   no_data_found            unknown / expired / used / revoked code
--   invalid_parameter_value  the seller scanned their own code
create or replace function public.redeem_booth_staff_invite(
  p_token_hash   text,
  p_staff_wallet text
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_seller text;
  v_staff  text := lower(p_staff_wallet);
begin
  if p_token_hash is null or char_length(p_token_hash) <> 64 or v_staff is null or v_staff = '' then
    raise exception 'invalid invite' using errcode = 'invalid_parameter_value';
  end if;

  update public.booth_staff_invites
  set used_at = now(), used_by_wallet = v_staff
  where token_hash = p_token_hash
    and used_at is null
    and revoked_at is null
    and expires_at > now()
  returning lower(seller_wallet) into v_seller;

  if v_seller is null then
    raise exception 'invite not found or expired' using errcode = 'no_data_found';
  end if;

  if v_seller = v_staff then
    -- Raising rolls back the redemption above, so the seller's own mis-scan
    -- doesn't burn the code.
    raise exception 'cannot add yourself as a helper' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.booth_staff (seller_wallet, staff_wallet)
  select v_seller, v_staff
  where not exists (
    select 1 from public.booth_staff
    where lower(seller_wallet) = v_seller and lower(staff_wallet) = v_staff and revoked_at is null
  );

  return v_seller;
end;
$$;

revoke all on function public.redeem_booth_staff_invite(text, text) from public, anon, authenticated;
grant execute on function public.redeem_booth_staff_invite(text, text) to service_role;

commit;
