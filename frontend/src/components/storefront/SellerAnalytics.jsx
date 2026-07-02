/**
 * SellerAnalytics.jsx — Premium seller analytics dashboard for the storefront.
 *
 * Sits on top of the `order_analytics` Supabase view (headline KPIs) and the
 * seller's own order rows (time-series aggregation). Renders:
 *   - KPI tiles: revenue, orders, completion rate, avg order value, disputes
 *   - Revenue-over-time area chart (monthly)
 *   - Order-type mix donut
 *   - Fulfillment performance (avg dispatch → delivery)
 *   - Top species by revenue
 *   - CSV export of the underlying orders
 *
 * This is a seller-only view. It is rendered inside the "My Store" tab, which
 * is the premium storefront surface, so it is scoped to the store owner's
 * wallet. Data is fetched via ordersSync (RLS-scoped Supabase queries).
 */
import React, { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import {
  CurrencyDollar,
  Package,
  CheckCircle,
  Warning,
  ChartLineUp,
  Truck,
  House,
  DownloadSimple,
  Fish,
  Clock,
} from "@phosphor-icons/react";
import { fetchSellerAnalytics, fetchSellerOrders } from "../../services/ordersSync";

const COMPLETED_STATUSES = ["released", "completed", "settled", "resolved_released"];

const ORDER_TYPE_META = {
  shipping: { label: "Shipping", color: "#38bdf8" },
  batch: { label: "Batch", color: "#34d399" },
  fiat: { label: "Card", color: "#a78bfa" },
  cash_handshake: { label: "In-Person", color: "#fbbf24" },
  instant: { label: "Instant", color: "#f472b6" },
};

const fmtUsd = (cents, decimals = 0) =>
  `$${((cents || 0) / 100).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;

const fmtHours = (h) => {
  if (!h || h <= 0) return "—";
  if (h < 24) return `${Math.round(h)}h`;
  return `${(h / 24).toFixed(1)}d`;
};

export function SellerAnalytics({ walletAccount, casualModeActive = false }) {
  const [viewStats, setViewStats] = useState(null); // from order_analytics view
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!walletAccount) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [stats, sellerOrders] = await Promise.all([
        fetchSellerAnalytics(walletAccount),
        fetchSellerOrders(walletAccount, { limit: 500 }),
      ]);
      if (cancelled) return;
      setViewStats(stats);
      setOrders(sellerOrders);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [walletAccount]);

  // ─── Derived aggregates (fall back to client-side when the view is empty) ──
  const derived = useMemo(() => {
    const completed = orders.filter((o) => COMPLETED_STATUSES.includes(o.status));
    const revenueCents = completed.reduce((sum, o) => sum + (o.total_paid_cents || 0), 0);
    const disputed = orders.filter((o) => o.status === "disputed").length;
    const refunded = orders.filter((o) => o.status === "refunded").length;

    // Revenue over time — bucket completed orders by month
    const byMonth = new Map();
    for (const o of completed) {
      const d = new Date(o.created_at);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
      const prev = byMonth.get(key) || { key, label, revenue: 0, orders: 0 };
      prev.revenue += (o.total_paid_cents || 0) / 100;
      prev.orders += 1;
      byMonth.set(key, prev);
    }
    const revenueSeries = Array.from(byMonth.values()).sort((a, b) => a.key.localeCompare(b.key));

    // Order-type mix
    const typeCounts = new Map();
    for (const o of orders) {
      typeCounts.set(o.order_type, (typeCounts.get(o.order_type) || 0) + 1);
    }
    const typeMix = Array.from(typeCounts.entries()).map(([type, count]) => ({
      type,
      label: ORDER_TYPE_META[type]?.label || type,
      color: ORDER_TYPE_META[type]?.color || "#64748b",
      value: count,
    }));

    // Top species by revenue (attribute order total to its first line item)
    const bySpecies = new Map();
    for (const o of completed) {
      const items = Array.isArray(o.items) ? o.items : [];
      const name = items[0]?.commonName || "Unspecified";
      const prev = bySpecies.get(name) || { name, revenue: 0, units: 0 };
      prev.revenue += (o.total_paid_cents || 0) / 100;
      prev.units += items.reduce((s, i) => s + (i.quantity || 1), 0) || 1;
      bySpecies.set(name, prev);
    }
    const topSpecies = Array.from(bySpecies.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    return {
      totalOrders: orders.length,
      completedOrders: completed.length,
      revenueCents,
      disputed,
      refunded,
      avgOrderCents: completed.length ? Math.round(revenueCents / completed.length) : 0,
      revenueSeries,
      typeMix,
      topSpecies,
    };
  }, [orders]);

  // Prefer the SQL view for headline numbers (it counts all-time server-side),
  // fall back to the client-derived values when the view row is absent.
  const kpi = {
    revenueCents: viewStats?.total_revenue_cents ?? derived.revenueCents,
    totalOrders: viewStats?.total_orders ?? derived.totalOrders,
    completedOrders: viewStats?.completed_orders ?? derived.completedOrders,
    avgOrderCents: viewStats?.avg_order_value_cents ?? derived.avgOrderCents,
    disputed: viewStats?.disputed_orders ?? derived.disputed,
    refunded: viewStats?.refunded_orders ?? derived.refunded,
    avgDispatchHours: viewStats?.avg_dispatch_hours ?? 0,
    avgDeliveryHours: viewStats?.avg_delivery_hours ?? 0,
  };
  const completionRate = kpi.totalOrders
    ? Math.round((kpi.completedOrders / kpi.totalOrders) * 100)
    : 0;

  const maxSpeciesRevenue = derived.topSpecies[0]?.revenue || 1;

  const handleExportCsv = () => {
    if (!orders.length) return;
    const headers = ["Date", "Type", "Species", "Status", "Total ($)", "Tracking #", "Buyer"];
    const rows = orders.map((o) => [
      new Date(o.created_at).toLocaleDateString(),
      o.order_type,
      (Array.isArray(o.items) ? o.items[0]?.commonName : "") || "—",
      o.status,
      ((o.total_paid_cents || 0) / 100).toFixed(2),
      o.tracking_number || "—",
      o.buyer_wallet?.slice(0, 10) || "—",
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aquadex-sales-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="sf-analytics">
        <div className="shimmer-placeholder" style={{ height: "88px", borderRadius: "14px", marginBottom: "1rem" }} />
        <div className="shimmer-placeholder" style={{ height: "260px", borderRadius: "14px" }} />
      </div>
    );
  }

  const hasSales = kpi.totalOrders > 0;

  return (
    <section className="sf-analytics" aria-label="Seller analytics">
      <div className="sf-analytics__head">
        <div>
          <h3 className="sf-analytics__title">
            <ChartLineUp weight="duotone" size={20} style={{ color: "var(--accent-blue)" }} />
            {casualModeActive ? "Your Sales" : "Sales Analytics"}
          </h3>
          <p className="sf-analytics__sub">
            Performance for your storefront across all order types.
          </p>
        </div>
        <button
          type="button"
          className="sf-analytics__export"
          onClick={handleExportCsv}
          disabled={!hasSales}
          title={hasSales ? "Export orders as CSV" : "No orders to export yet"}
        >
          <DownloadSimple size={15} weight="bold" /> Export CSV
        </button>
      </div>

      {/* KPI tiles */}
      <div className="sf-analytics__kpis">
        <KpiTile
          icon={<CurrencyDollar weight="duotone" size={18} />}
          color="#fbbf24"
          label="Revenue"
          value={fmtUsd(kpi.revenueCents)}
        />
        <KpiTile
          icon={<Package weight="duotone" size={18} />}
          color="#38bdf8"
          label="Orders"
          value={kpi.totalOrders.toLocaleString()}
        />
        <KpiTile
          icon={<CheckCircle weight="duotone" size={18} />}
          color="#34d399"
          label="Completion"
          value={hasSales ? `${completionRate}%` : "—"}
        />
        <KpiTile
          icon={<ChartLineUp weight="duotone" size={18} />}
          color="#a78bfa"
          label="Avg Order"
          value={hasSales ? fmtUsd(kpi.avgOrderCents, 2) : "—"}
        />
        <KpiTile
          icon={<Warning weight="duotone" size={18} />}
          color={kpi.disputed > 0 ? "#f87171" : "#64748b"}
          label="Disputes"
          value={kpi.disputed.toLocaleString()}
        />
      </div>

      {!hasSales ? (
        <div className="sf-analytics__empty glass-card">
          <ChartLineUp weight="duotone" size={40} style={{ color: "var(--accent-blue)", opacity: 0.5 }} />
          <p className="sf-analytics__empty-title">No sales yet</p>
          <p className="sf-analytics__empty-text">
            Once buyers start ordering from your storefront, your revenue trends,
            fulfillment speed, and best-selling species will show up here.
          </p>
        </div>
      ) : (
        <>
          {/* Revenue over time */}
          <div className="sf-analytics__card glass-card">
            <div className="sf-analytics__card-title">Revenue Over Time</div>
            {derived.revenueSeries.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={derived.revenueSeries} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="sfRevGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#38bdf8" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#38bdf8" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: "#7d8fa3", fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fill: "#7d8fa3", fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `$${v}`}
                    width={48}
                  />
                  <Tooltip content={<RevenueTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#38bdf8"
                    strokeWidth={2}
                    fill="url(#sfRevGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="sf-analytics__muted">Completed orders will chart here.</p>
            )}
          </div>

          <div className="sf-analytics__two-col">
            {/* Order type mix */}
            <div className="sf-analytics__card glass-card">
              <div className="sf-analytics__card-title">Order Mix</div>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={derived.typeMix}
                    dataKey="value"
                    nameKey="label"
                    innerRadius={45}
                    outerRadius={72}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {derived.typeMix.map((entry) => (
                      <Cell key={entry.type} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<MixTooltip />} />
                  <Legend
                    verticalAlign="bottom"
                    height={24}
                    iconType="circle"
                    iconSize={8}
                    formatter={(value) => <span style={{ color: "#a9b7c6", fontSize: 11 }}>{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Fulfillment performance */}
            <div className="sf-analytics__card glass-card">
              <div className="sf-analytics__card-title">Fulfillment</div>
              <div className="sf-analytics__fulfill">
                <div className="sf-analytics__fulfill-row">
                  <span className="sf-analytics__fulfill-icon" style={{ color: "#38bdf8" }}>
                    <Truck weight="duotone" size={20} />
                  </span>
                  <div>
                    <div className="sf-analytics__fulfill-value">{fmtHours(kpi.avgDispatchHours)}</div>
                    <div className="sf-analytics__fulfill-label">Avg. order → dispatch</div>
                  </div>
                </div>
                <div className="sf-analytics__fulfill-row">
                  <span className="sf-analytics__fulfill-icon" style={{ color: "#34d399" }}>
                    <House weight="duotone" size={20} />
                  </span>
                  <div>
                    <div className="sf-analytics__fulfill-value">{fmtHours(kpi.avgDeliveryHours)}</div>
                    <div className="sf-analytics__fulfill-label">Avg. dispatch → arrival</div>
                  </div>
                </div>
                <div className="sf-analytics__fulfill-row">
                  <span className="sf-analytics__fulfill-icon" style={{ color: "#a78bfa" }}>
                    <Clock weight="duotone" size={20} />
                  </span>
                  <div>
                    <div className="sf-analytics__fulfill-value">
                      {kpi.avgDispatchHours > 0
                        ? kpi.avgDispatchHours <= 24
                          ? "Lightning fast"
                          : kpi.avgDispatchHours <= 48
                          ? "Quick shipper"
                          : "Steady pace"
                        : "—"}
                    </div>
                    <div className="sf-analytics__fulfill-label">Speed rating</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Top species */}
          {derived.topSpecies.length > 0 && (
            <div className="sf-analytics__card glass-card">
              <div className="sf-analytics__card-title">
                <Fish weight="duotone" size={16} style={{ color: "var(--accent-green)" }} /> Top Species by Revenue
              </div>
              <div className="sf-analytics__species">
                {derived.topSpecies.map((s) => (
                  <div key={s.name} className="sf-analytics__species-row">
                    <span className="sf-analytics__species-name" title={s.name}>{s.name}</span>
                    <div className="sf-analytics__species-bar-track">
                      <div
                        className="sf-analytics__species-bar"
                        style={{ width: `${Math.max(6, (s.revenue / maxSpeciesRevenue) * 100)}%` }}
                      />
                    </div>
                    <span className="sf-analytics__species-value">{fmtUsd(s.revenue * 100)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function KpiTile({ icon, color, label, value }) {
  return (
    <div className="sf-analytics__kpi glass-card" style={{ "--kpi-color": color }}>
      <span className="sf-analytics__kpi-icon" style={{ color }}>{icon}</span>
      <span className="sf-analytics__kpi-value">{value}</span>
      <span className="sf-analytics__kpi-label">{label}</span>
    </div>
  );
}

function RevenueTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="sf-analytics__tooltip">
      <div className="sf-analytics__tooltip-title">{d.label}</div>
      <div className="sf-analytics__tooltip-row">${d.revenue.toLocaleString()} · {d.orders} order{d.orders === 1 ? "" : "s"}</div>
    </div>
  );
}

function MixTooltip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="sf-analytics__tooltip">
      <div className="sf-analytics__tooltip-title">{d.label}</div>
      <div className="sf-analytics__tooltip-row">{d.value} order{d.value === 1 ? "" : "s"}</div>
    </div>
  );
}
