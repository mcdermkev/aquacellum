/**
 * send-push Edge Function
 *
 * Sends Web Push notifications to a user's subscribed browsers.
 * Called by database triggers or other Edge Functions when a notification
 * needs to be delivered as a push.
 *
 * Expects body:
 * {
 *   wallet_address: string,
 *   title: string,
 *   body: string,
 *   icon?: string,
 *   url?: string,
 *   category?: string,
 *   tag?: string
 * }
 *
 * Implements the Web Push protocol end-to-end using only Web Crypto
 * (no npm/node web-push dependency, which does not work reliably under Deno —
 * see https://github.com/web-push-libs/web-push/issues for the ECDSA key
 * import format problems):
 *   - VAPID (RFC 8292): ES256 JWT signed with the VAPID private key, imported
 *     as a JWK (raw-format private key import is invalid for ECDSA/ECDH in
 *     Web Crypto — this was the bug in the previous version of this file).
 *   - Payload encryption (RFC 8291): ECDH (P-256) + HKDF-SHA256 + AES-128-GCM
 *     ("aes128gcm" content-coding per RFC 8188), single-record message.
 *
 * PREVIOUS BUG (fixed here): this function used to sign the VAPID JWT with an
 * invalid "raw" private-key import (Web Crypto does not support "raw" format
 * for ECDSA private keys — only public keys), and never actually attached an
 * encrypted payload to the push request (it POSTed with Content-Length: 0).
 * Browsers require aes128gcm-encrypted payloads to fire a `push` event with
 * `event.data` set; sw.js's `if (!event.data) return;` guard meant nothing
 * was ever displayed even when a request reached the push service.
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = "mailto:notifications@aquacellum.com";

serve(async (req) => {
  try {
    const { wallet_address, title, body, icon, url, category, tag } = await req.json();

    if (!wallet_address || !title) {
      return new Response(
        JSON.stringify({ error: "wallet_address and title required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Get all push subscriptions for this user
    const { data: subscriptions, error } = await supabase
      .from("push_subscriptions")
      .select("id, subscription")
      .eq("wallet_address", wallet_address);

    if (error || !subscriptions || subscriptions.length === 0) {
      return new Response(
        JSON.stringify({ sent: 0, reason: "No subscriptions found" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    const payloadBytes = new TextEncoder().encode(
      JSON.stringify({
        title,
        body: body || "",
        // PNG, not SVG: Android Chrome cannot render SVG notification icons and
        // silently falls back to the browser's own logo when the asset fails to
        // load. This defaulted to /favicon.svg, which is why every notification
        // from this app arrived branded as Chrome.
        icon: icon || "/icons/icon-192.png",
        url: url || "/",
        category: category || "activity",
        tag: tag || `sonar-${Date.now()}`,
      })
    );

    const vapidPrivateKey = await importVapidPrivateKey(VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

    let sent = 0;
    let failed = 0;
    const expiredIds: string[] = [];

    for (const sub of subscriptions) {
      try {
        const pushSub = sub.subscription;
        const endpoint = pushSub.endpoint;
        const p256dh = pushSub.keys?.p256dh;
        const auth = pushSub.keys?.auth;

        if (!endpoint || !p256dh || !auth) {
          expiredIds.push(sub.id);
          continue;
        }

        const response = await sendWebPush(endpoint, payloadBytes, {
          uaPublicKeyB64url: p256dh,
          authSecretB64url: auth,
          vapidPrivateKey,
          vapidPublicKeyB64url: VAPID_PUBLIC_KEY,
          vapidSubject: VAPID_SUBJECT,
        });

        if (response.ok || response.status === 201) {
          sent++;
        } else if (response.status === 410 || response.status === 404) {
          // Subscription expired — clean up
          expiredIds.push(sub.id);
          failed++;
        } else {
          const text = await response.text().catch(() => "");
          console.warn(`Push failed for ${sub.id}: ${response.status} ${text}`);
          failed++;
        }
      } catch (err) {
        console.error(`Push error for ${sub.id}:`, err);
        failed++;
      }
    }

    // Clean up expired subscriptions
    if (expiredIds.length > 0) {
      await supabase
        .from("push_subscriptions")
        .delete()
        .in("id", expiredIds);
    }

    return new Response(
      JSON.stringify({ sent, failed, expired_cleaned: expiredIds.length }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// base64url helpers
// ─────────────────────────────────────────────────────────────────────────────

function b64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concatBytes(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// VAPID (RFC 8292) — ES256-signed JWT authorizing this app server to the
// push service. Private key MUST be imported via JWK, not "raw" — Web
// Crypto's "raw" import format only supports EC *public* keys.
// ─────────────────────────────────────────────────────────────────────────────

async function importVapidPrivateKey(
  publicKeyB64url: string,
  privateKeyB64url: string
): Promise<CryptoKey> {
  const publicBytes = b64urlToBytes(publicKeyB64url); // 65 bytes: 0x04 || X(32) || Y(32)
  const privateBytes = b64urlToBytes(privateKeyB64url); // 32 bytes: raw scalar d

  if (publicBytes.length !== 65 || publicBytes[0] !== 4) {
    throw new Error(`VAPID public key must be an uncompressed P-256 point (got ${publicBytes.length} bytes)`);
  }
  if (privateBytes.length !== 32) {
    throw new Error(`VAPID private key must be 32 bytes (got ${privateBytes.length})`);
  }

  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: bytesToB64url(publicBytes.slice(1, 33)),
    y: bytesToB64url(publicBytes.slice(33, 65)),
    d: bytesToB64url(privateBytes),
    ext: true,
  };

  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

async function generateVapidJwt(endpoint: string, subject: string, privateKey: CryptoKey): Promise<string> {
  const audience = new URL(endpoint).origin;
  const expiration = Math.floor(Date.now() / 1000) + 12 * 60 * 60; // 12 hours

  const header = { typ: "JWT", alg: "ES256" };
  const payload = { aud: audience, exp: expiration, sub: subject };

  const headerB64 = bytesToB64url(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = bytesToB64url(new TextEncoder().encode(JSON.stringify(payload)));
  const unsignedToken = `${headerB64}.${payloadB64}`;

  // Web Crypto's ECDSA signature is the raw (r || s) format required by JWS
  // ES256 — no DER re-encoding needed (unlike Node's crypto.sign default).
  const signatureBuf = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(unsignedToken)
  );

  return `${unsignedToken}.${bytesToB64url(new Uint8Array(signatureBuf))}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// HKDF (RFC 5869) via HMAC-SHA256 primitives
// ─────────────────────────────────────────────────────────────────────────────

async function hmacSha256(keyBytes: Uint8Array, msgBytes: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, msgBytes);
  return new Uint8Array(sig);
}

async function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Promise<Uint8Array> {
  return hmacSha256(salt, ikm);
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const t1 = await hmacSha256(prk, concatBytes(info, new Uint8Array([1])));
  return t1.slice(0, length);
}

// ─────────────────────────────────────────────────────────────────────────────
// Web Push message encryption (RFC 8291) using the aes128gcm content-coding
// (RFC 8188), single unpadded record.
// ─────────────────────────────────────────────────────────────────────────────

async function encryptWebPushPayload(
  plaintext: Uint8Array,
  uaPublicKeyB64url: string,
  authSecretB64url: string
): Promise<Uint8Array> {
  const uaPublicRaw = b64urlToBytes(uaPublicKeyB64url); // subscription.keys.p256dh
  const authSecret = b64urlToBytes(authSecretB64url); // subscription.keys.auth (16 bytes)

  const uaPublicKey = await crypto.subtle.importKey(
    "raw",
    uaPublicRaw,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  // Ephemeral application-server ECDH keypair (one per message, never reused)
  const asKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", asKeyPair.publicKey));

  const ecdhSecretBuf = await crypto.subtle.deriveBits(
    { name: "ECDH", public: uaPublicKey },
    asKeyPair.privateKey,
    256
  );
  const ecdhSecret = new Uint8Array(ecdhSecretBuf);

  // Combine ECDH output with the subscription's auth secret (RFC 8291 §3.4)
  const prkCombine = await hkdfExtract(authSecret, ecdhSecret);
  const keyInfo = concatBytes(
    new TextEncoder().encode("WebPush: info\0"),
    uaPublicRaw,
    asPublicRaw
  );
  const ikm = await hkdfExpand(prkCombine, keyInfo, 32);

  // aes128gcm content-coding (RFC 8188) — derive CEK + nonce from a fresh salt
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(prk, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(prk, new TextEncoder().encode("Content-Encoding: nonce\0"), 12);

  // Single-record message: plaintext || delimiter(0x02)
  const padded = concatBytes(plaintext, new Uint8Array([2]));

  const cekKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertextBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, cekKey, padded);
  const ciphertext = new Uint8Array(ciphertextBuf);

  // Record header (RFC 8188 §2.1): salt(16) || recordSize(4, BE) || idlen(1) || keyid(asPublicRaw)
  const recordSize = 4096;
  const rsBytes = new Uint8Array(4);
  new DataView(rsBytes.buffer).setUint32(0, recordSize, false);
  const header = concatBytes(salt, rsBytes, new Uint8Array([asPublicRaw.length]), asPublicRaw);

  return concatBytes(header, ciphertext);
}

// ─────────────────────────────────────────────────────────────────────────────
// Send the encrypted push to the browser's push service endpoint
// ─────────────────────────────────────────────────────────────────────────────

async function sendWebPush(
  endpoint: string,
  plaintext: Uint8Array,
  options: {
    uaPublicKeyB64url: string;
    authSecretB64url: string;
    vapidPrivateKey: CryptoKey;
    vapidPublicKeyB64url: string;
    vapidSubject: string;
  }
): Promise<Response> {
  const vapidToken = await generateVapidJwt(endpoint, options.vapidSubject, options.vapidPrivateKey);
  const encryptedBody = await encryptWebPushPayload(plaintext, options.uaPublicKeyB64url, options.authSecretB64url);

  return fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `vapid t=${vapidToken}, k=${options.vapidPublicKeyB64url}`,
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      "TTL": "86400",
      "Urgency": "normal",
    },
    body: encryptedBody,
  });
}
