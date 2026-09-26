/**
 * BoothInventory.jsx — the booth surface (BOOTH_BUILD_SPEC.md §6, workstream E).
 *
 * WHAT THIS REPLACES: at Aquashella every vendor booth ran inventory off a
 * spreadsheet on a laptop, took mostly cash, and wrote prices on bags in marker.
 * This is built for one specific posture — standing at a table, phone in one
 * hand, fish in the other. Hence ≥44px controls, arm's-length type sizes, and a
 * Sell action you can hit with a thumb without looking. `ListingsSection` next
 * door uses 0.68–0.72rem text and a 36px button; that is a desk view, not a
 * booth view.
 *
 * FREE FOREVER (decision D7): inventory and cash recording are never gated on an
 * entitlement. There is intentionally no `hasEntitlement` call in this file.
 * Inventory is the adoption wedge; metering it would fight our own wedge.
 *
 * MONEY BOUNDARY: no fee, no rate, no total, no platform-fee constant anywhere
 * here. Cash goes through `recordCashSale` (which the server pins to
 * `platform_fee_cents = 0` because we provided no payment service). CARD is
 * deliberately a hand-off to the existing guest checkout product page so the fee
 * policy applies there — implementing card here would be a way to take a card
 * payment at 0%.
 *
 * DATA SOURCE: a seller-scoped Supabase read on its own react-query key, NOT
 * `useMarketplaceListings`. That hook is a shared `["listings", …]` cache with a
 * 2-minute staleTime that refetches chain + cloud + Dexie on every call and,
 * offline, returns rows tagged `fallback`. Wrong for a live stock counter that
 * someone is reading while handing over a bag.
 *
 * OFFLINE (decision D6): every sale is written to the Dexie outbox BEFORE the
 * POST, so a sale survives dead wifi, a dropped tab, or a locked phone. Replay
 * runs on mount and on `online`, and is safe because the server is idempotent on
 * the client-generated `saleId`.
 *
 * Props: { walletAccount, casualModeActive }
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Tote,
  MagnifyingGlass,
  Minus,
  Plus,
  Money,
  CreditCard,
  CloudSlash,
  ArrowsClockwise,
  CheckCircle,
  Warning,
  X,
  SpinnerGap,
  QrCode,
  Printer,
} from "@phosphor-icons/react";

import { supabase } from "../../services/supabaseClient";
import { formatPriceCents } from "../../services/catalogQuery";
import { announce } from "../../utils/a11y";
import { publishTank, recordCashSale, sendQueuedSale } from "../../services/boothApi";
import {
  countQueuedSales,
  isPermanentFailure,
  markSaleRejected,
  markSaleSent,
  newSaleId,
  queueSale,
  replayQueue,
} from "../../services/boothOutbox";
import {
  applyLocalSale,
  boothCopy,
  boothProductPath,
  clampSellQuantity,
  filterBoothLines,
  formatRemaining,
  isSoldOut,
  normalizeBoothLines,
  reconcileRemaining,
} from "../../services/boothInventory";
import { generatePublicTankLabel } from "../../utils/pdfExport";

// Columns the booth needs, and nothing else. `quantity_remaining` /
// `quantity_total` are real columns as of 20260916_inventory_of_record.sql;
// species + photo details still live in the `data` blob.
const BOOTH_SELECT =
  "id, common_name, price, is_batch, is_active, quantity_total, quantity_remaining, data";

async function fetchBoothInventory(walletAccount) {
  const { data, error } = await supabase
    .from("aquadex_listings")
    .select(BOOTH_SELECT)
    .eq("seller_address", String(walletAccount).toLowerCase())
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message || "Could not load inventory.");
  return data || [];
}

// Big enough to read at arm's length; big enough to hit without aiming.
const TAP_MIN = "48px";

function useOnlineStatus() {
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine !== false
  );
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

export function BoothInventory({ walletAccount, casualModeActive = false }) {
  const copy = boothCopy(casualModeActive);
  const online = useOnlineStatus();

  const [query, setQuery] = useState("");
  const [lines, setLines] = useState([]);
  const [sellTarget, setSellTarget] = useState(null);
  const [sellQty, setSellQty] = useState(1);
  const [saleBusy, setSaleBusy] = useState(false);
  const [lastSale, setLastSale] = useState(null);
  const [saleError, setSaleError] = useState(null);
  const [queuedCount, setQueuedCount] = useState(0);
  // Form fields live in PublishTankModal; the parent only owns the request.
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [publishResult, setPublishResult] = useState(null);

  const inventory = useQuery({
    queryKey: ["boothInventory", walletAccount ? String(walletAccount).toLowerCase() : null],
    queryFn: () => fetchBoothInventory(walletAccount),
    enabled: !!walletAccount,
    // Short, unlike the 2-minute shared listings cache: at a booth the count on
    // screen is being read out loud to a customer.
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });

  // Server data seeds local state; optimistic decrements and server
  // reconciliation then mutate it in place until the next fetch.
  useEffect(() => {
    if (inventory.data) setLines(normalizeBoothLines(inventory.data));
  }, [inventory.data]);

  const refreshQueuedCount = useCallback(async () => {
    try {
      setQueuedCount(await countQueuedSales({ sellerAddress: walletAccount || null }));
    } catch {
      /* non-fatal — the badge is informational */
    }
  }, [walletAccount]);

  // Replay on mount and whenever the connection comes back. Both are safe to
  // fire repeatedly: the server is idempotent on saleId and replayQueue reuses
  // the stored id rather than minting a new one.
  const drainQueue = useCallback(async () => {
    try {
      const summary = await replayQueue({
        send: sendQueuedSale,
        sellerAddress: walletAccount || null,
      });
      if (summary.sent > 0) {
        announce(`${summary.sent} queued ${summary.sent === 1 ? "sale" : "sales"} synced.`);
        inventory.refetch();
      }
    } catch {
      /* leave the rows queued */
    } finally {
      refreshQueuedCount();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAccount, refreshQueuedCount]);

  useEffect(() => {
    if (!walletAccount) return;
    refreshQueuedCount();
    if (online) drainQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAccount]);

  useEffect(() => {
    if (!walletAccount) return;
    const onReconnect = () => drainQueue();
    window.addEventListener("online", onReconnect);
    return () => window.removeEventListener("online", onReconnect);
  }, [walletAccount, drainQueue]);

  const visibleLines = useMemo(() => (query ? filterBoothLines(lines, query) : lines), [lines, query]);

  const openSell = (line) => {
    setSellTarget(line);
    setSellQty(clampSellQuantity(1, line.quantityRemaining));
    setSaleError(null);
  };

  const closeSell = () => {
    setSellTarget(null);
    setSaleBusy(false);
    setSaleError(null);
  };

  /**
   * The whole point of the feature. Order matters:
   *   1. generate ONE saleId
   *   2. write it to the durable queue
   *   3. update the count on screen
   *   4. then try the network
   * Steps 1–3 are what make a sale survive airplane mode.
   */
  const handleCashSale = async () => {
    if (!sellTarget || saleBusy) return;
    const line = sellTarget;
    const qty = clampSellQuantity(sellQty, line.quantityRemaining);
    if (qty < 1) return;

    // Generated once. Every retry — here and in the outbox — reuses it.
    const saleId = newSaleId();
    setSaleBusy(true);
    setSaleError(null);

    try {
      await queueSale({
        saleId,
        listingId: line.id,
        quantity: qty,
        unitPriceCents: line.priceCents,
        sellerAddress: walletAccount,
      });
    } catch (err) {
      setSaleBusy(false);
      setSaleError("Could not save the sale on this device. Nothing was recorded.");
      console.error("[Booth] queue write failed:", err?.message || err);
      return;
    }

    // Optimistic: the fish left the table, so the count drops now.
    setLines((prev) => applyLocalSale(prev, line.id, qty));
    setLastSale({ name: line.commonName, quantity: qty, synced: false });
    closeSell();
    announce(`Recorded ${qty} ${line.commonName}.`);

    const result = await recordCashSale({
      saleId,
      listingId: line.id,
      quantity: qty,
      unitPriceCents: line.priceCents,
    });

    if (result.success) {
      await markSaleSent(
        saleId,
        { quantityRemaining: result.quantityRemaining, orderId: result.orderId },
        {}
      );
      // The server's count wins — another device at the same booth may have sold
      // the same fish while this one was mid-request.
      setLines((prev) => reconcileRemaining(prev, line.id, result.quantityRemaining));
      setLastSale({
        name: line.commonName,
        quantity: qty,
        synced: true,
        warning: result.warning || null,
      });
    } else if (isPermanentFailure(result)) {
      await markSaleRejected(saleId, result.code || result.error, {});
      setSaleError(result.error || "That sale was refused.");
      setLastSale(null);
      // Pull the real count back — the optimistic guess was wrong.
      inventory.refetch();
    }
    // Anything else (offline, 5xx) stays QUEUED and replays on reconnect.

    await refreshQueuedCount();
    setSaleBusy(false);
  };

  if (!walletAccount) {
    return (
      <div className="glass-card" style={{ padding: "2rem", textAlign: "center" }}>
        <p style={{ color: "var(--text-muted)", fontSize: "1rem" }}>
          Connect your account to open the booth.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
      {/* ── Header: title, connection state, queue badge, manual refresh ── */}
      <div className="glass-card" style={{ padding: "1rem 1.1rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
          <Tote size={26} weight="duotone" color="#7dd3fc" />
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            <h3 style={{ color: "#fff", fontSize: "1.15rem", margin: 0, fontWeight: 700 }}>
              {copy.sectionTitle}
            </h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", margin: "0.15rem 0 0 0" }}>
              {copy.subtitle}
            </p>
          </div>
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setPublishModalOpen(true)}
              aria-label="Publish tank for QR label"
              style={{
                minHeight: TAP_MIN,
                minWidth: TAP_MIN,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <QrCode size={20} weight="bold" />
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                inventory.refetch();
                if (online) drainQueue();
              }}
              aria-label="Refresh inventory"
              style={{
                minHeight: TAP_MIN,
                minWidth: TAP_MIN,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {inventory.isFetching ? (
                <SpinnerGap size={22} className="spin" />
              ) : (
                <ArrowsClockwise size={22} weight="bold" />
              )}
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.75rem" }}>
          {!online && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                fontSize: "0.9rem",
                fontWeight: 600,
                color: "#fbbf24",
                background: "rgba(251, 191, 36, 0.12)",
                border: "1px solid rgba(251, 191, 36, 0.35)",
                borderRadius: "10px",
                padding: "0.5rem 0.7rem",
              }}
            >
              <CloudSlash size={18} weight="duotone" /> {copy.offlineLabel}
            </span>
          )}
          {queuedCount > 0 && (
            <span
              aria-live="polite"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                fontSize: "0.9rem",
                fontWeight: 600,
                color: "#7dd3fc",
                background: "rgba(56, 189, 248, 0.12)",
                border: "1px solid rgba(56, 189, 248, 0.35)",
                borderRadius: "10px",
                padding: "0.5rem 0.7rem",
              }}
            >
              {queuedCount} {copy.queuedLabel}
            </span>
          )}
        </div>
      </div>

      {/* ── Sale confirmation / refusal ─────────────────────────────────── */}
      {lastSale && (
        <div
          role="status"
          className="glass-card"
          style={{
            padding: "0.85rem 1rem",
            display: "flex",
            alignItems: "center",
            gap: "0.6rem",
            border: "1px solid rgba(52, 211, 153, 0.35)",
            background: "rgba(52, 211, 153, 0.08)",
          }}
        >
          <CheckCircle size={24} weight="duotone" color="#34d399" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ color: "#fff", fontSize: "1rem" }}>
              {lastSale.quantity} × {lastSale.name}
            </strong>
            <div style={{ color: "var(--text-secondary)", fontSize: "0.88rem" }}>
              {lastSale.warning
                ? lastSale.warning
                : lastSale.synced
                  ? "Recorded."
                  : "Saved on this phone. It'll sync when you're back online."}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setLastSale(null)}
            aria-label="Dismiss"
            style={{
              minHeight: TAP_MIN,
              minWidth: TAP_MIN,
              background: "transparent",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            <X size={20} weight="bold" />
          </button>
        </div>
      )}

      {saleError && (
        <div
          role="alert"
          className="glass-card"
          style={{
            padding: "0.85rem 1rem",
            display: "flex",
            alignItems: "center",
            gap: "0.6rem",
            border: "1px solid rgba(248, 113, 113, 0.4)",
            background: "rgba(248, 113, 113, 0.08)",
          }}
        >
          <Warning size={24} weight="duotone" color="#f87171" />
          <span style={{ color: "#fff", fontSize: "0.95rem", flex: 1 }}>{saleError}</span>
          <button
            type="button"
            onClick={() => setSaleError(null)}
            aria-label="Dismiss"
            style={{
              minHeight: TAP_MIN,
              minWidth: TAP_MIN,
              background: "transparent",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            <X size={20} weight="bold" />
          </button>
        </div>
      )}

      {/* ── Search ─────────────────────────────────────────────────────── */}
      <div style={{ position: "relative" }}>
        <MagnifyingGlass
          size={20}
          weight="bold"
          style={{
            position: "absolute",
            left: "0.85rem",
            top: "50%",
            transform: "translateY(-50%)",
            color: "var(--text-muted)",
            pointerEvents: "none",
          }}
        />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={copy.searchPlaceholder}
          aria-label={copy.searchPlaceholder}
          style={{
            width: "100%",
            minHeight: "52px",
            padding: "0.7rem 0.9rem 0.7rem 2.6rem",
            fontSize: "1rem",
            borderRadius: "12px",
            border: "1px solid var(--glass-border)",
            background: "rgba(255,255,255,0.04)",
            color: "#fff",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* ── The lines ──────────────────────────────────────────────────── */}
      {inventory.isLoading ? (
        <div className="glass-card" style={{ padding: "2rem", textAlign: "center" }}>
          <p style={{ color: "var(--text-muted)", fontSize: "1rem" }}>Loading inventory…</p>
        </div>
      ) : inventory.isError ? (
        <div className="glass-card" style={{ padding: "1.5rem", textAlign: "center" }}>
          <p style={{ color: "#f87171", fontSize: "1rem", marginBottom: "0.75rem" }}>
            Couldn't load inventory.
          </p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => inventory.refetch()}
            style={{ minHeight: TAP_MIN }}
          >
            Try again
          </button>
        </div>
      ) : visibleLines.length === 0 ? (
        <div className="glass-card" style={{ padding: "2rem", textAlign: "center" }}>
          <p style={{ color: "var(--text-muted)", fontSize: "1rem" }}>
            {lines.length === 0 ? copy.emptyState : copy.noMatches}
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          {visibleLines.map((line) => (
            <BoothLine
              key={line.listingKey}
              line={line}
              copy={copy}
              onSell={() => openSell(line)}
            />
          ))}
        </div>
      )}

      {sellTarget && (
        <SellSheet
          line={sellTarget}
          copy={copy}
          quantity={sellQty}
          onQuantityChange={(next) => setSellQty(clampSellQuantity(next, sellTarget.quantityRemaining))}
          onCash={handleCashSale}
          onClose={closeSell}
          busy={saleBusy}
          online={online}
        />
      )}

      {/* ── Publish Tank Modal ─────────────────────────────────────────── */}
      {publishModalOpen && (
        <PublishTankModal
          lines={lines}
          onClose={() => {
            setPublishModalOpen(false);
            setPublishResult(null);
          }}
          onPublish={async (params) => {
            setPublishBusy(true);
            try {
              // Session token comes from the boothApi bridge AuthContext registers.
              const data = await publishTank(params);
              setPublishResult(data);
              // Generate and download the label
              if (data.publicUrl) {
                await generatePublicTankLabel({
                  token: data.token,
                  tankName: params.title || "Aquarium",
                  lines: lines.filter(l => params.listingIds.includes(l.id)).map(l => ({
                    name: l.commonName,
                    commonName: l.commonName,
                    priceCents: l.priceCents,
                  })),
                  publicUrl: data.publicUrl,
                });
                announce("Tank published and label downloaded.");
              }
            } catch (error) {
              setPublishResult({ error: error.message });
            } finally {
              setPublishBusy(false);
            }
          }}
          busy={publishBusy}
          result={publishResult}
        />
      )}
    </div>
  );
}

/**
 * One inventory line. Name, italic scientific name, price, a big remaining
 * count, and a Sell button sized for a thumb. Sold-out lines are dimmed, badged,
 * and their Sell control is gone rather than disabled — nothing to press means
 * nothing to mis-press while distracted.
 */
function BoothLine({ line, copy, onSell }) {
  const soldOut = isSoldOut(line);

  return (
    <div
      className="glass-card"
      style={{
        padding: "0.9rem 1rem",
        display: "flex",
        alignItems: "center",
        gap: "0.85rem",
        opacity: soldOut ? 0.55 : 1,
        border: soldOut ? "1px dashed rgba(248,113,113,0.45)" : undefined,
      }}
    >
      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        <strong
          style={{
            color: "#fff",
            fontSize: "1.05rem",
            fontWeight: 700,
            display: "block",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {line.commonName}
        </strong>
        {line.scientificName && (
          <span
            style={{
              display: "block",
              fontSize: "0.85rem",
              fontStyle: "italic",
              color: "var(--text-muted)",
            }}
          >
            {line.scientificName}
          </span>
        )}
        <span
          style={{
            display: "inline-block",
            marginTop: "0.3rem",
            fontSize: "1rem",
            fontWeight: 600,
            color: "#7dd3fc",
          }}
        >
          {formatPriceCents(line.priceCents)}
        </span>
        {soldOut && (
          <span
            style={{
              marginLeft: "0.6rem",
              fontSize: "0.85rem",
              fontWeight: 700,
              color: "#f87171",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {copy.soldOut}
          </span>
        )}
      </div>

      {/* Big remaining count — readable across a table. "—" when the column
          predates the migration and we genuinely do not know. */}
      <div style={{ textAlign: "center", minWidth: "3.25rem" }}>
        <div
          style={{
            fontSize: "2rem",
            lineHeight: 1,
            fontWeight: 800,
            color: soldOut ? "#f87171" : "#fff",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {formatRemaining(line)}
        </div>
        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>
          {copy.remainingLabel}
        </div>
      </div>

      {!soldOut && (
        <button
          type="button"
          className="btn-primary"
          onClick={onSell}
          aria-label={`${copy.sellLabel} ${line.commonName}`}
          style={{
            minHeight: "56px",
            minWidth: "84px",
            fontSize: "1rem",
            fontWeight: 700,
            borderRadius: "12px",
            flexShrink: 0,
          }}
        >
          {copy.sellLabel}
        </button>
      )}
    </div>
  );
}

/**
 * The sell sheet. Anchored to the bottom of the viewport so every control sits
 * in thumb range on a phone held one-handed, and wide enough that Cash and Card
 * can't be confused for each other.
 *
 * Card does NOT take a payment here. It opens the listing's product page, which
 * is the existing guest checkout — the only path where the fee policy applies.
 * Offline it is visibly disabled with the reason, while Cash keeps working.
 */
function SellSheet({ line, copy, quantity, onQuantityChange, onCash, onClose, busy, online }) {
  const remaining = line.quantityRemaining;
  const atCeiling = remaining != null && quantity >= remaining;
  const productPath = boothProductPath(line);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const stepperButton = (label, icon, onClick, disabled) => (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      style={{
        minHeight: "60px",
        minWidth: "60px",
        borderRadius: "14px",
        border: "1px solid var(--glass-border)",
        background: disabled ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.07)",
        color: disabled ? "var(--text-muted)" : "#fff",
        cursor: disabled ? "not-allowed" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {icon}
    </button>
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${copy.sellLabel} ${line.commonName}`}
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(2, 6, 23, 0.72)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-card"
        style={{
          width: "100%",
          maxWidth: "520px",
          borderRadius: "18px 18px 0 0",
          padding: "1.1rem 1.1rem 1.5rem",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
          maxHeight: "88vh",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ color: "#fff", fontSize: "1.15rem", fontWeight: 700 }}>
              {line.commonName}
            </strong>
            {line.scientificName && (
              <span
                style={{
                  display: "block",
                  fontSize: "0.9rem",
                  fontStyle: "italic",
                  color: "var(--text-muted)",
                }}
              >
                {line.scientificName}
              </span>
            )}
            <span style={{ display: "block", color: "#7dd3fc", fontSize: "1rem", fontWeight: 600, marginTop: "0.2rem" }}>
              {formatPriceCents(line.priceCents)} each · {formatRemaining(line)} {copy.remainingLabel}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              minHeight: TAP_MIN,
              minWidth: TAP_MIN,
              background: "transparent",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            <X size={22} weight="bold" />
          </button>
        </div>

        {/* Quantity stepper — default 1, clamped to the known remaining count. */}
        <div>
          <span
            id="booth-qty-label"
            style={{ display: "block", color: "var(--text-secondary)", fontSize: "0.95rem", marginBottom: "0.5rem" }}
          >
            {copy.quantityLabel}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            {stepperButton(
              "Decrease quantity",
              <Minus size={24} weight="bold" />,
              () => onQuantityChange(quantity - 1),
              quantity <= 1 || busy
            )}
            <output
              aria-labelledby="booth-qty-label"
              style={{
                flex: 1,
                textAlign: "center",
                fontSize: "2rem",
                fontWeight: 800,
                color: "#fff",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {quantity}
            </output>
            {stepperButton(
              "Increase quantity",
              <Plus size={24} weight="bold" />,
              () => onQuantityChange(quantity + 1),
              atCeiling || busy
            )}
          </div>
        </div>

        {/* Cash: free, works offline, records through ?action=record-sale. */}
        <button
          type="button"
          className="btn-primary"
          onClick={onCash}
          disabled={busy || quantity < 1}
          style={{
            minHeight: "64px",
            fontSize: "1.15rem",
            fontWeight: 700,
            borderRadius: "14px",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.55rem",
          }}
        >
          {busy ? <SpinnerGap size={24} className="spin" /> : <Money size={26} weight="duotone" />}
          Cash
        </button>
        <p style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: "-0.6rem 0 0 0", textAlign: "center" }}>
          {copy.cashHelp}
        </p>

        {/* Card: hand-off to the existing guest checkout, never a charge here. */}
        {online ? (
          <a
            href={productPath}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary"
            style={{
              minHeight: "64px",
              fontSize: "1.15rem",
              fontWeight: 700,
              borderRadius: "14px",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.55rem",
              textDecoration: "none",
            }}
          >
            <CreditCard size={26} weight="duotone" />
            Card
          </a>
        ) : (
          <button
            type="button"
            disabled
            aria-describedby="booth-card-offline"
            style={{
              minHeight: "64px",
              fontSize: "1.15rem",
              fontWeight: 700,
              borderRadius: "14px",
              border: "1px dashed var(--glass-border)",
              background: "rgba(255,255,255,0.02)",
              color: "var(--text-muted)",
              cursor: "not-allowed",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.55rem",
            }}
          >
            <CreditCard size={26} weight="duotone" />
            Card
          </button>
        )}
        <p
          id="booth-card-offline"
          style={{ color: "var(--text-muted)", fontSize: "0.85rem", margin: "-0.6rem 0 0 0", textAlign: "center" }}
        >
          {online
            ? "Opens the checkout page for this listing."
            : `${copy.cardOfflineReason}. Cash still works.`}
        </p>
      </div>
    </div>
  );
}

/**
 * PublishTankModal — UI for publishing a tank to generate QR labels.
 */
function PublishTankModal({ lines, onClose, onPublish, busy, result }) {
  const [tankRef, setTankRef] = useState("");
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [selectedListingIds, setSelectedListingIds] = useState([]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!tankRef.trim()) {
      alert("Please enter a tank reference (like 'tank-1' or 'medaka-display')");
      return;
    }
    if (selectedListingIds.length === 0) {
      alert("Select at least one listing to include on the label");
      return;
    }
    onPublish({
      tankRef: tankRef.trim(),
      title: title.trim() || "Aquarium",
      caption: caption.trim(),
      listingIds: selectedListingIds,
      isPublic: true,
    });
  };

  const toggleListing = (listingId) => {
    setSelectedListingIds(prev =>
      prev.includes(listingId)
        ? prev.filter(id => id !== listingId)
        : [...prev, listingId]
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Publish tank for QR label"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(2, 6, 23, 0.72)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass-card"
        style={{
          width: "100%",
          maxWidth: "560px",
          maxHeight: "90vh",
          overflowY: "auto",
          borderRadius: "16px",
          padding: "1.5rem",
          display: "flex",
          flexDirection: "column",
          gap: "1rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "0.6rem" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ color: "#fff", fontSize: "1.25rem", fontWeight: 700, margin: 0 }}>
              Publish Tank for QR Label
            </h3>
            <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem", marginTop: "0.3rem" }}>
              Create a printable sign that links to a public page with every fish identified and priced.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              minHeight: "44px",
              minWidth: "44px",
              background: "transparent",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            <X size={22} weight="bold" />
          </button>
        </div>

        {result?.error ? (
          <div
            style={{
              padding: "0.85rem 1rem",
              borderRadius: "12px",
              background: "rgba(248, 113, 113, 0.08)",
              border: "1px solid rgba(248, 113, 113, 0.4)",
              color: "#f87171",
              fontSize: "0.9rem",
            }}
          >
            {result.error}
          </div>
        ) : result?.publicUrl ? (
          <div
            style={{
              padding: "0.85rem 1rem",
              borderRadius: "12px",
              background: "rgba(52, 211, 153, 0.08)",
              border: "1px solid rgba(52, 211, 153, 0.35)",
              color: "#34d399",
              fontSize: "0.9rem",
            }}
          >
            <strong>Tank published!</strong>
            <p style={{ margin: "0.5rem 0 0 0", color: "var(--text-secondary)" }}>
              Your label has been downloaded. The public page is at:<br />
              <a href={result.publicUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#7dd3fc", wordBreak: "break-all" }}>
                {result.publicUrl}
              </a>
            </p>
          </div>
        ) : null}

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div>
            <label style={{ display: "block", color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "0.4rem" }}>
              Tank Reference *
            </label>
            <input
              type="text"
              value={tankRef}
              onChange={(e) => setTankRef(e.target.value)}
              placeholder="medaka-display, tank-1, show-booth"
              required
              style={{
                width: "100%",
                padding: "0.7rem 0.9rem",
                borderRadius: "10px",
                border: "1px solid var(--glass-border)",
                background: "rgba(255,255,255,0.04)",
                color: "#fff",
                fontSize: "0.95rem",
              }}
            />
            <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginTop: "0.3rem" }}>
              Used to re-publish the same tank later. Keep it simple.
            </p>
          </div>

          <div>
            <label style={{ display: "block", color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "0.4rem" }}>
              Title (optional)
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Medaka Display, Show Booth Aquarium"
              style={{
                width: "100%",
                padding: "0.7rem 0.9rem",
                borderRadius: "10px",
                border: "1px solid var(--glass-border)",
                background: "rgba(255,255,255,0.04)",
                color: "#fff",
                fontSize: "0.95rem",
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "0.4rem" }}>
              Description (optional)
            </label>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Japanese rice fish bred in Toms River, NJ. Hardy, no heater needed."
              rows={3}
              style={{
                width: "100%",
                padding: "0.7rem 0.9rem",
                borderRadius: "10px",
                border: "1px solid var(--glass-border)",
                background: "rgba(255,255,255,0.04)",
                color: "#fff",
                fontSize: "0.95rem",
                resize: "vertical",
              }}
            />
          </div>

          <div>
            <label style={{ display: "block", color: "var(--text-secondary)", fontSize: "0.9rem", marginBottom: "0.4rem" }}>
              Select Listings to Include *
            </label>
            <div style={{ maxHeight: "200px", overflowY: "auto", border: "1px solid var(--glass-border)", borderRadius: "10px" }}>
              {lines.length === 0 ? (
                <div style={{ padding: "1rem", textAlign: "center", color: "var(--text-muted)" }}>
                  No inventory loaded
                </div>
              ) : (
                lines.map((line) => (
                  <div
                    key={line.id}
                    style={{
                      padding: "0.7rem 0.9rem",
                      borderBottom: "1px solid var(--glass-border)",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.7rem",
                      background: selectedListingIds.includes(line.id)
                        ? "rgba(56, 189, 248, 0.08)"
                        : "transparent",
                    }}
                  >
                    <input
                      type="checkbox"
                      id={`publish-listing-${line.id}`}
                      checked={selectedListingIds.includes(line.id)}
                      onChange={() => toggleListing(line.id)}
                      style={{ transform: "scale(1.2)" }}
                    />
                    <label
                      htmlFor={`publish-listing-${line.id}`}
                      style={{ flex: 1, cursor: "pointer", color: "#fff" }}
                    >
                      <div style={{ fontSize: "0.9rem", fontWeight: 600 }}>{line.commonName}</div>
                      <div style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
                        {formatPriceCents(line.priceCents)} · {formatRemaining(line)} left
                      </div>
                    </label>
                  </div>
                ))
              )}
            </div>
            <p style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginTop: "0.3rem" }}>
              Only available fish will appear on the public page.
            </p>
          </div>

          <div style={{ display: "flex", gap: "0.6rem", marginTop: "0.5rem" }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={busy}
              style={{ flex: 1, minHeight: "48px" }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={busy || !tankRef.trim() || selectedListingIds.length === 0}
              style={{ flex: 1, minHeight: "48px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.4rem" }}
            >
              {busy ? (
                <>
                  <SpinnerGap size={20} className="spin" /> Publishing...
                </>
              ) : (
                <>
                  <Printer size={20} weight="bold" /> Publish & Download Label
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
