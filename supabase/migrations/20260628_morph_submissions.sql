-- ============================================================================
-- Morph Submissions — breeder-submitted color morphs / fin types / patterns
-- queued for curator verification.
--
-- Run this in the Supabase SQL Editor.
--
-- Access model:
--   • Anyone authenticated may READ the full queue (so submitters see status and
--     curators see everything to review).
--   • INSERT is dev-open here (mirrors 006_species_insights). The client sets
--     submitter_wallet from the connected wallet. See the commented production
--     JWT policy below to tighten once the JWT bridge is confirmed in prod.
--   • UPDATE/DELETE are restricted to the service_role. Status flips
--     (pending → verified/rejected) go through /api/update-morph-status, which
--     verifies the caller is the on-chain curator before writing. "curator" is
--     an on-chain contract role with no Supabase JWT claim, so RLS cannot
--     express it — hence the privileged server route (same pattern as xp_events
--     → /api/validate-xp).
-- ============================================================================

CREATE TABLE morph_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submitter_wallet TEXT NOT NULL,
  base_species TEXT NOT NULL,
  morph_name TEXT NOT NULL,
  trait_type TEXT NOT NULL CHECK (trait_type IN ('color', 'fin', 'pattern', 'scale', 'other')),
  description TEXT,
  proof_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  reviewer_wallet TEXT,
  review_note TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_morph_submitter ON morph_submissions(submitter_wallet, created_at DESC);
CREATE INDEX idx_morph_status ON morph_submissions(status, created_at DESC);

-- RLS
ALTER TABLE morph_submissions ENABLE ROW LEVEL SECURITY;

-- Anyone can read the queue (submitters track their status; curators review all).
CREATE POLICY "Anyone can read morph submissions" ON morph_submissions FOR SELECT USING (true);

-- Dev: allow inserts (production should use the JWT policy below instead).
CREATE POLICY "dev_morph_insert" ON morph_submissions FOR INSERT WITH CHECK (true);

-- Reviews/edits/deletes go through the service role only (curator-gated API route).
CREATE POLICY "Service role manages morph submissions" ON morph_submissions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ── PRODUCTION HARDENING (enable once the JWT bridge is confirmed in prod) ──
-- Replace the dev_morph_insert policy with a wallet-scoped one so a submitter
-- can only create rows under their own wallet:
--
--   DROP POLICY "dev_morph_insert" ON morph_submissions;
--   CREATE POLICY "morph_insert_own_jwt" ON morph_submissions FOR INSERT
--     TO authenticated
--     WITH CHECK (submitter_wallet = lower(auth.jwt()->>'wallet_address'));
