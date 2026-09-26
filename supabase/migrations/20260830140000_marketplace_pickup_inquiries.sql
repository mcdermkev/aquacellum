-- Guest Pickup Inquiry (P3) — casual, no-account "reserve for local pickup" leads.
--
-- A casual buyer on a public showcase/listing submits a lead (name + one contact + optional message);
-- the seller receives it. NO payment, NO on-chain action, NO inventory hold — it is a notified lead only.
-- Writes flow exclusively through the service-key server endpoint
-- (frontend/api/storefront-detail.js?action=pickup-inquiry), which validates, rate-limits, resolves the
-- seller from the listing, and inserts. There is deliberately NO anon RLS policy on this table.
--
-- Additive; registered in supabase/migration-order.json after 20260830130000. Touches nothing frozen.

BEGIN;

CREATE TABLE public.marketplace_pickup_inquiries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_key   text NOT NULL,
  seller_address text NOT NULL,              -- lowercase; resolved server-side from the listing, never client-supplied
  room_slug     text,                        -- optional: which showcase room the lead came from
  guest_name    text NOT NULL,
  contact_kind  text NOT NULL,
  contact_value text NOT NULL,
  message       text,
  status        text NOT NULL DEFAULT 'new',
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketplace_pickup_inquiries_listing_key_format
    CHECK (listing_key ~ '^(single|batch)-[1-9][0-9]*$'),
  CONSTRAINT marketplace_pickup_inquiries_seller_lower
    CHECK (seller_address = lower(seller_address) AND seller_address ~ '^0x[0-9a-f]{40}$'),
  CONSTRAINT marketplace_pickup_inquiries_room_slug_shape
    CHECK (room_slug IS NULL OR (room_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(room_slug) <= 80)),
  CONSTRAINT marketplace_pickup_inquiries_guest_name_bounded
    CHECK (char_length(btrim(guest_name)) BETWEEN 1 AND 80),
  CONSTRAINT marketplace_pickup_inquiries_contact_kind_closed
    CHECK (contact_kind IN ('email', 'phone')),
  CONSTRAINT marketplace_pickup_inquiries_contact_value_bounded
    CHECK (char_length(btrim(contact_value)) BETWEEN 1 AND 120),
  CONSTRAINT marketplace_pickup_inquiries_message_bounded
    CHECK (message IS NULL OR char_length(message) <= 1000),
  CONSTRAINT marketplace_pickup_inquiries_status_closed
    CHECK (status IN ('new', 'seen', 'contacted', 'closed'))
);

CREATE INDEX marketplace_pickup_inquiries_seller_idx
  ON public.marketplace_pickup_inquiries (seller_address, created_at DESC);

ALTER TABLE public.marketplace_pickup_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_pickup_inquiries FORCE ROW LEVEL SECURITY;

-- Seller reads only their own leads (wallet from the JWT bridge, lowercased).
CREATE POLICY "pickup_inquiries_seller_read"
  ON public.marketplace_pickup_inquiries FOR SELECT
  TO authenticated
  USING (seller_address = lower(auth.jwt()->>'wallet_address'));

-- Seller may update the status of their own leads (new -> seen/contacted/closed). The status CHECK
-- constrains the value; ownership is enforced here.
CREATE POLICY "pickup_inquiries_seller_update"
  ON public.marketplace_pickup_inquiries FOR UPDATE
  TO authenticated
  USING (seller_address = lower(auth.jwt()->>'wallet_address'))
  WITH CHECK (seller_address = lower(auth.jwt()->>'wallet_address'));

-- All writes (inserts) and full management go through the service role (the server endpoint).
CREATE POLICY "pickup_inquiries_service_all"
  ON public.marketplace_pickup_inquiries FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- NOTE: there is intentionally NO anon policy — a casual buyer never touches this table directly.

COMMIT;
