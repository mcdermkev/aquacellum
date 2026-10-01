import React from "react";
import { CaretRight, Storefront } from "@phosphor-icons/react";
import { SettingsSection } from "../SettingsSection";
import { SettingsSubsectionLabel as SubsectionLabel } from "../SettingsSubsectionLabel";
import { VacationModeControl } from "../VacationModeControl";

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
 * ⚠️ VACATION MODE IS ENFORCED, NOT JUST STORED. `VacationModeControl` writes
 * `breeder_profiles.vacation_until`, and `services/cartRevalidation.js` reads the
 * resulting paused-seller set to mark those items unavailable — excluding them from
 * cart totals and from checkout.
 *
 * That ordering is the whole point. A "pause my store" switch that writes a flag
 * nothing honours is the most dangerous dead control in this app: the breeder
 * believes the store is closed while orders for live animals keep arriving. The
 * control was deliberately withheld until the enforcement existed. **If the cart
 * wiring is ever removed, remove the control with it.**
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
      icon={<Storefront size={20} />}
      title={{ casual: "Seller Hub", pro: "Breeder Store" }}
      description={{
        casual:
          "Your selling setup lives in the Seller Hub, next to your orders. These take you straight there.",
        pro:
          "Store settings live in the Breeder Terminal, next to your orders. These links open them there.",
      }}
      casualModeActive={casualModeActive}
    >
      <SubsectionLabel>{casualModeActive ? "Jump to" : "Seller configuration"}</SubsectionLabel>

      <div className="st-link-cards">
        {destinations.map((destination) => (
          <button
            key={destination.section}
            type="button"
            onClick={() => goToTerminal(destination.section)}
            className="st-link-card"
          >
            <span className="st-link-card-text">
              <span className="st-link-card-title">{destination.label}</span>
              <span className="st-link-card-desc">{destination.description}</span>
            </span>
            <CaretRight className="st-link-card-caret" size={18} weight="bold" aria-hidden="true" />
          </button>
        ))}
      </div>

      <div className="st-divider">
        <SubsectionLabel>{casualModeActive ? "Away mode" : "Vacation mode"}</SubsectionLabel>
        <VacationModeControl casualModeActive={casualModeActive} />
      </div>
    </SettingsSection>
  );
}

export default SellerSection;
