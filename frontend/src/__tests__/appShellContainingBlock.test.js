/**
 * The app shell must not become the containing block for `position: fixed`
 * descendants. A `perspective`, a `will-change: transform`, or a transform held
 * by an animation's `forwards` fill (even `scale(1)`) on an ancestor of the tab
 * content makes modals, drawers and sheets position against the shell instead of
 * the viewport. The mobile tank sheet rendered off-screen because of it.
 *
 * Source-level checks, same approach as settingsActiveTank.test.js.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";

const app = readFileSync(fileURLToPath(new URL("../App.jsx", import.meta.url)), "utf8");
// Comments stripped: the explanatory block names the properties it forbids.
const code = app.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("app shell leaves no containing block behind", () => {
  const mainTag = code.match(/<main className="app-main"[^>]*>/)?.[0] || "";

  it("main.app-main has no perspective", () => {
    expect(mainTag).not.toBe("");
    expect(mainTag).not.toMatch(/perspective/);
  });

  it("the mode-switch crossfade ends at transform: none", () => {
    const keyframes = code.match(/@keyframes crossfadeScale\s*\{[\s\S]*?\n\s*\}\s*\n/)?.[0] || "";
    expect(keyframes).toMatch(/100%\s*\{[^}]*transform:\s*none/);
  });

  it("the crossfade wrapper does not hold its end state or promote a transform layer", () => {
    const anim = code.match(/animation:\s*"crossfadeScale[^"]*"/)?.[0] || "";
    expect(anim).not.toBe("");
    expect(anim).not.toMatch(/\b(forwards|both)\b/);
    expect(code).not.toMatch(/willChange:\s*"[^"]*transform/);
  });
});
