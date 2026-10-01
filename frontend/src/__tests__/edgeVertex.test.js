/**
 * Tests for supabase/functions/_shared/vertex.ts and callerRole.ts.
 *
 * WHY. The Edge Functions called a retired model with an AI Studio key and read
 * the failure as an empty answer, so breeder-summary wrote "Active community
 * member." into profiles every week and nobody could tell. These pin the parts
 * that would fail the same way again: the JWT the token exchange depends on,
 * the fallback when a model is retired, and the rule that a failure is a null
 * the caller can see, never a placeholder sentence.
 *
 * Both modules are dependency-free so they can be tested here (the
 * pushPreferences.ts precedent).
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { generateKeyPairSync, createVerify } from "node:crypto";
import {
  EDGE_FALLBACK,
  EDGE_MODEL,
  aiConfigured,
  generateText,
  parseJson,
  readServiceAccount,
  readText,
  resetTokenCache,
  signServiceJwt,
  tidyGenerated,
  vertexUrl,
} from "../../../supabase/functions/_shared/vertex.ts";
import { bearerRole, isDryRun, requireServiceRole } from "../../../supabase/functions/_shared/callerRole.ts";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" });
const SA = { client_email: "edge@test.iam.gserviceaccount.com", private_key: PEM };
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

function envOf(vars) {
  return (name) => vars[name];
}

const ENV = envOf({ GCP_SERVICE_ACCOUNT_B64: b64(JSON.stringify(SA)), GCP_PROJECT_ID: "aquacellum" });

function reply(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) };
}

/** A fetch that answers the token exchange, then each model call in turn. */
function fakeFetch(modelReplies) {
  const calls = [];
  const queue = [...modelReplies];
  const f = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
      return reply(200, { access_token: "tok", expires_in: 3600 });
    }
    return queue.shift() || reply(500, { error: "unexpected call" });
  });
  return { f, calls };
}

const answer = (text) => reply(200, { candidates: [{ content: { parts: [{ text }] } }] });

beforeEach(() => resetTokenCache());

describe("service account config", () => {
  it("reads the base64 form and the inline JSON form", () => {
    expect(readServiceAccount(ENV)?.client_email).toBe(SA.client_email);
    const inline = envOf({ GCP_SERVICE_ACCOUNT_JSON: JSON.stringify(SA) });
    expect(readServiceAccount(inline)?.private_key).toContain("BEGIN PRIVATE KEY");
  });

  it("is not configured without a project or with unreadable JSON", () => {
    expect(aiConfigured(ENV)).toBe(true);
    expect(aiConfigured(envOf({ GCP_SERVICE_ACCOUNT_B64: b64(JSON.stringify(SA)) }))).toBe(false);
    expect(readServiceAccount(envOf({ GCP_SERVICE_ACCOUNT_JSON: "{not json" }))).toBeNull();
    // The retired AI Studio key alone is not a configuration any more.
    expect(aiConfigured(envOf({ GEMINI_API_KEY: "x" }))).toBe(false);
  });
});

describe("the token exchange JWT", () => {
  it("is RS256, signed by the service account, for the cloud-platform scope", async () => {
    const jwt = await signServiceJwt(SA, 1_800_000_000);
    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const payload = JSON.parse(Buffer.from(p, "base64url").toString());
    expect(payload).toMatchObject({
      iss: SA.client_email,
      aud: "https://oauth2.googleapis.com/token",
      scope: "https://www.googleapis.com/auth/cloud-platform",
      iat: 1_800_000_000,
      exp: 1_800_003_600,
    });
    const ok = createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s, "base64url"));
    expect(ok).toBe(true);
  });
});

describe("generateText", () => {
  it("calls the global Vertex endpoint with the default model", async () => {
    const { f, calls } = fakeFetch([answer("Hello from Echo.")]);
    const res = await generateText("hi", {}, { env: ENV, fetch: f });
    expect(res).toEqual({ text: "Hello from Echo.", model: EDGE_MODEL });
    expect(calls[1].url).toBe(vertexUrl("aquacellum", "global", EDGE_MODEL));
    expect(calls[1].url).toMatch(/^https:\/\/aiplatform\.googleapis\.com\/v1\/projects\/aquacellum\/locations\/global\//);
    expect(calls[1].init.headers.Authorization).toBe("Bearer tok");
  });

  it("falls back once when the model is retired (404) or rate limited (429)", async () => {
    const { f, calls } = fakeFetch([reply(404, { error: "gone" }), answer("From the fallback.")]);
    const res = await generateText("hi", {}, { env: ENV, fetch: f });
    expect(res).toEqual({ text: "From the fallback.", model: EDGE_FALLBACK });
    expect(calls[2].url).toContain(EDGE_FALLBACK);
  });

  it("moves on to the fallback when a request hangs or the network fails", async () => {
    const calls = [];
    const f = vi.fn(async (url) => {
      calls.push(String(url));
      if (String(url).includes("oauth2")) return reply(200, { access_token: "tok", expires_in: 3600 });
      if (calls.filter((u) => !u.includes("oauth2")).length === 1) throw new Error("The operation was aborted due to timeout");
      return answer("Second try.");
    });
    expect(await generateText("hi", {}, { env: ENV, fetch: f })).toEqual({ text: "Second try.", model: EDGE_FALLBACK });
  });

  it("does not retry other errors, and reports a failure as null with a reason", async () => {
    const { f, calls } = fakeFetch([reply(403, { error: "denied" })]);
    const res = await generateText("hi", {}, { env: ENV, fetch: f });
    expect(res).toEqual({ text: null, model: null, reason: "http_403" });
    expect(calls).toHaveLength(2);
  });

  it("returns not_configured without calling anything", async () => {
    const { f } = fakeFetch([]);
    expect(await generateText("hi", {}, { env: envOf({}), fetch: f })).toMatchObject({ text: null, reason: "not_configured" });
    expect(f).not.toHaveBeenCalled();
  });

  it("reuses the token within an isolate", async () => {
    const { f, calls } = fakeFetch([answer("a"), answer("b")]);
    await generateText("1", {}, { env: ENV, fetch: f, now: () => 1_800_000_000_000 });
    await generateText("2", {}, { env: ENV, fetch: f, now: () => 1_800_000_600_000 });
    expect(calls.filter((c) => c.url.includes("oauth2")).length).toBe(1);
  });

  it("sends a schema as JSON mode, and images as inline data", async () => {
    const { f, calls } = fakeFetch([answer('{"flagged":false}')]);
    await generateText("classify", { schema: { type: "object" }, images: [{ mimeType: "image/png", data: "AAAA" }] }, { env: ENV, fetch: f });
    const body = JSON.parse(calls[1].init.body);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    expect(body.contents[0].parts[1]).toEqual({ inlineData: { mimeType: "image/png", data: "AAAA" } });
  });
});

describe("reading answers", () => {
  it("skips thought parts and treats an empty answer as none", () => {
    expect(readText({ candidates: [{ content: { parts: [{ text: "hidden", thought: true }, { text: "shown" }] } }] })).toBe("shown");
    expect(readText({ candidates: [{ content: { parts: [{ text: "  " }] } }] })).toBeNull();
    expect(readText({ error: "x" })).toBeNull();
  });

  it("parses JSON, including JSON wrapped in prose", () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson('Sure: [{"pick":"2"}]')).toEqual([{ pick: "2" }]);
    expect(parseJson("nope")).toBeNull();
  });

  it("tidies to house style but keeps temperature ranges", () => {
    expect(tidyGenerated('"Great week — 3 posts!"')).toBe("Great week, 3 posts.");
    expect(tidyGenerated("**Warm** water, 24–28°C.")).toBe("Warm water, 24–28°C.");
    expect(tidyGenerated("  ")).toBeNull();
  });
});

describe("caller role", () => {
  const jwt = (payload) => `Bearer h.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
  const req = (auth, url = "https://x.test/functions/v1/reef-digest") =>
    new Request(url, { headers: auth ? { Authorization: auth } : {} });

  it("lets the service role through and refuses everyone else", () => {
    expect(bearerRole(req(jwt({ role: "service_role" })))).toBe("service_role");
    expect(requireServiceRole(req(jwt({ role: "service_role" })))).toBeNull();
    expect(requireServiceRole(req(jwt({ role: "anon" })))?.status).toBe(403);
    expect(requireServiceRole(req(null))?.status).toBe(403);
    expect(requireServiceRole(req("Bearer sb_secret_notajwt"))?.status).toBe(403);
  });

  it("reads ?dry=1", () => {
    expect(isDryRun(req(null, "https://x.test/f?dry=1"))).toBe(true);
    expect(isDryRun(req(null, "https://x.test/f"))).toBe(false);
  });
});

describe("no Edge Function still calls the retired endpoint", () => {
  it("has no generativelanguage / gemini-2.0 / GEMINI_API_KEY left", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = fileURLToPath(new URL("../../../supabase/functions/", import.meta.url));
    const files = [];
    const walk = (d) => readdirSync(d).forEach((n) => {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts")) files.push(p);
    });
    walk(root);
    const offenders = files.filter((p) => {
      const src = readFileSync(p, "utf8");
      // vertex.ts names the old endpoint in its history comment only.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      return /generativelanguage\.googleapis|gemini-2\.0|GEMINI_API_KEY/.test(code);
    });
    expect(offenders).toEqual([]);
  });
});
