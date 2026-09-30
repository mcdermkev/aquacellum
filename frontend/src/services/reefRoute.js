/**
 * The Reef's deep links live in the query string of /app/reef, the same way
 * commerce routes keep their identity in the URL instead of in component state:
 *
 *   /app/reef?tab=feed|explore|clubs|events
 *   /app/reef?club=<slug>     opens that club's page inside The Reef
 *   /app/reef?event=<uuid>    opens that event
 *
 * Public club pages link here, so these names are a contract. Older words the
 * UI used to show ("groups", "schools", "tides") still resolve.
 */

const TAB_ALIASES = Object.freeze({
  feed: "feed",
  following: "feed",
  explore: "explore",
  discover: "explore",
  clubs: "clubs",
  groups: "clubs",
  schools: "clubs",
  events: "events",
  tides: "events",
});

export const REEF_TABS = Object.freeze(["feed", "explore", "clubs", "events"]);

const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,119}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clean(value) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

/**
 * Parse a location.search string into the Reef's view state.
 *
 * `badClub` / `badEvent` carry a value that was present but can't be a real
 * slug or id, so the page can say so instead of silently ignoring the link.
 */
export function resolveReefRoute(search = "") {
  const params = new URLSearchParams(search || "");
  const rawTab = clean(params.get("tab"));
  const rawClub = clean(params.get("club"));
  const rawEvent = clean(params.get("event"));

  const tab = rawTab ? TAB_ALIASES[rawTab.toLowerCase()] || null : null;
  const club = rawClub && SLUG_RE.test(rawClub) ? rawClub.toLowerCase() : null;
  const event = rawEvent && UUID_RE.test(rawEvent) ? rawEvent.toLowerCase() : null;

  return {
    tab,
    club,
    event,
    badClub: rawClub && !club ? rawClub : null,
    badEvent: rawEvent && !event ? rawEvent : null,
  };
}

/**
 * The query params for a Reef view. Every key is always present so callers can
 * merge this into navigateCommerce's params and clear the ones not in use.
 */
export function reefRouteParams({ tab = null, club = null, event = null } = {}) {
  return {
    tab: tab && REEF_TABS.includes(tab) ? tab : null,
    club: club || null,
    event: event || null,
  };
}
