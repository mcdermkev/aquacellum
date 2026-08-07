/**
 * liveEvents.js — feature flags for the live-event (Tides) layer.
 *
 * TIDE_VIDEO_ENABLED: Mux livestreaming for Virtual Tides. Intentionally OFF for
 * launch — Virtual Tides run as live *gatherings* (real-time chat, presence, and
 * reactions), which needs no external service and no ongoing streaming cost.
 *
 * Flip to true only after:
 *   1. A Mux account is configured (MUX_TOKEN_ID/SECRET/WEBHOOK_SECRET in Vercel),
 *   2. the stream-setup endpoint is restored — fold it into api/mux.js as another
 *      ?action= so it respects the Vercel function cap (see frontend/_shelved-api/
 *      tide-stream-setup.js), and
 *   3. the tide_streams stream_key column stays protected (see migration
 *      20260809_tide_stream_key_hardening.sql).
 */
export const TIDE_VIDEO_ENABLED = false;
