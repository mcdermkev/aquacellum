/**
 * speciesCuration.js — server-side species suggestion, voting, and promotion
 *
 * Mounted as ?action= handlers on api/species.js rather than as its own
 * serverless function: the project sits at exactly 12 functions, which is the
 * Vercel Hobby ceiling, and species.js already receives
 * `includeFiles: public/fishbase_master.json` from vercel.json — which the
 * cross-check needs.
 *
 * See docs/SPECIES_SUGGESTION_APPROVAL_SPEC.md.
 *
 * ── The security posture, stated once ────────────────────────────────────────
 * Identity here is NEVER taken from the Supabase session. api/mint-session.js
 * mints the session with `(tokenWallet || bodyWallet)`, so a client-supplied
 * wallet is used unverified whenever a Privy token lacks the wallet claim
 * (spec §8). Every function below verifies the Privy token itself and REQUIRES a
 * non-null token wallet claim, then passes that wallet explicitly to
 * cast_species_vote_as(), which is granted to service_role only.
 *
 * `promote` is the highest-blast-radius path in the app: it signs with the
 * on-chain curator key. It therefore accepts ONLY a suggestion id, re-reads the
 * approval decision from the database, and re-derives every species field
 * server-side. It never accepts species data from the caller, because that would
 * turn it into an arbitrary-catalog-write primitive with the curator key behind it.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { createClient } from "@supabase/supabase-js";
import { ethers } from "ethers";
import { verifyPrivyToken } from "./verifyPrivyToken.js";
import { checkRateLimit } from "./rateLimiter.js";

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

const MANAGER_ADDRESS =
  process.env.MANAGER_ADDRESS || "0x351ca8f34D94F29F6f865Afa419A636324473DeF";
const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";

// Only the two calls this module makes. Kept minimal and human-readable, the
// same convention as api/relay-transaction.js. NOTE: ethers v5 in this project.
const MANAGER_ABI = [
  "function addSpecies(string scientificName, string commonName, string canonicalIpfsUri, uint8 careLevel, int16 minTempCelsiusX10, int16 maxTempCelsiusX10, uint8 minPhX10, uint8 maxPhX10) returns (uint256)",
  "function nextSpeciesId() view returns (uint256)",
  "function curator() view returns (address)",
];

// Max suggestions per wallet per 24h. The old client-side limit lived in
// IndexedDB and was trivially bypassable; this one is counted server-side.
const SUGGESTIONS_PER_DAY = 3;

let _supabase = null;
function getSupabase() {
  if (_supabase) return _supabase;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return null;
  _supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
  return _supabase;
}

// ─────────────────────────────────────────────────────────────────────────────
// Catalog loading — the reference JSON, used for the cross-check
// ─────────────────────────────────────────────────────────────────────────────

let _catalog = null;
let _byName = null;

export function normalizeName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

function loadReferenceCatalog() {
  if (_catalog) return _catalog;

  const candidatePaths = [
    join(process.cwd(), "public", "fishbase_master.json"),
    join(process.cwd(), "..", "public", "fishbase_master.json"),
    join(process.cwd(), "frontend", "public", "fishbase_master.json"),
  ];

  let raw = null;
  for (const p of candidatePaths) {
    try {
      raw = readFileSync(p, "utf-8");
      break;
    } catch {
      continue;
    }
  }

  if (!raw) {
    console.error("[curation] fishbase_master.json not found");
    _catalog = [];
    _byName = new Map();
    return _catalog;
  }

  _catalog = JSON.parse(raw);
  _byName = new Map();
  for (const sp of _catalog) {
    const key = normalizeName(sp.scientificName);
    if (key && !_byName.has(key)) _byName.set(key, sp);
  }
  return _catalog;
}

function findInReference(scientificName) {
  loadReferenceCatalog();
  return _byName.get(normalizeName(scientificName)) || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth: a Privy-verified wallet, or null. See the module header for why the
// Supabase session is not trusted here.
// ─────────────────────────────────────────────────────────────────────────────

async function requireVerifiedWallet(req, res) {
  const { verified, walletAddress, error } = await verifyPrivyToken(req);

  if (!verified) {
    res.status(401).json({ error: error || "Authentication required" });
    return null;
  }

  // Deliberately NO fallback to a body-supplied wallet. A curation action must
  // never be attributable to a wallet the caller merely claimed — that is the
  // exact weakness in mint-session.js that this module refuses to inherit.
  if (!walletAddress) {
    res.status(401).json({
      error:
        "Your session has no verified wallet address. Sign out and back in, then retry.",
    });
    return null;
  }

  return walletAddress.toLowerCase();
}

async function getActiveRoles(supabase, wallet) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role, wallet_address")
    .eq("active", true);

  if (error) {
    console.error("[curation] role lookup failed:", error);
    return { roles: [], error: "Could not verify your curation role" };
  }

  // Compared with lower() rather than a server-side .eq() because
  // profiles.wallet_address (and therefore user_roles.wallet_address, which has
  // an FK to it) is not reliably lowercased — see
  // 20260630120000_normalize_wallet_casing.sql. The existing
  // services/rolesApi.js getUserRoles does a bare .eq() on a lowercased wallet
  // and silently returns [] for a mixed-case row.
  const roles = (data || [])
    .filter((r) => String(r.wallet_address || "").toLowerCase() === wallet)
    .map((r) => r.role);

  return { roles, error: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/species?action=suggest
// ─────────────────────────────────────────────────────────────────────────────

const BINOMIAL = /^[A-Z][a-z]+ [a-z.]+( [a-z.]+)?$/;

export async function handleSuggest(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return res
      .status(503)
      .json({ error: "Curation service is not configured." });
  }

  const wallet = await requireVerifiedWallet(req, res);
  if (!wallet) return;

  const b = req.body || {};
  const scientificName = String(b.scientificName || "").trim();
  const commonName = String(b.commonName || "").trim();

  // ── Validation (mirrors SuggestSpeciesModal's client-side checks, because a
  //    client check is a UX affordance and not a constraint) ─────────────────
  const errors = {};
  if (!scientificName) errors.scientificName = "Scientific name is required.";
  else if (!BINOMIAL.test(scientificName))
    errors.scientificName =
      "Must follow binomial format, e.g. 'Paracheirodon innesi'.";
  if (!commonName) errors.commonName = "Common name is required.";

  const careLevel = Number(b.careLevel ?? 1);
  if (!Number.isInteger(careLevel) || careLevel < 0 || careLevel > 3)
    errors.careLevel = "Care level must be 0-3.";

  const minTemp = Number(b.minTemp);
  const maxTemp = Number(b.maxTemp);
  if (!Number.isFinite(minTemp) || !Number.isFinite(maxTemp) || minTemp >= maxTemp || minTemp < 0 || maxTemp > 45)
    errors.temp = "Provide a valid temperature range (0-45 °C).";

  const minPh = Number(b.minPh);
  const maxPh = Number(b.maxPh);
  if (!Number.isFinite(minPh) || !Number.isFinite(maxPh) || minPh >= maxPh || minPh < 0 || maxPh > 14)
    errors.ph = "Provide a valid pH range (0.0-14.0).";

  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ error: "Validation failed", errors });
  }

  // ── Rate limit, counted in the database rather than the browser ───────────
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: recentCount, error: countErr } = await supabase
    .from("species_suggestions")
    .select("id", { count: "exact", head: true })
    .eq("submitted_by", wallet)
    .gte("created_at", since);

  if (countErr) {
    console.error("[curation] rate-limit count failed:", countErr);
    return res.status(500).json({ error: "Could not check your submission history." });
  }
  if ((recentCount || 0) >= SUGGESTIONS_PER_DAY) {
    return res.status(429).json({
      error: `Curation rate limit: ${SUGGESTIONS_PER_DAY} suggestions per 24 hours.`,
    });
  }

  // A second IP limiter, because the per-wallet limit is only as good as the
  // cost of making a new wallet.
  const ipRl = checkRateLimit(`suggest:${getIp(req)}`, {
    maxRequests: 10,
    windowMs: 24 * 60 * 60 * 1000,
  });
  if (!ipRl.allowed) {
    return res.status(429).json({ error: "Too many suggestions from this network today." });
  }

  // ── The fishbase cross-check ──────────────────────────────────────────────
  const reference = findInReference(scientificName);
  let fishbaseMatch = "none";
  let specCode = null;

  if (reference) {
    specCode = reference.specCode ?? null;
    fishbaseMatch = "json_only";

    // Already promoted to the chain? species_id_map is the authoritative mirror.
    if (specCode != null) {
      const { data: mapped } = await supabase
        .from("species_id_map")
        .select("onchain_species_id")
        .eq("spec_code", specCode)
        .eq("contract_address", MANAGER_ADDRESS.toLowerCase())
        .maybeSingle();

      if (mapped?.onchain_species_id) {
        return res.status(409).json({
          error: `"${reference.commonName}" (${reference.scientificName}) is already in the live catalog.`,
          alreadyInCatalog: true,
          onchainSpeciesId: mapped.onchain_species_id,
        });
      }
    }
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("species_suggestions")
    .insert({
      submitted_by: wallet,
      scientific_name: scientificName,
      common_name: commonName,
      care_level: careLevel,
      min_temp_c: minTemp,
      max_temp_c: maxTemp,
      min_ph: minPh,
      max_ph: maxPh,
      proof_url: String(b.proofUrl || "").slice(0, 500),
      notes: String(b.notes || "").slice(0, 2000),
      fishbase_match: fishbaseMatch,
      spec_code: specCode,
      ai_status: "skipped",
    })
    .select()
    .single();

  if (insertErr) {
    // 23505 = the live-name unique index. A duplicate is expected traffic, not a
    // server fault, so it gets its own message rather than a generic 500.
    if (insertErr.code === "23505") {
      return res.status(409).json({
        error: `"${scientificName}" has already been suggested and is awaiting review.`,
        duplicate: true,
      });
    }
    console.error("[curation] suggestion insert failed:", insertErr);
    return res.status(500).json({ error: "Could not save your suggestion." });
  }

  return res.status(201).json({
    suggestion: inserted,
    fishbaseMatch,
    // Tell the submitter the truth about what happens next. 'none' means a
    // curator has to author the care profile before it can get a card.
    message:
      fishbaseMatch === "json_only"
        ? "Submitted. This species is already in our reference data, so a founder can publish it straight away."
        : "Submitted. This species is new to our reference data, so a curator will need to author its care profile before it appears.",
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/species?action=vote   { suggestionId, vote: 'approve'|'reject', note? }
// ─────────────────────────────────────────────────────────────────────────────

export async function handleVote(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return res.status(503).json({ error: "Curation service is not configured." });
  }

  const wallet = await requireVerifiedWallet(req, res);
  if (!wallet) return;

  const { suggestionId, vote, note } = req.body || {};
  if (!suggestionId) return res.status(400).json({ error: "suggestionId is required." });
  if (vote !== "approve" && vote !== "reject") {
    return res.status(400).json({ error: "vote must be 'approve' or 'reject'." });
  }

  // The role check also lives inside cast_species_vote_as, so this is a
  // friendlier error rather than the authority boundary. The database remains
  // the thing that actually refuses.
  const { roles, error: roleErr } = await getActiveRoles(supabase, wallet);
  if (roleErr) return res.status(500).json({ error: roleErr });
  if (!roles.some((r) => r === "founder" || r === "curator")) {
    return res.status(403).json({
      error: "Only Breeders Council members can vote on catalog entries.",
    });
  }

  const { data, error } = await supabase.rpc("cast_species_vote_as", {
    p_wallet: wallet,
    p_suggestion_id: suggestionId,
    p_vote: vote,
    p_note: String(note || "").slice(0, 500),
  });

  if (error) {
    console.error("[curation] vote failed:", error);
    // 42501 insufficient_privilege, 23514 check_violation, P0002 not found —
    // all caller-fixable, so they are 4xx rather than 500.
    const status =
      error.code === "42501" ? 403 :
      error.code === "P0002" ? 404 :
      error.code === "23514" ? 409 : 500;
    return res.status(status).json({ error: error.message || "Vote failed." });
  }

  // Re-read through the view so the caller gets the tally and what is still
  // required, from the same source the invariant uses.
  const { data: row } = await supabase
    .from("species_suggestion_queue")
    .select("*")
    .eq("id", suggestionId)
    .maybeSingle();

  return res.status(200).json({ suggestion: row || data, votedAs: wallet });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/species?action=queue
// Public, so a "Founder approved this" badge can render for anyone.
// ─────────────────────────────────────────────────────────────────────────────

export async function handleQueue(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  const supabase = getSupabase();
  if (!supabase) return res.status(200).json({ suggestions: [], configured: false });

  const status = String(req.query.status || "").toLowerCase();
  let query = supabase
    .from("species_suggestion_queue")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (["pending", "approved", "rejected", "promoted"].includes(status)) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[curation] queue read failed:", error);
    return res.status(500).json({ error: "Could not load the curation queue." });
  }

  return res.status(200).json({ suggestions: data || [], configured: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/species?action=promote   { suggestionId }
//
// The one path that spends the curator key. Every guard here exists to keep it
// from becoming an arbitrary catalog-write primitive.
// ─────────────────────────────────────────────────────────────────────────────

export async function handlePromote(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const supabase = getSupabase();
  if (!supabase) {
    return res.status(503).json({ error: "Curation service is not configured." });
  }

  // ── 1. Privy-verified identity, no session fallback ──────────────────────
  const wallet = await requireVerifiedWallet(req, res);
  if (!wallet) return;

  // ── 2. Founder role, re-read server-side ─────────────────────────────────
  const { roles, error: roleErr } = await getActiveRoles(supabase, wallet);
  if (roleErr) return res.status(500).json({ error: roleErr });
  if (!roles.includes("founder")) {
    return res.status(403).json({
      error: "Only a founder can publish a species to the live catalog.",
    });
  }

  // ── 3. Only an id is accepted ────────────────────────────────────────────
  const { suggestionId } = req.body || {};
  if (!suggestionId) return res.status(400).json({ error: "suggestionId is required." });

  const { data: sug, error: readErr } = await supabase
    .from("species_suggestions")
    .select("*")
    .eq("id", suggestionId)
    .maybeSingle();

  if (readErr) {
    console.error("[curation] promote read failed:", readErr);
    return res.status(500).json({ error: "Could not load that suggestion." });
  }
  if (!sug) return res.status(404).json({ error: "Suggestion not found." });

  // Idempotency: never write a second catalog entry for the same suggestion.
  if (sug.status === "promoted") {
    return res.status(200).json({
      alreadyPromoted: true,
      onchainSpeciesId: sug.onchain_species_id,
      txHash: sug.promotion_tx_hash,
    });
  }

  // ── 4. The DB decides what is approved, not the caller ───────────────────
  if (sug.status !== "approved") {
    return res.status(409).json({
      error: `This suggestion is '${sug.status}', not 'approved'. It needs the required council votes first.`,
      status: sug.status,
    });
  }

  // ── 5. Re-derive the species payload server-side ─────────────────────────
  const payload = await resolvePromotionPayload(supabase, sug);
  if (payload.error) {
    return res.status(409).json({ error: payload.error });
  }

  // ── 6. Duplicate guard, and the id-map completeness precondition ─────────
  const key = process.env.RELAYER_PRIVATE_KEY;
  if (!key) {
    return res.status(503).json({ error: "Catalog signer is not configured." });
  }

  let provider, signer, manager;
  try {
    provider = new ethers.providers.JsonRpcProvider(RPC_URL);
    signer = new ethers.Wallet(key, provider);
    manager = new ethers.Contract(MANAGER_ADDRESS, MANAGER_ABI, signer);
  } catch (err) {
    console.error("[curation] signer init failed:", err);
    return res.status(500).json({ error: "Could not initialise the catalog signer." });
  }

  let onchainCurator, nextId;
  try {
    [onchainCurator, nextId] = await Promise.all([
      manager.curator(),
      manager.nextSpeciesId(),
    ]);
  } catch (err) {
    console.error("[curation] chain read failed:", err);
    return res.status(502).json({ error: "Could not reach the catalog contract." });
  }

  // Fail before spending gas on a transaction that would revert.
  if (onchainCurator.toLowerCase() !== signer.address.toLowerCase()) {
    console.error(
      `[curation] signer ${signer.address} is not the on-chain curator ${onchainCurator}`
    );
    return res.status(503).json({
      error:
        "The configured signer does not hold curator rights on the catalog contract.",
    });
  }

  // The id map must mirror the chain completely before we trust it as the
  // duplicate oracle. Scanning all ~283 catalog entries per promotion would be
  // hundreds of RPC calls inside a serverless timeout, so instead the map's
  // completeness is an explicit precondition: if it is behind, refuse and point
  // at the backfill rather than risk a duplicate catalog entry.
  const expectedMapped = Number(nextId) - 1;
  const { count: mappedCount, error: mapCountErr } = await supabase
    .from("species_id_map")
    .select("spec_code", { count: "exact", head: true })
    .eq("contract_address", MANAGER_ADDRESS.toLowerCase());

  if (mapCountErr) {
    console.error("[curation] id map count failed:", mapCountErr);
    return res.status(500).json({ error: "Could not verify the catalog id map." });
  }
  if ((mappedCount || 0) < expectedMapped) {
    return res.status(409).json({
      error:
        `The catalog id map is incomplete (${mappedCount || 0} of ${expectedMapped} on-chain species mapped), ` +
        `so a duplicate cannot be ruled out. Run frontend/ops/backfill-species-id-map.mjs first.`,
      mapped: mappedCount || 0,
      expected: expectedMapped,
    });
  }

  const { data: dupe } = await supabase
    .from("species_id_map")
    .select("onchain_species_id, scientific_name")
    .eq("contract_address", MANAGER_ADDRESS.toLowerCase())
    .ilike("scientific_name", payload.scientificName)
    .maybeSingle();

  if (dupe?.onchain_species_id) {
    return res.status(409).json({
      error: `"${payload.scientificName}" is already in the live catalog as species #${dupe.onchain_species_id}.`,
      onchainSpeciesId: dupe.onchain_species_id,
    });
  }

  // ── 7. Write the catalog, then record the mapping ────────────────────────
  let receipt;
  try {
    const tx = await manager.addSpecies(
      payload.scientificName,
      payload.commonName,
      payload.canonicalIpfsUri,
      payload.careLevel,
      payload.minTempX10,
      payload.maxTempX10,
      payload.minPhX10,
      payload.maxPhX10
    );
    receipt = await tx.wait();
  } catch (err) {
    console.error("[curation] addSpecies failed:", err);
    return res.status(502).json({
      error: `Catalog write failed: ${err.reason || err.message || "unknown error"}`,
    });
  }

  // addSpecies assigns sequentially, so the id it consumed is the nextSpeciesId
  // we read before sending. Re-read to confirm rather than assuming, so a
  // concurrent promotion cannot silently mis-attribute the mapping.
  let assignedId = Number(nextId);
  try {
    const after = Number(await manager.nextSpeciesId());
    if (after !== Number(nextId) + 1) {
      // Another write landed in between. Record what the chain says and flag it.
      console.warn(
        `[curation] nextSpeciesId moved ${nextId} -> ${after}; concurrent catalog write suspected`
      );
      assignedId = after - 1;
    }
  } catch {
    // Non-fatal: the transaction already succeeded. Keep the pre-read id.
  }

  const contractKey = MANAGER_ADDRESS.toLowerCase();

  const { error: mapErr } = await supabase.from("species_id_map").upsert(
    {
      spec_code: payload.specCode,
      contract_address: contractKey,
      onchain_species_id: assignedId,
      scientific_name: payload.scientificName,
      source: "promotion",
    },
    { onConflict: "spec_code,contract_address" }
  );
  if (mapErr) console.error("[curation] id map write failed:", mapErr);

  const { error: statusErr } = await supabase
    .from("species_suggestions")
    .update({
      status: "promoted",
      onchain_species_id: assignedId,
      promotion_tx_hash: receipt.transactionHash,
      promoted_at: new Date().toISOString(),
      spec_code: payload.specCode,
    })
    .eq("id", suggestionId);
  if (statusErr) console.error("[curation] status update failed:", statusErr);

  return res.status(200).json({
    onchainSpeciesId: assignedId,
    specCode: payload.specCode,
    txHash: receipt.transactionHash,
    scientificName: payload.scientificName,
    commonName: payload.commonName,
    message: `"${payload.commonName}" is live in the catalog and can now be added to a tank.`,
  });
}

/**
 * Rebuild the on-chain species record from a trusted source. The suggestion's
 * own temp/pH numbers are only used when there is no reference profile to beat
 * them, so a submitter cannot smuggle wrong care data into the canonical catalog
 * for a species we already have real data for.
 */
async function resolvePromotionPayload(supabase, sug) {
  const reference = findInReference(sug.scientific_name);

  if (reference) {
    const difficulty = reference.tankMetrics?.difficulty || "Intermediate";
    const CARE_LEVEL_MAP = { Beginner: 0, Intermediate: 1, Advanced: 2, Difficult: 3 };
    const minTemp = reference.tankMetrics?.tempRangeCelsius?.[0] ?? Number(sug.min_temp_c);
    const maxTemp = reference.tankMetrics?.tempRangeCelsius?.[1] ?? Number(sug.max_temp_c);
    const minPh = reference.ecology?.phMin ?? reference.tankMetrics?.phRange?.[0] ?? Number(sug.min_ph);
    const maxPh = reference.ecology?.phMax ?? reference.tankMetrics?.phRange?.[1] ?? Number(sug.max_ph);

    return {
      specCode: reference.specCode,
      scientificName: reference.scientificName,
      commonName: reference.commonName,
      canonicalIpfsUri: reference.masterPhotoUrl || "",
      careLevel: CARE_LEVEL_MAP[difficulty] ?? 1,
      minTempX10: Math.round(minTemp * 10),
      maxTempX10: Math.round(maxTemp * 10),
      minPhX10: Math.round(minPh * 10),
      maxPhX10: Math.round(maxPh * 10),
    };
  }

  // Not in the reference JSON. It needs an authored, PUBLISHED species_profiles
  // row, or promoting it produces a card with no photo, ecology, diet, or
  // personality — and db.species cannot be patched to fix that after the fact,
  // because both of its writers clear() and refill from the JSON file.
  const { data: profile } = await supabase
    .from("species_profiles")
    .select("*")
    .ilike("scientific_name", sug.scientific_name)
    .eq("published", true)
    .maybeSingle();

  if (!profile) {
    return {
      error:
        `"${sug.scientific_name}" is not in our reference data and has no published care profile yet. ` +
        `Author one in species_profiles and publish it, then promote — otherwise its card would render empty.`,
    };
  }

  const p = profile.profile || {};
  const difficulty = p.tankMetrics?.difficulty || "Intermediate";
  const CARE_LEVEL_MAP = { Beginner: 0, Intermediate: 1, Advanced: 2, Difficult: 3 };

  // The authored profile's difficulty wins; otherwise fall back to what the
  // submitter said, and only then to Intermediate. Number() never returns
  // nullish, so this needs an explicit validity test rather than `??`.
  const submittedCare = Number(sug.care_level);
  const fallbackCare =
    Number.isInteger(submittedCare) && submittedCare >= 0 && submittedCare <= 3
      ? submittedCare
      : 1;

  return {
    specCode: profile.spec_code,
    scientificName: profile.scientific_name,
    commonName: profile.common_name,
    canonicalIpfsUri: p.masterPhotoUrl || "",
    careLevel: CARE_LEVEL_MAP[difficulty] ?? fallbackCare,
    minTempX10: Math.round((p.tankMetrics?.tempRangeCelsius?.[0] ?? Number(sug.min_temp_c)) * 10),
    maxTempX10: Math.round((p.tankMetrics?.tempRangeCelsius?.[1] ?? Number(sug.max_temp_c)) * 10),
    minPhX10: Math.round((p.ecology?.phMin ?? Number(sug.min_ph)) * 10),
    maxPhX10: Math.round((p.ecology?.phMax ?? Number(sug.max_ph)) * 10),
  };
}

function getIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) return fwd.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}
