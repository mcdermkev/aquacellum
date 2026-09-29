/**
 * serviceProApi.js — client for service pros (docs/SERVICE_PROS_SPEC.md).
 *
 * Pro calls send the Privy session token; the server takes the wallet from it
 * and scopes everything to that wallet. The client history read is public
 * (by share link). Uses the token getter registered for auctionsApi.js.
 */

import { getSessionTokenForApi } from "./auctionsApi";

async function call(path, { method = "GET", body, auth = "required", fetchImpl = fetch } = {}) {
  const token = auth === "none" ? null : await getSessionTokenForApi();
  if (auth === "required" && !token) return { success: false, code: "NO_SESSION", error: "Sign in to continue." };
  let res;
  try {
    res = await fetchImpl(`/api/${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (err) {
    return { success: false, offline: true, error: err?.message || "You're offline." };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { success: false, status: res.status, code: data.code || null, error: data.error || `Request failed (${res.status})` };
  return { success: true, ...data };
}

const post = (action, body) => call(`storefront-detail?action=${action}`, { method: "POST", body });

export const getServiceHome = () => call("storefront-detail?action=service-home");
export const getServiceClient = (id) => call(`storefront-detail?action=service-client&id=${encodeURIComponent(id)}`);
export const saveClient = (fields) => post("service-client-save", fields);
export const archiveClient = (id, archived) => post("service-client-archive", { id, archived });
export const saveSite = (fields) => post("service-site-save", fields);
export const saveTank = (fields) => post("service-tank-save", fields);
export const addVisit = (fields) => post("service-visit-add", fields);
export const deleteVisit = (id) => post("service-visit-delete", { id });
export const setShare = (clientId, enabled, rotate = false) => post("service-share", { clientId, enabled, rotate });
export const getServiceHistory = (token) =>
  call(`storefront-detail?action=service-history&t=${encodeURIComponent(token)}`, { auth: "none" });

export const serviceHomePath = () => "/app/service";
export const serviceClientPath = (id) => `/app/service/${encodeURIComponent(String(id || ""))}`;

export const TASK_LABELS = Object.freeze({
  water_change: "Water change",
  glass_clean: "Glass cleaned",
  gravel_vac: "Gravel vacuumed",
  filter_clean: "Filter cleaned",
  algae_scrub: "Algae removed",
  plant_trim: "Plants trimmed",
  top_off: "Topped off",
  dose: "Dosed",
  feed: "Fed",
  equipment_check: "Equipment checked",
  livestock_check: "Livestock checked",
  other: "Other",
});

export const KIND_LABELS = Object.freeze({
  freshwater: "Freshwater",
  planted: "Planted",
  brackish: "Brackish",
  saltwater: "Saltwater",
  reef: "Reef",
  pond: "Pond",
  other: "Other",
});

export const READING_LABELS = Object.freeze([
  ["temp", "Temp"], ["ph", "pH"], ["ammonia", "Ammonia"], ["nitrite", "Nitrite"], ["nitrate", "Nitrate"],
  ["phosphate", "Phosphate"], ["gh", "GH"], ["kh", "KH"], ["salinity", "Salinity (SG)"],
]);

/** "Temp 78 °F · pH 7.2 · Nitrate 10" */
export function readingsSummary(r = {}) {
  const parts = [];
  for (const [key, label] of READING_LABELS) {
    if (r[key] == null) continue;
    parts.push(key === "temp" ? `${label} ${r.temp} °${r.tempUnit === "C" ? "C" : "F"}` : `${label} ${r[key]}`);
  }
  return parts.join(" · ");
}

/** Liters → "40 gal (151 L)" */
export function volumeLabel(liters) {
  const l = Number(liters);
  if (!(l > 0)) return "";
  return `${Math.round(l / 3.78541)} gal (${Math.round(l)} L)`;
}
