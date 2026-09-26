// Fish Room R1.3B — typed entity IDs and opaque cursors.
//
// Entity IDs are the only entity identifiers that cross the wire: `tank_<uuid>` and `spec_<uuid>`
// with a canonical lowercase UUID. Raw UUIDs never appear in a request or response body. Cursors are
// opaque base64url tokens that decode only to a canonical UUID sort key (plus a kind for the mixed
// "available entities" collection); a raw UUID supplied as a cursor is rejected.

const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isCanonicalUuid(value) {
  return typeof value === "string" && CANONICAL_UUID.test(value);
}

export function encodeTankId(uuid) {
  return "tank_" + uuid;
}

export function encodeSpecimenId(uuid) {
  return "spec_" + uuid;
}

export function encodeVideoId(uuid) {
  return "video_" + uuid;
}

export function decodeVideoId(value) {
  if (typeof value !== "string" || !value.startsWith("video_")) return null;
  const uuid = value.slice(6);
  return isCanonicalUuid(uuid) ? uuid : null;
}

export function encodeEntityId(kind, uuid) {
  return (kind === "tank" ? "tank_" : "spec_") + uuid;
}

// Parse a typed entity ID into { kind, uuid }, or null if it is not exactly a canonical typed ID.
export function decodeEntityId(value) {
  if (typeof value !== "string") return null;
  if (value.startsWith("tank_")) {
    const uuid = value.slice(5);
    return isCanonicalUuid(uuid) ? { kind: "tank", uuid } : null;
  }
  if (value.startsWith("spec_")) {
    const uuid = value.slice(5);
    return isCanonicalUuid(uuid) ? { kind: "specimen", uuid } : null;
  }
  return null;
}

function base64urlEncode(text) {
  return Buffer.from(text, "utf8").toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
    return Buffer.from(token.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return null;
  }
}

// A single-UUID cursor (entities, conflicts, conflict candidates, placements, settings).
export function encodeUuidCursor(uuid) {
  return base64urlEncode("u:" + uuid);
}

// Returns the canonical UUID or null. A bare UUID token (not our base64url form) decodes to garbage
// and is rejected, satisfying "raw UUID cursors reject".
export function decodeUuidCursor(token) {
  if (token === null || token === undefined) return null;
  const decoded = base64urlDecode(token);
  if (decoded === null || !decoded.startsWith("u:")) return null;
  const uuid = decoded.slice(2);
  return isCanonicalUuid(uuid) ? uuid : null;
}

// The mixed available-entities cursor carries a kind discriminator plus the UUID sort key.
export function encodeAvailableCursor(kind, uuid) {
  return base64urlEncode("a:" + (kind === "tank" ? "tank" : "specimen") + ":" + uuid);
}

export function decodeAvailableCursor(token) {
  if (token === null || token === undefined) return null;
  const decoded = base64urlDecode(token);
  if (decoded === null || !decoded.startsWith("a:")) return null;
  const rest = decoded.slice(2);
  const sep = rest.indexOf(":");
  if (sep < 0) return null;
  const kind = rest.slice(0, sep);
  const uuid = rest.slice(sep + 1);
  if ((kind !== "tank" && kind !== "specimen") || !isCanonicalUuid(uuid)) return null;
  return { kind, uuid };
}
