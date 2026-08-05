-- Seller vacation mode
--
-- WHY THIS IS A DATE AND NOT A BOOLEAN. A breeder pausing their store is going
-- somewhere, or has a heat wave, or a sick tank — they know roughly when they are
-- back. A boolean `accepting_orders` has to be manually turned back on, and the
-- failure mode is silent: the store stays shut, orders stop, and nobody notices
-- until the breeder wonders why sales dried up. `vacation_until` auto-resumes, so
-- forgetting costs nothing. It also lets buyers see "back on the 20th" instead of a
-- bare "unavailable", which is the difference between waiting and going elsewhere.
--
-- NULL          = accepting orders (the default, and the state of every existing row)
-- future date   = paused, resumes automatically at that timestamp
-- past date     = accepting orders again, no cleanup needed
--
-- DISTINCT FROM `storefront_active`, which already exists on this table and governs
-- whether the storefront is LISTED in the breeder directory (read by
-- services/breederRegistry.js). Visibility and purchasability are different
-- questions: a paused seller should usually stay discoverable, so a buyer can find
-- them and come back, while being unable to take an order today.
--
-- ⚠️ ENFORCEMENT LIVES IN THE CART. `services/cartRevalidation.js` already marks an
-- item unavailable when it is absent from the live listing set; vacation mode feeds
-- it a `pausedSellers` set so a paused seller's items are excluded from totals and
-- checkout. Adding this column WITHOUT that wiring would be the dangerous version:
-- a seller believing their store is closed while orders for live animals keep
-- arriving. The column and the enforcement ship together.

alter table public.breeder_profiles
  add column if not exists vacation_until timestamptz;

comment on column public.breeder_profiles.vacation_until is
  'Seller vacation mode. NULL or a past timestamp = accepting orders. A future timestamp = paused; new orders are blocked at cart revalidation and the storefront shows a return date. Auto-resumes, so a forgotten pause cannot silently kill sales.';

-- Buyers ask "is this seller paused?" per cart revalidation, so the lookup is by
-- wallet and only paused rows matter.
create index if not exists breeder_profiles_vacation_idx
  on public.breeder_profiles (wallet_address)
  where vacation_until is not null;
