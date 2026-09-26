// Fish Room R1.3B — legacy QR parser/serializer (freeze section 13).
//
// A pure round-tripping parser for the exact accepted raw payload. Scan mode accepts ONLY:
//   https://aquacellum.com/app#tank=<canonical-decimal>
//   https://aquacellum.com/app?tank=<canonical-decimal>
// The first has no query, the second no fragment. Extra params, `/app/`, userinfo, subdomains,
// ports, case variants, percent-encoding, and substrings all reject. Manual mode accepts only the
// canonical decimal. The compatibility origin is independent of SHOWCASE_APP_ORIGIN and confers no
// authority; server-side resolution is what actually authorizes.

export const LEGACY_QR_V1_ORIGIN = "https://aquacellum.com";

const MAX_PAYLOAD_BYTES = 512;
const CANONICAL_DECIMAL = /^[1-9][0-9]*$/;
const MAX_SAFE = 9007199254740991n;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decimalInRange(value) {
  if (!CANONICAL_DECIMAL.test(value)) return false;
  try {
    return BigInt(value) <= MAX_SAFE;
  } catch {
    return false;
  }
}

// Parse `mode`/`payload` into { version, source, origin, path, value } or null on any deviation.
// `allowedOrigins` defaults to the production compatibility origin; tests may inject exact loopback
// origins. Origins are matched literally (case-sensitive), so a case/port/subdomain variant rejects.
export function parseLegacyQr(mode, payload, allowedOrigins = [LEGACY_QR_V1_ORIGIN]) {
  if (typeof payload !== "string") return null;
  if (Buffer.byteLength(payload, "utf8") > MAX_PAYLOAD_BYTES) return null;

  if (mode === "manual") {
    if (!decimalInRange(payload)) return null;
    return { version: 1, source: "manual", origin: null, path: null, value: payload };
  }

  if (mode === "scan") {
    for (const origin of allowedOrigins) {
      const base = escapeRegExp(origin);
      const hash = new RegExp("^" + base + "/app#tank=([1-9][0-9]*)$");
      const query = new RegExp("^" + base + "/app\\?tank=([1-9][0-9]*)$");
      let m = hash.exec(payload);
      if (m && decimalInRange(m[1])) {
        return { version: 1, source: "scan_hash", origin, path: "/app", value: m[1] };
      }
      m = query.exec(payload);
      if (m && decimalInRange(m[1])) {
        return { version: 1, source: "scan_query", origin, path: "/app", value: m[1] };
      }
    }
    return null;
  }

  return null;
}

// Emit the exact accepted bytes for a scan parse, or the canonical decimal for a manual parse.
export function serializeLegacyQr(parsed) {
  if (!parsed || parsed.version !== 1) return null;
  if (parsed.source === "manual") return parsed.value;
  if (parsed.source === "scan_hash") return parsed.origin + "/app#tank=" + parsed.value;
  if (parsed.source === "scan_query") return parsed.origin + "/app?tank=" + parsed.value;
  return null;
}
