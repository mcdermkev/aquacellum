/**
 * marketplaceNotifications.js — Marketplace event notification service.
 *
 * Writes local notifications to Dexie socialNotifications table.
 * These surface in the app's notification panel / bell icon.
 *
 * Categories:
 *   - offer_received: seller gets notified of a new offer
 *   - offer_accepted: buyer gets notified their offer was accepted
 *   - offer_declined: buyer gets notified their offer was declined
 *   - offer_countered: buyer gets notified of a counter-offer
 *   - listing_sold: seller gets notified of a sale
 *   - shipping_dispatched: buyer gets notified of shipment
 *   - arrival_confirmed: seller gets notified buyer confirmed arrival
 *   - wanted_match: seller gets notified a wanted post matches their species
 *   - listing_view: seller gets notified of interest (periodic, not per-view)
 */

import { db } from "../db";

/**
 * Create a local marketplace notification.
 * @param {Object} opts
 * @param {string} opts.category - notification category
 * @param {string} opts.title - short title
 * @param {string} opts.body - longer description
 * @param {Object} [opts.meta] - additional metadata (listing ID, offer ID, etc.)
 */
export async function createNotification({ category, title, body, meta = {} }) {
  try {
    await db.socialNotifications.add({
      category,
      title,
      body,
      meta: JSON.stringify(meta),
      isRead: false,
      createdAt: new Date().toISOString(),
    });
  } catch (e) {
    console.warn("[Notifications] Failed to create notification:", e);
  }
}

/**
 * Get unread notification count.
 */
export async function getUnreadCount() {
  try {
    return await db.socialNotifications.where("isRead").equals(0).count();
  } catch (e) {
    return 0;
  }
}

/**
 * Get recent notifications (newest first).
 * @param {number} limit - max number to return
 */
export async function getRecentNotifications(limit = 20) {
  try {
    return await db.socialNotifications
      .orderBy("createdAt")
      .reverse()
      .limit(limit)
      .toArray();
  } catch (e) {
    return [];
  }
}

/**
 * Mark a notification as read.
 */
export async function markAsRead(notificationId) {
  try {
    await db.socialNotifications.update(notificationId, { isRead: true });
  } catch (e) {
    console.warn("[Notifications] Failed to mark as read:", e);
  }
}

/**
 * Mark all notifications as read.
 */
export async function markAllAsRead() {
  try {
    await db.socialNotifications.where("isRead").equals(0).modify({ isRead: true });
  } catch (e) {
    console.warn("[Notifications] Failed to mark all as read:", e);
  }
}

// ─── Marketplace Event Helpers ─────────────────────────────────────────

export function notifyOfferReceived({ buyerName, speciesName, offerAmount, listingId }) {
  return createNotification({
    category: "offer_received",
    title: `New offer on ${speciesName}`,
    body: `${buyerName} offered $${offerAmount.toFixed(2)} for your ${speciesName} listing.`,
    meta: { listingId, offerAmount },
  });
}

export function notifyOfferAccepted({ sellerName, speciesName, amount }) {
  return createNotification({
    category: "offer_accepted",
    title: `Offer accepted!`,
    body: `Your $${amount.toFixed(2)} offer for ${speciesName} was accepted by ${sellerName}.`,
    meta: { speciesName, amount },
  });
}

export function notifyOfferDeclined({ speciesName }) {
  return createNotification({
    category: "offer_declined",
    title: `Offer declined`,
    body: `Your offer for ${speciesName} was not accepted. You can try a different amount or browse other listings.`,
    meta: { speciesName },
  });
}

export function notifyListingSold({ speciesName, amount, buyerName }) {
  return createNotification({
    category: "listing_sold",
    title: `Sale! ${speciesName} sold`,
    body: `${buyerName} purchased your ${speciesName} for $${amount.toFixed(2)}. Check your orders for fulfillment details.`,
    meta: { speciesName, amount },
  });
}

export function notifyShippingDispatched({ speciesName, trackingNumber }) {
  return createNotification({
    category: "shipping_dispatched",
    title: `Your fish is on the way!`,
    body: `${speciesName} has been shipped.${trackingNumber ? ` Tracking: ${trackingNumber}` : ""} You have 3 days after delivery to confirm arrival.`,
    meta: { speciesName, trackingNumber },
  });
}

export function notifyArrivalConfirmed({ speciesName, buyerName }) {
  return createNotification({
    category: "arrival_confirmed",
    title: `Delivery confirmed`,
    body: `${buyerName} confirmed safe arrival of ${speciesName}. Payment has been released to you.`,
    meta: { speciesName },
  });
}

export function notifyWantedMatch({ speciesName, buyerName, maxBudget }) {
  return createNotification({
    category: "wanted_match",
    title: `Someone's looking for ${speciesName}!`,
    body: `${buyerName} posted a "wanted" for ${speciesName}${maxBudget ? ` (budget: up to $${maxBudget})` : ""}. You may have what they need.`,
    meta: { speciesName, maxBudget },
  });
}

export function notifyListingInterest({ speciesName, viewCount }) {
  return createNotification({
    category: "listing_view",
    title: `Interest in your ${speciesName}`,
    body: `Your ${speciesName} listing has received ${viewCount} views this week. Consider adjusting the price to attract buyers.`,
    meta: { speciesName, viewCount },
  });
}
