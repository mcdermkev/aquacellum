/**
 * FoundersDashboard.jsx
 *
 * Internal analytics dashboard for Aquadex founders.
 * Displays KPI metrics, growth charts, protocol activity,
 * social engagement, AI usage, and operational health.
 *
 * Gated by wallet allowlist — only founder addresses can see this tab.
 */

import React, { useState, useEffect, useCallback } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { fetchAllDashboardData } from "../services/foundersAnalytics";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL_MS = 60_000; // Auto-refresh every 60s

const CHART_COLORS = {
  blue: "#38bdf8",
  green: "#34d399",
  purple: "#a78bfa",
  amber: "#fbbf24",
  red: "#f87171",
  cyan: "#22d3ee",
};

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export function FoundersDashboard({ casualModeActive }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [timeRange, setTimeRange] = useState("30d");

  const fetchData = useCallback(async () => {
    try {
      const result = await fetchAllDashboardData();
      setData(result);
      setLastRefresh(new Date());
    } catch (e) {
      console.error("[FoundersDashboard] Failed to fetch data:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) {
    return (
      <div style={styles.loadingContainer}>
        <div style={styles.loadingSpinner} />
        <p style={{ color: "var(--text-secondary)", marginTop: "1rem" }}>
          Loading dashboard metrics...
        </p>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={styles.loadingContainer}>
        <p style={{ color: "var(--text-secondary)" }}>
          Unable to load dashboard data. Check your connection.
        </p>
        <button onClick={fetchData} className="btn-secondary" style={{ marginTop: "1rem" }}>
          Retry
        </button>
      </div>
    );
  }

  const { kpis, charts, social, trends, health } = data;

  /**
   * Trend props for a card, or nothing at all.
   *
   * `undefined` rather than `null` when unmeasurable, so `KPICard` renders no arrow
   * instead of an empty one. Only three KPIs get a trend — see `getKpiTrends` for why
   * the other three deliberately do not (§9.24).
   */
  const trendFor = (key) => {
    const t = trends?.[key];
    if (!t) return {};
    return {
      trend: `${t.changePercent >= 0 ? "+" : ""}${t.changePercent}%`,
      trendUp: t.up,
    };
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.title}>
            <span style={styles.titleIcon}>📊</span>
            Founders Dashboard
          </h1>
          <span style={styles.badge}>Internal</span>
        </div>
        <div style={styles.headerRight}>
          {lastRefresh && (
            <span style={styles.refreshTime}>
              Last updated: {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button onClick={fetchData} className="btn-secondary" style={styles.refreshBtn}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div style={styles.kpiStrip}>
        {/* THREE cards carry a trend, not six (§9.24). The two that used to carry
            one had a hardcoded "+18%" / "+15%" computed from nothing; §9.22 removed
            those. These are real prior-period comparisons, and each is absent rather
            than zero when it cannot be measured.

            The other three are trend-free on purpose: Specimens Minted is a
            cumulative counter (its rate of change answers nothing GMV doesn't),
            Protocol Fees is a fixed fraction of GMV (trending both prints the same
            number twice), and Live Activity is a point-in-time gauge with no
            meaningful prior period. See getKpiTrends. */}
        <KPICard
          label="Total Users"
          value={formatNumber(kpis.totalUsers)}
          subtitle={trends?.newUsers ? `new signups vs prior ${trends.windowDays}d` : undefined}
          icon="👥"
          {...trendFor("newUsers")}
        />
        <KPICard
          label="DAU"
          value={formatNumber(kpis.dau)}
          subtitle={trends?.dau ? `today · active vs prior ${trends.windowDays}d` : "today"}
          icon="📈"
          {...trendFor("dau")}
        />
        <KPICard
          label="Specimens Minted"
          value={formatNumber(kpis.totalSpecimens)}
          icon="🐠"
        />
        <KPICard
          label="Protocol Fees"
          value={formatCurrency(kpis.protocolFees)}
          subtitle="cumulative"
          icon="💰"
        />
        <KPICard
          label="Marketplace GMV"
          value={formatCurrency(kpis.marketplaceGMV)}
          subtitle={trends?.marketplaceGMV ? `settled · vs prior ${trends.windowDays}d` : "settled orders"}
          icon="🏪"
          {...trendFor("marketplaceGMV")}
        />
        <KPICard
          label="Live Activity"
          value={formatNumber(kpis.liveActivity)}
          subtitle="cams + tides"
          icon="🔴"
        />
      </div>

      {/* Charts Row */}
      <div className="founders-charts-row" style={styles.chartsRow}>
        {/* User Growth Chart */}
        <div className="glass-card" style={styles.chartCard}>
          <div style={styles.chartHeader}>
            <h3 style={styles.chartTitle}>User Growth</h3>
            <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
          </div>
          <div style={styles.chartBody}>
            {!charts.userGrowth ? (
              <NoDataPanel detail="Couldn't read sign-up history. Previously this drew a random walk." />
            ) : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={charts.userGrowth} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="userGrowthGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={CHART_COLORS.blue} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={CHART_COLORS.blue} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="date"
                  stroke="var(--text-muted)"
                  fontSize={11}
                  tickFormatter={(d) => formatDateLabel(d)}
                />
                <YAxis stroke="var(--text-muted)" fontSize={11} />
                <Tooltip content={<CustomTooltip />} />
                <Area
                  type="monotone"
                  dataKey="users"
                  stroke={CHART_COLORS.blue}
                  strokeWidth={2}
                  fill="url(#userGrowthGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Protocol Activity Chart */}
        <div className="glass-card" style={styles.chartCard}>
          <div style={styles.chartHeader}>
            <h3 style={styles.chartTitle}>Protocol Activity</h3>
            <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
          </div>
          <div style={styles.chartBody}>
            {!charts.protocolActivity ? (
              <NoDataPanel detail="Couldn't read registration, spawn, or order history. Previously this drew random bars." />
            ) : charts.protocolActivity.length === 0 ? (
              <NoDataPanel label="No activity in this window" detail="This is a real reading, not a missing one." />
            ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={charts.protocolActivity} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="week"
                  stroke="var(--text-muted)"
                  fontSize={11}
                  tickFormatter={(d) => formatDateLabel(d)}
                />
                <YAxis stroke="var(--text-muted)" fontSize={11} />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  wrapperStyle={{ fontSize: "12px", color: "var(--text-secondary)" }}
                />
                <Bar dataKey="specimens" fill={CHART_COLORS.blue} radius={[4, 4, 0, 0]} />
                <Bar dataKey="spawns" fill={CHART_COLORS.green} radius={[4, 4, 0, 0]} />
                <Bar dataKey="userOps" fill={CHART_COLORS.purple} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Row — Social, AI, Health */}
      <div style={styles.bottomRow}>
        {/* Social Engagement */}
        <div className="glass-card" style={styles.bottomCard}>
          <h3 style={styles.chartTitle}>Social Engagement</h3>
          <div style={styles.socialGrid}>
            <SocialMetric icon="📝" label="Posts" value={formatNumber(social.posts)} />
            <SocialMetric icon="⭐" label="Reactions" value={formatNumber(social.reactions)} />
            <SocialMetric icon="💬" label="Comments" value={formatNumber(social.comments)} />
            <SocialMetric icon="🌊" label="Active (7d)" value={formatNumber(social.activeUsers)} />
          </div>
        </div>

        {/* The "AI Poseidon Queries" panel was HERE and is gone (§9.23, decided
            2026-07-31). It had no source — no `poseidon_queries` table, and
            `api/ai.js` logs no intents — so after §9.22 stripped its invented
            42/67/23/31 breakdown it read "not tracked" permanently.
            Removed rather than instrumented: the four intent buckets it wanted do
            not exist anywhere, so instrumenting meant building a classifier first,
            and it would log what users ask about their animals. A panel that says
            "not tracked" forever is clutter, not honesty. See getPoseidonStats's
            replacement note in services/foundersAnalytics.js. */}

        {/* Operational Health */}
        <div className="glass-card" style={styles.bottomCard}>
          <h3 style={styles.chartTitle}>Operational Health</h3>
          <div style={styles.healthGrid}>
            {health.map((service) => (
              <HealthIndicator key={service.name} name={service.name} status={service.status} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────────────────────

function KPICard({ label, value, subtitle, trend, trendUp, icon }) {
  return (
    <div className="glass-card" style={styles.kpiCard}>
      <div style={styles.kpiTop}>
        <span style={styles.kpiIcon}>{icon}</span>
        <span style={styles.kpiLabel}>{label}</span>
      </div>
      <div style={styles.kpiValue}>{value}</div>
      <div style={styles.kpiBottom}>
        {trend && (
          <span style={{ ...styles.kpiTrend, color: trendUp ? "var(--accent-green)" : "var(--accent-red)" }}>
            {trendUp ? "↑" : "↓"} {trend}
          </span>
        )}
        {subtitle && <span style={styles.kpiSubtitle}>{subtitle}</span>}
      </div>
    </div>
  );
}

function TimeRangeSelector({ value, onChange }) {
  return (
    <div style={styles.timeRange}>
      {["7d", "30d", "90d"].map((range) => (
        <button
          key={range}
          onClick={() => onChange(range)}
          style={{
            ...styles.timeRangeBtn,
            ...(value === range ? styles.timeRangeBtnActive : {}),
          }}
        >
          {range === "7d" ? "7 Days" : range === "30d" ? "30 Days" : "90 Days"}
        </button>
      ))}
    </div>
  );
}

function SocialMetric({ icon, label, value }) {
  return (
    <div style={styles.socialMetric}>
      <span style={styles.socialIcon}>{icon}</span>
      <div>
        <div style={styles.socialValue}>{value}</div>
        <div style={styles.socialLabel}>{label}</div>
      </div>
    </div>
  );
}

function HealthIndicator({ name, status }) {
  const statusColors = {
    healthy: "var(--accent-green)",
    degraded: "var(--accent-amber)",
    down: "var(--accent-red)",
  };
  const statusIcons = {
    healthy: "✓",
    degraded: "⚠",
    down: "✕",
  };

  return (
    <div style={styles.healthItem}>
      <span
        style={{
          ...styles.healthDot,
          backgroundColor: statusColors[status],
          boxShadow: `0 0 8px ${statusColors[status]}`,
        }}
      >
        {statusIcons[status]}
      </span>
      <span style={styles.healthName}>{name}</span>
    </div>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div style={styles.tooltip}>
      <p style={styles.tooltipLabel}>{label}</p>
      {payload.map((entry, i) => (
        <p key={i} style={{ ...styles.tooltipValue, color: entry.color }}>
          {entry.name}: {formatNumber(entry.value)}
        </p>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMATTERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shown where a metric has no readable source.
 *
 * Exists so the dashboard can say "we don't know" — which the previous version
 * could not do. Every gap was filled with a zero or a random number, so an
 * unreadable table and a genuinely quiet week looked identical. See §9.22.
 */
function NoDataPanel({ height = 240, label = "No data", detail }) {
  return (
    <div
      style={{
        height,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.35rem",
        textAlign: "center",
        padding: "0 1.25rem",
      }}
    >
      <span style={{ fontSize: "1.4rem", opacity: 0.5 }}>—</span>
      <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-secondary)" }}>
        {label}
      </span>
      {detail && (
        <span style={{ fontSize: "0.72rem", color: "var(--text-muted)", lineHeight: 1.5, maxWidth: "260px" }}>
          {detail}
        </span>
      )}
    </div>
  );
}

function formatNumber(n) {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function formatCurrency(n) {
  // "—", not "$0". A figure we couldn't read must not render as a figure of zero
  // — on a revenue KPI those mean opposite things. See §9.22.
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

function formatDateLabel(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLES
// ─────────────────────────────────────────────────────────────────────────────

const styles = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: "1.5rem",
    maxWidth: "1200px",
    margin: "0 auto",
    padding: "0.5rem 0",
  },
  loadingContainer: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "400px",
  },
  loadingSpinner: {
    width: "40px",
    height: "40px",
    border: "3px solid rgba(255,255,255,0.1)",
    borderTopColor: "var(--accent-blue)",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: "1rem",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
  },
  title: {
    fontSize: "1.5rem",
    fontWeight: 700,
    color: "var(--text-primary)",
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  titleIcon: {
    fontSize: "1.4rem",
  },
  badge: {
    fontSize: "0.65rem",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    color: "var(--accent-amber)",
    background: "var(--accent-amber-glow)",
    padding: "0.2rem 0.6rem",
    borderRadius: "999px",
    border: "1px solid rgba(251, 191, 36, 0.3)",
  },
  refreshTime: {
    fontSize: "0.75rem",
    color: "var(--text-muted)",
  },
  refreshBtn: {
    fontSize: "0.8rem",
    padding: "0.4rem 0.8rem",
  },

  // KPI Strip
  kpiStrip: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
    gap: "0.75rem",
  },
  kpiCard: {
    padding: "1rem 1.25rem",
    display: "flex",
    flexDirection: "column",
    gap: "0.4rem",
  },
  kpiTop: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
  },
  kpiIcon: {
    fontSize: "1rem",
  },
  kpiLabel: {
    fontSize: "0.72rem",
    fontWeight: 500,
    color: "var(--text-secondary)",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  },
  kpiValue: {
    fontSize: "1.75rem",
    fontWeight: 700,
    fontFamily: "'Outfit', sans-serif",
    color: "var(--text-primary)",
    lineHeight: 1.1,
  },
  kpiBottom: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  kpiTrend: {
    fontSize: "0.75rem",
    fontWeight: 600,
  },
  kpiSubtitle: {
    fontSize: "0.72rem",
    color: "var(--text-muted)",
  },

  // Charts
  chartsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))",
    gap: "1rem",
  },
  chartCard: {
    padding: "1.25rem",
  },
  chartHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "1rem",
  },
  chartTitle: {
    fontSize: "0.95rem",
    fontWeight: 600,
    color: "var(--text-primary)",
  },
  chartBody: {
    width: "100%",
  },

  // Time Range
  timeRange: {
    display: "flex",
    gap: "0.25rem",
    background: "rgba(255,255,255,0.03)",
    borderRadius: "6px",
    padding: "0.2rem",
  },
  timeRangeBtn: {
    fontSize: "0.7rem",
    padding: "0.3rem 0.6rem",
    border: "none",
    borderRadius: "4px",
    background: "transparent",
    color: "var(--text-muted)",
    cursor: "pointer",
    fontWeight: 500,
    transition: "all 0.2s ease",
  },
  timeRangeBtnActive: {
    background: "rgba(56, 189, 248, 0.15)",
    color: "var(--accent-blue)",
  },

  // Bottom Row
  bottomRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
    gap: "1rem",
  },
  bottomCard: {
    padding: "1.25rem",
  },

  // Social
  socialGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "1rem",
    marginTop: "1rem",
  },
  socialMetric: {
    display: "flex",
    alignItems: "center",
    gap: "0.6rem",
  },
  socialIcon: {
    fontSize: "1.3rem",
  },
  socialValue: {
    fontSize: "1.1rem",
    fontWeight: 700,
    color: "var(--text-primary)",
    fontFamily: "'Outfit', sans-serif",
  },
  socialLabel: {
    fontSize: "0.7rem",
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
  },

  // Health
  healthGrid: {
    display: "flex",
    flexDirection: "column",
    gap: "0.75rem",
    marginTop: "1rem",
  },
  healthItem: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
  },
  healthDot: {
    width: "24px",
    height: "24px",
    borderRadius: "6px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.7rem",
    fontWeight: 700,
    color: "#fff",
  },
  healthName: {
    fontSize: "0.85rem",
    color: "var(--text-secondary)",
    fontWeight: 500,
  },

  // Tooltip
  tooltip: {
    background: "var(--bg-secondary)",
    border: "1px solid var(--glass-border)",
    borderRadius: "8px",
    padding: "0.75rem",
    boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
  },
  tooltipLabel: {
    fontSize: "0.75rem",
    color: "var(--text-muted)",
    marginBottom: "0.3rem",
  },
  tooltipValue: {
    fontSize: "0.8rem",
    fontWeight: 600,
  },
};
