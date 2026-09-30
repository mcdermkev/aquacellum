/**
 * tankLabel — what a tank's printed QR label opens.
 *
 * A private `/app#tank=<id>` label only works for the owner on a device that has
 * the tank, so a published tank's label must point at its public `/t/<token>`
 * page, and an unpublished one must say it is private. Publishing stays an
 * explicit action in TankLabelDialog; these pin the pure parts and the wiring.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PRIVATE_LABEL_NOTE,
  publicTankUrl,
  readTankPublication,
  saveTankPublication,
  tankLabelTarget,
  tankPublicSnapshot,
  tankRefFor,
} from "../utils/tankLabel.js";
import { publishTank, setSessionTokenGetter } from "../services/boothApi.js";

const TOKEN = "0123456789abcdef0123456789abcdef";
const tank = { id: 1712345678901, name: "Shrimp nano" };

function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    keys: () => [...m.keys()],
  };
}

describe("tankLabelTarget", () => {
  it("published tank: the QR and printed link are the public /t/ page, no private note", () => {
    const t = tankLabelTarget(tank, { token: TOKEN, publicUrl: `https://aquacellum.com/t/${TOKEN}`, isPublic: true });
    expect(t.kind).toBe("public");
    expect(t.url).toBe(`https://aquacellum.com/t/${TOKEN}`);
    expect(t.shortUrl).toBe(`aquacellum.com/t/${TOKEN}`);
    expect(t.note).toBe("");
    expect(t.url).not.toMatch(/app#tank=/);
  });

  it("builds the /t/ URL from the token when the server URL is missing or not a /t/ page", () => {
    expect(tankLabelTarget(tank, { token: TOKEN }).url).toBe(`https://aquacellum.com/t/${TOKEN}`);
    expect(publicTankUrl({ token: TOKEN, publicUrl: "https://evil.example/phish" })).toBe(`https://aquacellum.com/t/${TOKEN}`);
    expect(publicTankUrl({ token: TOKEN, publicUrl: `http://aquacellum.com/t/${TOKEN}` })).toBe(`https://aquacellum.com/t/${TOKEN}`);
    expect(publicTankUrl({ token: TOKEN, publicUrl: `https://preview.aquacellum.com/t/${TOKEN}` })).toBe(`https://preview.aquacellum.com/t/${TOKEN}`);
  });

  it("unpublished tank: the private in-app link, with the owner-only note", () => {
    const t = tankLabelTarget(tank, null);
    expect(t.kind).toBe("private");
    expect(t.url).toBe("https://aquacellum.com/app#tank=1712345678901");
    expect(t.note).toBe(PRIVATE_LABEL_NOTE);
    expect(t.note).toMatch(/only in the owner's app/);
  });

  it("taken-down or malformed publications fall back to the private label", () => {
    expect(tankLabelTarget(tank, { token: TOKEN, isPublic: false }).kind).toBe("private");
    expect(tankLabelTarget(tank, { token: "short" }).kind).toBe("private");
    expect(tankLabelTarget(tank, { token: "../../x/y/zzzzzzzzzzzzzzzz" }).kind).toBe("private");
    expect(tankLabelTarget(tank, {}).kind).toBe("private");
  });

  it("does not crash without a tank id", () => {
    for (const t of [null, undefined, {}, { id: null }, { id: "" }, { name: "No id" }]) {
      const out = tankLabelTarget(t, { token: TOKEN });
      expect(out.kind).toBe("none");
      expect(out.url).toBeNull();
    }
    expect(tankRefFor(null)).toBeNull();
    expect(() => tankPublicSnapshot(null)).not.toThrow();
  });
});

describe("tankPublicSnapshot (what publishing makes public)", () => {
  const full = {
    id: 5,
    name: "Club display",
    facility: "Home",
    room: "Basement",
    rack: "Rack A",
    notes: "private notes",
    volumeLiters: 75,
    tankType: 0,
    specimens: [
      { commonName: "Neon tetra", scientificName: "Paracheirodon innesi", nickname: "Blue", status: 0 },
      { commonName: "Neon tetra", scientificName: "Paracheirodon innesi", status: 0 },
      { commonName: "Old fish", scientificName: "Gone gone", status: 2 },
      { commonName: "Batch", isBatchPlaceholder: true, status: 0 },
      { commonName: "Mystery", scientificName: "Unknown", status: 0 },
    ],
  };

  it("sends the name, one entry per living species, and type and volume only", () => {
    const snap = tankPublicSnapshot(full);
    expect(snap.title).toBe("Club display");
    expect(snap.specimens).toEqual([
      { publicName: "Neon tetra", commonName: "Neon tetra", scientificName: "Paracheirodon innesi" },
      { publicName: "Mystery", commonName: "Mystery", scientificName: null },
    ]);
    expect(snap.facts.volumeLiters).toBe(75);
    expect(typeof snap.facts.tankType).toBe("string");
    const json = JSON.stringify(snap);
    for (const secret of ["Basement", "Rack A", "Home", "private notes", "Blue", "Gone gone"]) {
      expect(json).not.toContain(secret);
    }
  });
});

describe("publication memory (this device)", () => {
  it("round-trips per wallet and tank, and a take-down reads back as not public", () => {
    const s = memoryStorage();
    expect(readTankPublication("0xABC", 5, s)).toBeNull();
    saveTankPublication("0xABC", 5, { token: TOKEN, publicUrl: `https://aquacellum.com/t/${TOKEN}`, isPublic: true }, s);
    expect(readTankPublication("0xabc", 5, s)).toMatchObject({ token: TOKEN, isPublic: true });
    expect(readTankPublication("0xdef", 5, s)).toBeNull();
    saveTankPublication("0xabc", 5, { token: TOKEN, isPublic: false }, s);
    expect(tankLabelTarget({ id: 5 }, readTankPublication("0xabc", 5, s)).kind).toBe("private");
  });

  it("ignores bad input and never throws", () => {
    const s = memoryStorage();
    expect(saveTankPublication("", 5, { token: TOKEN }, s)).toBeNull();
    expect(saveTankPublication("0xabc", 5, { token: "nope" }, s)).toBeNull();
    s.setItem("aquadex:tank-publication:v1:0xabc:9", "{not json");
    expect(readTankPublication("0xabc", 9, s)).toBeNull();
    expect(readTankPublication("0xabc", 9, null)).toBeNull();
  });
});

describe("publishTank forwards the display-only fish list", () => {
  afterEach(() => setSessionTokenGetter(null));

  it("adds specimens and facts only when given, and still no prices or wallet", async () => {
    setSessionTokenGetter(async () => "t");
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, token: TOKEN }) }));
    const snap = tankPublicSnapshot({ id: 1, name: "Nano", volumeLiters: 20, specimens: [{ commonName: "Guppy", status: 0 }] });
    await publishTank({ tankRef: tankRefFor({ id: 1 }), title: snap.title, specimens: snap.specimens, facts: snap.facts, listingIds: [], fetchImpl });
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
    expect(body.tankRef).toBe("logbook-tank-1");
    expect(body.specimens).toEqual([{ publicName: "Guppy", commonName: "Guppy", scientificName: null }]);
    expect(body.facts.volumeLiters).toBe(20);
    expect(body.listingIds).toEqual([]);
    expect(body.isPublic).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/price|wallet/i);
  });
});

describe("label wiring (source)", () => {
  const read = (p) => readFileSync(resolve(__dirname, p), "utf8");
  const tankList = read("../components/TankList.jsx");
  const dialog = read("../components/logbook/TankLabelDialog.jsx");
  const pdf = read("../utils/pdfExport.js");

  it("Print label opens the dialog instead of downloading a private-only PDF", () => {
    const fn = tankList.slice(tankList.indexOf("const printTankQRLabel"), tankList.indexOf("const askPoseidon"));
    expect(fn).toMatch(/setLabelDialogTank\(tank\)/);
    expect(fn).not.toMatch(/generateTankQRLabel/);
    expect(tankList).toMatch(/<TankLabelDialog/);
  });

  it("the dialog uses the shared Modal and the existing publish call, and publishes only on a button press", () => {
    expect(dialog).toMatch(/import \{ Modal \} from "\.\.\/Modal"/);
    expect(dialog).toMatch(/import \{ publishTank \} from "\.\.\/\.\.\/services\/boothApi"/);
    // publishTank is only reached from the two click handlers, never on mount.
    const effects = dialog.match(/useEffect\([\s\S]*?\}, \[[^\]]*\]\);/g) || [];
    expect(effects.length).toBeGreaterThan(0);
    for (const e of effects) expect(e).not.toMatch(/publishTank|sendPublish/);
    expect(dialog).toMatch(/Publish a public page for this tank/);
    expect(dialog).toMatch(/Print a private label/);
    expect(dialog).toMatch(/Sign in to publish a public page/);
  });

  it("the PDF encodes the target URL and leaves location off public labels", () => {
    const fn = pdf.slice(pdf.indexOf("export async function generateTankQRLabel"), pdf.indexOf("export async function generatePublicTankLabel"));
    expect(fn).toMatch(/generateQRDataUrl\(scanUrl\)/);
    expect(fn).toMatch(/if \(!isPublic\) \{\s*const path = \[facility, room, rack\]/);
  });

  it("copy has no em dashes or exclamation points in user-facing dialog strings", () => {
    const jsxText = dialog.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(jsxText).not.toMatch(/\u2014/);
    // A word ending in "!" (copy), not a `!value` negation.
    expect(jsxText).not.toMatch(/[A-Za-z]!["<\s]/);
  });
});
