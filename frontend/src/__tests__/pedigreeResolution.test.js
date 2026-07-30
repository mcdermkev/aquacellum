/**
 * Pedigree ancestor resolution (docs/BREEDER_STATE_MODEL.md §3).
 *
 * THE BUG THIS PINS: `sireId`/`damId` hold LOCAL SERIALS, not ERC-721 token ids.
 * The contract assigns token ids from a global `++totalSpecimensMinted` counter
 * with no relationship to the serial, so `contract.specimens(serial)` returns a
 * real specimen — just the wrong one — with no error.
 *
 * `SpecimenLineage` read Dexie first (correct). `COICalculator` had its own copy
 * that asked the contract first, so the same pairing could yield a correct family
 * tree and an inbreeding coefficient computed against unrelated fish. Both now
 * share services/pedigree.js; these tests assert the precedence and that neither
 * component has re-grown a private copy.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, beforeEach, vi } from "vitest";

let localSpecimens = [];
const contractCalls = [];

vi.mock("../db", () => ({
  db: {
    specimens: {
      get: async (id) =>
        localSpecimens.find((s) => String(s.id) === String(id)) || undefined,
      filter: (fn) => ({
        first: async () => localSpecimens.find(fn) || undefined,
      }),
    },
  },
}));

const { fetchSpecimenNode, fetchPedigreeTree, PEDIGREE_DEPTH } = await import(
  "../services/pedigree"
);

/**
 * A contract whose token-id space deliberately COLLIDES with the local serial
 * space — token 5 is a different fish than local serial 5. This is the real
 * hazard, not a hypothetical.
 */
const contract = {
  specimens: async (id) => {
    contractCalls.push(Number(id));
    return {
      specimenId: Number(id),
      speciesId: 999,
      birthTimestamp: 0,
      breeder: "0xchain",
      sireId: 0,
      damId: 0,
      ipfsMetadataUri: "",
      status: 0,
    };
  },
  speciesCatalog: async () => ({ commonName: "WRONG FISH", scientificName: "Wrong wrongi" }),
};

function local(id, extra = {}) {
  return {
    id,
    speciesId: 10,
    commonName: `Local ${id}`,
    scientificName: "Amatitlania nigrofasciata",
    sireId: 0,
    damId: 0,
    status: 0,
    ...extra,
  };
}

beforeEach(() => {
  localSpecimens = [];
  contractCalls.length = 0;
});

describe("fetchSpecimenNode — Dexie wins over the contract", () => {
  it("resolves from Dexie and never touches the contract when a local record exists", async () => {
    localSpecimens = [local(5)];
    const node = await fetchSpecimenNode(contract, 5);
    expect(node.speciesName).toBe("Local 5");
    expect(node.source).toBe("local");
    expect(contractCalls).toEqual([]);
  });

  it("does not return the colliding on-chain token for the same number", async () => {
    localSpecimens = [local(5)];
    const node = await fetchSpecimenNode(contract, 5);
    expect(node.speciesName).not.toBe("WRONG FISH");
    expect(node.speciesId).toBe(10);
  });

  it("falls back to the contract only when nothing is mirrored locally", async () => {
    const node = await fetchSpecimenNode(contract, 5);
    expect(node.source).toBe("chain");
    expect(contractCalls).toEqual([5]);
  });

  it("works with no contract at all (local-only callers)", async () => {
    localSpecimens = [local(5)];
    expect((await fetchSpecimenNode(null, 5)).source).toBe("local");
    expect(await fetchSpecimenNode(null, 404)).toBeNull();
  });

  it("treats serial 0 / null as 'no parent' without any lookup", async () => {
    expect(await fetchSpecimenNode(contract, 0)).toBeNull();
    expect(await fetchSpecimenNode(contract, null)).toBeNull();
    expect(await fetchSpecimenNode(contract, undefined)).toBeNull();
    expect(contractCalls).toEqual([]);
  });

  it("carries the on-chain reconciliation fields through from the local record", async () => {
    localSpecimens = [local(5, { onChainId: 4210, chainStatus: "synced" })];
    const node = await fetchSpecimenNode(contract, 5);
    expect(node.onChainId).toBe(4210);
    expect(node.chainStatus).toBe("synced");
  });

  it("defaults a local record with no status to Active", async () => {
    localSpecimens = [{ id: 5, speciesId: 10, commonName: "L", sireId: 0, damId: 0 }];
    expect((await fetchSpecimenNode(contract, 5)).status).toBe(0);
  });
});

describe("fetchPedigreeTree", () => {
  it("walks three generations following LOCAL sire/dam refs", async () => {
    localSpecimens = [
      local(1, { sireId: 2, damId: 3 }),
      local(2, { sireId: 4, damId: 5 }),
      local(3, { sireId: 6, damId: 7 }),
      local(4), local(5), local(6), local(7),
    ];
    const tree = await fetchPedigreeTree(contract, 1);
    expect(tree.target.id).toBe(1);
    expect(tree.parents.sire.id).toBe(2);
    expect(tree.parents.dam.id).toBe(3);
    expect(tree.grandparents.sireSire.id).toBe(4);
    expect(tree.grandparents.sireDam.id).toBe(5);
    expect(tree.grandparents.damSire.id).toBe(6);
    expect(tree.grandparents.damDam.id).toBe(7);
    // Everything was local, so the wrong-fish contract was never consulted.
    expect(contractCalls).toEqual([]);
    expect(PEDIGREE_DEPTH).toBe(3);
  });

  it("returns null for an unresolvable root so callers can say 'not found'", async () => {
    const noContract = null;
    expect(await fetchPedigreeTree(noContract, 42)).toBeNull();
  });

  it("leaves unknown ancestors null rather than inventing them", async () => {
    localSpecimens = [local(1, { sireId: 2, damId: 0 }), local(2)];
    const tree = await fetchPedigreeTree(null, 1);
    expect(tree.parents.sire.id).toBe(2);
    expect(tree.parents.dam).toBeNull();
    expect(tree.grandparents.sireSire).toBeNull();
    expect(tree.grandparents.damDam).toBeNull();
  });
});

describe("both pedigree consumers use the shared resolver", () => {
  function source(relativePath) {
    return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  it("COICalculator imports it and no longer has a private contract-first copy", () => {
    const SOURCE = source("../components/COICalculator.jsx");
    expect(SOURCE).toContain('from "../services/pedigree"');
    expect(SOURCE).not.toContain("const fetchSpecimenNode");
    expect(SOURCE).not.toContain("await contract.specimens(id)");
  });

  it("SpecimenLineage imports it and no longer hand-walks the tree", () => {
    const SOURCE = source("../components/SpecimenLineage.jsx");
    expect(SOURCE).toContain('from "../services/pedigree"');
    expect(SOURCE).not.toContain("const fetchSpecimenNode");
    expect(SOURCE).not.toContain("sireSireNode");
  });

  it("the resolver reads Dexie before the contract in source order", () => {
    const SOURCE = source("../services/pedigree.js");
    expect(SOURCE.indexOf("db.specimens.get")).toBeGreaterThan(-1);
    expect(SOURCE.indexOf("contract.specimens")).toBeGreaterThan(-1);
    expect(SOURCE.indexOf("db.specimens.get")).toBeLessThan(
      SOURCE.indexOf("contract.specimens")
    );
  });
});
