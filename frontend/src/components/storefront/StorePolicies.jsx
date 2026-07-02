/**
 * StorePolicies.jsx — Public "Store Policies" section on a breeder storefront.
 *
 * Renders the seller-defined shipping, dead-on-arrival (DOA), and in-person
 * handshake policies. Only shows the policies the breeder has actually filled
 * in; renders nothing at all if none are set.
 */
import React from "react";
import { Truck, FirstAid, Handshake } from "@phosphor-icons/react";

const POLICY_ITEMS = [
  {
    key: "shipping",
    label: "Shipping",
    icon: <Truck weight="duotone" size={20} />,
    color: "var(--accent-blue)",
  },
  {
    key: "doa",
    label: "Dead-on-Arrival Guarantee",
    icon: <FirstAid weight="duotone" size={20} />,
    color: "#f87171",
  },
  {
    key: "handshake",
    label: "In-Person Pickup",
    icon: <Handshake weight="duotone" size={20} />,
    color: "var(--accent-green)",
  },
];

export function StorePolicies({ policies }) {
  if (!policies) return null;

  const present = POLICY_ITEMS.filter((item) => {
    const val = policies[item.key];
    return typeof val === "string" && val.trim().length > 0;
  });

  if (present.length === 0) return null;

  return (
    <section className="sf-policies" aria-label="Store policies">
      <h2 className="sf-section-title">Store Policies</h2>
      <div className="sf-policies__grid">
        {present.map((item) => (
          <article key={item.key} className="sf-policies__card glass-card" style={{ "--policy-color": item.color }}>
            <div className="sf-policies__card-head">
              <span className="sf-policies__icon" style={{ color: item.color }}>
                {item.icon}
              </span>
              <h3 className="sf-policies__label">{item.label}</h3>
            </div>
            <p className="sf-policies__text">{policies[item.key]}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
