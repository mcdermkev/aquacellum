-- ============================================================================
-- Fix Social Reef — Multiple Issues
-- 1. Add 'follow' to follows.follow_type CHECK constraint
-- 2. Create conversations + messages tables (DM) with proper FKs
-- 3. Add RLS policies for DM tables
--
-- Run this in your Supabase SQL Editor.
-- ============================================================================


-- ══════════════════════════════════════════════════════════════════════════════
-- 1. FIX: follows.follow_type CHECK constraint — allow 'follow' type
--    The one-way follow feature was added in code but the DB constraint
--    still only allows ('tankmate', 'watch_tank'). This blocks followUser()
--    and makes follower/following counts always return 0.
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE follows DROP CONSTRAINT IF EXISTS follows_follow_type_check;
ALTER TABLE follows ADD CONSTRAINT follows_follow_type_check
  CHECK (follow_type IN ('tankmate', 'watch_tank', 'follow'));


-- ══════════════════════════════════════════════════════════════════════════════
-- 2. FIX: conversations + messages tables — add missing FKs to profiles
--    The tables already exist (from frontend/supabase/migrations/) but the
--    participant columns lack FKs to profiles, so PostgREST can't resolve
--    resource embedding joins. Add the FKs now.
-- ══════════════════════════════════════════════════════════════════════════════

-- Add FK from conversations.participant_a → profiles.wallet_address (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'conversations_participant_a_fkey'
      AND table_name = 'conversations'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_participant_a_fkey
      FOREIGN KEY (participant_a) REFERENCES profiles(wallet_address) ON DELETE CASCADE;
  END IF;
END $$;

-- Add FK from conversations.participant_b → profiles.wallet_address (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'conversations_participant_b_fkey'
      AND table_name = 'conversations'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_participant_b_fkey
      FOREIGN KEY (participant_b) REFERENCES profiles(wallet_address) ON DELETE CASCADE;
  END IF;
END $$;

-- Add FK from messages.sender_wallet → profiles.wallet_address (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'messages_sender_wallet_fkey'
      AND table_name = 'messages'
  ) THEN
    ALTER TABLE messages
      ADD CONSTRAINT messages_sender_wallet_fkey
      FOREIGN KEY (sender_wallet) REFERENCES profiles(wallet_address) ON DELETE CASCADE;
  END IF;
END $$;


-- ══════════════════════════════════════════════════════════════════════════════
-- 3. RLS policies for DM tables (idempotent — drop if exists, then create)
-- ══════════════════════════════════════════════════════════════════════════════

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Conversations: dev bypass for reads
DROP POLICY IF EXISTS "dev_conversations_select" ON conversations;
CREATE POLICY "dev_conversations_select" ON conversations
  FOR SELECT USING (true);

-- Allow creating conversations (dev bypass)
DROP POLICY IF EXISTS "dev_conversations_insert" ON conversations;
CREATE POLICY "dev_conversations_insert" ON conversations
  FOR INSERT WITH CHECK (true);

-- Allow updating conversations (dev bypass)
DROP POLICY IF EXISTS "dev_conversations_update" ON conversations;
CREATE POLICY "dev_conversations_update" ON conversations
  FOR UPDATE USING (true);

-- Messages: dev bypass for reads
DROP POLICY IF EXISTS "dev_messages_select" ON messages;
CREATE POLICY "dev_messages_select" ON messages
  FOR SELECT USING (true);

-- Allow sending messages (dev bypass)
DROP POLICY IF EXISTS "dev_messages_insert" ON messages;
CREATE POLICY "dev_messages_insert" ON messages
  FOR INSERT WITH CHECK (true);

-- Allow marking messages as read (dev bypass)
DROP POLICY IF EXISTS "dev_messages_update" ON messages;
CREATE POLICY "dev_messages_update" ON messages
  FOR UPDATE USING (true);


-- ══════════════════════════════════════════════════════════════════════════════
-- 4. Enable Realtime for messages table (for live DM updates)
--    Ignore error if already added.
-- ══════════════════════════════════════════════════════════════════════════════

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE messages;
EXCEPTION WHEN duplicate_object THEN
  -- already in the publication, nothing to do
  NULL;
END $$;
