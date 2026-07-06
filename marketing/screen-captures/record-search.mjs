/**
 * Record the search-struggle HTML animation as a 9:16 MP4 video.
 *
 * Usage (from project root):
 *   node marketing/screen-captures/record-search.mjs
 *
 * Output: marketing/screen-captures/search-struggle-9x16.webm
 *   (Convert to MP4 with ffmpeg if needed:
 *    ffmpeg -i search-struggle-9x16.webm -c:v libx264 -pix_fmt yuv420p search-struggle-9x16.mp4)
 */

import { fileURLToPath } from 'url';
import path from 'path';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Resolve playwright from frontend/node_modules (where it's installed as a devDep)
const frontendDir = path.resolve(__dirname, '../../frontend');
const require = createRequire(path.join(frontendDir, 'node_modules', 'playwright', 'index.js'));
// createRequire needs a real file as base — use playwright's own index to resolve chromium
const playwright = require('playwright');
const { chromium } = playwright;

const HTML_PATH = path.join(__dirname, 'search-struggle.html');
const OUTPUT_PATH = path.join(__dirname, 'search-struggle-9x16.webm');

async function record() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1080, height: 1920 },
    deviceScaleFactor: 1,
    recordVideo: {
      dir: __dirname,
      size: { width: 1080, height: 1920 },
    },
  });

  const page = await context.newPage();

  console.log('Loading search-struggle.html...');
  await page.goto(`file://${HTML_PATH}`, { waitUntil: 'domcontentloaded' });

  // Wait for the animation to complete (~8.5s total runtime)
  console.log('Recording animation (~9s)...');
  await page.waitForSelector('.frustration-overlay.visible', { timeout: 15000 });

  // Hold the final frame for a beat
  await page.waitForTimeout(1500);

  // Close context to finalize the video file
  const video = page.video();
  await context.close();
  await browser.close();

  // Playwright saves with a random name — rename to our target
  if (video) {
    const savedPath = await video.path();
    const fs = await import('fs');
    if (savedPath && fs.existsSync(savedPath)) {
      fs.renameSync(savedPath, OUTPUT_PATH);
      const mb = fs.statSync(OUTPUT_PATH).size / (1024 * 1024);
      console.log(`\nDone! Saved: ${OUTPUT_PATH} (${mb.toFixed(1)} MB)`);
      console.log(`\nTo convert to MP4:`);
      console.log(`  ffmpeg -i "${OUTPUT_PATH}" -c:v libx264 -pix_fmt yuv420p "${OUTPUT_PATH.replace('.webm', '.mp4')}"`);
    } else {
      console.log('Warning: video file path not found. Check the directory for .webm files.');
    }
  }
}

record().catch(err => {
  console.error('Recording failed:', err);
  process.exit(1);
});
