import { randomBytes } from "node:crypto";
import { chromium } from "playwright";

const BRIDGE_KEY = "__AQUADEX_SHOWCASE_MEDIA_PROOF_V1__";
const EXPECTED_WORKER_PROOF_VERSION = "showcase-media-network-only-v1";
const EXPECTED_PREVIEW_ORIGIN = "https://aquacellum-showcase-proof.vercel.app";

function parseArgs(argv) {
  const result = { mode: "preflight", url: "", timeoutMs: 300000 };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--mode") result.mode = argv[++i] || "";
    else if (value === "--url") result.url = argv[++i] || "";
    else if (value === "--timeout-ms") result.timeoutMs = Number(argv[++i]);
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!new Set(["preflight", "create-room", "run"]).has(result.mode)) {
    throw new Error("--mode must be preflight, create-room, or run");
  }
  const parsed = new URL(result.url);
  if (parsed.protocol !== "https:") throw new Error("--url must be an HTTPS Preview URL");
  if (parsed.origin !== EXPECTED_PREVIEW_ORIGIN) {
    throw new Error(`--url origin must be exactly ${EXPECTED_PREVIEW_ORIGIN}`);
  }
  if (!Number.isSafeInteger(result.timeoutMs) || result.timeoutMs < 30000 || result.timeoutMs > 600000) {
    throw new Error("--timeout-ms must be between 30000 and 600000");
  }
  return result;
}

function safeError(error) {
  const message = typeof error?.message === "string"
    ? error.message.split(/\r?\n/, 1)[0]
    : "Unknown failure";
  return {
    name: error?.name || "Error",
    message,
    code: error?.code || null,
    action: error?.action || null,
    status: Number.isInteger(error?.status) ? error.status : null,
  };
}

async function waitForBridge(page) {
  await page.waitForFunction((key) => window[key]?.version === 1, BRIDGE_KEY, { timeout: 120000 });
}

async function activateReviewedWorker(page) {
  await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) throw new Error("Service workers are unavailable");
    const registration = await navigator.serviceWorker.ready;
    await registration.update();
    if (registration.installing) {
      await new Promise((resolve) => {
        const worker = registration.installing;
        const timer = setTimeout(resolve, 30000);
        worker.addEventListener("statechange", () => {
          if (["installed", "activated", "redundant"].includes(worker.state)) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
    }
    if (registration.waiting) {
      const changed = new Promise((resolve) => {
        const timer = setTimeout(resolve, 30000);
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          clearTimeout(timer);
          resolve();
        }, { once: true });
      });
      registration.waiting.postMessage({ type: "SKIP_WAITING" });
      await changed;
    }
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
  await waitForBridge(page);
  await page.waitForFunction(
    (key) => window[key]?.status().authenticated === true,
    BRIDGE_KEY,
    { timeout: 120000 },
  );
  await page.waitForFunction(() => navigator.serviceWorker?.controller != null, null, { timeout: 120000 });
  const version = await page.evaluate(async () => {
    const controller = navigator.serviceWorker.controller;
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => resolve(null), 3000);
      channel.port1.onmessage = (event) => {
        clearTimeout(timer);
        resolve(event.data?.version || null);
      };
      controller.postMessage({ type: "SHOWCASE_MEDIA_PROOF_VERSION" }, [channel.port2]);
    });
  });
  if (version !== EXPECTED_WORKER_PROOF_VERSION) {
    throw new Error(`Reviewed service worker is not controlling the page (version=${version || "none"})`);
  }
  return version;
}

const args = parseArgs(process.argv.slice(2));
const bypass = String(process.env.VERCEL_AUTOMATION_BYPASS_SECRET || "").trim();
if (!bypass) throw new Error("VERCEL_AUTOMATION_BYPASS_SECRET is required");

let browser;
let context;
let page;
let offline = false;
let exitCode = 0;

try {
  browser = await chromium.launch({ channel: "chromium", headless: false, args: ["--start-maximized"] });
  context = await browser.newContext({
    viewport: null,
    serviceWorkers: args.mode === "create-room" ? "block" : "allow",
  });
  const bypassResponse = await context.request.get(new URL("/", args.url).href, {
    headers: {
      "x-vercel-protection-bypass": bypass,
      "x-vercel-set-bypass-cookie": "true",
    },
  });
  if (!bypassResponse.ok()) {
    throw new Error(`Vercel bypass-cookie bootstrap failed (${bypassResponse.status()})`);
  }
  page = await context.newPage();
  const proofUrl = new URL("/app", args.url);
  proofUrl.searchParams.set("showcase-media-proof", "1");
  proofUrl.searchParams.set("showcase-media-proof-mode", args.mode);
  await page.goto(proofUrl.href, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.bringToFront();
  await waitForBridge(page);

  let status = await page.evaluate((key) => window[key].status(), BRIDGE_KEY);
  if (!status.authenticated) {
    console.log("Complete the normal Privy email OTP login in the opened Chromium window.");
    await page.getByTestId("showcase-media-proof-login").click();
    await page.waitForFunction((key) => window[key]?.status().authenticated === true, BRIDGE_KEY, { timeout: 10 * 60 * 1000 });
    status = await page.evaluate((key) => window[key].status(), BRIDGE_KEY);
  }

  if (args.mode === "preflight") {
    const result = await page.evaluate(async (key) => {
      const bridge = window[key];
      const [preflight, allowlistCandidate] = await Promise.all([
        bridge.preflight(),
        bridge.allowlistCandidate(),
      ]);
      return { preflight, allowlistCandidate };
    }, BRIDGE_KEY);
    console.log(JSON.stringify({ ok: true, mode: args.mode, authenticated: status.authenticated, ...result }, null, 2));
  } else if (args.mode === "create-room") {
    const slug = `showcase-proof-${randomBytes(4).toString("hex")}`;
    const result = await page.evaluate(
      async ({ key, approvedSlug }) => window[key].createApprovedRoom({ slug: approvedSlug }),
      { key: BRIDGE_KEY, approvedSlug: slug },
    );
    if (result?.created !== true || result?.mediaEnabled !== false || result?.hasActiveHero !== false
        || result?.room?.slug !== slug || result?.room?.visibility !== "private" || result?.room?.revision !== 0) {
      throw new Error("The proof bridge returned an invalid sanitized Room-creation result");
    }
    console.log(JSON.stringify({
      ok: true,
      mode: args.mode,
      previewOrigin: new URL(args.url).origin,
      completedAt: new Date().toISOString(),
      creation: {
        schemaVersion: result.schemaVersion,
        created: true,
        mediaEnabled: false,
        room: {
          roomId: result.room.roomId,
          slug: result.room.slug,
          title: result.room.title,
          visibility: "private",
          revision: 0,
        },
        hasActiveHero: false,
      },
    }, null, 2));
  } else {
    const workerVersion = await activateReviewedWorker(page);
    const online = await page.evaluate(
      async ({ key, timeoutMs }) => window[key].runCanonical({ timeoutMs }),
      { key: BRIDGE_KEY, timeoutMs: args.timeoutMs },
    );
    if (online?.online?.workerVersion !== workerVersion) {
      throw new Error("Service-worker proof version changed during the run");
    }
    await context.setOffline(true);
    offline = true;
    const offlineResult = await page.evaluate(
      async ({ key, assetId }) => window[key].offlineProof(assetId),
      { key: BRIDGE_KEY, assetId: online.assetId },
    );
    await context.setOffline(false);
    offline = false;
    const cleanup = await page.evaluate(async (key) => window[key].cleanup(), BRIDGE_KEY);
    console.log(JSON.stringify({
      ok: true,
      mode: args.mode,
      previewOrigin: new URL(args.url).origin,
      completedAt: new Date().toISOString(),
      online,
      offline: offlineResult,
      cleanup,
    }, null, 2));
  }
} catch (error) {
  exitCode = 1;
  if (context && offline) {
    try { await context.setOffline(false); } catch { /* best effort */ }
  }
  let cleanup = null;
  if (page && args.mode === "run") {
    try {
      cleanup = await page.evaluate(async (key) => window[key]?.cleanup ? window[key].cleanup() : null, BRIDGE_KEY);
    } catch {
      cleanup = { attempted: true, completed: false };
    }
  }
  const failure = { ok: false, mode: args.mode, error: safeError(error) };
  if (args.mode === "run") failure.cleanup = cleanup;
  console.error(JSON.stringify(failure, null, 2));
} finally {
  if (context) await context.close();
  if (browser) await browser.close();
}

process.exitCode = exitCode;
