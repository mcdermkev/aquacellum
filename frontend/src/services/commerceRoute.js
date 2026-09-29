const APP_PREFIX = "/app";

const COLLECTION_ALIASES = Object.freeze({
  all: "all",
  batch: "batch",
  fry: "batch",
  frags: "frags",
  frag: "frags",
  corals: "frags",
  coral: "frags",
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
    // Public auctions (docs/AUCTIONS_SPEC.md §1). Browsing and lot pages are
    // public; "mine" needs a verified session.
    // Club auction night (docs/AUCTIONS_SPEC.md §9): a full-screen console for
    // organizers, and a public room screen for the projector and phones.
    // Rendered outside the app shell; the page handles its own sign-in.
    case "auction-night": {
      const [, , third] = segments;
      if (!rawIdentity) return { kind: "auction-night-home", tab: "auctions", bypassLanding: true, fullScreen: true };
      const auctionId = decodeSegment(rawIdentity);
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(auctionId || "");
      if (!isUuid || segments.length > 3 || (third && third !== "room")) {
        return { kind: "not-found", tab: "auctions", requestedPath: normalized, bypassLanding: true };
      }
      return {
        kind: third === "room" ? "auction-night-room" : "auction-night-console",
        tab: "auctions",
        auctionId,
        bypassLanding: true,
        fullScreen: true,
      };
    }
    // Service pros (docs/SERVICE_PROS_SPEC.md): a full-screen tool for people
    // who maintain tanks for clients, plus the client's read-only history link.
    case "service": {
      const [, , third] = segments;
      if (!rawIdentity) return { kind: "service-home", tab: "directory", bypassLanding: true, fullScreen: true };
      if (rawIdentity === "view") {
        const shareToken = decodeSegment(third);
        if (segments.length !== 3 || !/^[A-Za-z0-9_-]{32}$/.test(shareToken || "")) {
          return { kind: "not-found", tab: "directory", requestedPath: normalized, bypassLanding: true };
        }
        return { kind: "service-history", tab: "directory", shareToken, bypassLanding: true, fullScreen: true };
      }
      const clientId = decodeSegment(rawIdentity);
      if (segments.length !== 2 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId || "")) {
        return { kind: "not-found", tab: "directory", requestedPath: normalized, bypassLanding: true };
      }
      return { kind: "service-client", tab: "directory", clientId, bypassLanding: true, fullScreen: true };
    }
    case "auctions": {
      if (segments.length > 2) {
        return { kind: "not-found", tab: "directory", requestedPath: normalized, bypassLanding: true };
      }
      if (!rawIdentity) return { kind: "auctions", tab: "auctions", bypassLanding: true };
      if (rawIdentity === "mine") {
        return { kind: "auctions-mine", tab: "auctions", bypassLanding: true, requiresAuth: true, requiresVerifiedSession: true };
      }
      const lotId = decodeSegment(rawIdentity);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lotId || "")) {
        return { kind: "not-found", tab: "auctions", requestedPath: normalized, bypassLanding: true };
      }
      return { kind: "auction-lot", tab: "auctions", lotId, bypassLanding: true };
    }
    default:
      if (!head || validDashboardTabs.includes(head)) return null;
      return { kind: "not-found", tab: "directory", requestedPath: normalized, bypassLanding: true };
  }
}

export function canonicalProductPath(listingKey) {
  return `/app/products/${encodeURIComponent(String(listingKey || ""))}`;
}
