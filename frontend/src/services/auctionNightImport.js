/**
 * auctionNightImport.js — parse a club's lot list pasted from a spreadsheet.
 * Shared by the organizer console (preview) and the API (api/_lib/auctionNight.js).
 * Pure: no I/O.
 */

export const MAX_IMPORT_LOTS = 300;

function dollarsToCents(s) {
  const v = String(s ?? "").trim().replace(/^\$/, "").replace(/,/g, "");
  if (!v) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return NaN;
  return Math.round(Number(v) * 100);
}

/**
 * Parse lots pasted from a spreadsheet or typed one per line.
 *   Title <tab or |> Starting bid <tab or |> Brought by <tab or |> Club %
 * Only the title is required. A header row ("title", "lot", …) is skipped.
 *
 * @returns {{ lots: Array<{title, startingBidCents, consignorName, splitPercent}>, errors: string[] }}
 */
export function parseLotImport(text, { defaultStartingBidCents = 100 } = {}) {
  const lots = [];
  const errors = [];
  const lines = String(text ?? "").split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const cells = (line.includes("\t") ? line.split("\t") : line.split("|")).map((c) => c.trim());
    if (i === 0 && /^(lot|title|item|description)\b/i.test(cells[0]) && cells.length > 1) return;
    const [title, bid, consignor, split] = cells;
    if (!title) return;
    if (title.length > 120) { errors.push(`Line ${i + 1}: title is over 120 characters.`); return; }
    let startingBidCents = defaultStartingBidCents;
    if (bid) {
      const c = dollarsToCents(bid);
      if (!Number.isInteger(c) || c < 100) { errors.push(`Line ${i + 1}: "${bid}" isn't a starting bid of $1 or more.`); return; }
      startingBidCents = c;
    }
    let splitPercent = null;
    if (split) {
      const n = Number(String(split).replace("%", "").trim());
      if (!Number.isInteger(n) || n < 0 || n > 100) { errors.push(`Line ${i + 1}: club % must be 0–100.`); return; }
      splitPercent = n;
    }
    lots.push({ title, startingBidCents, consignorName: consignor ? consignor.slice(0, 80) : null, splitPercent });
  });
  if (lots.length > MAX_IMPORT_LOTS) {
    errors.push(`That's ${lots.length} lots; add up to ${MAX_IMPORT_LOTS} at a time.`);
    return { lots: lots.slice(0, MAX_IMPORT_LOTS), errors };
  }
  return { lots, errors };
}
