/**
 * vertex.ts — Gemini on Vertex AI for the Edge Functions.
 *
 * THE GAP THIS CLOSES. Every AI call in the Edge Functions went to the AI Studio
 * endpoint (generativelanguage.googleapis.com) as `gemini-2.0-flash` with a
 * GEMINI_API_KEY. That model is retired and the call failed, and the functions
 * read a failure as an empty answer: `breeder-summary` wrote "Active community
 * member." into profiles every week, and `reef-digest` never produced a digest.
 *
 * Same route as the app (frontend/api/_lib/vertexClient.js): a service account
 * signs a JWT, trades it for an OAuth token, and calls Vertex on the global
 * endpoint, where the 3.x models live. Same default model as the app's
 * structured tasks (gemini-3.5-flash-lite, no hidden "thinking", about a
 * second), with the same fallback when it 404s or is rate limited.
 *
 * Config (Supabase secrets):
 *   GCP_SERVICE_ACCOUNT_B64   base64 of the service-account JSON (preferred: it
 *                             survives dotenv parsing unchanged)
 *   GCP_SERVICE_ACCOUNT_JSON  the JSON itself (also accepted)
 *   GCP_PROJECT_ID            e.g. "aquacellum"
 *   AI_MODEL_EDGE / AI_MODEL_EDGE_FALLBACK / AI_LOCATION_EDGE   optional overrides
 *
 * DELIBERATELY DEPENDENCY-FREE, like pushPreferences.ts: it imports nothing and
 * takes `env` and `fetch` as injectable dependencies, so vitest in the frontend
 * workspace can test it (frontend/src/__tests__/edgeVertex.test.js).
 *
 * A failure returns `{ text: null, reason }`, never throws and never returns a
 * placeholder sentence. Callers decide what an honest fallback is.
 */

export const EDGE_MODEL = "gemini-3.5-flash-lite";
export const EDGE_FALLBACK = "gemini-3.1-flash-lite";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/cloud-platform";

export type EnvGetter = (name: string) => string | undefined;

export interface ServiceAccount {
  client_email: string;
  private_key: string;
}

export interface AiOptions {
  maxOutputTokens?: number;
  temperature?: number;
  /** Ask for JSON matching this schema (Vertex responseSchema). */
  schema?: Record<string, unknown>;
  /** Images to send with the prompt, already base64. */
  images?: Array<{ mimeType: string; data: string }>;
  timeoutMs?: number;
}

export interface AiResult {
  text: string | null;
  model: string | null;
  reason?: string;
}

export interface AiDeps {
  env?: EnvGetter;
  fetch?: typeof fetch;
  now?: () => number;
}

export function defaultEnv(name: string): string | undefined {
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  if (g.Deno?.env?.get) return g.Deno.env.get(name) ?? undefined;
  return g.process?.env?.[name];
}

const enc = new TextEncoder();

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

const b64url = (bytes: Uint8Array) => bytesToB64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The service account from the environment, or null when it is missing or unreadable. */
export function readServiceAccount(env: EnvGetter = defaultEnv): ServiceAccount | null {
  const b64 = (env("GCP_SERVICE_ACCOUNT_B64") || "").trim();
  const inline = (env("GCP_SERVICE_ACCOUNT_JSON") || "").trim();
  let text = "";
  try {
    if (b64) text = new TextDecoder().decode(b64ToBytes(b64));
    else if (inline) text = inline;
    else return null;
    const parsed = JSON.parse(text);
    if (!parsed?.client_email || !parsed?.private_key) return null;
    if (!String(parsed.private_key).includes("\n")) {
      parsed.private_key = String(parsed.private_key).replace(/\\n/g, "\n");
    }
    return { client_email: parsed.client_email, private_key: parsed.private_key };
  } catch {
    return null;
  }
}

/** True when there is enough config to call Vertex. */
export function aiConfigured(env: EnvGetter = defaultEnv): boolean {
  return !!readServiceAccount(env) && !!(env("GCP_PROJECT_ID") || "").trim();
}

function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return b64ToBytes(body);
}

/** A signed RS256 JWT for Google's token endpoint. Exported for the test. */
export async function signServiceJwt(sa: ServiceAccount, nowSec: number): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iss: sa.client_email, sub: sa.client_email, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600, scope: SCOPE };
  const input = `${b64url(enc.encode(JSON.stringify(header)))}.${b64url(enc.encode(JSON.stringify(payload)))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(input)));
  return `${input}.${b64url(sig)}`;
}

// One token per isolate, reused until a minute before it expires.
let cached: { email: string; token: string; expSec: number } | null = null;

/** Forget the cached token. For tests. */
export function resetTokenCache(): void {
  cached = null;
}

async function accessToken(sa: ServiceAccount, f: typeof fetch, nowSec: number): Promise<string> {
  if (cached && cached.email === sa.client_email && cached.expSec - 60 > nowSec) return cached.token;
  const jwt = await signServiceJwt(sa, nowSec);
  const res = await f(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${jwt}`,
  });
  if (!res.ok) throw new Error(`token exchange ${res.status}`);
  const data = await res.json();
  if (!data?.access_token) throw new Error("token exchange returned no token");
  cached = { email: sa.client_email, token: data.access_token, expSec: nowSec + Math.min(3600, Number(data.expires_in) || 3600) };
  return cached.token;
}

/** Vertex URL for a model. The 3.x models are only on the global host. */
export function vertexUrl(project: string, location: string, model: string): string {
  const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
}

/** The answer text, without thought parts. Null when there is none. */
export function readText(data: unknown): string | null {
  // deno-lint-ignore no-explicit-any
  const parts = (data as any)?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts
    .filter((p) => p && typeof p.text === "string" && !p.thought)
    .map((p) => p.text)
    .join("")
    .trim();
  return text || null;
}

/**
 * Generate text. Returns `{ text: null, reason }` on any failure.
 *
 * @param prompt the whole prompt
 * @param opts   generation settings
 * @param deps   injectable env / fetch / clock (tests)
 */
export async function generateText(prompt: string, opts: AiOptions = {}, deps: AiDeps = {}): Promise<AiResult> {
  const env = deps.env || defaultEnv;
  const f = deps.fetch || fetch;
  const nowSec = Math.floor((deps.now ? deps.now() : Date.now()) / 1000);
  const sa = readServiceAccount(env);
  const project = (env("GCP_PROJECT_ID") || "").trim();
  if (!sa || !project) return { text: null, model: null, reason: "not_configured" };

  const primary = (env("AI_MODEL_EDGE") || "").trim() || EDGE_MODEL;
  const fallback = (env("AI_MODEL_EDGE_FALLBACK") || "").trim() || EDGE_FALLBACK;
  const location = (env("AI_LOCATION_EDGE") || "").trim() || "global";

  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  for (const img of opts.images || []) parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: opts.maxOutputTokens ?? 256,
    temperature: opts.temperature ?? 0.4,
  };
  if (opts.schema) {
    generationConfig.responseMimeType = "application/json";
    generationConfig.responseSchema = opts.schema;
  }
  const body = JSON.stringify({ contents: [{ role: "user", parts }], generationConfig });

  let token: string;
  try {
    token = await accessToken(sa, f, nowSec);
  } catch (err) {
    console.warn("[vertex] auth failed:", (err as Error).message);
    return { text: null, model: null, reason: "auth_failed" };
  }

  // A request occasionally hangs with no answer (seen 2026-10-01: one call in a
  // handful sat for the full 20 s), so a timeout or network failure also moves
  // on to the fallback rather than giving up.
  const models = primary === fallback ? [primary, primary] : [primary, fallback];
  let lastReason = "no_answer";
  for (const model of models) {
    let res: Response;
    try {
      res = await f(vertexUrl(project, location, model), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 12000),
      });
    } catch (err) {
      console.warn(`[vertex] ${model} request failed:`, (err as Error).message);
      lastReason = "network";
      continue;
    }
    if (res.ok) {
      const text = readText(await res.json().catch(() => null));
      return text ? { text, model } : { text: null, model, reason: "empty" };
    }
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    console.warn(`[vertex] ${model} returned ${res.status}: ${detail}`);
    lastReason = `http_${res.status}`;
    // A retired model (404), quota (429) or a server error (5xx) is worth one
    // try on the fallback. A bad request or a permissions error is not.
    if (res.status !== 404 && res.status !== 429 && res.status < 500) break;
  }
  return { text: null, model: null, reason: lastReason };
}

/** JSON from a schema-constrained answer, or null. */
export function parseJson<T = unknown>(text: string | null): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    const m = /[[{][\s\S]*[\]}]/.exec(text);
    if (!m) return null;
    try {
      return JSON.parse(m[0]) as T;
    } catch {
      return null;
    }
  }
}

/**
 * House style for generated sentences that land in the app as Echo's words:
 * no wrapping quotes or markdown, no exclamation points, no em dashes. The
 * prompts ask for this too; this is the backstop.
 */
export function tidyGenerated(text: string | null): string | null {
  if (!text) return null;
  const out = text
    .replace(/\*\*|__|[*_`#]/g, "")
    // Em dashes only: an en dash is a range ("24–28°C") and stays.
    .replace(/\s*—\s*/g, ", ")
    .replace(/!+/g, ".")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim();
  return out || null;
}
