-- Public Species API — API Keys & Request Log
-- Powers the free developer API surface over the 326-species catalog.
-- Goal: let third-party sites/bots/tools embed Aquacellum data, with every
-- response linking back to aquadex.fish (app + marketplace) as the growth loop.

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,               -- public API key, e.g. "aq_live_xxxxxxxx"
  owner_email TEXT NOT NULL,
  app_name TEXT,                          -- what they're building (optional, self-reported)
  app_url TEXT,                           -- optional link to their project
  tier TEXT NOT NULL DEFAULT 'free',      -- 'free' | 'partner' (manually upgraded)
  is_active BOOLEAN NOT NULL DEFAULT true,
  request_count BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);
CREATE INDEX IF NOT EXISTS idx_api_keys_email ON api_keys(owner_email);

-- Lightweight request log for analytics (which endpoints/keys are used, growth tracking).
-- Not a full audit trail — rows can be pruned/aggregated later.
CREATE TABLE IF NOT EXISTS api_request_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  endpoint TEXT NOT NULL,                 -- e.g. 'list', 'detail', 'random', 'stats'
  ip_hash TEXT,                           -- hashed IP for anonymous (no-key) callers
  species_id INTEGER,                    -- specCode, when a detail lookup
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_request_log_key ON api_request_log(api_key_id, created_at);
CREATE INDEX IF NOT EXISTS idx_api_request_log_created ON api_request_log(created_at);

-- RLS: this data is only ever written/read by the service role from serverless
-- functions (frontend/api/species.js). No client-side/anon access needed.
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_request_log ENABLE ROW LEVEL SECURITY;

-- No policies are created for anon/authenticated roles — service role bypasses
-- RLS entirely, and that's the only client that should ever touch these tables.
