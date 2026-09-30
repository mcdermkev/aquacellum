/**
 * Scanning a tank label in the app. A label is either private
 * (`/app#tank=<id>`) or, for a published tank, public (`/t/<token>`). The
 * scanner opens the user's own tank for either kind, offers the public page for
 * someone else's published tank, and says plainly when a code isn't a label.
 */
import { describe, it, expect } from "vitest";
import {
  findTankIdByPublicToken,
  listTankPublications,
  parseTankScan,
  resolveTankScan,
  saveTankPublication,
} from "../utils/tankLabel.js";
import { parseTankIdFromScan } from "../components/logbook/TankScanner.jsx";

const TOKEN = "a1b2c3d4e5f6a7b8c9d0e1f2";
const OTHER = "ffffffffffffffffffff0000";
const WALLET = "0xAbC123";

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    get length() { return data.size; },
    key: (i) => [...data.keys()][i] ?? null,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
}

describe("parseTankScan", () => {
  it("private labels: app deep link on any origin, hash or query, and bare numbers", () => {
    expect(parseTankScan("https://aquacellum.com/app#tank=123")).toEqual({ kind: "private", tankId: 123 });
    expect(parseTankScan("https://aquacellum.com/app?tank=45")).toEqual({ kind: "private", tankId: 45 });
    expect(parseTankScan("http://localhost:5173/app#tank=7")).toEqual({ kind: "private", tankId: 7 });
    expect(parseTankScan("https://x/app#TANK=7")).toEqual({ kind: "private", tankId: 7 });
    expect(parseTankScan("https://aquacellum.com/app/#tank=8")).toEqual({ kind: "private", tankId: 8 });
    expect(parseTankScan("app#tank=9")).toEqual({ kind: "private", tankId: 9 });
    expect(parseTankScan("  700001 ")).toEqual({ kind: "private", tankId: 700001 });
  });

  it("public labels: /t/<token> on any origin, with or without a scheme", () => {
    expect(parseTankScan(`https://aquacellum.com/t/${TOKEN}`)).toEqual({ kind: "public", token: TOKEN });
    expect(parseTankScan(`https://preview.example.dev/t/${TOKEN}/`)).toEqual({ kind: "public", token: TOKEN });
    expect(parseTankScan(`aquacellum.com/t/${TOKEN}`)).toEqual({ kind: "public", token: TOKEN });
    expect(parseTankScan(`/t/${TOKEN}`)).toEqual({ kind: "public", token: TOKEN });
    expect(parseTankScan(`https://aquacellum.com/t/Ab_-${"x".repeat(12)}`)).toEqual({ kind: "public", token: `Ab_-${"x".repeat(12)}` });
  });

  it("rejects bad tokens", () => {
    expect(parseTankScan("https://aquacellum.com/t/short").kind).toBe("unknown");
    expect(parseTankScan(`https://aquacellum.com/t/${"a".repeat(129)}`).kind).toBe("unknown");
    expect(parseTankScan(`https://aquacellum.com/t/${TOKEN.slice(0, 10)}!!${TOKEN.slice(10)}`).kind).toBe("unknown");
    expect(parseTankScan(`https://aquacellum.com/t/${TOKEN}/extra`).kind).toBe("unknown");
    expect(parseTankScan("https://aquacellum.com/t/").kind).toBe("unknown");
  });

  it("rejects other paths and shapes", () => {
    expect(parseTankScan("https://aquacellum.com/tank?tank=5").kind).toBe("unknown");
    expect(parseTankScan("https://evil.example/login?tank=5").kind).toBe("unknown");
    expect(parseTankScan("https://aquacellum.com/app#tank=abc").kind).toBe("unknown");
    expect(parseTankScan("https://aquacellum.com/app").kind).toBe("unknown");
    expect(parseTankScan(`https://aquacellum.com/x/t/${TOKEN}`).kind).toBe("unknown");
    expect(parseTankScan(`https://aquacellum.com/tanks/${TOKEN}`).kind).toBe("unknown");
    expect(parseTankScan(`javascript:alert(1)//t/${TOKEN}`).kind).toBe("unknown");
    expect(parseTankScan(`ftp://aquacellum.com/t/${TOKEN}`).kind).toBe("unknown");
  });

  it("rejects junk", () => {
    for (const junk of [null, undefined, "", "   ", "hello world", "https://example.com", "WIFI:S:net;T:WPA;P:x;;", 42.5, {}, "x".repeat(3000)]) {
      expect(parseTankScan(junk)).toEqual({ kind: "unknown" });
    }
  });

  it("parseTankIdFromScan keeps returning the private tank id or null", () => {
    expect(parseTankIdFromScan("https://aquacellum.com/app#tank=123")).toBe(123);
    expect(parseTankIdFromScan(`https://aquacellum.com/t/${TOKEN}`)).toBeNull();
    expect(parseTankIdFromScan("hello")).toBeNull();
  });
});

describe("owner lookup of a public token", () => {
  it("finds this wallet's tank for a token it published, case-insensitive on the wallet", () => {
    const s = memoryStorage();
    saveTankPublication(WALLET, 5, { token: TOKEN, isPublic: true }, s);
    saveTankPublication(WALLET, 6, { token: OTHER, isPublic: true }, s);
    expect(findTankIdByPublicToken("0xabc123", TOKEN, s)).toBe("5");
    expect(findTankIdByPublicToken(WALLET, OTHER, s)).toBe("6");
    expect(listTankPublications(WALLET, s).map((p) => p.tankId).sort()).toEqual(["5", "6"]);
  });

  it("returns null for a token this wallet never published here", () => {
    const s = memoryStorage();
    saveTankPublication("0xsomeoneelse", 5, { token: TOKEN }, s);
    expect(findTankIdByPublicToken(WALLET, TOKEN, s)).toBeNull();
    expect(findTankIdByPublicToken(WALLET, OTHER, s)).toBeNull();
    expect(findTankIdByPublicToken(WALLET, "bad", s)).toBeNull();
    expect(findTankIdByPublicToken("", TOKEN, s)).toBeNull();
    expect(findTankIdByPublicToken(WALLET, TOKEN, null)).toBeNull();
  });

  it("does not match a wallet that only shares a prefix", () => {
    const s = memoryStorage();
    saveTankPublication("0xabc1234", 5, { token: TOKEN }, s);
    expect(findTankIdByPublicToken(WALLET, TOKEN, s)).toBeNull();
  });

  it("corrupt storage reads as null and never throws", () => {
    const prefix = "aquadex:tank-publication:v1:0xabc123:";
    const s = memoryStorage({
      [`${prefix}1`]: "{not json",
      [`${prefix}2`]: JSON.stringify({ token: "nope" }),
      [`${prefix}3`]: "null",
      [`${prefix}4`]: JSON.stringify([TOKEN]),
      [prefix]: JSON.stringify({ token: TOKEN }),
    });
    expect(findTankIdByPublicToken(WALLET, TOKEN, s)).toBeNull();
    expect(listTankPublications(WALLET, s)).toEqual([]);

    const throwing = {
      get length() { throw new Error("blocked"); },
      key() { throw new Error("blocked"); },
      getItem() { throw new Error("blocked"); },
    };
    expect(findTankIdByPublicToken(WALLET, TOKEN, throwing)).toBeNull();

    const badKeys = { length: 2, key() { throw new Error("blocked"); }, getItem: () => null };
    expect(listTankPublications(WALLET, badKeys)).toEqual([]);
  });

  it("still finds a good entry next to corrupt ones", () => {
    const s = memoryStorage({ "aquadex:tank-publication:v1:0xabc123:1": "{not json" });
    saveTankPublication(WALLET, 2, { token: TOKEN }, s);
    expect(findTankIdByPublicToken(WALLET, TOKEN, s)).toBe("2");
  });
});

describe("resolveTankScan", () => {
  const tanks = [{ id: 5, name: "Reef" }, { id: 6, name: "Shrimp" }];

  it("private label for one of the user's tanks opens it", () => {
    expect(resolveTankScan("https://aquacellum.com/app#tank=5", { tanks, wallet: WALLET, storage: memoryStorage() }))
      .toEqual({ action: "open", tank: tanks[0] });
    expect(resolveTankScan("6", { tanks, storage: null })).toEqual({ action: "open", tank: tanks[1] });
  });

  it("private label for a tank not in the account says so", () => {
    expect(resolveTankScan("https://aquacellum.com/app#tank=99", { tanks, storage: null }))
      .toEqual({ action: "not-found", tankId: 99 });
  });

  it("public label the user published from this device opens the tank like a private scan", () => {
    const s = memoryStorage();
    saveTankPublication(WALLET, 6, { token: TOKEN }, s);
    const scan = resolveTankScan(`https://aquacellum.com/t/${TOKEN}`, { tanks, wallet: WALLET, storage: s });
    expect(scan).toEqual({ action: "open", tank: tanks[1] });
    expect(scan).toEqual(resolveTankScan("https://aquacellum.com/app#tank=6", { tanks, storage: s }));
  });

  it("someone else's public label offers the public page on this origin", () => {
    const s = memoryStorage();
    saveTankPublication(WALLET, 6, { token: OTHER }, s);
    expect(resolveTankScan(`https://aquacellum.com/t/${TOKEN}`, { tanks, wallet: WALLET, storage: s }))
      .toEqual({ action: "public", token: TOKEN, url: `/t/${TOKEN}` });
    expect(resolveTankScan(`https://aquacellum.com/t/${TOKEN}`, { tanks, wallet: null, storage: s }).action).toBe("public");
  });

  it("an owned token whose tank is gone from the account falls back to the public page", () => {
    const s = memoryStorage();
    saveTankPublication(WALLET, 42, { token: TOKEN }, s);
    expect(resolveTankScan(`https://aquacellum.com/t/${TOKEN}`, { tanks, wallet: WALLET, storage: s }).action).toBe("public");
  });

  it("anything else is unknown", () => {
    expect(resolveTankScan("https://example.com/menu", { tanks, storage: null })).toEqual({ action: "unknown" });
    expect(resolveTankScan("", { tanks, storage: null })).toEqual({ action: "unknown" });
    expect(resolveTankScan("https://aquacellum.com/t/short", {})).toEqual({ action: "unknown" });
  });
});
