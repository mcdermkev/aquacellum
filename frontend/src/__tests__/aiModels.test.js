import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  AI_TASKS,
  AI_LOCATION,
  KNOWN_MODELS,
  modelFor,
  fallbackFor,
  configuredModels,
  expiringModels,
} from "../../api/_lib/aiModels.js";
import { buildVertexUrl } from "../../api/_lib/vertexClient.js";

/**
 * Guards for the AI model configuration.
 *
 * Two Google model retirements have already forced a code change here. These
 * tests pin the two things that make the next one a config change instead:
 * that no model name is hardcoded at a call site, and that a model's serving
 * LOCATION travels with it (the gemini-3.x line only exists on the global
 * endpoint, which is a different host — getting that wrong 404s in a way that
 * looks like a bad model name).
 */

const API = fileURLToPath(new URL("../../api/", import.meta.url));
const read = (rel) => readFileSync(API + rel, "utf8");

const ENV_KEYS = [];
afterEach(() => {
  for (const k of ENV_KEYS.splice(0)) delete process.env[k];
});
const setEnv = (k, v) => { ENV_KEYS.push(k); process.env[k] = v; };

describe("no call site hardcodes a model name", () => {
  it("api/ai.js resolves every model through modelFor()", () => {
    const source = read("ai.js");
    const literals = [...source.matchAll(/vertexGenerateContent\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(literals, `hardcoded model literal(s): ${literals.join(", ")}`).toEqual([]);
    // And it really does use the registry.
    expect(source).toContain("modelFor('CHAT')");
    expect(source).toContain("modelFor('EXTRACT')");
  });

  it("api/parse-search.js resolves its model through modelFor()", () => {
    const source = read("parse-search.js");
    const literals = [...source.matchAll(/vertexGenerateContent\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(literals).toEqual([]);
    expect(source).toContain("modelFor('SEARCH')");
  });

  it("the health check pings the configured models, not its own copy of a name", () => {
    const source = read("ai.js");
    expect(source).toContain("configuredModels()");
    // The old bug: a second hardcoded name that could disagree with production.
    expect(source).not.toMatch(/testRes = await vertexGenerateContent\(\s*['"]gemini/);
  });
});

describe("modelFor", () => {
  it("resolves every declared task to a model and a location", () => {
    for (const task of AI_TASKS) {
      const cfg = modelFor(task);
      expect(cfg.model, `${task} has no model`).toBeTruthy();
      expect(cfg.location, `${task} has no location`).toBeTruthy();
      expect(cfg.source).toBe("default");
    }
  });

  it("is case-insensitive on the task name", () => {
    expect(modelFor("chat").model).toBe(modelFor("CHAT").model);
  });

  it("throws on an unknown task rather than silently picking something", () => {
    expect(() => modelFor("TRANSLATE")).toThrow(/Unknown AI task/);
  });

  it("lets an env var override the model — the whole point of this module", () => {
    setEnv("AI_MODEL_CHAT", "gemini-3.5-flash-lite");
    const cfg = modelFor("CHAT");
    expect(cfg.model).toBe("gemini-3.5-flash-lite");
    expect(cfg.source).toBe("env");
    // And it picks up that model's real location automatically, which is the
    // part a manual migration would get wrong.
    expect(cfg.location).toBe(AI_LOCATION.GLOBAL);
  });

  it("assumes regional for an unlisted override but allows an explicit location", () => {
    setEnv("AI_MODEL_CHAT", "some-future-model");
    expect(modelFor("CHAT").location).toBe(AI_LOCATION.REGIONAL);
    setEnv("AI_LOCATION_CHAT", "global");
    expect(modelFor("CHAT").location).toBe("global");
  });

  it("ignores a blank env override instead of resolving to an empty model", () => {
    setEnv("AI_MODEL_CHAT", "   ");
    expect(modelFor("CHAT").source).toBe("default");
  });
});

describe("the known-model table matches what was probed", () => {
  it("puts the whole gemini-3.x line on the global endpoint", () => {
    // Probed 2026-08-11: these 404 on us-central1 (v1 and v1beta1).
    for (const [name, cfg] of Object.entries(KNOWN_MODELS)) {
      if (name.startsWith("gemini-3")) {
        expect(cfg.location, `${name} must be global`).toBe(AI_LOCATION.GLOBAL);
      }
    }
  });

  it("keeps the 2.5 line regional", () => {
    expect(KNOWN_MODELS["gemini-2.5-flash"].location).toBe(AI_LOCATION.REGIONAL);
    expect(KNOWN_MODELS["gemini-2.5-flash-lite"].location).toBe(AI_LOCATION.REGIONAL);
  });

  it("every task default and fallback is a known model", () => {
    for (const task of AI_TASKS) {
      expect(KNOWN_MODELS, `${task} default unknown`).toHaveProperty(modelFor(task).model);
      const fb = fallbackFor(task);
      if (fb) expect(KNOWN_MODELS, `${task} fallback unknown`).toHaveProperty(fb.model);
    }
  });

  it("gives every task a fallback, so a retirement degrades instead of breaking", () => {
    for (const task of AI_TASKS) {
      const fb = fallbackFor(task);
      expect(fb, `${task} has no fallback`).not.toBeNull();
      expect(fb.model).not.toBe(modelFor(task).model);
    }
  });
});

describe("configuredModels + expiringModels", () => {
  it("de-duplicates models shared by several tasks and lists their tasks", () => {
    const models = configuredModels();
    const ids = models.map((m) => `${m.model}@${m.location}`);
    expect(new Set(ids).size).toBe(ids.length);
    const allTasks = models.flatMap((m) => m.tasks).sort();
    expect(allTasks).toEqual([...AI_TASKS].sort());
  });

  it("reports nothing expiring while no sunset date is recorded", () => {
    // Sunset dates are unknown until read off the retirement email; the point is
    // that recording one here makes it visible instead of inbox-only.
    expect(expiringModels(60)).toEqual([]);
  });

  it("flags a model once its recorded sunset is inside the window", () => {
    setEnv("AI_MODEL_CHAT", "gemini-2.5-flash");
    const soon = new Date(Date.now() + 10 * 86400000).toISOString();
    const original = KNOWN_MODELS["gemini-2.5-flash"].sunsetOn;
    try {
      KNOWN_MODELS["gemini-2.5-flash"].sunsetOn = soon;
      const flagged = expiringModels(60);
      expect(flagged.length).toBeGreaterThan(0);
      expect(flagged[0].daysLeft).toBeLessThanOrEqual(10);
    } finally {
      KNOWN_MODELS["gemini-2.5-flash"].sunsetOn = original;
    }
  });
});

describe("buildVertexUrl", () => {
  it("uses the regional host for a regional location", () => {
    const url = buildVertexUrl({ project: "p", location: "us-central1", model: "gemini-2.5-flash" });
    expect(url).toBe(
      "https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent"
    );
  });

  it("uses the UNPREFIXED host for global — a different host, not just a path", () => {
    // This is the bug that would otherwise make every gemini-3.x model 404.
    const url = buildVertexUrl({ project: "p", location: "global", model: "gemini-3.5-flash-lite" });
    expect(url).toContain("https://aiplatform.googleapis.com/");
    expect(url).not.toContain("global-aiplatform");
    expect(url).toContain("/locations/global/");
  });
});
