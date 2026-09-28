-- ============================================================================
-- Public auctions v2 — phase 1: data model, bid rules, close (2026-09-29)
-- Spec: docs/AUCTIONS_SPEC.md. Money + inventory + ownership adjacent.
-- ============================================================================
-- Standalone lots with their own end time, replacing lots-as-JSON inside event
-- "Tides". A seller's lot gets an auction of its own; a club auction (phase 4)
-- holds many consigned lots.
--
-- Every write goes through a SECURITY DEFINER function that is service_role
-- only. api/ calls them with the verified session wallet. Browsers read through
-- the two *_public views, which never expose reserves or bidder wallets.
--
-- Stock: a batch_listing lot moves N fish out of the listing into the lot
-- (ledger rail 'auction', same advisory lock as booth sales), and puts them back
-- (rail 'restock') if the lot is unsold, forfeited, cancelled or refunded.
-- ============================================================================

begin;

-- ── 0. Ledger rail for stock committed to an auction ───────────────────────
alter table public.inventory_sale_events drop constraint if exists inventory_sale_events_rail_check;
alter table public.inventory_sale_events
  add constraint inventory_sale_events_rail_check
  check (rail in ('cash', 'card', 'adjustment', 'restock', 'auction'));

-- ── 1. Tables ──────────────────────────────────────────────────────────────
create table if not exists public.auctions (
  id                          uuid primary key default gen_random_uuid(),
  host_type                   text not null check (host_type in ('seller', 'club')),
  host_wallet                 text not null check (host_wallet = lower(host_wallet)),
  school_id                   uuid references public.schools(id) on delete restrict,
  title                       text not null check (char_length(btrim(title)) between 1 and 120),
  description                 text check (description is null or char_length(description) <= 4000),
  format                      text not null default 'timed' check (format in ('timed', 'live')),
  status                      text not null default 'live' check (status in ('draft', 'live', 'ended', 'cancelled')),
  starts_at                   timestamptz not null default now(),
  ends_at                     timestamptz not null,
  pickup_location             text check (pickup_location is null or char_length(pickup_location) <= 200),
  pickup_notes                text check (pickup_notes is null or char_length(pickup_notes) <= 1000),
  default_club_split_percent  integer not null default 0 check (default_club_split_percent between 0 and 100),
  members_only_bidding        boolean not null default false,
  members_only_listing        boolean not null default false,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  check ((host_type = 'club') = (school_id is not null)),
  check (ends_at > starts_at)
);

create table if not exists public.auction_lots (
  id                  uuid primary key default gen_random_uuid(),
  auction_id          uuid not null references public.auctions(id) on delete cascade,
  seller_wallet       text not null check (seller_wallet = lower(seller_wallet)),
  status              text not null default 'live' check (status in (
                        'pending_approval', 'live', 'ended', 'charging', 'payment_failed',
                        'paid', 'handed_off', 'unsold', 'forfeited', 'refunded', 'cancelled')),
  title               text not null check (char_length(btrim(title)) between 1 and 120),
  description         text check (description is null or char_length(description) <= 4000),
  photos              jsonb not null default '[]'::jsonb check (jsonb_typeof(photos) = 'array' and jsonb_array_length(photos) <= 8),
  source              text not null check (source in ('freeform', 'batch_listing')),
  listing_id          text,
  quantity            integer not null default 1 check (quantity between 1 and 1000),
  stock_moved         boolean not null default false,
  starting_bid_cents  integer not null check (starting_bid_cents between 100 and 10000000),
  reserve_cents       integer check (reserve_cents is null or reserve_cents between 100 and 10000000),
  club_split_percent  integer not null default 0 check (club_split_percent between 0 and 100),
  starts_at           timestamptz not null default now(),
  ends_at             timestamptz not null,
  original_ends_at    timestamptz not null,
  high_bid_cents      integer,
  high_bidder_wallet  text,
  bid_count           integer not null default 0,
  winner_wallet       text,
  hammer_cents        integer,
  fee_percent         numeric(5,2),
  payment_deadline    timestamptz,
  payment_intent      text unique,
  charge_attempts     integer not null default 0,
  last_charge_error   text,
  order_id            uuid,
  approved_at         timestamptz,
  closed_at           timestamptz,
  paid_at             timestamptz,
  handed_off_at       timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check ((source = 'batch_listing') = (listing_id is not null)),
  check (source = 'batch_listing' or not stock_moved),
  check (ends_at > starts_at),
  check (ends_at >= original_ends_at and ends_at <= original_ends_at + interval '60 minutes'),
  check (winner_wallet is null or winner_wallet <> seller_wallet),
  check ((winner_wallet is null) = (hammer_cents is null))
);

create index if not exists idx_auction_lots_status_ends on public.auction_lots (status, ends_at);
create index if not exists idx_auction_lots_auction     on public.auction_lots (auction_id);
create index if not exists idx_auction_lots_seller      on public.auction_lots (seller_wallet, created_at desc);
create index if not exists idx_auction_lots_winner      on public.auction_lots (winner_wallet) where winner_wallet is not null;

create table if not exists public.auction_lot_bids (
  id            uuid primary key default gen_random_uuid(),
  lot_id        uuid not null references public.auction_lots(id) on delete cascade,
  bidder_wallet text not null check (bidder_wallet = lower(bidder_wallet)),
  amount_cents  integer not null check (amount_cents between 100 and 10000000),
  created_at    timestamptz not null default now()
);
create index if not exists idx_auction_lot_bids_lot on public.auction_lot_bids (lot_id, amount_cents desc, created_at);
create index if not exists idx_auction_lot_bids_bidder on public.auction_lot_bids (bidder_wallet, created_at desc);

create or replace function public.auctions_touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end; $$;

drop trigger if exists trg_auctions_touch on public.auctions;
create trigger trg_auctions_touch before update on public.auctions
  for each row execute function public.auctions_touch_updated_at();
drop trigger if exists trg_auction_lots_touch on public.auction_lots;
create trigger trg_auction_lots_touch before update on public.auction_lots
  for each row execute function public.auctions_touch_updated_at();

-- ── 2. Pure helper: the minimum next bid ───────────────────────────────────
-- No bids: the starting bid. Otherwise standing + max($1, 5% rounded up).
create or replace function public.auction_min_next_bid(p_high integer, p_start integer)
returns integer language sql immutable as $$
  select case when p_high is null then p_start
              else p_high + greatest(100, ceil(p_high * 0.05)::integer) end;
$$;

-- ── 3. Stock moves (internal: no grants to anyone but the owner) ───────────
create or replace function public.auction_lot_take_stock(p_lot uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  l public.auction_lots;
  v_seller text; v_remaining integer; v_new integer;
begin
  select * into l from public.auction_lots where id = p_lot for update;
  if l.source <> 'batch_listing' or l.stock_moved then return null; end if;

  perform pg_advisory_xact_lock(hashtextextended(l.listing_id, 0));
  select seller_address, quantity_remaining into v_seller, v_remaining
    from public.aquadex_listings where id = l.listing_id for update;
  if not found then
    raise exception 'listing % not found', l.listing_id using errcode = 'no_data_found';
  end if;
  if lower(v_seller) <> l.seller_wallet then
    raise exception 'listing % does not belong to %', l.listing_id, l.seller_wallet using errcode = 'insufficient_privilege';
  end if;
  if coalesce(v_remaining, 0) < l.quantity then
    raise exception 'oversell: % remaining, % requested for listing %', coalesce(v_remaining, 0), l.quantity, l.listing_id
      using errcode = 'check_violation';
  end if;

  v_new := v_remaining - l.quantity;
  update public.aquadex_listings
     set quantity_remaining = v_new,
         is_active = case when v_new = 0 then false else is_active end,
         updated_at = now()
   where id = l.listing_id;
  insert into public.inventory_sale_events (sale_id, listing_id, seller_address, quantity, quantity_after, rail, order_id)
  values ('auction:' || l.id, l.listing_id, l.seller_wallet, l.quantity, v_new, 'auction', null);
  update public.auction_lots set stock_moved = true where id = l.id;
  return v_new;
end;
$$;

create or replace function public.auction_lot_return_stock(p_lot uuid)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  l public.auction_lots;
  v_remaining integer; v_total integer; v_new integer;
begin
  select * into l from public.auction_lots where id = p_lot for update;
  if l.source <> 'batch_listing' or not l.stock_moved then return null; end if;

  perform pg_advisory_xact_lock(hashtextextended(l.listing_id, 0));
  select quantity_remaining, quantity_total into v_remaining, v_total
    from public.aquadex_listings where id = l.listing_id for update;
  if not found then
    update public.auction_lots set stock_moved = false where id = l.id;
    return null;  -- listing deleted: nothing to return to
  end if;

  v_new := coalesce(v_remaining, 0) + l.quantity;
  update public.aquadex_listings
     set quantity_remaining = v_new,
         quantity_total = greatest(coalesce(v_total, 0), v_new),
         is_active = true,
         updated_at = now()
   where id = l.listing_id;
  insert into public.inventory_sale_events (sale_id, listing_id, seller_address, quantity, quantity_after, rail, order_id)
  values ('restock:auction:' || l.id, l.listing_id, l.seller_wallet, l.quantity, v_new, 'restock', null)
  on conflict (sale_id) do nothing;
  update public.auction_lots set stock_moved = false where id = l.id;
  return v_new;
end;
$$;

-- ── 4. Create a seller's standalone lot (auction + lot + stock, atomically) ─
create or replace function public.create_auction_lot(
  p_seller           text,
  p_title            text,
  p_description      text,
  p_photos           jsonb,
  p_source           text,
  p_listing_id       text,
  p_quantity         integer,
  p_starting_bid     integer,
  p_reserve          integer,
  p_ends_at          timestamptz,
  p_pickup_location  text,
  p_pickup_notes     text
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_seller  text := lower(btrim(coalesce(p_seller, '')));
  v_auction uuid;
  v_lot     uuid;
begin
  if v_seller !~ '^0x[0-9a-f]{40}$' then
    raise exception 'seller is required' using errcode = 'invalid_parameter_value';
  end if;
  if p_ends_at is null or p_ends_at < now() + interval '1 hour' or p_ends_at > now() + interval '14 days' then
    raise exception 'end time must be between 1 hour and 14 days from now' using errcode = 'invalid_parameter_value';
  end if;
  if p_reserve is not null and p_reserve < p_starting_bid then
    raise exception 'reserve must be at least the starting bid' using errcode = 'invalid_parameter_value';
  end if;
  if p_source = 'batch_listing' and (p_listing_id is null or btrim(p_listing_id) = '') then
    raise exception 'listing is required for a batch lot' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.auctions (host_type, host_wallet, title, description, starts_at, ends_at, pickup_location, pickup_notes)
  values ('seller', v_seller, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), now(), p_ends_at,
          nullif(btrim(coalesce(p_pickup_location, '')), ''), nullif(btrim(coalesce(p_pickup_notes, '')), ''))
  returning id into v_auction;

  insert into public.auction_lots (auction_id, seller_wallet, title, description, photos, source, listing_id, quantity,
                                   starting_bid_cents, reserve_cents, starts_at, ends_at, original_ends_at)
  values (v_auction, v_seller, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), coalesce(p_photos, '[]'::jsonb),
          p_source, case when p_source = 'batch_listing' then btrim(p_listing_id) else null end,
          greatest(1, coalesce(p_quantity, 1)), p_starting_bid, p_reserve, now(), p_ends_at, p_ends_at)
  returning id into v_lot;

  perform public.auction_lot_take_stock(v_lot);
  return v_lot;
end;
$$;

-- ── 5. Place a bid (row-locked; every rule enforced here) ──────────────────
create or replace function public.place_lot_bid(p_lot uuid, p_bidder text, p_amount integer)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  l        public.auction_lots;
  a        public.auctions;
  v_bidder text := lower(btrim(coalesce(p_bidder, '')));
  v_min    integer;
  v_ends   timestamptz;
begin
  if v_bidder !~ '^0x[0-9a-f]{40}$' then
    raise exception 'bidder is required' using errcode = 'invalid_parameter_value';
  end if;

  select * into l from public.auction_lots where id = p_lot for update;
  if not found then raise exception 'lot not found' using errcode = 'no_data_found'; end if;
  select * into a from public.auctions where id = l.auction_id;

  if l.status <> 'live' or a.status <> 'live' then
    raise exception 'bid refused: this lot is not open for bidding' using errcode = 'check_violation';
  end if;
  if now() < l.starts_at then
    raise exception 'bid refused: bidding has not started yet' using errcode = 'check_violation';
  end if;
  if now() >= l.ends_at then
    raise exception 'bid refused: this lot has ended' using errcode = 'check_violation';
  end if;
  if v_bidder = l.seller_wallet then
    raise exception 'bid refused: you can''t bid on your own lot' using errcode = 'check_violation';
  end if;
  if a.members_only_bidding and not exists (
       select 1 from public.school_members m
        where m.school_id = a.school_id and lower(m.wallet_address) = v_bidder and m.role in ('founder', 'elder', 'member')
     ) and not exists (
       select 1 from public.schools s where s.id = a.school_id and lower(s.founder_wallet) = v_bidder
     ) then
    raise exception 'bid refused: this auction is for club members only' using errcode = 'check_violation';
  end if;
  if not exists (
       select 1 from public.buyer_payment_methods p
        where lower(p.wallet_address) = v_bidder and p.payment_method_id is not null
     ) then
    raise exception 'bid refused: add a card first — if you win, it''s charged automatically' using errcode = 'check_violation';
  end if;
  if l.high_bidder_wallet = v_bidder then
    raise exception 'bid refused: you already have the high bid' using errcode = 'check_violation';
  end if;

  v_min := public.auction_min_next_bid(l.high_bid_cents, l.starting_bid_cents);
  if p_amount is null or p_amount < v_min then
    raise exception 'bid refused: the minimum bid is % cents', v_min using errcode = 'check_violation';
  end if;
  if p_amount > 10000000 then
    raise exception 'bid refused: the maximum bid is $100,000' using errcode = 'check_violation';
  end if;

  insert into public.auction_lot_bids (lot_id, bidder_wallet, amount_cents) values (l.id, v_bidder, p_amount);

  -- Anti-sniping: a bid in the last 2 minutes pushes the end out to 2 minutes
  -- from now, capped at 60 minutes past the original end.
  v_ends := l.ends_at;
  if l.ends_at - now() < interval '2 minutes' then
    v_ends := least(now() + interval '2 minutes', l.original_ends_at + interval '60 minutes');
  end if;

  update public.auction_lots
     set high_bid_cents = p_amount,
         high_bidder_wallet = v_bidder,
         bid_count = bid_count + 1,
         ends_at = greatest(ends_at, v_ends)
   where id = l.id;

  return jsonb_build_object(
    'lotId', l.id,
    'highBidCents', p_amount,
    'bidCount', l.bid_count + 1,
    'endsAt', greatest(l.ends_at, v_ends),
    'minNextBidCents', public.auction_min_next_bid(p_amount, l.starting_bid_cents),
    'extended', v_ends > l.ends_at
  );
end;
$$;

-- ── 6. Seller cancels a lot with no bids ───────────────────────────────────
create or replace function public.cancel_auction_lot(p_lot uuid, p_seller text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.auction_lots;
begin
  select * into l from public.auction_lots where id = p_lot for update;
  if not found then raise exception 'lot not found' using errcode = 'no_data_found'; end if;
  if l.seller_wallet <> lower(coalesce(p_seller, '')) then
    raise exception 'lot % does not belong to %', p_lot, p_seller using errcode = 'insufficient_privilege';
  end if;
  if l.status not in ('live', 'pending_approval') then
    raise exception 'cancel refused: this lot has already closed' using errcode = 'check_violation';
  end if;
  if l.bid_count > 0 then
    raise exception 'cancel refused: this lot has bids' using errcode = 'check_violation';
  end if;
  update public.auction_lots set status = 'cancelled', closed_at = now() where id = l.id;
  perform public.auction_lot_return_stock(l.id);
  return jsonb_build_object('lotId', l.id, 'status', 'cancelled');
end;
$$;

-- ── 7. Close ended lots + forfeit unpaid ones (run by pg_cron every minute) ─
create or replace function public.close_ended_auction_lots(p_limit integer default 200)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  v_sold integer := 0; v_unsold integer := 0; v_forfeited integer := 0;
begin
  for r in
    select id, high_bid_cents, high_bidder_wallet, reserve_cents
      from public.auction_lots
     where status = 'live' and ends_at <= now()
     order by ends_at
     limit greatest(1, coalesce(p_limit, 200))
     for update skip locked
  loop
    if r.high_bid_cents is null or (r.reserve_cents is not null and r.high_bid_cents < r.reserve_cents) then
      update public.auction_lots set status = 'unsold', closed_at = now() where id = r.id;
      perform public.auction_lot_return_stock(r.id);
      v_unsold := v_unsold + 1;
    else
      update public.auction_lots
         set status = 'ended',
             winner_wallet = r.high_bidder_wallet,
             hammer_cents = r.high_bid_cents,
             closed_at = now(),
             payment_deadline = now() + interval '24 hours'
       where id = r.id;
      v_sold := v_sold + 1;
    end if;
  end loop;

  -- Winners who didn't pay within 24h: the lot goes back (no auto-charging the
  -- runner-up — see docs/AUCTIONS_SPEC.md §3).
  for r in
    select id from public.auction_lots
     where status in ('ended', 'payment_failed') and payment_deadline < now()
     limit greatest(1, coalesce(p_limit, 200))
     for update skip locked
  loop
    update public.auction_lots set status = 'forfeited' where id = r.id;
    perform public.auction_lot_return_stock(r.id);
    v_forfeited := v_forfeited + 1;
  end loop;

  -- An auction whose every lot has closed and whose own end has passed is over.
  update public.auctions a
     set status = 'ended'
   where a.status = 'live' and a.ends_at <= now()
     and not exists (select 1 from public.auction_lots l where l.auction_id = a.id and l.status in ('live', 'pending_approval'));

  return jsonb_build_object('sold', v_sold, 'unsold', v_unsold, 'forfeited', v_forfeited);
end;
$$;

-- ── 8. Public read models (no reserve amount, no bidder wallets) ───────────
create or replace view public.auction_lots_public as
select
  l.id,
  l.auction_id,
  a.host_type,
  a.school_id,
  s.name                                   as club_name,
  s.slug                                   as club_slug,
  a.title                                  as auction_title,
  l.seller_wallet,
  p.display_name                           as seller_name,
  l.title,
  l.description,
  l.photos,
  l.source,
  l.quantity,
  l.starting_bid_cents,
  (l.reserve_cents is not null)            as has_reserve,
  (l.reserve_cents is null or coalesce(l.high_bid_cents, 0) >= l.reserve_cents) as reserve_met,
  l.high_bid_cents,
  l.bid_count,
  public.auction_min_next_bid(l.high_bid_cents, l.starting_bid_cents) as min_next_bid_cents,
  l.starts_at,
  l.ends_at,
  a.pickup_location,
  a.pickup_notes,
  a.members_only_bidding,
  case
    when l.status = 'live' and now() < l.starts_at then 'upcoming'
    when l.status = 'live' and now() < l.ends_at   then 'live'
    when l.status in ('live', 'ended', 'charging', 'payment_failed') then 'closed'
    when l.status in ('paid', 'handed_off')        then 'sold'
    else 'unsold'
  end                                      as public_status,
  case when l.status in ('paid', 'handed_off') then l.hammer_cents end as sold_for_cents,
  l.closed_at,
  l.created_at
from public.auction_lots l
join public.auctions a on a.id = l.auction_id
left join public.schools s on s.id = a.school_id
left join public.profiles p on lower(p.wallet_address) = l.seller_wallet
where a.status <> 'draft'
  and l.status not in ('pending_approval', 'cancelled');

create or replace view public.auction_lot_bids_public as
select
  b.lot_id,
  b.amount_cents,
  b.created_at,
  dense_rank() over (partition by b.lot_id order by f.first_bid_at, b.bidder_wallet) as bidder_number
from public.auction_lot_bids b
join (
  select lot_id, bidder_wallet, min(created_at) as first_bid_at
    from public.auction_lot_bids group by lot_id, bidder_wallet
) f on f.lot_id = b.lot_id and f.bidder_wallet = b.bidder_wallet
join public.auction_lots l on l.id = b.lot_id
where l.status not in ('pending_approval', 'cancelled');

-- ── 9. Access: server-only writes, public reads via the views ──────────────
alter table public.auctions         enable row level security;
alter table public.auction_lots     enable row level security;
alter table public.auction_lot_bids enable row level security;

drop policy if exists "auctions service role"         on public.auctions;
drop policy if exists "auction_lots service role"     on public.auction_lots;
drop policy if exists "auction_lot_bids service role" on public.auction_lot_bids;
create policy "auctions service role"         on public.auctions         for all using (auth.role() = 'service_role');
create policy "auction_lots service role"     on public.auction_lots     for all using (auth.role() = 'service_role');
create policy "auction_lot_bids service role" on public.auction_lot_bids for all using (auth.role() = 'service_role');

revoke all on public.auctions, public.auction_lots, public.auction_lot_bids from anon, authenticated;
revoke all on public.auction_lots_public, public.auction_lot_bids_public from anon, authenticated;
grant select on public.auction_lots_public, public.auction_lot_bids_public to anon, authenticated;

revoke execute on function public.auction_lot_take_stock(uuid)   from public, anon, authenticated;
revoke execute on function public.auction_lot_return_stock(uuid) from public, anon, authenticated;
revoke execute on function public.create_auction_lot(text, text, text, jsonb, text, text, integer, integer, integer, timestamptz, text, text)
  from public, anon, authenticated;
revoke execute on function public.place_lot_bid(uuid, text, integer)   from public, anon, authenticated;
revoke execute on function public.cancel_auction_lot(uuid, text)       from public, anon, authenticated;
revoke execute on function public.close_ended_auction_lots(integer)    from public, anon, authenticated;

grant execute on function public.create_auction_lot(text, text, text, jsonb, text, text, integer, integer, integer, timestamptz, text, text)
  to service_role;
grant execute on function public.place_lot_bid(uuid, text, integer)    to service_role;
grant execute on function public.cancel_auction_lot(uuid, text)        to service_role;
grant execute on function public.close_ended_auction_lots(integer)     to service_role;

-- ── 10. Close job: every minute ────────────────────────────────────────────
do $$
begin
  if exists (select 1 from cron.job where jobname = 'auction-close-ended-lots') then
    perform cron.unschedule('auction-close-ended-lots');
  end if;
  perform cron.schedule('auction-close-ended-lots', '* * * * *', 'select public.close_ended_auction_lots();');
end;
$$;

-- ── Post-conditions ────────────────────────────────────────────────────────
do $$
declare v_bad text;
begin
  select string_agg(t || ':' || p, ', ') into v_bad
  from (values ('auctions'), ('auction_lots'), ('auction_lot_bids')) as tbl(t)
  cross join (values ('select'), ('insert'), ('update'), ('delete')) as priv(p)
  where has_table_privilege('anon', 'public.' || t, p) or has_table_privilege('authenticated', 'public.' || t, p);
  if v_bad is not null then raise exception 'browser roles have table privileges: %', v_bad; end if;

  if not has_table_privilege('anon', 'public.auction_lots_public', 'select') then
    raise exception 'anon cannot read auction_lots_public';
  end if;

  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('auction_lot_take_stock', 'auction_lot_return_stock', 'create_auction_lot',
                      'place_lot_bid', 'cancel_auction_lot', 'close_ended_auction_lots')
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  if v_bad is not null then raise exception 'browser roles can execute: %', v_bad; end if;
end;
$$;

commit;
