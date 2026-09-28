-- ============================================================================
-- Seller events: "I'm at an event" (2026-09-29). Money-adjacent (fee rate).
-- ============================================================================
-- Decided (AQUASHELLA_FEEDBACK.md §8): an event sale is a manual toggle based on
-- location. The seller turns on "At an event" (name, place, end time). While it
-- is on, ALL of their card sales get the reduced event fee (2%), and the booth
-- shows a live split of what sold in person vs online during the event.
--
-- No GPS enforcement, deliberately: the only thing a false "at an event" can do
-- is lower OUR cut of the seller's own sale. It can't move buyer or seller money.
-- Bounded by a max length (enforced here and in the API) so it can't be left on.
--
-- Server-only: every read/write goes through api/ with the service role, and the
-- seller is always the verified session wallet.
-- ============================================================================

begin;

create table if not exists public.seller_events (
  id            uuid primary key default gen_random_uuid(),
  seller_wallet text not null check (seller_wallet = lower(seller_wallet)),
  name          text not null check (char_length(btrim(name)) between 1 and 80),
  location      text check (location is null or char_length(location) <= 120),
  started_at    timestamptz not null default now(),
  ends_at       timestamptz not null,
  ended_at      timestamptz,
  created_at    timestamptz not null default now(),
  check (ends_at > started_at),
  check (ends_at <= started_at + interval '4 days'),
  check (ended_at is null or ended_at >= started_at)
);

-- At most one open event per seller. Starting a new one closes the old one first.
create unique index if not exists uq_seller_events_open
  on public.seller_events (seller_wallet) where ended_at is null;

create index if not exists idx_seller_events_seller_started
  on public.seller_events (seller_wallet, started_at desc);

alter table public.seller_events enable row level security;

drop policy if exists "seller_events service role" on public.seller_events;
create policy "seller_events service role"
  on public.seller_events for all using (auth.role() = 'service_role');

revoke all on public.seller_events from anon, authenticated;

do $$
begin
  if has_table_privilege('anon', 'public.seller_events', 'select')
     or has_table_privilege('authenticated', 'public.seller_events', 'select') then
    raise exception 'browser roles can read seller_events';
  end if;
end;
$$;

commit;
