import { describe, it, expect } from "vitest";
import {
  isCanonicalUuid, decodeEntityId, encodeEntityId,
  encodeUuidCursor, decodeUuidCursor, encodeAvailableCursor, decodeAvailableCursor,
} from "../../api/_lib/showcaseIds.js";
import {
  jcsCanonicalize, sha256HexOfCanonical, startRequestSha256, candidateStageRequestSha256,
  sha256HexToByteaLiteral, isSha256Hex,
} from "../../api/_lib/showcaseManifest.js";
import { parseLegacyQr, serializeLegacyQr, LEGACY_QR_V1_ORIGIN } from "../../api/_lib/showcaseQr.js";
import { validateAction, parseStrictJson } from "../../api/_lib/showcaseValidation.js";

const UUID = "11111111-1111-4111-8111-111111111111";
const UUID2 = "22222222-2222-4222-8222-222222222222";
const UUIDL = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"; // contains hex letters

describe("showcaseIds", () => {
  it("decodes typed entity IDs and rejects malformed ones", () => {
    expect(decodeEntityId("tank_" + UUID)).toEqual({ kind: "tank", uuid: UUID });
    expect(decodeEntityId("spec_" + UUID)).toEqual({ kind: "specimen", uuid: UUID });
    expect(decodeEntityId("tank_nope")).toBeNull();
    expect(decodeEntityId(UUID)).toBeNull();
    expect(decodeEntityId("tank_" + UUIDL.toUpperCase())).toBeNull();
    expect(encodeEntityId("tank", UUID)).toBe("tank_" + UUID);
    expect(isCanonicalUuid(UUID)).toBe(true);
    expect(isCanonicalUuid("nope")).toBe(false);
  });

  it("round-trips opaque cursors and rejects raw UUID cursors", () => {
    const c = encodeUuidCursor(UUID);
    expect(c).not.toContain(UUID); // opaque, not the raw uuid
    expect(decodeUuidCursor(c)).toBe(UUID);
    expect(decodeUuidCursor(UUID)).toBeNull(); // a raw UUID is not a valid cursor
    expect(decodeUuidCursor("!!!!")).toBeNull();
    expect(decodeUuidCursor(null)).toBeNull();
    const a = encodeAvailableCursor("specimen", UUID);
    expect(decodeAvailableCursor(a)).toEqual({ kind: "specimen", uuid: UUID });
    expect(decodeAvailableCursor(encodeUuidCursor(UUID))).toBeNull(); // wrong cursor family
  });
});

describe("showcaseManifest JCS", () => {
  it("canonicalizes with sorted keys and preserved array order", () => {
    expect(jcsCanonicalize({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(jcsCanonicalize({ a: 1, b: [true, null, false] })).toBe('{"a":1,"b":[true,null,false]}');
    expect(jcsCanonicalize("a\"b")).toBe('"a\\"b"');
    expect(jcsCanonicalize(9007199254740991)).toBe("9007199254740991");
  });

  it("rejects out-of-domain numbers", () => {
    expect(() => jcsCanonicalize(1.5)).toThrow();
    expect(() => jcsCanonicalize(9007199254740992)).toThrow();
  });

  it("is key-order independent and deterministic", () => {
    expect(sha256HexOfCanonical({ a: 1, b: 2 })).toBe(sha256HexOfCanonical({ b: 2, a: 1 }));
    expect(isSha256Hex(sha256HexOfCanonical({ a: 1 }))).toBe(true);
  });

  it("builds stable operation checksums", () => {
    const a = startRequestSha256({
      operationId: UUID, sourceSchemaVersion: 3, sourceDatasetId: UUID2,
      enrollmentReference: "enroll:v1:x", declaredBackupSha256: "a".repeat(64),
      manifestSha256: "b".repeat(64), manifest: { manifestVersion: 1 },
    });
    expect(isSha256Hex(a)).toBe(true);
    // Field-order in the source object must not matter (JCS sorts keys).
    const b = candidateStageRequestSha256({ importId: UUID2, operationId: UUID, rowRefs: [{ section: "tanks", chunkIndex: 0, rowIndex: 0 }] });
    expect(isSha256Hex(b)).toBe(true);
  });

  it("encodes a 32-byte digest as a hex bytea literal", () => {
    expect(sha256HexToByteaLiteral("ab".repeat(32))).toBe("\\x" + "ab".repeat(32));
    expect(() => sha256HexToByteaLiteral("xyz")).toThrow();
  });
});

describe("showcaseQr", () => {
  it("parses the two accepted scan forms and round-trips", () => {
    const hash = parseLegacyQr("scan", "https://aquacellum.com/app#tank=42");
    expect(hash).toEqual({ version: 1, source: "scan_hash", origin: LEGACY_QR_V1_ORIGIN, path: "/app", value: "42" });
    expect(serializeLegacyQr(hash)).toBe("https://aquacellum.com/app#tank=42");
    const query = parseLegacyQr("scan", "https://aquacellum.com/app?tank=7");
    expect(query.source).toBe("scan_query");
    expect(serializeLegacyQr(query)).toBe("https://aquacellum.com/app?tank=7");
    const manual = parseLegacyQr("manual", "1");
    expect(manual).toEqual({ version: 1, source: "manual", origin: null, path: null, value: "1" });
    expect(serializeLegacyQr(manual)).toBe("1");
  });

  it("rejects every deviation from the frozen grammar", () => {
    expect(parseLegacyQr("scan", "https://aquacellum.com/app/#tank=1")).toBeNull(); // extra slash
    expect(parseLegacyQr("scan", "https://aquacellum.com/app#tank=1&x=2")).toBeNull(); // extra param
    expect(parseLegacyQr("scan", "https://AQUACELLUM.com/app#tank=1")).toBeNull(); // case variant
    expect(parseLegacyQr("scan", "https://evil.com/app#tank=1")).toBeNull(); // wrong host
    expect(parseLegacyQr("scan", "https://aquacellum.com/app#tank=01")).toBeNull(); // leading zero
    expect(parseLegacyQr("scan", "https://aquacellum.com/app?tank=1#x")).toBeNull(); // query + fragment
    expect(parseLegacyQr("manual", "0")).toBeNull();
    expect(parseLegacyQr("manual", "9007199254740992")).toBeNull(); // above MAX_SAFE
    expect(parseLegacyQr("bogus", "1")).toBeNull();
  });
});

describe("parseStrictJson", () => {
  it("parses valid JSON like the platform parser", () => {
    expect(parseStrictJson('{"a":1,"b":[true,null,"x"]}')).toEqual({ a: 1, b: [true, null, "x"] });
    expect(parseStrictJson("{}")).toEqual({});
  });
  it("rejects duplicate object member names", () => {
    expect(() => parseStrictJson('{"a":1,"a":2}')).toThrow();
    expect(() => parseStrictJson('{"x":{"k":1,"k":2}}')).toThrow();
  });
  it("rejects unpaired/lone surrogates", () => {
    expect(() => parseStrictJson('{"s":"\\uD800"}')).toThrow();       // lone high
    expect(() => parseStrictJson('{"s":"\\uDC00"}')).toThrow();       // lone low
    expect(parseStrictJson('{"s":"\\uD83D\\uDE00"}').s).toBe("\uD83D\uDE00"); // valid pair
  });
  it("rejects trailing garbage and unescaped control chars", () => {
    expect(() => parseStrictJson('{"a":1} x')).toThrow();
    expect(() => parseStrictJson('{"a":"\u0001"}')).toThrow();
  });
});

describe("showcaseValidation", () => {
  it("accepts an exact room-create body and rejects unknown/missing/bad fields", () => {
    expect(validateAction("room-create", { slug: "my-room", title: "My Room", description: null, schematic: { zones: [] } }).ok).toBe(true);
    expect(validateAction("room-create", { slug: "my-room", title: "My Room", description: null, schematic: {}, extra: 1 }).code).toBe("invalid_request");
    expect(validateAction("room-create", { slug: "my-room", title: "My Room", description: null }).code).toBe("invalid_request");
    expect(validateAction("room-create", { slug: "my-room", title: "", description: null, schematic: {} }).code).toBe("invalid_field");
  });

  it("rejects an unknown action and non-object body", () => {
    expect(validateAction("no-such-action", {}).code).toBe("invalid_action");
    expect(validateAction("bootstrap", null).code).toBe("invalid_request");
    expect(validateAction("bootstrap", {}).ok).toBe(true);
  });

  it("accepts only exact owner media-preview bindings", () => {
    expect(validateAction("media-preview", { roomId: UUID, assetId: UUID2, variant: "hero" }).ok).toBe(true);
    expect(validateAction("media-preview", { roomId: UUID, assetId: UUID2, variant: "source" }).code).toBe("invalid_field");
    expect(validateAction("media-preview", { roomId: UUID, assetId: UUID2, variant: "hero", ownerId: UUID }).code).toBe("invalid_request");
  });

  it("validates typed entity IDs and adjudication reason", () => {
    expect(validateAction("identity-adjudicate", { conflictId: UUID, chosenEntityId: "tank_" + UUID2, reason: "mine" }).ok).toBe(true);
    expect(validateAction("identity-adjudicate", { conflictId: UUID, chosenEntityId: null, reason: "reject" }).value.chosen).toBeNull();
    expect(validateAction("identity-adjudicate", { conflictId: UUID, chosenEntityId: "tank_bad", reason: "x" }).code).toBe("invalid_entity_id");
    expect(validateAction("identity-adjudicate", { conflictId: UUID, chosenEntityId: null, reason: " untrimmed " }).code).toBe("invalid_field");
  });

  it("canonically sorts and dedupes candidate rowRefs", () => {
    const r = validateAction("identity-candidate-stage", {
      operationId: UUID, importId: UUID2,
      rowRefs: [{ section: "tanks", chunkIndex: 1, rowIndex: 0 }, { section: "specimens", chunkIndex: 0, rowIndex: 0 }, { section: "tanks", chunkIndex: 0, rowIndex: 0 }],
    });
    expect(r.ok).toBe(true);
    expect(r.value.rowRefs[0]).toEqual({ section: "specimens", chunkIndex: 0, rowIndex: 0 });
    expect(r.value.rowRefs[1]).toEqual({ section: "tanks", chunkIndex: 0, rowIndex: 0 });
    const dup = validateAction("identity-candidate-stage", {
      operationId: UUID, importId: UUID2,
      rowRefs: [{ section: "tanks", chunkIndex: 0, rowIndex: 0 }, { section: "tanks", chunkIndex: 0, rowIndex: 0 }],
    });
    expect(dup.code).toBe("invalid_field");
  });

  it("enforces placement-put shape and forces deferred fields out", () => {
    const good = validateAction("placement-put", {
      roomId: UUID, tankId: "tank_" + UUID2, expectedRevision: null, slug: "main", visibility: "public",
      label: "Main", caption: null,
      facts: { volume: true, tankType: false, publishedInhabitantCount: true },
      placement: { x: 0.5, y: 0.5, width: null, height: null, focalX: null, focalY: null, zoneId: null, order: 0 },
    });
    expect(good.ok).toBe(true);
    const badFacts = validateAction("placement-put", {
      roomId: UUID, tankId: "tank_" + UUID2, expectedRevision: null, slug: "main", visibility: "public",
      label: "Main", caption: null,
      facts: { volume: true, tankType: false, publishedInhabitantCount: true, careFact: true },
      placement: { x: 0.5, y: 0.5, width: null, height: null, focalX: null, focalY: null, zoneId: null, order: 0 },
    });
    expect(badFacts.code).toBe("invalid_field");
  });
});
