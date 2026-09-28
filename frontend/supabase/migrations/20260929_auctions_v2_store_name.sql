-- ============================================================================
-- Public auction lots show the seller's STORE name (2026-09-29).
-- ============================================================================
-- auction_lots_public used profiles.display_name, which for many sellers is the
-- auto-generated handle (e.g. "Frost-Tang-7113"). Prefer the storefront name
-- from breeder_profiles, and expose the store slug so a lot can link to it.
-- Same columns in the same order; seller_slug is appended (replace-view rule).
-- ============================================================================

begin;

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
  coalesce(nullif(btrim(bp.display_name), ''), p.display_name) as seller_name,
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
  l.created_at,
  bp.slug                                  as seller_slug
from public.auction_lots l
join public.auctions a on a.id = l.auction_id
left join public.schools s on s.id = a.school_id
left join public.profiles p on lower(p.wallet_address) = l.seller_wallet
left join public.breeder_profiles bp on lower(bp.wallet_address) = l.seller_wallet
where a.status <> 'draft'
  and l.status not in ('pending_approval', 'cancelled');

revoke all on public.auction_lots_public from anon, authenticated;
grant select on public.auction_lots_public to anon, authenticated;

commit;
