/**
 * chunkErrorRecovery.js
 *
 * Auto-recovers from "stale shell" failures — the class of bug where a
 * browser tab or installed PWA window has an old cached app.html (served by
 * an already-active service worker) that references hashed JS/CSS chunk
 * filenames from a PREVIOUS deployment. Once a new deploy ships, Vercel's
 * production URL only serves the latest build's output, so those old
 * filenames 404 (`Failed to load resource: 404` on `/assets/app-XXXX.js`).
 *
 * This happens even after fully quitting and reopening a desktop/PWA window,
 * because service workers persist per-origin independent of open tabs — the
 * browser keeps using the already-active (stale) worker until it detects and
 * activates an update, which by default only happens on its own schedule.
 *
 * Fix: detect the specific error signatures for a failed dynamic import /
 * chunk load, then unregister the stale service worker (which also clears
 * its grip on serving the cached app-shell) and force a real network reload.
 * That reload bypasses the stale worker entirely, so the browser fetches the
 * CURRENT app.html + chunk manifest from Vercel directly. The SW re-registers
 * itself on the fresh page load (see PwaManager.jsx), so offline support
 * comes right back — this is a one-time, self-healing hiccup, not a
 * permanent loss of PWA functionality.
 *
 * Guarded against loops: only auto-recovers once per session, and only if
 * the last recovery attempt wasn't within the last 15 seconds (covers the
 * pathological case where the underlying deployment itself is broken and
 * reloading would just 404 again forever).
 */

const SESSION_KEY = "aquadex_chunk_recovery_attempted_at";
const MIN_RETRY_GAP_MS = 15000;

// Matches the browser/bundler error messages produced when a dynamic
// import() or a <script type="module"> fails to load — covers Chromium,
// Firefox, and Safari's differing wording.
const CHUNK_ERROR_PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /importing a module script failed/i,
  /loading chunk [\w-]+ failed/i,
  /error loading dynamically imported module/i,
];

/**
 * Whether an error (or its message string) matches the stale-chunk pattern.
 */
export function isChunkLoadError(errorOrMessage) {
  const message =
    typeof errorOrMessage === "string"
      ? errorOrMessage
      : errorOrMessage?.message || errorOrMessage?.reason?.message || "";
  if (!message) return false;
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

function canAttemptRecovery() {
  try {
    const lastAttempt = Number(sessionStorage.getItem(SESSION_KEY) || 0);
    return Date.now() - lastAttempt > MIN_RETRY_GAP_MS;
  } catch {
    // sessionStorage unavailable (private mode edge cases) — allow one attempt.
    return true;
  }
}

function markRecoveryAttempted() {
  try {
    sessionStorage.setItem(SESSION_KEY, String(Date.now()));
  } catch {
    // Non-fatal — worst case we lose the loop guard, not the recovery itself.
  }
}

/**
 * Unregister any active service worker(s) for this origin, then force a
 * real network reload. Bypasses the stale worker so the browser fetches the
 * current deployment's app shell and chunk manifest directly.
 */
async function recoverFromStaleChunk() {
  markRecoveryAttempted();
  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((reg) => reg.unregister()));
    }
  } catch (err) {
    console.warn("[ChunkRecovery] Service worker unregister failed:", err);
  } finally {
    // location.reload() on a plain navigation (no SW intercepting anymore)
    // always hits the network for a fresh app.html + current asset hashes.
    window.location.reload();
  }
}

/**
 * Handle a caught error: if it matches the stale-chunk signature and we
 * haven't already tried recovering very recently, auto-recover. Returns true
 * if recovery was triggered (caller can skip showing an error UI).
 */
export function tryRecoverFromChunkError(errorOrMessage) {
  if (!isChunkLoadError(errorOrMessage)) return false;
  if (!canAttemptRecovery()) {
    console.warn("[ChunkRecovery] Stale chunk error recurred within the retry window — not auto-reloading again.");
    return false;
  }
  console.warn("[ChunkRecovery] Detected a stale app shell (chunk 404 after a new deployment). Recovering...");
  recoverFromStaleChunk();
  return true;
}

/**
 * Install global listeners for stale-chunk failures. Call once, as early as
 * possible in the app's entry point, so even failures during initial module
 * loading are caught.
 */
export function installChunkErrorRecovery() {
  window.addEventListener("error", (event) => {
    tryRecoverFromChunkError(event.error || event.message);
  });

  window.addEventListener("unhandledrejection", (event) => {
    tryRecoverFromChunkError(event.reason);
  });
}
