/**
 * BreederTerminal.jsx
 *
 * Breeder Terminal shell — Task 9, Increment 1 (Tier B). One seller
 * workspace: a dashboard home (the six cards from breederDashboard.js §3)
 * above the fold, plus section navigation that mounts the seller surfaces
 * that already exist. This component is intentionally thin — all
 * aggregation logic lives in the pure, tested `buildBreederDashboard`; this
 * file only fetches data, composes existing components, and renders.
 *
 * Reused, not rebuilt (per docs/TASK_09_BREEDER_TERMINAL_SPEC.md §2/§6):
 *   - fetchSellerOrders / fetchSellerAnalytics (ordersSync.js)
 *   - checkSellerStatus / getSellerDashboardLink / startSellerOnboarding (stripePayments.js)
 *   - SellerAnalytics, StorefrontSetup, ShipFromSetup, ListSpecimenModal, Modal
 *   - useMarketplaceListings, filtered to this seller
 *   - hasEntitlement for gating convenience-only surfaces
 *
 * Out of scope for this increment (see spec §1): Spec-Dex/Poseidon listing
 * helpers, the parcel-preset editor, lineage/pedigree tools, bulk operations,
 * and deep analytics beyond what SellerAnalytics already renders. No
 * listing/order writes happen here beyond launching ListSpecimenModal.
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
} from "@phosphor-icons/react";
import { fetchSellerOrders } from "../../services/ordersSync";
import { checkSellerStatus, startSellerOnboarding, getSellerDashboardLink } from "../../services/stripePayments";
import { useMarketplaceListings } from "../../hooks/useMarketplaceListings";
import { buildBreederDashboard } from "../../services/breederDashboard";
import { formatPriceCents } from "../../services/catalogQuery";
import { hasEntitlement } from "../../services/entitlements";
import { getXp } from "../../utils/xp";
import { CONTRACT_ADDRESS, MARKETPLACE_ADDRESS } from "../../config/appConfig";
import { SellerAnalytics } from "../storefront/SellerAnalytics";
import { StorefrontSetup } from "../StorefrontSetup";
import { ShipFromSetup } from "../ShipFromSetup";
import { ListSpecimenModal } from "../ListSpecimenModal";

const LAST_VISIT_STORAGE_KEY = "aquadex_breeder_last_visit";

const SECTIONS = Object.freeze({
  HOME: "home",
  ORDERS: "orders",
  LISTINGS: "listings",
  STORE: "store",
  SHIPPING: "shipping",
  ANALYTICS: "analytics",
  PAYOUTS: "payouts",
});

const NAV_ITEMS = [
  { id: SECTIONS.HOME, label: "Home", icon: Package },
  { id: SECTIONS.ORDERS, label: "Orders", icon: ClipboardText },
  { id: SECTIONS.LISTINGS, label: "Listings", icon: Package },
  { id: SECTIONS.STORE, label: "Store", icon: StorefrontIcon },
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

export function BreederTerminal({ walletAccount, casualModeActive = false }) {
  const [activeSection, setActiveSection] = useState(SECTIONS.HOME);
  const [orders, setOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [sellerStatus, setSellerStatus] = useState(null);
  const [onboardingBusy, setOnboardingBusy] = useState(false);
  const [dashboardLinkBusy, setDashboardLinkBusy] = useState(false);
  const [isListModalOpen, setIsListModalOpen] = useState(false);
  const [existingStorefrontProfile, setExistingStorefrontProfile] = useState(null);

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

  const xp = useMemo(() => getXp(), []);
  // Convenience-only surfaces are the ones gated; the six dashboard cards and
  // every core seller operation (orders, listings, store, shipping, payouts)
  // are never gated, per spec §4.
  const canExportAdvancedAnalytics = hasEntitlement("csv_export", { xp });

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
          onStartOnboarding={handleStartOnboarding}
          onboardingBusy={onboardingBusy}
        />
      )}

      {activeSection === SECTIONS.ORDERS && (
        <OrdersSection orders={orders} loading={ordersLoading} />
      )}

      {activeSection === SECTIONS.LISTINGS && (
        <ListingsSection
          listings={sellerListings}
          casualModeActive={casualModeActive}
          onNewListing={() => setIsListModalOpen(true)}
        />
      )}

      {activeSection === SECTIONS.STORE && (
        <StorefrontSetup
          walletAccount={walletAccount}
          casualModeActive={casualModeActive}
          existingProfile={existingStorefrontProfile}
        />
      )}

      {activeSection === SECTIONS.SHIPPING && <ShipFromSetup walletAccount={walletAccount} />}

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
    </div>
  );
}

// ─── Dashboard home — the six cards (§3/§4) ─────────────────────────────────

function DashboardHome({ dashboard, ordersLoading, sellerStatus, casualModeActive, onNavigate, onStartOnboarding, onboardingBusy }) {
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
        onClick={() => onNavigate(SECTIONS.ORDERS)}
      />

      <DashboardCard
        icon={<Truck size={20} weight="duotone" color="#a78bfa" />}
        title="Pending Actions"
        value={ordersLoading ? "…" : String(totalPending)}
        subtitle={`${pendingActions.toDispatch.count} to dispatch · ${pendingActions.toHandoff.count} to hand off · ${pendingActions.cashMeets.count} cash meets`}
        onClick={() => onNavigate(SECTIONS.ORDERS)}
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
        onClick={() => onNavigate(SECTIONS.ORDERS)}
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

// ─── Orders section (seller-scoped list from fetchSellerOrders) ────────────

function OrdersSection({ orders, loading }) {
  if (loading) {
    return <div className="shimmer-placeholder" style={{ height: "200px", borderRadius: "12px" }} />;
  }
  if (orders.length === 0) {
    return (
      <div className="glass-card" style={{ padding: "2.5rem", textAlign: "center" }}>
        <p style={{ color: "var(--text-muted)" }}>No orders yet.</p>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
      {orders.map((order, idx) => (
        <div
          key={order.id ?? order.stripe_session_id ?? idx}
          className="glass-card"
          style={{ padding: "0.9rem 1.1rem", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}
        >
          <div>
            <strong style={{ color: "#fff", fontSize: "0.85rem" }}>
              {(Array.isArray(order.items) ? order.items[0]?.commonName : null) || order.order_type || "Order"}
            </strong>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
              {order.created_at ? new Date(order.created_at).toLocaleDateString() : "—"} · {order.status}
            </div>
          </div>
          <strong style={{ color: "var(--accent-green)", fontFamily: "monospace" }}>
            {formatPriceCents(order.total_paid_cents || 0)}
          </strong>
        </div>
      ))}
    </div>
  );
}

// ─── Listings section (seller's listings + "New listing" launcher) ─────────

function ListingsSection({ listings, casualModeActive, onNewListing }) {
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
          {listings.map((item) => (
            <div
              key={item.isBatch ? `batch-${item.listingId}` : `single-${item.tokenId}`}
              className="glass-card"
              style={{ padding: "0.9rem 1.1rem", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}
            >
              <strong style={{ color: "#fff", fontSize: "0.85rem" }}>{item.commonName}</strong>
              <span style={{ color: "var(--text-secondary)", fontSize: "0.8rem" }}>
                {item.isBatch ? `${item.quantity} available` : "1 specimen"}
              </span>
            </div>
          ))}
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
