import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import sponsorsConfig from "./config/sponsors.json";
import productMapConfig from "./config/productMap.json";
import campaignsConfig from "./config/campaigns.json";

/**
 * SponsorContext
 * 
 * Provides sponsor data, product recommendations, and active campaigns
 * to the entire app. When no sponsors are configured, all hooks return null
 * and no UI renders — zero visual cost until a deal is signed.
 */

const SponsorContext = createContext(null);

export function SponsorProvider({ children }) {
  const [sponsors, setSponsors] = useState(sponsorsConfig.sponsors || []);
  const [productMap, setProductMap] = useState(productMapConfig || {});
  const [campaigns, setCampaigns] = useState(campaignsConfig.campaigns || []);
  const [impressions, setImpressions] = useState([]);

  // Filter to only active sponsors
  const activeSponsors = sponsors.filter(s => s.active);

  // Filter to only active campaigns within their time window
  const activeCampaigns = campaigns.filter(c => {
    if (!c.active) return false;
    const now = new Date();
    if (c.startDate && new Date(c.startDate) > now) return false;
    if (c.endDate && new Date(c.endDate) < now) return false;
    return true;
  });

  /**
   * Resolve a sponsor slot for a given surface and context.
   * Returns the sponsor + product data or null if nothing is configured.
   */
  const resolveSponsorSlot = useCallback((surface, context = {}) => {
    // No sponsors configured — fast exit
    if (activeSponsors.length === 0) return null;

    const { species, speciesGroup, actionType } = context;

    // Check product map for this surface
    const surfaceMap = productMap[surface];
    if (!surfaceMap) return null;

    // Try specific species group first, then wildcard
    const groupKey = speciesGroup || "*";
    const entry = surfaceMap[groupKey] || surfaceMap["*"];
    if (!entry) return null;

    // Verify the referenced sponsor is still active
    const sponsor = activeSponsors.find(s => s.id === entry.sponsorId);
    if (!sponsor) return null;

    return {
      sponsor,
      product: entry.product,
      productLink: entry.productLink,
      tagline: entry.tagline,
      surface,
      context
    };
  }, [activeSponsors, productMap]);

  /**
   * Get active campaign for a given surface
   */
  const getActiveCampaign = useCallback((surface) => {
    return activeCampaigns.find(c => c.surface === surface) || null;
  }, [activeCampaigns]);

  /**
   * Log an impression event for analytics
   */
  const logImpression = useCallback((sponsorId, surface, action = "view") => {
    const event = {
      sponsorId,
      surface,
      action,
      timestamp: Date.now()
    };
    setImpressions(prev => [...prev, event]);

    // Persist to localStorage for batch upload later
    try {
      const existing = JSON.parse(localStorage.getItem("aquadex_sponsor_impressions") || "[]");
      existing.push(event);
      localStorage.setItem("aquadex_sponsor_impressions", JSON.stringify(existing));
    } catch (e) {
      console.warn("Failed to persist sponsor impression:", e);
    }
  }, []);

  /**
   * Get impression count for reporting
   */
  const getImpressionCount = useCallback((sponsorId, surface) => {
    try {
      const stored = JSON.parse(localStorage.getItem("aquadex_sponsor_impressions") || "[]");
      return stored.filter(i => 
        (!sponsorId || i.sponsorId === sponsorId) &&
        (!surface || i.surface === surface)
      ).length;
    } catch {
      return 0;
    }
  }, []);

  const value = {
    sponsors: activeSponsors,
    campaigns: activeCampaigns,
    productMap,
    resolveSponsorSlot,
    getActiveCampaign,
    logImpression,
    getImpressionCount,
    hasSponsorships: activeSponsors.length > 0
  };

  return (
    <SponsorContext.Provider value={value}>
      {children}
    </SponsorContext.Provider>
  );
}

export function useSponsorContext() {
  const ctx = useContext(SponsorContext);
  if (!ctx) {
    // Graceful fallback if used outside provider — returns safe no-op values
    return {
      sponsors: [],
      campaigns: [],
      productMap: {},
      resolveSponsorSlot: () => null,
      getActiveCampaign: () => null,
      logImpression: () => {},
      getImpressionCount: () => 0,
      hasSponsorships: false
    };
  }
  return ctx;
}
