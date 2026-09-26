/**
 * rawBody.js — read a request body as the exact bytes the client sent.
 *
 * Needed for signature schemes (Stripe webhooks) that sign raw bytes: any
 * parse + re-serialize changes whitespace/order and breaks the signature.
 *
 * How Vercel's Node runtime behaves (verified in @vercel/node's `addHelpers`):
 * it reads the whole body up front, exposes `req.body` as a lazy parse of those
 * bytes, and REPLAYS the same bytes through `req.on("data" | "end")` via a
 * PassThrough. The original socket stream therefore looks finished
 * (`readableEnded`/`complete` are true) even though listening still yields the
 * exact bytes. An earlier version checked those flags, skipped listening, and
 * re-serialized the parsed object — so every Stripe webhook failed verification
 * (live, 2026-09-26). Always listen; only if nothing arrives within the timeout
 * fall back to an already-materialized Buffer/string body.
 */

const DEFAULT_MAX_BYTES = 1024 * 1024; // 1 MiB — far above any Stripe event
const DEFAULT_TIMEOUT_MS = 5000;

/**
 * @param {import('http').IncomingMessage & { body?: unknown }} req
 * @param {{ maxBytes?: number, timeoutMs?: number }} [opts]
 * @returns {Promise<{ buf: Buffer, source: "stream"|"buffer"|"string"|"reserialized-object"|"empty" }>}
 */
export function readRawBody(req, { maxBytes = DEFAULT_MAX_BYTES, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const fallback = () => {
    // Read `req.body` only here: on Vercel it is a lazy JSON parse, so touching
    // it is harmless, but it can never reproduce the original bytes for JSON.
    let body;
    try { body = req?.body; } catch { body = undefined; }
    if (Buffer.isBuffer(body)) return { buf: body, source: "buffer" };
    if (typeof body === "string") return { buf: Buffer.from(body), source: "string" };
    if (body && typeof body === "object") return { buf: Buffer.from(JSON.stringify(body)), source: "reserialized-object" };
    return { buf: Buffer.alloc(0), source: "empty" };
  };

  if (typeof req?.on !== "function") return Promise.resolve(fallback());

  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let done = false;
    const finish = (fn) => { if (!done) { done = true; clearTimeout(timer); fn(); } };
    const timer = setTimeout(
      () => finish(() => resolve(total > 0 ? { buf: Buffer.concat(chunks), source: "stream" } : fallback())),
      timeoutMs
    );
    req.on("data", (chunk) => {
      if (done) return;
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += b.length;
      if (total > maxBytes) {
        finish(() => reject(Object.assign(new Error("body_too_large"), { code: "BODY_TOO_LARGE" })));
        return;
      }
      chunks.push(b);
    });
    req.on("end", () => finish(() => resolve({ buf: Buffer.concat(chunks), source: "stream" })));
    req.on("error", (err) => finish(() => reject(err)));
  });
}
