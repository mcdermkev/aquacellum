import React from "react";
import { SettingsSection } from "../SettingsSection";
import { SettingsSubsectionLabel as SubsectionLabel } from "../SettingsSubsectionLabel";

/**
 * SellerSection — Settings → Seller Hub / Breeder Store
 * (docs/SETTINGS_SPEC.md §6 #9).
 *
 * ⚠️ DEEP LINKS, NOT DUPLICATES. Storefront setup, ship-from address and payout
 * onboarding all live in `BreederTerminal`, and colocating them there is the right
 * call — they belong next to the orders they affect. The spec's requirement is that
 * Settings "should at least deep-link", not that it should host a second copy.
 * Rendering `StorefrontSetup` or payout onboarding here as well would mean two
 * places writing seller identity and payout destination, which is how a payout
 * address ends up disagreeing with itself. So this section navigates; it does not
 * own anything.
 *
 * ⚠️ VACATION / AWAY MODE IS NOT HERE, and its absence is the biggest remaining gap
 * in the seller surface. The spec calls it "non-negotiable for livestock" and it is
 * right: a breeder who cannot pause a store ships fish they cannot ship, or fails
 * an order they never wanted to take.
 *
 * It is absent because **nothing implements it** — verified: no `vacation`,
 * `away_mode`, `storefront_paused` or `accepting_orders` field exists in the schema
 * or anywhere in the codebase. A real implementation has to stop orders being
 * placed, which means a storefront flag, listing availability honouring it, and
 * checkout refusing to settle against a paused store. That is marketplace and
 * money-path work with genuine blast radius, and a toggle here that only wrote a
 * local flag would be the most dangerous kind of dead control: a seller would
 * believe their store was closed and keep receiving orders for live animals.
 *
 * Tracked in SETTINGS_SPEC.md §10. Do not add the switch before the enforcement.
 */
export function SellerSection({ casualModeActive }) {
  const goToTerminal = (section) => {
    window.dispatchEvent(
      new CustomEvent("aquadex:navigate-tab", {
        detail: { tab: "breeder-terminal", section },
      })
    );
  };

  const destinations = [
    {
      section: "store",
      label: casualModeActive ? "Store details" : "Storefront setup",
      description: casualModeActive
        ? "Your store name, bio, banner and what buyers see first."
        : "Storefront profile, merchandising and section layout.",
    },
    {
      section: "shipping",
      label: casualModeActive ? "Shipping & pickup" : "Ship-from & parcels",
      description: casualModeActive
        ? "Where you ship from, handling time, and local pickup spots."
        : "Ship-from address, parcel presets and handling windows.",
    },
    {
      section: "payouts",
      label: "Payouts",
      description: casualModeActive
        ? "How you get paid, and the status of your payout account."
        : "Payout account onboarding status and settlement records.",
    },
  ];

  return (
    <SettingsSection
      id="seller"
      icon="🧑‍🌾"
      title={{ casual: "Seller Hub", pro: "Breeder Store" }}
      description={{
        casual:
          "Your selling setup lives in the Seller Hub, next to your orders. These take you straight there.",
        pro:
          "Seller configuration is owned by the Breeder Terminal, colocated with fulfillment. These are deep links, not a second place to edit it.",
      }}
      casualModeActive={casualModeActive}
    >
      <SubsectionLabel>{casualModeActive ? "Jump to" : "Seller configuration"}</SubsectionLabel>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {destinations.map((destination) => (
          <button
            key={destination.section}
            type="button"
            onClick={() => goToTerminal(destination.section)}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              width: "100%",
              minHeight: 44,
              textAlign: "left",
              font: "inherit",
              color: "inherit",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 8,
              padding: "10px 12px",
              background: "rgba(255,255,255,0.02)",
              cursor: "pointer",
            }}
          >
            <span style={{ minWidth: 0 }}>
              <span
                style={{
                  display: "block",
                  fontSize: 13,
                  fontWeight: 600,
                  color: "var(--text-primary)",
                }}
              >
                {destination.label}
              </span>
              <span
                style={{
                  display: "block",
                  fontSize: 11,
                  color: "var(--text-muted)",
                  marginTop: 2,
                }}
              >
                {destination.description}
              </span>
            </span>
            <span aria-hidden="true" style={{ color: "var(--accent-blue)", flexShrink: 0 }}>
              →
            </span>
          </button>
        ))}
      </div>

      {/*
        Say the true thing about the gap rather than leaving sellers to discover it
        when they need it most. This is a statement of absence, not a control.
      */}
      <p
        style={{
          margin: "1.25rem 0 0",
          paddingTop: "1rem",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          fontSize: "0.75rem",
          color: "var(--text-muted)",
          lineHeight: 1.5,
        }}
      >
        <strong style={{ color: "var(--accent-amber)" }}>
          There is no vacation mode yet.
        </strong>{" "}
        {casualModeActive
          ? "If you need to stop taking orders — a trip, a heat wave, a sick tank — unlist your listings for now. A proper pause switch is coming, and we would rather say so than give you a toggle that does not actually close your store."
          : "To stop inbound orders you must currently unlist. A storefront-level pause requires enforcement at listing availability and checkout, so it is not exposed as a preference until that exists."}
      </p>
    </SettingsSection>
  );
}

export default SellerSection;
