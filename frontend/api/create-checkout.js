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
 *   5. On success, stripe.js (webhook action) triggers the on-chain NFT transfer
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
import { handleCorsPreFlight } from "./_lib/cors.js";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

const supabase = createClient(
  process.env.SUPABASE_URL || "",
  process.env.SUPABASE_SERVICE_KEY || ""
);

// Platform fee: 4% of the goods price (matches on-chain TOTAL_FEE_BPS = 400).
// Shipping is passed through to the seller in full (no platform fee on shipping),
// matching the contract's releaseShippingEscrow math (fee on price only).
const PLATFORM_FEE_PERCENT = 4;

// Buyer-paid Stripe processing fee. The buyer covers card processing so the
// platform never nets less than (goods + shipping). We "gross up" the charge:
//   buyerTotal = (goodsTotal + fixed) / (1 - rate)
// so that after Stripe deducts its cut, exactly goodsTotal remains in the
// platform balance to split between the seller (96% + shipping) and platform (4%).
// US card default is 2.9% + $0.30. International/AmEx can run slightly higher;
// the 4% platform margin absorbs any small delta. Bump these (e.g., 0.032) if you
// see cross-border volume eating the margin.
const STRIPE_FEE_RATE = 0.029;
const STRIPE_FEE_FIXED_CENTS = 30;

export default async function handler(req, res) {
  // CORS
  if (handleCorsPreFlight(req, res, { methods: 'POST, OPTIONS' })) return;

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

  // Guest purchases from the public marketplace page use 'guest' as a placeholder.
  // On-chain settlement will be deferred until the buyer links an account.
  const isGuestPurchase = buyerWallet === 'guest' || buyerWallet === '0x0000000000000000000000000000000000000000';

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
      isGuestPurchase: isGuestPurchase ? "true" : "false",
    };

    switch (purchaseType) {
      case "specimen":
      case "pickup": {
        // Single specimen — "specimen" is a no-handoff sale (paid through), while
        // "pickup" is local/in-person and HELD until the handshake at handoff.
        // items[0] = { tokenId, commonName, priceCentsUSD, imageUrl? }
        const item = items[0];
        lineItems.push({
          price_data: {
            currency: "usd",
            product_data: {
              name: item.commonName || `Live Specimen`,
              description: item.scientificName
                ? `${item.scientificName} — Verified breeder specimen`
                : `Live specimen from verified breeder`,
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
              name: item.commonName || `Live Specimen`,
              description: item.scientificName
                ? `${item.scientificName} — Live Arrival Guaranteed`
                : `Live specimen — Live Arrival Guaranteed`,
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
              description: `Batch of ${item.quantity} tank-raised juveniles from verified breeder`,
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
                name: item.commonName || `Live Specimen`,
                description: `Live specimen from verified breeder`,
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

    // ─── Escrow money model: separate charges + transfers ─────────────────
    // We do NOT use a destination charge here. Funds are captured into the
    // PLATFORM balance and HELD. The seller is paid later via a Stripe Transfer:
    //   • shipping orders → transferred on live-arrival release (see stripe.js ?action=release)
    //   • instant/batch/multi → transferred immediately on settlement (webhook)
    // This is what makes "funds held until arrival" real instead of paying the
    // seller at checkout.
    //
    // Fee split (on the platform-balance amount, i.e. goods + shipping):
    //   platform keeps 4% of the goods price; seller gets 96% of price + full shipping.
    const shippingCents = Number(metadata.shippingFeeCents || 0);
    const goodsPriceCents = totalAmountCents - shippingCents; // specimen/batch price portion
    const platformFeeCents = Math.round(goodsPriceCents * (PLATFORM_FEE_PERCENT / 100));
    const sellerPayoutCents = totalAmountCents - platformFeeCents; // 96% of price + shipping

    // Buyer covers Stripe's processing fee (grossed up). Round the buyer total UP
    // so we never under-collect and dip into the platform's 4%.
    const buyerTotalCents = Math.ceil(
      (totalAmountCents + STRIPE_FEE_FIXED_CENTS) / (1 - STRIPE_FEE_RATE)
    );
    const processingFeeCents = buyerTotalCents - totalAmountCents;

    // Surface the processing fee as its own line item so the buyer sees exactly
    // what they're paying (a marketplace "service fee", not a hidden markup).
    if (processingFeeCents > 0) {
      lineItems.push({
        price_data: {
          currency: "usd",
          product_data: {
            name: "Service & processing fee",
            description: "Secure checkout, buyer protection, and card processing",
          },
          unit_amount: processingFeeCents,
        },
        quantity: 1,
      });
    }

    // transfer_group links the charge to the later Transfer(s) to the seller.
    const transferGroup = `aqx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Carry everything the release/settlement steps need to pay the seller.
    metadata.goodsTotalCents = String(totalAmountCents); // amount that nets into platform balance
    metadata.platformFeeCents = String(platformFeeCents);
    metadata.sellerPayoutCents = String(sellerPayoutCents);
    metadata.processingFeeCents = String(processingFeeCents);
    metadata.transferGroup = transferGroup;

    // ─── Create Stripe Checkout Session (capture-and-hold) ─────────────────
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      payment_intent_data: {
        // No transfer_data / application_fee: funds land in the platform balance
        // and are held. The seller is paid via a later Transfer within transfer_group.
        transfer_group: transferGroup,
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
      goodsTotalCents: totalAmountCents,
      processingFeeCents,
      buyerTotalCents,
      platformFeeCents,
      sellerReceivesCents: sellerPayoutCents,
    });
  } catch (err) {
    console.error("[Stripe Checkout] Session creation failed:", err);
    return res.status(500).json({
      error: "Failed to create checkout session",
      details: err.message,
    });
  }
}
