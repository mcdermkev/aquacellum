/**
 * useAddOnRecommendations.js
 *
 * Wiring hook for the Task 11 UI (box-capacity meter + safe add-on
 * recommendation strip). Composes:
 *   - the cart (Task 10, via useCart()) for current items + single seller
 *   - useMarketplaceListings, filtered to the cart's seller, for candidates
 *   - useSpeciesData for the fishbase species lookup (enriches bare listing
 *     min/max fields via normalizeSpeciesProfile, same convention as
 *     MarketplaceBoard.jsx's fishbaseLookup)
 *   - the seller's parcel preset (services/shipping.js getSellerParcelPreset),
 *     falling back to PACKING_DEFAULTS when unavailable — never blocks the UI
 *   - addOnPresenter.js + addOnRecommender.js for the actual recommendation math
 *
 * Deterministic given its inputs; recomputes via useMemo on cart/tank/preset
 * change. No new safety/packing logic — every threshold lives in the engines
 * this hook composes (see docs/TASK_11_RECOMMENDATION_UI_SPEC.md §3 "Wiring").
 */

import { useState, useEffect, useMemo } from "react";
import { useMarketplaceListings } from "./useMarketplaceListings.js";
import { useSpeciesData } from "./useSpeciesData.js";
import { CONTRACT_ADDRESS, MARKETPLACE_ADDRESS } from "../config/appConfig.js";
import { recommendAddOns } from "../services/addOnRecommender.js";
import { normalizeParcelPreset } from "../services/packingEngine.js";
import { getSellerParcelPreset } from "../services/shipping.js";
import {
  buildCandidatesFromListings,
  buildBoxStatus,
  resolveCartItemProfile,
  presentRecommendation,
} from "../services/addOnPresenter.js";

/**
 * @param {Object} params
 * @param {Object} params.cart - the Task 10 cart (from useCart())
 * @param {{volume:number, temp:number, ph:number}|null} [params.buyerTank] - displayTank, or null
 * @returns {{
 *   boxStatus: { parcels:number, usage:Object, remaining:Object, fillPercent:number, bindingConstraint:string },
 *   recommendations: Array, // presentRecommendation output
 *   hasBuyerTank: boolean,
 *   presetLoading: boolean,
 * }}
 */
export function useAddOnRecommendations({ cart, buyerTank = null }) {
  const sellerWallet = cart?.seller || null;

  // Same query key as MarketplaceBoard/CartContext's own call — React Query
  // dedupes this to the shared cache entry rather than double-fetching.
  const { data: allListings = [] } = useMarketplaceListings(CONTRACT_ADDRESS, MARKETPLACE_ADDRESS);
  const { data: speciesData = [] } = useSpeciesData();

  const sellerListings = useMemo(() => {
    if (!sellerWallet) return [];
    return allListings.filter((l) => l.seller && l.seller.toLowerCase() === sellerWallet);
  }, [allListings, sellerWallet]);

  const speciesLookup = useMemo(() => {
    const lookup = {};
    for (const item of speciesData || []) {
      if (item.scientificName) lookup[item.scientificName.toLowerCase()] = item;
    }
    return lookup;
  }, [speciesData]);

  // Seller's parcel preset — best-effort, non-blocking. Falls back to
  // PACKING_DEFAULTS (via normalizeParcelPreset({})) immediately, then
  // upgrades to the seller's real preset once the fetch resolves.
  const [preset, setPreset] = useState(() => normalizeParcelPreset({}));
  const [presetLoading, setPresetLoading] = useState(false);

  useEffect(() => {
    if (!sellerWallet) {
      setPreset(normalizeParcelPreset({}));
      return;
    }
    let cancelled = false;
    setPresetLoading(true);
    getSellerParcelPreset(sellerWallet)
      .then((result) => {
        if (cancelled) return;
        if (result.success && result.preset) {
          setPreset(normalizeParcelPreset(result.preset));
        } else {
          setPreset(normalizeParcelPreset({}));
        }
      })
      .catch(() => {
        if (!cancelled) setPreset(normalizeParcelPreset({}));
      })
      .finally(() => {
        if (!cancelled) setPresetLoading(false);
      });
    return () => { cancelled = true; };
  }, [sellerWallet]);

  // Cart items' resolved packing profiles — feeds both the box-capacity meter
  // (via addOnPresenter.buildBoxStatus) and the ranker's cartProfiles context.
  const cartProfiles = useMemo(() => {
    const items = cart?.items?.filter((i) => !i.unavailable) || [];
    return items.map((item) =>
      resolveCartItemProfile({
        packingProfile: item.packingProfile,
        speciesProfile: item.speciesProfile,
        quantity: item.quantity,
      })
    );
  }, [cart]);

  const boxStatus = useMemo(() => buildBoxStatus(cartProfiles.map((p) => ({ packingProfile: p })), preset), [cartProfiles, preset]);

  const cartItemKeys = useMemo(
    () => new Set((cart?.items || []).map((i) => i.listingKey)),
    [cart]
  );

  const recommendations = useMemo(() => {
    if (!sellerWallet) return [];
    const candidates = buildCandidatesFromListings(sellerListings, cartItemKeys, speciesLookup);
    const ranked = recommendAddOns(candidates, {
      preset,
      cartProfiles,
      buyerTank: buyerTank || null,
    });
    const presented = presentRecommendation(ranked, candidates);
    // hasBuyerTank is per-row context for addOnCopy — the engine already
    // returns a real (if low-confidence) verdict when no tank is present
    // (evaluateTankFit's "no tank context" case), so this hook flags it
    // explicitly rather than letting the UI mistake that for a real "ok"/
    // "caution" judgment.
    return presented.map((row) => ({ ...row, hasBuyerTank: !!buyerTank }));
  }, [sellerWallet, sellerListings, cartItemKeys, speciesLookup, preset, cartProfiles, buyerTank]);

  return {
    boxStatus,
    recommendations,
    hasBuyerTank: !!buyerTank,
    presetLoading,
  };
}
