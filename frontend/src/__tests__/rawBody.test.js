/**
 * readRawBody + the Stripe webhook wiring that depends on it.
 *
 * Live bug (2026-09-26): every Stripe webhook failed signature verification.
 * Vercel's Node runtime reads the body up front, exposes `req.body` as a lazy
 * parse, and REPLAYS the bytes through req.on("data"/"end"). The reader saw the
 * original stream as finished, skipped listening, and re-serialized the parsed
 * object — which never matches the pretty-printed bytes Stripe signed.
 */
import { PassThrough, Readable } from "node:stream";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { readRawBody } from "../../api/_lib/rawBody.js";

const SIGNED = '{\n  "id": "evt_1",\n  "object": "event",\n  "type": "checkout.session.expired"\n}';

/**
 * Reproduce @vercel/node's addHelpers/restoreBody: the socket stream is already
 * consumed, `req.body` is a lazy JSON parse, and data/end listeners are routed
 * to a PassThrough that replays the original bytes.
 */
function vercelLikeReq(bytes) {
  const req = Readable.from([]);
  req.resume(); // consume the original stream, as serializeBody does
  req.complete = true;
  const replay = new PassThrough();
  const on = replay.on.bind(replay);
  const originalOn = req.on.bind(req);
  req.on = req.addListener = (name, cb) =>
    name === "data" || name === "end" ? on(name, cb) : originalOn(name, cb);
  replay.write(Buffer.from(bytes));
  replay.end();
  Object.defineProperty(req, "body", { get: () => JSON.parse(bytes), configurable: true });
  req.headers = { "content-type": "application/json" };
  return req;
}

describe("readRawBody", () => {
  it("returns Vercel's replayed bytes exactly, not a re-serialized req.body", async () => {
    const req = vercelLikeReq(SIGNED);
    const { buf, source } = await readRawBody(req);
    expect(source).toBe("stream");
    expect(buf.toString("utf8")).toBe(SIGNED);
    // The bug: this is what the old reader produced, and it differs from SIGNED.
    expect(JSON.stringify(req.body)).not.toBe(SIGNED);
  });

  it("reads a plain unconsumed stream (helpers disabled / local dev)", async () => {
    const req = Readable.from([Buffer.from(SIGNED)]);
    const { buf, source } = await readRawBody(req);
    expect(source).toBe("stream");
    expect(buf.toString("utf8")).toBe(SIGNED);
  });

  it("rejects bodies over the limit", async () => {
    await expect(readRawBody(Readable.from([Buffer.from("x".repeat(64))]), { maxBytes: 16 })).rejects.toMatchObject({
      code: "BODY_TOO_LARGE",
    });
  });

  it("does not hang when the stream never ends; falls back and labels it", async () => {
    const stuck = new PassThrough(); // never written or ended
    stuck.body = Buffer.from("raw-bytes");
    const { buf, source } = await readRawBody(stuck, { timeoutMs: 30 });
    expect(source).toBe("buffer");
    expect(buf.toString()).toBe("raw-bytes");
  });

  it("labels a parsed-object fallback so a regression is visible in logs", async () => {
    const { source } = await readRawBody({ body: { a: 1 } });
    expect(source).toBe("reserialized-object");
  });
});

describe("api/stripe.js wiring", () => {
  const SRC = readFileSync(fileURLToPath(new URL("../../api/stripe.js", import.meta.url)), "utf8");
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("verifies the webhook against readRawBody bytes, never a re-serialized body", () => {
    const hook = CODE.slice(CODE.indexOf("async function handleWebhook("));
    const verify = hook.slice(0, hook.indexOf("constructEvent(") + 80);
    expect(verify).toMatch(/await readRawBody\(req\)/);
    expect(verify).toMatch(/constructEvent\(buf,/);
    expect(verify).not.toMatch(/JSON\.stringify/);
  });

  it("has no local body reader left that could reintroduce the bug", () => {
    expect(CODE).not.toMatch(/function getRawBody\(/);
  });
});
