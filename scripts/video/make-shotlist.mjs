// =============================================================================
// make-shotlist.mjs — generate SHOT_LIST.md, the OBS recording guide.
//
// Reads scripts/video/out/*.json + episodes.mjs and emits a per-episode shot
// list: the route(s) to open, which mode to be in, what to seed first, and a
// numbered beat table (on-screen action + narration + matching audio clip +
// rough seconds). Re-run after regenerating scripts to keep it in sync.
//
//   node scripts/video/make-shotlist.mjs
// =============================================================================

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EPISODES } from './episodes.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const HOST = 'http://localhost:3000'; // `npm run dev` (vercel dev) in frontend/

// Per-episode recording context. Routes reflect the real app router:
//   /app/<tab>  and  /app/breeder?section=<slug>
const ROUTE_MAP = {
  aquariums: {
    route: `${HOST}/app/tanks`,
    mode: 'Casual — switch to Pro for the Tree view, Fish Room Ops, and Specimens/History beats',
    seed: 'Run scripts/seed-rich-dev-mode.js so tanks have water-test history and fish.',
  },
  'fish-finder': {
    route: `${HOST}/app/gallery`,
    mode: 'Casual (Fish Finder). Toggle to Pro for the Breed Gallery beats.',
    seed: 'Collect/wishlist a few species so the dex is populated; set an active tank for compatibility scoring.',
  },
  'breeder-tools': {
    route: `${HOST}/app/breeder?section=register`,
    mode: 'Pro',
    seed: 'Seed specimens, at least one completed spawn, and a submitted morph.',
    sequence: ['register', 'lineage', 'spawning', 'genetics', 'growout', 'morphs', 'achievements'].map(
      (s) => `${HOST}/app/breeder?section=${s}`
    ),
  },
  marketplace: {
    route: `${HOST}/app/directory`,
    mode: 'Either (buyers see this in both modes)',
    seed: 'Seed active listings and a couple of Wanted-board posts.',
  },
  'orders-escrow': {
    route: `${HOST}/app/orders`,
    mode: 'Either',
    seed: 'Seed orders across Active/Completed/Disputed, one in-transit shipment (so the Incoming tab appears), and a pickup order for the PIN/QR handshake beat.',
    note: 'The Incoming tab only appears when an item is in transit — seed that first or it will be missing.',
  },
  'the-reef': {
    route: `${HOST}/app/reef`,
    mode: 'Either',
    seed: 'Seed a social feed, a school/group, and an upcoming event so Feed/Groups/Events are not empty.',
  },
  'settings-privacy': {
    route: `${HOST}/app/settings`,
    mode: 'Either',
    seed: 'None required.',
  },
  'seller-hub': {
    route: `${HOST}/app/breeder-terminal`,
    mode: 'Pro (Seller Hub / Breeder Terminal)',
    seed: 'Complete seller onboarding, add listings, have a payout balance and an order needing action.',
    note: 'Currently open to any logged-in user (beta allowlist).',
  },
  'poseidon-echo': {
    route: `${HOST}/app/tanks`,
    mode: 'Casual (Echo is casual-only)',
    seed: 'Open the Poseidon widget (floating button) and the Echo widget / full-screen from the tanks sidebar.',
  },
  'casual-vs-pro': {
    route: `${HOST}/app/tanks`,
    mode: 'Both — the episode IS the toggle; use the header Casual/Pro switch on camera.',
    seed: 'Same rich seed as aquariums so both modes look populated.',
  },
  trailer: {
    route: `montage across ${HOST}/app/tanks, /app/gallery, /app/breeder, /app/directory, /app/reef`,
    mode: 'Both',
    seed: 'Everything seeded; grab 2-3s glamour shots per tab.',
  },
};

const estSeconds = (text) => Math.max(2, Math.round((text.trim().split(/\s+/).length / 140) * 60));
const pad = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

function episodeBlock(episode) {
  const ctx = ROUTE_MAP[episode.id] || {};
  const scriptPath = join(OUT_DIR, `${episode.id}.json`);
  const script = JSON.parse(readFileSync(scriptPath, 'utf8'));

  const lines = [];
  lines.push(`## ${episode.title}  \`(${episode.id})\``);
  lines.push('');
  lines.push(`- **Open:** ${ctx.route || '(set route)'}`);
  lines.push(`- **Mode:** ${ctx.mode || episode.mode}`);
  lines.push(`- **Echo cameo:** ${episode.echoCameo ? 'yes — intro/outro + one cameo beat' : 'no'}`);
  lines.push(`- **Seed first:** ${ctx.seed || '(none)'}`);
  if (ctx.sequence) lines.push(`- **Section deep-links (in order):** ${ctx.sequence.join('  →  ')}`);
  if (ctx.note) lines.push(`- **Note:** ${ctx.note}`);
  if (episode.reviewGate) lines.push(`- **Review gate:** cleared by Opus (money/ownership claims verified).`);
  lines.push('');
  lines.push('| # | Audio clip | ~sec | On screen (what to record) | Narration |');
  lines.push('|---|---|---|---|---|');

  let n = 0;
  let total = 0;
  for (const beat of script.beats) {
    const narration = (beat.narration || '').trim();
    if (!narration) continue;
    n += 1;
    const sec = estSeconds(narration);
    total += sec;
    lines.push(`| ${n} | beat-${pad(n)}.mp3 | ${sec} | ${esc(beat.onScreen || '')} | ${esc(narration)} |`);
  }
  const mm = Math.floor(total / 60);
  const ss = String(total % 60).padStart(2, '0');
  lines.push('');
  lines.push(`_Estimated runtime: ~${mm}:${ss} across ${n} beats._`);
  lines.push('');
  return lines.join('\n');
}

function build() {
  const ids = readdirSync(OUT_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''));
  const ordered = EPISODES.filter((e) => ids.includes(e.id));

  const head = [
    '# Aquacellum — YouTube Shot List',
    '',
    '_Generated by `scripts/video/make-shotlist.mjs`. Re-run after changing scripts._',
    '',
    '## Recording setup (do once)',
    '',
    '1. Start the app: `npm run dev` in `frontend/` (serves the /api functions on http://localhost:3000).',
    '2. Seed demo data so screens are not empty (see each episode\'s "Seed first").',
    '3. OBS: 1920x1080 @ 60fps, **Window Capture** on the maximized browser, output MP4.',
    '4. Record each beat as its own short clip so files map to `beat-NN.mp3`.',
    '5. Move the cursor deliberately; pause briefly on each screen before acting.',
    '',
    `Narration audio for every beat is in \`scripts/video/out/audio/<id>/\`. Voice: Poseidon (Andrew).`,
    '',
    '---',
    '',
  ].join('\n');

  const body = ordered.map(episodeBlock).join('\n---\n\n');
  writeFileSync(join(__dirname, 'SHOT_LIST.md'), head + body, 'utf8');
  console.log(`Wrote SHOT_LIST.md covering ${ordered.length} episode(s).`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  build();
}
