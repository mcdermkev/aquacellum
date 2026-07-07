/**
 * marketplaceNotifications.js — Marketplace event notification service.
 *
 * Delivers notifications to the Sonar system (Supabase `sonar_notifications`),
 * which is what the notification bell / InboxPanel actually reads. Each helper
 * targets a specific RECIPIENT wallet (the other party in the transaction), so
 * notifications reach the right user rather than staying local to the sender.
 *
 * NOTE: `sonar_notifications.category` has a CHECK constraint limiting values to
 * ('activity', 'social', 'milestone'). Marketplace events map to 'activity';
 * the specific event is conveyed through the icon, wording, and link_type/link_id
 * (used for click-through navigation).
 *
 * Event types (via link_type + icon):
 *   - offer_received: seller notified of a new offer
 *   - offer_accepted: buyer notified their offer was accepted
 *   - offer_declined: buyer notified their offer was declined
 *   - offer_countered: buyer notified of a counter-offer
 *   - listing_sold: seller notified of a sale
 *   - shipping_dispatched: buyer notified of shipment
 *   - arrival_confirmed: seller notified buyer confirmed arrival
 *   - wanted_match: seller notified a wanted post matches their species
 *   - listing_view: seller notified of listing interest
 *
 * Delivery is client-side (the acting user's client writes the recipient's
 * notification). This matches the existing anon/dev RLS insert policy on
 * sonar_notifications. Server-side triggers would be more tamper-resistant, but
 * most marketplace order state is local-first (Dexie), so client delivery keeps
 * a single, consistent path for beta.
 */

import { createNotification as createSonarNotification } from "./reefApi";

const EVENT_ICONS = {
  offer_received: "💰",
  offer_accepted: "✅",
  offer_declined: "🙅",
  offer_countered: "🔁",
  listing_sold: "🎉",
  shipping_dispatched: "📦",
  arrival_confirmed: "🚚",
  wanted_match: "🔍",
  listing_view: "👀",
};

/**
 * Deliver a marketplace notification to a recipient's Sonar feed.
 *
 * @param {Object} opts
 * @param {string} opts.recipientWallet - wallet of the user who should be notified
 * @param {string} opts.event - marketplace event type (drives icon/link_type)
 * @param {string} opts.title - short title
 * @param {string} opts.body - longer description
 * @param {string} [opts.linkType] - navigable target type (defaults to event)
 * @param {string|number} [opts.linkId] - navigable target id
 */
async function deliver({ recipientWallet, event, title, body, linkType, linkId }) {
  if (!recipientWallet) return { error: "No recipient" };
  try {
    return await createSonarNotification({
      recipientWallet,
      category: "activity",
      title,
      body,
      icon: EVENT_ICONS[event] || "🔔",
      linkType: linkType || event,
      linkId: linkId != null ? String(linkId) : null,
    });
  } catch (e) {
    console.warn("[MarketplaceNotifications] delivery failed:", e);
    return { error: e };
  }
}

// ─── Marketplace Event Helpers ─────────────────────────────────────────
// Each helper takes an explicit `recipientWallet` — the OTHER party who should
// be notified — plus the details needed to compose the message.

export function notifyOfferReceived({ recipientWallet, buyerName, speciesName, offerAmount, listingId }) {
  return deliver({
    recipientWallet,
    event: "offer_received",
    title: `New offer on ${speciesName}`,
    body: `${buyerName} offered $${Number(offerAmount).toFixed(2)} for your ${speciesName} listing.`,
    linkType: "listing",
    linkId: listingId,
  });
}

export function notifyOfferAccepted({ recipientWallet, sellerName, speciesName, amount, listingId }) {
  return deliver({
    recipientWallet,
    event: "offer_accepted",
    title: `Offer accepted!`,
    body: `Your $${Number(amount).toFixed(2)} offer for ${speciesName} was accepted by ${sellerName}.`,
    linkType: "listing",
    linkId: listingId,
  });
}

export function notifyOfferDeclined({ recipientWallet, speciesName, listingId }) {
  return deliver({
    recipientWallet,
    event: "offer_declined",
    title: `Offer declined`,
    body: `Your offer for ${speciesName} was not accepted. You can try a different amount or browse other listings.`,
    linkType: "listing",
    linkId: listingId,
  });
}

export function notifyOfferCountered({ recipientWallet, sellerName, speciesName, counterAmount, listingId }) {
  return deliver({
    recipientWallet,
    event: "offer_countered",
    title: `Counter-offer on ${speciesName}`,
    body: `${sellerName} countered with $${Number(counterAmount).toFixed(2)} for ${speciesName}.`,
    linkType: "listing",
    linkId: listingId,
  });
}

export function notifyListingSold({ recipientWallet, speciesName, amount, buyerName, listingId }) {
  return deliver({
    recipientWallet,
    event: "listing_sold",
    title: `Sale! ${speciesName} sold`,
    body: `${buyerName} purchased your ${speciesName} for $${Number(amount).toFixed(2)}. Check your orders for fulfillment details.`,
    linkType: "listing",
    linkId: listingId,
  });
}

export function notifyShippingDispatched({ recipientWallet, speciesName, trackingNumber, orderId }) {
  return deliver({
    recipientWallet,
    event: "shipping_dispatched",
    title: `Your fish is on the way!`,
    body: `${speciesName} has been shipped.${trackingNumber ? ` Tracking: ${trackingNumber}` : ""} You have 3 days after delivery to confirm arrival.`,
    linkType: "order",
    linkId: orderId,
  });
}

export function notifyArrivalConfirmed({ recipientWallet, speciesName, buyerName, orderId }) {
  return deliver({
    recipientWallet,
    event: "arrival_confirmed",
    title: `Delivery confirmed`,
    body: `${buyerName} confirmed safe arrival of ${speciesName}. Payment has been released to you.`,
    linkType: "order",
    linkId: orderId,
  });
}

export function notifyWantedMatch({ recipientWallet, speciesName, buyerName, maxBudget, wantedId }) {
  return deliver({
    recipientWallet,
    event: "wanted_match",
    title: `Someone's looking for ${speciesName}!`,
    body: `${buyerName} posted a "wanted" for ${speciesName}${maxBudget ? ` (budget: up to $${maxBudget})` : ""}. You may have what they need.`,
    linkType: "wanted",
    linkId: wantedId,
  });
}

export function notifyListingInterest({ recipientWallet, speciesName, viewCount, listingId }) {
  return deliver({
    recipientWallet,
    event: "listing_view",
    title: `Interest in your ${speciesName}`,
    body: `Your ${speciesName} listing has received ${viewCount} views this week. Consider adjusting the price to attract buyers.`,
    linkType: "listing",
    linkId: listingId,
  });
}
