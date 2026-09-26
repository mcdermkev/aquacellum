// =============================================================================
// tts.mjs  —  synthesize Poseidon narration for generated episode scripts.
//
// Reads scripts/video/out/*.json and, for each, synthesizes every beat's
// narration with Azure Neural TTS (the Poseidon voice, AZURE_SPEECH_VOICE) into
// scripts/video/out/audio/<id>/beat-NN.mp3, plus a concatenated <id>.mp3 preview.
//
// RUN
//   node scripts/video/tts.mjs                 # all episode json in out/
//   node scripts/video/tts.mjs orders-escrow   # one episode
//
// ENV (from .env): AZURE_SPEECH_KEY, AZURE_SPEECH_REGION, AZURE_SPEECH_VOICE
// =============================================================================

import 'dotenv/config';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const AUDIO_DIR = join(OUT_DIR, 'audio');

const KEY = process.env.AZURE_SPEECH_KEY;
const REGION = process.env.AZURE_SPEECH_REGION;
const VOICE = process.env.AZURE_SPEECH_VOICE;

/** Build SSML for one narration line using the Poseidon voice. */
export function ssmlFor(text, voice) {
  const safe = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" ` +
    `xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">` +
    `<voice name="${voice}"><prosody rate="-6%">${safe}</prosody></voice></speak>`
  );
}

/** @param {string} ssml @returns {Promise<Buffer>} mp3 bytes */
export async function synthesize(ssml) {
  const res = await fetch(`https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': KEY,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-160kbitrate-mono-mp3',
      'User-Agent': 'aquacellum-tts',
    },
    body: ssml,
  });
  if (!res.ok) throw new Error(`Azure TTS ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

const pad = (n) => String(n).padStart(2, '0');

async function synthEpisode(id) {
  const script = JSON.parse(readFileSync(join(OUT_DIR, `${id}.json`), 'utf8'));
  const dir = join(AUDIO_DIR, id);
  mkdirSync(dir, { recursive: true });

  const parts = [];
  let chars = 0;
  let beatNo = 0;
  for (const beat of script.beats) {
    const text = (beat?.narration || '').trim();
    if (!text) continue;
    beatNo += 1;
    const buf = await synthesize(ssmlFor(text, VOICE));
    writeFileSync(join(dir, `beat-${pad(beatNo)}.mp3`), buf);
    parts.push(buf);
    chars += text.length;
  }
  if (parts.length) {
    writeFileSync(join(dir, `${id}.mp3`), Buffer.concat(parts)); // naive concat; fine for preview
  }
  console.log(`  ${id}: ${beatNo} beat(s), ${chars} chars -> ${dir}`);
  return chars;
}

async function main() {
  if (!KEY || !REGION || !VOICE) {
    console.error('Missing Azure Speech env vars. Check .env.');
    process.exit(1);
  }
  const only = process.argv[2];
  let ids;
  try {
    ids = readdirSync(OUT_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''));
  } catch {
    console.error(`No output dir yet (${OUT_DIR}). Run generate-scripts.mjs first.`);
    process.exit(1);
  }
  if (only) ids = ids.filter((id) => id === only);
  if (ids.length === 0) {
    console.error(only ? `No script found for "${only}". Run generate-scripts first.` : 'No scripts in out/.');
    process.exit(1);
  }

  console.log(`Synthesizing narration with voice: ${VOICE}`);
  let total = 0;
  for (const id of ids) total += await synthEpisode(id);
  console.log(`\nTotal characters synthesized: ${total}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
