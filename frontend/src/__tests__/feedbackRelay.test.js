/**
 * Feedback relay (/api/retention?action=feedback, api/_lib/feedbackRelay.js).
 *
 * The Discord webhook used to be a VITE_ variable, inlined into the public
 * bundle. These pin that it is now server-only, and that the relay limits size,
 * rate, and what it forwards.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import handleFeedback, {
  validateFeedback,
  buildDiscordPayload,
  sanitizePageUrl,
  sanitizeScreenshotPath,
  screenshotObjectPath,
  feedbackWebhookUrl,
  handleFeedbackUpload,
  pruneFeedbackScreenshots,
  SCREENSHOT_BUCKET,
  SCREENSHOT_LINK_SECONDS,
  MAX_DESCRIPTION,
  RATE_LIMIT,
} from "../../api/_lib/feedbackRelay.js";

const HOOK = "https://discord.com/api/webhooks/123456/abc-DEF_ghi";
const SB = "https://example-project.supabase.co";
const ENV = { FEEDBACK_WEBHOOK_URL: HOOK, SUPABASE_URL: SB };
const UUID = "0f8fad5b-d9cb-469f-a165-70867728950e";

/** Fake service-role client exposing only storage.from(bucket). */
function fakeSupabase({ signUploadError = null, signUrl = "https://signed.example/x?token=t" } = {}) {
  const calls = { bucket: null, signUpload: [], signUrl: [] };
  const factory = vi.fn((url, key) => {
    calls.url = url;
    calls.key = key;
    return {
      storage: {
        from(bucket) {
          calls.bucket = bucket;
          return {
            async createSignedUploadUrl(path) {
              calls.signUpload.push(path);
              return signUploadError ? { data: null, error: signUploadError } : { data: { token: "tok", path }, error: null };
            },
            async createSignedUrl(path, seconds) {
              calls.signUrl.push([path, seconds]);
              return { data: signUrl ? { signedUrl: signUrl } : null, error: null };
            },
          };
        },
      },
    };
  });
  return { factory, calls };
}

function mockRes() {
  const res = { statusCode: 200, body: null, headers: {} };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
}

let ipCounter = 0;
function req(body, { ip, method = "POST", headers = {} } = {}) {
  return {
    method,
    body,
    headers: { "x-forwarded-for": ip || `203.0.113.${++ipCounter}`, ...headers },
  };
}

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

describe("validation", () => {
  it("requires a description and caps its length", () => {
    expect(validateFeedback({ description: "   " })).toMatchObject({ ok: false, status: 400 });
    expect(validateFeedback({ description: "x".repeat(MAX_DESCRIPTION + 1) })).toMatchObject({ ok: false, status: 413 });
    expect(validateFeedback({ description: "ok", category: "bug" })).toMatchObject({ ok: true });
  });

  it("rejects oversized bodies even when the description is short", () => {
    expect(validateFeedback({ description: "ok", padding: "x".repeat(9000) })).toMatchObject({ ok: false, status: 413 });
  });

  it("normalizes category and drops untrusted fields", () => {
    const { value } = validateFeedback(
      {
        description: "hi",
        category: "<script>",
        pageUrl: "https://aquacellum.com/app/tanks?token=secret#tank=9",
        screenSize: "1280x720; drop",
        screenshotUrl: "https://evil.example/x.png",
        screenshotPath: "../reef-media/reef/0xaaaaaaaa/x.png",
        wallet_address: "0x1111111111111111111111111111111111111111",
      }
    );
    expect(value).toEqual({
      category: "other",
      description: "hi",
      pageUrl: "https://aquacellum.com/app/tanks",
      screenSize: null,
      screenshotPath: null,
    });
  });

  it("accepts only screenshot paths the relay hands out", () => {
    const good = screenshotObjectPath("image/png", { now: new Date("2026-10-04T12:00:00Z"), uuid: () => UUID });
    expect(good).toBe(`2026-10-04/${UUID}.png`);
    expect(sanitizeScreenshotPath(good)).toBe(good);
    for (const bad of [`2026-10-04/${UUID}.svg`, `feedback/${UUID}.png`, `2026-10-04/../${UUID}.png`, `2026-10-04/${UUID}.png?x=1`, 42]) {
      expect(sanitizeScreenshotPath(bad)).toBeNull();
    }
    expect(screenshotObjectPath("image/svg+xml")).toBeNull();
    expect(screenshotObjectPath("image/webp")).toMatch(/^\d{4}-\d{2}-\d{2}\/[0-9a-f-]{36}\.webp$/);
  });

  it("strips query strings and fragments from page URLs", () => {
    expect(sanitizePageUrl("http://localhost:4200/app?e2e=1#x")).toBe("http://localhost:4200/app");
    expect(sanitizePageUrl("javascript:alert(1)")).toBeNull();
  });
});

describe("the Discord message", () => {
  it("disables mentions and shows only a shortened verified wallet", () => {
    const payload = buildDiscordPayload(
      { category: "bug", description: "@everyone broke", pageUrl: null, screenSize: null, screenshotPath: null },
      { wallet: "0xabcdef0123456789abcdef0123456789abcdef01" }
    );
    expect(payload.allowed_mentions).toEqual({ parse: [] });
    expect(payload.embeds[0].footer.text).toBe("Wallet: 0xabcd…ef01");
  });
});

describe("webhook configuration", () => {
  it("prefers FEEDBACK_WEBHOOK_URL, falls back to the old name, rejects non-Discord URLs", () => {
    expect(feedbackWebhookUrl({ FEEDBACK_WEBHOOK_URL: HOOK })).toBe(HOOK);
    expect(feedbackWebhookUrl({ VITE_DISCORD_FEEDBACK_WEBHOOK: HOOK })).toBe(HOOK);
    expect(feedbackWebhookUrl({ FEEDBACK_WEBHOOK_URL: "https://evil.example/hook" })).toBeNull();
    expect(feedbackWebhookUrl({})).toBeNull();
  });
});

describe("handler", () => {
  it("only accepts POST", async () => {
    const res = mockRes();
    await handleFeedback(req({}, { method: "GET" }), res, { env: ENV, fetchImpl: vi.fn() });
    expect(res.statusCode).toBe(405);
  });

  it("returns 503 without leaking anything when no webhook is configured", async () => {
    const res = mockRes();
    const fetchImpl = vi.fn();
    await handleFeedback(req({ description: "hi" }), res, { env: { SUPABASE_URL: SB }, fetchImpl });
    expect(res.statusCode).toBe(503);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("relays a valid report and never returns the webhook", async () => {
    const res = mockRes();
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 204 }));
    await handleFeedback(req({ description: "the filter chip is stuck", category: "bug" }), res, { env: ENV, fetchImpl });
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("discord");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(HOOK);
    const sent = JSON.parse(init.body);
    expect(sent.embeds[0].description).toBe("the filter chip is stuck");
    expect(sent.embeds[0].footer.text).toBe("Wallet: not signed in");
  });

  it("maps a Discord failure to a generic 502", async () => {
    const res = mockRes();
    await handleFeedback(req({ description: "hi" }), res, { env: ENV, fetchImpl: async () => ({ ok: false, status: 401 }) });
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({ error: "Could not deliver feedback" });
  });

  it("rate limits per IP", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 204 }));
    const ip = "198.51.100.77";
    const codes = [];
    for (let i = 0; i < RATE_LIMIT.maxRequests + 1; i++) {
      const res = mockRes();
      await handleFeedback(req({ description: `n${i}` }, { ip }), res, { env: ENV, fetchImpl });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, RATE_LIMIT.maxRequests).every((c) => c === 200)).toBe(true);
    expect(codes.at(-1)).toBe(429);
    expect(fetchImpl).toHaveBeenCalledTimes(RATE_LIMIT.maxRequests);
  });

  it("refuses cross-site origins", async () => {
    const res = mockRes();
    await handleFeedback(req({ description: "hi" }, { headers: { origin: "https://evil.example" } }), res, { env: ENV, fetchImpl: vi.fn() });
    expect(res.statusCode).toBe(403);
  });
});

describe("screenshots (private bucket)", () => {
  const SERVER_ENV = { ...ENV, SUPABASE_SERVICE_KEY: "service-key" };

  it("hands out a one-time signed upload for a valid image", async () => {
    const res = mockRes();
    const sb = fakeSupabase();
    await handleFeedbackUpload(req({ contentType: "image/png", size: 1000 }), res, { env: SERVER_ENV, supabaseFactory: sb.factory });
    expect(res.statusCode).toBe(200);
    expect(sb.calls.bucket).toBe(SCREENSHOT_BUCKET);
    expect(res.body.token).toBe("tok");
    expect(sanitizeScreenshotPath(res.body.path)).toBe(res.body.path);
    expect(sb.calls.signUpload).toEqual([res.body.path]);
  });

  it("refuses other types, oversized files, and GET", async () => {
    for (const [body, code] of [
      [{ contentType: "image/svg+xml", size: 10 }, 400],
      [{ contentType: "text/html", size: 10 }, 400],
      [{ contentType: "image/png", size: 6 * 1024 * 1024 }, 413],
      [{ contentType: "image/png", size: 0 }, 413],
    ]) {
      const res = mockRes();
      const sb = fakeSupabase();
      await handleFeedbackUpload(req(body), res, { env: SERVER_ENV, supabaseFactory: sb.factory });
      expect(res.statusCode).toBe(code);
      expect(sb.calls.signUpload).toEqual([]);
    }
    const res = mockRes();
    await handleFeedbackUpload(req({}, { method: "GET" }), res, { env: SERVER_ENV });
    expect(res.statusCode).toBe(405);
  });

  it("returns 503 without a service key and 502 when signing fails", async () => {
    let res = mockRes();
    await handleFeedbackUpload(req({ contentType: "image/png", size: 10 }), res, { env: ENV, supabaseFactory: fakeSupabase().factory });
    expect(res.statusCode).toBe(503);
    res = mockRes();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await handleFeedbackUpload(req({ contentType: "image/png", size: 10 }), res, {
      env: SERVER_ENV, supabaseFactory: fakeSupabase({ signUploadError: { message: "nope" } }).factory,
    });
    warn.mockRestore();
    expect(res.statusCode).toBe(502);
  });

  it("sends the team an expiring signed link, never a public URL", async () => {
    const res = mockRes();
    const sb = fakeSupabase();
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 204 }));
    const path = `2026-10-04/${UUID}.png`;
    await handleFeedback(req({ description: "see pic", screenshotPath: path }), res, { env: SERVER_ENV, fetchImpl, supabaseFactory: sb.factory });
    expect(res.statusCode).toBe(200);
    expect(sb.calls.signUrl).toEqual([[path, SCREENSHOT_LINK_SECONDS]]);
    const field = JSON.parse(fetchImpl.mock.calls[0][1].body).embeds[0].fields.find((f) => f.name === "Screenshot");
    expect(field.value).toContain("https://signed.example/x?token=t");
    expect(field.value).not.toContain("/object/public/");
  });

  it("still relays the report when no link can be made", async () => {
    const res = mockRes();
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 204 }));
    const path = `2026-10-04/${UUID}.png`;
    await handleFeedback(req({ description: "see pic", screenshotPath: path }), res, {
      env: SERVER_ENV, fetchImpl, supabaseFactory: fakeSupabase({ signUrl: null }).factory,
    });
    expect(res.statusCode).toBe(200);
    const field = JSON.parse(fetchImpl.mock.calls[0][1].body).embeds[0].fields.find((f) => f.name === "Screenshot");
    expect(field.value).toContain(path);
  });

  it("prunes only dated folders older than 90 days", async () => {
    const files = {
      "2026-06-01": ["a.png", "b.png"],
      "2026-07-06": ["c.png"],
      "2026-09-30": ["d.png"],
      "not-a-date": ["e.png"],
    };
    const removed = [];
    const storage = {
      async list(prefix) {
        if (prefix === "") return { data: Object.keys(files).map((name) => ({ name, id: null })), error: null };
        return { data: (files[prefix] || []).map((name) => ({ name, id: name })), error: null };
      },
      async remove(paths) {
        removed.push(...paths);
        for (const p of paths) {
          const [day, name] = p.split("/");
          files[day] = files[day].filter((n) => n !== name);
        }
        return { error: null };
      },
    };
    const out = await pruneFeedbackScreenshots(storage, { now: new Date("2026-10-04T00:00:00Z") });
    expect(removed.sort()).toEqual(["2026-06-01/a.png", "2026-06-01/b.png"]);
    expect(out).toEqual({ removed: 2, folders: 1, errors: [] });
  });

  it("the widget uploads through the signed flow, not a public bucket, and keeps nothing locally", () => {
    const widget = read("../components/FeedbackWidget.jsx");
    expect(widget).toContain("action=feedback-upload");
    expect(widget).toContain("uploadToSignedUrl");
    expect(widget).not.toContain("getPublicUrl");
    expect(widget).not.toContain('.from("media")');
    expect(widget).not.toContain("beta_feedback");
    expect(widget).not.toContain("localStorage");
  });
});

describe("the webhook is out of the client bundle", () => {
  it("FeedbackWidget posts to our API, not to Discord, and reads no VITE_ webhook", () => {
    const widget = read("../components/FeedbackWidget.jsx");
    expect(widget).toContain("/api/retention?action=feedback");
    expect(widget).not.toMatch(/VITE_DISCORD/);
    expect(widget).not.toMatch(/discord(app)?\.com\/api\/webhooks/);
  });

  it("the feedback action is dispatched before the cron gate", () => {
    const retention = read("../../api/retention.js");
    const action = retention.indexOf('req.query?.action === "feedback"');
    const gate = retention.indexOf("if (!isCronRequest(req))");
    expect(action).toBeGreaterThan(-1);
    expect(action).toBeLessThan(gate);
  });

  it("no client source references the old VITE_ webhook variable", () => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const hits = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        if (name === "__tests__") continue;
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(jsx?|tsx?)$/.test(name) && readFileSync(full, "utf8").includes("VITE_DISCORD")) hits.push(full);
      }
    };
    walk(root);
    expect(hits).toEqual([]);
  });
});
