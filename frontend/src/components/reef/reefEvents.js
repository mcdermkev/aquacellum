/**
 * Event (tide) helpers for The Reef's Events tab.
 *
 * A tide's `status` is only updated when a host presses Go Live / End, so an
 * event can still say "upcoming" days after its end time. The list sorts by the
 * clock instead: anything whose end (or start, when there is no end) has passed
 * is a past event, whatever its status says.
 */

export function eventEndMs(tide) {
  const end = Date.parse(tide?.end_time || "");
  if (Number.isFinite(end)) return end;
  const start = Date.parse(tide?.start_time || "");
  return Number.isFinite(start) ? start : NaN;
}

export function isEventOver(tide, now = Date.now()) {
  if (!tide) return true;
  if (tide.status === "ended" || tide.status === "cancelled") return true;
  const end = eventEndMs(tide);
  return Number.isFinite(end) ? end <= now : false;
}

/**
 * Merge the upcoming and past queries into two clean lists.
 * Upcoming: soonest first. Past: most recent first. Each id appears once.
 */
export function splitEvents(upcomingRows = [], pastRows = [], now = Date.now()) {
  const byId = new Map();
  for (const row of [...(upcomingRows || []), ...(pastRows || [])]) {
    if (row?.id && !byId.has(row.id)) byId.set(row.id, row);
  }
  const upcoming = [];
  const past = [];
  for (const row of byId.values()) {
    if (row.status === "cancelled") continue;
    (isEventOver(row, now) ? past : upcoming).push(row);
  }
  const start = (t) => Date.parse(t.start_time || "") || 0;
  upcoming.sort((a, b) => start(a) - start(b));
  past.sort((a, b) => start(b) - start(a));
  return { upcoming, past };
}

/** Initials for a generated club header ("Betta Keepers" -> "BK"). */
export function clubInitials(name) {
  const words = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0];
  return letters.toUpperCase();
}
