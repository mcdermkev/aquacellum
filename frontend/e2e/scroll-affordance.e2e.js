/**
 * scroll-affordance.e2e.js
 *
 * Verifies the horizontal-scroll edge fade in a real engine.
 *
 * Beta feedback (384x757): tab bars holding more tabs than fit gave no hint that
 * sideways scrolling was possible. `resolveScrollEdges` is unit-tested in
 * src/__tests__/scrollAffordance.test.js — that covers the state machine, which is
 * where the original inverted-comparison bug lived. What a unit test CANNOT cover
 * is whether the CSS actually produces a visible fade and whether that fade eats
 * taps, so those are checked here.
 *
 * Deliberately self-contained: it injects the real index.css into a blank page
 * rather than driving the authenticated app. Booting the app to check a CSS mask
 * would make this test depend on login, seeding and routing — the failure mode
 * that turned a previous mobile-layout fix into fifteen inconclusive runs.
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const here = dirname(fileURLToPath(import.meta.url));
const APP_CSS = readFileSync(join(here, "..", "src", "styles", "index.css"), "utf8");

// Steve's reported viewport.
const PHONE = { width: 384, height: 757 };

const HARNESS = `
  <div id="bar" class="scroll-fade" style="display:flex; gap:8px; overflow-x:auto; width:240px;">
    ${Array.from({ length: 8 }, (_, i) => `<button id="chip${i}" style="flex-shrink:0; padding:8px 16px;">Tab ${i}</button>`).join("")}
  </div>
  <div id="fits" class="scroll-fade" style="display:flex; gap:8px; overflow-x:auto; width:240px;">
    <button style="flex-shrink:0; padding:8px 16px;">Only</button>
  </div>
`;

async function mount(page) {
  await page.setViewportSize(PHONE);
  await page.setContent(`<body style="margin:0;background:#0b1020;color:#fff">${HARNESS}</body>`);
  await page.addStyleTag({ content: APP_CSS });
}

/** The mask actually in effect, whichever property the engine reports it under. */
function maskOf(page, selector) {
  return page.$eval(selector, (el) => {
    const s = getComputedStyle(el);
    return s.maskImage || s.webkitMaskImage || "none";
  });
}

/**
 * Which end(s) of the mask are transparent, i.e. which edges actually fade.
 *
 * Reads the computed gradient rather than the source text, because engines
 * serialize `transparent` as `rgba(0, 0, 0, 0)` and normalise stop order — so a
 * substring check for the word "transparent" silently never matches. Comparing
 * the position of the transparent stop against the opaque one is what tells you
 * the fade is on the side it should be.
 */
function classify(mask) {
  if (!mask || mask === "none") return "none";
  const clear = mask.indexOf("rgba(0, 0, 0, 0)");
  const solid = mask.indexOf("rgb(0, 0, 0)"); // distinct token: "rgb(" not "rgba("
  const lastClear = mask.lastIndexOf("rgba(0, 0, 0, 0)");
  if (clear === -1) return "none";
  const fadesAtStart = clear < solid;
  const fadesAtEnd = lastClear > solid;
  if (fadesAtStart && fadesAtEnd) return "both";
  if (fadesAtEnd) return "end";
  if (fadesAtStart) return "start";
  return "none";
}

test.describe("horizontal scroll affordance", () => {
  test("a fade appears on the side that has hidden content, and only that side", async ({ page }) => {
    await mount(page);

    const edgeState = async (edges) => {
      await page.$eval("#bar", (el, e) => el.setAttribute("data-scroll-edges", e), edges);
      return classify(await maskOf(page, "#bar"));
    };

    // At rest. This is the state the old inline handler got wrong: no cue at all,
    // despite six tabs sitting off-screen to the right.
    expect(await edgeState("end"), "at rest the fade belongs on the RIGHT").toBe("end");

    // Scrolled to the far end: the cue must move to the left and NOT linger on the
    // right, or arriving at the last tab never confirms you have seen everything.
    expect(await edgeState("start"), "at the end the fade belongs on the LEFT").toBe("start");

    // Mid-scroll: both edges.
    expect(await edgeState("both"), "mid-scroll fades both ways").toBe("both");
  });

  test("no fade at all when the content fits", async ({ page }) => {
    await mount(page);
    await page.$eval("#fits", (el) => el.setAttribute("data-scroll-edges", "none"));
    expect(await maskOf(page, "#fits")).toBe("none");
  });

  test("the fade does not swallow taps on the tab underneath it", async ({ page }) => {
    // The reason this uses mask-image rather than an absolutely-positioned
    // gradient: a full-width overlay intercepts pointer events unless it
    // remembers pointer-events:none. A mask cannot make that mistake, and this
    // test is what stops someone "simplifying" it back into an overlay.
    await mount(page);
    await page.$eval("#bar", (el) => el.setAttribute("data-scroll-edges", "both"));
    await page.$eval("#bar", (el) => {
      el.addEventListener("click", (e) => {
        window.__clicked = e.target.id;
      });
    });

    // Scroll so a chip sits under the right-hand fade, then click it.
    await page.$eval("#bar", (el) => { el.scrollLeft = 40; });
    const target = await page.$eval("#bar", (el) => {
      const rect = el.getBoundingClientRect();
      // The chip nearest the right edge, i.e. the most faded one.
      const chips = [...el.querySelectorAll("button")];
      const under = chips.reverse().find((c) => {
        const r = c.getBoundingClientRect();
        return r.left < rect.right && r.right > rect.left;
      });
      return under ? under.id : null;
    });
    expect(target, "expected a chip under the fade").toBeTruthy();

    await page.click(`#${target}`, { force: true });
    expect(await page.evaluate(() => window.__clicked)).toBe(target);
  });

  test("the main nav's pseudo-element fades follow data-scroll-edges", async ({ page }) => {
    // The nav keeps the overlay-gradient approach because it is itself a glass
    // card, so fading to --glass-bg matches what is behind. Its old classes had
    // the right edge inverted; this pins the attribute-driven replacement.
    await page.setViewportSize(PHONE);
    await page.setContent(`
      <body style="margin:0;background:#0b1020">
        <nav id="nav" class="aquadex-nav glass-card aquadex-nav--pro" style="width:240px">
          ${Array.from({ length: 8 }, (_, i) => `<button class="aquadex-nav-tab">Tab ${i}</button>`).join("")}
        </nav>
      </body>
    `);
    await page.addStyleTag({ content: APP_CSS });

    const pseudo = (edges) =>
      page.$eval("#nav", (el, e) => {
        el.setAttribute("data-scroll-edges", e);
        const before = getComputedStyle(el, "::before");
        const after = getComputedStyle(el, "::after");
        return {
          left: before.content !== "none" && before.width !== "auto",
          right: after.content !== "none" && after.width !== "auto",
        };
      }, edges);

    // At rest: right cue only. The regression case.
    expect(await pseudo("end")).toEqual({ left: false, right: true });
    // At the end: left cue only.
    expect(await pseudo("start")).toEqual({ left: true, right: false });
    // Middle: both.
    expect(await pseudo("both")).toEqual({ left: true, right: true });
    // Fits: neither.
    expect(await pseudo("none")).toEqual({ left: false, right: false });
  });
});
