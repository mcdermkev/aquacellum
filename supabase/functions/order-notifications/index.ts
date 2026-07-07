/**
 * order-notifications Edge Function
 *
 * Sends push notifications when marketplace orders change status.
 * Called by the Supabase database webhook on orders table UPDATE.
 *
 * Notification scenarios:
 * - Buyer: "Your order has been dispatched!" (locked → dispatched)
 * - Buyer: "Order disputed — under review" (dispatched → disputed)
 * - Seller: "New order received!" (new insert, buyer created)
 * - Seller: "Buyer released funds!" (dispatched → released)
 * - Seller: "Order disputed by buyer" (dispatched → disputed)
 * - Both: "Dispute resolved" (disputed → resolved_released | refunded)
 *
 * Expects webhook payload:
 * {
 *   type: "UPDATE" | "INSERT",
 *   table: "orders",
 *   record: { ...new row },
 *   old_record: { ...old row }
 * }
 */

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Emoji shown on the in-app Sonar bell, derived from the notification tag.
// (The `icon` used for web push is an image path; the bell renders text/emoji.)
function sonarIconForTag(tag?: string): string {
  if (!tag) return "🔔";
  if (tag.startsWith("order-new")) return "🛒";
  if (tag.startsWith("order-dispatched")) return "📦";
  if (tag.startsWith("order-released") || tag.startsWith("order-complete")) return "✅";
  if (tag.startsWith("order-disputed")) return "⚠️";
  if (tag.startsWith("order-resolved")) return "⚖️";
  if (tag.startsWith("order-refunded")) return "↩️";
  return "🔔";
}

interface OrderRecord {
  id: string;
  order_type: string;
  buyer_wallet: string;
  seller_wallet: string;
  status: string;
  items: Array<{ commonName?: string; tokenId?: number; quantity?: number }>;
  tracking_number?: string;
  quantity?: number;
  total_paid_cents: number;
}

interface NotificationPayload {
  wallet_address: string;
  title: string;
  body: string;
  icon?: string;
  url?: string;
  category?: string;
  tag?: string;
}

serve(async (req) => {
  try {
    const { type, record, old_record } = await req.json();

    if (!record) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const order = record as OrderRecord;
    const oldOrder = old_record as OrderRecord | null;
    const notifications: NotificationPayload[] = [];

    const speciesName =
      order.items?.[0]?.commonName || "your specimen";
    const orderLabel =
      order.order_type === "batch"
        ? `${speciesName} (x${order.quantity || order.items?.[0]?.quantity || 1})`
        : speciesName;

    if (type === "INSERT") {
      // New order — notify seller
      notifications.push({
        wallet_address: order.seller_wallet,
        title: "New Order Received",
        body: `Someone purchased ${orderLabel}! Check your orders to fulfill.`,
        icon: "/icons/order-new.png",
        url: "/marketplace?tab=orders",
        category: "order",
        tag: `order-new-${order.id}`,
      });
    } else if (type === "UPDATE" && oldOrder) {
      const fromStatus = oldOrder.status;
      const toStatus = order.status;

      if (fromStatus === toStatus) {
        // No status change — skip
        return new Response(JSON.stringify({ sent: 0, reason: "No status change" }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Status transitions → notifications
      switch (toStatus) {
        case "dispatched":
          // Notify buyer: their order shipped
          notifications.push({
            wallet_address: order.buyer_wallet,
            title: "Order Dispatched!",
            body: order.tracking_number
              ? `${orderLabel} is on its way! Tracking: ${order.tracking_number}`
              : `${orderLabel} has been dispatched by the breeder.`,
            icon: "/icons/order-shipped.png",
            url: "/marketplace?tab=orders",
            category: "order",
            tag: `order-dispatched-${order.id}`,
          });
          break;

        case "released":
        case "completed":
        case "settled":
          // Notify seller: funds released
          notifications.push({
            wallet_address: order.seller_wallet,
            title: "Funds Released!",
            body: `Payment for ${orderLabel} has been released to you. ($${(order.total_paid_cents / 100).toFixed(2)})`,
            icon: "/icons/order-complete.png",
            url: "/marketplace?tab=orders",
            category: "order",
            tag: `order-released-${order.id}`,
          });
          // Notify buyer: order complete
          notifications.push({
            wallet_address: order.buyer_wallet,
            title: "Order Complete",
            body: `Your order for ${orderLabel} is confirmed complete. Enjoy your new fish!`,
            icon: "/icons/order-complete.png",
            url: "/marketplace?tab=orders",
            category: "order",
            tag: `order-complete-${order.id}`,
          });
          break;

        case "disputed":
          // Notify seller: buyer opened dispute
          notifications.push({
            wallet_address: order.seller_wallet,
            title: "Order Disputed",
            body: `A buyer has opened a dispute on ${orderLabel}. A curator will review.`,
            icon: "/icons/order-alert.png",
            url: "/marketplace?tab=orders",
            category: "order",
            tag: `order-disputed-${order.id}`,
          });
          break;

        case "resolved_released":
          // Dispute resolved in seller's favor
          notifications.push({
            wallet_address: order.seller_wallet,
            title: "Dispute Resolved — Funds Released",
            body: `The dispute on ${orderLabel} was resolved in your favor. Funds released.`,
            icon: "/icons/order-complete.png",
            url: "/marketplace?tab=orders",
            category: "order",
            tag: `order-resolved-${order.id}`,
          });
          notifications.push({
            wallet_address: order.buyer_wallet,
            title: "Dispute Resolved",
            body: `The dispute on ${orderLabel} was reviewed. Funds released to seller.`,
            icon: "/icons/order-alert.png",
            url: "/marketplace?tab=orders",
            category: "order",
            tag: `order-resolved-${order.id}`,
          });
          break;

        case "refunded":
          // Refund — notify buyer
          notifications.push({
            wallet_address: order.buyer_wallet,
            title: "Order Refunded",
            body: `Your order for ${orderLabel} has been refunded. ($${(order.total_paid_cents / 100).toFixed(2)})`,
            icon: "/icons/order-refund.png",
            url: "/marketplace?tab=orders",
            category: "order",
            tag: `order-refunded-${order.id}`,
          });
          // Notify seller
          notifications.push({
            wallet_address: order.seller_wallet,
            title: "Order Refunded",
            body: `Your order for ${orderLabel} has been refunded to the buyer.`,
            icon: "/icons/order-refund.png",
            url: "/marketplace?tab=orders",
            category: "order",
            tag: `order-refunded-seller-${order.id}`,
          });
          break;

        default:
          break;
      }
    }

    // Send notifications via the existing send-push function
    if (notifications.length === 0) {
      return new Response(JSON.stringify({ sent: 0 }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    let sent = 0;

    for (const notif of notifications) {
      try {
        const { error } = await supabase.functions.invoke("send-push", {
          body: notif,
        });
        if (!error) sent++;
      } catch (e) {
        console.error(`[order-notifications] Failed to send to ${notif.wallet_address}:`, e);
      }

      // Also record in the Sonar notifications table for the in-app bell.
      // The bell (useSonar / reefApi) reads `sonar_notifications`, keyed by
      // `recipient_wallet` with category constrained to activity/social/milestone.
      try {
        // Resolve recipient to the casing stored in profiles so the
        // recipient_wallet FK (-> profiles.wallet_address) is satisfied.
        const { data: prof } = await supabase
          .from("profiles")
          .select("wallet_address")
          .ilike("wallet_address", notif.wallet_address)
          .maybeSingle();
        const recipient = prof?.wallet_address || notif.wallet_address;

        await supabase.from("sonar_notifications").insert({
          recipient_wallet: recipient,
          category: "activity",
          title: notif.title,
          body: notif.body,
          icon: sonarIconForTag(notif.tag),
          link_type: "order",
          link_id: order.id ?? null,
        });
      } catch (e) {
        // Non-critical — in-app notification is best-effort
        console.error(`[order-notifications] In-app record failed for ${notif.wallet_address}:`, e);
      }
    }

    return new Response(
      JSON.stringify({ sent, total: notifications.length }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[order-notifications] Error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
