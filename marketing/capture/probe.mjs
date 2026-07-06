// Quick screenshot probe: what do the app tabs render WITHOUT a wallet login?
// Enters the dashboard via the localStorage flag, then snaps each target tab.
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = __dirname;
const BASE = "http://localhost:4200";

const TARGETS = [
  { name: "landing", path: "/" },
  { name: "gallery", path: "/app/gallery" },     // species database
  { name: "directory", path: "/app/directory" }, // marketplace
  { name: "reef", path: "/app/reef" },            // social feed + clubs
  { name: "map", path: "/app/map" },              // local breeder/club map
];

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 540, height: 960 },
  deviceScaleFactor: 2,
});
// Enter the dashboard without login; casual mode = the friendlier UI.
await ctx.addInitScript(() => {
  localStorage.setItem("aquadex_entered_dashboard", "true");
  localStorage.setItem("aquadex_casual_mode", "true");
});
const page = await ctx.newPage();

for (const t of TARGETS) {
  try {
    await page.goto(BASE + t.path, { waitUntil: "networkidle", timeout: 45000 });
  } catch (e) {
    console.log(`  ${t.name}: nav timeout (continuing) ${e.message}`);
  }
  await page.waitForTimeout(4000); // let contract/supabase reads settle
  const out = join(OUT, `probe-${t.name}.png`);
  await page.screenshot({ path: out, fullPage: false });
  console.log(`  saved ${out}`);
}

await browser.close();
console.log("done");
