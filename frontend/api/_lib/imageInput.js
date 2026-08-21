/**
 * imageInput.js — turn caller-supplied image input into a Gemini `inlineData` part.
 *
 * Shared by every `api/ai.js` action that accepts an image, so the size cap and the
 * URL rules are decided once instead of per handler.
 *
 * ── Why the URL path is restricted ───────────────────────────────────────────
 * The original alt-text handler did `await fetch(imageUrl)` on whatever string the
 * caller sent. That makes the serverless function fetch arbitrary URLs on request:
 * a request proxy, and a way to probe hosts that are only reachable from inside the
 * platform. It is a server-side request forgery surface, and it was reachable
 * without signing in.
 *
 * The legitimate caller does not need arbitrary URLs. `services/mediaUpload.js`
 * uploads to Supabase Storage and passes the resulting public URL, so the only
 * host that ever needs to be fetched is this project's own Supabase host. That is
 * an allowlist of one, derived from the same env var the app already configures.
 *
 * The base64 path has no such problem — the bytes arrive in the request — so it is
 * the preferred input and the only one a new caller should use.
 */

const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3 MB decoded

/**
 * Hosts we are willing to fetch an image from.
 *
 * Derived from the configured Supabase URL rather than hardcoded, so a project
 * move does not silently leave a stale host allowed. `EXTRA_IMAGE_HOSTS` is a
 * comma-separated escape hatch for a future CDN; it is intentionally empty by
 * default, because every entry is a host the server can be made to talk to.
 */
function allowedImageHosts() {
  const hosts = new Set();

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  if (supabaseUrl.trim()) {
    try {
      hosts.add(new URL(supabaseUrl).host.toLowerCase());
    } catch {
      // Malformed env — better to allow nothing than to guess.
    }
  }

  const extra = process.env.EXTRA_IMAGE_HOSTS || '';
  for (const h of extra.split(',')) {
    const trimmed = h.trim().toLowerCase();
    if (trimmed) hosts.add(trimmed);
  }

  return hosts;
}

/**
 * True when a URL is one we will fetch: https, on an allowlisted host.
 *
 * The host check alone would be enough today, but the scheme and literal-IP checks
 * stay as a second line so that adding a host to the allowlist later cannot also
 * quietly re-open `http://` or an address-literal bypass.
 */
export function isFetchableImageUrl(raw) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    return false;
  }

  if (url.protocol !== 'https:') return false;

  const host = url.hostname.toLowerCase();

  // Reject address literals outright; an allowlist is a list of NAMES.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  if (host.includes(':') || host.startsWith('[')) return false; // IPv6 literal
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return false;

  return allowedImageHosts().has(host);
}

/**
 * Build the Gemini image part from `{ imageUrl, imageBase64 }`.
 *
 * @returns {Promise<{part: object}|{error: string, status?: number}>}
 */
export async function resolveImagePart({ imageUrl, imageBase64 }) {
  if (imageBase64) {
    const match = /^data:(image\/(?:png|jpe?g|webp|gif));base64,(.+)$/i.exec(String(imageBase64));

    // A bare base64 string with no data-URL prefix was previously assumed to be
    // JPEG. Keep accepting it — `generateAltTextFromBase64` relies on it — but
    // still size-check it.
    const mimeType = match ? match[1].toLowerCase() : 'image/jpeg';
    const data = match ? match[2] : String(imageBase64);

    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(data.slice(0, 128))) {
      return { error: 'Image data is not valid base64', status: 400 };
    }

    const bytes = Buffer.byteLength(data, 'base64');
    if (bytes > MAX_IMAGE_BYTES) {
      return {
        error: `Image is ${(bytes / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_IMAGE_BYTES / 1024 / 1024} MB. Compress it before sending.`,
        status: 413,
      };
    }

    return { part: { inlineData: { mimeType, data } } };
  }

  if (!imageUrl) {
    return { error: 'Provide imageUrl or imageBase64', status: 400 };
  }

  if (!isFetchableImageUrl(imageUrl)) {
    return {
      error: 'imageUrl must be an https URL on an allowed host. Send imageBase64 instead.',
      status: 400,
    };
  }

  let response;
  try {
    response = await fetch(imageUrl);
  } catch {
    return { error: 'Could not fetch image', status: 502 };
  }
  if (!response.ok) return { error: 'Could not fetch image', status: 502 };

  const contentType = (response.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
  if (!contentType.startsWith('image/')) {
    return { error: 'That URL is not an image', status: 400 };
  }

  // Trust the header only as an early out; the real check is on the bytes read,
  // since content-length can be absent or wrong.
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared && declared > MAX_IMAGE_BYTES) {
    return { error: 'Image is too large', status: 413 };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    return { error: 'Image is too large', status: 413 };
  }

  return { part: { inlineData: { mimeType: contentType, data: buffer.toString('base64') } } };
}

export { MAX_IMAGE_BYTES };
