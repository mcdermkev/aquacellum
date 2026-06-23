/**
 * StorefrontStats.jsx — Glassmorphic stats bar showing breeder metrics.
 * Displays: total sales, active listings, species count, member since.
 */
import React from "react";
import { ShoppingCart, Storefront, Fish, Calendar } from "@phosphor-icons/react";

export function StorefrontStats({ stats, memberSince }) {
  const formatDate = (dateStr) => {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  };

  const statItems = [
    {
      icon: <ShoppingCart weight="duotone" size={20} />,
      value: stats.totalSales,
      label: "Sales Completed",
      color: "var(--accent-green)",
    },
    {
      icon: <Storefront weight="duotone" size={20} />,
      value: stats.activeListings || stats.totalListings,
      label: "Active Listings",
      color: "var(--accent-blue)",
    },
    {
      icon: <Fish weight="duotone" size={20} />,
      value: stats.speciesCount,
      label: "Species Bred",
      color: "var(--accent-amber)",
    },
    {
      icon: <Calendar weight="duotone" size={20} />,
      value: formatDate(memberSince),
      label: "Member Since",
      color: "var(--text-secondary)",
      isText: true,
    },
  ];

  return (
    <section className="sf-stats" aria-label="Breeder statistics">
      {statItems.map((item, idx) => (
        <div
          key={idx}
          className="sf-stats__item glass-card"
          style={{ "--stat-color": item.color }}
        >
          <div className="sf-stats__icon" style={{ color: item.color }}>
            {item.icon}
          </div>
          <div className="sf-stats__content">
            <span className="sf-stats__value">
              {item.isText ? item.value : item.value.toLocaleString()}
            </span>
            <span className="sf-stats__label">{item.label}</span>
          </div>
        </div>
      ))}
    </section>
  );
}
