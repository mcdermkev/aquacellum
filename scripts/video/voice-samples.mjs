// =============================================================================
// voice-samples.mjs — synthesize one Poseidon sample line across candidate
// voices so you can pick the narrator. Reusable: edit VOICES or LINE and re-run.
//
//   node scripts/video/voice-samples.mjs
//
// Output: scripts/video/samples/<voice>.mp3
// Uses AZURE_SPEECH_KEY / AZURE_SPEECH_REGION from .env.
// =============================================================================
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY = process.env.AZURE_SPEECH_KEY;
const REGION = process.env.AZURE_SPEECH_REGION;

// A representative, on-brand Poseidon line (calm, second person, no hype).
const LINE =
  "Welcome back to your fishroom. Let's log today's water test — temperature, pH, and ammonia — " +
  "and see how your tank is trending. When you're ready, I'll walk you through adding a new specimen.";

// Candidates that work over the REST TTS endpoint this pipeline uses.
// NOTE: DragonHD voices (e.g. en-US-Andrew:DragonHDLatest) are NOT reachable via
// this REST path — they require the Speech SDK (websocket). Left out on purpose.
const VOICES = [
  // standard neural
  'en-US-AndrewMultilingualNeural',
  'en-US-BrianMultilingualNeural',
  'en-US-AdamMultilingualNeural',
  'en-US-SteffanNeural',
  'en-US-DavisNeural',
  // MAI voices with media / persuasive / professional styling
  'en-US-Jasper:MAI-Voice-1',
  'en-US-Grant:MAI-Voice-1',
];

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'samples');
mkdirSync(outDir, { recursive: true });

function ssml(text, voice) {
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // HD/MAI voices reject the <prosody rate> wrapper — use a bare voice element.
  const inner = /DragonHD|MAI-Voice|Turbo/.test(voice) ? safe : `<prosody rate="-6%">${safe}</prosody>`;
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="en-US">` +
    `<voice name="${voice}">${inner}</voice></speak>`
  );
}

// Windows-safe filename (":" is illegal and creates an NTFS ADS).
const safeFile = (voice) => voice.replace(/[:]/g, '-');

async function synth(voice) {
  const res = await fetch(`https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': KEY,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-160kbitrate-mono-mp3',
      'User-Agent': 'aquacellum-voice-samples',
    },
    body: ssml(LINE, voice),
  });
  if (!res.ok) {
    console.log(`  ${voice}: FAIL ${res.status} ${(await res.text()).slice(0, 120)}`);
    return;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const file = join(outDir, `${safeFile(voice)}.mp3`);
  writeFileSync(file, buf);
  console.log(`  ${voice}: ${(buf.length / 1024).toFixed(0)} KB -> ${file}`);
}

console.log(`Synthesizing ${VOICES.length} voice samples...`);
for (const v of VOICES) await synth(v);
console.log('Done. Open scripts/video/samples/ and listen.');
