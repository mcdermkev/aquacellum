/**
 * create-checkout.js — Vercel Serverless Function
 *
 * Creates a Stripe Checkout Session for purchasing fish. Supports:
 *   - Single specimen purchase
 *   - Shipping-enabled specimen purchase
 *   - Batch (juvenile) purchase
 *   - Multi-specimen cart checkout
 *
 * Uses Stripe Connect "destination charges" so the platform collects the 4% fee
 * and the remaining 96% (+shipping) routes directly to the seller's connected account.
 *
 * Flow:
 *   1. Frontend sends listing details + buyer wallet + purchase type
 *   2. This endpoint looks up the seller's Stripe Connected Account
 *   3. Creates a Checkout Session with the platform fee split
 *   4. Returns the Checkout URL → buyer completes payment in Stripe's hosted UI
 *   5. On success, stripe-webhook.js triggers the on-chain NFT transfer
 *
 * Environment variables:
 *   STRIPE_SECRET_KEY — Platform Stripe secret key
 *   SUPABASE_URL — Supabase project URL
 *   SUPABASE_SERVICE_KEY — Supabase service role key
 *   CHECKOUT_SUCCESS_URL — Redirect after successful payment
 *   CHECKOUT_CANCEL_URL — Redirect if buyer cancels
 */

import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

// Platform fee: 4% (matches on-chain TOTAL_FEE_BPS = 400)
const PLATFORM_FEE_PERCENT = 4;

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const {
    purchaseType,   // "specimen" | "shipping" | "batch" | "multi"
    buyerWallet,    // Buyer's on-chain wallet address
    sellerWallet,   // Seller's wallet address (to look up Stripe Connected Account)
    items,          // Array of items being purchased
    successUrl,     // Optional override for success redirect
    cancelUrl,      // Optional override for cancel redirect
  } = req.body;

  if (!purchaseType || !buyerWallet || !sellerWallet || !items || items.length === 0) {
    return res.status(400).json({
      error: "Missing required fields: purchaseType, buyerWallet, sellerWallet, items",
    });
  }

  const SUCCESS_URL = successUrl
    || process.env.CHECKOUT_SUCCESS_URL
    || "https://aquadex.fish/checkout/success?session_id={CHECKOUT_SESSION_ID}";
  const CANCEL_URL = cancelUrl
    || process.env.CHECKOUT_CANCEL_URL
    || "https://aquadex.fish/marketplace";

  try {
    // ─── Look up seller's Stripe Connected Account ─────────────────────────
    const { data: sellerAccount, error: sellerError } = await supabase
      .from("seller_stripe_accounts")
      .select("stripe_account_id, onboarding_complete")
      .eq("wallet_address", sellerWallet.toLowerCase())
      .single();

    if (sellerError || !sellerAccount) {
      return res.status(400).json({
        error: "Seller has not connected their Stripe account",
        code: "SELLER_NOT_CONNECTED",
      });
    }

    if (!sellerAccount.onboarding_complete) {
      return res.status(400).json({
        error: "Seller has not completed Stripe onboarding",
        code: "SELLER_ONBOARDING_INCOMPLETE",
      });
    }

    // ─── Build line items based on purchase type ───────────────────────────
    let lineItems = [];
    let totalAmountCents = 0;
    let metadata = {
      purchaseType,
      buyerWallet: buyerWallet.toLowerCase(),
      sellerWallet: sellerWallet.toLowerCase(),
      sellerStripeAccountId: sellerAccount.stripe_account_id,
    };

    switch (purchaseType) {
      case "specimen": {
        // Single specimen: items[0] = { tokenId, commonName, priceCentsUSD, imageUrl? }
        const item = items[0];
        lineItems.push({
          price_data: {
            currency: "usd",
            product_data: {
              name: item.commonName || `Specimen #${item.tokenId}`,
              description: item.scientificName
                ? `${item.scientificName} — Token #${item.tokenId}`
                : `Live specimen — Token #${item.tokenId}`,
              images: item.imageUrl ? [item.imageUrl] : [],
            },
            unit_amount: item.priceCentsUSD,
          },
          quantity: 1,
        });
        totalAmountCents = item.priceCentsUSD;
        metadata.tokenId = String(item.tokenId);
        break;
      }

      case "shipping": {
        // Shipping specimen: items[0] = { tokenId, commonName, priceCentsUSD, shippingFeeCents, imageUrl? }
        const item = items[0];
        lineItems.push({
          price_data: {
            currency: "usd",
            product_data: {
              name: item.commonName || `Specimen #${item.tokenId}`,
              description: item.scientificName
                ? `${item.scientificName} — Token #${item.tokenId} (Live Arrival Guaranteed)`
                : `Live specimen — Token #${item.tokenId} (Live Arrival Guaranteed)`,
              images: item.imageUrl ? [item.imageUrl] : [],
            },
            unit_amount: item.priceCentsUSD,
          },
          quantity: 1,
        });
        if (item.shippingFeeCents && item.shippingFeeCents > 0) {
          lineItems.push({
            price_data: {
              currency: "usd",
              product_data: {
                name: "Insulated Live Fish Shipping",
                description: "Priority overnight shipping with heat/cold pack and breather bag",
              },
              unit_amount: item.shippingFeeCents,
            },
            quantity: 1,
          });
        }
        totalAmountCents = item.priceCentsUSD + (item.shippingFeeCents || 0);
        metadata.tokenId = String(item.tokenId);
        metadata.shippingFeeCents = String(item.shippingFeeCents || 0);
        break;
      }

      case "batch": {
        // Batch juvenile purchase: items[0] = { listingId, commonName, pricePerFishCents, quantity, imageUrl? }
        const item = items[0];
        lineItems.push({
          price_data: {
            currency: "usd",
            product_data: {
              name: `${item.commonName || "Juvenile Fish"} (x${item.quantity})`,
              description: `Batch of ${item.quantity} juvenile specimens from spawn`,
              images: item.imageUrl ? [item.imageUrl] : [],
            },
            unit_amount: item.pricePerFishCents,
          },
          quantity: item.quantity,
        });
        totalAmountCents = item.pricePerFishCents * item.quantity;
        metadata.listingId = String(item.listingId);
        metadata.quantity = String(item.quantity);
        break;
      }

      case "multi": {
        // Multiple specimens from same seller: items[] = [{ tokenId, commonName, priceCentsUSD, imageUrl? }, ...]
        const tokenIds = [];
        for (const item of items) {
          lineItems.push({
            price_data: {
              currency: "usd",
              product_data: {
                name: item.commonName || `Specimen #${item.tokenId}`,
                description: `Live specimen — Token #${item.tokenId}`,
                images: item.imageUrl ? [item.imageUrl] : [],
              },
              unit_amount: item.priceCentsUSD,
            },
            quantity: 1,
          });
          totalAmountCents += item.priceCentsUSD;
          tokenIds.push(String(item.tokenId));
        }
        // Add consolidated shipping if present
        const shippingFee = items[0]?.shippingFeeCents || 0;
        if (shippingFee > 0) {
          lineItems.push({
            price_data: {
              currency: "usd",
              product_data: {
                name: "Consolidated Live Fish Shipping",
                description: `Priority overnight shipping for ${items.length} specimens`,
              },
              unit_amount: shippingFee,
            },
            quantity: 1,
          });
          totalAmountCents += shippingFee;
        }
        metadata.tokenIds = JSON.stringify(tokenIds);
        metadata.shippingFeeCents = String(shippingFee);
        break;
      }

      default:
        return res.status(400).json({ error: `Unknown purchaseType: ${purchaseType}` });
    }

    // ─── Calculate platform fee (4%) ───────────────────────────────────────
    const platformFeeCents = Math.round(totalAmountCents * (PLATFORM_FEE_PERCENT / 100));

    // ─── Create Stripe Checkout Session with Connect destination charge ────
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      payment_intent_data: {
        // Route payment to the seller's connected account minus platform fee
        application_fee_amount: platformFeeCents,
        transfer_data: {
          destination: sellerAccount.stripe_account_id,
        },
        metadata,
      },
      metadata,
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL,
      // Accept all common payment methods
      payment_method_types: ["card"],
      // Allow Apple Pay and Google Pay via Payment Element
      payment_method_options: {
        card: {
          setup_future_usage: undefined, // Don't save card
        },
      },
    });

    return res.status(200).json({
      success: true,
      checkoutUrl: session.url,
      sessionId: session.id,
      totalAmountCents,
      platformFeeCents,
      sellerReceivesCents: totalAmountCents - platformFeeCents,
    });
  } catch (err) {
    console.error("[Stripe Checkout] Session creation failed:", err);
    return res.status(500).json({
      error: "Failed to create checkout session",
      details: err.message,
    });
  }
}
