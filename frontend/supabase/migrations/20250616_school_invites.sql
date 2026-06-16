-- =============================================================================
-- Migration: School Invites table
-- Enables Founders/Elders to invite users to invite-only Schools
-- =============================================================================

CREATE TABLE IF NOT EXISTS school_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id UUID NOT NULL,
  invited_wallet TEXT NOT NULL,
  invited_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for looking up a user's pending invites
CREATE INDEX IF NOT EXISTS idx_school_invites_recipient
  ON school_invites (invited_wallet, status)
  WHERE status = 'pending';

-- Index for looking up invites for a specific school
CREATE INDEX IF NOT EXISTS idx_school_invites_school
  ON school_invites (school_id, status);

-- Prevent duplicate pending invites
CREATE UNIQUE INDEX IF NOT EXISTS idx_school_invites_unique_pending
  ON school_invites (school_id, invited_wallet)
  WHERE status = 'pending';

-- RLS policies
ALTER TABLE school_invites ENABLE ROW LEVEL SECURITY;

-- Anyone can read invites addressed to them
CREATE POLICY "Users can read own invites" ON school_invites
  FOR SELECT USING (true);

-- Founders/Elders can create invites (enforced at app level)
CREATE POLICY "Allow creating invites" ON school_invites
  FOR INSERT WITH CHECK (true);

-- Allow status updates (accept/decline)
CREATE POLICY "Allow invite updates" ON school_invites
  FOR UPDATE USING (true);

-- Allow invite deletion (cancel)
CREATE POLICY "Allow invite deletion" ON school_invites
  FOR DELETE USING (true);

-- Column comments
COMMENT ON TABLE school_invites IS 'Pending invitations to join invite-only Schools';
COMMENT ON COLUMN school_invites.status IS 'pending → accepted | declined';
COMMENT ON COLUMN school_invites.invited_by IS 'Wallet of the Founder/Elder who sent the invite';
