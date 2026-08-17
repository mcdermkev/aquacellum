/**
 * speciesCurationApi.js
 *
 * Client for the Breeders Council species curation flow. Replaces the
 * per-browser Dexie queue that used to live in hooks/useSuggestSpecies.js
 * ('AquadexCurationDB'), where a suggestion existed only in the browser it was
 * typed into — which is precisely why one founder could never see the other's
 * suggestions, on any device.
 *
 * Every call targets an `?action=` route on the consolidated `/api/species`
 * function. Kept on that function rather than a new one to stay within Vercel
 * Hobby's 12-serverless-function limit, and because it already receives
 * fishbase_master.json via vercel.json's includeFiles — which the server needs
 * for the duplicate cross-check.
 *
 * AUTH. Same bridge as services/parcelPresets.js / shipping.js / reviewsApi.js:
 * register a Privy `getAccessToken` via setSessionTokenGetter (done in
 * contexts/AuthContext.jsx) and every authenticated request sends it as a bearer
 * token. The server derives the acting wallet from that token and NEVER from the
 * request body — and deliberately not from the Supabase session either, because
 * api/mint-session.js currently accepts a client-supplied wallet when the Privy
 * token carries no wallet claim. See docs/SPECIES_SUGGESTION_APPROVAL_SPEC.md §8.
 *
 * There is no client-side write path to any curation table: all four are
 * read-only under RLS. Nothing here can set a status, and nothing here decides
 * who may vote — the database does both.
 */

const API_BASE = import.meta.env.VITE_API_BASE || "/api";

let _sessionTokenGetter = null;

/** Register the session-token getter (e.g. Privy getAccessToken). Pass null to clear. */
export function setSessionTokenGetter(getter) {
  _sessionTokenGetter = typeof getter === "function" ? getter : null;
}

async function getSessionToken() {
  if (!_sessionTokenGetter) return null;
  try {
    return (await _sessionTokenGetter()) || null;
  } catch (err) {
    console.warn("[SpeciesCuration] Could not resolve session token:", err.message);
    return null;
  }
}

/**
 * @param {string} action
 * @param {{ method?: string, body?: object, auth?: boolean }} options
 * @returns {Promise<object>} the parsed JSON body
 * @throws {Error} with `.status` and any `.errors` map from the server
 */
async function request(action, { method = "GET", body, auth = false } = {}) {
  const headers = { "Content-Type": "application/json" };

  if (auth) {
    const token = await getSessionToken();
    if (!token) {
      // Fail here rather than sending an unauthenticated request that the server
      // would reject with a less specific 401.
      const err = new Error(
        "You need to be signed in to do that. Sign out and back in if this persists."
      );
      err.status = 401;
      throw err;
    }
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}/species?action=${action}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    // Field-level validation detail, so the form can highlight the bad input
    // instead of showing one opaque banner.
    if (data.errors) err.errors = data.errors;
    if (data.duplicate) err.duplicate = true;
    if (data.alreadyInCatalog) err.alreadyInCatalog = true;
    if (data.onchainSpeciesId) err.onchainSpeciesId = data.onchainSpeciesId;
    throw err;
  }

  return data;
}

/**
 * The shared council queue, with vote tallies. Public — anyone can read it, so a
 * "Founder approved this" badge renders for everyone and the queue is auditable.
 *
 * Rows come from the `species_suggestion_queue` view, so `approve_votes`,
 * `founder_approved`, `required_approvals` and `approvals_remaining` are computed
 * by the same source as the approval invariant. The UI never recomputes them and
 * therefore cannot disagree with the database about what is still needed.
 *
 * @param {{ status?: 'pending'|'approved'|'rejected'|'promoted' }} [filter]
 * @returns {Promise<{suggestions: object[], configured: boolean}>}
 */
export async function listSuggestionQueue(filter = {}) {
  const qs = filter.status ? `&status=${encodeURIComponent(filter.status)}` : "";
  return request(`queue${qs}`);
}

/**
 * Submit a species suggestion.
 *
 * The server owns validation, the per-wallet rate limit, duplicate detection, and
 * the fishbase cross-check that decides `fishbaseMatch`:
 *   'json_only' — already in our reference data, so a founder can publish it directly
 *   'none'      — new to us, so a curator must author a care profile first or the
 *                 species card would render empty
 *
 * @param {object} formData scientificName, commonName, careLevel, minTemp, maxTemp,
 *                          minPh, maxPh, proofUrl, notes
 * @returns {Promise<{suggestion: object, fishbaseMatch: string, message: string}>}
 */
export async function submitSuggestion(formData) {
  return request("suggest", { method: "POST", auth: true, body: formData });
}

/**
 * Cast a curation vote.
 *
 * Eligibility ('founder' or 'curator' in user_roles) and the approval invariant
 * are both enforced server-side and in the database. A 403 here means the wallet
 * genuinely holds no curation role.
 *
 * @param {{ suggestionId: string, vote: 'approve'|'reject', note?: string }} args
 * @returns {Promise<{suggestion: object, votedAs: string}>}
 */
export async function castVote({ suggestionId, vote, note = "" }) {
  return request("vote", {
    method: "POST",
    auth: true,
    body: { suggestionId, vote, note },
  });
}

/**
 * Published rich-care profiles for species that are NOT in fishbase_master.json.
 *
 * This read goes straight to Supabase rather than through /api/species, unlike
 * everything else in this file: it is a public, read-only table (RLS exposes only
 * `published` rows), so routing it through a serverless function would add a hop
 * and a cold start for no security benefit. Same approach as services/rolesApi.js.
 *
 * WHY THE OVERLAY EXISTS. Dexie `db.species` cannot hold an authored species:
 * both of its writers (hooks/useSpeciesData.js and hooks/useCatalogHydration.js)
 * call `clear()` and then refill from the static JSON file, so anything injected
 * there is wiped on the next catalog load. Without this table, a species promoted
 * on-chain but absent from the JSON renders a card with no photo, ecology, diet,
 * or personality.
 *
 * Rows are returned already shaped like a fishbase_master.json record, so the
 * merge in useSpeciesData is a plain overlay rather than a second render path.
 *
 * @returns {Promise<object[]>} [] when Supabase is unconfigured or the read fails
 */
export async function listPublishedSpeciesProfiles() {
  try {
    const { supabase, isSupabaseConfigured } = await import("./supabaseClient");
    if (!isSupabaseConfigured()) return [];

    const { data, error } = await supabase
      .from("species_profiles")
      .select("spec_code, scientific_name, common_name, profile")
      .eq("published", true);

    if (error) {
      console.warn("[SpeciesCuration] Could not load species profile overlay:", error.message);
      return [];
    }

    return (data || []).map((row) => ({
      // The authored profile first, so explicit identity fields below always win.
      ...(row.profile || {}),
      specCode: row.spec_code,
      scientificName: row.scientific_name,
      commonName: row.common_name,
      isAuthoredProfile: true,
    }));
  } catch (err) {
    console.warn("[SpeciesCuration] Species profile overlay unavailable:", err.message);
    return [];
  }
}

/**
 * Publish an approved species to the live on-chain catalog, which is what makes
 * it addable to a tank.
 *
 * Takes ONLY an id: the server re-reads the approval decision from the database,
 * re-derives every species field from trusted data, and signs with the curator
 * key. Passing species fields from here would turn that endpoint into an
 * arbitrary catalog-write primitive.
 *
 * Idempotent — promoting an already-promoted suggestion returns the existing
 * on-chain id rather than writing a second catalog entry.
 *
 * @param {string} suggestionId
 * @returns {Promise<{onchainSpeciesId: number, txHash: string, alreadyPromoted?: boolean}>}
 */
export async function promoteSuggestion(suggestionId) {
  return request("promote", { method: "POST", auth: true, body: { suggestionId } });
}
