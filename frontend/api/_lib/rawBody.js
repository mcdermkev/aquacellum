/**
 * rawBody.js — request-body helpers for Vercel functions that disable the
 * built-in parser with `export const config = { api: { bodyParser: false } }`.
 *
 * Why a function would do that: signature schemes (Stripe, Mux) sign the EXACT
 * bytes they sent. With Vercel's parser on, `req.body` is already a parsed object
 * and the original bytes are gone; re-serializing it never matches the signature.
 * `api/stripe.js` hit exactly this — every webhook failed verification — so it now
 * turns the parser off and uses these helpers:
 *
 *   - the webhook reads the untouched bytes with `readRawBody`;
 *   - every other action gets `req.body` back via `attachJsonBody`, so existing
 *     handlers that read `req.body.foo` keep working unchanged.
 */

const BODYLESS = new Set(["GET", "HEAD", "OPTIONS"]);
const DEFAULT_MAX_BYTES = 1024 * 1024; // 1 MiB — well above any checkout payload

/**
 * Read the request body bytes exactly as received.
 *
 * Prefers the untouched stream. Falls back to an already-materialized body only
 * if the stream was consumed; a parsed object cannot reproduce the original bytes,
 * so that case is labelled for diagnostics rather than silently trusted.
 *
 * @param {import('http').IncomingMessage & { body?: unknown }} req
 * @param {{ maxBytes?: number }} [opts]
 * @returns {Promise<{ buf: Buffer, source: "stream"|"buffer"|"string"|"reserialized-object"|"empty" }>}
 */
export function readRawBody(req, { maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const streamReadable =
    typeof req?.on === "function" && req.readableEnded !== true && req.complete !== true;
  if (streamReadable) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let total = 0;
      let done = false;
      req.on("data", (chunk) => {
        if (done) return;
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += b.length;
        if (total > maxBytes) {
          done = true;
          reject(Object.assign(new Error("body_too_large"), { code: "BODY_TOO_LARGE" }));
          return;
        }
        chunks.push(b);
      });
      req.on("end", () => { if (!done) { done = true; resolve({ buf: Buffer.concat(chunks), source: "stream" }); } });
      req.on("error", (err) => { if (!done) { done = true; reject(err); } });
    });
  }
  const body = req?.body;
  if (Buffer.isBuffer(body)) return Promise.resolve({ buf: body, source: "buffer" });
  if (typeof body === "string") return Promise.resolve({ buf: Buffer.from(body), source: "string" });
  if (body && typeof body === "object") {
    return Promise.resolve({ buf: Buffer.from(JSON.stringify(body)), source: "reserialized-object" });
  }
  return Promise.resolve({ buf: Buffer.alloc(0), source: "empty" });
}

/** Set req.body even when a platform defined it as a getter-only property. */
function setBody(req, value) {
  Object.defineProperty(req, "body", { value, writable: true, configurable: true, enumerable: true });
}

/**
 * Parse the request body the way Vercel's parser would, and put it on `req.body`.
 *
 * No-op for bodyless methods and when `req.body` is already populated (tests, or a
 * runtime that still parsed it). JSON → object, urlencoded → object, empty → {},
 * anything else → the text. Invalid JSON is reported, not swallowed, so the caller
 * can answer 400 like the platform parser did.
 *
 * @returns {Promise<{ ok: true } | { ok: false, error: string, status: number }>}
 */
export async function attachJsonBody(req, opts) {
  if (BODYLESS.has(String(req?.method || "GET").toUpperCase())) return { ok: true };
  if (req.body !== undefined && req.body !== null) return { ok: true };

  let buf;
  try {
    ({ buf } = await readRawBody(req, opts));
  } catch (err) {
    return err?.code === "BODY_TOO_LARGE"
      ? { ok: false, status: 413, error: "Request body too large" }
      : { ok: false, status: 400, error: "Could not read request body" };
  }

  const text = buf.toString("utf8");
  if (text.trim() === "") { setBody(req, {}); return { ok: true }; }

  const type = String(req.headers?.["content-type"] || "").toLowerCase();
  if (type.includes("application/json") || (!type && /^\s*[{[]/.test(text))) {
    try {
      setBody(req, JSON.parse(text));
      return { ok: true };
    } catch {
      return { ok: false, status: 400, error: "Invalid JSON body" };
    }
  }
  if (type.includes("application/x-www-form-urlencoded")) {
    setBody(req, Object.fromEntries(new URLSearchParams(text)));
    return { ok: true };
  }
  setBody(req, text);
  return { ok: true };
}
