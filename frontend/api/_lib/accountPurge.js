/**
 * accountPurge.js — handler logic for `/api/retention?action=purge-deletions`
 *
 * Closes accounts whose owner asked for deletion (profiles.deletion_requested_at,
 * set by the request_account_deletion() RPC) at least PURGE_GRACE_DAYS ago.
 * Runs daily from Vercel Cron behind the CRON_SECRET gate in retention.js.
 *
 * ── WHY A REVIEWED LIST AND NOT `delete from profiles` ─────────────────────
 * profiles.wallet_address is referenced by ~50 foreign keys (checked against the
 * live schema on 2026-10-03). Some CASCADE into records we must keep:
 *   auction_settlements.seller_wallet  ON DELETE CASCADE  (payment records)
 *   credit_transactions / reward_distributions  CASCADE    (reward ledger)
 * and some are NO ACTION and would make the delete fail outright
 * (auction_bids, moderation_flags, tide_attendees, tide_chat, tides, zones).
 * Deleting tides would also cascade into auction_bids and auction_settlements.
 *
 * So the profile row is KEPT as an anonymized closed-account marker, and every
 * table below was chosen by hand from information_schema: delete personal and
 * social data, unlink the wallet where other people's content depends on the row,
 * deactivate listings/promotions, and leave accounting records alone.
 *
 * ── SAFETY ─────────────────────────────────────────────────────────────────
 * - Idempotent: every step is a delete/update filtered by the wallet; running it
 *   twice changes nothing the second time. The profile is only marked closed
 *   (deletion_requested_at cleared, account_deleted_at set) after every step
 *   succeeded, so a failed run is retried the next day.
 * - Re-checks the request right before acting, so a cancel that lands during
 *   the run wins.
 * - Accounts with a Fish Room (showcase_*) are not closed automatically; the
 *   showcase data model (media, Mux, aliases) needs a person. They are reported
 *   as needs_manual_review on every run until handled.
 * - Accounts with money or a binding commitment in flight (PURGE_HOLDS: an open
 *   club auction they host, a lot with bids or awaiting payment/handoff, a
 *   standing high bid, an unpaid win, an open event-auction settlement) are
 *   DEFERRED: nothing is written, the request stays, the next daily run checks
 *   again. Holds are checked before any step and again before closing.
 * - Logs use a shortened wallet only, never an email.
 */

export const PURGE_GRACE_DAYS = 30;
/** Accounts that do work (purge, fail, manual review) per run. Deferred ones don't count. */
export const MAX_ACCOUNTS_PER_RUN = 10;
/** Due requests scanned per run, so deferred accounts can't starve newer ones. */
export const DUE_SCAN_LIMIT = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The reviewed purge plan. Order matters where a later step would otherwise
 * cascade or conflict: children before parents, unlinks before deletes.
 *
 *   op "delete"  remove rows where `column` matches the account
 *   op "update"  set `set` on rows where `column` matches (unlink/deactivate)
 *   op "rpc"     call the table's own server-only function `rpc` once per
 *                matching row, so its checks and side effects (stock return)
 *                run exactly as they do for the owner. `args(row, ctx)` builds
 *                the call.
 *   where        extra filters: { col: value } (eq) or { col: [a, b] } (in)
 *   stampNow     columns set to the run's timestamp alongside `set`
 *   matchBy      "wallet" (default, case-insensitive) or "email"
 */
export const PURGE_PLAN = Object.freeze([
  // ── Reef social ──────────────────────────────────────────────────────────
  { table: "reactions", column: "user_wallet", op: "delete", why: "Reef reactions" },
  { table: "comments", column: "author_wallet", op: "delete", why: "Reef comments" },
  { table: "currents", column: "author_wallet", op: "delete", why: "Reef posts (other people's comments/reactions on them cascade)" },
  { table: "species_insights", column: "author_wallet", op: "delete", why: "species insights" },
  { table: "follows", column: "follower_wallet", op: "delete", why: "follows" },
  { table: "follows", column: "target_wallet", op: "delete", why: "followers" },
  { table: "connection_requests", column: "from_wallet", op: "delete", why: "tankmate requests sent" },
  { table: "connection_requests", column: "to_wallet", op: "delete", why: "tankmate requests received" },
  { table: "messages", column: "sender_wallet", op: "delete", why: "direct messages sent" },
  { table: "conversations", column: "participant_a", op: "delete", why: "conversations (their messages cascade)" },
  { table: "conversations", column: "participant_b", op: "delete", why: "conversations (their messages cascade)" },
  { table: "sonar_notifications", column: "recipient_wallet", op: "delete", why: "notifications" },
  { table: "push_subscriptions", column: "wallet_address", op: "delete", why: "push subscriptions" },
  { table: "mentorships", column: "mentor_wallet", op: "delete", why: "mentorships" },
  { table: "mentorships", column: "mentee_wallet", op: "delete", why: "mentorships" },
  { table: "expert_audits", column: "recipient_wallet", op: "delete", why: "audits received" },
  { table: "expert_audits", column: "auditor_wallet", op: "update", set: { auditor_wallet: null }, why: "audits given stay, unlinked" },
  { table: "audit_requests", column: "requester_wallet", op: "delete", why: "audit requests made" },
  { table: "audit_requests", column: "claimed_by_wallet", op: "update", set: { claimed_by_wallet: null }, why: "unlink claimed audit requests" },
  { table: "audit_requests", column: "target_auditor_wallet", op: "update", set: { target_auditor_wallet: null }, why: "unlink targeted audit requests" },

  // ── Clubs and events ─────────────────────────────────────────────────────
  { table: "school_post_reactions", column: "wallet_address", op: "delete", why: "club post reactions" },
  { table: "school_posts", column: "author_wallet", op: "delete", why: "club posts" },
  { table: "school_posts", column: "pinned_by", op: "update", set: { pinned_by: null }, why: "unlink pins" },
  { table: "school_chat", column: "author_wallet", op: "delete", why: "club chat" },
  { table: "school_challenge_votes", column: "voter_wallet", op: "delete", why: "challenge votes" },
  { table: "school_challenge_submissions", column: "wallet_address", op: "delete", why: "challenge entries" },
  { table: "school_challenge_participants", column: "wallet_address", op: "delete", why: "challenge participation" },
  { table: "school_challenges", column: "creator_wallet", op: "update", set: { creator_wallet: null }, why: "challenges stay for the club, unlinked" },
  { table: "school_challenges", column: "finalized_by", op: "update", set: { finalized_by: null }, why: "unlink finalizer" },
  { table: "school_invites", column: "invited_wallet", op: "delete", why: "club invites received" },
  { table: "school_invites", column: "invited_by", op: "delete", why: "club invites sent" },
  { table: "school_members", column: "wallet_address", op: "delete", why: "club memberships" },
  { table: "schools", column: "founder_wallet", op: "update", set: { founder_wallet: null }, why: "clubs stay for their members, unlinked" },
  { table: "tide_chat", column: "author_wallet", op: "delete", why: "event chat" },
  { table: "tide_attendees", column: "wallet_address", op: "delete", why: "event RSVPs" },
  { table: "tide_streams", column: "host_wallet", op: "delete", why: "event stream settings" },
  // Deleting tides would cascade into auction_bids and auction_settlements.
  { table: "tides", column: "host_wallet", op: "update", set: { host_wallet: null }, why: "events stay (auction records hang off them), unlinked" },
  { table: "zones", column: "champion_wallet", op: "update", set: { champion_wallet: null }, why: "unlink zone champion" },

  // ── Activity and companion ───────────────────────────────────────────────
  { table: "xp_events", column: "wallet_address", op: "delete", why: "XP history" },
  { table: "depth_score_events", column: "wallet_address", op: "delete", why: "depth score history" },
  { table: "user_xp_profiles", column: "wallet_address", op: "delete", why: "XP profile" },
  { table: "echo_action_log", column: "wallet_address", op: "delete", why: "Echo companion log" },
  { table: "echo_push_log", column: "wallet_address", op: "delete", why: "Echo push log" },
  { table: "echo_onchain_queue", column: "wallet_address", op: "delete", why: "Echo queue" },
  { table: "echo_companion_state", column: "wallet_address", op: "delete", why: "Echo companion" },
  { table: "user_roles", column: "wallet_address", op: "delete", why: "roles" },

  // ── Synced tank data ─────────────────────────────────────────────────────
  { table: "aquadex_action_logs", column: "owner_address", op: "delete", why: "care logs" },
  { table: "aquadex_spawn_growout", column: "owner_address", op: "delete", why: "grow-out records" },
  { table: "aquadex_spawns", column: "owner_address", op: "delete", why: "spawns" },
  { table: "aquadex_specimens", column: "owner_address", op: "delete", why: "livestock" },
  { table: "aquadex_tanks", column: "owner_address", op: "delete", why: "tanks" },
  { table: "published_tanks", column: "owner_wallet", op: "delete", why: "shared tank pages" },
  { table: "tank_cams", column: "owner_wallet", op: "delete", why: "tank cams" },
  { table: "wanted_listings", column: "wallet_address", op: "delete", why: "wanted posts" },

  // ── Shopping (not accounting) ────────────────────────────────────────────
  { table: "order_watchlist", column: "wallet_address", op: "delete", why: "order watchlist" },
  { table: "canonical_cart_merge_operations", column: "wallet_address", op: "delete", why: "cart merge history" },
  { table: "canonical_carts", column: "wallet_address", op: "delete", why: "carts" },
  { table: "buyer_payment_methods", column: "wallet_address", op: "delete", why: "saved payment method reference" },
  { table: "marketplace_reviews", column: "buyer_wallet", op: "delete", why: "reviews written" },
  { table: "species_suggestion_votes", column: "voter_wallet", op: "delete", why: "catalog votes" },
  { table: "species_profiles", column: "created_by", op: "update", set: { created_by: null }, why: "catalog entries stay, unlinked" },
  { table: "species_strains", column: "created_by", op: "update", set: { created_by: null }, why: "strains stay, unlinked" },

  // ── Open offers and unbid auction lots ───────────────────────────────────
  // Rows are kept (the counterparty's record); only open ones change status so
  // the other person sees an honest state. marketplace_offers.status has no
  // check constraint; the values are the ones in 20260701_marketplace_offers.sql.
  // Accepted/declined/expired/withdrawn offers are left as they are.
  {
    table: "marketplace_offers", column: "buyer_wallet", op: "update",
    where: { status: ["pending", "countered"] }, set: { status: "withdrawn" },
    why: "open offers the account made, withdrawn",
  },
  {
    table: "marketplace_offers", column: "seller_wallet", op: "update",
    where: { status: ["pending", "countered"] }, set: { status: "declined" }, stampNow: ["responded_at"],
    why: "open offers the account received, declined",
  },
  // Only lots nobody has bid on (PURGE_HOLDS defers the rest). cancel_auction_lot
  // (20260929_auctions_v2.sql) re-checks status and bid_count under a row lock,
  // sets status 'cancelled' + closed_at, and returns batch stock to the listing.
  // Must run BEFORE aquadex_listings below: returning stock switches the listing
  // back on, and the listings step then switches it off again.
  {
    table: "auction_lots", column: "seller_wallet", op: "rpc", rpc: "cancel_auction_lot",
    where: { status: ["live", "pending_approval"], bid_count: 0 },
    args: (row, ctx) => ({ p_lot: row.id, p_seller: ctx.wallet.toLowerCase() }),
    why: "auction lots with no bids, cancelled (stock returns to the listing)",
  },

  // ── Selling ──────────────────────────────────────────────────────────────
  { table: "aquadex_listings", column: "seller_address", op: "update", set: { is_active: false }, why: "listings switched off (orders reference them)" },
  // Deleting promotions would cascade into promotion_redemptions (order discounts).
  { table: "seller_promotions", column: "wallet_address", op: "update", set: { active: false }, why: "promotions switched off" },
  { table: "store_sections", column: "wallet_address", op: "delete", why: "store sections" },
  { table: "pickup_locations", column: "wallet_address", op: "delete", why: "pickup spots (arrangements keep, unlinked)" },
  { table: "seller_parcel_presets", column: "wallet_address", op: "delete", why: "parcel presets" },
  { table: "seller_ship_from", column: "wallet_address", op: "delete", why: "ship-from address" },
  { table: "seller_events", column: "seller_wallet", op: "delete", why: "booth events" },
  { table: "booth_staff", column: "seller_wallet", op: "delete", why: "booth staff" },
  { table: "booth_staff", column: "staff_wallet", op: "delete", why: "booth staff roles" },
  { table: "booth_staff_invites", column: "seller_wallet", op: "delete", why: "booth invites" },
  { table: "booth_staff_invites", column: "used_by_wallet", op: "update", set: { used_by_wallet: null }, why: "unlink used invites" },
  { table: "breeder_profiles", column: "wallet_address", op: "delete", why: "storefront page (breeder_stats cascade)" },
  { table: "seller_stripe_accounts", column: "wallet_address", op: "update", set: { email: null }, why: "payout account kept for refunds/disputes, email removed" },
  { table: "service_clients", column: "pro_wallet", op: "delete", why: "service pro client book (sites/tanks/visits cascade)" },

  // ── Developer ────────────────────────────────────────────────────────────
  { table: "api_keys", column: "owner_email", op: "delete", matchBy: "email", why: "developer API keys (request log keeps, unlinked)" },
]);

/**
 * Money or a binding commitment in flight. Any matching row DEFERS the account:
 * nothing is written and the next daily run checks again. Checked before the
 * plan runs and again right before the profile is closed.
 *
 *   where   { col: value } (eq) or { col: [a, b] } (in)
 *   gt      { col: n } rows where col > n
 *   when    optional row predicate for what PostgREST can't filter simply
 *
 * Why defer instead of acting:
 * - auction_lot_bids is append-only and has no withdraw function; the standing
 *   high bid (auction_lots.high_bidder_wallet) is charged automatically on win,
 *   and cancel_auction_lot refuses a lot with bids. Outbid bids carry no
 *   obligation (a forfeit never promotes the runner-up, AUCTIONS_SPEC §3), so
 *   they need nothing.
 * - Winning and selling need the account: the charge sweep uses the winner's
 *   saved card (buyer_payment_methods, removed by the plan) and pays the seller
 *   (seller_wallet / club host_wallet via seller_stripe_accounts).
 * - Event ("Tide") auctions are retired (api/stripe.js auction-charge is 410)
 *   but their tables remain. 'withdrawn' is allowed on auction_bids yet nothing
 *   sets it, and settle_tide_auction only reads 'active' bids, so pulling the
 *   top bid would not reinstate the runner-up. Defer instead.
 */
export const PURGE_HOLDS = Object.freeze([
  {
    table: "auctions", column: "host_wallet", select: "id",
    where: { host_type: "club", status: ["draft", "live"] },
    reason: "hosts an open club auction (desk card payouts go to the host's payout account)",
  },
  {
    table: "auction_lots", column: "seller_wallet", select: "id",
    where: { status: ["awaiting_live", "sold_live", "ended", "charging", "payment_failed", "paid"] },
    reason: "sells an auction lot that is sold or in the room, with payment or handoff not finished",
  },
  {
    table: "auction_lots", column: "seller_wallet", select: "id",
    where: { status: "live" }, gt: { bid_count: 0 },
    reason: "sells a live auction lot that has bids (the high bid is binding)",
  },
  {
    table: "auction_lots", column: "high_bidder_wallet", select: "id",
    where: { status: ["live", "awaiting_live"] },
    reason: "holds the standing high bid on an open auction lot (bids cannot be withdrawn)",
  },
  {
    table: "auction_lots", column: "winner_wallet", select: "id",
    where: { status: ["ended", "charging", "payment_failed", "sold_live", "paid"] },
    reason: "won an auction lot whose payment or handoff is not finished",
  },
  {
    table: "auction_settlements", column: "winner_wallet", select: "id",
    where: { status: ["awaiting_payment", "payment_failed"] },
    reason: "won an event auction lot that is awaiting payment",
  },
  {
    table: "auction_settlements", column: "seller_wallet", select: "id",
    where: { status: ["awaiting_payment", "payment_failed", "paid"] },
    reason: "sold an event auction lot whose payment or payout is not finished",
  },
  {
    table: "auction_bids", column: "bidder_wallet", select: "id",
    where: { status: "active" },
    reason: "holds an active bid in an event auction (bids cannot be withdrawn)",
  },
  {
    // The plan unlinks tides.host_wallet, and settle_tide_auction needs the host.
    table: "tides", column: "host_wallet", select: "id, settings",
    where: { status: ["upcoming", "live"] },
    when: (row) => Array.isArray(row?.settings?.auction_items) && row.settings.auction_items.length > 0,
    reason: "hosts an open event with auction lots",
  },
]);

/**
 * Records deliberately left in place. Reported in every run summary so the
 * retention decision is visible, and mirrored in the Settings copy.
 */
export const PURGE_KEPT = Object.freeze([
  "orders (incl. buyer_email: guest order view and dispute contact read it)",
  "canonical_orders, canonical_order_line_items, canonical_order_ledger, canonical_order_transitions",
  "fiat_settlements (incl. buyer_email)",
  "canonical_doa_claims, pickup_arrangements, shipping_label_purchases, inventory_sale_events, promotion_redemptions",
  "auctions, auction_lots, auction_bids, auction_lot_bids, auction_bidders, auction_settlements, auction_desk_payments (unbid lots cancelled, never deleted)",
  "marketplace_offers (open ones withdrawn or declined, never deleted)",
  "seller_stripe_accounts (row kept, email cleared)",
  "credit_transactions, reward_distributions, reward_pool_ledger",
  "moderation_flags, review_reports, and the profile's ban/mute fields",
  "species_suggestions, morph_submissions (submitter columns are NOT NULL)",
  "profiles row as an anonymized closed-account marker (wallet_address is the FK target of the records above)",
]);

/** Profile fields reset when the account is closed. */
export function tombstoneFields(nowIso) {
  return {
    display_name: null,
    avatar_url: null,
    bio: null,
    email: null,
    notification_preferences: { retentionEmail: false, emailDigest: "off" },
    privacy_settings: { tanks: "private", activity: "private" },
    poseidon_summary: null,
    accepting_mentees: false,
    onboarding_complete: false,
    tank_count: 0,
    species_count: 0,
    xp_total: 0,
    total_xp: 0,
    monthly_xp: 0,
    streak_days: 0,
    last_active_date: null,
    depth_score: 0,
    depth_tier: "Shallow",
    companion_tier: "Shallow",
    current_tier: "Shallow",
    zone_hash: null,
    zone_assigned_at: null,
    zone_transfer_cooldown: null,
    deletion_requested_at: null,
    account_deleted_at: nowIso,
    updated_at: nowIso,
  };
}

/** Storage prefixes the app writes per account (see mediaUpload/photoUpload/specimenMetadata). */
export function storageTargets(storedWallet) {
  const lower = storedWallet.toLowerCase();
  const reefPrefixes = [...new Set([storedWallet.slice(0, 10), lower.slice(0, 10)])];
  return [
    ...reefPrefixes.map((p) => ({ bucket: "reef-media", prefix: `reef/${p}`, sharedPrefix: lower.slice(0, 10) })),
    { bucket: "specimen-photos", prefix: lower.slice(0, 10), sharedPrefix: lower.slice(0, 10) },
    { bucket: "specimen-metadata", prefix: lower, sharedPrefix: null },
  ];
}

export function shortWallet(wallet) {
  const w = String(wallet || "");
  return w.length > 10 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w;
}

/** Escape LIKE metacharacters so ilike is a case-insensitive equality. */
export function likeExact(value) {
  return String(value).replace(/[\\%_]/g, (c) => `\\${c}`);
}

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205", "PGRST200"]);

/** Apply `where` ({ col: value } eq, { col: [..] } in) and `gt` filters. */
function applyFilters(query, where, gt) {
  let q = query;
  for (const [col, v] of Object.entries(where || {})) q = Array.isArray(v) ? q.in(col, v) : q.eq(col, v);
  for (const [col, v] of Object.entries(gt || {})) q = q.gt(col, v);
  return q;
}

async function runRpcStep(supabase, step, ctx, base) {
  const { data: rows, error } = await applyFilters(
    supabase.from(step.table).select("id").ilike(step.column, likeExact(ctx.wallet)),
    step.where
  );
  if (error) {
    if (MISSING_TABLE_CODES.has(error.code)) return { ...base, count: 0, skipped: "table missing" };
    return { ...base, error: error.message || String(error) };
  }
  let count = 0;
  for (const row of rows || []) {
    const { error: rpcError } = await supabase.rpc(step.rpc, step.args(row, ctx));
    // The function re-checks under a row lock; a refusal (e.g. a bid landed)
    // fails the step, and the next run defers the account through PURGE_HOLDS.
    if (rpcError) return { ...base, count, error: `${step.rpc}(${row.id}): ${rpcError.message || String(rpcError)}` };
    count++;
  }
  return { ...base, count };
}

async function runStep(supabase, step, ctx) {
  const base = { table: step.table, column: step.column, op: step.op };
  const value = step.matchBy === "email" ? ctx.email : ctx.wallet;
  if (!value) return { ...base, count: 0, skipped: "no value" };
  if (step.matchBy === "email" && String(value).includes("*")) {
    return { ...base, count: 0, skipped: "unmatchable email" };
  }
  if (step.op === "rpc") return runRpcStep(supabase, step, ctx, base);

  let query = supabase.from(step.table);
  if (step.op === "delete") {
    query = query.delete({ count: "exact" });
  } else {
    const values = { ...step.set };
    for (const col of step.stampNow || []) values[col] = ctx.nowIso;
    query = query.update(values, { count: "exact" });
  }
  const { error, count } = await applyFilters(query.ilike(step.column, likeExact(value)), step.where);

  if (error) {
    if (MISSING_TABLE_CODES.has(error.code)) return { ...base, count: 0, skipped: "table missing" };
    return { ...base, error: error.message || String(error) };
  }
  return { ...base, count: count ?? 0 };
}

/**
 * Evaluate PURGE_HOLDS for one wallet. Returns { holds: [reason], errors: [msg] }.
 * A missing table is not a hold (the feature isn't deployed there).
 */
export async function findHolds(supabase, wallet) {
  const holds = [];
  const errors = [];
  for (const hold of PURGE_HOLDS) {
    const { data, error } = await applyFilters(
      supabase.from(hold.table).select(hold.select || "id").ilike(hold.column, likeExact(wallet)),
      hold.where,
      hold.gt
    ).limit(hold.when ? 50 : 1);
    if (error) {
      if (!MISSING_TABLE_CODES.has(error.code)) errors.push(`hold check ${hold.table}.${hold.column}: ${error.message || String(error)}`);
      continue;
    }
    const rows = hold.when ? (data || []).filter(hold.when) : data || [];
    if (rows.length > 0) holds.push(`${hold.table}.${hold.column}: ${hold.reason}`);
  }
  return { holds, errors };
}

async function purgeStorage(supabase, target, storedWallet) {
  // A 10-character folder ("0x" + 8 hex) could in theory be shared by two
  // accounts. Never delete a folder another profile might also own.
  if (target.sharedPrefix) {
    const { data: owners, error } = await supabase
      .from("profiles")
      .select("wallet_address")
      .ilike("wallet_address", `${likeExact(target.sharedPrefix)}%`)
      .limit(2);
    if (error) return { ...target, error: error.message };
    const others = (owners || []).filter((o) => String(o.wallet_address).toLowerCase() !== storedWallet.toLowerCase());
    if (others.length > 0) return { bucket: target.bucket, prefix: target.prefix, removed: 0, skipped: "folder prefix shared with another profile" };
  }

  const bucket = supabase.storage.from(target.bucket);
  let removed = 0;
  // list() is paged; files are removed as we go, so always re-list from the top.
  for (let round = 0; round < 50; round++) {
    const { data: entries, error } = await bucket.list(target.prefix, { limit: 100 });
    if (error) return { bucket: target.bucket, prefix: target.prefix, removed, error: error.message };
    const files = (entries || []).filter((e) => e && e.id && e.name);
    if (files.length === 0) break;
    const { error: removeError } = await bucket.remove(files.map((f) => `${target.prefix}/${f.name}`));
    if (removeError) return { bucket: target.bucket, prefix: target.prefix, removed, error: removeError.message };
    removed += files.length;
    if (files.length < 100) break;
  }
  return { bucket: target.bucket, prefix: target.prefix, removed };
}

/**
 * Purge one account. Returns a per-account summary; never throws for a step
 * failure (the error is recorded and the account is left for the next run).
 */
export async function purgeAccount(supabase, profile, { now = new Date() } = {}) {
  const storedWallet = String(profile.wallet_address || "");
  const summary = { wallet: shortWallet(storedWallet), status: "failed", steps: [], storage: [], errors: [], manual: [] };

  if (!WALLET_RE.test(storedWallet)) {
    summary.errors.push("wallet_address is not a 0x address; skipped");
    return summary;
  }

  const cutoffMs = now.getTime() - PURGE_GRACE_DAYS * DAY_MS;

  // Re-read right before acting: a cancel during the run wins.
  const { data: fresh, error: freshError } = await supabase
    .from("profiles")
    .select("wallet_address, email, deletion_requested_at")
    .eq("wallet_address", storedWallet)
    .maybeSingle();
  if (freshError) {
    summary.errors.push(`profile re-read: ${freshError.message}`);
    return summary;
  }
  if (!fresh?.deletion_requested_at || new Date(fresh.deletion_requested_at).getTime() > cutoffMs) {
    summary.status = "skipped_not_due";
    return summary;
  }

  // Fish Room data needs a person (media, Mux, aliases). Report, do not close.
  const { data: showcaseOwners, error: showcaseError } = await supabase
    .from("showcase_owner_wallets")
    .select("owner_id")
    .eq("normalized_wallet_address", storedWallet.toLowerCase())
    .limit(1);
  if (showcaseError && !MISSING_TABLE_CODES.has(showcaseError.code)) {
    summary.errors.push(`showcase check: ${showcaseError.message}`);
  } else if ((showcaseOwners || []).length > 0) {
    summary.manual.push("showcase (Fish Room) data: remove by hand, then this account closes on the next run");
  }

  // Money or a binding commitment in flight: touch nothing, retry tomorrow.
  const before = await findHolds(supabase, storedWallet);
  if (before.errors.length > 0) {
    summary.errors.push(...before.errors);
    return summary;
  }
  if (before.holds.length > 0) {
    summary.status = "deferred";
    summary.deferred = before.holds;
    return summary;
  }

  const nowIso = now.toISOString();
  const ctx = { wallet: storedWallet, email: fresh.email || null, nowIso };
  for (const step of PURGE_PLAN) {
    const result = await runStep(supabase, step, ctx);
    summary.steps.push(result);
    if (result.error) summary.errors.push(`${step.table}.${step.column}: ${result.error}`);
  }

  for (const target of storageTargets(storedWallet)) {
    const result = await purgeStorage(supabase, target, storedWallet);
    summary.storage.push(result);
    if (result.error) summary.errors.push(`storage ${target.bucket}/${target.prefix}: ${result.error}`);
  }

  if (summary.errors.length > 0) return summary;

  // The account works until it is closed; a bid or win during the run means the
  // account stays open. Steps above are idempotent, so tomorrow simply resumes.
  const after = await findHolds(supabase, storedWallet);
  if (after.errors.length > 0) {
    summary.errors.push(...after.errors);
    return summary;
  }
  if (after.holds.length > 0) {
    summary.status = "deferred";
    summary.deferred = after.holds;
    return summary;
  }

  if (summary.manual.length > 0) {
    summary.status = "needs_manual_review";
    return summary;
  }

  const { error: closeError } = await supabase
    .from("profiles")
    .update(tombstoneFields(nowIso))
    .eq("wallet_address", storedWallet);
  if (closeError) {
    summary.errors.push(`close profile: ${closeError.message}`);
    return summary;
  }

  summary.status = "purged";
  return summary;
}

/**
 * Find and purge every account whose request is at least PURGE_GRACE_DAYS old.
 *
 * @param {object} supabase - service-role client
 * @param {{ now?: Date, maxAccounts?: number, log?: { info: Function, error: Function } }} [options]
 */
export async function purgeDueAccounts(supabase, { now = new Date(), maxAccounts = MAX_ACCOUNTS_PER_RUN, log = console } = {}) {
  const cutoffIso = new Date(now.getTime() - PURGE_GRACE_DAYS * DAY_MS).toISOString();
  const result = {
    action: "purge-deletions", cutoff: cutoffIso, due: 0, purged: 0, needsManualReview: 0, deferred: 0,
    failed: 0, skipped: 0, accounts: [], kept: PURGE_KEPT,
  };

  // Scan past the per-run cap: deferred accounts are cheap (reads only) and
  // must not block newer requests behind them.
  const { data: due, error } = await supabase
    .from("profiles")
    .select("wallet_address, deletion_requested_at")
    .not("deletion_requested_at", "is", null)
    .lte("deletion_requested_at", cutoffIso)
    .order("deletion_requested_at", { ascending: true })
    .limit(Math.max(maxAccounts, DUE_SCAN_LIMIT));

  if (error) {
    result.error = `due query failed: ${error.message}`;
    log.error?.("[purge-deletions]", result.error);
    return result;
  }

  result.due = (due || []).length;
  let worked = 0;
  for (const profile of due || []) {
    if (worked >= maxAccounts) break;
    const summary = await purgeAccount(supabase, profile, { now });
    result.accounts.push({
      wallet: summary.wallet,
      status: summary.status,
      rowsDeleted: summary.steps.filter((s) => s.op === "delete").reduce((n, s) => n + (s.count || 0), 0),
      rowsUpdated: summary.steps.filter((s) => s.op !== "delete").reduce((n, s) => n + (s.count || 0), 0),
      filesRemoved: summary.storage.reduce((n, s) => n + (s.removed || 0), 0),
      byTable: summary.steps.filter((s) => s.count > 0).map((s) => `${s.op} ${s.table}.${s.column}: ${s.count}`),
      deferred: summary.deferred || [],
      manual: summary.manual,
      errors: summary.errors,
    });
    if (summary.status === "purged") result.purged++;
    else if (summary.status === "needs_manual_review") result.needsManualReview++;
    else if (summary.status === "deferred") result.deferred++;
    else if (summary.status === "skipped_not_due") result.skipped++;
    else result.failed++;
    if (summary.status !== "deferred" && summary.status !== "skipped_not_due") worked++;
  }

  log.info?.(
    `[purge-deletions] cutoff=${cutoffIso} due=${result.due} purged=${result.purged} ` +
      `manual=${result.needsManualReview} deferred=${result.deferred} failed=${result.failed} skipped=${result.skipped}`,
    JSON.stringify(result.accounts)
  );
  return result;
}
