/**
 * Assemble the Aquacellum marketing video rough cut.
 *
 * Takes the 8 Veo clips + the real screen captures and stitches them into
 * a single MP4. Screen captures replace Veo shots 5–7 (feature showcase).
 *
 * Usage:
 *   node marketing/assemble.mjs
 *
 * Output:
 *   marketing/aquacellum-launch-v2-9x16.mp4
 */

import { execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(__dirname, '../frontend');
const require = createRequire(path.join(frontendDir, 'node_modules', 'ffmpeg-static', 'index.js'));

// Get ffmpeg binary path from the npm package
const ffmpegStatic = require('ffmpeg-static');
const FFMPEG = ffmpegStatic;

const VEO_DIR = path.join(__dirname, 'veo-clips');
const CAPTURES_DIR = path.join(__dirname, 'screen-captures');
const TEMP_DIR = path.join(__dirname, 'temp-assembly');
const OUTPUT = path.join(__dirname, 'aquacellum-launch-v2-9x16.mp4');

// The final cut order:
// Shot 1: Veo character plate (guy in room)
// Shot 2: Veo Echo breaks through
// Shot 3: Veo Poseidon materializes
// Shot 4: Veo Echo joins + interface burst
// Shot 5: REAL database page (replaces Veo)
// Shot 6: REAL marketplace page (replaces Veo)
// Shot 7: REAL social/reef page (replaces Veo)
// Shot 8: Veo premium + CTA
const CLIPS = [
  { src: path.join(VEO_DIR, 'shot-01-9x16.mp4'), type: 'mp4' },
  { src: path.join(VEO_DIR, 'shot-02-9x16.mp4'), type: 'mp4' },
  { src: path.join(VEO_DIR, 'shot-03-9x16.mp4'), type: 'mp4' },
  { src: path.join(VEO_DIR, 'shot-04-9x16.mp4'), type: 'mp4' },
  { src: path.join(CAPTURES_DIR, 'app-database-9x16.webm'), type: 'webm' },
  { src: path.join(CAPTURES_DIR, 'app-marketplace-9x16.webm'), type: 'webm' },
  { src: path.join(CAPTURES_DIR, 'app-social-9x16.webm'), type: 'webm' },
  { src: path.join(VEO_DIR, 'shot-08-9x16.mp4'), type: 'mp4' },
];

function run(cmd) {
  try {
    execSync(cmd, { stdio: 'pipe', encoding: 'utf8' });
  } catch (e) {
    console.error(`  Command failed: ${cmd}`);
    console.error(e.stderr || e.message);
    process.exit(1);
  }
}

function main() {
  console.log('=== Assembling Aquacellum Marketing Video (Rough Cut) ===\n');

  // Verify all source clips exist
  for (const clip of CLIPS) {
    if (!fs.existsSync(clip.src)) {
      console.error(`  MISSING: ${clip.src}`);
      process.exit(1);
    }
  }
  console.log('  All source clips found.\n');

  // Create temp dir
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  // Step 1: Normalize all clips to the same format for concat
  // Target: 1080x1920, 30fps, H.264, AAC audio (or silent if none)
  const normalized = [];

  for (let i = 0; i < CLIPS.length; i++) {
    const clip = CLIPS[i];
    const outFile = path.join(TEMP_DIR, `part-${String(i + 1).padStart(2, '0')}.mp4`);
    normalized.push(outFile);

    const label = path.basename(clip.src);
    console.log(`  [${i + 1}/8] Normalizing: ${label}`);

    // Probe whether the source has an audio stream
    let hasAudio = false;
    try {
      const probeOut = execSync(
        `"${FFMPEG}" -i "${clip.src}" -hide_banner 2>&1`,
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      );
      hasAudio = probeOut.includes('Audio:');
    } catch (e) {
      const out = e.stderr || e.stdout || '';
      hasAudio = out.includes('Audio:');
    }

    // Build ffmpeg command:
    // - Input 0: the video/audio source
    // - Input 1 (if no audio): silent audio from lavfi
    // - Video: scale to 1080x1920, pad letterbox, 30fps
    // - Audio: copy/encode existing or map silent track
    let cmd;
    if (hasAudio) {
      cmd = [
        `"${FFMPEG}" -y`,
        `-i "${clip.src}"`,
        `-vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,fps=30"`,
        `-c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p`,
        `-c:a aac -b:a 128k -ar 44100 -ac 2`,
        `"${outFile}"`,
      ].join(' ');
    } else {
      // No audio — generate a silent track to match video duration
      cmd = [
        `"${FFMPEG}" -y`,
        `-i "${clip.src}"`,
        `-f lavfi -i anullsrc=r=44100:cl=stereo`,
        `-vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,fps=30"`,
        `-c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p`,
        `-c:a aac -b:a 128k`,
        `-map 0:v:0 -map 1:a:0 -shortest`,
        `"${outFile}"`,
      ].join(' ');
    }

    run(cmd);
  }

  console.log('\n  All clips normalized.\n');

  // Step 2: Write concat file
  const concatFile = path.join(TEMP_DIR, 'concat.txt');
  const concatContent = normalized.map(f => `file '${f.replace(/\\/g, '/')}'`).join('\n');
  fs.writeFileSync(concatFile, concatContent);

  // Step 3: Concatenate
  console.log('  Concatenating into final cut...');
  const concatCmd = [
    `"${FFMPEG}"`,
    `-f concat -safe 0`,
    `-i "${concatFile}"`,
    `-c copy`,
    `-y "${OUTPUT}"`,
  ].join(' ');

  run(concatCmd);

  // Step 4: Report
  const mb = fs.statSync(OUTPUT).size / (1024 * 1024);
  console.log(`\n  Done! Final cut: ${OUTPUT}`);
  console.log(`  Size: ${mb.toFixed(1)} MB`);

  // Get duration
  try {
    const probe = execSync(
      `"${FFMPEG}" -i "${OUTPUT}" 2>&1`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).toString();
    const match = probe.match(/Duration: ([\d:.]+)/);
    if (match) console.log(`  Duration: ${match[1]}`);
  } catch (e) {
    // ffmpeg returns non-zero when just probing, check stderr
    const out = e.stderr || e.stdout || '';
    const match = out.match(/Duration: ([\d:.]+)/);
    if (match) console.log(`  Duration: ${match[1]}`);
  }

  // Clean up temp
  console.log('\n  Cleaning up temp files...');
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });

  console.log('\n  Assembly complete!');
  console.log('  Next steps in your editor:');
  console.log('    1. Composite search-struggle-9x16.webm over Shot 1 CRT monitor');
  console.log('    2. Add text overlays (queries, feature captions, CTA)');
  console.log('    3. Add the Aquacellum wordmark in the outro');
  console.log('    4. Add music track (90s synth → oceanic drop)');
  console.log('    5. Export final 9:16 + 16:9 versions\n');
}

main();
