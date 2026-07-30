-- ============================================================================
-- Grow-out checkpoint cloud mirror (docs/BREEDER_STATE_MODEL.md §9.2)
--
-- Backs syncGrowoutCheckpointToCloud / syncGrowoutCheckpointsToCloud and the
-- grow-out leg of pullCloudDataForWallet / pushAllLocalDataToCloud in
-- frontend/src/services/cloudSync.js.
--
-- WHY: `spawnGrowout` was the one load-bearing breeder table with no cloud
-- mirror. Every fry count, cull, loss, sale, and survival rate — plus the
-- Poseidon overdue nudges and every stat and badge on the Achievements tab —
-- is derived from it. All of that was device-local, so a cache clear or a new
-- device silently erased a breeder's entire production history while leaving
-- their spawns and certificates intact. The data looked fine and the numbers
-- were wrong.
--
-- KEY DESIGN NOTE: the local Dexie table uses `++id` auto-increment, so its ids
-- are DEVICE-SCOPED (two devices both mint 1, 2, 3…). A local id is therefore
-- useless as a cloud identity. Rows are keyed on the natural tuple
--   (owner_address, spawn_id, event_timestamp, type)
-- which is what the client upserts against and what the pull-side dedup
-- re-derives. A collision on that tuple means the same checkpoint type was
-- logged against the same spawn in the same second — a double-submit — so
-- collapsing it is the desired behavior, not data loss.
--
-- PHOTOS ARE NOT STORED HERE. Checkpoint photos are base64 data URLs (hundreds
-- of KB each, hundreds of checkpoints per active breeder); pushing them through
-- `data` would bloat every row and every pull. `has_photo` records that one
-- existed locally. Migrating them belongs to the tankMedia/CDN pipeline
-- (BREEDER_STATE_MODEL §9.3), not here.
--
-- SCOPE GUARDRAIL: this table holds husbandry observations only. Nothing here
-- is money, inventory, ownership, or a birth-certificate state. In particular a
-- `sold` checkpoint is a SELF-REPORTED count the breeder typed — it is not an
-- order and must never be read as one (BREEDER_STATE_MODEL §9.11 tracks the
-- Achievements tab currently making exactly that mistake).
-- ============================================================================

CREATE TABLE IF NOT EXISTS aquadex_spawn_growout (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Owning wallet, resolved client-side from the parent spawn (checkpoints
  -- themselves carry no owner). Lowercased EOA, per the canonical address rule
  -- in frontend/src/services/relayer.js.
  owner_address TEXT NOT NULL,

  -- Parent spawn. TEXT because local spawn ids are Date.now() values that
  -- exceed a safe integer round-trip through JSON.
  spawn_id TEXT NOT NULL,

  -- Unix SECONDS, matching every other timestamp the local-first layer writes.
  event_timestamp BIGINT NOT NULL,

  type TEXT NOT NULL CHECK (type IN (
    'fry_count', 'cull', 'sold', 'loss', 'moved', 'note', 'narration'
  )),

  count INTEGER NOT NULL DEFAULT 0,
  note TEXT,

  -- A photo existed on the local record but is not mirrored (see header).
  has_photo BOOLEAN NOT NULL DEFAULT false,

  -- Full checkpoint blob minus the local id and the photo, so the shape can grow
  -- without a migration — same convention as aquadex_tanks/specimens/spawns.
  data JSONB NOT NULL DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_growout_count_nonneg CHECK (count >= 0),
  CONSTRAINT chk_growout_note_len CHECK (note IS NULL OR char_length(note) <= 2000)
);

-- The natural key the client upserts against (see KEY DESIGN NOTE).
CREATE UNIQUE INDEX IF NOT EXISTS uq_aquadex_spawn_growout_natural
  ON aquadex_spawn_growout(owner_address, spawn_id, event_timestamp, type);

-- Pull path: every checkpoint for one wallet.
CREATE INDEX IF NOT EXISTS idx_aquadex_spawn_growout_owner
  ON aquadex_spawn_growout(owner_address);

-- Per-spawn history, newest first.
CREATE INDEX IF NOT EXISTS idx_aquadex_spawn_growout_spawn
  ON aquadex_spawn_growout(spawn_id, event_timestamp DESC);

-- ─── Row Level Security ─────────────────────────────────────────────────────
-- Wallet-scoped for read AND write. Two accepted identity sources, matching the
-- documented auth architecture in frontend/src/services/supabaseClient.js:
--
--   1. The minted JWT's `wallet_address` claim (/api/mint-session), which is the
--      preferred path and reaches the `authenticated` role.
--   2. The `x-wallet-address` request header, used when the JWT bridge is
--      unavailable and the client falls back to the anon role.
--
-- The header fallback is NOT a security boundary — a caller can set any header.
-- It is accepted here for the same reason the other aquadex_* mirrors accept it:
-- these are the user's own husbandry notes, the JWT bridge is best-effort by
-- design, and the alternative is silently losing writes for every session that
-- fails to mint. Do NOT copy this pattern onto a table holding money,
-- ownership, or certificate state — those must be service-role only.
ALTER TABLE aquadex_spawn_growout ENABLE ROW LEVEL SECURITY;

-- Resolve the caller's wallet from either source, lowercased.
CREATE OR REPLACE FUNCTION aquadex_caller_wallet() RETURNS TEXT AS $$
  SELECT lower(coalesce(
    nullif(current_setting('request.jwt.claims', true)::json->>'wallet_address', ''),
    nullif(current_setting('request.headers', true)::json->>'x-wallet-address', '')
  ));
$$ LANGUAGE sql STABLE;

DROP POLICY IF EXISTS "growout_select_own" ON aquadex_spawn_growout;
CREATE POLICY "growout_select_own"
  ON aquadex_spawn_growout FOR SELECT
  USING (lower(owner_address) = aquadex_caller_wallet());

DROP POLICY IF EXISTS "growout_insert_own" ON aquadex_spawn_growout;
CREATE POLICY "growout_insert_own"
  ON aquadex_spawn_growout FOR INSERT
  WITH CHECK (lower(owner_address) = aquadex_caller_wallet());

DROP POLICY IF EXISTS "growout_update_own" ON aquadex_spawn_growout;
CREATE POLICY "growout_update_own"
  ON aquadex_spawn_growout FOR UPDATE
  USING (lower(owner_address) = aquadex_caller_wallet())
  WITH CHECK (lower(owner_address) = aquadex_caller_wallet());

-- No DELETE policy: a breeder's grow-out history is append-only from the client.
-- Corrections happen by logging a new checkpoint, which is also how the funnel
-- math expects to read them.

DROP POLICY IF EXISTS "growout_service_role" ON aquadex_spawn_growout;
CREATE POLICY "growout_service_role"
  ON aquadex_spawn_growout FOR ALL
  USING (auth.role() = 'service_role');

-- Keep updated_at honest on upsert-as-update.
CREATE OR REPLACE FUNCTION touch_aquadex_spawn_growout() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_aquadex_spawn_growout ON aquadex_spawn_growout;
CREATE TRIGGER trg_touch_aquadex_spawn_growout
  BEFORE UPDATE ON aquadex_spawn_growout
  FOR EACH ROW EXECUTE FUNCTION touch_aquadex_spawn_growout();

-- ============================================================================
-- Done. Grow-out history now survives a cache clear and follows the breeder
-- across devices. Achievements remain DERIVED from these rows, so they inherit
-- the mirror automatically.
-- ============================================================================
