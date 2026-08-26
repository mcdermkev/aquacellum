export const REEF_TRUST_MAX_AGE_MS = 5 * 60 * 1000;

/** Canonical message signed by the connected wallet for Reef trust requests. */
export function buildReefTrustMessage({ action, method, timestamp, body }) {
  return [
    "Aquacellum Reef Trust",
    `Action: ${String(action || "").toLowerCase()}`,
    `Method: ${String(method || "GET").toUpperCase()}`,
    `Timestamp: ${String(timestamp)}`,
    `Body: ${JSON.stringify(body ?? null)}`,
  ].join("\n");
}
