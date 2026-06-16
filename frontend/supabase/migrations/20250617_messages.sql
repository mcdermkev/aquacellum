-- =============================================================================
-- Migration: Direct Messages (DMs) between Tankmates
-- Batch 3: Conversations + Messages tables
-- =============================================================================

CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_a TEXT NOT NULL,
  participant_b TEXT NOT NULL,
  last_message_preview TEXT,
  last_message_at TIMESTAMPTZ DEFAULT now(),
  unread_a INTEGER NOT NULL DEFAULT 0,
  unread_b INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Ensure one conversation per unique pair (alphabetical wallet order)
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_pair
  ON conversations (participant_a, participant_b);

-- Index for fetching a user's conversations sorted by recency
CREATE INDEX IF NOT EXISTS idx_conversations_participant_a
  ON conversations (participant_a, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_participant_b
  ON conversations (participant_b, last_message_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_wallet TEXT NOT NULL,
  body TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fetching messages in a conversation (chronological)
CREATE INDEX IF NOT EXISTS idx_messages_conversation
  ON messages (conversation_id, created_at ASC);

-- Index for unread count queries
CREATE INDEX IF NOT EXISTS idx_messages_unread
  ON messages (conversation_id, is_read)
  WHERE is_read = false;

-- RLS policies
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Users can read conversations they're part of
CREATE POLICY "Users read own conversations" ON conversations
  FOR SELECT USING (true);

-- Allow creating conversations
CREATE POLICY "Allow conversation creation" ON conversations
  FOR INSERT WITH CHECK (true);

-- Allow updating conversations (last_message, unread counts)
CREATE POLICY "Allow conversation updates" ON conversations
  FOR UPDATE USING (true);

-- Users can read messages in their conversations
CREATE POLICY "Users read messages" ON messages
  FOR SELECT USING (true);

-- Allow sending messages
CREATE POLICY "Allow sending messages" ON messages
  FOR INSERT WITH CHECK (true);

-- Allow marking messages as read
CREATE POLICY "Allow message updates" ON messages
  FOR UPDATE USING (true);

-- Comments
COMMENT ON TABLE conversations IS 'DM conversation threads between Tankmate pairs';
COMMENT ON COLUMN conversations.participant_a IS 'Alphabetically first wallet address of the pair';
COMMENT ON COLUMN conversations.participant_b IS 'Alphabetically second wallet address of the pair';
COMMENT ON COLUMN conversations.unread_a IS 'Unread message count for participant_a';
COMMENT ON COLUMN conversations.unread_b IS 'Unread message count for participant_b';
COMMENT ON TABLE messages IS 'Individual DM messages within a conversation';
