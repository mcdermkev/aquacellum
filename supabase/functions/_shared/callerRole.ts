/**
 * callerRole.ts — who is calling this Edge Function.
 *
 * WHY. reef-digest, breeder-summary, content-moderation and tide-narration were
 * deployed with JWT verification off, so anyone on the internet could call them:
 * hide any Reef post (content-moderation's spam regex runs before any AI), post
 * system messages into any tide chat, or send every active keeper a digest. They
 * are meant to be called by pg_cron and database webhooks only, with the
 * service-role key.
 *
 * HOW. These functions are deployed with JWT verification ON, so the gateway has
 * already checked the token's signature before the code runs. The code then
 * checks the verified token's `role` claim. That claim is only trustworthy
 * because of the gateway check: a function deployed with --no-verify-jwt must not
 * rely on this.
 *
 * Dependency-free so vitest can test it (frontend/src/__tests__/edgeVertex.test.js).
 */

function b64urlToText(seg: string): string {
  const b64 = seg.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((seg.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** The `role` claim of the request's bearer JWT, or null. */
export function bearerRole(req: Request): string | null {
  const header = (req.headers.get("authorization") || "").trim();
  const m = /^Bearer\s+([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+$/i.exec(header);
  if (!m) return null;
  try {
    const payload = JSON.parse(b64urlToText(m[2]));
    return typeof payload?.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

/** A 403 unless the caller holds the service-role key. Null means go ahead. */
export function requireServiceRole(req: Request): Response | null {
  if (bearerRole(req) === "service_role") return null;
  return new Response(JSON.stringify({ error: "forbidden" }), {
    status: 403,
    headers: { "Content-Type": "application/json" },
  });
}

/** `?dry=1` on the URL: work out the result, write nothing. */
export function isDryRun(req: Request): boolean {
  try {
    const v = new URL(req.url).searchParams.get("dry");
    return v === "1" || v === "true";
  } catch {
    return false;
  }
}
