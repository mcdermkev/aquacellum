/**
 * Native <select> theming invariants.
 *
 * ## Why this test exists
 *
 * "The dropdown is white-on-white and unreadable" was fixed reactively at least
 * three times, in three different component stylesheets, each time only after a
 * human opened that particular dropdown and noticed. ProOpsGrid.css even carried
 * the comment "Dark the native dropdown list so it never flashes white".
 *
 * The bug is structural, not a series of oversights. A <select>'s POPUP LIST is
 * painted by the OS/UA, not by our CSS. Without `color-scheme`, the UA assumes a
 * light page and paints that list white, while the option text inherits our
 * near-white `--text-primary` from the select. The closed control looks perfect,
 * so the defect is invisible in review, in screenshots, and in any test that
 * doesn't physically open the menu — it ships every time.
 *
 * So the fix has to be global and the guard has to be structural. This asserts
 * the two global declarations stay in place, and that components don't drift
 * back to per-component copies (which is how hardcoded hexes diverged from the
 * theme in the first place).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const GLOBAL_CSS = readFileSync(join(SRC, "styles", "index.css"), "utf8");

/** Every .css file under src/, except the global stylesheet itself. */
function componentStylesheets(dir = SRC, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) componentStylesheets(full, out);
    else if (entry.endsWith(".css") && !full.includes(join("styles", "index.css"))) {
      out.push(full);
    }
  }
  return out;
}

/** Strip CSS block comments, so prose describing a banned pattern is not itself
 *  treated as a violation. */
const stripCss = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");

describe("global dark-UI declaration (the root fix)", () => {
  it("declares color-scheme: dark on :root", () => {
    // This one line is what makes the UA paint native controls dark: select
    // popups, scrollbars, date pickers, autofill. Removing it silently
    // reintroduces white-on-white dropdowns across the whole app.
    const root = stripCss(GLOBAL_CSS).match(/:root\s*\{[\s\S]*?\}/);
    expect(root, ":root block should exist").toBeTruthy();
    expect(root[0]).toMatch(/color-scheme:\s*dark/);
  });

  it("also sets explicit option/optgroup colors as the fallback layer", () => {
    // Belt-and-braces for engines that ignore color-scheme for the popup list.
    const css = stripCss(GLOBAL_CSS);
    expect(css).toMatch(/select\s+option[\s\S]{0,80}\{/);
    expect(css).toMatch(/select\s+option[\s\S]*?background-color:\s*var\(--bg-secondary\)/);
    expect(css).toMatch(/select\s+option[\s\S]*?color:\s*var\(--text-primary\)/);
  });

  it("never gives an option a TRANSLUCENT background", () => {
    // Learned the hard way while building this fix: tinting the selected row
    // with the translucent --accent-blue-glow computed to rgba(56,189,248,0.15)
    // and dropped option contrast to 2.05:1 (measured in a real browser).
    //
    // A translucent option fill composites over whatever the UA paints beneath
    // it, so its contrast is not something we control — which is the exact
    // failure mode (unreadable dropdown text) this whole block exists to
    // prevent. Option backgrounds must be opaque, or absent so the UA paints
    // its own dark-theme highlight.
    const css = stripCss(GLOBAL_CSS);
    const optionRules = css.match(/[^{}]*\boption\b[^{}]*\{[^}]*\}/g) || [];
    expect(optionRules.length).toBeGreaterThan(0);
    for (const rule of optionRules) {
      const bg = rule.match(/background(-color)?\s*:\s*([^;]+)/);
      if (!bg) continue;
      // rgba()/hsla() with a fractional alpha, or a var() whose name says "glow".
      expect(bg[2], `translucent option background: ${bg[2].trim()}`).not.toMatch(
        /rgba?\([^)]*,\s*0?\.\d+\s*\)|hsla?\([^)]*,\s*0?\.\d+\s*\)|glow/i
      );
    }
  });

  it("themes option colors from theme vars, not hardcoded hexes", () => {
    // The three per-component copies this replaced hardcoded #0a1929, which had
    // already drifted from --bg-secondary (#0e1424) and would not follow the
    // high-contrast theme.
    const optionRule = stripCss(GLOBAL_CSS).match(/select\s+option[\s\S]*?\{[\s\S]*?\}/);
    expect(optionRule).toBeTruthy();
    expect(optionRule[0]).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("gives a bare <select> a readable default so new ones need no CSS", () => {
    const css = stripCss(GLOBAL_CSS);
    expect(css).toMatch(/(^|\n)\s*select\s*\{[\s\S]*?color:\s*var\(--text-primary\)/);
  });
});

describe("components do not re-add per-component dropdown theming", () => {
  const sheets = componentStylesheets();

  it("finds component stylesheets to check (guards against a broken glob)", () => {
    expect(sheets.length).toBeGreaterThan(10);
  });

  it("no component stylesheet styles `option` colors locally", () => {
    // Local copies are the duplication that caused the drift. If a component
    // genuinely needs a bespoke dropdown surface, change the global rule or the
    // theme var so every dropdown moves together.
    const offenders = [];
    for (const file of sheets) {
      const css = stripCss(readFileSync(file, "utf8"));
      const rules = css.match(/[^{}]*\boption\b[^{}]*\{[^}]*\}/g) || [];
      for (const rule of rules) {
        if (/background(-color)?\s*:|(^|[^-])\bcolor\s*:/.test(rule)) {
          offenders.push(`${file.replace(SRC, "src")} -> ${rule.split("{")[0].trim()}`);
        }
      }
    }
    expect(offenders, `move these into the global rule in styles/index.css:\n${offenders.join("\n")}`)
      .toEqual([]);
  });
});
