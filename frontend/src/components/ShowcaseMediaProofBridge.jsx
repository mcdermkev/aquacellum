import { useEffect, useRef, useState } from "react";
import { useAuth } from "../contexts/AuthContext";

const BRIDGE_KEY = "__AQUADEX_SHOWCASE_MEDIA_PROOF_V1__";
const ROOM_READ_BODY = Object.freeze({
  placementCursor: null,
  placementLimit: 1,
  settingCursor: null,
  settingLimit: 1,
  availableCursor: null,
  availableLimit: 1,
});
const TERMINAL_ASSET_STATES = new Set(["revoked", "deleted", "rejected"]);
const EXPECTED_WORKER_PROOF_VERSION = "showcase-media-network-only-v1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

function proofRequested() {
  if (import.meta.env.VITE_SHOWCASE_MEDIA_PROOF_ENABLED !== "true") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("showcase-media-proof") === "1";
}

function proofError(message, details = {}) {
  const error = new Error(message);
  error.name = "ShowcaseMediaProofError";
  Object.assign(error, details);
  return error;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeJwtClaims(token) {
  const part = typeof token === "string" ? token.split(".")[1] : "";
  if (!part) throw proofError("Privy token is malformed.");
  const padded = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
  try {
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))));
  } catch {
    throw proofError("Privy token claims could not be decoded.");
  }
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function createFixturePng() {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 64;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw proofError("Canvas is unavailable.");
  ctx.fillStyle = "#071827";
  ctx.fillRect(0, 0, 96, 64);
  ctx.fillStyle = "#38bdf8";
  ctx.fillRect(8, 8, 80, 48);
  ctx.fillStyle = "#0f172a";
  ctx.beginPath();
  ctx.arc(48, 32, 16, 0, Math.PI * 2);
  ctx.fill();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob || blob.size < 1 || blob.size > 8 * 1024 * 1024) {
    throw proofError("Deterministic PNG fixture generation failed.");
  }
  const bytes = await blob.arrayBuffer();
  return { blob, byteSize: blob.size, checksumHex: await sha256Hex(bytes) };
}

function safeResponseHeaders(response) {
  return {
    cacheControl: response.headers.get("cache-control"),
    contentType: response.headers.get("content-type"),
    contentLength: response.headers.get("content-length"),
  };
}

function assertNoStore(headers, label) {
  const value = String(headers.cacheControl || "").toLowerCase();
  if (!value.includes("private") || !value.includes("no-store")) {
    throw proofError(`${label} did not return private, no-store.`, { headers });
  }
}

async function cacheMatches(targetUrls) {
  const targets = new Set(targetUrls.map((value) => new URL(value, window.location.origin).href));
  const matches = [];
  for (const cacheName of await caches.keys()) {
    const cache = await caches.open(cacheName);
    for (const request of await cache.keys()) {
      if (targets.has(request.url)) matches.push({ cacheName, url: request.url });
    }
  }
  return matches;
}

async function controlledWorkerProofVersion() {
  const controller = navigator.serviceWorker?.controller;
  if (!controller) return null;
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 3000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(typeof event.data?.version === "string" ? event.data.version : null);
    };
    controller.postMessage({ type: "SHOWCASE_MEDIA_PROOF_VERSION" }, [channel.port2]);
  });
}

async function imageRequest(path) {
  return new Promise((resolve) => {
    const image = new Image();
    const finish = (loaded) => {
      image.onload = null;
      image.onerror = null;
      image.remove();
      resolve({ loaded });
    };
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = path;
    image.style.display = "none";
    document.body.appendChild(image);
  });
}

export function ShowcaseMediaProofBridge() {
  const { ready, authenticated, connectPrivy, getAccessToken } = useAuth();
  const [message, setMessage] = useState("Waiting for authentication");
  const runState = useRef({ assetId: null, originalVisibility: null, visibilityChanged: false });

  useEffect(() => {
    if (!proofRequested()) return undefined;

    async function token() {
      if (!ready || !authenticated || typeof getAccessToken !== "function") {
        throw proofError("A real Privy owner session is required.");
      }
      const value = await getAccessToken();
      if (typeof value !== "string" || value.length < 10) {
        throw proofError("Privy did not return an access token.");
      }
      return value;
    }

    async function ownerAction(action, body, { onDispatch } = {}) {
      const bearer = await token();
      let response;
      try {
        if (typeof onDispatch === "function") onDispatch();
        response = await fetch(`/api/showcase-owner?action=${encodeURIComponent(action)}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${bearer}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          cache: "no-store",
          credentials: "same-origin",
        });
      } finally {
        // The token remains scoped to this browser closure and is never returned by the bridge.
      }
      let envelope;
      try {
        envelope = await response.json();
      } catch {
        throw proofError(`${action} returned invalid JSON.`, { action, status: response.status });
      }
      if (!response.ok || envelope?.ok !== true) {
        throw proofError(`${action} failed.`, {
          action,
          status: response.status,
          code: envelope?.code || "invalid_response",
        });
      }
      return envelope.data;
    }

    async function readRoom() {
      return ownerAction("room-read", ROOM_READ_BODY);
    }

    async function preflight() {
      const [bootstrap, roomResult] = await Promise.all([
        ownerAction("bootstrap", {}),
        readRoom(),
      ]);
      const room = roomResult?.room || null;
      const roomId = room?.roomId || room?.id || null;
      const preview = roomId ? await ownerAction("publication-preview", { roomId }) : null;
      return {
        mediaEnabled: bootstrap?.capabilities?.media === true,
        room: room ? {
          roomId,
          slug: room.slug || null,
          visibility: room.visibility || null,
          revision: room.revision,
          hasActiveHero: preview?.room?.hero != null,
        } : null,
      };
    }

    async function allowlistCandidate() {
      const claims = decodeJwtClaims(await token());
      const wallet = typeof claims.wallet_address === "string" && WALLET_RE.test(claims.wallet_address)
        ? claims.wallet_address.toLowerCase()
        : null;
      const subject = typeof claims.sub === "string" && claims.sub.trim() ? claims.sub.trim() : null;
      if (!wallet && !subject) throw proofError("No publish-allowlist identity exists in the verified token.");
      return { kind: wallet ? "wallet" : "subject", value: wallet || subject };
    }

    async function restoreVisibility() {
      if (!runState.current.visibilityChanged || runState.current.originalVisibility !== "private") return null;
      const latest = await readRoom();
      const room = latest?.room;
      const roomId = room?.roomId || room?.id;
      if (!roomId || !Number.isSafeInteger(room.revision)) {
        throw proofError("Could not refresh Room revision for visibility restoration.");
      }
      const restored = await ownerAction("publication-set", {
        roomId,
        expectedRevision: room.revision,
        visibility: "private",
      });
      runState.current.visibilityChanged = false;
      return { restored: true, visibility: restored?.visibility || "private" };
    }

    async function cleanup() {
      const outcome = { revoked: false, visibilityRestored: false, errors: [] };
      const assetId = runState.current.assetId;
      if (assetId && UUID_RE.test(assetId)) {
        try {
          const status = await ownerAction("media-status", { assetId });
          if (!TERMINAL_ASSET_STATES.has(status?.state) && Number.isSafeInteger(status?.revision)) {
            await ownerAction("media-revoke", { assetId, expectedRevision: status.revision });
            outcome.revoked = true;
          } else {
            outcome.revoked = status?.state === "revoked";
          }
        } catch (error) {
          outcome.errors.push({ step: "revoke", code: error.code || error.name });
        }
      }
      try {
        const restored = await restoreVisibility();
        outcome.visibilityRestored = restored?.restored === true || !runState.current.visibilityChanged;
      } catch (error) {
        outcome.errors.push({ step: "visibility", code: error.code || error.name });
      }
      return outcome;
    }

    async function runCanonical({ timeoutMs = 300000 } = {}) {
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 30000 || timeoutMs > 600000) {
        throw proofError("Invalid worker timeout.");
      }
      runState.current = { assetId: null, originalVisibility: null, visibilityChanged: false };
      setMessage("Running canonical proof");

      const initial = await preflight();
      if (!initial.mediaEnabled) throw proofError("Preview showcase media is disabled.", { code: "media_disabled" });
      if (!initial.room?.roomId || !UUID_RE.test(initial.room.roomId)) {
        throw proofError("The authenticated owner has no Room; creation requires explicit approval.", { code: "room_missing" });
      }
      if (!Number.isSafeInteger(initial.room.revision)) {
        throw proofError("The owner Room revision is invalid.");
      }
      if (initial.room.visibility !== "private") {
        throw proofError("The proof requires a private Room so no fixture is exposed before the controlled publish step.", {
          code: "room_not_private",
        });
      }
      if (initial.room.hasActiveHero) {
        throw proofError("The proof refuses to replace an existing Room hero.", { code: "room_has_active_hero" });
      }
      runState.current.originalVisibility = initial.room.visibility;
      if ("serviceWorker" in navigator) await navigator.serviceWorker.ready;
      const workerVersion = await controlledWorkerProofVersion();
      if (workerVersion !== EXPECTED_WORKER_PROOF_VERSION) {
        throw proofError("The page is not controlled by the reviewed showcase-media service worker.", {
          code: "service_worker_version_mismatch",
          expected: EXPECTED_WORKER_PROOF_VERSION,
          actual: workerVersion,
        });
      }

      const fixture = await createFixturePng();
      const staged = await ownerAction("media-hero-stage", {
        roomId: initial.room.roomId,
        fileExtension: "png",
      });
      if (!UUID_RE.test(staged?.assetId || "") || !UUID_RE.test(staged?.uploadIntentId || "")) {
        throw proofError("Stage returned invalid identifiers.");
      }
      runState.current.assetId = staged.assetId;
      const upload = staged.upload;
      if (upload?.method !== "PUT" || typeof upload.uploadUrl !== "string" || !upload.uploadUrl.startsWith("https://")) {
        throw proofError("Stage returned an invalid upload target.");
      }
      const uploadResponse = await fetch(upload.uploadUrl, {
        method: upload.method,
        headers: upload.headers,
        body: fixture.blob,
        redirect: "error",
      });
      if (!uploadResponse.ok) {
        throw proofError("Private source upload failed.", { status: uploadResponse.status });
      }

      await ownerAction("media-hero-finalize", {
        assetId: staged.assetId,
        uploadIntentId: staged.uploadIntentId,
      });

      const deadline = Date.now() + timeoutMs;
      let approved = null;
      while (Date.now() < deadline) {
        const status = await ownerAction("media-status", { assetId: staged.assetId });
        if (status?.state === "approved") {
          approved = status;
          break;
        }
        if (TERMINAL_ASSET_STATES.has(status?.state) || status?.jobs?.some((job) => job.state === "dead")) {
          throw proofError("Worker reached a terminal non-approved state.", {
            state: status?.state || null,
            jobStates: Array.isArray(status?.jobs) ? status.jobs.map((job) => job.state) : [],
          });
        }
        await sleep(2000);
      }
      if (!approved) throw proofError("Timed out waiting for worker approval.");
      const variants = Array.isArray(approved.variants) ? approved.variants : [];
      const variantNames = variants.map((variant) => variant.variant).sort();
      if (approved.metadataStripped !== true || variantNames.join(",") !== "hero,thumb"
          || variants.some((variant) => variant.mime !== "image/webp"
            || !Number.isSafeInteger(variant.byteSize) || variant.byteSize < 1 || variant.byteSize > 4 * 1024 * 1024)) {
        throw proofError("Approved media does not satisfy the closed derivative contract.");
      }

      await ownerAction("media-hero-publish", {
        roomId: initial.room.roomId,
        assetId: staged.assetId,
        altText: "Aquadex showcase media privacy proof fixture",
        focalX: 0.5,
        focalY: 0.5,
      });

      if (initial.room.visibility === "private") {
        await ownerAction("publication-set", {
          roomId: initial.room.roomId,
          expectedRevision: initial.room.revision,
          visibility: "unlisted",
        });
        runState.current.visibilityChanged = true;
      }

      const continuityWorkerVersion = await controlledWorkerProofVersion();
      if (continuityWorkerVersion !== workerVersion) {
        throw proofError("The reviewed showcase-media service worker changed during the proof.", {
          code: "service_worker_version_changed",
          expected: workerVersion,
          actual: continuityWorkerVersion,
        });
      }

      const canonicalPath = `/api/showcase-media/${staged.assetId}/hero`;
      const directPath = `/api/storefront-detail?action=showcase-media&asset=${staged.assetId}&variant=hero`;
      const readMedia = async (path, label) => {
        const response = await fetch(path, { cache: "no-store", redirect: "error" });
        const headers = safeResponseHeaders(response);
        if (response.status !== 200 || headers.contentType !== "image/webp") {
          throw proofError(`${label} media read failed.`, { status: response.status, headers });
        }
        assertNoStore(headers, label);
        const bytes = await response.arrayBuffer();
        return { headers, byteSize: bytes.byteLength, checksumHex: await sha256Hex(bytes) };
      };
      const canonical = await readMedia(canonicalPath, "canonical");
      const direct = await readMedia(directPath, "direct");
      if (canonical.byteSize !== direct.byteSize || canonical.checksumHex !== direct.checksumHex) {
        throw proofError("Canonical and direct media bytes differ.");
      }
      const imageRequests = {
        canonical: await imageRequest(canonicalPath),
        direct: await imageRequest(directPath),
      };
      if (!imageRequests.canonical.loaded || !imageRequests.direct.loaded) {
        throw proofError("An online image-destination media request failed.", { imageRequests });
      }
      const beforeRevokeCacheMatches = await cacheMatches([canonicalPath, directPath]);
      if (beforeRevokeCacheMatches.length !== 0) {
        throw proofError("Revocable media entered Cache Storage before revoke.", { beforeRevokeCacheMatches });
      }

      const latest = await ownerAction("media-status", { assetId: staged.assetId });
      if (!Number.isSafeInteger(latest?.revision)) throw proofError("Asset revision is invalid before revoke.");
      await ownerAction("media-revoke", { assetId: staged.assetId, expectedRevision: latest.revision });

      const denied = {};
      for (const [label, path] of [["canonical", canonicalPath], ["direct", directPath]]) {
        const response = await fetch(path, { cache: "no-store", redirect: "error" });
        const headers = safeResponseHeaders(response);
        if (response.status !== 404) throw proofError(`${label} remained readable after revoke.`, { status: response.status });
        assertNoStore(headers, `${label} revoke denial`);
        denied[label] = { status: response.status, headers };
      }
      const visibility = await restoreVisibility();
      setMessage("Online proof complete; waiting for offline check");
      return {
        schemaVersion: 1,
        roomId: initial.room.roomId,
        roomSlug: initial.room.slug,
        assetId: staged.assetId,
        source: { byteSize: fixture.byteSize, checksumHex: fixture.checksumHex },
        approved: {
          revision: approved.revision,
          metadataStripped: approved.metadataStripped,
          variants: variants.map(({ variant, mime, width, height, byteSize }) => ({ variant, mime, width, height, byteSize })),
        },
        online: { workerVersion, canonical, direct, imageRequests, beforeRevokeCacheMatches, denied },
        visibilityRestored: visibility?.restored === true || initial.room.visibility !== "private",
      };
    }

    async function offlineProof(assetId) {
      if (!UUID_RE.test(assetId || "") || assetId !== runState.current.assetId) {
        throw proofError("Offline proof asset does not match this run.");
      }
      const canonicalPath = `/api/showcase-media/${assetId}/hero`;
      const directPath = `/api/storefront-detail?action=showcase-media&asset=${assetId}&variant=hero`;
      const failures = {};
      for (const [label, path] of [["canonical", canonicalPath], ["direct", directPath]]) {
        try {
          const response = await fetch(path, { cache: "no-store", redirect: "error" });
          failures[label] = { rejected: false, status: response.status };
        } catch (error) {
          failures[label] = { rejected: true, errorName: error?.name || "Error" };
        }
      }
      if (!failures.canonical.rejected || !failures.direct.rejected) {
        throw proofError("Offline media request produced a response.", { failures });
      }
      const imageRequests = {
        canonical: await imageRequest(canonicalPath),
        direct: await imageRequest(directPath),
      };
      if (imageRequests.canonical.loaded || imageRequests.direct.loaded) {
        throw proofError("An offline image-destination media request loaded bytes.", { imageRequests });
      }
      const matches = await cacheMatches([canonicalPath, directPath]);
      if (matches.length !== 0) throw proofError("Revoked media exists in Cache Storage offline.", { matches });
      setMessage("Canonical online/offline proof passed");
      return { failures, imageRequests, cacheMatches: matches };
    }

    async function createApprovedRoom({ slug } = {}) {
      const proofParams = new URLSearchParams(window.location.search);
      if (proofParams.get("showcase-media-proof-mode") !== "create-room") {
        throw proofError("Room creation is unavailable outside explicit create-room mode.", {
          code: "create_room_mode_required",
        });
      }
      const title = "Showcase Media Proof Room";
      const description = "Dedicated private Room for canonical showcase-media verification.";
      const slugIsValid = typeof slug === "string"
        && slug.length >= 3
        && slug.length <= 63
        && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
      if (!slugIsValid || !slug.startsWith("showcase-proof-")) {
        throw proofError("The approved Room slug is invalid.", { code: "invalid_proof_room_slug" });
      }

      setMessage("Verifying approved Room creation prerequisites");
      const [beforeBootstrap, beforeRoom] = await Promise.all([
        ownerAction("bootstrap", {}),
        readRoom(),
      ]);
      if (beforeBootstrap?.capabilities?.media !== false) {
        throw proofError("Room creation requires showcase media to be explicitly disabled.", {
          code: "media_not_explicitly_disabled",
        });
      }
      if (!Object.prototype.hasOwnProperty.call(beforeRoom || {}, "room") || beforeRoom.room !== null) {
        throw proofError("Room creation requires a verified owner with no existing Room.", {
          code: "room_already_exists_or_unverified",
        });
      }

      setMessage("Creating the explicitly approved private empty Room");
      let dispatched = false;
      try {
        const created = await ownerAction("room-create", {
          slug,
          title,
          description,
          schematic: { zones: [] },
        }, { onDispatch: () => { dispatched = true; } });

        const assertOwnerRoom = (room, expectedRoomId = null) => {
          const schematicKeys = room?.schematic && typeof room.schematic === "object"
            ? Object.keys(room.schematic).sort()
            : [];
          if (!UUID_RE.test(room?.roomId || "")
              || (expectedRoomId !== null && room.roomId !== expectedRoomId)
              || room.slug !== slug
              || room.title !== title
              || room.description !== description
              || room.visibility !== "private"
              || room.revision !== 0
              || room.publishedAt !== null
              || room.firstPublishedAt !== null
              || schematicKeys.length !== 2
              || schematicKeys[0] !== "version"
              || schematicKeys[1] !== "zones"
              || room.schematic.version !== 1
              || !Array.isArray(room.schematic.zones)
              || room.schematic.zones.length !== 0) {
            throw proofError("The created owner Room did not match the approved private empty Room.");
          }
        };

        assertOwnerRoom(created);
        if (created.replay !== false) {
          throw proofError("Room creation did not report a fresh irreversible mutation.");
        }

        const [afterBootstrap, afterRoom] = await Promise.all([
          ownerAction("bootstrap", {}),
          readRoom(),
        ]);
        if (afterBootstrap?.capabilities?.media !== false) {
          throw proofError("Showcase media was not explicitly disabled after Room creation.");
        }
        assertOwnerRoom(afterRoom?.room, created.roomId);
        if (!Array.isArray(afterRoom?.placements) || afterRoom.placements.length !== 0
            || !Array.isArray(afterRoom?.settings) || afterRoom.settings.length !== 0) {
          throw proofError("The created Room is not empty.");
        }

        const preview = await ownerAction("publication-preview", { roomId: created.roomId });
        const previewRoom = preview?.room;
        const previewSchematicKeys = previewRoom?.schematic && typeof previewRoom.schematic === "object"
          ? Object.keys(previewRoom.schematic).sort()
          : [];
        if (preview?.schemaVersion !== 1
            || previewRoom?.slug !== slug
            || previewRoom?.title !== title
            || previewRoom?.description !== description
            || previewRoom?.visibility !== "private"
            || previewRoom?.keeper !== null
            || previewRoom?.hero !== null
            || !Array.isArray(previewRoom?.tanks)
            || previewRoom.tanks.length !== 0
            || previewSchematicKeys.length !== 2
            || previewSchematicKeys[0] !== "version"
            || previewSchematicKeys[1] !== "zones"
            || previewRoom.schematic.version !== 1
            || !Array.isArray(previewRoom.schematic.zones)
            || previewRoom.schematic.zones.length !== 0) {
          throw proofError("Publication preview did not confirm a private empty Room without a hero.");
        }

        setMessage("Approved private empty Room created and verified");
        return {
          schemaVersion: 1,
          created: true,
          mediaEnabled: false,
          room: {
            roomId: created.roomId,
            slug,
            title,
            visibility: "private",
            revision: 0,
          },
          hasActiveHero: false,
        };
      } catch (error) {
        if (!dispatched) throw error;
        throw proofError("Room creation may have succeeded, but verification failed. Do not retry creation; use read-only preflight inspection.", {
          code: "room_creation_verification_failed",
          action: error?.action || null,
          status: Number.isInteger(error?.status) ? error.status : null,
        });
      }
    }

    const bridge = Object.freeze({
      version: 1,
      status: () => ({ ready, authenticated }),
      login: () => connectPrivy(),
      preflight,
      createApprovedRoom,
      allowlistCandidate,
      runCanonical,
      offlineProof,
      cleanup,
    });
    Object.defineProperty(window, BRIDGE_KEY, {
      configurable: true,
      enumerable: false,
      writable: false,
      value: bridge,
    });
    setMessage(authenticated ? "Authenticated proof bridge ready" : "Sign in with Privy to continue");
    return () => {
      try { delete window[BRIDGE_KEY]; } catch { /* proof-only cleanup */ }
    };
  }, [authenticated, connectPrivy, getAccessToken, ready]);

  if (!proofRequested()) return null;
  return (
    <aside
      data-testid="showcase-media-proof-panel"
      style={{ position: "fixed", right: 12, bottom: 12, zIndex: 20000, maxWidth: 360, padding: 12,
        borderRadius: 10, border: "1px solid #38bdf8", background: "#071827", color: "#e2e8f0",
        fontFamily: "system-ui, sans-serif", fontSize: 13 }}
    >
      <strong>Showcase media proof</strong>
      <div data-testid="showcase-media-proof-status" style={{ marginTop: 6 }}>{message}</div>
      {!authenticated && (
        <button data-testid="showcase-media-proof-login" type="button" onClick={() => connectPrivy()}
          style={{ marginTop: 8, padding: "6px 10px", cursor: "pointer" }}>
          Sign in with Privy
        </button>
      )}
    </aside>
  );
}
