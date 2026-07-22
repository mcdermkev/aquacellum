/**
 * CartButton.jsx
 *
 * Header/nav affordance for the persistent cart (Task 10, §5). Shows the
 * live item count as a small badge and opens CartDrawer. Thin — all cart
 * state comes from useCart(); this component renders only.
 */

import React from "react";
import { ShoppingCartSimple } from "@phosphor-icons/react";
import { useCart } from "../../contexts/CartContext.jsx";

export function CartButton({ onOpen }) {
  const { totals } = useCart();

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={totals.itemCount > 0 ? `Open cart, ${totals.itemCount} item${totals.itemCount === 1 ? "" : "s"}` : "Open cart"}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: "38px",
        height: "38px",
        borderRadius: "10px",
        border: "1px solid var(--glass-border)",
        background: "rgba(255,255,255,0.02)",
        color: "var(--text-secondary)",
        cursor: "pointer",
        transition: "all 0.3s cubic-bezier(0.4,0,0.2,1)",
        flexShrink: 0,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "var(--teal-400)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-secondary)"; e.currentTarget.style.borderColor = "var(--glass-border)"; }}
    >
      <ShoppingCartSimple size={20} weight="duotone" />
      {totals.itemCount > 0 && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "-6px",
            right: "-6px",
            minWidth: "18px",
            height: "18px",
            padding: "0 4px",
            borderRadius: "9px",
            background: "linear-gradient(135deg, var(--teal-400), var(--violet-500))",
            color: "#04120f",
            fontSize: "0.62rem",
            fontWeight: 700,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 8px rgba(45, 212, 191, 0.4)",
          }}
        >
          {totals.itemCount > 99 ? "99+" : totals.itemCount}
        </span>
      )}
    </button>
  );
}
