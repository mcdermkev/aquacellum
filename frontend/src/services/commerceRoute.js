const APP_PREFIX = "/app";

const COLLECTION_ALIASES = Object.freeze({
  all: "all",
  batch: "batch",
  fry: "batch",
  shipped: "shipped",
  ships: "shipped",
  shipping: "shipped",
  local: "local",
  pickup: "local",
});

function decodeSegment(value) {
  if (!value) return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Resolve first-class commerce paths without making them ordinary dashboard
 * tabs. The returned tab identifies the existing presentation owner; kind and
 * route data preserve the canonical commerce identity.
 */
export function resolveCommerceRoute(pathname = "", validDashboardTabs = []) {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized !== APP_PREFIX && !normalized.startsWith(`${APP_PREFIX}/`)) return null;

  const segments = normalized.slice(APP_PREFIX.length).split("/").filter(Boolean);
  const [head, rawIdentity] = segments;
  const leafCommerceHeads = new Set([
    "directory",
    "marketplace",
    "cart",
    "checkout",
    "orders",
    "saved",
    "wanted",
    "messages",
    "breeder-terminal",
  ]);
  if (leafCommerceHeads.has(head) && segments.length > 1) {
    return { kind: "not-found", tab: "directory", requestedPath: normalized, bypassLanding: true };
  }

  switch (head) {
    case "directory":
      return { kind: "directory", tab: "directory", bypassLanding: true };
    case "marketplace":
      return {
        kind: "directory",
        tab: "directory",
        bypassLanding: true,
        redirectTo: "/app/directory",
      };
    case "collections": {
      const requestedCollection = String(rawIdentity || "all").toLowerCase();
      const collection = COLLECTION_ALIASES[requestedCollection];
      if (!collection || segments.length > 2) {
        return { kind: "not-found", tab: "directory", requestedPath: normalized, bypassLanding: true };
      }
      return {
        kind: "collection",
        tab: "directory",
        collection,
        requestedCollection: decodeSegment(rawIdentity) || "all",
        bypassLanding: true,
      };
    }
    case "products": {
      const listingKey = decodeSegment(rawIdentity);
      if (!/^(single|batch)-[^/]+$/.test(listingKey || "") || segments.length > 2) {
        return { kind: "not-found", tab: "directory", requestedPath: normalized, bypassLanding: true };
      }
      return {
        kind: "product",
        tab: "directory",
        listingKey,
        bypassLanding: true,
      };
    }
    case "store": {
      const slug = decodeSegment(rawIdentity);
      if (!slug || segments.length > 2) {
        return { kind: "not-found", tab: "directory", requestedPath: normalized, bypassLanding: true };
      }
      return {
        kind: "store",
        tab: "directory",
        slug,
        bypassLanding: true,
      };
    }
    case "cart":
      return { kind: "cart", tab: "directory", bypassLanding: true };
    case "checkout":
      return {
        kind: "checkout",
        tab: "orders",
        bypassLanding: true,
        requiresAuth: true,
        requiresVerifiedSession: true,
      };
    case "orders":
      return { kind: "orders", tab: "orders", bypassLanding: true, requiresAuth: true };
    case "saved":
      return { kind: "saved", tab: "directory", bypassLanding: true };
    case "wanted":
      return { kind: "wanted", tab: "directory", bypassLanding: true };
    case "messages":
      return {
        kind: "messages",
        tab: "reef",
        bypassLanding: true,
        requiresAuth: true,
        requiresVerifiedSession: true,
      };
    case "breeder-terminal":
      return {
        kind: "breeder-terminal",
        tab: "breeder-terminal",
        bypassLanding: true,
        requiresAuth: true,
        requiresVerifiedSession: true,
      };
    default:
      if (!head || validDashboardTabs.includes(head)) return null;
      return { kind: "not-found", tab: "directory", requestedPath: normalized, bypassLanding: true };
  }
}

export function canonicalProductPath(listingKey) {
  return `/app/products/${encodeURIComponent(String(listingKey || ""))}`;
}
