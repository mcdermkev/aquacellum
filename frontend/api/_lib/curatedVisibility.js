// Curated showcase visibility — simple public/private persistence.
//
// A breeder's showcase is either public or private. That's the whole feature.
// It is deliberately NOT the heavy identity/publication system: no wallet
// signing, no atomic CAS. The flag is stored as a tiny JSON object in a private
// Supabase Storage bucket, which the runtime service key can read and write with
// no schema migration. Reads fail safe: any error falls back to the caller's
// default (public), so the public page never breaks on a storage hiccup.

const BUCKET = "curated-visibility";

async function ensureBucket(supabase) {
  try {
    await supabase.storage.createBucket(BUCKET, { public: false });
  } catch {
    // Already exists (or concurrent create) — safe to ignore.
  }
}

export async function readCuratedVisibility(supabase, slug) {
  try {
    const { data, error } = await supabase.storage.from(BUCKET).download(`${slug}.json`);
    if (error || !data) return null;
    const text = await data.text();
    const parsed = JSON.parse(text);
    return {
      isPublic: typeof parsed.isPublic === "boolean" ? parsed.isPublic : null,
      ownerSub: typeof parsed.ownerSub === "string" ? parsed.ownerSub : null,
      ownerWallet: typeof parsed.ownerWallet === "string" ? parsed.ownerWallet : null,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : null,
    };
  } catch {
    return null;
  }
}

export async function writeCuratedVisibility(supabase, slug, { isPublic, ownerSub, ownerWallet }) {
  await ensureBucket(supabase);
  const body = JSON.stringify({
    isPublic: !!isPublic,
    ownerSub: ownerSub || null,
    ownerWallet: ownerWallet || null,
    updatedAt: new Date().toISOString(),
  });
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(`${slug}.json`, Buffer.from(body, "utf8"), { upsert: true, contentType: "application/json" });
  if (error) throw new Error(error.message || "visibility_write_failed");
}

/**
 * Decide whether the caller may manage this showcase's visibility. Kept light on
 * purpose (this is a "show off your fish" feature, not money/ownership):
 *   - If the session token carries a wallet, it must match the curated owner.
 *   - Otherwise, bind on first use (trust-on-first-use) to the Privy user id,
 *     and thereafter require the same user id.
 */
export function authorizeCuratedManage(entry, tokenResult, existing) {
  const tokenWallet = typeof tokenResult.walletAddress === "string"
    ? tokenResult.walletAddress.toLowerCase() : null;

  if (tokenWallet && entry.ownerWallet) {
    return tokenWallet === entry.ownerWallet
      ? { ok: true, ownerSub: tokenResult.userId, ownerWallet: tokenWallet }
      : { ok: false };
  }

  // No wallet claim in the token — bind/verify by Privy user id.
  if (!existing || !existing.ownerSub) {
    return { ok: true, ownerSub: tokenResult.userId, ownerWallet: existing?.ownerWallet || entry.ownerWallet || null };
  }
  if (existing.ownerSub === tokenResult.userId) {
    return { ok: true, ownerSub: tokenResult.userId, ownerWallet: existing.ownerWallet || entry.ownerWallet || null };
  }
  return { ok: false };
}
