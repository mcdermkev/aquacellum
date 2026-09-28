-- ============================================================================
-- Club auction night: live room auctions (+ hybrid presale) — 2026-09-29.
-- Spec: docs/AUCTIONS_SPEC.md §9. Money + ownership adjacent.
-- ============================================================================
-- A club (a `schools` row, type 'club') runs an auction. Organizers (founder or
-- elder) enter lots, register bidder numbers, clerk each lot in the room
-- (sold to a number / sold to the online bidder / passed), and settle at the
-- checkout desk (cash, card on the buyer's phone, or a saved card).
--
-- Money model for club auctions (decided for launch): all card money goes to the
-- club's payout account (the auction host's Stripe account); the club pays its
-- consignors from the report. Card sales carry the club rate (3%: our 4% with the
-- club's 25% share taken off). Cash carries no fee.
--
-- Every function is SECURITY DEFINER and service_role only; api/ passes the
-- verified session wallet as p_actor and every function checks it's an organizer.
-- ============================================================================

begin;

-- ── 0. Schema changes ──────────────────────────────────────────────────────
alter table public.schools drop constraint if exists schools_school_type_check;
alter table public.schools add constraint schools_school_type_check
  check (school_type in ('species', 'regional', 'breeding', 'conservation', 'equipment', 'open', 'club'));

alter table public.auctions drop constraint if exists auctions_format_check;
alter table public.auctions add constraint auctions_format_check check (format in ('timed', 'live', 'hybrid'));
alter table public.auctions add column if not exists event_at        timestamptz;
alter table public.auctions add column if not exists online_ends_at  timestamptz;
alter table public.auctions add column if not exists current_lot_id  uuid;

alter table public.auction_lots drop constraint if exists auction_lots_status_check;
alter table public.auction_lots add constraint auction_lots_status_check check (status in (
  'pending_approval', 'live', 'awaiting_live', 'sold_live', 'ended', 'charging', 'payment_failed',
  'paid', 'handed_off', 'unsold', 'forfeited', 'refunded', 'cancelled'));
alter table public.auction_lots add column if not exists lot_number        integer;
alter table public.auction_lots add column if not exists consignor_name    text check (consignor_name is null or char_length(consignor_name) <= 80);
alter table public.auction_lots add column if not exists consignor_wallet  text check (consignor_wallet is null or consignor_wallet = lower(consignor_wallet));
alter table public.auction_lots add column if not exists sold_to_bidder_id uuid;
alter table public.auction_lots add column if not exists payment_method    text check (payment_method is null or payment_method in ('card', 'cash'));
alter table public.auction_lots add column if not exists desk_payment_id   uuid;
create unique index if not exists uq_auction_lots_number on public.auction_lots (auction_id, lot_number) where lot_number is not null;

-- A room sale to a walk-in has a price and a bidder number but no account, so
-- "winner and price together" becomes "a price always has a buyer".
alter table public.auction_lots drop constraint if exists auction_lots_check5;
alter table public.auction_lots drop constraint if exists auction_lots_buyer_coherent;
alter table public.auction_lots add constraint auction_lots_buyer_coherent check (
  (hammer_cents is null and winner_wallet is null and sold_to_bidder_id is null)
  or (hammer_cents is not null and (winner_wallet is not null or sold_to_bidder_id is not null))
);

create table if not exists public.auction_bidders (
  id             uuid primary key default gen_random_uuid(),
  auction_id     uuid not null references public.auctions(id) on delete cascade,
  bidder_number  integer not null check (bidder_number between 1 and 9999),
  name           text not null check (char_length(btrim(name)) between 1 and 80),
  phone          text check (phone is null or char_length(phone) <= 40),
  email          text check (email is null or char_length(email) <= 200),
  wallet         text check (wallet is null or wallet = lower(wallet)),
  created_at     timestamptz not null default now(),
  unique (auction_id, bidder_number)
);
create unique index if not exists uq_auction_bidders_wallet on public.auction_bidders (auction_id, wallet) where wallet is not null;

create table if not exists public.auction_desk_payments (
  id                    uuid primary key default gen_random_uuid(),
  auction_id            uuid not null references public.auctions(id) on delete cascade,
  bidder_id             uuid not null references public.auction_bidders(id) on delete restrict,
  method                text not null check (method in ('cash', 'card_checkout', 'card_saved')),
  status                text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'void')),
  lot_ids               uuid[] not null,
  goods_cents           integer not null check (goods_cents >= 0),
  platform_fee_cents    integer not null default 0 check (platform_fee_cents >= 0),
  processing_fee_cents  integer not null default 0 check (processing_fee_cents >= 0),
  total_cents           integer not null check (total_cents >= 0),
  stripe_payment_intent text unique,
  stripe_session_id     text unique,
  recorded_by           text not null,
  last_error            text,
  created_at            timestamptz not null default now(),
  paid_at               timestamptz
);
create index if not exists idx_auction_desk_payments_auction on public.auction_desk_payments (auction_id, created_at desc);

alter table public.auction_bidders       enable row level security;
alter table public.auction_desk_payments enable row level security;
drop policy if exists "auction_bidders service role" on public.auction_bidders;
drop policy if exists "auction_desk_payments service role" on public.auction_desk_payments;
create policy "auction_bidders service role"       on public.auction_bidders       for all using (auth.role() = 'service_role');
create policy "auction_desk_payments service role" on public.auction_desk_payments for all using (auth.role() = 'service_role');
revoke all on public.auction_bidders, public.auction_desk_payments from anon, authenticated;

-- ── 1. Who runs a club ─────────────────────────────────────────────────────
create or replace function public.auction_is_club_organizer(p_school uuid, p_wallet text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_school is not null and coalesce(p_wallet, '') <> '' and (
    exists (select 1 from public.schools s where s.id = p_school and lower(s.founder_wallet) = lower(p_wallet))
    or exists (select 1 from public.school_members m
                where m.school_id = p_school and lower(m.wallet_address) = lower(p_wallet)
                  and m.role in ('founder', 'elder'))
  );
$$;

create or replace function public.auction_require_organizer(p_auction uuid, p_actor text)
returns public.auctions language plpgsql stable security definer set search_path = public, pg_temp as $$
declare a public.auctions;
begin
  select * into a from public.auctions where id = p_auction;
  if not found then raise exception 'auction not found' using errcode = 'no_data_found'; end if;
  if a.host_type <> 'club' then raise exception 'not a club auction' using errcode = 'check_violation'; end if;
  if not public.auction_is_club_organizer(a.school_id, p_actor) then
    raise exception 'only a club organizer can do that' using errcode = 'insufficient_privilege';
  end if;
  return a;
end;
$$;

-- ── 2. Create a club (the actor becomes its founder) ───────────────────────
create or replace function public.create_auction_club(p_actor text, p_name text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_wallet text; v_name text := btrim(coalesce(p_name, '')); v_slug text; v_id uuid; v_n int := 0;
begin
  select wallet_address into v_wallet from public.profiles where lower(wallet_address) = lower(p_actor) limit 1;
  if v_wallet is null then raise exception 'finish setting up your profile first' using errcode = 'no_data_found'; end if;
  if char_length(v_name) not between 2 and 80 then raise exception 'club name must be 2 to 80 characters' using errcode = 'invalid_parameter_value'; end if;
  v_slug := trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
  if v_slug = '' then v_slug := 'club'; end if;
  while exists (select 1 from public.schools where slug = case when v_n = 0 then v_slug else v_slug || '-' || v_n end) loop
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then v_slug := v_slug || '-' || v_n; end if;

  insert into public.schools (name, slug, description, school_type, founder_wallet, is_invite_only)
  values (v_name, v_slug, 'Fish club', 'club', v_wallet, false)
  returning id into v_id;
  insert into public.school_members (school_id, wallet_address, role) values (v_id, v_wallet, 'founder')
  on conflict (school_id, wallet_address) do update set role = 'founder';
  return v_id;
end;
$$;

-- ── 3. Create a club auction ───────────────────────────────────────────────
create or replace function public.create_club_auction(
  p_actor text, p_school uuid, p_title text, p_description text, p_format text,
  p_event_at timestamptz, p_online_ends_at timestamptz, p_pickup_location text,
  p_pickup_notes text, p_default_split integer, p_members_only_bidding boolean
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actor text := lower(btrim(coalesce(p_actor, ''))); v_id uuid; v_format text := coalesce(p_format, 'live');
begin
  if not public.auction_is_club_organizer(p_school, v_actor) then
    raise exception 'only a club organizer can do that' using errcode = 'insufficient_privilege';
  end if;
  if v_format not in ('timed', 'live', 'hybrid') then raise exception 'unknown format' using errcode = 'invalid_parameter_value'; end if;
  if p_event_at is null then raise exception 'pick the auction date and time' using errcode = 'invalid_parameter_value'; end if;
  if v_format = 'hybrid' and (p_online_ends_at is null or p_online_ends_at > p_event_at or p_online_ends_at < now() + interval '1 hour') then
    raise exception 'online bidding must end between an hour from now and the start of the meeting' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.auctions (host_type, host_wallet, school_id, title, description, format, status,
                               starts_at, ends_at, event_at, online_ends_at, pickup_location, pickup_notes,
                               default_club_split_percent, members_only_bidding)
  values ('club', v_actor, p_school, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), v_format, 'live',
          now(), greatest(p_event_at, now()) + interval '1 day', p_event_at,
          case when v_format = 'hybrid' then p_online_ends_at end,
          nullif(btrim(coalesce(p_pickup_location, '')), ''), nullif(btrim(coalesce(p_pickup_notes, '')), ''),
          least(100, greatest(0, coalesce(p_default_split, 0))), coalesce(p_members_only_bidding, false))
  returning id into v_id;
  return v_id;
end;
$$;

-- ── 4. Lots ────────────────────────────────────────────────────────────────
create or replace function public.add_club_lot(
  p_actor text, p_auction uuid, p_title text, p_description text, p_photos jsonb,
  p_starting_bid integer, p_reserve integer, p_consignor_name text, p_consignor_wallet text,
  p_split_percent integer, p_quantity integer
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.auctions; v_id uuid; v_num int; v_ends timestamptz; v_status text;
begin
  a := public.auction_require_organizer(p_auction, p_actor);
  if a.status <> 'live' then raise exception 'this auction is closed' using errcode = 'check_violation'; end if;
  select coalesce(max(lot_number), 0) + 1 into v_num from public.auction_lots where auction_id = a.id;

  if a.format = 'hybrid' and a.online_ends_at > now() then
    v_status := 'live'; v_ends := a.online_ends_at;
  elsif a.format = 'timed' then
    v_status := 'live'; v_ends := a.ends_at;
  else
    v_status := 'awaiting_live'; v_ends := a.ends_at;
  end if;

  insert into public.auction_lots (auction_id, seller_wallet, status, title, description, photos, source, quantity,
                                   starting_bid_cents, reserve_cents, club_split_percent, starts_at, ends_at, original_ends_at,
                                   lot_number, consignor_name, consignor_wallet, approved_at)
  values (a.id, a.host_wallet, v_status, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''),
          coalesce(p_photos, '[]'::jsonb), 'freeform', greatest(1, coalesce(p_quantity, 1)),
          greatest(100, coalesce(p_starting_bid, 100)), p_reserve,
          least(100, greatest(0, coalesce(p_split_percent, a.default_club_split_percent))),
          least(now(), v_ends - interval '1 minute'), v_ends, v_ends,
          v_num, nullif(btrim(coalesce(p_consignor_name, '')), ''), nullif(lower(btrim(coalesce(p_consignor_wallet, ''))), ''), now())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.update_club_lot(
  p_actor text, p_lot uuid, p_title text, p_description text, p_starting_bid integer,
  p_consignor_name text, p_split_percent integer
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.auction_lots;
begin
  select * into l from public.auction_lots where id = p_lot for update;
  if not found then raise exception 'lot not found' using errcode = 'no_data_found'; end if;
  perform public.auction_require_organizer(l.auction_id, p_actor);
  if l.status not in ('live', 'awaiting_live') then raise exception 'this lot has already been sold or closed' using errcode = 'check_violation'; end if;
  update public.auction_lots
     set title = coalesce(nullif(btrim(coalesce(p_title, '')), ''), title),
         description = case when p_description is null then description else nullif(btrim(p_description), '') end,
         starting_bid_cents = case when l.bid_count = 0 and p_starting_bid is not null then greatest(100, p_starting_bid) else starting_bid_cents end,
         consignor_name = case when p_consignor_name is null then consignor_name else nullif(btrim(p_consignor_name), '') end,
         club_split_percent = case when p_split_percent is null then club_split_percent else least(100, greatest(0, p_split_percent)) end
   where id = l.id;
  return jsonb_build_object('lotId', l.id);
end;
$$;

create or replace function public.remove_club_lot(p_actor text, p_lot uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.auction_lots;
begin
  select * into l from public.auction_lots where id = p_lot for update;
  if not found then raise exception 'lot not found' using errcode = 'no_data_found'; end if;
  perform public.auction_require_organizer(l.auction_id, p_actor);
  if l.status not in ('live', 'awaiting_live') or l.bid_count > 0 then
    raise exception 'only a lot with no bids can be removed' using errcode = 'check_violation';
  end if;
  update public.auction_lots set status = 'cancelled', closed_at = now() where id = l.id;
  perform public.auction_lot_return_stock(l.id);
  return jsonb_build_object('lotId', l.id, 'status', 'cancelled');
end;
$$;

-- ── 5. Bidder numbers ──────────────────────────────────────────────────────
create or replace function public.register_auction_bidder(
  p_actor text, p_auction uuid, p_name text, p_phone text, p_email text, p_wallet text, p_number integer
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.auctions; v_num int; v_row public.auction_bidders; v_wallet text := nullif(lower(btrim(coalesce(p_wallet, ''))), '');
begin
  a := public.auction_require_organizer(p_auction, p_actor);
  if v_wallet is not null then
    select * into v_row from public.auction_bidders where auction_id = a.id and wallet = v_wallet;
    if found then return jsonb_build_object('id', v_row.id, 'number', v_row.bidder_number, 'existing', true); end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('auction_bidders:' || a.id::text, 0));
  if p_number is not null then
    if exists (select 1 from public.auction_bidders where auction_id = a.id and bidder_number = p_number) then
      raise exception 'bidder number % is taken', p_number using errcode = 'unique_violation';
    end if;
    v_num := p_number;
  else
    select coalesce(max(bidder_number), 0) + 1 into v_num from public.auction_bidders where auction_id = a.id;
  end if;
  insert into public.auction_bidders (auction_id, bidder_number, name, phone, email, wallet)
  values (a.id, v_num, btrim(p_name), nullif(btrim(coalesce(p_phone, '')), ''), nullif(lower(btrim(coalesce(p_email, ''))), ''), v_wallet)
  returning * into v_row;
  return jsonb_build_object('id', v_row.id, 'number', v_row.bidder_number, 'existing', false);
end;
$$;

-- ── 6. The room: current lot, results, undo ────────────────────────────────
create or replace function public.set_auction_current_lot(p_actor text, p_lot uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.auction_lots;
begin
  select * into l from public.auction_lots where id = p_lot;
  if not found then raise exception 'lot not found' using errcode = 'no_data_found'; end if;
  perform public.auction_require_organizer(l.auction_id, p_actor);
  update public.auctions set current_lot_id = l.id where id = l.auction_id;
  return jsonb_build_object('lotId', l.id);
end;
$$;

-- p_outcome: 'sold' (to a bidder number at p_hammer), 'online' (to the standing
-- online bid), 'passed' (unsold).
create or replace function public.record_live_lot_result(
  p_actor text, p_lot uuid, p_outcome text, p_bidder uuid, p_hammer integer
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.auction_lots; a public.auctions; b public.auction_bidders;
begin
  select * into l from public.auction_lots where id = p_lot for update;
  if not found then raise exception 'lot not found' using errcode = 'no_data_found'; end if;
  a := public.auction_require_organizer(l.auction_id, p_actor);
  if l.status not in ('awaiting_live', 'live') or a.format not in ('live', 'hybrid') then
    raise exception 'this lot is not up for sale in the room' using errcode = 'check_violation';
  end if;

  if p_outcome = 'sold' then
    select * into b from public.auction_bidders where id = p_bidder and auction_id = a.id;
    if not found then raise exception 'unknown bidder number' using errcode = 'no_data_found'; end if;
    if p_hammer is null or p_hammer < 100 or p_hammer > 10000000 then
      raise exception 'enter a price between $1 and $100,000' using errcode = 'invalid_parameter_value';
    end if;
    if l.high_bid_cents is not null and p_hammer <= l.high_bid_cents then
      raise exception 'the room must beat the online bid of % cents', l.high_bid_cents using errcode = 'check_violation';
    end if;
    if l.reserve_cents is not null and p_hammer < l.reserve_cents then
      raise exception 'that is below the reserve' using errcode = 'check_violation';
    end if;
    update public.auction_lots
       set status = 'sold_live', sold_to_bidder_id = b.id, hammer_cents = p_hammer,
           winner_wallet = case when b.wallet is not null and b.wallet <> l.seller_wallet then b.wallet end,
           closed_at = now()
     where id = l.id;
  elsif p_outcome = 'online' then
    if l.high_bidder_wallet is null then raise exception 'there is no online bid on this lot' using errcode = 'check_violation'; end if;
    if l.reserve_cents is not null and l.high_bid_cents < l.reserve_cents then
      raise exception 'the online bid is below the reserve' using errcode = 'check_violation';
    end if;
    update public.auction_lots
       set status = 'ended', winner_wallet = high_bidder_wallet, hammer_cents = high_bid_cents,
           closed_at = now(), payment_deadline = now() + interval '24 hours'
     where id = l.id;
  elsif p_outcome = 'passed' then
    update public.auction_lots set status = 'unsold', closed_at = now() where id = l.id;
    perform public.auction_lot_return_stock(l.id);
  else
    raise exception 'unknown outcome' using errcode = 'invalid_parameter_value';
  end if;

  return jsonb_build_object('lotId', l.id, 'outcome', p_outcome);
end;
$$;

-- Clerk typo? Put the lot back up, as long as no money has moved for it.
create or replace function public.undo_live_lot_result(p_actor text, p_lot uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.auction_lots; a public.auctions;
begin
  select * into l from public.auction_lots where id = p_lot for update;
  if not found then raise exception 'lot not found' using errcode = 'no_data_found'; end if;
  a := public.auction_require_organizer(l.auction_id, p_actor);
  if l.status = 'sold_live' and l.desk_payment_id is null then
    null;
  elsif l.status = 'ended' and l.payment_intent is null and l.charge_attempts = 0 then
    null;
  elsif l.status = 'unsold' and l.stock_moved = false and l.source = 'freeform' then
    null;
  else
    raise exception 'this lot has been paid for or charged, so it can''t be undone here' using errcode = 'check_violation';
  end if;
  update public.auction_lots
     set status = 'awaiting_live', sold_to_bidder_id = null, winner_wallet = null, hammer_cents = null,
         closed_at = null, payment_deadline = null
   where id = l.id;
  return jsonb_build_object('lotId', l.id, 'status', 'awaiting_live');
end;
$$;

-- ── 7. Checkout desk ───────────────────────────────────────────────────────
-- Cash: every unpaid room win for this bidder is paid and handed over, now.
create or replace function public.desk_record_cash(p_actor text, p_bidder uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.auction_bidders; v_ids uuid[]; v_goods int; v_pay uuid;
begin
  select * into b from public.auction_bidders where id = p_bidder;
  if not found then raise exception 'unknown bidder number' using errcode = 'no_data_found'; end if;
  perform public.auction_require_organizer(b.auction_id, p_actor);
  select array_agg(id), coalesce(sum(hammer_cents), 0) into v_ids, v_goods
    from public.auction_lots
   where sold_to_bidder_id = b.id and status = 'sold_live' and desk_payment_id is null;
  if v_ids is null then raise exception 'nothing to pay for this bidder' using errcode = 'check_violation'; end if;

  insert into public.auction_desk_payments (auction_id, bidder_id, method, status, lot_ids, goods_cents, total_cents, recorded_by, paid_at)
  values (b.auction_id, b.id, 'cash', 'paid', v_ids, v_goods, v_goods, lower(p_actor), now())
  returning id into v_pay;
  update public.auction_lots
     set status = 'handed_off', payment_method = 'cash', desk_payment_id = v_pay, paid_at = now(), handed_off_at = now()
   where id = any(v_ids);
  return jsonb_build_object('paymentId', v_pay, 'lots', array_length(v_ids, 1), 'goodsCents', v_goods);
end;
$$;

-- Card: reserve the bidder's unpaid wins for one payment (so they can't be paid
-- twice), with the amounts the API computed. Settled by desk_mark_payment_paid.
create or replace function public.desk_begin_card_payment(
  p_actor text, p_bidder uuid, p_method text, p_platform_fee integer, p_processing_fee integer
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.auction_bidders; v_ids uuid[]; v_goods int; v_pay uuid;
begin
  if p_method not in ('card_checkout', 'card_saved') then raise exception 'unknown method' using errcode = 'invalid_parameter_value'; end if;
  select * into b from public.auction_bidders where id = p_bidder;
  if not found then raise exception 'unknown bidder number' using errcode = 'no_data_found'; end if;
  perform public.auction_require_organizer(b.auction_id, p_actor);

  -- A card payment still pending for this bidder is voided so a fresh one can start.
  update public.auction_lots set desk_payment_id = null
   where desk_payment_id in (select id from public.auction_desk_payments where bidder_id = b.id and status = 'pending');
  update public.auction_desk_payments set status = 'void' where bidder_id = b.id and status = 'pending';

  select array_agg(id), coalesce(sum(hammer_cents), 0) into v_ids, v_goods
    from public.auction_lots
   where sold_to_bidder_id = b.id and status = 'sold_live' and desk_payment_id is null;
  if v_ids is null then raise exception 'nothing to pay for this bidder' using errcode = 'check_violation'; end if;

  insert into public.auction_desk_payments (auction_id, bidder_id, method, status, lot_ids, goods_cents,
                                            platform_fee_cents, processing_fee_cents, total_cents, recorded_by)
  values (b.auction_id, b.id, p_method, 'pending', v_ids, v_goods,
          greatest(0, coalesce(p_platform_fee, 0)), greatest(0, coalesce(p_processing_fee, 0)),
          v_goods + greatest(0, coalesce(p_processing_fee, 0)), lower(p_actor))
  returning id into v_pay;
  update public.auction_lots set desk_payment_id = v_pay where id = any(v_ids);
  return jsonb_build_object('paymentId', v_pay, 'lotIds', to_jsonb(v_ids), 'goodsCents', v_goods,
                            'auctionId', b.auction_id, 'bidderNumber', b.bidder_number, 'bidderName', b.name, 'wallet', b.wallet);
end;
$$;

create or replace function public.desk_attach_stripe(p_payment uuid, p_payment_intent text, p_session text)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.auction_desk_payments
     set stripe_payment_intent = coalesce(p_payment_intent, stripe_payment_intent),
         stripe_session_id = coalesce(p_session, stripe_session_id)
   where id = p_payment and status = 'pending';
$$;

create or replace function public.desk_mark_payment_paid(p_payment uuid, p_payment_intent text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare d public.auction_desk_payments;
begin
  select * into d from public.auction_desk_payments where id = p_payment for update;
  if not found then raise exception 'payment not found' using errcode = 'no_data_found'; end if;
  if d.status = 'paid' then return jsonb_build_object('paymentId', d.id, 'replay', true); end if;
  if d.status <> 'pending' then raise exception 'payment is %', d.status using errcode = 'check_violation'; end if;
  update public.auction_desk_payments
     set status = 'paid', paid_at = now(), stripe_payment_intent = coalesce(p_payment_intent, stripe_payment_intent), last_error = null
   where id = d.id;
  update public.auction_lots
     set status = 'handed_off', payment_method = 'card', paid_at = now(), handed_off_at = now()
   where desk_payment_id = d.id and status = 'sold_live';
  return jsonb_build_object('paymentId', d.id, 'status', 'paid', 'auctionId', d.auction_id,
                            'goodsCents', d.goods_cents, 'platformFeeCents', d.platform_fee_cents);
end;
$$;

create or replace function public.desk_fail_payment(p_payment uuid, p_error text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.auction_lots set desk_payment_id = null where desk_payment_id = p_payment and status = 'sold_live';
  update public.auction_desk_payments set status = 'failed', last_error = left(coalesce(p_error, 'failed'), 500)
   where id = p_payment and status = 'pending';
end;
$$;

-- ── 8. Close job: hybrid presale ends → lots wait for the room ─────────────
create or replace function public.close_ended_auction_lots(p_limit integer default 200)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r record;
  v_sold integer := 0; v_unsold integer := 0; v_forfeited integer := 0; v_to_room integer := 0;
begin
  for r in
    select l.id, l.high_bid_cents, l.high_bidder_wallet, l.reserve_cents, a.format
      from public.auction_lots l
      join public.auctions a on a.id = l.auction_id
     where l.status = 'live' and l.ends_at <= now()
     order by l.ends_at
     limit greatest(1, coalesce(p_limit, 200))
     for update of l skip locked
  loop
    if r.format in ('hybrid', 'live') then
      -- Online bidding is over; the lot is finished live in the room.
      update public.auction_lots set status = 'awaiting_live' where id = r.id;
      v_to_room := v_to_room + 1;
    elsif r.high_bid_cents is null or (r.reserve_cents is not null and r.high_bid_cents < r.reserve_cents) then
      update public.auction_lots set status = 'unsold', closed_at = now() where id = r.id;
      perform public.auction_lot_return_stock(r.id);
      v_unsold := v_unsold + 1;
    else
      update public.auction_lots
         set status = 'ended', winner_wallet = r.high_bidder_wallet, hammer_cents = r.high_bid_cents,
             closed_at = now(), payment_deadline = now() + interval '24 hours'
       where id = r.id;
      v_sold := v_sold + 1;
    end if;
  end loop;

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

  update public.auctions a
     set status = 'ended'
   where a.status = 'live' and a.ends_at <= now()
     and not exists (select 1 from public.auction_lots l where l.auction_id = a.id
                      and l.status in ('live', 'pending_approval', 'awaiting_live', 'sold_live'));

  return jsonb_build_object('sold', v_sold, 'unsold', v_unsold, 'forfeited', v_forfeited, 'toRoom', v_to_room);
end;
$$;

-- ── 9. Public views ────────────────────────────────────────────────────────
create or replace view public.auction_lots_public as
select
  l.id, l.auction_id, a.host_type, a.school_id, s.name as club_name, s.slug as club_slug, a.title as auction_title,
  l.seller_wallet, coalesce(nullif(btrim(bp.display_name), ''), p.display_name) as seller_name,
  l.title, l.description, l.photos, l.source, l.quantity, l.starting_bid_cents,
  (l.reserve_cents is not null) as has_reserve,
  (l.reserve_cents is null or coalesce(l.high_bid_cents, 0) >= l.reserve_cents) as reserve_met,
  l.high_bid_cents, l.bid_count,
  public.auction_min_next_bid(l.high_bid_cents, l.starting_bid_cents) as min_next_bid_cents,
  l.starts_at, l.ends_at, a.pickup_location, a.pickup_notes, a.members_only_bidding,
  case
    when l.status = 'live' and now() < l.starts_at then 'upcoming'
    when l.status = 'live' and now() < l.ends_at   then 'live'
    when l.status = 'awaiting_live'                 then 'in_room'
    when l.status in ('live', 'ended', 'charging', 'payment_failed') then 'closed'
    when l.status in ('paid', 'handed_off', 'sold_live') then 'sold'
    else 'unsold'
  end as public_status,
  case when l.status in ('paid', 'handed_off', 'sold_live') then l.hammer_cents end as sold_for_cents,
  l.closed_at, l.created_at, bp.slug as seller_slug,
  l.lot_number, a.format as auction_format, a.event_at
from public.auction_lots l
join public.auctions a on a.id = l.auction_id
left join public.schools s on s.id = a.school_id
left join public.profiles p on lower(p.wallet_address) = l.seller_wallet
left join public.breeder_profiles bp on lower(bp.wallet_address) = l.seller_wallet
where a.status <> 'draft'
  and l.status not in ('pending_approval', 'cancelled');

-- The room screen (projector / phones): what's selling right now.
create or replace view public.auction_room_public as
select
  a.id as auction_id, a.title, a.format, a.event_at, a.status as auction_status,
  s.name as club_name,
  l.id as lot_id, l.lot_number, l.title as lot_title, l.photos, l.quantity,
  l.starting_bid_cents, l.high_bid_cents, l.bid_count,
  case when l.status in ('sold_live', 'handed_off', 'ended', 'paid', 'charging', 'payment_failed') then 'sold'
       when l.status = 'unsold' then 'passed'
       else 'selling' end as lot_state,
  case when l.status in ('sold_live', 'handed_off', 'ended', 'paid', 'charging', 'payment_failed') then l.hammer_cents end as sold_for_cents,
  b.bidder_number as sold_to_number,
  (select count(*) from public.auction_lots x where x.auction_id = a.id and x.status not in ('cancelled', 'pending_approval')) as lot_count,
  (select count(*) from public.auction_lots x where x.auction_id = a.id and x.status in ('awaiting_live', 'live')) as lots_left
from public.auctions a
left join public.schools s on s.id = a.school_id
left join public.auction_lots l on l.id = a.current_lot_id
left join public.auction_bidders b on b.id = l.sold_to_bidder_id
where a.host_type = 'club' and a.status <> 'draft';

revoke all on public.auction_lots_public, public.auction_room_public from anon, authenticated;
grant select on public.auction_lots_public, public.auction_room_public to anon, authenticated;

-- ── 10. Grants: server only ────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'auction_is_club_organizer(uuid, text)',
    'auction_require_organizer(uuid, text)',
    'create_auction_club(text, text)',
    'create_club_auction(text, uuid, text, text, text, timestamptz, timestamptz, text, text, integer, boolean)',
    'add_club_lot(text, uuid, text, text, jsonb, integer, integer, text, text, integer, integer)',
    'update_club_lot(text, uuid, text, text, integer, text, integer)',
    'remove_club_lot(text, uuid)',
    'register_auction_bidder(text, uuid, text, text, text, text, integer)',
    'set_auction_current_lot(text, uuid)',
    'record_live_lot_result(text, uuid, text, uuid, integer)',
    'undo_live_lot_result(text, uuid)',
    'desk_record_cash(text, uuid)',
    'desk_begin_card_payment(text, uuid, text, integer, integer)',
    'desk_attach_stripe(uuid, text, text)',
    'desk_mark_payment_paid(uuid, text)',
    'desk_fail_payment(uuid, text)',
    'close_ended_auction_lots(integer)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end;
$$;

do $$
declare v_bad text;
begin
  select string_agg(p.proname, ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('auction_is_club_organizer', 'auction_require_organizer', 'create_auction_club', 'create_club_auction',
                      'add_club_lot', 'update_club_lot', 'remove_club_lot', 'register_auction_bidder', 'set_auction_current_lot',
                      'record_live_lot_result', 'undo_live_lot_result', 'desk_record_cash', 'desk_begin_card_payment',
                      'desk_attach_stripe', 'desk_mark_payment_paid', 'desk_fail_payment', 'close_ended_auction_lots')
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
  if v_bad is not null then raise exception 'browser roles can execute: %', v_bad; end if;
  if has_table_privilege('anon', 'public.auction_bidders', 'select') or has_table_privilege('anon', 'public.auction_desk_payments', 'select') then
    raise exception 'browser roles can read bidders or desk payments';
  end if;
end;
$$;

commit;
