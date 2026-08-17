/**
 * BreederTerminal.jsx
 *
 * Breeder Terminal shell — Task 9, Increment 1 (Tier B), with the Task 19
 * seller fulfillment queue in the Orders section. One seller workspace: a
 * dashboard home (the six cards from breederDashboard.js §3) above the fold,
 * plus section navigation that mounts the seller surfaces that already
 * exist. This component is intentionally thin — all aggregation/decision
 * logic lives in the pure, tested `buildBreederDashboard` and
 * `sellerOrderView` modules; this file only fetches data, composes existing
 * components/services, and renders.
 *
 * Reused, not rebuilt (per docs/TASK_09_BREEDER_TERMINAL_SPEC.md §2/§6 and
 * docs/TASK_19_SELLER_OPS_SPEC.md §1/§3):
 *   - fetchSellerOrders / fetchSellerAnalytics (ordersSync.js) — dashboard aggregation
 *   - relayGetOrders (relayer.js) — the seller's local-first order queue (Orders section)
 *   - checkSellerStatus / getSellerDashboardLink / startSellerOnboarding (stripePayments.js)
 *   - buyShippingLabel (shipping.js), relayDispatchShipping / relaySettleHandshake /
 *     relayResolveShippingDispute / relayUpdateBatchOrder (relayer.js) — fulfillment actions
 *   - assembleSellerOrderView / normalizeSellerOrders / filterSellerOrders (sellerOrderView.js)
 *   - HandshakeVerification (breeder/scan role) for pickup + cash handoffs
 *   - SellerAnalytics, StorefrontSetup, ShipFromSetup, ListSpecimenModal, Modal
 *   - useMarketplaceListings, filtered to this seller
 *   - hasEntitlement for gating convenience-only surfaces (bulk_management only)
 *
 * Task 9 Increment 2 (docs/TASK_09_INC2_LISTING_FLOW_SPEC.md) adds: the
 * Spec-Dex/Poseidon-assisted listing flow (built into ListSpecimenModal, not
 * this shell) and the parcel-preset editor (`ParcelPresetEditor`, mounted
 * alongside `ShipFromSetup` below). The Listings section here now renders
 * real per-listing state and packing-profile summaries and routes "Edit" to
 * the existing `EditListingModal`.
 *
 * Out of scope for this increment (see spec §5): lineage/pedigree tools, deep
 * analytics beyond what SellerAnalytics already renders, a new seller
 * claim-resolution write path (curator-only `doa-resolve` stays the
 * resolution surface), the local-courier request UI beyond a "coming soon"
 * affordance, and any new bulk operation on listings (bulk stays scoped to
 * the Task 19 orders queue; entitlements.js's `bulk_management` gate would
 * apply if listing bulk ops are added later).
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  Package,
  ClipboardText,
  Storefront as StorefrontIcon,
  Truck,
  ChartLineUp,
  CurrencyDollar,
  Plus,
  Warning,
  CheckCircle,
  ArrowSquareOut,
  MagnifyingGlass,
  ChatCircleDots,
  ClockCounterClockwise,
  Tag,
} from "@phosphor-icons/react";
import { fetchSellerOrders } from "../../services/ordersSync";
import { checkSellerStatus, startSellerOnboarding, getSellerDashboardLink } from "../../services/stripePayments";
import { useMarketplaceListings } from "../../hooks/useMarketplaceListings";
import { buildBreederDashboard } from "../../services/breederDashboard";
import { formatPriceCents } from "../../services/catalogQuery";
import { hasEntitlement } from "../../services/entitlements";
import { useActivityFacts } from "../../hooks/useActivityFacts";
import { useScrollAffordance } from "../../hooks/useScrollAffordance";

import { CONTRACT_ADDRESS, MARKETPLACE_ADDRESS } from "../../config/appConfig";
import { SellerAnalytics } from "../storefront/SellerAnalytics";
import { StorefrontSetup } from "../StorefrontSetup";
import { ShipFromSetup } from "../ShipFromSetup";
import { ParcelPresetEditor } from "./ParcelPresetEditor";
import { PickupSpotSetup } from "./PickupSpotSetup";
import { StorefrontMerchandising } from "./StorefrontMerchandising";
import { PromotionsManager } from "./PromotionsManager";
import { ListSpecimenModal } from "../ListSpecimenModal";
import { EditListingModal } from "../EditListingModal";
import { HandshakeVerification } from "../HandshakeVerification";
import { CashPickupConfirm } from "./CashPickupConfirm";
import { relayGetOrders, relayDispatchShipping } from "../../services/relayer";
import { buyShippingLabel } from "../../services/shipping";
import { normalizeSellerOrders, filterSellerOrders } from "../../services/sellerOrderView";
import { SELLER_ACTION_KIND } from "../../services/orderCopy";
import { FULFILLMENT_METHODS } from "../../services/marketplaceStateMachine";
import { getOrCreateConversation } from "../../services/messagesApi";
import { fetchPickupForOrder, confirmPickupTime } from "../../services/pickupCoordinationApi";
import { arrangementStatusView } from "../../services/pickupCoordination";

const LAST_VISIT_STORAGE_KEY = "aquadex_breeder_last_visit";

const SECTIONS = Object.freeze({
  HOME: "home",
  ORDERS: "orders",
  LISTINGS: "listings",
  STORE: "store",
  PROMOTIONS: "promotions",
  SHIPPING: "shipping",
  ANALYTICS: "analytics",
  PAYOUTS: "payouts",
});

const NAV_ITEMS = [
  { id: SECTIONS.HOME, label: "Home", icon: Package },
  { id: SECTIONS.ORDERS, label: "Orders", icon: ClipboardText },
  { id: SECTIONS.LISTINGS, label: "Listings", icon: Package },
  { id: SECTIONS.STORE, label: "Store", icon: StorefrontIcon },
  { id: SECTIONS.PROMOTIONS, label: "Promotions", icon: Tag },
  { id: SECTIONS.SHIPPING, label: "Shipping", icon: Truck },
  { id: SECTIONS.ANALYTICS, label: "Analytics", icon: ChartLineUp },
  { id: SECTIONS.PAYOUTS, label: "Payouts", icon: CurrencyDollar },
];

function readLastVisit() {
  try {
    const raw = localStorage.getItem(LAST_VISIT_STORAGE_KEY);
    return raw ? Number(raw) : null;
  } catch {
    return null;
  }
}

function writeLastVisit(ms) {
  try {
    localStorage.setItem(LAST_VISIT_STORAGE_KEY, String(ms));
  } catch {
    /* non-fatal — localStorage may be unavailable */
  }
}

/**
 * @param {object} props
 * @param {string} props.walletAccount
 * @param {boolean} [props.casualModeActive]
 * @param {string|null} [props.initialSection] - optional `SECTIONS` id to open on
 *   arrival, so other surfaces can deep-link a specific seller section. Settings →
 *   Seller uses it to send sellers straight to Store / Shipping / Payouts rather
 *   than dumping them on Home to hunt (docs/SETTINGS_SPEC.md §6 #9). Ignored when
 *   it is not a known section id, so a bad link degrades to Home rather than
 *   rendering nothing.
 */
export function BreederTerminal({ walletAccount, casualModeActive = false, initialSection = null }) {
  const isKnownSection = (id) => Object.values(SECTIONS).includes(id);

  const [activeSection, setActiveSection] = useState(
    isKnownSection(initialSection) ? initialSection : SECTIONS.HOME
  );

  // Edge-fade cue for the section nav, which overflows at phone widths.
  const sectionNavScrollRef = useScrollAffordance();

  // The initializer above only covers a cold mount. This tab is lazy-loaded and
  // stays mounted once visited, so a second deep-link from Settings while it is
  // already alive has to move the section too — otherwise the first link works and
  // every later one silently does nothing.
  useEffect(() => {
    if (isKnownSection(initialSection)) setActiveSection(initialSection);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSection]);
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [sellerStatus, setSellerStatus] = useState(null);
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [dashboardLinkBusy, setDashboardLinkBusy] = useState(false);
  const [isListModalOpen, setIsListModalOpen] = useState(false);
  const [editingListing, setEditingListing] = useState(null); // Task 9 Inc2: Listings section inline edit
  const [existingStorefrontProfile, setExistingStorefrontProfile] = useState(null);

  // ─── Task 19: the seller fulfillment queue's own order source ────────────
  // The dashboard's six cards aggregate from the CLOUD `orders` table
  // (fetchSellerOrders, above) — left untouched. The fulfillment queue below
  // needs to call the existing per-order relayer actions (relayDispatchShipping,
  // relaySettleHandshake, relayUpdateBatchOrder), which operate on the
  // LOCAL-FIRST Dexie `marketOrders` shape, so the queue is sourced from
  // relayGetOrders (the same source CheckoutSummary's seller drawer reads),
  // filtered to this account's seller-role orders.
  const [localSellerOrders, setLocalSellerOrders] = useState([]);
  const [localOrdersLoading, setLocalOrdersLoading] = useState(true);
  const [ordersFulfillmentFilter, setOrdersFulfillmentFilter] = useState("all");
  const [ordersStatusFilter, setOrdersStatusFilter] = useState("needs_action");
  const [ordersQuery, setOrdersQuery] = useState("");
  const [ordersActionError, setOrdersActionError] = useState(null);
  const [labelBuyingId, setLabelBuyingId] = useState(null);
  const [manualTrackingOrderId, setManualTrackingOrderId] = useState(null);
  const [manualTrackingInput, setManualTrackingInput] = useState("");
  const [handshakeModalView, setHandshakeModalView] = useState(null); // the view whose scan/cash modal is open
  const [conversationBusyId, setConversationBusyId] = useState(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [expandedCustomerId, setExpandedCustomerId] = useState(null);

  // Task 25: pickup-arrangement confirm/counter, surfaced as an inline
  // expandable block on the existing prepaid-pickup seller order row rather
  // than a new queue (spec §4). Fetched lazily (on expand), keyed by the
  // order's stable view id, so this never fans out an N+1 fetch on load.
  const [expandedPickupId, setExpandedPickupId] = useState(null);
  const [pickupArrangements, setPickupArrangements] = useState({}); // { [viewId]: { loading, data, error } }
  const [pickupConfirmBusyId, setPickupConfirmBusyId] = useState(null);

  const fetchLocalSellerOrders = async (account) => {
    if (!account) { setLocalOrdersLoading(false); return; }
    setLocalOrdersLoading(true);
    try {
      const { shippingEscrows, purchases } = await relayGetOrders(account);
      const sellerOnly = [...shippingEscrows, ...purchases].filter((o) => o.role === "Seller");
      setLocalSellerOrders(sellerOnly);
    } finally {
      setLocalOrdersLoading(false);
    }
  };

  useEffect(() => {
    fetchLocalSellerOrders(walletAccount);
  }, [walletAccount]);

  // `lastVisitAt` is read once on mount (the value the dashboard should
  // compare against for "new since last time"), then immediately bumped to
  // now and persisted so the next visit starts a fresh window.
  const [lastVisitAt] = useState(() => readLastVisit());
  useEffect(() => {
    writeLastVisit(Date.now());
  }, []);

  // Seller's own listings, filtered from the shared marketplace listings hook
  // (composed, not refetched) — the spec explicitly allows reusing the
  // board's data source filtered to this seller.
  const { data: allListings = [] } = useMarketplaceListings(CONTRACT_ADDRESS, MARKETPLACE_ADDRESS);
  const sellerListings = useMemo(
    () => allListings.filter((l) => l.seller && walletAccount && l.seller.toLowerCase() === walletAccount.toLowerCase()),
    [allListings, walletAccount]
  );

  useEffect(() => {
    if (!walletAccount) {
      setOrdersLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setOrdersLoading(true);
      const [sellerOrders, status] = await Promise.all([
        fetchSellerOrders(walletAccount, { limit: 500 }),
        checkSellerStatus(walletAccount),
      ]);
      if (cancelled) return;
      setOrders(sellerOrders);
      setSellerStatus(status);
      setOrdersLoading(false);
    })();
    return () => { cancelled = true; };
  }, [walletAccount]);

  // Existing storefront profile — used only to pass into StorefrontSetup so
  // the Store section opens pre-filled in edit mode, mirroring App.jsx's
  // existing "My Store" tab fetch (composed, not duplicated logic).
  useEffect(() => {
    if (!walletAccount) { setExistingStorefrontProfile(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/storefront-detail?id=${encodeURIComponent(walletAccount)}`);
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          setExistingStorefrontProfile(data.breeder || null);
        } else {
          setExistingStorefrontProfile(null);
        }
      } catch {
        if (!cancelled) setExistingStorefrontProfile(null);
      }
    })();
    return () => { cancelled = true; };
  }, [walletAccount]);

  const dashboard = useMemo(
    () => buildBreederDashboard({ orders, listings: sellerListings, lastVisitAt }),
    [orders, sellerListings, lastVisitAt]
  );

  // Convenience-only surfaces are the ones gated; the six dashboard cards,
  // every core seller operation (orders, listings, store, shipping, payouts),
  // and every single-order fulfillment action are never gated, per spec §4 /
  // Task 19 spec §3.
  //
  // These now open on demonstrated activity rather than XP: CSV export on having
  // completed an order, bulk actions on having enough listings to bulk-manage.
  // A seller with 40 listings needs the bulk bar regardless of how much XP they
  // have accumulated, and a seller with two does not benefit from it at any tier.
  const activity = useActivityFacts(walletAccount);
  const canExportAdvancedAnalytics = hasEntitlement("csv_export", { activity });
  const canBulkManage = hasEntitlement("bulk_management", { activity });

  // Task 19: pure normalize+filter pass over the local-first seller orders.
  const sellerViews = useMemo(() => normalizeSellerOrders(localSellerOrders, { casual: casualModeActive }), [localSellerOrders, casualModeActive]);
  const filteredSellerViews = useMemo(
    () => filterSellerOrders(sellerViews, { fulfillment: ordersFulfillmentFilter, status: ordersStatusFilter, query: ordersQuery }),
    [sellerViews, ordersFulfillmentFilter, ordersStatusFilter, ordersQuery]
  );

  // Home dashboard cards deep-link into the Orders section with a matching
  // filter preset (spec §3's "Pending Actions -> Needs action" example).
  const navigateToOrders = (statusPreset = "needs_action") => {
    setOrdersStatusFilter(statusPreset);
    setOrdersFulfillmentFilter("all");
    setActiveSection(SECTIONS.ORDERS);
  };

  const refreshLocalOrders = () => fetchLocalSellerOrders(walletAccount);

  // ─── Task 19 fulfillment actions — call the existing verified services; ──
  // never re-implement money/ownership/settlement logic here.

  const handleBuyLabel = async (view) => {
    const o = view.raw;
    setLabelBuyingId(view.id);
    setOrdersActionError(null);
    try {
      const result = await buyShippingLabel({
        sellerWallet: walletAccount,
        tokenId: Number(o.tokenId),
        serviceCode: o.shipServiceCode || undefined,
        carrierId: o.shipCarrierId || undefined,
        shipTo: o.shipTo || undefined,
        paymentIntentId: o.paymentIntentId || undefined,
      });
      if (!result.success) throw new Error(result.error || "Label purchase failed");
      await refreshLocalOrders();
    } catch (err) {
      setOrdersActionError(err.message || "Could not buy the shipping label.");
    } finally {
      setLabelBuyingId(null);
    }
  };

  const handleMarkDispatchedManually = async (view) => {
    if (!manualTrackingInput) return;
    setOrdersActionError(null);
    try {
      const result = await relayDispatchShipping(view.raw.tokenId, manualTrackingInput);
      if (!result.success) throw new Error(result.error || "Dispatch failed");
      setManualTrackingOrderId(null);
      setManualTrackingInput("");
      await refreshLocalOrders();
    } catch (err) {
      setOrdersActionError(err.message || "Could not mark this order dispatched.");
    }
  };

  // scan_handoff / confirm_cash both settle through the same verified
  // handshake path (composed via HandshakeVerification's breeder/scan role,
  // which owns its own PIN/salt/scan state) — the difference is only which
  // confirmation copy is shown before the scan (spec §3's cash
  // no-DOA-protection reminder).
  const handleHandoffSettled = async () => {
    setHandshakeModalView(null);
    await refreshLocalOrders();
  };

  const handleRespondToClaim = async (view) => {
    // Surface + route, not resolve (spec §2.3): open the existing customer
    // communication channel so the seller can respond to the buyer directly.
    // Curator-only `?action=doa-resolve` remains the resolution path.
    await handleMessageCustomer(view);
  };

  // ─── Task 25: pickup-arrangement confirm/counter (prepaid pickup only) ───
  // Pure logistics metadata layered on top of an already-paid order — never
  // touches settlement/inventory (Guardrail 1). orderRef is the order's
  // Dexie key (`view.raw.key`), which the server resolves against
  // `orders.local_key` the same way the cloud sync already keys orders.

  const handleTogglePickupArrangement = async (view) => {
    const willOpen = expandedPickupId !== view.id;
    setExpandedPickupId(willOpen ? view.id : null);
    if (!willOpen || pickupArrangements[view.id]) return;

    setPickupArrangements((prev) => ({ ...prev, [view.id]: { loading: true, data: null, error: null } }));
    try {
      const res = await fetchPickupForOrder(view.raw?.key);
      if (!res.success) {
        setPickupArrangements((prev) => ({ ...prev, [view.id]: { loading: false, data: null, error: res.error || "Could not load pickup details." } }));
        return;
      }
      setPickupArrangements((prev) => ({ ...prev, [view.id]: { loading: false, data: res, error: null } }));
    } catch (err) {
      setPickupArrangements((prev) => ({ ...prev, [view.id]: { loading: false, data: null, error: err.message || "Could not load pickup details." } }));
    }
  };

  const handleConfirmPickupTime = async (view, confirmedTime) => {
    setPickupConfirmBusyId(view.id);
    try {
      const res = await confirmPickupTime({ orderRef: view.raw?.key, confirmedTime });
      if (!res.success) {
        setPickupArrangements((prev) => ({ ...prev, [view.id]: { ...(prev[view.id] || {}), error: res.error || "Could not confirm this time." } }));
        return;
      }
      setPickupArrangements((prev) => ({
        ...prev,
        [view.id]: { loading: false, error: null, data: { ...(prev[view.id]?.data || {}), arrangement: res.arrangement } },
      }));
    } finally {
      setPickupConfirmBusyId(null);
    }
  };

  const handleMessageCustomer = async (view) => {
    const buyerWallet = view.raw?.buyer;
    if (!buyerWallet) return;
    setConversationBusyId(view.id);
    try {
      const { data } = await getOrCreateConversation(buyerWallet);
      if (data?.id) {
        window.dispatchEvent(new CustomEvent("aquadex_open_conversation", {
          detail: { conversationId: data.id, targetWallet: buyerWallet },
        }));
      }
    } finally {
      setConversationBusyId(null);
    }
  };

  // NOTE (Opus review gate, Task 19): there is deliberately no seller-initiated
  // refund/cancel action here. Issuing money back to a buyer is an
  // administrative action restricted to the curator / trusted backend
  // (api/stripe.js handleRefund -> authorizeAdminOrCurator; it also returns the
  // held on-chain asset via refundFiatBatchEscrow). A seller who cannot fulfill
  // uses "Message" to reach the buyer, and the buyer's dispute (?action=dispute)
  // is resolved by a curator through the authorized refund path. A local
  // relayUpdateBatchOrder(state:2) flip would mark an order "refunded" without
  // returning any money or asset and without authorization, so it is not
  // surfaced. A proper seller-requested cancellation that triggers an
  // authorized refund is a separate Tier A feature if the product wants it.

  const toggleOrderSelected = (id) => {
    setSelectedOrderIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Bulk buy-labels / bulk mark-dispatched — XP-gated (Abyssal+ bulk_management).
  // Every call still goes through the same single-order services above; bulk
  // only fans the same action out over the current selection.
  const handleBulkBuyLabels = async () => {
    if (!canBulkManage || bulkBusy) return;
    setBulkBusy(true);
    setOrdersActionError(null);
    try {
      const targets = filteredSellerViews.filter(
        (v) => selectedOrderIds.has(v.id) && v.sellerNextAction.kind === SELLER_ACTION_KIND.BUY_LABEL
      );
      // Sequential (not Promise.all) to avoid racing carrier label purchases
      // for the same seller/account.
      for (const view of targets) {
        await handleBuyLabel(view);
      }
      setSelectedOrderIds(new Set());
    } finally {
      setBulkBusy(false);
    }
  };

  const handleStartOnboarding = async () => {
    if (!walletAccount || onboardingBusy) return;
    setOnboardingBusy(true);
    try {
      const result = await startSellerOnboarding({ walletAddress: walletAccount });
      if (result.success && result.onboardingUrl) {
        window.location.href = result.onboardingUrl;
      }
    } finally {
      setOnboardingBusy(false);
    }
  };

  const handleOpenDashboardLink = async () => {
    if (!walletAccount || dashboardLinkBusy) return;
    setDashboardLinkBusy(true);
    try {
      const result = await getSellerDashboardLink(walletAccount);
      if (result.success && result.dashboardUrl) {
        window.open(result.dashboardUrl, "_blank", "noopener,noreferrer");
      }
    } finally {
      setDashboardLinkBusy(false);
    }
  };

  if (!walletAccount) {
    return (
      <div className="glass-card" style={{ padding: "3rem", textAlign: "center" }}>
        <h2 style={{ marginBottom: "1rem", color: "var(--text-secondary)" }}>Not Connected</h2>
        <p style={{ color: "var(--text-muted)" }}>Connect your account to open the Breeder Terminal.</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
      <div className="glass-card" style={{ padding: "1.5rem 1.75rem", marginBottom: "1.5rem" }}>
        <h2 style={{ fontSize: "1.5rem", color: "#fff", margin: "0 0 0.25rem 0" }}>
          🐟 Breeder Terminal
        </h2>
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: 0 }}>
          {casualModeActive
            ? "Your seller workspace — orders, listings, store, and payouts in one place."
            : "Unified seller workspace: fulfillment, inventory, storefront, and payout status."}
        </p>
      </div>

      {/* Section nav — mobile-first horizontal scroll of large touch targets */}
      <nav
        aria-label="Breeder Terminal sections"
        className="scroll-fade"
        ref={sectionNavScrollRef}
        style={{
          display: "flex",
          gap: "0.5rem",
          overflowX: "auto",
          paddingBottom: "0.5rem",
          marginBottom: "1.5rem",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveSection(item.id)}
              aria-current={isActive ? "page" : undefined}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.65rem 1rem",
                minHeight: "44px",
                flexShrink: 0,
                borderRadius: "10px",
                border: isActive ? "1px solid var(--accent-blue)" : "1px solid var(--glass-border)",
                background: isActive ? "rgba(56, 189, 248, 0.12)" : "rgba(255,255,255,0.02)",
                color: isActive ? "#7dd3fc" : "var(--text-secondary)",
                fontSize: "0.82rem",
                fontWeight: 600,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              <Icon size={16} weight="duotone" />
              {item.label}
            </button>
          );
        })}
      </nav>

      {activeSection === SECTIONS.HOME && (
        <DashboardHome
          dashboard={dashboard}
          ordersLoading={ordersLoading}
          sellerStatus={sellerStatus}
          casualModeActive={casualModeActive}
          onNavigate={setActiveSection}
          onNavigateToOrders={navigateToOrders}
          onStartOnboarding={handleStartOnboarding}
          onboardingBusy={onboardingBusy}
        />
      )}

      {activeSection === SECTIONS.ORDERS && (
        <OrdersSection
          views={filteredSellerViews}
          totalCount={sellerViews.length}
          loading={localOrdersLoading}
          casualModeActive={casualModeActive}
          fulfillmentFilter={ordersFulfillmentFilter}
          onFulfillmentFilterChange={setOrdersFulfillmentFilter}
          statusFilter={ordersStatusFilter}
          onStatusFilterChange={setOrdersStatusFilter}
          query={ordersQuery}
          onQueryChange={setOrdersQuery}
          actionError={ordersActionError}
          onDismissError={() => setOrdersActionError(null)}
          labelBuyingId={labelBuyingId}
          onBuyLabel={handleBuyLabel}
          manualTrackingOrderId={manualTrackingOrderId}
          onOpenManualTracking={(id) => { setManualTrackingOrderId(id); setManualTrackingInput(""); }}
          onCancelManualTracking={() => { setManualTrackingOrderId(null); setManualTrackingInput(""); }}
          manualTrackingInput={manualTrackingInput}
          onManualTrackingInputChange={setManualTrackingInput}
          onMarkDispatchedManually={handleMarkDispatchedManually}
          onOpenHandoffScan={setHandshakeModalView}
          onRespondToClaim={handleRespondToClaim}
          onMessageCustomer={handleMessageCustomer}
          conversationBusyId={conversationBusyId}
          canBulkManage={canBulkManage}
          selectedOrderIds={selectedOrderIds}
          onToggleSelected={toggleOrderSelected}
          onBulkBuyLabels={handleBulkBuyLabels}
          bulkBusy={bulkBusy}
          expandedCustomerId={expandedCustomerId}
          onToggleCustomerHistory={setExpandedCustomerId}
          allSellerOrders={localSellerOrders}
          expandedPickupId={expandedPickupId}
          pickupArrangements={pickupArrangements}
          onTogglePickupArrangement={handleTogglePickupArrangement}
          onConfirmPickupTime={handleConfirmPickupTime}
          pickupConfirmBusyId={pickupConfirmBusyId}
        />
      )}

      {activeSection === SECTIONS.LISTINGS && (
        <ListingsSection
          listings={sellerListings}
          casualModeActive={casualModeActive}
          onNewListing={() => setIsListModalOpen(true)}
          onEditListing={setEditingListing}
        />
      )}

      {activeSection === SECTIONS.STORE && (
        <>
          <StorefrontSetup
            walletAccount={walletAccount}
            casualModeActive={casualModeActive}
            existingProfile={existingStorefrontProfile}
          />
          {/* Task 21A: featured collections / storefront sections editor,
              mounted alongside StorefrontSetup per spec §4. */}
          <StorefrontMerchandising
            walletAccount={walletAccount}
            casualModeActive={casualModeActive}
            listings={sellerListings}
          />
        </>
      )}

      {activeSection === SECTIONS.PROMOTIONS && (
        <PromotionsManager walletAccount={walletAccount} casualModeActive={casualModeActive} />
      )}

      {activeSection === SECTIONS.SHIPPING && (
        <div className="glass-card" style={{ padding: "1.5rem" }}>
          <ShipFromSetup walletAccount={walletAccount} />
          <ParcelPresetEditor walletAccount={walletAccount} />
          {/* Task 25: seller's PUBLIC pickup meet spots — distinct from the
              PRIVATE ship-from address above. */}
          <PickupSpotSetup walletAccount={walletAccount} />
        </div>
      )}

      {activeSection === SECTIONS.ANALYTICS && (
        <>
          <SellerAnalytics walletAccount={walletAccount} casualModeActive={casualModeActive} />
          {/* Convenience-only surface: deep CSV export beyond SellerAnalytics'
              own basic export is gated. SellerAnalytics already renders its
              own always-available "Export CSV" button (never gated); this is
              only the advanced-export affordance mentioned in the spec. */}
          {canExportAdvancedAnalytics && (
            <div className="glass-card" style={{ padding: "1rem", marginTop: "1rem", fontSize: "0.8rem", color: "var(--text-secondary)" }}>
              ⭐ Advanced export unlocked (Pelagic+): full order-history CSV with per-line-item breakdowns is available from the Analytics export button above.
            </div>
          )}
        </>
      )}

      {activeSection === SECTIONS.PAYOUTS && (
        <PayoutsSection
          sellerStatus={sellerStatus}
          casualModeActive={casualModeActive}
          onStartOnboarding={handleStartOnboarding}
          onboardingBusy={onboardingBusy}
          onOpenDashboard={handleOpenDashboardLink}
          dashboardLinkBusy={dashboardLinkBusy}
        />
      )}

      <ListSpecimenModal
        isOpen={isListModalOpen}
        onClose={() => setIsListModalOpen(false)}
        contractAddress={CONTRACT_ADDRESS}
        marketplaceAddress={MARKETPLACE_ADDRESS}
        walletAccount={walletAccount}
        onSuccess={() => setIsListModalOpen(false)}
      />

      {/* Task 9 Inc2: Listings section inline edit launches the existing
          EditListingModal — no new listing-write logic here. */}
      <EditListingModal
        isOpen={!!editingListing}
        onClose={() => setEditingListing(null)}
        item={editingListing}
        onSuccess={() => setEditingListing(null)}
      />

      {/* Task 15: the canonical cash-pickup order's confirm_cash action opens
          the new, focused CashPickupConfirm — NOT the legacy
          HandshakeVerification (its plain-JSON event-cash flow does not
          settle the canonical cash-pickup order). Every other handoff
          (prepaid pickup's scan_handoff, and any legacy event-cash order)
          still composes the existing breeder-scan role of
          HandshakeVerification unchanged. */}
      {handshakeModalView && handshakeModalView.method === FULFILLMENT_METHODS.CASH_PICKUP ? (
        <CashPickupConfirm
          isOpen={!!handshakeModalView}
          onClose={() => setHandshakeModalView(null)}
          casualModeActive={casualModeActive}
          onSuccess={handleHandoffSettled}
        />
      ) : handshakeModalView ? (
        <HandshakeVerification
          isOpen={!!handshakeModalView}
          onClose={() => setHandshakeModalView(null)}
          listing={{}}
          quantity={handshakeModalView.raw?.quantity || 1}
          marketplaceAddress={MARKETPLACE_ADDRESS}
          walletAccount={walletAccount}
          defaultRole="breeder"
          onSuccess={handleHandoffSettled}
        />
      ) : null}
    </div>
  );
}

// ─── Dashboard home — the six cards (§3/§4) ─────────────────────────────────

function DashboardHome({ dashboard, ordersLoading, sellerStatus, casualModeActive, onNavigate, onNavigateToOrders, onStartOnboarding, onboardingBusy }) {
  const { newOrders, pendingActions, earnings, lowStock, openClaims } = dashboard;
  const totalPending = pendingActions.toDispatch.count + pendingActions.toHandoff.count + pendingActions.cashMeets.count;
  const onboardingComplete = !!sellerStatus?.onboardingComplete;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1rem" }}>
      {!onboardingComplete && (
        <div
          className="glass-card"
          style={{ padding: "1.25rem", gridColumn: "1 / -1", border: "1px solid rgba(251, 191, 36, 0.35)", background: "rgba(251, 191, 36, 0.06)" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.5rem" }}>
            <Warning size={20} weight="duotone" color="#fbbf24" />
            <strong style={{ color: "#fff", fontSize: "0.95rem" }}>Connect payouts to get paid</strong>
          </div>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.8rem", margin: "0 0 0.85rem 0" }}>
            Buyers can't complete checkout for your listings until Stripe payouts are set up.
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={onStartOnboarding}
            disabled={onboardingBusy}
            style={{ minHeight: "44px" }}
          >
            {onboardingBusy ? "Opening…" : "Set up payouts"}
          </button>
        </div>
      )}

      <DashboardCard
        icon={<ClipboardText size={20} weight="duotone" color="#38bdf8" />}
        title="New Orders"
        value={ordersLoading ? "…" : String(newOrders.count)}
        subtitle={
          Object.keys(newOrders.byType).length > 0
            ? Object.entries(newOrders.byType).map(([type, count]) => `${count} ${type}`).join(", ")
            : "Since your last visit"
        }
        onClick={() => onNavigateToOrders("needs_action")}
      />

      <DashboardCard
        icon={<Truck size={20} weight="duotone" color="#a78bfa" />}
        title="Pending Actions"
        value={ordersLoading ? "…" : String(totalPending)}
        subtitle={`${pendingActions.toDispatch.count} to dispatch · ${pendingActions.toHandoff.count} to hand off · ${pendingActions.cashMeets.count} cash meets`}
        onClick={() => onNavigateToOrders("needs_action")}
      />

      <DashboardCard
        icon={<CurrencyDollar size={20} weight="duotone" color="#34d399" />}
        title="Earnings"
        value={ordersLoading ? "…" : formatPriceCents(earnings.availableCents)}
        subtitle={`${formatPriceCents(earnings.protectedCents)} protected · ${formatPriceCents(earnings.frozenCents)} frozen`}
        onClick={() => onNavigate(SECTIONS.PAYOUTS)}
      />

      <DashboardCard
        icon={<Package size={20} weight="duotone" color="#fbbf24" />}
        title="Low Stock"
        value={String(lowStock.items.length)}
        subtitle={casualModeActive ? "Listings running low or sold" : "Listings at/near zero inventory"}
        onClick={() => onNavigate(SECTIONS.LISTINGS)}
      />

      <DashboardCard
        icon={openClaims.count > 0 ? <Warning size={20} weight="duotone" color="#f87171" /> : <CheckCircle size={20} weight="duotone" color="#34d399" />}
        title="Open Claims"
        value={ordersLoading ? "…" : String(openClaims.count)}
        subtitle={openClaims.count > 0 ? "Needs your attention" : "No disputes open"}
        onClick={() => onNavigateToOrders("claims")}
        alert={openClaims.count > 0}
      />

      <DashboardCard
        icon={<StorefrontIcon size={20} weight="duotone" color="#7dd3fc" />}
        title="Storefront"
        value={onboardingComplete ? "Ready" : "Setup needed"}
        subtitle={onboardingComplete ? "Payouts connected" : "Payouts not yet connected"}
        onClick={() => onNavigate(SECTIONS.PAYOUTS)}
        alert={!onboardingComplete}
      />
    </div>
  );
}

function DashboardCard({ icon, title, value, subtitle, onClick, alert = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="glass-card"
      style={{
        padding: "1.1rem 1.25rem",
        textAlign: "left",
        border: alert ? "1px solid rgba(248, 113, 113, 0.35)" : "1px solid var(--glass-border)",
        background: alert ? "rgba(248, 113, 113, 0.05)" : "rgba(255,255,255,0.01)",
        cursor: "pointer",
        minHeight: "44px",
        display: "flex",
        flexDirection: "column",
        gap: "0.4rem",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        {icon}
        <span style={{ fontSize: "0.75rem", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
          {title}
        </span>
      </div>
      <strong style={{ fontSize: "1.5rem", color: "#fff" }}>{value}</strong>
      <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>{subtitle}</span>
    </button>
  );
}

// ─── Orders section — the Task 19 fulfillment queue ─────────────────────────
//
// Sourced from relayGetOrders (local-first, seller-role), normalized through
// sellerOrderView.js. Filters + per-order actions compose the existing
// verified services (buyShippingLabel, relayDispatchShipping,
// relaySettleHandshake via HandshakeVerification, relayUpdateBatchOrder) —
// nothing here re-implements money/ownership/settlement.

const FULFILLMENT_TABS = [
  { key: "all", label: "All" },
  { key: "shipping", label: "Shipping" },
  { key: "courier", label: "Courier" },
  { key: "prepaid_pickup", label: "Prepaid pickup" },
  { key: "cash_pickup", label: "Cash pickup" },
];

const STATUS_TABS = [
  { key: "needs_action", label: "Needs action" },
  { key: "in_progress", label: "In progress" },
  { key: "completed", label: "Completed" },
  { key: "claims", label: "Claims" },
  { key: "all", label: "All" },
];

const PAYOUT_CHIP_STYLE = {
  protected: { bg: "rgba(56, 189, 248, 0.1)", border: "rgba(56, 189, 248, 0.3)", color: "#7dd3fc", label: "Protected" },
  available: { bg: "rgba(52, 211, 153, 0.1)", border: "rgba(52, 211, 153, 0.3)", color: "#34d399", label: "Available" },
  frozen: { bg: "rgba(248, 113, 113, 0.1)", border: "rgba(248, 113, 113, 0.3)", color: "#f87171", label: "Frozen" },
  none: { bg: "rgba(255,255,255,0.03)", border: "rgba(255,255,255,0.08)", color: "var(--text-muted)", label: "—" },
};

function OrdersSection({
  views,
  totalCount,
  loading,
  casualModeActive,
  fulfillmentFilter,
  onFulfillmentFilterChange,
  statusFilter,
  onStatusFilterChange,
  query,
  onQueryChange,
  actionError,
  onDismissError,
  labelBuyingId,
  onBuyLabel,
  manualTrackingOrderId,
  onOpenManualTracking,
  onCancelManualTracking,
  manualTrackingInput,
  onManualTrackingInputChange,
  onMarkDispatchedManually,
  onOpenHandoffScan,
  onRespondToClaim,
  onMessageCustomer,
  conversationBusyId,
  canBulkManage,
  selectedOrderIds,
  onToggleSelected,
  onBulkBuyLabels,
  bulkBusy,
  expandedCustomerId,
  onToggleCustomerHistory,
  allSellerOrders,
  expandedPickupId,
  pickupArrangements,
  onTogglePickupArrangement,
  onConfirmPickupTime,
  pickupConfirmBusyId,
}) {
  // ABOVE the loading early-return on purpose: hooks must run on every render or
  // the count changes between the shimmer and the loaded view — "Rendered more
  // hooks than during the previous render".
  const fulfillmentTabsScrollRef = useScrollAffordance();
  const statusTabsScrollRef = useScrollAffordance();

  if (loading) {
    return <div className="shimmer-placeholder" style={{ height: "240px", borderRadius: "12px" }} />;
  }

  const selectedBuyLabelCount = views.filter(
    (v) => selectedOrderIds.has(v.id) && v.sellerNextAction.kind === SELLER_ACTION_KIND.BUY_LABEL
  ).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      {actionError && (
        <div
          className="glass-card"
          style={{
            padding: "0.75rem 1rem",
            border: "1px solid rgba(248, 113, 113, 0.3)",
            background: "rgba(248, 113, 113, 0.05)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "1rem",
          }}
        >
          <span style={{ color: "var(--accent-red, #f87171)", fontSize: "0.8rem" }}>{actionError}</span>
          <button type="button" className="btn-secondary" style={{ padding: "0.25rem 0.6rem", fontSize: "0.7rem", flexShrink: 0 }} onClick={onDismissError}>
            Dismiss
          </button>
        </div>
      )}

      {/* Fulfillment-type tabs */}
      <div className="scroll-fade" ref={fulfillmentTabsScrollRef} style={{ display: "flex", gap: "0.4rem", overflowX: "auto", WebkitOverflowScrolling: "touch" }} role="tablist" aria-label="Fulfillment type">
        {FULFILLMENT_TABS.map((tab) => {
          const isActive = fulfillmentFilter === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onFulfillmentFilterChange(tab.key)}
              style={{
                padding: "0.4rem 0.85rem",
                minHeight: "36px",
                fontSize: "0.72rem",
                fontWeight: isActive ? 700 : 500,
                background: isActive ? "rgba(167, 139, 250, 0.12)" : "rgba(255,255,255,0.02)",
                border: isActive ? "1px solid rgba(167, 139, 250, 0.4)" : "1px solid rgba(255,255,255,0.08)",
                borderRadius: "20px",
                color: isActive ? "#a78bfa" : "var(--text-secondary)",
                cursor: "pointer",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Status filter tabs */}
      <div className="scroll-fade" ref={statusTabsScrollRef} style={{ display: "flex", gap: "0.4rem", overflowX: "auto", WebkitOverflowScrolling: "touch" }} role="tablist" aria-label="Order status">
        {STATUS_TABS.map((tab) => {
          const isActive = statusFilter === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => onStatusFilterChange(tab.key)}
              style={{
                padding: "0.4rem 0.85rem",
                minHeight: "36px",
                fontSize: "0.72rem",
                fontWeight: isActive ? 700 : 500,
                background: isActive ? "rgba(56, 189, 248, 0.1)" : "rgba(255,255,255,0.02)",
                border: isActive ? "1px solid rgba(56, 189, 248, 0.4)" : "1px solid rgba(255,255,255,0.08)",
                borderRadius: "20px",
                color: isActive ? "var(--accent-blue)" : "var(--text-secondary)",
                cursor: "pointer",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Search */}
      <div style={{ position: "relative" }}>
        <MagnifyingGlass size={14} style={{ position: "absolute", left: "0.65rem", top: "50%", transform: "translateY(-50%)", opacity: 0.5, color: "var(--text-muted)" }} />
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search by species, customer, or tracking #..."
          style={{
            width: "100%",
            padding: "0.55rem 0.75rem 0.55rem 2rem",
            background: "rgba(255, 255, 255, 0.03)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "8px",
            color: "#fff",
            fontSize: "0.8rem",
            minHeight: "40px",
          }}
        />
      </div>

      {/* Bulk actions bar — XP-gated (Abyssal+ bulk_management). Single-order
          actions below are never gated (spec §3/§4 criterion 8). */}
      {canBulkManage && selectedOrderIds.size > 0 && (
        <div
          className="glass-card"
          style={{ padding: "0.65rem 0.9rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", border: "1px solid rgba(167, 139, 250, 0.3)" }}
        >
          <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)" }}>
            {selectedOrderIds.size} selected
          </span>
          <button
            type="button"
            className="btn-primary"
            disabled={selectedBuyLabelCount === 0 || bulkBusy}
            onClick={onBulkBuyLabels}
            style={{ minHeight: "36px", padding: "0.4rem 0.9rem", fontSize: "0.75rem" }}
          >
            {bulkBusy ? "Buying labels…" : `Bulk buy labels (${selectedBuyLabelCount})`}
          </button>
        </div>
      )}

      {views.length === 0 ? (
        <div className="glass-card" style={{ padding: "2.5rem", textAlign: "center" }}>
          <p style={{ color: "var(--text-muted)" }}>
            {totalCount === 0
              ? (casualModeActive ? "No orders yet." : "No orders yet.")
              : "No orders match these filters."}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {views.map((view) => (
            <SellerOrderRow
              key={view.id}
              view={view}
              casualModeActive={casualModeActive}
              labelBuying={labelBuyingId === view.id}
              onBuyLabel={() => onBuyLabel(view)}
              manualTrackingOpen={manualTrackingOrderId === view.id}
              onOpenManualTracking={() => onOpenManualTracking(view.id)}
              onCancelManualTracking={onCancelManualTracking}
              manualTrackingInput={manualTrackingInput}
              onManualTrackingInputChange={onManualTrackingInputChange}
              onMarkDispatchedManually={() => onMarkDispatchedManually(view)}
              onOpenHandoffScan={() => onOpenHandoffScan(view)}
              onRespondToClaim={() => onRespondToClaim(view)}
              onMessageCustomer={() => onMessageCustomer(view)}
              conversationBusy={conversationBusyId === view.id}
              canBulkManage={canBulkManage}
              selected={selectedOrderIds.has(view.id)}
              onToggleSelected={() => onToggleSelected(view.id)}
              customerHistoryOpen={expandedCustomerId === view.id}
              onToggleCustomerHistory={() => onToggleCustomerHistory(expandedCustomerId === view.id ? null : view.id)}
              allSellerOrders={allSellerOrders}
              pickupOpen={expandedPickupId === view.id}
              pickupState={pickupArrangements[view.id]}
              onTogglePickup={() => onTogglePickupArrangement(view)}
              onConfirmPickupTime={(time) => onConfirmPickupTime(view, time)}
              pickupConfirmBusy={pickupConfirmBusyId === view.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SellerOrderRow({
  view,
  casualModeActive,
  labelBuying,
  onBuyLabel,
  manualTrackingOpen,
  onOpenManualTracking,
  onCancelManualTracking,
  manualTrackingInput,
  onManualTrackingInputChange,
  onMarkDispatchedManually,
  onOpenHandoffScan,
  onRespondToClaim,
  onMessageCustomer,
  conversationBusy,
  canBulkManage,
  selected,
  onToggleSelected,
  customerHistoryOpen,
  onToggleCustomerHistory,
  allSellerOrders,
  pickupOpen,
  pickupState,
  onTogglePickup,
  onConfirmPickupTime,
  pickupConfirmBusy,
}) {
  const { status, sellerNextAction, payout, customer, quantity, commonName, trackingNumber, method } = view;
  const chip = PAYOUT_CHIP_STYLE[payout.bucket] || PAYOUT_CHIP_STYLE.none;
  const kind = sellerNextAction.kind;

  // Basic customer history — past orders from this same buyer alias
  // (privacy-conscious: matched by wallet internally, shown by alias only).
  // Always available; customer_segmentation (Hadal) would gate only
  // advanced grouping/analytics on top of this, which this increment
  // doesn't build (spec §3).
  const buyerWallet = view.raw?.buyer;
  const customerHistory = customerHistoryOpen
    ? (allSellerOrders || []).filter((o) => o.buyer && buyerWallet && o.buyer.toLowerCase() === buyerWallet.toLowerCase())
    : [];

  return (
    <div className="glass-card" style={{ padding: "0.9rem 1.1rem", display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem", minWidth: 0 }}>
          {canBulkManage && kind === SELLER_ACTION_KIND.BUY_LABEL && (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelected}
              aria-label={`Select order ${view.id}`}
              style={{ marginTop: "0.3rem", width: "16px", height: "16px", cursor: "pointer", flexShrink: 0 }}
            />
          )}
          <div style={{ minWidth: 0 }}>
            <strong style={{ color: "#fff", fontSize: "0.85rem" }}>
              {commonName || "Order"}{quantity ? ` (Qty: ${quantity})` : ""}
            </strong>
            <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)", marginTop: "0.15rem" }}>
              {casualModeActive ? "Customer" : "Buyer"}:{" "}
              <button
                type="button"
                onClick={onToggleCustomerHistory}
                style={{ background: "none", border: "none", color: "var(--accent-blue)", fontFamily: "monospace", fontSize: "0.72rem", cursor: "pointer", padding: 0, textDecoration: "underline" }}
              >
                {customer.alias}
              </button>
            </div>
          </div>
        </div>

        {/* Status — icon + text, never color-only (a11y) */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "0.3rem",
            fontSize: "0.7rem",
            fontWeight: 600,
            padding: "0.25rem 0.55rem",
            borderRadius: "12px",
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: status.tone === "alert" ? "#f87171" : status.tone === "good" ? "#34d399" : "var(--text-secondary)",
            flexShrink: 0,
          }}
        >
          <span aria-hidden="true">{status.icon}</span> {status.label}
        </span>
      </div>

      {customerHistoryOpen && (
        <div style={{ padding: "0.6rem 0.75rem", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "6px", fontSize: "0.72rem", color: "var(--text-secondary)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginBottom: "0.35rem", color: "var(--text-muted)" }}>
            <ClockCounterClockwise size={13} /> Order history with {customer.alias}
          </div>
          {customerHistory.length <= 1 ? (
            <span>No other orders from this customer yet.</span>
          ) : (
            <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
              {customerHistory.map((o, idx) => (
                <li key={o.tokenId ?? o.purchaseId ?? idx}>
                  {o.commonName || "Order"} {o.createdAt ? `· ${new Date(o.createdAt * 1000).toLocaleDateString()}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
        {/* Payout chip */}
        <span
          style={{
            fontSize: "0.68rem",
            fontWeight: 600,
            padding: "0.2rem 0.5rem",
            borderRadius: "10px",
            background: chip.bg,
            border: `1px solid ${chip.border}`,
            color: chip.color,
          }}
        >
          {chip.label}{payout.proceedsCents ? ` · ${formatPriceCents(payout.proceedsCents)}` : ""}
        </span>

        {trackingNumber && (
          <span style={{ fontSize: "0.68rem", color: "var(--text-muted)" }}>
            📦 {trackingNumber}
          </span>
        )}

        <div style={{ display: "flex", gap: "0.4rem", marginLeft: "auto" }}>
          {/* Customer communication — always available (never gated). */}
          <button
            type="button"
            className="btn-secondary"
            onClick={onMessageCustomer}
            disabled={conversationBusy}
            aria-label={`Message ${customer.alias}`}
            style={{ minHeight: "36px", padding: "0.4rem 0.65rem", fontSize: "0.72rem", display: "flex", alignItems: "center", gap: "0.3rem" }}
          >
            <ChatCircleDots size={14} /> {conversationBusy ? "Opening…" : "Message"}
          </button>

          {/* No seller-initiated refund/cancel: refunds are curator/backend-only
              (see the note by the removed handler). A seller who can't fulfill
              uses "Message"; the authorized refund happens via the buyer's
              dispute → curator resolution path. */}

          <SellerActionButton
            kind={kind}
            copy={sellerNextAction.copy}
            labelBuying={labelBuying}
            onBuyLabel={onBuyLabel}
            onOpenHandoffScan={onOpenHandoffScan}
            onRespondToClaim={onRespondToClaim}
          />
        </div>
      </div>

      {/* Manual tracking fallback (mirrors CheckoutSummary's <details>) */}
      {kind === SELLER_ACTION_KIND.BUY_LABEL && (
        <details open={manualTrackingOpen}>
          <summary
            onClick={(e) => { e.preventDefault(); manualTrackingOpen ? onCancelManualTracking() : onOpenManualTracking(); }}
            style={{ fontSize: "0.7rem", color: "var(--text-muted)", cursor: "pointer" }}
          >
            Already have a tracking number? Enter it manually
          </summary>
          {manualTrackingOpen && (
            <div style={{ display: "flex", gap: "0.4rem", marginTop: "0.5rem" }}>
              <input
                type="text"
                value={manualTrackingInput}
                onChange={(e) => onManualTrackingInputChange(e.target.value)}
                placeholder="e.g. USPS 94001000..."
                style={{ flex: 1, padding: "0.4rem 0.6rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px", fontSize: "0.75rem" }}
              />
              <button
                type="button"
                className="btn-secondary"
                disabled={!manualTrackingInput}
                onClick={onMarkDispatchedManually}
                style={{ fontSize: "0.72rem", padding: "0.4rem 0.65rem" }}
              >
                Mark dispatched
              </button>
            </div>
          )}
        </details>
      )}

      {/* Task 25: pickup-arrangement confirm/counter, layered on the existing
          prepaid-pickup order row rather than a new queue (spec §4). Pure
          logistics metadata — never touches settlement/inventory. */}
      {method === FULFILLMENT_METHODS.PREPAID_PICKUP && (
        <PickupArrangementPanel
          open={pickupOpen}
          onToggle={onTogglePickup}
          state={pickupState}
          onConfirm={onConfirmPickupTime}
          confirmBusy={pickupConfirmBusy}
        />
      )}
    </div>
  );
}

function PickupArrangementPanel({ open, onToggle, state, onConfirm, confirmBusy }) {
  const [counterTime, setCounterTime] = useState("");
  const arrangement = state?.data?.arrangement;
  const statusView = arrangementStatusView(arrangement || { status: "none" }, { casual: true });

  return (
    <details open={open}>
      <summary
        onClick={(e) => { e.preventDefault(); onToggle(); }}
        style={{ fontSize: "0.7rem", color: "var(--text-muted)", cursor: "pointer" }}
      >
        📍 Pickup time — {open && arrangement ? statusView.label : "view / confirm"}
      </summary>
      {open && (
        <div style={{ marginTop: "0.5rem", padding: "0.6rem 0.7rem", borderRadius: "6px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          {state?.loading && <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Loading…</span>}
          {state?.error && <span style={{ fontSize: "0.72rem", color: "var(--accent-red, #f87171)" }} role="alert">{state.error}</span>}
          {!state?.loading && !state?.error && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              <span style={{ fontSize: "0.75rem", color: "#fff" }}>{statusView.label}</span>
              {arrangement?.proposedTime && (
                <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>
                  Buyer proposed: <strong>{new Date(arrangement.proposedTime).toLocaleString()}</strong>
                </span>
              )}
              {arrangement?.confirmedTime && (
                <span style={{ fontSize: "0.7rem", color: "var(--accent-green, #34d399)" }}>
                  Confirmed: <strong>{new Date(arrangement.confirmedTime).toLocaleString()}</strong>
                </span>
              )}
              {arrangement?.status === "proposed" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={confirmBusy}
                    onClick={() => onConfirm(arrangement.proposedTime)}
                    style={{ fontSize: "0.72rem", padding: "0.4rem 0.65rem", alignSelf: "flex-start" }}
                  >
                    {confirmBusy ? "Confirming…" : "Confirm this time"}
                  </button>
                  <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                    <input
                      type="datetime-local"
                      value={counterTime}
                      onChange={(e) => setCounterTime(e.target.value)}
                      style={{ padding: "0.35rem 0.5rem", background: "rgba(255,255,255,0.03)", border: "1px solid var(--glass-border)", color: "#fff", borderRadius: "4px", fontSize: "0.72rem" }}
                    />
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={!counterTime || confirmBusy}
                      onClick={() => onConfirm(new Date(counterTime).toISOString())}
                      style={{ fontSize: "0.72rem", padding: "0.4rem 0.65rem" }}
                    >
                      Counter with this time
                    </button>
                  </div>
                </div>
              )}
              {!arrangement && (
                <span style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>No pickup time proposed yet.</span>
              )}
            </div>
          )}
        </div>
      )}
    </details>
  );
}

// Primary action button — dispatches to the composed service per next-action
// kind. request_courier renders a disabled "coming soon" affordance since the
// Task 12 local-delivery adapter isn't wired to a request action yet (spec §3).
function SellerActionButton({ kind, copy, labelBuying, onBuyLabel, onOpenHandoffScan, onRespondToClaim }) {
  const baseStyle = { minHeight: "36px", padding: "0.4rem 0.75rem", fontSize: "0.72rem" };

  switch (kind) {
    case SELLER_ACTION_KIND.BUY_LABEL:
      return (
        <button type="button" className="btn-primary" style={baseStyle} disabled={labelBuying} onClick={onBuyLabel}>
          {labelBuying ? "Buying label…" : copy}
        </button>
      );
    case SELLER_ACTION_KIND.SCAN_HANDOFF:
    case SELLER_ACTION_KIND.CONFIRM_CASH:
      return (
        <button type="button" className="btn-primary" style={baseStyle} onClick={onOpenHandoffScan}>
          {copy}
        </button>
      );
    case SELLER_ACTION_KIND.SCHEDULE_PICKUP:
      // No dedicated scheduling UI yet in this increment — the handoff scan
      // modal doubles as the pickup-prep affordance until it's ready.
      return (
        <button type="button" className="btn-secondary" style={baseStyle} onClick={onOpenHandoffScan}>
          {copy}
        </button>
      );
    case SELLER_ACTION_KIND.REQUEST_COURIER:
      return (
        <button type="button" className="btn-secondary" style={{ ...baseStyle, opacity: 0.5, cursor: "not-allowed" }} disabled title="Local courier requests are coming soon">
          {copy} (coming soon)
        </button>
      );
    case SELLER_ACTION_KIND.RESPOND_TO_CLAIM:
      return (
        <button type="button" className="btn-secondary" style={{ ...baseStyle, border: "1px solid rgba(248,113,113,0.3)", color: "var(--accent-red)" }} onClick={onRespondToClaim}>
          {copy}
        </button>
      );
    case SELLER_ACTION_KIND.AWAITING_BUYER:
    case SELLER_ACTION_KIND.VIEW_RECEIPT:
      return <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{copy}</span>;
    default:
      return null;
  }
}

// ─── Listings section (seller's listings + "New listing" launcher) ─────────
//
// Task 9 Increment 2 §2.5: a proper listings view — per-listing state
// (active/paused/sold/draft where derivable from the listing shape), the
// species/care summary, the packing profile, and inline edit (existing
// EditListingModal) / new (existing ListSpecimenModal). No new write logic —
// this section only reads `sellerListings` (already sourced from the shared
// `useMarketplaceListings` hook) and routes to the two existing modals.

function listingStatus(item) {
  if (item.isBatch) {
    if (item.isActive === false) return { label: "Paused", tone: "muted", icon: "⏸️" };
    if (Number(item.quantity) <= 0) return { label: "Sold out", tone: "alert", icon: "⚠️" };
    return { label: "Active", tone: "good", icon: "✅" };
  }
  if (item.active === false || item.status === "sold") return { label: "Sold", tone: "muted", icon: "✅" };
  return { label: "Active", tone: "good", icon: "✅" };
}

const LISTING_STATUS_COLOR = Object.freeze({
  good: "#34d399",
  alert: "#f87171",
  muted: "var(--text-muted)",
});

function ListingsSection({ listings, casualModeActive, onNewListing, onEditListing }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "1rem" }}>
        <button type="button" className="btn-primary" onClick={onNewListing} style={{ minHeight: "44px" }}>
          <Plus size={16} weight="bold" /> New Listing
        </button>
      </div>
      {listings.length === 0 ? (
        <div className="glass-card" style={{ padding: "2.5rem", textAlign: "center" }}>
          <p style={{ color: "var(--text-muted)" }}>
            {casualModeActive ? "You haven't listed anything yet." : "No active listings."}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {listings.map((item) => {
            const status = listingStatus(item);
            const pp = item.packingProfile;
            return (
              <div
                key={item.isBatch ? `batch-${item.listingId}` : `single-${item.tokenId}`}
                className="glass-card"
                style={{ padding: "0.9rem 1.1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem", flexWrap: "wrap" }}>
                  <div>
                    <strong style={{ color: "#fff", fontSize: "0.85rem" }}>{item.commonName}</strong>
                    {item.scientificName && (
                      <span style={{ display: "block", fontSize: "0.68rem", fontStyle: "italic", color: "var(--text-muted)" }}>
                        {item.scientificName}
                      </span>
                    )}
                  </div>
                  <span
                    style={{
                      display: "inline-flex", alignItems: "center", gap: "0.3rem",
                      fontSize: "0.68rem", fontWeight: 600, padding: "0.2rem 0.5rem", borderRadius: "12px",
                      background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
                      color: LISTING_STATUS_COLOR[status.tone],
                    }}
                  >
                    <span aria-hidden="true">{status.icon}</span> {status.label}
                  </span>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <span style={{ color: "var(--text-secondary)", fontSize: "0.75rem" }}>
                    {item.isBatch ? `${item.quantity} available` : "1 specimen"}
                    {pp && (
                      <span style={{ color: "var(--text-muted)", fontFamily: "monospace", marginLeft: "0.5rem" }}>
                        · 📦 ~{pp.bagCount} bag{pp.bagCount === 1 ? "" : "s"} · {pp.packedWeightOz}oz
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => onEditListing(item)}
                    style={{ minHeight: "36px", padding: "0.35rem 0.75rem", fontSize: "0.72rem" }}
                  >
                    Edit
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Payouts section (checkSellerStatus + getSellerDashboardLink) ──────────

function PayoutsSection({ sellerStatus, casualModeActive, onStartOnboarding, onboardingBusy, onOpenDashboard, dashboardLinkBusy }) {
  const onboardingComplete = !!sellerStatus?.onboardingComplete;

  return (
    <div className="glass-card" style={{ padding: "1.5rem" }}>
      <h3 style={{ color: "#fff", fontSize: "1rem", margin: "0 0 0.75rem 0" }}>💳 Payouts</h3>
      {onboardingComplete ? (
        <>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: "1rem" }}>
            Payouts connected. View your balance and transfer history in the Stripe Express dashboard —
            it's the authoritative source for what's actually been paid out.
          </p>
          <button
            type="button"
            className="btn-secondary"
            onClick={onOpenDashboard}
            disabled={dashboardLinkBusy}
            style={{ minHeight: "44px" }}
          >
            <ArrowSquareOut size={16} weight="bold" /> {dashboardLinkBusy ? "Opening…" : "Open Stripe Dashboard"}
          </button>
        </>
      ) : (
        <>
          <p style={{ color: "var(--text-secondary)", fontSize: "0.85rem", marginBottom: "1rem" }}>
            {casualModeActive
              ? "Set up payouts so buyers can pay you for your fish."
              : "Complete Stripe Connect onboarding to accept card payments and receive payouts."}
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={onStartOnboarding}
            disabled={onboardingBusy}
            style={{ minHeight: "44px" }}
          >
            {onboardingBusy ? "Opening…" : "Set up payouts"}
          </button>
        </>
      )}
    </div>
  );
}
