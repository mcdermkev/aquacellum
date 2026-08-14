/**
 * appGuide.js — the app's own capability manifest, and a local matcher over it.
 *
 * Phase 1 of making Poseidon an expert on Aquacellum itself (see the design
 * discussion in this module's tests for the drift guards). Answers "where do I
 * do X?" from structured data instead of from the model's imagination.
 *
 * ── WHY THIS IS DATA AND NOT PROMPT PROSE ───────────────────────────────────
 *
 * The obvious approach is to paste docs/APP_FEATURE_MAP.md into
 * POSEIDON_SYSTEM_PROMPT. This codebase has already been bitten twice by exactly
 * that kind of hand-maintained duplication:
 *
 *   - The prompt advertises five actions; `poseidonBridge.js` implements two.
 *     QUERY_COMPATIBILITY, SUGGEST_SPECIES and LOG_WATER_PARAMS still render a
 *     "Poseidon wants to…" confirm bar that does nothing when you accept it.
 *   - The server rate limit is 30/hr while the UI copy still says 20.
 *
 * So the destinations live here as data, and `appGuide.test.js` asserts every
 * `tab` against `VALID_TABS` and every `section` against the real section lists
 * in BreederTools / BreederTerminal / the Settings sections. If someone renames a
 * tab or retires a section, the test fails instead of Poseidon confidently
 * sending a keeper somewhere that no longer exists.
 *
 * ── WHY THE MATCHER IS LOCAL ────────────────────────────────────────────────
 *
 * "Where do I log a water test?" should never cost an LLM call. Poseidon has a
 * 30/hr budget and, when the gateway is unreachable, exactly one canned sentence
 * ("I can't reach my knowledge base right now") — there is no local reasoning
 * fallback. A keyword/fuzzy match over this manifest works offline, costs
 * nothing, and answers instantly. The model is for the genuinely open-ended
 * questions.
 *
 * ── HONESTY MARKERS ARE PART OF THE DATA ────────────────────────────────────
 *
 * Retired and gated surfaces are listed ON PURPOSE, carrying their real status,
 * so the assistant can say "Tank Cam was retired" or "saved searches unlock
 * later" instead of either inventing the feature or drawing a blank. This mirrors
 * the (live)/(gated)/(not live)/(removed) markers in docs/APP_FEATURE_MAP.md,
 * which is the human-readable source this was derived from.
 *
 * User-facing strings here are checked against `PROHIBITED_TERMS`
 * (services/orderCopy.js) by the test, so Web3 vocabulary can't leak into an
 * answer a hobbyist reads.
 */

/** What state a destination is actually in. Mirrors the feature map's markers. */
export const GUIDE_STATUS = Object.freeze({
  LIVE: "live",             // shipped and wired
  GATED: "gated",           // real capability behind an entitlement/allowlist
  NOT_ENFORCED: "notEnforced", // present in UI/copy, the perk isn't applied yet
  REMOVED: "removed",       // retired; say so rather than pretending
});

/**
 * Which UI mode surfaces a destination.
 *
 * IMPORTANT (services/entitlements.js): Casual vs Pro is a self-service DISPLAY
 * PREFERENCE, never an entitlement — "Casual mode hides the Breeder Tools tab; it
 * does not withhold a capability." So `mode: "pro"` means "offer the toggle",
 * NOT "tell them they can't". Only GUIDE_STATUS.GATED is a real gate.
 */
export const GUIDE_MODE = Object.freeze({ BOTH: "both", PRO: "pro", CASUAL: "casual" });

const { LIVE, GATED, NOT_ENFORCED, REMOVED } = GUIDE_STATUS;
const { BOTH, PRO, CASUAL } = GUIDE_MODE;

/**
 * Every addressable destination, keyed by a stable id.
 *
 * `tab` must be in VALID_TABS. `section` must be a real section of that tab
 * (Breeder Tools `?section=`, Breeder Terminal's SECTIONS, or a Settings
 * `#settings/<id>` anchor). Both are asserted by the test.
 */
export const APP_GUIDE = Object.freeze([
  // ── My Aquariums / Aquariums (tanks) ──────────────────────────────────────
  { id: "add-tank", tab: "tanks", label: { casual: "My Aquariums", pro: "Aquariums" }, mode: BOTH, status: LIVE,
    what: "Add an aquarium and start tracking it.",
    keywords: ["add a tank", "new tank", "create a tank", "set up an aquarium", "register a unit", "first tank"] },
  { id: "log-water-test", tab: "tanks", label: { casual: "My Aquariums", pro: "Aquariums" }, mode: BOTH, status: LIVE,
    what: "Log a water test — temperature, pH, ammonia, nitrite and nitrate — from Quick Log or a tank's Log Care / Actions menu.",
    keywords: ["water test", "test my water", "log parameters", "ph", "ammonia", "nitrite", "nitrate", "quick test", "test results"] },
  { id: "log-care", tab: "tanks", label: { casual: "My Aquariums", pro: "Aquariums" }, mode: BOTH, status: LIVE,
    what: "Log a care action — feeding, water change, algae scrape — from the Log Care / Actions menu.",
    keywords: ["log a feeding", "fed my fish", "water change", "clean the glass", "algae", "care log", "log care"] },
  { id: "bulk-log", tab: "tanks", label: { casual: "My Aquariums", pro: "Aquariums" }, mode: BOTH, status: LIVE,
    what: "Log the same action across a whole rack or room at once, with saved templates.",
    keywords: ["bulk log", "log many tanks", "whole rack", "entire room", "batch log", "saved template", "log everything"] },
  { id: "add-fish", tab: "tanks", label: { casual: "My Aquariums", pro: "Aquariums" }, mode: BOTH, status: LIVE,
    what: "Add fish to a tank from the tank's Add Fish drawer.",
    keywords: ["add fish", "put fish in a tank", "add a specimen", "stock a tank", "new fish"] },
  { id: "facility-tree", tab: "tanks", label: { casual: "My Aquariums", pro: "Aquariums" }, mode: BOTH, status: LIVE,
    what: "See your fishroom as Facility → Room → Rack → Unit in the Facility Tree view.",
    keywords: ["facility tree", "rooms and racks", "hierarchy", "fishroom layout", "tree view"] },
  { id: "add-rack", tab: "tanks", label: { casual: "My Aquariums", pro: "Aquariums" }, mode: PRO, status: LIVE,
    what: "Stamp out a whole rack of identical units in one go with Add a Rack, in the Facility Tree view.",
    keywords: ["add a rack", "many tanks at once", "lots of tanks", "bulk create tanks", "10 tanks", "set up a rack"] },
  { id: "import-tanks", tab: "tanks", label: { casual: "My Aquariums", pro: "Aquariums" }, mode: PRO, status: LIVE,
    what: "Paste or upload a spreadsheet of tanks with Import Tanks, in the Facility Tree view.",
    keywords: ["import tanks", "csv of tanks", "spreadsheet", "bring my tanks over", "move my fishroom in"] },
  { id: "import-livestock", tab: "tanks", label: { casual: "My Aquariums", pro: "Aquariums" }, mode: PRO, status: LIVE,
    what: "Paste or upload a fish list with Import Livestock, in the Facility Tree view.",
    keywords: ["import fish", "import livestock", "csv of fish", "bulk add fish", "my fish list"] },
  { id: "tank-qr", tab: "tanks", label: { casual: "My Aquariums", pro: "Aquariums" }, mode: BOTH, status: LIVE,
    what: "Scan a tank's QR code to jump straight to it, or print QR labels for your tanks.",
    keywords: ["qr code", "scan a tank", "print labels", "tank label"] },
  { id: "tank-journal", tab: "tanks", label: { casual: "My Aquariums", pro: "Aquariums" }, mode: BOTH, status: LIVE,
    what: "Review a tank's past readings, care history and photo timeline in its Journal / History tab.",
    keywords: ["history", "journal", "past readings", "photo timeline", "what did i log", "previous tests"] },
  { id: "care-coach", tab: "tanks", label: { casual: "My Aquariums", pro: "Aquariums" }, mode: BOTH, status: LIVE,
    what: "See what needs attention and why, and set care schedules, in a tank's Care Coach.",
    keywords: ["what needs attention", "care coach", "due", "overdue", "reminders", "schedule", "what should i do"] },
  { id: "fry-nursery", tab: "tanks", label: { casual: "My Aquariums", pro: "Aquariums" }, mode: BOTH, status: LIVE,
    what: "Triage fry and unassigned fish in the Fry Nursery.",
    keywords: ["nursery", "fry", "babies", "unassigned fish"] },
  { id: "share-to-reef", tab: "tanks", label: { casual: "My Aquariums", pro: "Aquariums" }, mode: BOTH, status: LIVE,
    what: "Share a tank update to the community with the Share button on a tank.",
    keywords: ["share my tank", "post my tank", "show off my tank"] },

  // ── Fish Finder / Breed Gallery (gallery) ─────────────────────────────────
  { id: "find-species", tab: "gallery", label: { casual: "Fish Finder", pro: "Breed Gallery" }, mode: BOTH, status: LIVE,
    what: "Search the freshwater species catalog and open a species' care details.",
    keywords: ["find a fish", "look up a species", "browse fish", "species catalog", "search for a fish", "care requirements"] },
  { id: "compatibility", tab: "gallery", label: { casual: "Fish Finder", pro: "Breed Gallery" }, mode: BOTH, status: LIVE,
    what: "Check whether a species suits a tank. It scores water parameters, tank size and stocking level — it does not judge fish-vs-fish temperament.",
    keywords: ["compatible", "compatibility", "will they get along", "tankmates", "can i keep", "good match", "suitable"] },
  { id: "my-dex", tab: "gallery", label: { casual: "Fish Finder", pro: "Breed Gallery" }, mode: CASUAL, status: LIVE,
    what: "Track the species you keep and want in your personal dex and wishlist.",
    keywords: ["my dex", "collected species", "wishlist", "species i keep"] },
  { id: "watchlist", tab: "gallery", label: { casual: "Fish Finder", pro: "Breed Gallery" }, mode: BOTH, status: GATED,
    what: "Save searches and watch species for new listings.",
    note: "Unlocks with activity rather than being available from day one.",
    keywords: ["watchlist", "saved search", "notify me", "alert me when available"] },

  // ── Breeder Tools (breeder) — Pro surface, sections via ?section= ─────────
  { id: "register-certificate", tab: "breeder", section: "register", label: { casual: "Breeder Tools", pro: "Breeder Tools" }, mode: PRO, status: LIVE,
    what: "Register a fish and create its birth certificate.",
    keywords: ["register a fish", "birth certificate", "create a record", "certificate for a fish"] },
  { id: "breeding-program", tab: "breeder", section: "program", label: { casual: "Breeder Tools", pro: "Breeder Tools" }, mode: PRO, status: LIVE,
    what: "Declare the lines you keep — each becomes a tank plus a certificate for every fish in it.",
    keywords: ["breeding program", "my lines", "declare my pairs", "my breeding stock", "set up my program", "moving my fishroom"] },
  { id: "lineage", tab: "breeder", section: "lineage", label: { casual: "Breeder Tools", pro: "Breeder Tools" }, mode: PRO, status: LIVE,
    what: "View a fish's ancestry and its multi-generation pedigree tree.",
    keywords: ["lineage", "pedigree", "family tree", "ancestors", "parents of this fish", "who bred this"] },
  { id: "spawning", tab: "breeder", section: "spawning", label: { casual: "Breeder Tools", pro: "Breeder Tools" }, mode: PRO, status: LIVE,
    what: "Record a spawn with the Spawning Wizard: pick the pair, the tank, genetic markers, then how many offspring to register.",
    keywords: ["log a spawn", "spawning", "breeding", "bred my fish", "pair my fish", "eggs", "they spawned"] },
  { id: "genetics-coi", tab: "breeder", section: "genetics", label: { casual: "Breeder Tools", pro: "Breeder Tools" }, mode: PRO, status: LIVE,
    what: "Predict traits and calculate an inbreeding coefficient with risk bands before you pair.",
    keywords: ["coi", "inbreeding", "how related are they", "genetics", "traits", "risk of inbreeding"] },
  { id: "growout", tab: "breeder", section: "growout", label: { casual: "Breeder Tools", pro: "Breeder Tools" }, mode: PRO, status: LIVE,
    what: "Track a batch from eggs to fry to survivors: headcounts, losses, culls, sales and survival rate.",
    keywords: ["grow out", "fry count", "survival rate", "how many survived", "cohort", "losses", "culls", "yield"] },
  { id: "growout-tank", tab: "breeder", section: "growout", label: { casual: "Breeder Tools", pro: "Breeder Tools" }, mode: PRO, status: LIVE,
    what: "Create a batch's grow-out tank and move the batch into it from its grow-out tracker.",
    keywords: ["grow-out tank", "move the fry", "where do the fry go", "tank for a batch"] },
  { id: "promote-keepers", tab: "breeder", section: "growout", label: { casual: "Breeder Tools", pro: "Breeder Tools" }, mode: PRO, status: LIVE,
    what: "Promote keepers out of a batch into individually tracked fish with their own certificates.",
    keywords: ["promote keepers", "pull out the best", "individual certificates from a batch", "keepers"] },
  { id: "morphs", tab: "breeder", section: "morphs", label: { casual: "Breeder Tools", pro: "Breeder Tools" }, mode: PRO, status: LIVE,
    what: "Submit a morph or variant for verification.",
    keywords: ["morph", "variant", "new strain", "verify a morph"] },
  { id: "breeder-achievements", tab: "breeder", section: "achievements", label: { casual: "Breeder Tools", pro: "Breeder Tools" }, mode: PRO, status: LIVE,
    what: "See your breeding achievements.",
    keywords: ["achievements", "badges", "milestones"] },

  // ── Breeder Store / Marketplace (directory) ───────────────────────────────
  { id: "browse-listings", tab: "directory", label: { casual: "Breeder Store", pro: "Marketplace" }, mode: BOTH, status: LIVE,
    what: "Browse and buy fish, with search, filters and seller pages.",
    keywords: ["buy fish", "marketplace", "listings", "for sale", "shop", "where can i buy"] },
  { id: "wanted-board", tab: "directory", label: { casual: "Breeder Store", pro: "Marketplace" }, mode: BOTH, status: LIVE,
    what: "Post what you're looking for, or answer someone else's request, on the Wanted board.",
    keywords: ["wanted", "looking for", "request a fish", "in search of"] },
  { id: "list-for-sale", tab: "directory", label: { casual: "Breeder Store", pro: "Marketplace" }, mode: BOTH, status: LIVE,
    what: "List a fish for sale, or edit a listing you already have.",
    keywords: ["sell a fish", "list my fish", "create a listing", "put up for sale", "price my fish"] },

  // ── My Orders (orders) — buyer side ───────────────────────────────────────
  { id: "track-orders", tab: "orders", label: { casual: "My Orders", pro: "My Orders" }, mode: BOTH, status: LIVE,
    what: "Track what you've bought and sold, with a Paid → Preparing → Shipped → Delivered timeline.",
    keywords: ["my orders", "order status", "where is my fish", "tracking", "did it ship", "my purchases"] },
  { id: "dispute-doa", tab: "orders", label: { casual: "My Orders", pro: "My Orders" }, mode: BOTH, status: LIVE,
    what: "Raise a problem with an order — including a dead-on-arrival claim — from the order itself. Payment is held until arrival, with a 3-day safety window.",
    keywords: ["arrived dead", "dead on arrival", "doa", "dispute", "refund", "problem with my order", "buyer protection"] },
  { id: "pickup-handshake", tab: "orders", label: { casual: "My Orders", pro: "My Orders" }, mode: BOTH, status: LIVE,
    what: "Coordinate an in-person pickup: propose a time, see the spot, and confirm the handoff with a PIN or QR code.",
    keywords: ["pickup", "meet up", "local pickup", "pin", "handshake", "collect in person"] },
  { id: "order-analytics", tab: "orders", label: { casual: "My Orders", pro: "My Orders" }, mode: BOTH, status: GATED,
    what: "Buying analytics and one-tap reorder.",
    note: "Unlocks with order activity.",
    keywords: ["reorder", "buying analytics", "order history stats", "buy again"] },

  // ── Incoming / In Transit (incoming) ─────────────────────────────────────
  { id: "incoming-arrivals", tab: "incoming", label: { casual: "Incoming", pro: "In Transit" }, mode: BOTH, status: LIVE,
    what: "See fish on the way, follow the guided acclimation checklist, and confirm arrival into a tank. This tab only appears when something is in transit.",
    keywords: ["in transit", "incoming", "arriving", "acclimate", "acclimation", "confirm arrival", "my fish is coming"] },

  // ── The Reef / Social (reef) ──────────────────────────────────────────────
  { id: "reef-feed", tab: "reef", label: { casual: "The Reef", pro: "Social" }, mode: BOTH, status: LIVE,
    what: "Read the community feed and explore other keepers' tanks.",
    keywords: ["community", "feed", "social", "other keepers", "what are people posting"] },
  { id: "reef-post", tab: "reef", label: { casual: "The Reef", pro: "Social" }, mode: BOTH, status: LIVE,
    what: "Post an update with the composer — photos, a water snapshot and species tags.",
    keywords: ["post something", "share an update", "write a post", "composer"] },
  { id: "reef-schools", tab: "reef", label: { casual: "The Reef", pro: "Social" }, mode: BOTH, status: LIVE,
    what: "Find and join clubs (Schools), with chat and challenges. Creating one unlocks with activity.",
    keywords: ["schools", "clubs", "groups", "join a club", "create a school"] },
  { id: "reef-tides", tab: "reef", label: { casual: "The Reef", pro: "Social" }, mode: BOTH, status: LIVE,
    what: "Browse events (Tides) — expos, auctions and challenges — and RSVP.",
    keywords: ["events", "tides", "expo", "auction", "rsvp", "meetup", "what's on"] },
  { id: "expo-perks", tab: "reef", label: { casual: "The Reef", pro: "Social" }, mode: BOTH, status: NOT_ENFORCED,
    what: "Event RSVP, chat, maps and auctions all work.",
    note: "The advertised expo perks — reduced fees, double points, automatic location gating — are not applied yet.",
    keywords: ["expo perks", "reduced fees at an expo", "double points", "event discount"] },
  { id: "reef-inbox", tab: "reef", label: { casual: "The Reef", pro: "Social" }, mode: BOTH, status: LIVE,
    what: "Read notifications and direct messages in the combined Inbox.",
    keywords: ["messages", "dm", "inbox", "notifications", "did someone reply", "message a breeder"] },
  { id: "reef-profile", tab: "reef", label: { casual: "The Reef", pro: "Social" }, mode: BOTH, status: LIVE,
    what: "Edit your public profile — bio and avatar — and see your Depth Score.",
    keywords: ["my public profile", "edit my bio", "avatar", "depth score", "profile picture"] },

  // ── Settings (settings) — sections are #settings/<id> anchors ─────────────
  { id: "switch-mode", tab: "settings", section: "experience-mode", label: { casual: "Settings", pro: "Settings" }, mode: BOTH, status: LIVE,
    what: "Switch between the simpler Casual view and the full Pro view. It changes labels and which tabs show — it never takes a feature away.",
    keywords: ["casual mode", "pro mode", "switch mode", "simpler view", "change the interface", "breeder mode", "hide the pro stuff"] },
  { id: "notifications", tab: "settings", section: "notifications", label: { casual: "Settings", pro: "Settings" }, mode: BOTH, status: LIVE,
    what: "Choose which alerts you get and how.",
    keywords: ["notifications", "alerts", "push", "stop emailing me", "turn off alerts"] },
  { id: "units", tab: "settings", section: "units", label: { casual: "Settings", pro: "Settings" }, mode: BOTH, status: LIVE,
    what: "Switch between Celsius/Fahrenheit and litres/gallons.",
    keywords: ["units", "celsius", "fahrenheit", "gallons", "litres", "liters", "metric", "imperial"] },
  { id: "companions", tab: "settings", section: "companions", label: { casual: "Settings", pro: "Settings" }, mode: BOTH, status: LIVE,
    what: "Turn Poseidon and the Echo companion on or off.",
    keywords: ["turn off poseidon", "disable the assistant", "echo", "companion settings", "ai settings"] },
  { id: "accessibility", tab: "settings", section: "accessibility", label: { casual: "Settings", pro: "Settings" }, mode: BOTH, status: LIVE,
    what: "Adjust font size and high contrast.",
    keywords: ["font size", "bigger text", "high contrast", "accessibility", "hard to read"] },
  { id: "backup", tab: "settings", section: "backup", label: { casual: "Settings", pro: "Settings" }, mode: BOTH, status: LIVE,
    what: "Export a backup of your data, or restore one.",
    keywords: ["backup", "export my data", "restore", "save my data", "download my records"] },
  { id: "privacy", tab: "settings", section: "privacy", label: { casual: "Settings", pro: "Settings" }, mode: BOTH, status: LIVE,
    what: "See what's stored about you and request deletion.",
    keywords: ["privacy", "my data", "delete my data", "what do you store"] },
  { id: "reset", tab: "settings", section: "reset", label: { casual: "Settings", pro: "Settings" }, mode: BOTH, status: LIVE,
    what: "Clear this device's local copy and start fresh. Back up first — this can't be undone.",
    keywords: ["reset", "clear this device", "start over", "wipe my data"] },
  { id: "seller-settings", tab: "settings", section: "seller", label: { casual: "Settings", pro: "Settings" }, mode: BOTH, status: LIVE,
    what: "Jump to your selling setup from Settings.",
    keywords: ["seller settings", "selling setup"] },

  // ── Seller Hub / Breeder Terminal (breeder-terminal) ─────────────────────
  { id: "seller-home", tab: "breeder-terminal", section: "home", label: { casual: "Seller Hub", pro: "Breeder Terminal" }, mode: BOTH, status: LIVE,
    what: "Your selling workspace: earnings, low stock and setup status at a glance.",
    keywords: ["seller hub", "my store", "selling dashboard", "breeder terminal"] },
  { id: "seller-orders", tab: "breeder-terminal", section: "orders", label: { casual: "Seller Hub", pro: "Breeder Terminal" }, mode: BOTH, status: LIVE,
    what: "Fulfil what you've sold: buy shipping labels, add tracking, confirm cash pickups and answer claims.",
    keywords: ["my sales", "fulfil an order", "ship an order", "buy a label", "someone bought", "print postage"] },
  { id: "seller-listings", tab: "breeder-terminal", section: "listings", label: { casual: "Seller Hub", pro: "Breeder Terminal" }, mode: BOTH, status: LIVE,
    what: "Create and edit your listings, including the batch listing wizard.",
    keywords: ["my listings", "edit a listing", "batch listing", "manage what i sell"] },
  { id: "storefront", tab: "breeder-terminal", section: "store", label: { casual: "Seller Hub", pro: "Breeder Terminal" }, mode: BOTH, status: LIVE,
    what: "Set up your public storefront and feature collections.",
    keywords: ["storefront", "my shop page", "featured collections", "customise my store"] },
  { id: "promotions", tab: "breeder-terminal", section: "promotions", label: { casual: "Seller Hub", pro: "Breeder Terminal" }, mode: BOTH, status: LIVE,
    what: "Create and manage discount codes.",
    keywords: ["promo code", "discount", "coupon", "sale price"] },
  { id: "shipping-setup", tab: "breeder-terminal", section: "shipping", label: { casual: "Seller Hub", pro: "Breeder Terminal" }, mode: BOTH, status: LIVE,
    what: "Set your ship-from address, parcel presets and public pickup spot.",
    keywords: ["ship from address", "parcel size", "pickup spot", "shipping setup", "box presets"] },
  { id: "seller-analytics", tab: "breeder-terminal", section: "analytics", label: { casual: "Seller Hub", pro: "Breeder Terminal" }, mode: BOTH, status: LIVE,
    what: "See how your sales are doing. Advanced spreadsheet export unlocks at a higher tier.",
    keywords: ["sales analytics", "how am i doing", "sales report", "export my sales"] },
  { id: "payouts", tab: "breeder-terminal", section: "payouts", label: { casual: "Seller Hub", pro: "Breeder Terminal" }, mode: BOTH, status: LIVE,
    what: "Set up how you get paid and see your available and pending balance.",
    keywords: ["get paid", "payout", "my balance", "when do i get my money", "bank details"] },

  // ── Profile (profile) ─────────────────────────────────────────────────────
  { id: "profile-hub", tab: "profile", label: { casual: "Profile", pro: "Profile" }, mode: CASUAL, status: LIVE,
    what: "Your level, points, species count and the Starter Quest checklist.",
    keywords: ["my profile", "my level", "my points", "xp", "starter quest", "my progress", "tier"] },

  // ── Founders (founders) ───────────────────────────────────────────────────
  { id: "founders", tab: "founders", label: { casual: "Founders", pro: "Founders" }, mode: BOTH, status: GATED,
    what: "Internal product metrics.",
    note: "Only visible to founder accounts.",
    keywords: ["founders", "internal metrics", "kpis"] },

  // ── Retired — listed so the assistant can correct, not hallucinate ────────
  { id: "tank-cam", tab: "tanks", label: { casual: "My Aquariums", pro: "Aquariums" }, mode: BOTH, status: REMOVED,
    what: "Tank Cam streaming was retired and its setup entry point removed.",
    keywords: ["tank cam", "camera", "live stream my tank", "watch my tank", "webcam"] },
  { id: "reef-live", tab: "reef", label: { casual: "The Reef", pro: "Social" }, mode: BOTH, status: REMOVED,
    what: "The Reef's Live tab was retired along with tank-cam streaming.",
    keywords: ["live tab", "watch live tanks", "live streams"] },
  { id: "local-map", tab: "orders", label: { casual: "My Orders", pro: "My Orders" }, mode: BOTH, status: REMOVED,
    what: "The Local Sellers map was retired. Finding sellers is the marketplace's job, and pickup details live on the order that created them.",
    keywords: ["local map", "sellers near me", "nearby sellers", "closest to me", "distance sort", "map of breeders"] },
  { id: "my-store-standalone", tab: "breeder-terminal", section: "store", label: { casual: "Seller Hub", pro: "Breeder Terminal" }, mode: BOTH, status: REMOVED,
    what: "The standalone My Store tab was folded into the Seller Hub, which now owns storefront setup.",
    keywords: ["my store tab", "storefront tab"] },
]);

// ─── Matching ───────────────────────────────────────────────────────────────

/**
 * Deterministic phrase/token scoring — deliberately NOT Fuse.js.
 *
 * Fuse is used elsewhere in this codebase (species matching) and was the first
 * thing tried here, but it is the wrong tool for this shape of input. Fuse scores
 * a whole pattern against a whole field, so a natural question — "where do I log
 * a water test" — matched poorly against a short keyword like "water test" and
 * "how do I test my water" came back with the payouts entry. Fuzziness is an
 * asset for one misspelled species name and a liability for a 6-word question.
 *
 * So: exact phrase hits score highest, then full keyword-token coverage, then
 * partial overlap. Longer keyword matches outrank shorter ones, which is what
 * keeps "how many fry survived" on grow-out rather than the Fry Nursery.
 *
 * A query that scores below MIN_SCORE returns nothing rather than the
 * least-bad guess — the caller then falls back to the model. A typo therefore
 * degrades to "ask the model", never to a confidently wrong destination.
 */
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "on", "in", "at", "to", "for", "from", "with", "by",
  "i", "im", "my", "we", "our", "it", "its", "this", "that", "these", "those",
  "do", "does", "did", "is", "are", "was", "be", "been", "am",
  "how", "what", "where", "when", "which", "who", "why",
  "can", "could", "should", "would", "will", "shall", "may",
  "you", "your", "there", "here", "please", "help",
]);

const MIN_SCORE = 3;

function tokenize(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function scoreEntry(entry, normalizedQuery, queryTokens) {
  let score = 0;

  for (const keyword of entry.keywords) {
    const k = keyword.toLowerCase();
    const kwTokens = tokenize(keyword);
    if (kwTokens.length === 0) continue;
    if (normalizedQuery.includes(k)) {
      // The user literally said this phrase — the strongest signal, but weighted
      // by how specific the phrase is. A bare "fry" appearing in "how many fry
      // survived" must not outrank grow-out's "how many survived".
      score += 6 * (1 + kwTokens.length * 0.5);
      continue;
    }
    const hits = kwTokens.filter((t) => queryTokens.includes(t)).length;
    if (hits === kwTokens.length) {
      // Every meaningful word of the keyword appears. Weight by how specific the
      // keyword is, so a 3-word match beats a 1-word match.
      score += 6 * (1 + kwTokens.length * 0.25);
    } else if (hits > 0) {
      score += (2 * hits) / kwTokens.length;
    }
  }

  // The description contributes a little, capped so a wordy entry can't win on
  // volume alone.
  const whatTokens = tokenize(entry.what);
  const overlap = queryTokens.filter((t) => whatTokens.includes(t)).length;
  score += Math.min(overlap, 3) * 0.5;

  return score;
}

/** Look an entry up by its stable id. */
export function guideEntryById(id) {
  return APP_GUIDE.find((e) => e.id === id) || null;
}

/**
 * The payload for `aquadex:navigate-tab`.
 *
 * That event is the channel to use rather than `poseidon:navigate`, because it
 * already resolves `section` per destination (a `#settings/<id>` anchor for
 * Settings, a prop for the Breeder Terminal) and it routes through
 * `handleTabChange`, which clears stale filters. `poseidon:navigate` does
 * neither.
 *
 * Returns null for a retired destination — there is nowhere honest to send them.
 */
export function navTargetFor(entry) {
  if (!entry || entry.status === GUIDE_STATUS.REMOVED) return null;
  return { tab: entry.tab, ...(entry.section ? { section: entry.section } : {}) };
}

/**
 * Rank guide entries against a free-text question.
 *
 * @param {string} query
 * @param {{ limit?: number }} [options]
 * @returns {Array} matched entries, best first
 */
export function findAppGuide(query, { limit = 5 } = {}) {
  const raw = String(query ?? "").trim();
  if (raw.length < 2) return [];

  const normalizedQuery = raw.toLowerCase();
  const queryTokens = tokenize(raw);
  if (queryTokens.length === 0) return [];

  return APP_GUIDE
    .map((entry) => ({ entry, score: scoreEntry(entry, normalizedQuery, queryTokens) }))
    .filter((r) => r.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => r.entry);
}

/**
 * Scores for a query, best first — exposed for tuning and for the tests to assert
 * ranking rather than only the winner.
 */
export function scoreAppGuide(query) {
  const raw = String(query ?? "").trim();
  const normalizedQuery = raw.toLowerCase();
  const queryTokens = tokenize(raw);
  return APP_GUIDE
    .map((entry) => ({ id: entry.id, score: Number(scoreEntry(entry, normalizedQuery, queryTokens).toFixed(2)) }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Answer "where do I do X?" locally, with no model call.
 *
 * Returns null when nothing matches confidently — the caller should then fall
 * back to the model rather than guessing, which is the same "say you don't know"
 * discipline the Poseidon prompt already applies to species facts.
 *
 * @param {string} query
 * @param {{ casual?: boolean, currentTab?: string }} [options]
 * @returns {{ entry: object, answer: string, navTarget: object|null, needsModeSwitch: boolean }|null}
 */
export function answerAppQuestion(query, { casual = true, currentTab = null } = {}) {
  const [entry] = findAppGuide(query, { limit: 1 });
  if (!entry) return null;

  const label = casual ? entry.label.casual : entry.label.pro;
  // Pro-only surfaces are hidden in Casual, but nothing is withheld — offer the
  // toggle instead of implying a lock (see GUIDE_MODE).
  const needsModeSwitch = casual && entry.mode === GUIDE_MODE.PRO;

  const parts = [];
  if (entry.status === GUIDE_STATUS.REMOVED) {
    parts.push(entry.what);
  } else {
    parts.push(`${entry.what} You'll find it under ${label}${entry.section ? ` → ${entry.section}` : ""}.`);
    if (currentTab && currentTab === entry.tab && !entry.section) {
      parts.push("You're already on that tab.");
    }
    if (needsModeSwitch) {
      parts.push("That's a Pro surface — flip to Pro mode in the header to see the tab.");
    }
    if (entry.note) parts.push(entry.note);
  }

  return {
    entry,
    answer: parts.join(" "),
    navTarget: navTargetFor(entry),
    needsModeSwitch,
  };
}

/** Every user-facing string in the manifest — for the language invariant test. */
export function allGuideCopy() {
  const out = [];
  for (const e of APP_GUIDE) {
    out.push(e.what, e.label.casual, e.label.pro);
    if (e.note) out.push(e.note);
  }
  return out;
}
