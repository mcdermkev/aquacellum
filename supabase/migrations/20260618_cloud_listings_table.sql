-- ============================================================================
-- AquaDex Cloud Marketplace Listings Table
-- Enables cross-user listing visibility. All users' listings are synced here
-- so other users can browse them without waiting for on-chain confirmation.
--
-- Architecture matches existing cloud sync tables:
--   - Full listing stored as JSON blob in `data` column (jsonb).
--   - seller_address is the wallet/smart-wallet that created the listing.
--   - All users can read all listings (marketplace is public).
--   - No RLS JWT bridge required — queries filter/join as needed.
-- ============================================================================

create table if not exists public.aquadex_listings (
  id              text        primary key,          -- listing id (tokenId or listingId as text)
  seller_address  text        not null,             -- wallet address of seller, lowercase
  species_id      integer     not null default 0,
  common_name     text        not null default '',
  price           text        not null default '0', -- ETH price as string
  is_batch        boolean     not null default false,
  is_active       boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  data            jsonb       not null              -- full listing object (same shape as Dexie localListings)
);

create index if not exists aquadex_listings_seller_idx
  on public.aquadex_listings (seller_address);

create index if not exists aquadex_listings_active_idx
  on public.aquadex_listings (is_active);

create index if not exists aquadex_listings_species_idx
  on public.aquadex_listings (species_id) where is_active = true;

-- ── Row Level Security ───────────────────────────────────────────────────────
alter table public.aquadex_listings enable row level security;

-- All users can read all active listings (marketplace is public)
create policy "anon full access listings"
  on public.aquadex_listings for all
  to anon using (true) with check (true);
