/**
 * Record the static HTML marketing pages (database, marketplace, reef/social)
 * as 9:16 video clips for the marketing video feature showcase (Shots 5–7).
 *
 * These are the public-facing landing pages (no auth, no beta banner) served
 * by the Vite dev server. They use the brand CSS and real content.
 *
 * Requires the Vite dev server running: npx vite --port 5199
 *
 * Usage:
 *   node marketing/screen-captures/record-app-pages.mjs
 *
 * Output: marketing/screen-captures/app-{page}-9x16.webm
 */

import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(__dirname, '../../frontend');
const require = createRequire(path.join(frontendDir, 'node_modules', 'playwright', 'index.js'));
const { chromium } = require('playwright');

const BASE_URL = 'http://localhost:5199';
const OUTPUT_DIR = __dirname;

// Static HTML pages to capture — polished marketing pages, no auth required
const PAGES = [
  {
    name: 'database',
    path: '/database.html',
    label: 'Species Database (database.html)',
    holdBefore: 1500,  // ms to hold at top before scrolling
    scrollSteps: 8,    // number of scroll increments
    scrollAmount: 350, // px per scroll step
    holdAfter: 2000,   // ms to hold at bottom
  },
  {
    name: 'marketplace',
    path: '/marketplace.html',
    label: 'Marketplace (marketplace.html)',
    holdBefore: 1500,
    scrollSteps: 8,
    scrollAmount: 350,
    holdAfter: 2000,
  },
  {
    name: 'social',
    path: '/reef.html',
    label: 'The Reef / Social (reef.html)',
    holdBefore: 1500,
    scrollSteps: 8,
    scrollAmount: 350,
    holdAfter: 2000,
  },
];

async function recordPage(pageConfig) {
  const outputPath = path.join(OUTPUT_DIR, `app-${pageConfig.name}-9x16.webm`);
  console.log(`\n  Recording: ${pageConfig.label}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    // Mobile viewport — the pages are responsive and look great on phone
    viewport: { width: 430, height: 932 },
    deviceScaleFactor: 2,
    recordVideo: {
      dir: OUTPUT_DIR,
      size: { width: 1080, height: 1920 },
    },
  });

  const page = await context.newPage();

  console.log(`    Loading ${pageConfig.path}...`);
  await page.goto(`${BASE_URL}${pageConfig.path}`, {
    waitUntil: 'networkidle',
    timeout: 15000,
  }).catch(() => {});

  // Hold at the top to show the hero section
  await page.waitForTimeout(pageConfig.holdBefore);

  // Smooth scroll down to showcase the page content
  console.log(`    Scrolling through content...`);
  for (let i = 0; i < pageConfig.scrollSteps; i++) {
    await page.evaluate((amount) => {
      window.scrollBy({ top: amount, behavior: 'smooth' });
    }, pageConfig.scrollAmount);
    await page.waitForTimeout(700);
  }

  // Hold at the bottom
  await page.waitForTimeout(pageConfig.holdAfter);

  // Finalize recording
  const video = page.video();
  await context.close();
  await browser.close();

  if (video) {
    const savedPath = await video.path();
    if (savedPath && fs.existsSync(savedPath)) {
      fs.renameSync(savedPath, outputPath);
      const mb = fs.statSync(outputPath).size / (1024 * 1024);
      console.log(`    Saved: ${path.basename(outputPath)} (${mb.toFixed(1)} MB)`);
    } else {
      console.log(`    Warning: video file not found after recording`);
    }
  }
}

async function main() {
  console.log('=== Recording Static HTML Pages for Marketing Video ===');
  console.log(`  Server: ${BASE_URL}`);
  console.log(`  Output: ${OUTPUT_DIR}`);
  console.log(`  Pages: database.html, marketplace.html, reef.html`);

  // Quick check that the server is up
  try {
    const resp = await fetch(`${BASE_URL}/database.html`);
    if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
  } catch (e) {
    console.error(`\n  ERROR: Dev server not reachable at ${BASE_URL}`);
    console.error(`  Start it with: cd frontend && npx vite --port 5199`);
    process.exit(1);
  }

  for (const pageConfig of PAGES) {
    await recordPage(pageConfig);
  }

  console.log('\n  All pages recorded!');
  console.log('  Use these as the feature showcase (Shots 5–7) in place of the');
  console.log('  Veo-generated UI clips. Layer Echo/god-ray effects on top in the editor.\n');
}

main().catch(err => {
  console.error('Recording failed:', err);
  process.exit(1);
});
