import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const SRC = read("../components/WhatsNewModal.jsx");
const HELPERS = read("../../e2e/helpers.js");

function items() {
  const block = SRC.match(/items:\s*\[([\s\S]*?)\]/);
  return block ? [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
}

describe("What's New", () => {
  it("lists 5 to 7 plain entries with no em dashes, exclamation points or crypto talk", () => {
    const list = items();
    expect(list.length).toBeGreaterThanOrEqual(5);
    expect(list.length).toBeLessThanOrEqual(7);
    for (const item of list) {
      expect(item).not.toMatch(/[—!]/);
      expect(item.toLowerCase()).not.toMatch(/crypto|wallet|relayer|contract/);
    }
  });

  it("never opens for a signed-out visitor", () => {
    expect(SRC).toMatch(/const \{ account \} = useAuth\(\)/);
    expect(SRC).toMatch(/if \(!account\) \{\s*setIsOpen\(false\);\s*return;/);
  });

  it("the e2e helper suppresses the current version", () => {
    const version = SRC.match(/CURRENT_VERSION = "([^"]+)"/)[1];
    expect(HELPERS).toContain(`"aquadex_last_seen_version", "${version}"`);
  });
});
