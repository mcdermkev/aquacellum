import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { ethers, Contract, formatEther, parseEther } from "ethers";
import marketplaceAbi from "../abi/AquadexMarketplace.json";
import managerAbi from "../abi/AquadexManager.json";
import { addXp, XP_ACTIONS } from "../utils/xp";
import { getProvider } from "../utils/smartAccount";
import { fetchListingsByBreed } from "../utils/listingManager";
import {
  relayUpdateBatchOrder,
  relaySettleHandshake,
  relayGetOrders,
  getLocalListings,
  relayDispatchShipping,
  relayDisputeShipping,
  relayResolveShippingDispute,
} from "../services/relayer";
import {
  purchaseShippingSpecimen,
  purchasePickupSpecimen,
  purchaseBatch as stripePurchaseBatch,
  purchaseMultiple as stripePurchaseMultiple,
  releaseFiatOrder,
} from "../services/stripePayments";
import { useHandshake } from "../hooks/useHandshake";
import { db } from "../db";
import { generateAlias } from "../utils/generateAlias";
import { getProfile } from "../services/reefApi";
import { useRewardCredits, useApplyCredits } from "../hooks/useRewardsPool";
import { calculateCheckoutDiscount } from "../services/rewardsPoolApi";
import { ArrivalModal } from "./ArrivalModal";
import { ShippingRateModal } from "./ShippingRateModal";
import { evaluateTankFit } from "../services/addOnRecommender";
import { buyShippingLabel } from "../services/shipping";
import { pushOrderToCloud, pullOrdersFromCloud, pushAllLocalOrders, subscribeToOrderUpdates } from "../services/ordersSync";
import { OrderReceipt } from "./OrderReceipt";
import { OrderAnalytics } from "./OrderAnalytics";
import { OrderWatchlistReorder } from "./OrderWatchlistReorder";
import { getFeatureStatus, getNextTierUnlocks } from "../utils/orderFeatureGates";
import { hasEntitlement } from "../services/entitlements";
import { normalizeBuyerOrders, filterBuyerOrders } from "../services/buyerOrderView";

/**
 * DisplayName — Resolves a wallet address to a human-readable display name.
 * Checks Supabase Reef profile first, then local Dexie, then falls back to generateAlias.
 */
function DisplayName({ address }) {
  const [name, setName] = useState(() => address ? generateAlias(address) : "Unknown");

  useEffect(() => {
    if (!address) return;
    let cancelled = false;

    (async () => {
      // 1. Try Supabase Reef profile
      try {
        const { data } = await getProfile(address);
        if (!cancelled && data?.display_name) {
          setName(data.display_name);
          return;
        }
      } catch (e) {}

      // 2. Try local Dexie userProfile
      try {
        const local = await db.userProfile.get(address);
        if (!cancelled && local?.alias) {
          setName(local.alias);
          return;
        }
      } catch (e) {}

      // 3. Fallback: deterministic alias
      if (!cancelled) {
        setName(generateAlias(address));
      }
    })();

    return () => { cancelled = true; };
  }, [address]);

  return <>{name}</>;
}

const ESCROW_STATES = ["HELD", "COMPLETED", "REFUNDED"];
const SHIPPING_STATUSES = ["PROCESSING", "SHIPPED", "DELIVERED", "UNDER REVIEW", "REFUNDED"];

const mapContractError = (err, isCasual) => {
  const errStr = (err.reason || err.message || err.data?.message || "").toLowerCase();
  
  if (errStr.includes("maxbatchexceeded") || errStr.includes("batchquantityexceeded")) {
    return isCasual 
      ? "Whoops! To ensure safe transport, you can only bundle up to 6 fish per order. Let's split this into two boxes!" 
      : "Security Protocol: Shipping box allocation limits reached. Consolidate current queue or initialize a secondary transport manifest (Max 6 specimens per batch).";
  }
  if (errStr.includes("safetywindownotelapsed") || errStr.includes("escrowlocked") || errStr.includes("escrownotdispatched")) {
    return "Security Notice: This specimen is safely secured in transit protection. Transfer controls unlock automatically once the standard safety window closes.";
  }
  if (errStr.includes("invalidcommitment")) {
    return "Verification Fault: Handshake PIN does not match. Please re-scan the secure handshake voucher.";
  }
  
  return isCasual 
    ? "Oops, something went wrong with the transaction. Please try again."
    : (err.reason || err.message || "Transaction failed.");
};

export function CheckoutSummary({ 
  contractAddress, 
  marketplaceAddress, 
  walletAccount,
  preselectedOrderForCheckout,
  clearPreselectedOrder,
  displayTank,
  casualModeActive = false
}) {
  const { getPendingHandshake } = useHandshake();
  const { data: creditData } = useRewardCredits();
  const applyCredits = useApplyCredits();
  const [useCreditsAtCheckout, setUseCreditsAtCheckout] = useState(true);
  const [purchases, setPurchases] = useState([]);
  const [shippingEscrows, setShippingEscrows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentLocation, setCurrentLocation] = useState({ isInsideEventZone: true });
  const [insideEventZone, setInsideEventZone] = useState(true);
  
  // Selected order details
  const [selectedOrder, setSelectedOrder] = useState(null); // { type: "batch" | "shipping", data: ... }
  const [pinInput, setPinInput] = useState("");
  const [trackingInput, setTrackingInput] = useState("");

  // Deep-linkable order detail: ?order=<orderKey> (ship-<tokenId> | batch-<purchaseId>),
  // the same identity scheme buyerOrderView.assembleBuyerOrderView derives (Task 18).
  // Mirrors the MarketplaceBoard ?listing= precedent: resolve against the loaded
  // orders once available, and show a not-found state for an id with no match
  // instead of crashing or silently doing nothing.
  const [searchParams, setSearchParams] = useSearchParams();
  const [orderNotFound, setOrderNotFound] = useState(false);

  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [actionTx, setActionTx] = useState(null);

  const openOrderDetail = (type, order) => {
    const key = type === "shipping" ? `ship-${order.tokenId}` : `batch-${order.purchaseId}`;
    const next = new URLSearchParams(searchParams);
    next.set("order", key);
    setSearchParams(next);
    setSelectedOrder({ type, data: order });
    setOrderNotFound(false);
  };

  /** Remove the ?order= param without touching other drawer state (used by
   * action handlers that manage pin/tracking/actionError themselves and just
   * need the URL to stop pointing at the now-closed drawer — otherwise the
   * deep-link resolution effect below would re-open it on the next
   * fetchOrders() refresh). */
  const clearOrderParam = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("order");
    setSearchParams(next);
  };

  const closeOrderDetail = () => {
    clearOrderParam();
    setSelectedOrder(null);
    setOrderNotFound(false);
    setPinInput("");
    setTrackingInput("");
    setActionError(null);
  };
  
  // Curator state
  const [isCurator, setIsCurator] = useState(false);

  // Consolidated Checkout Cart States
  const [pendingTokenIds, setPendingTokenIds] = useState([]);
  // Payment-first batch checkout (fry batches). Holds { listingId, quantity }
  // until the buyer confirms; nothing is consumed locally until Stripe settles.
  const [pendingBatchCheckout, setPendingBatchCheckout] = useState(null);
  const [allActiveListings, setAllActiveListings] = useState([]);
  const [fishbaseLookup, setFishbaseLookup] = useState({});
  const [fishbaseData, setFishbaseData] = useState([]);

  // Cash Handshake States
  const [isCashHandshake, setIsCashHandshake] = useState(false);
  const [cashHandshakePayload, setCashHandshakePayload] = useState(null);
  const [currentEventId, setCurrentEventId] = useState(1);

  // Arrival Flow States
  const [arrivalModalOpen, setArrivalModalOpen] = useState(false);
  const [arrivalSpecimen, setArrivalSpecimen] = useState(null);
  const [arrivalShippingOrder, setArrivalShippingOrder] = useState(null);

  // Buyer-paid live shipping: rate-selection modal (opens before Stripe checkout
  // for shipping listings so the buyer picks a real, distance-based rate).
  const [shipRateModal, setShipRateModal] = useState(null); // { listing } | null
  // Seller in-app label purchase (auto-dispatch) state.
  const [labelBuying, setLabelBuying] = useState(false);

  // Order Filter & Search States
  const [orderFilter, setOrderFilter] = useState("all"); // "all" | "active" | "completed" | "disputed"
  const [orderSearch, setOrderSearch] = useState("");
  const [orderSort, setOrderSort] = useState("newest"); // "newest" | "oldest" | "price_high" | "price_low"
  const [expandedReceipt, setExpandedReceipt] = useState(null); // "ship-{tokenId}" or "batch-{purchaseId}"

  // User tier for XP-gated features
  const [userTier, setUserTier] = useState("Shallow");
  const [totalXp, setTotalXp] = useState(0);

  useEffect(() => {
    if (preselectedOrderForCheckout && !loading) {
      const { type, id } = preselectedOrderForCheckout;
      if (type === "pending_purchase") {
        const tokenIdNum = Number(id);
        if (!pendingTokenIds.includes(tokenIdNum)) {
          setPendingTokenIds(prev => [...prev, tokenIdNum]);
        }
      } else if (type === "shipping") {
        const match = shippingEscrows.find(o => Number(o.tokenId) === Number(id));
        if (match) {
          setSelectedOrder({ type: "shipping", data: match });
        }
      } else if (type === "batch") {
        const match = purchases.find(o => Number(o.purchaseId) === Number(id));
        if (match) {
          setSelectedOrder({ type: "batch", data: match });
        }
      } else if (type === "pending_batch") {
        // Payment-first fry-batch checkout — stage it, don't consume yet.
        const qty = Number(preselectedOrderForCheckout?.meta?.quantity) || 1;
        setPendingBatchCheckout({ listingId: Number(id), quantity: qty });
      } else if (type === "pending_cart") {
        // Task 10: the cart hands off its full item list here rather than
        // checkout gaining any new logic. Splits across the two checkout
        // lanes that already exist — single-item consolidated checkout
        // (pendingTokenIds) and the fry-batch checkout panel
        // (pendingBatchCheckout) — both of which render independently, so a
        // mixed single+batch cart shows both panels rather than one combined
        // checkout. No new money/settlement logic; this is pure hand-off.
        const items = Array.isArray(preselectedOrderForCheckout?.meta?.items) ? preselectedOrderForCheckout.meta.items : [];
        const singleTokenIds = items.filter((i) => !i.isBatch && i.tokenId != null).map((i) => Number(i.tokenId));
        const firstBatch = items.find((i) => i.isBatch && i.listingId != null);
        if (singleTokenIds.length > 0) {
          setPendingTokenIds((prev) => [...new Set([...prev, ...singleTokenIds])]);
        }
        if (firstBatch) {
          setPendingBatchCheckout({ listingId: Number(firstBatch.listingId), quantity: Number(firstBatch.quantity) || 1 });
        }
      }
      if (clearPreselectedOrder) {
        clearPreselectedOrder();
      }
    }
  }, [preselectedOrderForCheckout, loading, shippingEscrows, purchases, clearPreselectedOrder, pendingTokenIds]);

  useEffect(() => {
    fetch("/fishbase_master.json?v=2")
      .then((res) => {
        if (!res.ok) throw new Error("Reference data load failed");
        return res.json();
      })
      .then((data) => {
        const lookup = {};
        data.forEach((item) => {
          lookup[item.scientificName.toLowerCase()] = item.tankMetrics;
        });
        setFishbaseLookup(lookup);
        setFishbaseData(data);
      })
      .catch((err) => console.error("Error loading fishbase reference:", err));
  }, []);

  const loadAllListings = async () => {
    if (!walletAccount || !marketplaceAddress) return;
    try {
      const provider = getProvider();
      let listingsData = [];
      try {
        listingsData = await fetchListingsByBreed(null, contractAddress, marketplaceAddress, provider);
      } catch (e) {
        console.warn("On-chain listings read failed, using local only:", e);
      }
      // Beta: merge local-first listings
      const local = await getLocalListings();
      const ids = new Set(listingsData.map(l => Number(l.id)));
      const merged = [...listingsData, ...local.filter(l => !ids.has(Number(l.id)))];
      setAllActiveListings(merged);
    } catch (e) {
      console.error("Failed to load active listings in CheckoutSummary:", e);
    }
  };

  useEffect(() => {
    loadAllListings();
  }, [contractAddress, marketplaceAddress, walletAccount]);

  // Adapts a marketplace listing item into the species-profile shape
  // evaluateTankFit expects, sourcing the minimum tank volume from the
  // fishbase lookup (by scientific name) the way the legacy formula did.
  const itemToSpeciesProfile = (item) => {
    const nameKey = item.scientificName ? item.scientificName.toLowerCase() : "";
    const metrics = fishbaseLookup[nameKey];
    return {
      minVolumeGallons: metrics?.minVolumeGallons ?? undefined,
      tempRange: item.minTemp != null && item.maxTemp != null ? [item.minTemp, item.maxTemp] : null,
      phRange: item.minPh != null && item.maxPh != null ? [item.minPh, item.maxPh] : null,
    };
  };

  const calculateCompatibility = (item) => {
    if (!displayTank) return 0;
    return evaluateTankFit(itemToSpeciesProfile(item), displayTank).score;
  };

  // Payment-first fry-batch checkout. Redirects to Stripe; the batch listing
  // quantity is only decremented on-chain (purchaseBatchFiat) after payment, so
  // abandoning here leaves the listing untouched. Price is re-verified
  // server-side against the seller's listing before the charge.
  const handleBatchCheckout = async () => {
    if (!pendingBatchCheckout) return;
    const listing = allActiveListings.find(
      (l) => l.isBatch && Number(l.listingId ?? l.id) === Number(pendingBatchCheckout.listingId)
    );
    if (!listing) {
      setActionError("This fry batch is no longer available. Please refresh and try again.");
      return;
    }
    setActionLoading(true);
    setActionError(null);
    try {
      const perFishCents =
        Number(listing.priceCentsUSD) ||
        Number(listing.pricePerFishCents) ||
        Math.round(parseFloat(listing.priceUsd ?? listing.price ?? "0") * 100);
      const quantity = Math.max(1, Math.min(Number(listing.quantity) || 1, Number(pendingBatchCheckout.quantity) || 1));
      const result = await stripePurchaseBatch({
        listingId: Number(pendingBatchCheckout.listingId),
        commonName: listing.commonName,
        pricePerFishCents: perFishCents,
        quantity,
        imageUrl: listing.photoUrl || listing.imageUrl || undefined,
        buyerWallet: walletAccount,
        sellerWallet: listing.seller,
      });
      // On success this redirects to Stripe; we only reach here on failure.
      if (!result.success) throw new Error(result.error || "Checkout failed");
    } catch (err) {
      console.error("Batch checkout failed:", err);
      setActionError(mapContractError(err, casualModeActive));
      setActionLoading(false);
    }
  };

  const handleConsolidatedCheckout = async () => {
    if (pendingTokenIds.length === 0) return;
    setActionLoading(true);
    setActionError(null);
    setActionTx(null);

    try {
      const firstId = pendingTokenIds[0];
      const firstListing = allActiveListings.find(l => Number(l.tokenId) === firstId);
      if (!firstListing) throw new Error("First listing not found in active listings");

      const seller = firstListing.seller;
      for (const tid of pendingTokenIds) {
        const item = allActiveListings.find(l => Number(l.tokenId) === tid);
        if (!item) throw new Error(`Listing not found for token ${tid}`);
        if (item.seller.toLowerCase() !== seller.toLowerCase()) {
          throw new Error("All items in consolidated checkout must be from the same seller");
        }
      }

      // USD cents for Stripe (canonical). Fall back to the dollar price for any
      // legacy listing that lacks priceCentsUSD.
      const toCents = (l) => Number(l.priceCentsUSD) || Math.round(parseFloat(l.priceUsd ?? l.price ?? "0") * 100);
      const toShipCents = (l) => Number(l.shippingFeeCents) || Math.round(parseFloat(l.shippingFee ?? "0") * 100);

      let result;
      if (pendingTokenIds.length === 1) {
        const l = firstListing;
        const base = {
          tokenId: Number(l.tokenId),
          commonName: l.commonName,
          scientificName: l.scientificName,
          priceCentsUSD: toCents(l),
          imageUrl: l.photoUrl || l.imageUrl || undefined,
          buyerWallet: walletAccount,
          sellerWallet: seller,
        };
        if (l.isShipping) {
          // Buyer-paid live shipping: open the rate modal to collect the buyer's
          // address and let them pick a real seller→buyer rate. Checkout is
          // started from the modal's onProceed (proceedShippingCheckout), so we
          // stop here rather than charging the flat listing fee.
          setActionLoading(false);
          setShipRateModal({ listing: { ...l, seller, priceCentsUSD: toCents(l), tokenId: Number(l.tokenId) } });
          return;
        }
        // Local pickup → held until the in-person handshake (Stripe Checkout).
        result = await purchasePickupSpecimen(base);
      } else {
        const items = pendingTokenIds.map((tid) => {
          const l = allActiveListings.find((x) => Number(x.tokenId) === tid);
          return {
            tokenId: Number(l.tokenId),
            commonName: l.commonName,
            priceCentsUSD: toCents(l),
            imageUrl: l.photoUrl || l.imageUrl || undefined,
            shippingFeeCents: toShipCents(l),
          };
        });
        result = await stripePurchaseMultiple({ items, buyerWallet: walletAccount, sellerWallet: seller });
      }

      // On success, stripePayments redirects the browser to Stripe's hosted
      // checkout, so nothing after this runs. We only reach past here on failure.
      if (!result.success) throw new Error(result.error || "Checkout failed");
    } catch (err) {
      console.error("Consolidated checkout failed:", err);
      setActionError(mapContractError(err, casualModeActive));
    } finally {
      setActionLoading(false);
      setActionTx(null);
    }
  };

  // Called by ShippingRateModal once the buyer picks a live rate. Starts Stripe
  // Checkout with the selected service + address; funds (item + real shipping)
  // are held in escrow until the buyer confirms live arrival.
  const proceedShippingCheckout = async ({ rate, shipTo }) => {
    const listing = shipRateModal?.listing;
    if (!listing || !rate) return;
    setActionLoading(true);
    setActionError(null);
    try {
      const result = await purchaseShippingSpecimen({
        tokenId: Number(listing.tokenId),
        commonName: listing.commonName,
        scientificName: listing.scientificName,
        priceCentsUSD: Number(listing.priceCentsUSD),
        shippingFeeCents: rate.amountCents,
        imageUrl: listing.photoUrl || listing.imageUrl || undefined,
        buyerWallet: walletAccount,
        sellerWallet: listing.seller,
        shipServiceCode: rate.serviceCode,
        shipCarrierId: rate.carrierId,
        shipTo,
      });
      // On success this redirects to Stripe; we only reach here on failure.
      if (!result.success) throw new Error(result.error || "Checkout failed");
    } catch (err) {
      console.error("Shipping checkout failed:", err);
      setActionError(mapContractError(err, casualModeActive));
      setActionLoading(false);
    }
  };

  // Seller buys a real shipping label in-app. The returned tracking number
  // auto-populates the dispatch (on-chain + order row) — no manual entry.
  const handleBuyLabel = async () => {
    if (!selectedOrder?.data) return;
    const o = selectedOrder.data;
    setLabelBuying(true);
    setActionError(null);
    setActionTx(null);
    try {
      const result = await buyShippingLabel({
        sellerWallet: walletAccount,
        tokenId: Number(o.tokenId),
        // Backend resolves service + buyer address from the order row when
        // available; pass any we already hold as a fallback.
        serviceCode: o.shipServiceCode || undefined,
        carrierId: o.shipCarrierId || undefined,
        shipTo: o.shipTo || undefined,
        paymentIntentId: o.paymentIntentId || undefined,
      });
      if (!result.success) throw new Error(result.error || "Label purchase failed");
      setActionTx(result.trackingNumber ? `Label bought — tracking ${result.trackingNumber}` : "Label purchased");
      setSelectedOrder(null);
      clearOrderParam();
      await fetchOrders();
      pushOrderAfterAction("shipping", o.tokenId);
    } catch (err) {
      console.error("Buy label failed:", err);
      setActionError(err.message || "Could not buy the shipping label.");
    } finally {
      setLabelBuying(false);
    }
  };

  const handleCashCheckout = async () => {
    if (pendingTokenIds.length === 0) return;
    setActionLoading(true);
    setActionError(null);

    try {
      const firstId = pendingTokenIds[0];
      const firstListing = allActiveListings.find(l => Number(l.tokenId) === firstId);
      if (!firstListing) throw new Error("First listing not found in active listings");
      const seller = firstListing.seller;

      // 1. Generate payload
      const payload = {
        type: "cash_handshake",
        buyer: walletAccount,
        tokenIds: [...pendingTokenIds],
        seller: seller,
        totalCost: totalCost,
        eventId: currentEventId,
        timestamp: Math.round(Date.now() / 1000)
      };

      // 2. Immediate local Dexie inventory deduction
      for (const tid of pendingTokenIds) {
        await db.listings.delete(tid);
      }

      // 3. Increment analytics count & grant loyalty double XP
      localStorage.setItem("aquadex_cash_orders_count", Number(localStorage.getItem("aquadex_cash_orders_count") || 0) + pendingTokenIds.length);
      addXp(XP_ACTIONS.CLAIM_EXCHANGE.points * 2 * pendingTokenIds.length, `⚡ LIVE EVENT DOUBLE LOYALTY REWARDS (Cash Handshake checkout)`);

      // 4. Save payload to open QR Modal
      setCashHandshakePayload(payload);

      // 5. Clear cart & update local views
      setPendingTokenIds([]);
      await fetchOrders();
      await loadAllListings();
    } catch (err) {
      console.error("Cash checkout failed:", err);
      setActionError(mapContractError(err, casualModeActive));
    } finally {
      setActionLoading(false);
    }
  };

  const fetchOrders = async () => {
    if (!walletAccount || !marketplaceAddress) {
      // Don't set loading=false here — keep showing skeleton until account resolves.
      // Only bail if we explicitly know there's no wallet to fetch for.
      if (walletAccount === null && marketplaceAddress) {
        // Account not yet resolved — stay in loading state
        return;
      }
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setActionError(null);

      // ── Fast path: load local-first orders immediately (Dexie/IndexedDB) ──
      // This makes the tab feel instant for the common case.
      let localShipping = [];
      let localPurchases = [];
      try {
        const local = await relayGetOrders(walletAccount);
        localShipping = local.shippingEscrows || [];
        localPurchases = local.purchases || [];
      } catch (e) {
        console.warn("Failed to load local orders:", e);
      }

      // Show local results immediately so the UI isn't blank
      setShippingEscrows(localShipping);
      setPurchases(localPurchases);
      setLoading(false);

      // ── Slow path: on-chain scan in background ──
      const provider = getProvider();
      const marketContract = new Contract(marketplaceAddress, marketplaceAbi, provider);
      const managerContract = new Contract(contractAddress, managerAbi, provider);

      // Check if user is curator
      try {
        const curatorAddr = await managerContract.curator();
        setIsCurator(curatorAddr.toLowerCase() === walletAccount.toLowerCase());
      } catch (e) {
        console.warn("Failed to check curator status:", e);
      }

      const totalSpecimens = Number(await managerContract.totalSpecimensMinted());

      // Parallel scan for shipping escrows (batched to avoid overwhelming RPC)
      const BATCH_SIZE = 10;
      const fetchedShipping = [];

      for (let start = 1; start <= totalSpecimens; start += BATCH_SIZE) {
        const end = Math.min(start + BATCH_SIZE - 1, totalSpecimens);
        const batch = [];
        for (let i = start; i <= end; i++) {
          batch.push(
            (async (tokenId) => {
              try {
                const esc = await marketContract.shippingEscrows(tokenId);
                if (esc.buyer === "0x0000000000000000000000000000000000000000") return null;
                const isBuyer = esc.buyer.toLowerCase() === walletAccount.toLowerCase();
                const isSeller = esc.seller.toLowerCase() === walletAccount.toLowerCase();
                if (!isBuyer && !isSeller && !isCurator) return null;

                const spec = await managerContract.specimens(tokenId);
                const species = await managerContract.speciesCatalog(Number(spec.speciesId));
                return {
                  tokenId,
                  buyer: esc.buyer,
                  seller: esc.seller,
                  price: formatEther(esc.price),
                  shippingFee: formatEther(esc.shippingFee),
                  amountLocked: formatEther(esc.amountLocked),
                  trackingNumber: esc.trackingNumber,
                  dispatchTimestamp: Number(esc.dispatchTimestamp),
                  status: Number(esc.status),
                  commonName: species.commonName,
                  role: isBuyer ? "Buyer" : isSeller ? "Seller" : "Curator"
                };
              } catch (e) {
                return null;
              }
            })(i)
          );
        }
        const results = await Promise.allSettled(batch);
        for (const r of results) {
          if (r.status === "fulfilled" && r.value) {
            fetchedShipping.push(r.value);
          }
        }
      }

      // Parallel scan for batch purchases (IDs 1-50)
      const fetchedBatches = [];
      const batchPromises = [];
      for (let i = 1; i <= 50; i++) {
        batchPromises.push(
          (async (purchaseId) => {
            try {
              const purch = await marketContract.escrowPurchases(purchaseId);
              if (purch.buyer === "0x0000000000000000000000000000000000000000") return null;
              const isBuyer = purch.buyer.toLowerCase() === walletAccount.toLowerCase();

              const listing = await marketContract.batchListings(purch.listingId);
              const isSeller = listing.seller.toLowerCase() === walletAccount.toLowerCase();

              if (!isBuyer && !isSeller && !isCurator) return null;

              let commonName = "Juvenile Fry Batch";
              try {
                const spawnRec = await managerContract.spawnRecords(listing.spawnId);
                const sireSpec = await managerContract.specimens(Number(spawnRec.sireId || 1));
                const species = await managerContract.speciesCatalog(Number(sireSpec.speciesId));
                commonName = `${species.commonName} Fry`;
              } catch (e) {}

              return {
                purchaseId,
                listingId: Number(purch.listingId),
                buyer: purch.buyer,
                seller: listing.seller,
                quantity: Number(purch.quantity),
                amountLocked: formatEther(purch.amountLocked),
                state: Number(purch.state),
                fulfillmentType: Number(purch.fulfillmentType),
                commonName,
                role: isBuyer ? "Buyer" : isSeller ? "Seller" : "Curator"
              };
            } catch (e) {
              return null;
            }
          })(i)
        );
      }
      const batchResults = await Promise.allSettled(batchPromises);
      for (const r of batchResults) {
        if (r.status === "fulfilled" && r.value) {
          fetchedBatches.push(r.value);
        }
      }

      // Merge on-chain results with local (local takes priority for duplicates)
      const localShipIds = new Set(localShipping.map(o => Number(o.tokenId)));
      const localPurchIds = new Set(localPurchases.map(o => Number(o.purchaseId)));

      const mergedShipping = [
        ...localShipping,
        ...fetchedShipping.filter(o => !localShipIds.has(Number(o.tokenId)))
      ];
      const mergedPurchases = [
        ...localPurchases,
        ...fetchedBatches.filter(o => !localPurchIds.has(Number(o.purchaseId)))
      ];

      setShippingEscrows(mergedShipping);
      setPurchases(mergedPurchases);
    } catch (err) {
      console.error("Error reading on-chain orders:", err);
      // Local orders were already loaded above, so UI is not blank.
      // Only set error if we have nothing to show at all.
      if (shippingEscrows.length === 0 && purchases.length === 0) {
        setError("Failed to fetch order tracking details from the network.");
      }
    }
  };

  useEffect(() => {
    fetchOrders();
  }, [contractAddress, marketplaceAddress, walletAccount]);

  // Deep-link route recovery: resolve ?order=<orderKey> against the loaded
  // shipping/batch orders once they're available. An id with no match (not
  // this account's order, wrong id, or not loaded yet) shows the not-found
  // state rather than crashing or silently doing nothing.
  useEffect(() => {
    const orderKeyParam = searchParams.get("order");
    if (!orderKeyParam) {
      setOrderNotFound(false);
      return;
    }
    if (loading) return; // still loading — wait for orders to resolve
    const shipMatch = shippingEscrows.find((o) => `ship-${o.tokenId}` === orderKeyParam);
    if (shipMatch) {
      setSelectedOrder({ type: "shipping", data: shipMatch });
      setOrderNotFound(false);
      return;
    }
    const batchMatch = purchases.find((o) => `batch-${o.purchaseId}` === orderKeyParam);
    if (batchMatch) {
      setSelectedOrder({ type: "batch", data: batchMatch });
      setOrderNotFound(false);
      return;
    }
    setSelectedOrder(null);
    setOrderNotFound(true);
  }, [searchParams, shippingEscrows, purchases, loading]);

  // Cloud sync: pull orders from Supabase and subscribe to realtime updates
  useEffect(() => {
    if (!walletAccount) return;

    // Load user tier for XP-gated features
    (async () => {
      try {
        const profile = await db.userProfile.get(walletAccount);
        if (profile) {
          setUserTier(profile.currentTier || "Shallow");
          setTotalXp(profile.totalXp || 0);
        }
      } catch (e) {}
    })();

    // Push local orders to cloud first (ensures fiat_pending orders from this
    // device are visible server-side for the other party and for cross-device sync)
    pushAllLocalOrders(walletAccount).catch(() => {});

    // Pull cloud orders on mount (merges into local Dexie)
    pullOrdersFromCloud(walletAccount).then(({ pulled, updated }) => {
      if (updated > 0) fetchOrders(); // Refresh UI if cloud had newer data
    });

    // Subscribe to live order status changes from the other party
    const unsubscribe = subscribeToOrderUpdates(walletAccount, (updatedOrder) => {
      // Re-fetch local orders when a realtime update arrives
      fetchOrders();
    });

    return () => unsubscribe();
  }, [walletAccount]);

  // Push order to cloud after local state changes (fire-and-forget)
  const pushOrderAfterAction = async (orderType, identifier) => {
    try {
      let order;
      if (orderType === "shipping") {
        order = await db.marketOrders.where({ orderType: "shipping", tokenId: Number(identifier) }).first();
      } else if (orderType === "batch") {
        order = await db.marketOrders.where({ orderType: "batch", purchaseId: Number(identifier) }).first();
      }
      if (order) await pushOrderToCloud(order);
    } catch (e) {
      // Non-critical — cloud sync is best-effort
    }
  };

  // Safety: if wallet never resolves after 3s, stop loading so the empty state shows
  useEffect(() => {
    if (!walletAccount && loading) {
      const timer = setTimeout(() => {
        setLoading(false);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [walletAccount, loading]);

  const handleKeypadPress = (val) => {
    if (val === "C") {
      setPinInput("");
    } else if (val === "⌫") {
      setPinInput(prev => prev.slice(0, -1));
    } else if (pinInput.length < 4) {
      setPinInput(prev => prev + val);
    }
  };

  // Secure local release with PIN (Seller calls)
  const handleInPersonReleaseSubmit = async () => {
    if (pinInput.length !== 4) return;
    setActionLoading(true);
    setActionError(null);
    setActionTx(null);

    try {
      const handshake = await getPendingHandshake(selectedOrder.data.purchaseId);
      const salt = handshake ? handshake.salt : null;
      if (!salt) {
        throw new Error("Handshake salt not found in local cache. Breeder must scan the QR code or ensure the pre-image is persisted.");
      }

      // Beta: settle handshake locally (no MetaMask, no gas)
      const result = await relaySettleHandshake({ purchaseId: selectedOrder.data.purchaseId });
      if (!result.success) throw new Error(result.error || "Settlement failed");

      const baseXp = XP_ACTIONS.CLAIM_EXCHANGE.points;
      const isInsideEventZone = insideEventZone === true || !!currentEventId;
      const finalXp = isInsideEventZone ? baseXp * 2 : baseXp;
      const finalLabel = isInsideEventZone 
        ? "⚡ LIVE EVENT DOUBLE LOYALTY REWARDS UNLOCKED!" 
        : "Verified In-Person Handshake";

      addXp(finalXp, finalLabel);
      
      setPinInput("");
      setSelectedOrder(null);
      clearOrderParam();
      await fetchOrders();
    } catch (err) {
      console.error("PIN release failed:", err);
      setActionError(mapContractError(err, casualModeActive));
    } finally {
      setActionLoading(false);
      setActionTx(null);
    }
  };

  // Dispatch Shipping (Seller calls)
  const handleDispatchShipping = async () => {
    if (!trackingInput) return;
    setActionLoading(true);
    setActionError(null);
    setActionTx(null);

    try {
      const result = await relayDispatchShipping(selectedOrder.data.tokenId, trackingInput);
      if (!result.success) throw new Error(result.error || "Dispatch failed");

      setTrackingInput("");
      setSelectedOrder(null);
      clearOrderParam();
      await fetchOrders();
      pushOrderAfterAction("shipping", selectedOrder.data.tokenId);
    } catch (err) {
      console.error("Dispatch shipping failed:", err);
      setActionError(mapContractError(err, casualModeActive));
    } finally {
      setActionLoading(false);
      setActionTx(null);
    }
  };

  // Release Shipping Escrow (Buyer at any time, Seller after 3 days)
  // Now opens ArrivalModal for buyers to merge escrow release + tank assignment
  const handleReleaseShipping = async () => {
    if (!selectedOrder?.data) return;

    const order = selectedOrder.data;
    const isBuyer = order.role === "Buyer";

    // For buyers: open ArrivalModal (merged flow)
    if (isBuyer) {
      // Try to find the specimen record for this token
      let specimen = null;
      try {
        specimen = await db.specimens.get(Number(order.tokenId));
      } catch (e) {
        // Specimen may not exist locally yet — create a stub for the modal
      }
      if (!specimen) {
        specimen = {
          id: Number(order.tokenId),
          commonName: order.commonName || "Specimen",
        };
      }
      setArrivalSpecimen(specimen);
      setArrivalShippingOrder(order);
      setArrivalModalOpen(true);
      return;
    }

    // For sellers (after safety window): release directly as before
    setActionLoading(true);
    setActionError(null);
    setActionTx(null);

    try {
      const o = selectedOrder.data;
      const result = await releaseFiatOrder({
        tokenId: o.tokenId,
        sessionId: o.stripeSessionId,
        paymentIntentId: o.paymentIntentId,
      });
      if (!result.success) throw new Error(result.error || "Release failed");

      setSelectedOrder(null);
      clearOrderParam();
      await fetchOrders();
    } catch (err) {
      console.error("Release shipping failed:", err);
      setActionError(err.message || "Failed to release shipping escrow.");
    } finally {
      setActionLoading(false);
      setActionTx(null);
    }
  };

  // Callback when ArrivalModal completes (buyer flow)
  const handleArrivalComplete = async () => {
    setArrivalModalOpen(false);
    setArrivalSpecimen(null);
    setArrivalShippingOrder(null);
    setSelectedOrder(null);
    clearOrderParam();
    await fetchOrders();
  };

  // Dispute Shipping Escrow (Buyer calls)
  const handleDisputeShipping = async () => {
    setActionLoading(true);
    setActionError(null);
    setActionTx(null);

    try {
      const result = await relayDisputeShipping(selectedOrder.data.tokenId);
      if (!result.success) throw new Error(result.error || "Dispute failed");

      setSelectedOrder(null);
      clearOrderParam();
      await fetchOrders();
    } catch (err) {
      console.error("Dispute failed:", err);
      setActionError(err.message || "Failed to initiate shipping dispute.");
    } finally {
      setActionLoading(false);
      setActionTx(null);
    }
  };

  // Resolve Shipping Dispute (Curator calls)
  const handleResolveDispute = async (refundBuyer) => {
    setActionLoading(true);
    setActionError(null);
    setActionTx(null);

    try {
      const result = await relayResolveShippingDispute(selectedOrder.data.tokenId, refundBuyer);
      if (!result.success) throw new Error(result.error || "Resolution failed");

      setSelectedOrder(null);
      clearOrderParam();
      await fetchOrders();
    } catch (err) {
      console.error("Resolve dispute failed:", err);
      setActionError(err.message || "Failed to resolve shipping dispute.");
    } finally {
      setActionLoading(false);
      setActionTx(null);
    }
  };

  // Release Batch Escrow (Buyer calls for shipping batch)
  const handleReleaseBatch = async () => {
    setActionLoading(true);
    setActionError(null);
    setActionTx(null);

    try {
      const result = await relayUpdateBatchOrder(selectedOrder.data.purchaseId, { state: 1 }); // RELEASED
      if (!result.success) throw new Error(result.error || "Release failed");

      setSelectedOrder(null);
      clearOrderParam();
      await fetchOrders();
    } catch (err) {
      console.error("Release batch failed:", err);
      setActionError(err.message || "Failed to release batch escrow.");
    } finally {
      setActionLoading(false);
      setActionTx(null);
    }
  };

  // Refund Batch Escrow (Seller calls)
  const handleRefundBatch = async () => {
    setActionLoading(true);
    setActionError(null);
    setActionTx(null);

    try {
      const result = await relayUpdateBatchOrder(selectedOrder.data.purchaseId, { state: 2 }); // REFUNDED
      if (!result.success) throw new Error(result.error || "Refund failed");

      setSelectedOrder(null);
      clearOrderParam();
      await fetchOrders();
    } catch (err) {
      console.error("Refund batch failed:", err);
      setActionError(err.message || "Failed to refund batch escrow.");
    } finally {
      setActionLoading(false);
      setActionTx(null);
    }
  };

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h3 style={{ fontSize: "1.25rem", color: "#fff", margin: "0 0 0.25rem 0" }}>My Orders</h3>
            <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", margin: 0 }}>Loading your order history...</p>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1.5rem" }}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass-card shimmer-placeholder" style={{ height: "200px", borderRadius: "var(--radius-md, 12px)" }} />
          ))}
        </div>
      </div>
    );
  }

  const cartItems = pendingTokenIds.map(tid => allActiveListings.find(l => Number(l.tokenId) === tid)).filter(Boolean);
  const activeSeller = cartItems[0]?.seller;
  const subtotal = cartItems.reduce((acc, item) => acc + parseFloat(item.price), 0);
  const firstShippingFee = cartItems[0] ? parseFloat(cartItems[0].shippingFee) : 0;
  const N = cartItems.length;
  const boxesCount = Math.ceil(N / 3) || 1;
  const totalShippingFee = firstShippingFee * boxesCount;
  const totalInvoiceCost = subtotal + totalShippingFee;
  const excessRefund = firstShippingFee * (boxesCount - 1);
  const totalCost = subtotal + firstShippingFee; // Net secure payment matching contract requirement

  const recommendedAddons = allActiveListings.filter((item) => {
    if (!item.seller || item.seller.toLowerCase() !== activeSeller?.toLowerCase()) return false;
    if (item.isBatch) return false;
    if (pendingTokenIds.includes(Number(item.tokenId))) return false;
    return calculateCompatibility(item) === 100;
  });

  const handleAddAddon = (tokenId) => {
    setPendingTokenIds(prev => [...prev, Number(tokenId)]);
  };

  const renderBoxGrid = () => {
    const boxesCount = Math.ceil(N / 3) || 1;
    const boxes = [];
    for (let b = 0; b < boxesCount; b++) {
      const slots = [];
      for (let s = 0; s < 3; s++) {
        const itemIndex = b * 3 + s;
        const isOccupied = itemIndex < N;
        const occupiedItem = cartItems[itemIndex];
        slots.push({ isOccupied, item: occupiedItem });
      }
      boxes.push(slots);
    }
    return (
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", margin: "1rem 0" }}>
        {boxes.map((box, idx) => {
          const occupiedCount = box.filter(s => s.isOccupied).length;
          const pct = Math.round((occupiedCount / 3) * 100);
          return (
            <div 
              key={idx} 
              className="glass-card" 
              style={{ 
                padding: "1rem", 
                width: "160px", 
                display: "flex", 
                flexDirection: "column", 
                alignItems: "center",
                border: "1px solid var(--glass-border-hover)",
                background: "rgba(255, 255, 255, 0.02)"
              }}
            >
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.5rem" }}>
                📦 Box {idx + 1} ({pct}% Full)
              </span>
              <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.5rem" }}>
                {box.map((slot, sIdx) => (
                  <div 
                    key={sIdx} 
                    style={{ 
                      width: "32px", 
                      height: "32px", 
                      borderRadius: "4px", 
                      background: slot.isOccupied ? "var(--accent-blue-glow)" : "rgba(255,255,255,0.03)", 
                      border: slot.isOccupied ? "1px solid var(--accent-blue)" : "1px solid rgba(255,255,255,0.08)",
                      display: "flex", 
                      alignItems: "center", 
                      justifyContent: "center",
                      fontSize: "0.9rem",
                      color: "#fff"
                    }}
                    title={slot.isOccupied ? slot.item.commonName : "Empty Slot"}
                  >
                    {slot.isOccupied ? "🐠" : ""}
                  </div>
                ))}
              </div>
              <span style={{ fontSize: "0.65rem", color: "var(--text-secondary)", textAlign: "center" }}>
                {occupiedCount} / 3 specimens
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {error && (
        <div 
          className="glass-card" 
          style={{ 
            padding: "1rem 1.25rem", 
            border: "1px solid rgba(248, 113, 113, 0.3)", 
            background: "rgba(248, 113, 113, 0.05)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <span style={{ fontSize: "1.25rem" }}>⚠️</span>
            <span style={{ color: "var(--accent-red, #f87171)", fontSize: "0.85rem" }}>{error}</span>
          </div>
          <button 
            className="btn-secondary" 
            style={{ padding: "0.3rem 0.75rem", fontSize: "0.75rem", flexShrink: 0 }}
            onClick={() => { setError(null); fetchOrders(); }}
          >
            Retry
          </button>
        </div>
      )}

      {pendingBatchCheckout && (() => {
        const listing = allActiveListings.find(
          (l) => l.isBatch && Number(l.listingId ?? l.id) === Number(pendingBatchCheckout.listingId)
        );
        const available = Number(listing?.quantity) || 1;
        const qty = Math.max(1, Math.min(available, Number(pendingBatchCheckout.quantity) || 1));
        const perFish = listing ? parseFloat(listing.priceUsd ?? listing.price ?? 0) : 0;
        const total = perFish * qty;
        return (
          <div
            className="glass-card"
            style={{
              padding: "2rem",
              marginBottom: "2rem",
              border: "1px solid var(--accent-blue)",
              background: "rgba(14, 20, 36, 0.45)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1.25rem", gap: "1rem" }}>
              <div>
                <h3 style={{ fontSize: "1.35rem", color: "#fff", margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                  <span>🐟</span> Confirm Fry Batch Purchase
                </h3>
                <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", margin: "0.25rem 0 0 0" }}>
                  {listing ? listing.commonName : "Fry batch"} from{" "}
                  <span style={{ fontFamily: "monospace", color: "var(--accent-blue)" }}>
                    <DisplayName address={listing?.seller} />
                  </span>
                </p>
              </div>
              <button
                className="btn-secondary"
                onClick={() => { setPendingBatchCheckout(null); setActionError(null); }}
                style={{ border: "1px solid rgba(248,113,113,0.3)", color: "var(--accent-red)", padding: "0.4rem 1rem", fontSize: "0.75rem", flexShrink: 0 }}
              >
                Cancel
              </button>
            </div>

            {actionError && (
              <div style={{ padding: "0.75rem", background: "rgba(248, 113, 113, 0.1)", border: "1px solid rgba(248,113,113,0.3)", color: "var(--accent-red)", fontSize: "0.8rem", borderRadius: "4px", marginBottom: "1rem" }}>
                {actionError}
              </div>
            )}

            {!listing ? (
              <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>
                This fry batch is no longer available. Please head back to the directory and refresh.
              </p>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "1.5rem", alignItems: "flex-end" }}>
                <div style={{ flex: "1 1 260px", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <label style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>Quantity</label>
                    <input
                      type="number"
                      min="1"
                      max={available}
                      value={qty}
                      onChange={(e) => {
                        const val = Math.max(1, Math.min(available, Number(e.target.value) || 1));
                        setPendingBatchCheckout((prev) => (prev ? { ...prev, quantity: val } : prev));
                      }}
                      style={{ width: "70px", background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", borderRadius: "4px", padding: "0.35rem 0.5rem", textAlign: "center", outline: "none", fontSize: "0.85rem" }}
                    />
                    <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{available} available</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.82rem", color: "var(--text-secondary)" }}>
                    <span>${perFish.toFixed(2)} / fish × {qty}</span>
                    <strong style={{ fontFamily: "monospace", color: "var(--accent-green)", fontSize: "1.05rem" }}>${total.toFixed(2)}</strong>
                  </div>
                  <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: 0, lineHeight: 1.5 }}>
                    🛡️ Your payment is held securely and only released to the breeder after you confirm the fry arrive safely. Nothing is reserved until you complete checkout.
                  </p>
                </div>
                <div style={{ flex: "0 0 auto", width: "220px" }}>
                  <button
                    className="btn-primary"
                    disabled={actionLoading || !walletAccount}
                    onClick={handleBatchCheckout}
                    style={{ width: "100%", justifyContent: "center" }}
                  >
                    {actionLoading ? "Processing checkout..." : `Complete Purchase · $${total.toFixed(2)}`}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {pendingTokenIds.length > 0 && (
        <div 
          className="glass-card" 
          style={{ 
            padding: "2rem", 
            marginBottom: "2rem", 
            border: "1px solid var(--accent-blue)", 
            background: "rgba(14, 20, 36, 0.45)" 
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
            <div>
              <h3 style={{ fontSize: "1.35rem", color: "#fff", margin: 0, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span>📦</span> Consolidated Shipping & Box Optimization
              </h3>
              <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", margin: 0 }}>
                Grouping specimens from seller <span style={{ fontFamily: "monospace", color: "var(--accent-blue)" }}><DisplayName address={activeSeller} /></span> to optimize box utilization and save shipping fees.
              </p>
            </div>
            <button 
              className="btn-secondary" 
              onClick={() => setPendingTokenIds([])} 
              style={{ border: "1px solid rgba(248,113,113,0.3)", color: "var(--accent-red)", padding: "0.4rem 1rem", fontSize: "0.75rem" }}
            >
              Clear Cart
            </button>
          </div>

          {actionError && (
            <div style={{ padding: "0.75rem", background: "rgba(248, 113, 113, 0.1)", border: "1px solid rgba(248,113,113,0.3)", color: "var(--accent-red)", fontSize: "0.8rem", borderRadius: "4px", marginBottom: "1rem" }}>
              {actionError}
            </div>
          )}

          {actionTx && (
            <div style={{ padding: "0.75rem", background: "var(--accent-blue-glow)", border: "1px solid rgba(56, 189, 248, 0.3)", color: "var(--accent-blue)", fontSize: "0.8rem", borderRadius: "4px", marginBottom: "1rem", wordBreak: "break-all" }}>
              <strong>Processing order...</strong> Securing your purchase protection.
            </div>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: "2rem", width: "100%" }}>
            {/* Left side: Items and Box visualization */}
            <div style={{ flex: "1 1 500px" }}>
              <h4 style={{ color: "#fff", fontSize: "0.95rem", marginBottom: "0.75rem" }}>Selected Specimens ({N})</h4>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.5rem" }}>
                {cartItems.map((item) => (
                  <div 
                    key={item.tokenId} 
                    style={{ 
                      display: "flex", 
                      justifyContent: "space-between", 
                      alignItems: "center", 
                      padding: "0.75rem 1rem", 
                      background: "rgba(255,255,255,0.02)", 
                      borderRadius: "6px",
                      border: "1px solid rgba(255,255,255,0.05)"
                    }}
                  >
                    <div>
                      <strong style={{ color: "#fff", fontSize: "0.85rem" }}>{item.commonName}</strong>
                      <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", display: "block", fontStyle: "italic" }}>{item.scientificName}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                      <span style={{ fontFamily: "monospace", color: "var(--accent-green)", fontSize: "0.9rem", fontWeight: "600" }}>
                        ${parseFloat(item.priceUsd ?? item.price ?? 0).toFixed(2)}
                      </span>
                      <button 
                        onClick={() => setPendingTokenIds(prev => prev.filter(id => id !== item.tokenId))}
                        style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: "1.1rem", cursor: "pointer", padding: "0 0.5rem" }}
                        title="Remove"
                      >
                        &times;
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <h4 style={{ color: "#fff", fontSize: "0.95rem", marginBottom: "0.5rem" }}>Box Utilization Visualizer</h4>
              {renderBoxGrid()}
            </div>

            {/* Right side: Summary and checkout details */}
            <div style={{ width: "300px", flexShrink: 0, display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              <div 
                className="glass-card" 
                style={{ 
                  padding: "1.25rem", 
                  background: "rgba(0,0,0,0.15)", 
                  border: "1px solid rgba(255,255,255,0.05)",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.75rem"
                }}
              >
                <h4 style={{ color: "#fff", fontSize: "0.9rem", margin: 0, textTransform: "uppercase", letterSpacing: "0.05em" }}>Checkout Summary</h4>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                  <span>Subtotal:</span>
                  <span style={{ fontFamily: "monospace", color: "#fff" }}>${subtotal.toFixed(2)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                  <span>📦 Consolidated Shipping Boxes ({boxesCount}):</span>
                  <span style={{ fontFamily: "monospace", color: "#fff" }}>${totalShippingFee.toFixed(2)}</span>
                </div>
                {((firstShippingFee * N) - totalShippingFee) > 0 && casualModeActive && (
                  <div style={{ 
                    display: "flex", 
                    justifyContent: "space-between", 
                    fontSize: "0.8rem", 
                    color: "var(--accent-green)",
                    background: "rgba(34, 197, 94, 0.05)",
                    padding: "0.25rem 0.5rem",
                    borderRadius: "4px"
                  }}>
                    <span>✨ Bundling Savings:</span>
                    <span style={{ fontFamily: "monospace" }}>-${((firstShippingFee * N) - totalShippingFee).toFixed(2)}</span>
                  </div>
                )}
                {boxesCount > 1 && !casualModeActive && (
                  <div style={{ 
                    display: "flex", 
                    justifyContent: "space-between", 
                    fontSize: "0.8rem", 
                    color: "var(--accent-green)",
                    background: "rgba(34, 197, 94, 0.05)",
                    padding: "0.25rem 0.5rem",
                    borderRadius: "4px"
                  }}>
                    <span>Automated Box Logistics Refund:</span>
                    <span style={{ fontFamily: "monospace" }}>-${excessRefund.toFixed(2)}</span>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: "1.05rem", borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "0.75rem", marginTop: "0.25rem" }}>
                  <strong style={{ color: "#fff" }}>Total</strong>
                  <strong style={{ fontFamily: "monospace", color: "var(--accent-green)", fontSize: "1.15rem" }}>${((() => {
                    const discount = calculateCheckoutDiscount(
                      totalCost,
                      creditData?.tier || "Shallow",
                      creditData?.credits || 0,
                      useCreditsAtCheckout
                    );
                    return discount.finalPrice;
                  })()).toFixed(2)}</strong>
                </div>

                <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", textAlign: "right", marginTop: "0.2rem" }}>
                  {casualModeActive ? "Shipping included · no hidden fees" : "Includes shipping and all fees"}
                </div>

                {/* Tier Discount + Reward Credits */}
                {(() => {
                  const discount = calculateCheckoutDiscount(
                    totalCost,
                    creditData?.tier || "Shallow",
                    creditData?.credits || 0,
                    useCreditsAtCheckout
                  );
                  return discount.totalSavings > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", marginTop: "0.4rem" }}>
                      {discount.tierDiscountAmount > 0 && (
                        <div style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: "0.75rem",
                          color: "var(--accent-amber, #fbbf24)",
                          background: "rgba(251, 191, 36, 0.05)",
                          padding: "0.3rem 0.5rem",
                          borderRadius: "4px",
                        }}>
                          <span>🏷️ Tier Discount ({Math.round(discount.tierDiscount * 100)}% — {creditData?.tier})</span>
                          <span style={{ fontFamily: "monospace" }}>-${discount.tierDiscountAmount.toFixed(2)}</span>
                        </div>
                      )}
                      {discount.creditsToApply > 0 && (
                        <div style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: "0.75rem",
                          color: "var(--accent-purple, #a855f7)",
                          background: "rgba(139, 92, 246, 0.05)",
                          padding: "0.3rem 0.5rem",
                          borderRadius: "4px",
                        }}>
                          <span>⭐ {casualModeActive ? "Loyalty Credits" : "Reward Credits"} Applied</span>
                          <span style={{ fontFamily: "monospace" }}>-${discount.creditsToApply.toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                  ) : null;
                })()}

                {/* Toggle: apply credits */}
                {(creditData?.credits || 0) > 0 && (
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    marginTop: "0.5rem",
                    padding: "0.4rem 0.5rem",
                    borderRadius: "6px",
                    background: "rgba(139, 92, 246, 0.04)",
                    border: "1px solid rgba(139, 92, 246, 0.1)",
                  }}>
                    <input
                      type="checkbox"
                      id="apply-credits-toggle"
                      checked={useCreditsAtCheckout}
                      onChange={(e) => setUseCreditsAtCheckout(e.target.checked)}
                      style={{ width: "14px", height: "14px", accentColor: "#a855f7", cursor: "pointer" }}
                    />
                    <label
                      htmlFor="apply-credits-toggle"
                      style={{ fontSize: "0.72rem", color: "var(--text-secondary)", cursor: "pointer" }}
                    >
                      Apply ${(creditData?.credits || 0).toFixed(2)} in {casualModeActive ? "Loyalty Credits" : "reward credits"}
                    </label>
                  </div>
                )}
                {casualModeActive && (
                  <div style={{
                    padding: "0.75rem",
                    background: "rgba(56, 189, 248, 0.05)",
                    border: "1px solid rgba(56, 189, 248, 0.15)",
                    borderRadius: "6px",
                    marginTop: "0.5rem"
                  }}>
                    <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", margin: 0, lineHeight: "1.4" }}>
                      ℹ️ Multi-item orders are bundled into optimal shipping boxes. We automate all logistics to minimize your shipping costs instantly.
                    </p>
                  </div>
                )}

                {/* Gated Event Zone Check for Cash Handshake */}
                {(insideEventZone === true || !!currentEventId) ? (
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    padding: "0.5rem",
                    background: "rgba(16, 185, 129, 0.05)",
                    border: "1px solid rgba(16, 185, 129, 0.2)",
                    borderRadius: "4px",
                    marginTop: "0.25rem",
                    marginBottom: "0.25rem"
                  }}>
                    <input 
                      type="checkbox" 
                      id="cash-handshake-toggle"
                      checked={isCashHandshake}
                      onChange={(e) => setIsCashHandshake(e.target.checked)}
                      style={{ cursor: "pointer" }}
                    />
                    <label htmlFor="cash-handshake-toggle" style={{ fontSize: "0.75rem", color: "#fff", cursor: "pointer", fontWeight: "600" }}>
                      🤝 Enable [ Cash Handshake ] Bypass
                    </label>
                  </div>
                ) : (
                  <div style={{
                    fontSize: "0.7rem",
                    color: "var(--text-muted)",
                    padding: "0.5rem",
                    background: "rgba(255, 255, 255, 0.02)",
                    border: "1px solid rgba(255, 255, 255, 0.05)",
                    borderRadius: "4px",
                    marginTop: "0.25rem",
                    marginBottom: "0.25rem",
                    textAlign: "center"
                  }}>
                    📍 Cash Handshake only available inside active live event zones.
                  </div>
                )}

                <button 
                  className="btn-primary" 
                  disabled={actionLoading} 
                  onClick={isCashHandshake && (insideEventZone === true || !!currentEventId) ? handleCashCheckout : handleConsolidatedCheckout}
                  style={{ width: "100%", justifyContent: "center", marginTop: "0.5rem" }}
                >
                  {actionLoading ? "Processing checkout..." : isCashHandshake && (insideEventZone === true || !!currentEventId) ? "Generate Cash Handshake QR" : "Complete Checkout (Consolidated)"}
                </button>
                <div style={{
                  marginTop: "1rem",
                  padding: "1rem",
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid rgba(255, 255, 255, 0.1)",
                  borderRadius: "8px"
                }}>
                  <h5 style={{ color: "#fff", margin: "0 0 0.5rem 0", fontSize: "0.85rem" }}>🛡️ What happens next?</h5>
                  <ul style={{ margin: 0, paddingLeft: "1.2rem", color: "var(--text-muted)", fontSize: "0.75rem", lineHeight: "1.5" }}>
                    <li>{casualModeActive ? "The breeder is notified and begins preparing your fish." : "The seller is notified and prepares your specimen(s) for dispatch."}</li>
                    <li>Your payment is held securely in escrow until delivery is confirmed.</li>
                    <li>{casualModeActive ? "Payment is only released when your fish arrives safely or you pick it up!" : "Funds release only when you confirm safe arrival or complete the pickup handshake — with a 3-day safety window on shipments."}</li>
                  </ul>
                </div>
              </div>

              {/* Cash Handshake QR Code Modal */}
              {cashHandshakePayload && (() => {
                const qrData = JSON.stringify(cashHandshakePayload);
                const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&color=10b981&bgcolor=0f172a&data=${encodeURIComponent(qrData)}`;
                return (
                  <div style={{
                    position: "fixed",
                    top: 0, left: 0, right: 0, bottom: 0,
                    background: "rgba(0, 0, 0, 0.8)",
                    backdropFilter: "blur(8px)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    zIndex: 2000, padding: "1rem"
                  }}>
                    <div className="glass-card" style={{
                      width: "100%", maxWidth: "420px", padding: "2rem",
                      background: "var(--bg-secondary)", border: "1px solid var(--accent-green)",
                      textAlign: "center", position: "relative"
                    }}>
                      <button 
                        onClick={() => setCashHandshakePayload(null)}
                        style={{ position: "absolute", top: "1rem", right: "1.25rem", background: "none", border: "none", color: "var(--text-muted)", fontSize: "1.25rem", cursor: "pointer" }}
                      >
                        &times;
                      </button>
                      <span style={{ fontSize: "2.5rem" }}>💵</span>
                      <h3 style={{ color: "#fff", marginTop: "0.5rem" }}>Cash Handshake QR Code</h3>
                      <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginBottom: "1.5rem" }}>
                        Show this QR code to the Breeder to complete the cash transfer and record lineage provenance.
                      </p>
                      
                      <div style={{
                        background: "rgba(255,255,255,0.02)",
                        border: "1px solid rgba(16, 185, 129, 0.3)",
                        borderRadius: "8px", padding: "1rem", display: "inline-block",
                        marginBottom: "1.5rem"
                      }}>
                        <img src={qrUrl} alt="Cash Handshake QR" style={{ display: "block", borderRadius: "4px", width: "200px", height: "200px" }} />
                      </div>

                      <div style={{ fontSize: "0.8rem", color: "var(--text-secondary)", textAlign: "left", background: "rgba(0,0,0,0.2)", padding: "0.75rem", borderRadius: "6px" }}>
                        <div>Buyer: <span style={{ fontFamily: "monospace", fontSize: "0.7rem" }}><DisplayName address={cashHandshakePayload.buyer} /></span></div>
                        <div>Seller: <span style={{ fontFamily: "monospace", fontSize: "0.7rem" }}><DisplayName address={cashHandshakePayload.seller} /></span></div>
                        <div>Specimens: <strong>{cashHandshakePayload.tokenIds.length}</strong></div>
                        <div>Total Price: <strong>${Number(cashHandshakePayload.totalCost || 0).toFixed(2)}</strong></div>
                        <div>Event ID: <strong>{cashHandshakePayload.eventId}</strong></div>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Recommended Add-ons section */}
              {recommendedAddons.length > 0 && (
                <div 
                  className="glass-card" 
                  style={{ 
                    padding: "1.25rem", 
                    background: "rgba(34, 197, 94, 0.02)", 
                    border: "1px solid rgba(34, 197, 94, 0.15)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.75rem"
                  }}
                >
                  <h4 style={{ color: "var(--accent-green)", fontSize: "0.85rem", margin: 0, fontWeight: "700", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                    🐠 Recommended Add-ons (100% Match)
                  </h4>
                  <p style={{ color: "var(--text-muted)", fontSize: "0.7rem", margin: 0 }}>
                    Other species from this breeder that perfectly match your tank:
                  </p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxHeight: "160px", overflowY: "auto" }}>
                    {recommendedAddons.map((addon) => (
                      <div 
                        key={addon.tokenId}
                        onClick={() => handleAddAddon(addon.tokenId)}
                        className="glass-card"
                        style={{ 
                          padding: "0.5rem", 
                          background: "rgba(255,255,255,0.01)", 
                          cursor: "pointer", 
                          display: "flex", 
                          justifyContent: "space-between", 
                          alignItems: "center",
                          border: "1px solid rgba(255,255,255,0.03)"
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1, paddingRight: "0.5rem" }}>
                          <strong style={{ fontSize: "0.75rem", color: "#fff", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {addon.commonName}
                          </strong>
                          <span style={{ fontSize: "0.65rem", color: "var(--accent-green)", fontWeight: "600" }}>
                            [100% Match]
                          </span>
                        </div>
                        <span style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "var(--accent-green)", flexShrink: 0 }}>
                          +${parseFloat(addon.priceUsd ?? addon.price ?? 0).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <h3 style={{ fontSize: "1.25rem", color: "#fff", marginBottom: "0.25rem" }}>Order Tracking & Protections</h3>
      <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", margin: "0 0 1rem 0" }}>
        All your purchases and sales with buyer protection, shipping tracking, and fulfillment actions.
      </p>

      {/* Order Filters & Search Bar */}
      {(shippingEscrows.length > 0 || purchases.length > 0) && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "1.25rem" }}>
          {/* Filter Tabs */}
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {[
              { key: "all", label: "All Orders", icon: "📋" },
              { key: "active", label: "Active", icon: "⏳" },
              { key: "completed", label: "Completed", icon: "✅" },
              { key: "disputed", label: "Disputed", icon: "⚠️" },
            ].map((tab) => {
              const isActive = orderFilter === tab.key;
              return (
                <button
                  key={tab.key}
                  onClick={() => setOrderFilter(tab.key)}
                  style={{
                    padding: "0.4rem 0.85rem",
                    fontSize: "0.72rem",
                    fontWeight: isActive ? "700" : "500",
                    background: isActive ? "rgba(56, 189, 248, 0.1)" : "rgba(255, 255, 255, 0.02)",
                    border: isActive ? "1px solid rgba(56, 189, 248, 0.4)" : "1px solid rgba(255, 255, 255, 0.08)",
                    borderRadius: "20px",
                    color: isActive ? "var(--accent-blue)" : "var(--text-secondary)",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                  }}
                >
                  {tab.icon} {tab.label}
                </button>
              );
            })}
          </div>

          {/* Search + Sort Row */}
          <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <div style={{ flex: 1, position: "relative" }}>
              <input
                type="text"
                value={orderSearch}
                onChange={(e) => setOrderSearch(e.target.value)}
                placeholder="Search by species name, tracking #, or serial..."
                style={{
                  width: "100%",
                  padding: "0.5rem 0.75rem 0.5rem 2rem",
                  background: "rgba(255, 255, 255, 0.03)",
                  border: "1px solid rgba(255, 255, 255, 0.08)",
                  borderRadius: "6px",
                  color: "#fff",
                  fontSize: "0.78rem",
                }}
              />
              <span style={{ position: "absolute", left: "0.6rem", top: "50%", transform: "translateY(-50%)", fontSize: "0.85rem", opacity: 0.5 }}>🔍</span>
            </div>
            <select
              value={orderSort}
              onChange={(e) => setOrderSort(e.target.value)}
              style={{
                padding: "0.5rem 0.6rem",
                background: "rgba(255, 255, 255, 0.03)",
                border: "1px solid rgba(255, 255, 255, 0.08)",
                borderRadius: "6px",
                color: "#fff",
                fontSize: "0.72rem",
                cursor: "pointer",
              }}
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="price_high">Price: High → Low</option>
              <option value="price_low">Price: Low → High</option>
            </select>
          </div>
        </div>
      )}

      {/* Apply filters to orders */}
      {(() => {
        // Status/search/sort predicates are delegated to the pure
        // filterBuyerOrders module (Task 18) so the buyer order list, the
        // order detail drawer, and OrderTimeline all classify "active" /
        // "completed" / "disputed" the same way, off the same canonical
        // states, instead of each re-deriving its own status-int predicates.
        // Shipping and batch orders are still filtered/sorted as two
        // independent groups (matching the existing two-section render below);
        // only the predicate/sort logic itself moves into the shared module.
        const shippingViews = filterBuyerOrders(normalizeBuyerOrders(shippingEscrows), {
          status: orderFilter, query: orderSearch, sort: orderSort,
        });
        const batchViews = filterBuyerOrders(normalizeBuyerOrders(purchases), {
          status: orderFilter, query: orderSearch, sort: orderSort,
        });
        const filteredShipping = shippingViews.map((v) => v.raw);
        const filteredBatches = batchViews.map((v) => v.raw);

        const totalFiltered = filteredShipping.length + filteredBatches.length;
        const totalAll = shippingEscrows.length + purchases.length;

        if (totalAll === 0) {
          return (
            <div 
              className="glass-card" 
              style={{ 
                padding: "3rem 2rem", 
                textAlign: "center", 
                border: "1px dashed rgba(255, 255, 255, 0.1)",
                background: "rgba(255, 255, 255, 0.01)"
              }}
            >
              <div style={{ fontSize: "3rem", marginBottom: "1rem", opacity: 0.6 }}>📦</div>
              <h4 style={{ color: "#fff", fontSize: "1.1rem", marginBottom: "0.5rem" }}>No Orders Yet</h4>
              <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", maxWidth: "400px", margin: "0 auto", lineHeight: "1.5" }}>
                When you buy or sell specimens through the marketplace, your orders will appear here with full buyer protection, shipping updates, and fulfillment controls.
              </p>
            </div>
          );
        }

        if (totalFiltered === 0) {
          return (
            <div 
              className="glass-card" 
              style={{ 
                padding: "2rem", 
                textAlign: "center", 
                border: "1px dashed rgba(255, 255, 255, 0.08)",
                background: "rgba(255, 255, 255, 0.01)"
              }}
            >
              <div style={{ fontSize: "2rem", marginBottom: "0.75rem", opacity: 0.5 }}>🔍</div>
              <h4 style={{ color: "var(--text-secondary)", fontSize: "0.95rem", marginBottom: "0.25rem" }}>No Matching Orders</h4>
              <p style={{ color: "var(--text-muted)", fontSize: "0.78rem", margin: 0 }}>
                Try adjusting your filters or search query.
              </p>
              <button
                onClick={() => { setOrderFilter("all"); setOrderSearch(""); }}
                className="btn-secondary"
                style={{ marginTop: "0.75rem", padding: "0.3rem 0.75rem", fontSize: "0.72rem" }}
              >
                Clear Filters
              </button>
            </div>
          );
        }

        return (
          <>
            {/* Filter results count */}
            {(orderFilter !== "all" || orderSearch.trim()) && (
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
                Showing {totalFiltered} of {totalAll} orders
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1.5rem" }}>
              {/* Shipping orders */}
              {filteredShipping.map((order) => (
          <div 
            key={`ship-${order.tokenId}`} 
            className="glass-card" 
            style={{ 
              padding: "1.25rem", 
              display: "flex", 
              flexDirection: "column", 
              gap: "0.75rem",
              border: order.status === 3 ? "1px solid var(--accent-red)" : "1px solid var(--glass-border)"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="badge badge-blue" style={{ fontSize: "0.6rem" }}>Shipping Order</span>
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Cert. Serial No. {order.tokenId.toString().padStart(3, "0")}</span>
            </div>

            <div>
              <h4 style={{ color: "#fff" }}>{order.commonName}</h4>
              <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                Role: <strong>{order.role}</strong>
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
              <span>Subtotal:</span>
              <strong style={{ fontFamily: "monospace" }}>${parseFloat(order.price || 0).toFixed(2)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
              <span>Shipping Fee:</span>
              <strong style={{ fontFamily: "monospace" }}>${parseFloat(order.shippingFee || 0).toFixed(2)}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "0.25rem" }}>
              <span>Total Protected:</span>
              <strong style={{ fontFamily: "monospace", color: "var(--accent-green)" }}>${parseFloat(order.amountLocked || 0).toFixed(2)}</strong>
            </div>

            {/* Visual Shipping Progress Stepper */}
            {(() => {
              const steps = [
                { label: "Paid", icon: "💳" },
                { label: "Preparing", icon: "📋" },
                { label: "Shipped", icon: "🚚" },
                { label: "Delivered", icon: "🏠" },
              ];
              // Map status enum to step index: 0=PROCESSING→1, 1=SHIPPED→2, 2=DELIVERED/RELEASED→3, 3=DISPUTED→special, 4=REFUNDED→special
              let activeStep = 0;
              if (order.status === 0) activeStep = 1; // Processing / waiting for dispatch
              else if (order.status === 1) activeStep = 2; // Shipped
              else if (order.status === 2) activeStep = 3; // Delivered/Released
              else if (order.status === 3) activeStep = -1; // Disputed — show red
              else if (order.status === 4) activeStep = -2; // Refunded — show amber

              if (activeStep < 0) {
                // Special states
                const isDisputed = activeStep === -1;
                return (
                  <div style={{ marginTop: "0.75rem", padding: "0.6rem", borderRadius: "8px", background: isDisputed ? "rgba(248,113,113,0.06)" : "rgba(251,191,36,0.06)", border: `1px solid ${isDisputed ? "rgba(248,113,113,0.2)" : "rgba(251,191,36,0.2)"}`, textAlign: "center" }}>
                    <span style={{ fontSize: "0.75rem", fontWeight: "600", color: isDisputed ? "#f87171" : "#fbbf24" }}>
                      {isDisputed ? "⚠️ Under Review" : "↩️ Refunded"}
                    </span>
                  </div>
                );
              }

              return (
                <div style={{ marginTop: "0.75rem" }}>
                  {/* Progress bar */}
                  <div style={{ display: "flex", alignItems: "center", gap: "0", marginBottom: "0.4rem" }}>
                    {steps.map((step, i) => (
                      <React.Fragment key={i}>
                        <div style={{
                          width: "24px", height: "24px", borderRadius: "50%", flexShrink: 0,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: i <= activeStep ? "0.7rem" : "0.55rem",
                          background: i <= activeStep ? "rgba(52,211,153,0.15)" : "rgba(255,255,255,0.03)",
                          border: i <= activeStep ? "1.5px solid rgba(52,211,153,0.5)" : "1.5px solid rgba(255,255,255,0.08)",
                          color: i <= activeStep ? "#34d399" : "var(--text-muted)",
                          transition: "all 0.3s ease",
                        }}>
                          {i < activeStep ? "✓" : step.icon}
                        </div>
                        {i < steps.length - 1 && (
                          <div style={{
                            flex: 1, height: "2px",
                            background: i < activeStep ? "rgba(52,211,153,0.4)" : "rgba(255,255,255,0.06)",
                            transition: "background 0.3s ease",
                          }} />
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                  {/* Labels */}
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    {steps.map((step, i) => (
                      <span key={i} style={{
                        fontSize: "0.55rem",
                        color: i <= activeStep ? "#34d399" : "var(--text-muted)",
                        fontWeight: i === activeStep ? "700" : "400",
                        textAlign: "center",
                        width: "24%",
                      }}>
                        {step.label}
                      </span>
                    ))}
                  </div>
                  {/* Tracking number if shipped */}
                  {order.status >= 1 && order.trackingNumber && (
                    <div style={{ marginTop: "0.4rem", fontSize: "0.68rem", color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                      <span>📦</span>
                      <span>Tracking: <strong style={{ fontFamily: "monospace", color: "#fff" }}>{order.trackingNumber}</strong></span>
                    </div>
                  )}
                </div>
              );
            })()}

            <button 
              className="btn-secondary" 
              style={{ width: "100%", marginTop: "0.5rem", padding: "0.4rem" }}
              onClick={() => openOrderDetail("shipping", order)}
            >
              Fulfillment Detail
            </button>

            {/* Inline Receipt (expandable) */}
            <OrderReceipt
              order={order}
              isExpanded={expandedReceipt === `ship-${order.tokenId}`}
              onToggle={() => setExpandedReceipt(expandedReceipt === `ship-${order.tokenId}` ? null : `ship-${order.tokenId}`)}
              casualModeActive={casualModeActive}
            />
          </div>
        ))}

        {/* Batch / In-Person Orders */}
        {filteredBatches.map((order) => (
          <div 
            key={`batch-${order.purchaseId}`} 
            className="glass-card" 
            style={{ 
              padding: "1.25rem", 
              display: "flex", 
              flexDirection: "column", 
              gap: "0.75rem"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="badge badge-amber" style={{ fontSize: "0.6rem" }}>
                {order.fulfillmentType === 1 ? "🤝 In-Person Pickup" : "📦 Batch Shipping"}
              </span>
              <span style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>Order Serial No. {order.purchaseId.toString().padStart(3, "0")}</span>
            </div>

            <div>
              <h4 style={{ color: "#fff" }}>{order.commonName} (Qty: {order.quantity})</h4>
              <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
                Role: <strong>{order.role}</strong>
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
              <span>Total Protected:</span>
              <strong style={{ fontFamily: "monospace", color: "var(--accent-green)" }}>${(parseFloat(order.amountLocked) * 1000).toFixed(2)}</strong>
            </div>

            {/* Batch order progress */}
            <div style={{ marginTop: "0.25rem", padding: "0.5rem 0.75rem", borderRadius: "8px", background: order.state === 1 ? "rgba(52,211,153,0.06)" : order.state === 2 ? "rgba(251,191,36,0.06)" : "rgba(56,189,248,0.06)", border: `1px solid ${order.state === 1 ? "rgba(52,211,153,0.15)" : order.state === 2 ? "rgba(251,191,36,0.15)" : "rgba(56,189,248,0.15)"}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ fontSize: "1rem" }}>
                  {order.state === 0 ? "🔒" : order.state === 1 ? "✅" : "↩️"}
                </span>
                <div>
                  <div style={{ fontSize: "0.75rem", fontWeight: "600", color: order.state === 1 ? "#34d399" : order.state === 2 ? "#fbbf24" : "#7dd3fc" }}>
                    {order.state === 0 ? "Payment Held — Awaiting Fulfillment" : order.state === 1 ? "Completed Successfully" : "Refunded to Buyer"}
                  </div>
                  <div style={{ fontSize: "0.62rem", color: "var(--text-muted)", marginTop: "1px" }}>
                    {order.state === 0 ? (order.fulfillmentType === 1 ? "Meet the breeder and exchange your PIN to complete" : "Breeder is preparing your order") : order.state === 1 ? "Fish delivered and payment released to breeder" : "Full refund processed"}
                  </div>
                </div>
              </div>
            </div>

            <button 
              className="btn-secondary" 
              style={{ width: "100%", marginTop: "0.5rem", padding: "0.4rem" }}
              onClick={() => openOrderDetail("batch", order)}
            >
              Fulfillment Detail
            </button>

            {/* Inline Receipt (expandable) */}
            <OrderReceipt
              order={order}
              isExpanded={expandedReceipt === `batch-${order.purchaseId}`}
              onToggle={() => setExpandedReceipt(expandedReceipt === `batch-${order.purchaseId}` ? null : `batch-${order.purchaseId}`)}
              casualModeActive={casualModeActive}
            />
          </div>
        ))}
      </div>
          </>
        );
      })()}

      {/* ─── XP-Gated Advanced Features Section ──────────────────────── */}
      {(shippingEscrows.length > 0 || purchases.length > 0) && (
        <div style={{ marginTop: "2rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* Order Analytics (Pelagic+ / 2,500 XP) */}
          <div>
            <h3 style={{ fontSize: "1.1rem", color: "#fff", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span>📊</span> {casualModeActive ? "Your Stats" : "Order Analytics"}
              {!hasEntitlement("order_analytics", { tier: userTier, xp: totalXp }) && (
                <span style={{ fontSize: "0.6rem", padding: "0.15rem 0.4rem", borderRadius: "8px", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.2)", color: "#fbbf24" }}>
                  🔒 Pelagic
                </span>
              )}
            </h3>
            <OrderAnalytics
              walletAccount={walletAccount}
              userTier={userTier}
              totalXp={totalXp}
              casualModeActive={casualModeActive}
            />
          </div>

          {/* Watchlist & Smart Reorder (Pelagic+ / Abyssal+) */}
          <div>
            <h3 style={{ fontSize: "1.1rem", color: "#fff", marginBottom: "0.5rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <span>👁️</span> {casualModeActive ? "Watchlist & Reorder" : "Species Watchlist & Smart Reorder"}
              {!hasEntitlement("species_watchlist", { tier: userTier, xp: totalXp }) && (
                <span style={{ fontSize: "0.6rem", padding: "0.15rem 0.4rem", borderRadius: "8px", background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.2)", color: "#fbbf24" }}>
                  🔒 Pelagic
                </span>
              )}
            </h3>
            <OrderWatchlistReorder
              walletAccount={walletAccount}
              userTier={userTier}
              totalXp={totalXp}
              casualModeActive={casualModeActive}
              onReorder={(info) => {
                // Navigate to marketplace with species filter applied
                console.log("[Reorder] Searching marketplace for:", info.speciesName);
                // Could emit a custom event or update parent state to trigger marketplace search
              }}
            />
          </div>

          {/* XP Progress Teaser — Show next unlockable features */}
          {(() => {
            const next = getNextTierUnlocks(userTier, totalXp);
            if (!next.nextTier || next.features.length === 0) return null;

            return (
              <div
                className="glass-card"
                style={{
                  padding: "1rem 1.25rem",
                  border: "1px solid rgba(251, 191, 36, 0.12)",
                  background: "rgba(251, 191, 36, 0.02)",
                  display: "flex",
                  alignItems: "center",
                  gap: "1rem",
                }}
              >
                <div style={{ fontSize: "1.5rem" }}>🎯</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "0.78rem", fontWeight: "600", color: "#fff" }}>
                    {next.xpNeeded.toLocaleString()} XP to {next.nextTier}
                  </div>
                  <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                    Unlocks: {next.features.map((f) => `${f.icon} ${f.label}`).join(" • ")}
                  </div>
                  <div style={{ marginTop: "0.4rem", height: "4px", borderRadius: "2px", background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                    <div style={{
                      height: "100%",
                      width: `${Math.min(100, ((totalXp || 0) / (totalXp + next.xpNeeded)) * 100)}%`,
                      background: "linear-gradient(90deg, #fbbf24, #f59e0b)",
                      borderRadius: "2px",
                    }} />
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* ?order= deep link pointed at an id with no match — not-found overlay */}
      {orderNotFound && !selectedOrder && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          background: "rgba(0, 0, 0, 0.75)", backdropFilter: "blur(8px)",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 1000, padding: "1rem",
        }}>
          <div className="glass-card" style={{
            width: "100%", maxWidth: "420px", padding: "2rem",
            background: "var(--bg-secondary)", border: "1px solid var(--glass-border-hover)",
            textAlign: "center", position: "relative",
          }}>
            <button
              onClick={closeOrderDetail}
              aria-label="Close"
              style={{ position: "absolute", top: "1rem", right: "1.25rem", background: "none", border: "none", color: "var(--text-muted)", fontSize: "1.25rem", cursor: "pointer" }}
            >
              &times;
            </button>
            <div style={{ fontSize: "2rem", marginBottom: "0.75rem", opacity: 0.6 }}>🔍</div>
            <h3 style={{ color: "#fff", fontSize: "1.1rem", marginBottom: "0.4rem" }}>Order not found</h3>
            <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", margin: 0 }}>
              {casualModeActive
                ? "We couldn't find that order. It may belong to a different account, or the link may be out of date."
                : "No matching order for this account. The link may reference a different account or an outdated identifier."}
            </p>
          </div>
        </div>
      )}

      {/* Selected Order Detail Drawer / Overlay */}
      {selectedOrder && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0, 0, 0, 0.75)",
          backdropFilter: "blur(8px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 1000,
          padding: "1rem"
        }}>
          <div className="glass-card" style={{
            width: "100%",
            maxWidth: "460px",
            padding: "2rem",
            background: "var(--bg-secondary)",
            border: "1px solid var(--glass-border-hover)",
            position: "relative"
          }}>
            <button 
              onClick={closeOrderDetail}
              aria-label="Close order detail"
              style={{ position: "absolute", top: "1rem", right: "1.25rem", background: "none", border: "none", color: "var(--text-muted)", fontSize: "1.25rem", cursor: "pointer" }}
            >
              &times;
            </button>

            <h3 style={{ fontSize: "1.35rem", marginBottom: "0.25rem", color: "#fff" }}>Order Tracking & Fulfillment Details</h3>
            <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginBottom: "1.5rem" }}>
              {selectedOrder.type === "shipping" ? `Shipping Certificate Serial No. ${selectedOrder.data.tokenId.toString().padStart(3, "0")}` : `Batch Order Serial No. ${selectedOrder.data.purchaseId.toString().padStart(3, "0")}`}
            </p>

            {actionError && (
              <div style={{ padding: "0.75rem", background: "rgba(248, 113, 113, 0.1)", border: "1px solid rgba(248,113,113,0.3)", color: "var(--accent-red)", fontSize: "0.8rem", borderRadius: "4px", marginBottom: "1rem" }}>
                {actionError}
              </div>
            )}

            {actionTx && (
              <div style={{ padding: "0.75rem", background: "var(--accent-blue-glow)", border: "1px solid rgba(56, 189, 248, 0.3)", color: "var(--accent-blue)", fontSize: "0.8rem", borderRadius: "4px", marginBottom: "1rem", wordBreak: "break-all" }}>
                <strong>Transaction pending:</strong> {actionTx}
              </div>
            )}

            {/* BATCH ORDER FULLFILLMENTS */}
            {selectedOrder.type === "batch" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div style={{ background: "rgba(255,255,255,0.02)", padding: "0.75rem", borderRadius: "4px", fontSize: "0.85rem" }}>
                  <div>Specimen: <strong>{selectedOrder.data.commonName}</strong></div>
                  <div>Quantity: <strong>{selectedOrder.data.quantity}</strong></div>
                  <div>Seller: <span style={{ fontSize: "0.75rem", fontFamily: "monospace" }}><DisplayName address={selectedOrder.data.seller} /></span></div>
                  <div>Buyer: <span style={{ fontSize: "0.75rem", fontFamily: "monospace" }}><DisplayName address={selectedOrder.data.buyer} /></span></div>
                  <div>State: <span className="badge badge-blue" style={{ fontSize: "0.65rem" }}>{ESCROW_STATES[selectedOrder.data.state]}</span></div>
                </div>

                {selectedOrder.data.state === 0 && selectedOrder.data.fulfillmentType === 1 && (
                  // Local Pickup Pathway
                  <div style={{ display: "flex", flexDirection: "column", gap: "1rem", textAlign: "center" }}>
                    {selectedOrder.data.role === "Buyer" ? (
                      <div>
                        <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "0.5rem" }}>
                          Provide this secure 4-digit PIN to the breeder when picking up your specimens:
                        </p>
                        <div style={{ fontSize: "2rem", fontWeight: "700", letterSpacing: "0.25em", color: "var(--accent-amber)", background: "rgba(0,0,0,0.3)", padding: "0.5rem 1rem", borderRadius: "8px", display: "inline-block" }}>
                          {/* In local dev, PIN can be read or is pre-communicated. We can simulate displaying a generated pin from local storage or mock */}
                          {"2541"}
                        </div>
                        <p style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
                          Once entered by the breeder, your locked loyalty holding funds will release automatically.
                        </p>
                      </div>
                    ) : selectedOrder.data.role === "Seller" ? (
                      <div>
                        <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", marginBottom: "0.75rem" }}>
                          Enter the 4-digit verification PIN provided by the buyer to release locked escrow funds:
                        </p>
                        
                        <div style={{ fontSize: "1.5rem", height: "40px", fontWeight: "600", color: "var(--accent-blue)", marginBottom: "0.5rem", letterSpacing: "0.5em" }}>
                          {pinInput || "----"}
                        </div>

                        {/* GPS Event Bounding Zone Simulator Checkbox */}
                        <div style={{ 
                          display: "flex", 
                          alignItems: "center", 
                          justifyContent: "center", 
                          gap: "0.5rem", 
                          marginBottom: "1rem",
                          padding: "0.5rem",
                          background: currentLocation.isInsideEventZone ? "rgba(34, 197, 94, 0.08)" : "rgba(255,255,255,0.02)",
                          border: currentLocation.isInsideEventZone ? "1px solid rgba(34, 197, 94, 0.2)" : "1px solid rgba(255,255,255,0.05)",
                          borderRadius: "4px"
                        }}>
                          <input 
                            type="checkbox" 
                            id="gps-event-zone"
                            checked={currentLocation.isInsideEventZone}
                            onChange={(e) => setCurrentLocation({ isInsideEventZone: e.target.checked })}
                            style={{ cursor: "pointer" }}
                          />
                          <label htmlFor="gps-event-zone" style={{ fontSize: "0.75rem", color: currentLocation.isInsideEventZone ? "var(--accent-green)" : "var(--text-muted)", cursor: "pointer", fontWeight: "600" }}>
                            {currentLocation.isInsideEventZone ? "⚡ Inside Active Event Zone (2x Loyalty Rewards)" : "📍 Outside Event Zone (1x Loyalty Rewards)"}
                          </label>
                        </div>

                        <div className="pin-keypad" style={{ marginBottom: "1.25rem" }}>
                          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "⌫"].map(btn => (
                            <button 
                              key={btn} 
                              type="button" 
                              className="keypad-btn" 
                              onClick={() => handleKeypadPress(btn)}
                            >
                              {btn}
                            </button>
                          ))}
                        </div>

                        <button 
                          className="btn-primary" 
                          style={{ width: "100%", justifyContent: "center" }}
                          disabled={pinInput.length !== 4 || actionLoading}
                          onClick={handleInPersonReleaseSubmit}
                        >
                          {actionLoading ? "Confirming PIN..." : "Confirm Handshake Verification"}
                        </button>
                      </div>
                    ) : (
                      <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Awaiting in-person verification handshake.</p>
                    )}
                  </div>
                )}

                {selectedOrder.data.state === 0 && selectedOrder.data.fulfillmentType === 0 && (
                  // Batch Shipping Pathway
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    {selectedOrder.data.role === "Buyer" && (
                      <button className="btn-primary" style={{ flex: 1, justifyContent: "center" }} disabled={actionLoading} onClick={handleReleaseBatch}>
                        Release Funds
                      </button>
                    )}
                    {selectedOrder.data.role === "Seller" && (
                      <button className="btn-secondary" style={{ flex: 1, border: "1px solid rgba(248,113,113,0.3)", color: "var(--accent-red)" }} disabled={actionLoading} onClick={handleRefundBatch}>
                        Cancel & Refund
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* SHIPPING SINGLE ORDER FULLFILLMENTS */}
            {selectedOrder.type === "shipping" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                <div style={{ background: "rgba(255,255,255,0.02)", padding: "0.75rem", borderRadius: "4px", fontSize: "0.85rem" }}>
                  <div>Specimen: <strong>{selectedOrder.data.commonName}</strong></div>
                  <div>Seller: <span style={{ fontSize: "0.75rem", fontFamily: "monospace" }}><DisplayName address={selectedOrder.data.seller} /></span></div>
                  <div>Buyer: <span style={{ fontSize: "0.75rem", fontFamily: "monospace" }}><DisplayName address={selectedOrder.data.buyer} /></span></div>
                  {selectedOrder.data.trackingNumber && (
                    <div>Tracking Number: <strong style={{ color: "var(--accent-blue)" }}>{selectedOrder.data.trackingNumber}</strong></div>
                  )}
                  {selectedOrder.data.dispatchTimestamp > 0 && (
                    <div>Dispatched Date: <span>{new Date(selectedOrder.data.dispatchTimestamp * 1000).toLocaleString()}</span></div>
                  )}
                </div>

                {selectedOrder.data.status === 0 && (
                  // Status: LOCKED (Awaiting Dispatch)
                  <div>
                    {selectedOrder.data.role === "Seller" ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                        {/* Primary path: buy the label in-app. The tracking number
                            is bought from the carrier and auto-populates dispatch —
                            no manual entry, no separate carrier account tab. */}
                        <div style={{ padding: "0.75rem", background: "rgba(52,211,153,0.06)", border: "1px solid rgba(52,211,153,0.25)", borderRadius: "6px", fontSize: "0.8rem" }}>
                          <strong style={{ color: "#34d399" }}>🏷️ Buy label &amp; auto-dispatch</strong>
                          <p style={{ margin: "0.4rem 0 0", color: "var(--text-muted)", fontSize: "0.75rem" }}>
                            Purchases the shipping label the buyer already paid for and fills in tracking automatically.
                          </p>
                        </div>
                        <button className="btn-primary" style={{ justifyContent: "center" }} disabled={labelBuying} onClick={handleBuyLabel}>
                          {labelBuying ? "Buying label…" : "Buy label & dispatch"}
                        </button>

                        {/* Fallback: manual tracking entry (e.g. seller bought a
                            label elsewhere, or a legacy order with no live rate). */}
                        <details style={{ marginTop: "0.25rem" }}>
                          <summary style={{ fontSize: "0.75rem", color: "var(--text-secondary)", cursor: "pointer" }}>
                            Already have a tracking number? Enter it manually
                          </summary>
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
                            <input
                              type="text"
                              value={trackingInput}
                              onChange={(e) => setTrackingInput(e.target.value)}
                              placeholder="e.g. USPS 94001000..."
                              style={{ width: "100%", padding: "0.5rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px" }}
                            />
                            <button className="btn-secondary" style={{ justifyContent: "center" }} disabled={!trackingInput || actionLoading} onClick={handleDispatchShipping}>
                              {actionLoading ? "Updating Status..." : "Mark Dispatched"}
                            </button>
                          </div>
                        </details>
                      </div>
                    ) : (
                      <p style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>Awaiting breeder carrier dispatch & tracking submission.</p>
                    )}
                  </div>
                )}

                {selectedOrder.data.status === 1 && (
                  // Status: DISPATCHED
                  <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                    <div style={{ padding: "0.75rem", background: "rgba(56, 189, 248, 0.05)", border: "1px solid rgba(56, 189, 248, 0.2)", borderRadius: "4px", fontSize: "0.8rem", textAlign: "center" }}>
                      <strong>Transit Safety Windows:</strong> Funds are locked in holding. Buyer has 3 days from dispatch to raise disputes before seller release unlocks.
                    </div>

                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      {selectedOrder.data.role === "Buyer" && (
                        <>
                          <button className="btn-primary" style={{ flex: 1, justifyContent: "center" }} disabled={actionLoading} onClick={handleReleaseShipping}>
                            Release Funds
                          </button>
                          <button className="btn-secondary" style={{ flex: 1, border: "1px solid rgba(248,113,113,0.3)", color: "var(--accent-red)" }} disabled={actionLoading} onClick={handleDisputeShipping}>
                            Dispute Order
                          </button>
                        </>
                      )}

                      {selectedOrder.data.role === "Seller" && (
                        <button 
                          className="btn-primary" 
                          style={{ width: "100%", justifyContent: "center" }}
                          disabled={actionLoading || (Date.now() / 1000) < (selectedOrder.data.dispatchTimestamp + 3 * 86400)}
                          onClick={handleReleaseShipping}
                        >
                          {(Date.now() / 1000) >= (selectedOrder.data.dispatchTimestamp + 3 * 86400) ? "Auto-Release Funds" : "Locked (Holding Window Active)"}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {selectedOrder.data.status === 3 && (
                  // Status: DISPUTED
                  <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                    <div style={{ padding: "0.75rem", background: "rgba(248, 113, 113, 0.05)", border: "1px solid rgba(248, 113, 113, 0.2)", borderRadius: "4px", fontSize: "0.8rem", textAlign: "center", color: "var(--accent-red)" }}>
                      ⚠️ <strong>Disputed Shipment:</strong> This order is in conflict. Awaiting review and arbitration by the Curator.
                    </div>

                    {isCurator && (
                      <div style={{ display: "flex", gap: "0.5rem" }}>
                        <button className="btn-primary" style={{ flex: 1, justifyContent: "center" }} disabled={actionLoading} onClick={() => handleResolveDispute(false)}>
                          Release to Seller
                        </button>
                        <button className="btn-secondary" style={{ flex: 1, border: "1px solid rgba(248,113,113,0.3)", color: "var(--accent-red)", justifyContent: "center" }} disabled={actionLoading} onClick={() => handleResolveDispute(true)}>
                          Refund Buyer
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {(selectedOrder.data.status === 2 || selectedOrder.data.status === 4) && (
                  <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.85rem" }}>
                    Order resolved. State is permanent.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Arrival Flow Modal — merged shipping confirmation + tank assignment */}
      <ArrivalModal
        isOpen={arrivalModalOpen}
        onClose={() => {
          setArrivalModalOpen(false);
          setArrivalSpecimen(null);
          setArrivalShippingOrder(null);
        }}
        item={arrivalSpecimen}
        itemType="specimen"
        isShippingMerge={true}
        shippingOrder={arrivalShippingOrder}
        walletAccount={walletAccount}
        contractAddress={contractAddress}
        casualModeActive={casualModeActive}
        onComplete={handleArrivalComplete}
      />

      {/* Buyer-paid live shipping: address + rate selection before Stripe checkout */}
      <ShippingRateModal
        isOpen={!!shipRateModal}
        onClose={() => setShipRateModal(null)}
        listing={shipRateModal?.listing || {}}
        onProceed={proceedShippingCheckout}
      />
    </div>
  );
}
