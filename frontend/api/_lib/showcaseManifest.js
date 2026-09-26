// Fish Room R1.3B — RFC 8785 (JCS) canonicalization, SHA-256 wire digests, and the two durable
// operation checksums. This canonicalization is byte-for-byte identical to the ungranted PostgreSQL
// helper `public.showcase_jcs_sha256` (validated by cross-runtime parity vectors); SQL independently
// recomputes every digest, so nothing computed here is ever trusted as authority.

import { createHash } from "node:crypto";

const HEX64 = /^[0-9a-f]{64}$/;
const MAX_SAFE = 9007199254740991;

export function isSha256Hex(value) {
  return typeof value === "string" && HEX64.test(value);
}

// RFC 8785 canonical serialization for the restricted I-JSON domain: object keys sorted by UTF-16
// code units (JS default sort), arrays preserved, strings via JSON.stringify escaping, numbers as
// safe integers only. Rejects out-of-domain values so a bad payload cannot silently canonicalize.
export function jcsCanonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isInteger(value) || Math.abs(value) > MAX_SAFE) {
      throw new Error("jcs_number_out_of_domain");
    }
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(jcsCanonicalize).join(",") + "]";
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return "{" + keys.map((k) => JSON.stringify(k) + ":" + jcsCanonicalize(value[k])).join(",") + "}";
  }
  throw new Error("jcs_value_invalid");
}

export function sha256HexOfCanonical(value) {
  return createHash("sha256").update(Buffer.from(jcsCanonicalize(value), "utf8")).digest("hex");
}

// The exact section 10.1 dataset-import-start operation checksum (lowercase hex).
export function startRequestSha256(fields) {
  return sha256HexOfCanonical({
    operationChecksumVersion: 1,
    operation: "dataset_import_start",
    operationId: fields.operationId,
    sourceSchemaVersion: fields.sourceSchemaVersion,
    sourceDatasetId: fields.sourceDatasetId,          // canonical uuid or null
    enrollmentReference: fields.enrollmentReference,  // opaque string or null
    declaredBackupSha256: fields.declaredBackupSha256,
    manifestSha256: fields.manifestSha256,            // 64-hex or null
    manifest: fields.manifest,                        // exact object ({} for legacy)
  });
}

// The exact section 10.1 identity-candidate-stage operation checksum (lowercase hex).
export function candidateStageRequestSha256(fields) {
  return sha256HexOfCanonical({
    operationChecksumVersion: 1,
    operation: "identity_candidate_stage",
    operationId: fields.operationId,
    importId: fields.importId,
    rowRefs: fields.rowRefs, // already validated, unique, canonically sorted
  });
}

// PostgREST binds a bytea function argument by casting the JSON string with bytea's input function.
// A `\x`-prefixed lowercase-hex string is the hex-format bytea literal. `sha256Hex` must be 64 hex.
export function sha256HexToByteaLiteral(sha256Hex) {
  if (!isSha256Hex(sha256Hex)) throw new Error("sha256_hex_invalid");
  return "\\x" + sha256Hex;
}

export function bytesToByteaLiteral(buffer) {
  return "\\x" + Buffer.from(buffer).toString("hex");
}
