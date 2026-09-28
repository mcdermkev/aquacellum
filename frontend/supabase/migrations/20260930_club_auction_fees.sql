-- Club auctions: the club chooses its fees at creation — 2026-09-30.
-- Follows 20260930_club_desk_refunds.sql. Money path (Tier A).
-- ============================================================================
-- Two choices, fixed when the auction is created (there is no edit path):
--   * buyer_premium_percent (0–25): added on top of the winning bid, paid by the
--     buyer, kept in full by the club. Our card fee is on the winning bid only,
--     so the premium never changes what consignors are owed.
--   * club_pays_processing: the club covers card processing instead of the
--     bidder. The bidder pays bid + premium; the processing comes off the
--     club's payout. Cash is unaffected (no processing).
-- Premium is rounded per desk payment: round(goods × percent / 100), in cents.
-- Online winners of a club auction get the same premium and processing rule
-- (api/stripe.js chargeAuctionLotV2). The public views show both so bidders see
-- them before they bid.
-- ============================================================================

begin;

alter table public.auctions add column if not exists buyer_premium_percent integer not null default 0
  check (buyer_premium_percent between 0 and 25);
alter table public.auctions add column if not exists club_pays_processing boolean not null default false;

alter table public.auction_desk_payments add column if not exists premium_cents integer not null default 0 check (premium_cents >= 0);
alter table public.auction_desk_payments add column if not exists club_pays_processing boolean not null default false;

-- ── Create: two new choices ───────────────────────────────────────────────
drop function if exists public.create_club_auction(text, uuid, text, text, text, timestamptz, timestamptz, text, text, integer, boolean);
create or replace function public.create_club_auction(
  p_actor text, p_school uuid, p_title text, p_description text, p_format text,
  p_event_at timestamptz, p_online_ends_at timestamptz, p_pickup_location text,
  p_pickup_notes text, p_default_split integer, p_members_only_bidding boolean,
  p_buyer_premium integer, p_club_pays_processing boolean
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
  if coalesce(p_buyer_premium, 0) not between 0 and 25 then
    raise exception 'buyer''s premium must be 0 to 25 percent' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.auctions (host_type, host_wallet, school_id, title, description, format, status,
                               starts_at, ends_at, event_at, online_ends_at, pickup_location, pickup_notes,
                               default_club_split_percent, members_only_bidding,
                               buyer_premium_percent, club_pays_processing)
  values ('club', v_actor, p_school, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), v_format, 'live',
          now(), greatest(p_event_at, now()) + interval '1 day', p_event_at,
          case when v_format = 'hybrid' then p_online_ends_at end,
          nullif(btrim(coalesce(p_pickup_location, '')), ''), nullif(btrim(coalesce(p_pickup_notes, '')), ''),
          least(100, greatest(0, coalesce(p_default_split, 0))), coalesce(p_members_only_bidding, false),
          coalesce(p_buyer_premium, 0), coalesce(p_club_pays_processing, false))
  returning id into v_id;
  return v_id;
end;
$$;

-- ── Desk cash: bid + premium ──────────────────────────────────────────────
create or replace function public.desk_record_cash(p_actor text, p_bidder uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.auction_bidders; a public.auctions; v_ids uuid[]; v_goods int; v_premium int; v_pay uuid;
begin
  select * into b from public.auction_bidders where id = p_bidder for update;
  if not found then raise exception 'unknown bidder number' using errcode = 'no_data_found'; end if;
  a := public.auction_require_organizer(b.auction_id, p_actor);
  perform 1 from public.auction_lots
   where sold_to_bidder_id = b.id and status = 'sold_live' and desk_payment_id is null
   for update;
  select array_agg(id), coalesce(sum(hammer_cents), 0) into v_ids, v_goods
    from public.auction_lots
   where sold_to_bidder_id = b.id and status = 'sold_live' and desk_payment_id is null;
  if v_ids is null then raise exception 'nothing to pay for this bidder' using errcode = 'check_violation'; end if;
  v_premium := round(v_goods * coalesce(a.buyer_premium_percent, 0) / 100.0)::int;

  insert into public.auction_desk_payments (auction_id, bidder_id, method, status, lot_ids, goods_cents, premium_cents,
                                            total_cents, recorded_by, paid_at)
  values (b.auction_id, b.id, 'cash', 'paid', v_ids, v_goods, v_premium, v_goods + v_premium, lower(p_actor), now())
  returning id into v_pay;
  update public.auction_lots
     set status = 'handed_off', payment_method = 'cash', desk_payment_id = v_pay, paid_at = now(), handed_off_at = now()
   where id = any(v_ids);
  return jsonb_build_object('paymentId', v_pay, 'lots', array_length(v_ids, 1), 'goodsCents', v_goods,
                            'premiumCents', v_premium, 'totalCents', v_goods + v_premium);
end;
$$;

-- ── Desk card: premium from the auction; processing on the bidder or the club ─
create or replace function public.desk_begin_card_payment(
  p_actor text, p_bidder uuid, p_method text, p_platform_fee integer, p_processing_fee integer
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.auction_bidders; a public.auctions; v_ids uuid[]; v_goods int; v_premium int; v_proc int; v_pay uuid;
begin
  if p_method not in ('card_checkout', 'card_saved') then raise exception 'unknown method' using errcode = 'invalid_parameter_value'; end if;
  select * into b from public.auction_bidders where id = p_bidder for update;
  if not found then raise exception 'unknown bidder number' using errcode = 'no_data_found'; end if;
  a := public.auction_require_organizer(b.auction_id, p_actor);

  -- A card payment still pending for this bidder is voided so a fresh one can start.
  update public.auction_lots set desk_payment_id = null
   where desk_payment_id in (select id from public.auction_desk_payments where bidder_id = b.id and status = 'pending')
     and status = 'sold_live';
  update public.auction_desk_payments set status = 'void' where bidder_id = b.id and status = 'pending';

  perform 1 from public.auction_lots
   where sold_to_bidder_id = b.id and status = 'sold_live' and desk_payment_id is null
   for update;
  select array_agg(id), coalesce(sum(hammer_cents), 0) into v_ids, v_goods
    from public.auction_lots
   where sold_to_bidder_id = b.id and status = 'sold_live' and desk_payment_id is null;
  if v_ids is null then raise exception 'nothing to pay for this bidder' using errcode = 'check_violation'; end if;
  v_premium := round(v_goods * coalesce(a.buyer_premium_percent, 0) / 100.0)::int;
  v_proc := greatest(0, coalesce(p_processing_fee, 0));

  insert into public.auction_desk_payments (auction_id, bidder_id, method, status, lot_ids, goods_cents, premium_cents,
                                            platform_fee_cents, processing_fee_cents, club_pays_processing, total_cents, recorded_by)
  values (b.auction_id, b.id, p_method, 'pending', v_ids, v_goods, v_premium,
          greatest(0, coalesce(p_platform_fee, 0)), v_proc, a.club_pays_processing,
          v_goods + v_premium + case when a.club_pays_processing then 0 else v_proc end, lower(p_actor))
  returning id into v_pay;
  update public.auction_lots set desk_payment_id = v_pay where id = any(v_ids);
  return jsonb_build_object('paymentId', v_pay, 'lotIds', to_jsonb(v_ids), 'goodsCents', v_goods,
                            'premiumCents', v_premium, 'clubPaysProcessing', a.club_pays_processing,
                            'auctionId', b.auction_id, 'bidderNumber', b.bidder_number, 'bidderName', b.name, 'wallet', b.wallet);
end;
$$;

-- ── Mark paid: return everything the payout needs ─────────────────────────
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
                            'goodsCents', d.goods_cents, 'premiumCents', d.premium_cents,
                            'platformFeeCents', d.platform_fee_cents, 'processingFeeCents', d.processing_fee_cents,
                            'clubPaysProcessing', d.club_pays_processing);
end;
$$;

-- ── Public views: bidders see the premium and who pays processing ────────
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
  l.lot_number, a.format as auction_format, a.event_at,
  a.buyer_premium_percent, a.club_pays_processing
from public.auction_lots l
join public.auctions a on a.id = l.auction_id
left join public.schools s on s.id = a.school_id
left join public.profiles p on lower(p.wallet_address) = l.seller_wallet
left join public.breeder_profiles bp on lower(bp.wallet_address) = l.seller_wallet
where a.status <> 'draft'
  and l.status not in ('pending_approval', 'cancelled');

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
  (select count(*) from public.auction_lots x where x.auction_id = a.id and x.status in ('awaiting_live', 'live')) as lots_left,
  a.buyer_premium_percent
from public.auctions a
left join public.schools s on s.id = a.school_id
left join public.auction_lots l on l.id = a.current_lot_id
left join public.auction_bidders b on b.id = l.sold_to_bidder_id
where a.host_type = 'club' and a.status <> 'draft';

revoke all on public.auction_lots_public, public.auction_room_public from anon, authenticated;
grant select on public.auction_lots_public, public.auction_room_public to anon, authenticated;

-- ── Grants: server only ───────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'create_club_auction(text, uuid, text, text, text, timestamptz, timestamptz, text, text, integer, boolean, integer, boolean)',
    'desk_record_cash(text, uuid)',
    'desk_begin_card_payment(text, uuid, text, integer, integer)',
    'desk_mark_payment_paid(uuid, text)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
    if has_function_privilege('anon', 'public.' || f, 'execute') or has_function_privilege('authenticated', 'public.' || f, 'execute') then
      raise exception 'browser roles can execute %', f;
    end if;
  end loop;
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'create_club_auction' and p.pronargs = 11) then
    raise exception 'the old create_club_auction is still there';
  end if;
end;
$$;

commit;
