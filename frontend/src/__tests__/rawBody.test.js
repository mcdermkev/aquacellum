/**
 * rawBody helpers + the Stripe webhook wiring that depends on them.
 *
 * Live bug (2026-09-26): every Stripe webhook failed signature verification
 * because the body arrived pre-parsed and was re-serialized. Stripe signs exact
 * bytes, so any whitespace/ordering change breaks the signature. These pin both
 * halves of the fix: the helper returns the untouched bytes, and api/stripe.js
 * turns the platform parser off while restoring req.body for every other action.
 */
import { Readable } from "node:stream";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { readRawBody, attachJsonBody } from "../../api/_lib/rawBody.js";

function fakeReq(bytes, { method = "POST", headers = {} } = {}) {
  const r = Readable.from(bytes === null ? [] : [Buffer.from(bytes)]);
  r.method = method;
  r.headers = headers;
  return r;
}

describe("readRawBody", () => {
  it("returns the exact bytes from the stream, whitespace and all", async () => {
    // Stripe sends pretty-printed JSON; a parse+stringify round trip would lose this.
    const signed = '{\n  "id": "evt_1",\n  "object": "event"\n}';
    const { buf, source } = await readRawBody(fakeReq(signed));
    expect(source).toBe("stream");
    expect(buf.toString("utf8")).toBe(signed);
  });

  it("rejects bodies over the limit", async () => {
    await expect(readRawBody(fakeReq("x".repeat(64)), { maxBytes: 16 })).rejects.toMatchObject({
      code: "BODY_TOO_LARGE",
    });
  });

  it("labels a pre-parsed object as reserialized rather than pretending it is raw", async () => {
    const { source } = await readRawBody({ body: { a: 1 }, readableEnded: true });
    expect(source).toBe("reserialized-object");
  });
});

describe("attachJsonBody", () => {
  it("parses JSON onto req.body for normal actions", async () => {
    const req = fakeReq('{"guest":true,"items":[{"listingId":8000007}]}', {
      headers: { "content-type": "application/json" },
    });
    await expect(attachJsonBody(req)).resolves.toEqual({ ok: true });
    expect(req.body).toEqual({ guest: true, items: [{ listingId: 8000007 }] });
  });

  it("gives an empty body as {} so `req.body || {}` destructuring keeps working", async () => {
    const req = fakeReq(null, { headers: { "content-type": "application/json" } });
    await attachJsonBody(req);
    expect(req.body).toEqual({});
  });

  it("reports invalid JSON as a 400 instead of swallowing it", async () => {
    const req = fakeReq("{not json", { headers: { "content-type": "application/json" } });
    await expect(attachJsonBody(req)).resolves.toEqual({ ok: false, status: 400, error: "Invalid JSON body" });
  });

  it("parses urlencoded forms", async () => {
    const req = fakeReq("a=1&b=two", { headers: { "content-type": "application/x-www-form-urlencoded" } });
    await attachJsonBody(req);
    expect(req.body).toEqual({ a: "1", b: "two" });
  });

  it("leaves GET/OPTIONS alone and never touches an already-present body", async () => {
    const get = fakeReq(null, { method: "GET" });
    await attachJsonBody(get);
    expect(get.body).toBeUndefined();

    const pre = fakeReq('{"x":2}', { headers: { "content-type": "application/json" } });
    pre.body = { x: 1 };
    await attachJsonBody(pre);
    expect(pre.body).toEqual({ x: 1 });
  });

  it("can replace a getter-only body property", async () => {
    const req = fakeReq('{"ok":1}', { headers: { "content-type": "application/json" } });
    Object.defineProperty(req, "body", { get: () => undefined, configurable: true });
    await attachJsonBody(req);
    expect(req.body).toEqual({ ok: 1 });
  });
});

describe("api/stripe.js wiring", () => {
  const SRC = readFileSync(fileURLToPath(new URL("../../api/stripe.js", import.meta.url)), "utf8");
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("disables the platform body parser for the function", () => {
    expect(CODE).toMatch(/export const config = \{ api: \{ bodyParser: false \} \};/);
  });

  it("verifies the webhook against readRawBody bytes, never a re-serialized body", () => {
    const hook = CODE.slice(CODE.indexOf("async function handleWebhook("));
    const verify = hook.slice(0, hook.indexOf("constructEvent(") + 80);
    expect(verify).toMatch(/await readRawBody\(req\)/);
    expect(verify).toMatch(/constructEvent\(buf,/);
    expect(verify).not.toMatch(/JSON\.stringify/);
  });

  it("restores req.body for every action except the webhook, before dispatch", () => {
    const h = CODE.slice(CODE.indexOf("export default async function handler("));
    const guard = h.indexOf('if (action !== "webhook")');
    const attach = h.indexOf("await attachJsonBody(req)");
    const sw = h.indexOf("switch (action)");
    expect(guard).toBeGreaterThan(-1);
    expect(attach).toBeGreaterThan(guard);
    expect(sw).toBeGreaterThan(attach);
  });

  it("has no local body reader left that could reintroduce the bug", () => {
    expect(CODE).not.toMatch(/function getRawBody\(/);
  });
});
