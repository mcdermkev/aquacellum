/**
 * Fetch Species Images Pipeline
 * 
 * Searches iNaturalist for research-grade observation photos of species
 * missing images in fishbase_master.json, downloads them, and updates
 * the masterPhotoUrl field.
 * 
 * Falls back to Wikimedia Commons if iNaturalist has no results.
 * 
 * Usage:
 *   node scripts/fetch-species-images.js [--limit 10] [--dry-run]
 * 
 * Options:
 *   --limit N    Only process N species (useful for testing)
 *   --dry-run    Show what would be downloaded without actually downloading
 *   --skip-update  Download images but don't update fishbase_master.json
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');

// ---- Config ----
const FISHBASE_PATH = path.resolve(__dirname, '../frontend/public/fishbase_master.json');
const IMAGES_DIR = path.resolve(__dirname, '../frontend/public/species-images');
const RATE_LIMIT_MS = 1200; // Be polite to APIs — ~1 req/sec

// ---- CLI Args ----
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const skipUpdate = args.includes('--skip-update');
const limitIdx = args.indexOf('--limit');
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : Infinity;

// ---- Helpers ----
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function httpsGet(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Aquacellum-SpeciesImageFetcher/1.0 (contact: kevin@aquacellum.com)',
        ...options.headers
      }
    };

    const req = https.request(reqOptions, (res) => {
      // Handle redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location, options).then(resolve).catch(reject);
      }

      if (options.binary) {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode, data: Buffer.concat(chunks), headers: res.headers }));
      } else {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ status: res.statusCode, data, headers: res.headers }));
      }
    });

    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

function toFilename(scientificName) {
  return scientificName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '') + '.png';
}

// ---- iNaturalist Search ----
async function searchINaturalist(scientificName) {
  const query = encodeURIComponent(scientificName);
  const url = `https://api.inaturalist.org/v1/observations?taxon_name=${query}&quality_grade=research&photos=true&per_page=5&order_by=votes`;

  try {
    const res = await httpsGet(url);
    if (res.status !== 200) return null;

    const json = JSON.parse(res.data);
    if (!json.results || json.results.length === 0) return null;

    // Find the best photo (highest quality, most votes)
    for (const obs of json.results) {
      if (obs.photos && obs.photos.length > 0) {
        const photo = obs.photos[0];
        // iNaturalist URLs: replace 'square' or 'medium' with 'large' for high-res
        let photoUrl = photo.url || '';
        photoUrl = photoUrl.replace('/square.', '/large.').replace('/medium.', '/large.');

        if (photoUrl) {
          return {
            url: photoUrl,
            attribution: photo.attribution || 'iNaturalist',
            license: photo.license_code || 'CC-BY-NC',
            source: 'inaturalist'
          };
        }
      }
    }
    return null;
  } catch (err) {
    console.error(`    [iNaturalist error] ${err.message}`);
    return null;
  }
}

// ---- Wikimedia Commons Fallback ----
async function searchWikimedia(scientificName) {
  const query = encodeURIComponent(scientificName);
  const url = `https://commons.wikimedia.org/w/api.php?action=query&list=search&srsearch=${query}+fish&srnamespace=6&srlimit=5&format=json`;

  try {
    const res = await httpsGet(url);
    if (res.status !== 200) return null;

    const json = JSON.parse(res.data);
    if (!json.query || !json.query.search || json.query.search.length === 0) return null;

    // Get the first image file
    for (const result of json.query.search) {
      const title = result.title;
      if (!title.match(/\.(jpg|jpeg|png|webp)$/i)) continue;

      // Get the actual image URL
      const infoUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=800&format=json`;
      const infoRes = await httpsGet(infoUrl);
      if (infoRes.status !== 200) continue;

      const infoJson = JSON.parse(infoRes.data);
      const pages = infoJson.query?.pages;
      if (!pages) continue;

      const page = Object.values(pages)[0];
      const imageInfo = page?.imageinfo?.[0];
      if (!imageInfo) continue;

      // Check license
      const license = imageInfo.extmetadata?.LicenseShortName?.value || '';
      const allowedLicenses = ['CC BY', 'CC BY-SA', 'CC0', 'Public domain', 'CC BY 2.0', 'CC BY 3.0', 'CC BY 4.0', 'CC BY-SA 2.0', 'CC BY-SA 3.0', 'CC BY-SA 4.0'];
      const isAllowed = allowedLicenses.some(l => license.toLowerCase().includes(l.toLowerCase()));

      if (!isAllowed) continue;

      const imgUrl = imageInfo.thumburl || imageInfo.url;
      if (imgUrl) {
        return {
          url: imgUrl,
          attribution: imageInfo.extmetadata?.Artist?.value || 'Wikimedia Commons',
          license: license,
          source: 'wikimedia'
        };
      }
    }
    return null;
  } catch (err) {
    console.error(`    [Wikimedia error] ${err.message}`);
    return null;
  }
}

// ---- Download Image ----
async function downloadImage(imageUrl, destPath) {
  try {
    const res = await httpsGet(imageUrl, { binary: true });
    if (res.status !== 200) {
      console.error(`    [Download failed] HTTP ${res.status}`);
      return false;
    }

    // Verify we got actual image data (at least 5KB)
    if (res.data.length < 5000) {
      console.error(`    [Download failed] File too small (${res.data.length} bytes)`);
      return false;
    }

    fs.writeFileSync(destPath, res.data);
    return true;
  } catch (err) {
    console.error(`    [Download error] ${err.message}`);
    return false;
  }
}

// ---- Main Pipeline ----
async function main() {
  console.log('🐟 Aquacellum Species Image Fetcher');
  console.log('====================================');
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Limit: ${limit === Infinity ? 'all' : limit}`);
  console.log('');

  // Load database
  const fishbase = JSON.parse(fs.readFileSync(FISHBASE_PATH, 'utf-8'));
  const missing = fishbase.filter(sp => !sp.masterPhotoUrl || sp.masterPhotoUrl === '');

  console.log(`Total species: ${fishbase.length}`);
  console.log(`Missing images: ${missing.length}`);
  console.log(`Processing: ${Math.min(missing.length, limit)}`);
  console.log('');

  // Ensure images directory exists
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }

  const results = { success: 0, failed: 0, skipped: 0 };
  const attributions = [];
  const toProcess = missing.slice(0, limit);

  for (let i = 0; i < toProcess.length; i++) {
    const sp = toProcess[i];
    const filename = toFilename(sp.scientificName);
    const destPath = path.join(IMAGES_DIR, filename);

    console.log(`[${i + 1}/${toProcess.length}] ${sp.commonName || sp.scientificName} (${sp.scientificName})`);

    // Skip if file already exists
    if (fs.existsSync(destPath)) {
      console.log('    ✓ Image already exists, updating reference');
      const relPath = `/species-images/${filename}`;
      const idx = fishbase.findIndex(s => s.specCode === sp.specCode);
      if (idx !== -1) fishbase[idx].masterPhotoUrl = relPath;
      results.skipped++;
      continue;
    }

    if (dryRun) {
      console.log('    [dry-run] Would search iNaturalist + Wikimedia');
      results.skipped++;
      continue;
    }

    // Try iNaturalist first
    console.log('    Searching iNaturalist...');
    let photoData = await searchINaturalist(sp.scientificName);

    // Fallback to Wikimedia
    if (!photoData) {
      console.log('    Not found. Trying Wikimedia Commons...');
      await sleep(RATE_LIMIT_MS);
      photoData = await searchWikimedia(sp.scientificName);
    }

    if (!photoData) {
      console.log('    ✗ No image found on either source');
      results.failed++;
      await sleep(RATE_LIMIT_MS);
      continue;
    }

    console.log(`    Found on ${photoData.source} (${photoData.license})`);
    console.log(`    Downloading...`);

    const success = await downloadImage(photoData.url, destPath);

    if (success) {
      console.log(`    ✓ Saved as ${filename}`);
      const relPath = `/species-images/${filename}`;
      const idx = fishbase.findIndex(s => s.specCode === sp.specCode);
      if (idx !== -1) fishbase[idx].masterPhotoUrl = relPath;
      results.success++;

      attributions.push({
        species: sp.scientificName,
        source: photoData.source,
        license: photoData.license,
        attribution: photoData.attribution
      });
    } else {
      results.failed++;
    }

    // Rate limit
    await sleep(RATE_LIMIT_MS);
  }

  // Save updated fishbase
  if (!dryRun && !skipUpdate && results.success > 0) {
    fs.writeFileSync(FISHBASE_PATH, JSON.stringify(fishbase, null, 2), 'utf-8');
    console.log(`\n✓ Updated fishbase_master.json`);
  }

  // Save attributions log
  if (attributions.length > 0) {
    const attrPath = path.resolve(__dirname, '../frontend/public/species-images/ATTRIBUTIONS.json');
    let existing = [];
    if (fs.existsSync(attrPath)) {
      existing = JSON.parse(fs.readFileSync(attrPath, 'utf-8'));
    }
    const merged = [...existing, ...attributions];
    fs.writeFileSync(attrPath, JSON.stringify(merged, null, 2), 'utf-8');
    console.log(`✓ Saved attributions log (${attributions.length} new entries)`);
  }

  // Summary
  console.log('\n====================================');
  console.log('📊 Results:');
  console.log(`   ✓ Downloaded: ${results.success}`);
  console.log(`   ✗ Not found:  ${results.failed}`);
  console.log(`   ⊘ Skipped:    ${results.skipped}`);
  console.log(`   Total images now: ${fishbase.filter(s => s.masterPhotoUrl && s.masterPhotoUrl !== '').length}/${fishbase.length}`);
  console.log('====================================');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
