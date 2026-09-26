const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PRODUCT_PATH_RE = /^\/app\/products\/(single|batch)-[1-9][0-9]*$/;

export function roomSlugFromPath(pathname) {
  const match = String(pathname || "").match(/^\/showcase\/([^/]+)\/?$/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function safePublicImageUrl(value, origin) {
  if (!value || !origin) return "";
  try {
    const url = new URL(value, origin);
    return url.protocol === "https:" || url.origin === origin ? url.href : "";
  } catch {
    return "";
  }
}

export function heroProxyPath(assetId) {
  return typeof assetId === "string" && UUID_RE.test(assetId)
    ? `/api/showcase-media/${encodeURIComponent(assetId)}/hero`
    : "";
}

export function canonicalProductPath(value) {
  return typeof value === "string" && PRODUCT_PATH_RE.test(value) ? value : "";
}

export function matchingStorePath(payload, roomSlug) {
  return roomSlug && payload?.breeder?.slug === roomSlug
    ? `/store/${encodeURIComponent(roomSlug)}`
    : "";
}

export function matchingShowcasePath(payload, storeSlug) {
  return storeSlug && payload?.room?.slug === storeSlug
    ? `/showcase/${encodeURIComponent(storeSlug)}`
    : "";
}
