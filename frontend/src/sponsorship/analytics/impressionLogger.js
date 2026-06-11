/**
 * Sponsorship Analytics — Impression & Click Logger
 * 
 * Handles batch persistence and export of sponsor engagement metrics.
 * Data is stored locally and can be batch-uploaded to Supabase or BigQuery
 * when the analytics pipeline is activated.
 * 
 * Metrics tracked:
 *   - Impressions (views) per sponsor per surface
 *   - Clicks per sponsor per surface
 *   - Campaign completions
 *   - Time-on-screen (future: IntersectionObserver)
 */

const STORAGE_KEY = "aquadex_sponsor_impressions";
const MAX_LOCAL_EVENTS = 5000; // Prevent localStorage bloat

/**
 * Get all stored impression events
 */
export function getStoredImpressions() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

/**
 * Append an impression event to local storage
 */
export function appendImpression(event) {
  try {
    const events = getStoredImpressions();
    events.push({
      ...event,
      timestamp: event.timestamp || Date.now()
    });

    // Trim old events if exceeding max
    const trimmed = events.length > MAX_LOCAL_EVENTS
      ? events.slice(events.length - MAX_LOCAL_EVENTS)
      : events;

    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch (e) {
    console.warn("Failed to append sponsor impression:", e);
  }
}

/**
 * Generate a summary report of sponsor engagement
 */
export function generateReport(options = {}) {
  const { sponsorId, surface, startDate, endDate } = options;
  const events = getStoredImpressions();

  const filtered = events.filter(e => {
    if (sponsorId && e.sponsorId !== sponsorId) return false;
    if (surface && e.surface !== surface) return false;
    if (startDate && e.timestamp < startDate) return false;
    if (endDate && e.timestamp > endDate) return false;
    return true;
  });

  // Aggregate
  const views = filtered.filter(e => e.action === "view").length;
  const clicks = filtered.filter(e => e.action === "click").length;
  const campaignCompletes = filtered.filter(e => e.action === "campaign_complete").length;
  const ctr = views > 0 ? ((clicks / views) * 100).toFixed(2) : "0.00";

  // Breakdown by surface
  const bySurface = {};
  filtered.forEach(e => {
    if (!bySurface[e.surface]) {
      bySurface[e.surface] = { views: 0, clicks: 0 };
    }
    if (e.action === "view") bySurface[e.surface].views++;
    if (e.action === "click") bySurface[e.surface].clicks++;
  });

  // Breakdown by sponsor
  const bySponsor = {};
  filtered.forEach(e => {
    if (!bySponsor[e.sponsorId]) {
      bySponsor[e.sponsorId] = { views: 0, clicks: 0 };
    }
    if (e.action === "view") bySponsor[e.sponsorId].views++;
    if (e.action === "click") bySponsor[e.sponsorId].clicks++;
  });

  return {
    totalEvents: filtered.length,
    views,
    clicks,
    ctr: `${ctr}%`,
    campaignCompletes,
    bySurface,
    bySponsor,
    dateRange: {
      start: filtered.length > 0 ? new Date(filtered[0].timestamp).toISOString() : null,
      end: filtered.length > 0 ? new Date(filtered[filtered.length - 1].timestamp).toISOString() : null
    }
  };
}

/**
 * Export raw events as JSON (for batch upload to Supabase/BigQuery)
 */
export function exportForUpload() {
  const events = getStoredImpressions();
  return {
    exportedAt: new Date().toISOString(),
    eventCount: events.length,
    events
  };
}

/**
 * Clear all stored impressions (after successful upload)
 */
export function clearStoredImpressions() {
  localStorage.removeItem(STORAGE_KEY);
}
