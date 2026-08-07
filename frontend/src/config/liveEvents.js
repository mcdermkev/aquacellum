/**
 * liveEvents.js — feature flags for the live-event / expo layer.
 *
 * See docs/DEFERRED_AND_GATED.md for the full registry of what's gated and what
 * each flag needs before it can be turned on.
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

/**
 * EXPO_ANALYTICS_ENABLED: the Marketplace "Event Sales & Inventory Analytics"
 * panel. Intentionally OFF for launch because its data is fabricated/theatrical:
 *   - "Inventory Velocity Meters" are hardcoded constants (Neon Tetra 50, etc.),
 *     so it shows "50 Sold · High Velocity" for species nobody has sold.
 *   - "Fulfillment Splits" reads per-device localStorage, and the digital-order
 *     counter has no writer (always 0), so it isn't a real business metric.
 *   - "Double XP Telemetry" claims a +2x boost is always active; the REAL boost
 *     is server-gated to a live expo event (validate-xp), so this misrepresents it.
 *
 * To turn on, rebuild it on real data: velocity from the orders table, the split
 * from settled orders server-side, and the boost card gated on an actual live
 * expo Tide. See docs/DEFERRED_AND_GATED.md.
 */
export const EXPO_ANALYTICS_ENABLED = false;
