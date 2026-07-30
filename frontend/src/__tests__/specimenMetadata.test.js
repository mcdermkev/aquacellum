/**
 * Specimen metadata document + the on-chain URI gate
 * (docs/BREEDER_STATE_MODEL.md §9.9).
 *
 * WHY THE URI TESTS ARE STRICT: `AquadexManager.tokenURI(tokenId)` returns
 * `specimens[tokenId].ipfsMetadataUri` verbatim, so this field IS the
 * certificate's public ERC-721 metadata claim and it is also emitted in the
 * `SpecimenRegistered` event. The app used to write two fabricated identifiers
 * into it — a hardcoded one identical across every registration, and one built
 * with `Math.random()` per spawn offspring. Nothing was pinned; both resolved to
 * nothing.
 *
 * An empty URI is honest. A dead ipfs:// link is a false assertion.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";

// Storage reports unconfigured, which is the case worth pinning: supabaseClient
// falls back to a `placeholder.supabase.co` URL when credentials are absent, and
// putting THAT on-chain would recreate the very bug this module prevents.
vi.mock("../services/supabaseClient", () => ({
  isSupabaseConfigured: () => false,
  supabase: {
    storage: {
      from: () => ({
        getPublicUrl: () => ({ data: { publicUrl: "https://placeholder.supabase.co/x.json" } }),
        upload: async () => ({ error: null }),
      }),
    },
  },
}));

const {
  METADATA_URI_NONE,
  METADATA_BUCKET,
  METADATA_STATUS,
  FABRICATED_URI_MARKERS,
  buildSpecimenMetadata,
  isPlausibleCid,
  metadataObjectPath,
  normalizeMetadataUri,
  publicMetadataUri,
  validateMetadataUri,
} = await import("../services/specimenMetadata");

// Real-shaped identifiers for the accept cases.
const REAL_CID_V1 = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
const REAL_CID_V0 = "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG";

describe("isPlausibleCid", () => {
  it("accepts real-shaped v0 and v1 identifiers", () => {
    expect(isPlausibleCid(REAL_CID_V1)).toBe(true);
    expect(isPlausibleCid(REAL_CID_V0)).toBe(true);
  });

  it("rejects the placeholders the app used to invent — they're the wrong length", () => {
    expect(isPlausibleCid("bafybeidflm24zspeciemensample")).toBe(false);
    expect(isPlausibleCid("bafkreispawnlogscompiledmetadata")).toBe(false);
    expect(isPlausibleCid("bafkreispawnlogscompiledmetadataq7x2z")).toBe(false);
  });

  it("rejects junk", () => {
    for (const junk of ["", "   ", "Qm", "b", "hello", null, undefined, 42, {}]) {
      expect(isPlausibleCid(junk)).toBe(false);
    }
  });
});

describe("validateMetadataUri", () => {
  it("treats blank as a valid, deliberate 'no document published'", () => {
    for (const blank of ["", "   ", null, undefined]) {
      const res = validateMetadataUri(blank);
      expect(res.ok).toBe(true);
      expect(res.uri).toBe(METADATA_URI_NONE);
      expect(res.error).toBeNull();
    }
    expect(METADATA_URI_NONE).toBe("");
  });

  it("accepts a real ipfs:// identifier, with or without a path", () => {
    expect(validateMetadataUri(`ipfs://${REAL_CID_V1}`).uri).toBe(`ipfs://${REAL_CID_V1}`);
    expect(validateMetadataUri(`ipfs://${REAL_CID_V1}/meta.json`).ok).toBe(true);
    expect(validateMetadataUri(`ipfs://${REAL_CID_V0}`).ok).toBe(true);
  });

  it("accepts an https:// document", () => {
    const res = validateMetadataUri("https://example.supabase.co/storage/v1/object/public/x/1.json");
    expect(res.ok).toBe(true);
    expect(res.uri).toContain("https://");
  });

  it("REJECTS both previously-fabricated identifiers, with an explanation", () => {
    for (const bad of [
      "ipfs://bafybeidflm24zspeciemensample/meta.json",
      "ipfs://bafkreispawnlogscompiledmetadataq7x2z",
    ]) {
      const res = validateMetadataUri(bad);
      expect(res.ok, bad).toBe(false);
      expect(res.uri).toBe(METADATA_URI_NONE);
      expect(res.error).toBeTruthy();
    }
  });

  it("rejects a fabricated marker regardless of casing or surrounding path", () => {
    for (const marker of FABRICATED_URI_MARKERS) {
      expect(validateMetadataUri(`ipfs://${marker.toUpperCase()}/x.json`).ok).toBe(false);
      expect(validateMetadataUri(`https://gateway.pinata.cloud/ipfs/${marker}`).ok).toBe(false);
    }
  });

  it("rejects a truncated or malformed ipfs identifier", () => {
    expect(validateMetadataUri("ipfs://Qm123").ok).toBe(false);
    expect(validateMetadataUri("ipfs://").ok).toBe(false);
    expect(validateMetadataUri("ipfs://not-a-cid/meta.json").ok).toBe(false);
  });

  it("rejects other schemes outright", () => {
    for (const bad of ["http://insecure.example/x.json", "ftp://x/y", "javascript:alert(1)", "data:application/json,{}"]) {
      expect(validateMetadataUri(bad).ok, bad).toBe(false);
    }
  });

  it("normalizeMetadataUri never returns an invalid value — it fails to empty", () => {
    expect(normalizeMetadataUri("ipfs://bafybeidflm24zspeciemensample/meta.json")).toBe("");
    expect(normalizeMetadataUri("garbage")).toBe("");
    expect(normalizeMetadataUri(undefined)).toBe("");
    expect(normalizeMetadataUri(`ipfs://${REAL_CID_V1}`)).toBe(`ipfs://${REAL_CID_V1}`);
  });
});

describe("buildSpecimenMetadata", () => {
  it("produces the ERC-721-conventional shape", () => {
    const doc = buildSpecimenMetadata({ commonName: "Convict Cichlid", speciesId: 4 });
    expect(doc.name).toBe("Convict Cichlid Specimen");
    expect(doc.description).toContain("4");
    expect(Array.isArray(doc.attributes)).toBe(true);
  });

  it("renders absent parents and tank as 'None', never as certificate 0", () => {
    const doc = buildSpecimenMetadata({ sireId: 0, damId: "0", tankId: null });
    const map = Object.fromEntries(doc.attributes.map((a) => [a.trait_type, a.value]));
    expect(map["Sire ID"]).toBe("None");
    expect(map["Dam ID"]).toBe("None");
    expect(map["Containment Tank ID"]).toBe("None");
  });

  it("keeps the trait names the existing readers depend on", () => {
    // SpecimenDetailModal skips these three by name when rendering.
    const doc = buildSpecimenMetadata({ sireId: 10, damId: 11, tankId: 5 });
    const names = doc.attributes.map((a) => a.trait_type);
    for (const required of ["Sire ID", "Dam ID", "Containment Tank ID", "Registration Date"]) {
      expect(names).toContain(required);
    }
  });

  it("preserves the 'Snapped ' prefix contract used by pdfExport", () => {
    const doc = buildSpecimenMetadata({
      extraAttributes: [{ trait_type: "Snapped Temp", value: "26.0°C" }],
    });
    const snapped = doc.attributes.filter((a) => a.trait_type.startsWith("Snapped"));
    expect(snapped).toHaveLength(1);
    expect(snapped[0].value).toBe("26.0°C");
  });

  it("stringifies every value so consumers don't have to be defensive", () => {
    const doc = buildSpecimenMetadata({
      sireId: 10,
      extraAttributes: [{ trait_type: "Count", value: 42 }, { trait_type: "Flag", value: null }],
    });
    for (const attr of doc.attributes) {
      expect(typeof attr.value, attr.trait_type).toBe("string");
    }
  });

  it("includes sex and stock tag only when supplied", () => {
    const bare = buildSpecimenMetadata({});
    const names = bare.attributes.map((a) => a.trait_type);
    expect(names).not.toContain("Sex");
    expect(names).not.toContain("Breeder Stock Tag");

    const full = buildSpecimenMetadata({ sex: "Female", breederStockTag: "esgIV" });
    const map = Object.fromEntries(full.attributes.map((a) => [a.trait_type, a.value]));
    expect(map.Sex).toBe("Female");
    expect(map["Breeder Stock Tag"]).toBe("esgIV");
  });

  it("ignores malformed extra attributes rather than emitting empty traits", () => {
    const doc = buildSpecimenMetadata({
      extraAttributes: [null, undefined, {}, { value: "orphan" }, { trait_type: "Good", value: "y" }],
    });
    expect(doc.attributes.filter((a) => a.trait_type === "Good")).toHaveLength(1);
    expect(doc.attributes.every((a) => !!a.trait_type)).toBe(true);
  });

  it("tolerates being called with nothing", () => {
    expect(() => buildSpecimenMetadata()).not.toThrow();
    expect(buildSpecimenMetadata().attributes.length).toBeGreaterThan(0);
  });
});

describe("metadataObjectPath — deterministic and owner-scoped", () => {
  it("is derived, not discovered: same inputs always give the same path", () => {
    expect(metadataObjectPath("0xAbC", 42)).toBe("0xabc/42.json");
    expect(metadataObjectPath("0xabc", 42)).toBe(metadataObjectPath("0xABC", "42"));
  });

  it("carries no timestamp or nonce — the URL goes on-chain and must be stable", () => {
    const first = metadataObjectPath("0xabc", 7);
    expect(first).toBe("0xabc/7.json");
    expect(metadataObjectPath("0xabc", 7)).toBe(first);
    expect(first).not.toMatch(/\d{10,}/); // no epoch smuggled in
  });

  it("namespaces by owner, because serials are per-device sequential", () => {
    // Two breeders both have specimen #1; the paths must not collide.
    expect(metadataObjectPath("0xaaa", 1)).not.toBe(metadataObjectPath("0xbbb", 1));
  });
});

describe("publicMetadataUri — refuses to emit a URL it can't stand behind", () => {
  it("returns empty when storage isn't configured", () => {
    // The mocked client below reports unconfigured, which is the important
    // case: supabaseClient falls back to a placeholder.supabase.co URL, and
    // writing THAT on-chain would recreate the fabricated-pointer bug.
    expect(publicMetadataUri("0xabc", 1)).toBe(METADATA_URI_NONE);
  });

  it("returns empty for a missing owner or a non-numeric serial", () => {
    expect(publicMetadataUri("", 1)).toBe(METADATA_URI_NONE);
    expect(publicMetadataUri("0xabc", "abc")).toBe(METADATA_URI_NONE);
    expect(publicMetadataUri(null, null)).toBe(METADATA_URI_NONE);
  });
});

describe("METADATA_STATUS", () => {
  it("distinguishes 'no document' from 'not yet uploaded' from 'someone else hosts it'", () => {
    expect(new Set(Object.values(METADATA_STATUS)).size).toBe(5);
    for (const key of ["NONE", "PENDING", "PUBLISHED", "FAILED", "EXTERNAL"]) {
      expect(METADATA_STATUS[key]).toBeTruthy();
    }
  });
});

describe("the relayer resolves the URI without fabricating one", () => {
  const RELAYER = readFileSync(
    fileURLToPath(new URL("../services/relayer.js", import.meta.url)),
    "utf8"
  );

  it("puts the resolved URI on-chain, not the raw caller input", () => {
    expect(RELAYER).toContain("ipfsMetadataUri: resolvedMetadataUri");
    expect(RELAYER).not.toContain('ipfsMetadataUri: ipfsMetadataUri || ""');
  });

  it("validates a breeder-supplied URI before using it", () => {
    expect(RELAYER).toContain("normalizeMetadataUri(ipfsMetadataUri)");
  });

  it("only claims a hosted URL when one could actually be derived", () => {
    expect(RELAYER).toContain("publicMetadataUri(ownerAddress, specimenId)");
    expect(RELAYER).toContain("METADATA_STATUS.PENDING");
  });

  it("publishes fire-and-forget so certificate creation stays non-blocking", () => {
    // No `await` on the publish — the URL is deterministic, so the upload does
    // not gate the write. A failure is recorded for the retry pass instead.
    expect(RELAYER).not.toMatch(/await\s+publishSpecimenMetadata/);
    expect(RELAYER).toContain("publishSpecimenMetadata({ ownerAddress, specimenId, document: metadataDocument })");
    expect(RELAYER).toContain("METADATA_STATUS.FAILED");
  });
});

describe("the retry pass is wired into the login sync", () => {
  const APP = readFileSync(fileURLToPath(new URL("../App.jsx", import.meta.url)), "utf8");

  it("runs retryPendingMetadataPublishes after the cloud push", () => {
    expect(APP).toContain("retryPendingMetadataPublishes");
    expect(APP.indexOf("pushAllLocalDataToCloud(walletAddr)")).toBeLessThan(
      APP.indexOf("retryPendingMetadataPublishes(walletAddr)")
    );
  });
});

describe("the storage migration matches what the client does", () => {
  const SQL = readFileSync(
    fileURLToPath(new URL("../../supabase/migrations/20260729_specimen_metadata_storage.sql", import.meta.url)),
    "utf8"
  );

  it("creates a public, JSON-only bucket named to match the client constant", () => {
    expect(SQL).toContain("'specimen-metadata'");
    expect(METADATA_BUCKET).toBe("specimen-metadata");
    expect(SQL).toContain("ARRAY['application/json']");
  });

  it("is publicly readable so an external viewer can resolve tokenURI", () => {
    expect(SQL).toContain("FOR SELECT");
    expect(SQL).toMatch(/public read access for specimen metadata/i);
  });

  it("scopes writes to the caller's own full wallet folder", () => {
    expect(SQL).toContain("(storage.foldername(name))[1] = lower(coalesce(");
    expect(SQL).toContain("wallet_address");
    // Not the sibling bucket's weaker 10-char prefix comparison.
    expect(SQL).not.toContain("from 1 for 10");
  });

  it("allows UPDATE, because publish upserts for retries", () => {
    expect(SQL).toContain("FOR UPDATE");
  });

  it("grants no DELETE — the document backs a permanent on-chain pointer", () => {
    expect(SQL).not.toContain("FOR DELETE");
  });
});

describe("no write site fabricates a metadata URI", () => {
  function code(relativePath) {
    return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  const WRITE_SITES = ["../components/MintSpecimen.jsx", "../components/SpawningWizard.jsx"];

  it("neither fabricated identifier appears in any write site", () => {
    for (const file of WRITE_SITES) {
      const src = code(file);
      for (const marker of FABRICATED_URI_MARKERS) {
        expect(src, `${file} / ${marker}`).not.toContain(marker);
      }
    }
  });

  it("no write site generates a URI at random", () => {
    for (const file of WRITE_SITES) {
      const src = code(file);
      expect(src, file).not.toMatch(/ipfs:\/\/["'\s]*\+/);
      expect(src, file).not.toMatch(/Math\.random\(\)[\s\S]{0,80}ipfs/);
      expect(src, file).not.toMatch(/ipfs[\s\S]{0,80}Math\.random\(\)/);
    }
  });

  it("Register validates the URI before publishing and defaults to empty", () => {
    const src = code("../components/MintSpecimen.jsx");
    expect(src).toContain("validateMetadataUri(formData.ipfsMetadataUri)");
    expect(src).toContain("ipfsMetadataUri: METADATA_URI_NONE");
    expect(src).toContain("ipfsMetadataUri: uriCheck.uri");
  });

  it("the Spawning wizard publishes no document rather than an invented one", () => {
    const src = code("../components/SpawningWizard.jsx");
    expect(src).toContain("const ipfsHash = METADATA_URI_NONE");
  });

  it("both write sites build the stored document through the shared builder", () => {
    for (const file of WRITE_SITES) {
      expect(code(file), file).toContain("buildSpecimenMetadata(");
    }
  });
});
