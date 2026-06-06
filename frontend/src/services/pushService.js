/**
 * pushService.js
 * 
 * Client-side Web Push subscription management.
 * Handles: service worker registration, push subscription, 
 * and syncing subscription to Supabase.
 */

import { supabase, getCurrentWallet, isSupabaseConfigured } from "./supabaseClient";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

/**
 * Check if Web Push is supported in this browser.
 */
export function isPushSupported() {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * Get the current push permission state.
 * Returns: 'granted' | 'denied' | 'default' (not asked yet)
 */
export function getPushPermission() {
  if (!isPushSupported()) return "unsupported";
  return Notification.permission;
}

/**
 * Convert a base64 VAPID public key to a Uint8Array for the subscribe call.
 */
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Register the service worker if not already registered.
 */
async function ensureServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service workers not supported");
  }

  const registration = await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
  });

  // Wait for the SW to be ready
  await navigator.serviceWorker.ready;
  return registration;
}

/**
 * Subscribe the user to push notifications.
 * 
 * Flow:
 * 1. Register service worker
 * 2. Request notification permission
 * 3. Create push subscription with VAPID key
 * 4. Store subscription in Supabase
 * 
 * @returns {{ success: boolean, error?: string }}
 */
export async function subscribeToPush() {
  if (!isPushSupported()) {
    return { success: false, error: "Push notifications not supported in this browser" };
  }

  if (!VAPID_PUBLIC_KEY) {
    return { success: false, error: "VAPID public key not configured" };
  }

  try {
    // Step 1: Register service worker
    const registration = await ensureServiceWorker();

    // Step 2: Request permission
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return { success: false, error: "Notification permission denied" };
    }

    // Step 3: Subscribe to push
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    // Step 4: Store in Supabase
    const walletAddress = getCurrentWallet();
    if (walletAddress && isSupabaseConfigured()) {
      const { error } = await supabase
        .from("push_subscriptions")
        .upsert(
          {
            wallet_address: walletAddress,
            subscription: subscription.toJSON(),
            user_agent: navigator.userAgent,
          },
          { onConflict: "wallet_address,subscription" }
        );

      if (error) {
        console.warn("[Push] Failed to store subscription:", error);
      }
    }

    return { success: true };
  } catch (err) {
    console.error("[Push] Subscribe failed:", err);
    return { success: false, error: err.message };
  }
}

/**
 * Unsubscribe from push notifications.
 * Removes the subscription from the browser and Supabase.
 */
export async function unsubscribeFromPush() {
  if (!isPushSupported()) return { success: false, error: "Not supported" };

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();

    if (subscription) {
      // Unsubscribe from browser
      await subscription.unsubscribe();

      // Remove from Supabase
      const walletAddress = getCurrentWallet();
      if (walletAddress && isSupabaseConfigured()) {
        await supabase
          .from("push_subscriptions")
          .delete()
          .eq("wallet_address", walletAddress)
          .eq("subscription", subscription.toJSON());
      }
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Check if the user currently has an active push subscription.
 */
export async function getActiveSubscription() {
  if (!isPushSupported()) return null;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return subscription;
  } catch {
    return null;
  }
}
