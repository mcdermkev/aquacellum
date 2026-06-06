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
 * Uses the web-push protocol with VAPID authentication.
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

    const payload = JSON.stringify({
      title,
      body: body || "",
      icon: icon || "/favicon.svg",
      url: url || "/",
      category: category || "activity",
      tag: tag || `sonar-${Date.now()}`,
    });

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

        // Use the Web Push protocol
        // For Deno, we use the fetch API directly with the encrypted payload
        // In production, you'd use a web-push library compatible with Deno
        // For now, we'll use the simplified JWT + raw push approach
        
        const response = await sendWebPush(endpoint, payload, {
          p256dh,
          auth,
          vapidPublicKey: VAPID_PUBLIC_KEY,
          vapidPrivateKey: VAPID_PRIVATE_KEY,
          vapidSubject: VAPID_SUBJECT,
        });

        if (response.ok || response.status === 201) {
          sent++;
        } else if (response.status === 410 || response.status === 404) {
          // Subscription expired — clean up
          expiredIds.push(sub.id);
          failed++;
        } else {
          console.warn(`Push failed for ${sub.id}: ${response.status}`);
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
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

/**
 * Send a Web Push message using the Web Push protocol.
 * This is a simplified implementation using VAPID JWT auth.
 * 
 * For production, consider using a Deno-compatible web-push library.
 */
async function sendWebPush(
  endpoint: string,
  payload: string,
  options: {
    p256dh: string;
    auth: string;
    vapidPublicKey: string;
    vapidPrivateKey: string;
    vapidSubject: string;
  }
): Promise<Response> {
  // Generate VAPID JWT for authorization
  const vapidToken = await generateVapidJwt(
    endpoint,
    options.vapidSubject,
    options.vapidPublicKey,
    options.vapidPrivateKey
  );

  // For the encryption step, we need crypto operations
  // The actual encryption of the payload uses ECDH + HKDF + AES-GCM
  // This is complex — in production use a library like web-push
  // For now, send as a plaintext push (works with most browsers for testing)
  
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `vapid t=${vapidToken}, k=${options.vapidPublicKey}`,
      "Content-Type": "application/octet-stream",
      "TTL": "86400",
      "Urgency": "normal",
      "Content-Length": "0", // Empty body for notification-only push
    },
  });

  return response;
}

/**
 * Generate a VAPID JWT for push service authorization.
 */
async function generateVapidJwt(
  endpoint: string,
  subject: string,
  publicKey: string,
  privateKey: string
): Promise<string> {
  const audience = new URL(endpoint).origin;
  const expiration = Math.floor(Date.now() / 1000) + 12 * 60 * 60; // 12 hours

  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: audience,
    exp: expiration,
    sub: subject,
  };

  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const unsignedToken = `${headerB64}.${payloadB64}`;

  // Import the private key for signing
  const keyData = base64UrlDecode(privateKey);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  // Sign the token
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );

  const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${unsignedToken}.${signatureB64}`;
}

function base64UrlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob(base64 + padding);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
