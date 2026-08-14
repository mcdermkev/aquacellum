import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  POSEIDON_ACTION,
  ACTION_CLASS,
  POSEIDON_ACTIONS,
  KNOWN_ACTION_TYPES,
  actionClass,
  requiresConfirmation,
  isRunnable,
  actionLabel,
  actionConfirmLabel,
  allActionCopy,
} from "../utils/poseidonActions";
import { PROHIBITED_TERMS } from "../services/orderCopy";

const SRC = fileURLToPath(new URL("../", import.meta.url));
const read = (rel) => readFileSync(SRC + rel, "utf8");

// ─── Dexie + relayer stand-ins for the bridge ───────────────────────────────
let tanks = new Map();
let actionLogs = [];
let dispatched = [];

vi.mock("../db", () => ({
  db: {
    tanks: {
      get: vi.fn(async (id) => tanks.get(Number(id))),
      add: vi.fn(async (t) => { tanks.set(Number(t.id), t); return t.id; }),
      update: vi.fn(async (id, patch) => {
        const t = tanks.get(Number(id));
        if (t) tanks.set(Number(id), { ...t, ...patch });
      }),
    },
    actionLogs: { add: vi.fn(async (row) => { actionLogs.push(row); return actionLogs.length; }) },
    userProfile: {},
    transaction: vi.fn(async (_mode, _tables, fn) => fn()),
  },
}));

const { handlePoseidonAction } = await import("../utils/poseidonBridge");

beforeEach(() => {
  tanks = new Map();
  actionLogs = [];
  dispatched = [];
  vi.stubGlobal("window", {
    dispatchEvent: (e) => { dispatched.push({ type: e.type, detail: e.detail }); return true; },
    CustomEvent: globalThis.CustomEvent,
  });
});

describe("the action registry is the single source of truth", () => {
  /**
   * THE REGRESSION THIS FILE EXISTS FOR.
   *
   * The prompt advertised five actions; the bridge implemented two. Confirming a
   * LOG_WATER_PARAMS bar silently dropped the reading. These two tests make that
   * class of drift fail loudly instead.
   */
  it("declares every action type the server prompt advertises", () => {
    const ai = read("../api/ai.js");
    const block = ai.slice(ai.indexOf("## AVAILABLE ACTIONS"), ai.indexOf("## RESPONSE FORMAT"));
    const declared = [...block.matchAll(/^-\s*([A-Z_]{3,}):/gm)].map((m) => m[1]);

    expect(declared.length, "could not scrape the prompt's action list").toBeGreaterThanOrEqual(5);
    for (const type of declared) {
      expect(KNOWN_ACTION_TYPES, `prompt advertises "${type}" but the registry doesn't declare it`).toContain(type);
    }
  });

  it("every runnable action has a branch in the bridge", () => {
    const bridge = read("utils/poseidonBridge.js");
    for (const type of KNOWN_ACTION_TYPES.filter(isRunnable)) {
      // Either an explicit type comparison or a dedicated class handler.
      const handled =
        bridge.includes(`POSEIDON_ACTION.${type}`) ||
        bridge.includes(`'${type}'`) ||
        bridge.includes(`"${type}"`) ||
        (actionClass(type) === ACTION_CLASS.NAVIGATION && bridge.includes("runNavigate"));
      expect(handled, `"${type}" is runnable but the bridge has no branch for it`).toBe(true);
    }
  });

  it("no action is runnable without confirmation, and vice versa", () => {
    for (const type of KNOWN_ACTION_TYPES) {
      expect(isRunnable(type)).toBe(requiresConfirmation(type));
    }
  });

  it("classes the previously-silent no-ops as informational", () => {
    expect(actionClass(POSEIDON_ACTION.QUERY_COMPATIBILITY)).toBe(ACTION_CLASS.INFORMATIONAL);
    expect(actionClass(POSEIDON_ACTION.SUGGEST_SPECIES)).toBe(ACTION_CLASS.INFORMATIONAL);
    // …so no confirm bar is offered for a button that would do nothing.
    expect(requiresConfirmation(POSEIDON_ACTION.QUERY_COMPATIBILITY)).toBe(false);
    expect(requiresConfirmation(POSEIDON_ACTION.SUGGEST_SPECIES)).toBe(false);
  });

  it("classes the real writes as writes, and navigation as navigation", () => {
    expect(actionClass(POSEIDON_ACTION.CREATE_TANK)).toBe(ACTION_CLASS.WRITE);
    expect(actionClass(POSEIDON_ACTION.LOG_HUSBANDRY)).toBe(ACTION_CLASS.WRITE);
    expect(actionClass(POSEIDON_ACTION.LOG_WATER_PARAMS)).toBe(ACTION_CLASS.WRITE);
    expect(actionClass(POSEIDON_ACTION.NAVIGATE)).toBe(ACTION_CLASS.NAVIGATION);
    expect(requiresConfirmation(POSEIDON_ACTION.NONE)).toBe(false);
  });

  it("fails closed on an unknown type from the model", () => {
    expect(actionClass("DROP_EVERYTHING")).toBe(ACTION_CLASS.NONE);
    expect(requiresConfirmation("DROP_EVERYTHING")).toBe(false);
    // Still renders readably rather than printing a raw enum.
    expect(actionLabel("DROP_EVERYTHING")).toBe("drop everything");
  });

  it("neither host keeps its own copy of the action labels", () => {
    for (const file of ["components/PoseidonChatConsole.jsx", "components/PoseidonGlobalWidget.jsx"]) {
      const source = read(file);
      expect(source, `${file} still declares a local label map`).not.toMatch(/const labels = \{/);
      expect(source, `${file} must gate on requiresConfirmation`).toContain("requiresConfirmation(");
      // The old gate, matched precisely enough not to trip on a comment
      // explaining why it was replaced.
      expect(source, `${file} still gates on the raw NONE comparison`).not.toMatch(
        /lastMsg\.action\.type\s*!==\s*["']NONE["']/
      );
    }
  });
});

describe("action copy", () => {
  it("has a label for every declared type", () => {
    for (const type of KNOWN_ACTION_TYPES) {
      expect(POSEIDON_ACTIONS[type].label.casual).toBeDefined();
      expect(POSEIDON_ACTIONS[type].label.pro).toBeTruthy();
    }
  });

  it("uses no prohibited Web3 vocabulary", () => {
    for (const line of allActionCopy()) {
      const hit = PROHIBITED_TERMS.find((t) => line.toLowerCase().includes(t));
      expect(hit, `"${line}" contains "${hit}"`).toBeUndefined();
    }
  });

  it("gives navigation a reversible-sounding confirm", () => {
    expect(actionConfirmLabel(POSEIDON_ACTION.NAVIGATE, { casual: true })).toBe("Take me there");
  });
});

describe("LOG_WATER_PARAMS actually writes now", () => {
  beforeEach(() => {
    tanks.set(7, { id: 7, name: "Community", logs: [] });
  });

  it("appends the reading to the tank and updates latestLog", async () => {
    const res = await handlePoseidonAction({
      type: POSEIDON_ACTION.LOG_WATER_PARAMS,
      tankId: 7,
      payload: { temp: 24.5, ph: 7.2, ammonia: 0.25, nitrite: 0, nitrate: 5 },
    });

    expect(res.ok).toBe(true);
    expect(res.ran).toBe(true);

    const tank = tanks.get(7);
    expect(tank.logs).toHaveLength(1);
    // Stored in the schema's fixed-point scaling.
    expect(tank.logs[0].tempCelsiusX10).toBe(245);
    expect(tank.logs[0].phX10).toBe(72);
    expect(tank.logs[0].ammoniaPpmX100).toBe(25);
    expect(tank.logs[0].nitratePpmX100).toBe(500);
    expect(tank.latestLog).toEqual(tank.logs[0]);
  });

  it("records a matching care-log entry so it shows in the journal", async () => {
    await handlePoseidonAction({
      type: POSEIDON_ACTION.LOG_WATER_PARAMS,
      tankId: 7,
      payload: { ph: 7.4 },
    });
    expect(actionLogs).toHaveLength(1);
    expect(actionLogs[0].actionType).toBe("Quick Water Test");
    expect(actionLogs[0].tankId).toBe(7);
  });

  it("leaves an unsupplied reading absent rather than defaulting it to zero", async () => {
    // Defaulting ammonia to 0 would fabricate the one number a keeper acts on.
    await handlePoseidonAction({
      type: POSEIDON_ACTION.LOG_WATER_PARAMS,
      tankId: 7,
      payload: { ph: 7.4 },
    });
    const log = tanks.get(7).logs[0];
    expect(log.phX10).toBe(74);
    expect(log.ammoniaPpmX100).toBeNull();
    expect(log.nitritePpmX100).toBeNull();
  });

  it("writes nothing and reports it when there are no readings", async () => {
    const res = await handlePoseidonAction({
      type: POSEIDON_ACTION.LOG_WATER_PARAMS,
      tankId: 7,
      payload: {},
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("nothing-to-write");
    expect(tanks.get(7).logs).toHaveLength(0);
    expect(actionLogs).toHaveLength(0);
  });

  it("writes nothing when the tank doesn't exist", async () => {
    const res = await handlePoseidonAction({
      type: POSEIDON_ACTION.LOG_WATER_PARAMS,
      tankId: 999,
      payload: { ph: 7 },
    });
    expect(res.ok).toBe(false);
    expect(actionLogs).toHaveLength(0);
  });
});

describe("NAVIGATE", () => {
  it("dispatches aquadex:navigate-tab for a manifest destination", async () => {
    const res = await handlePoseidonAction({
      type: POSEIDON_ACTION.NAVIGATE,
      payload: { guideId: "spawning" },
    });
    expect(res.ok).toBe(true);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].type).toBe("aquadex:navigate-tab");
    expect(dispatched[0].detail).toEqual({ tab: "breeder", section: "spawning" });
  });

  it("uses aquadex:navigate-tab, never the thinner poseidon:navigate channel", async () => {
    await handlePoseidonAction({ type: POSEIDON_ACTION.NAVIGATE, payload: { guideId: "payouts" } });
    expect(dispatched.map((d) => d.type)).not.toContain("poseidon:navigate");
  });

  it("accepts an explicit tab/section pair that the manifest lists", async () => {
    const res = await handlePoseidonAction({
      type: POSEIDON_ACTION.NAVIGATE,
      payload: { tab: "tanks" },
    });
    expect(res.ok).toBe(true);
    expect(dispatched[0].detail).toEqual({ tab: "tanks" });
  });

  it("refuses a destination that isn't in the manifest", async () => {
    const res = await handlePoseidonAction({
      type: POSEIDON_ACTION.NAVIGATE,
      payload: { tab: "not-a-tab" },
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("unknown-destination");
    expect(dispatched).toHaveLength(0);
  });

  it("refuses to route to a retired surface", async () => {
    const res = await handlePoseidonAction({
      type: POSEIDON_ACTION.NAVIGATE,
      payload: { guideId: "tank-cam" },
    });
    expect(res.ok).toBe(false);
    expect(dispatched).toHaveLength(0);
  });

  it("writes nothing to the database", async () => {
    await handlePoseidonAction({ type: POSEIDON_ACTION.NAVIGATE, payload: { guideId: "spawning" } });
    expect(actionLogs).toHaveLength(0);
    expect(tanks.size).toBe(0);
  });
});

describe("informational actions", () => {
  it("are handled, run nothing, and report why", async () => {
    for (const type of [POSEIDON_ACTION.QUERY_COMPATIBILITY, POSEIDON_ACTION.SUGGEST_SPECIES, POSEIDON_ACTION.NONE]) {
      const res = await handlePoseidonAction({ type });
      expect(res.ok, `${type} should be handled`).toBe(true);
      expect(res.ran, `${type} should not run anything`).toBe(false);
    }
    expect(actionLogs).toHaveLength(0);
    expect(dispatched).toHaveLength(0);
  });

  it("returns a clear result for a missing action", async () => {
    expect((await handlePoseidonAction(null)).ok).toBe(false);
    expect((await handlePoseidonAction({})).ok).toBe(false);
  });
});
