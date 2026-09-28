// =============================================================================
// generate-scripts.mjs  —  script generator for the YouTube feature series.
//
// For each episode in episodes.mjs: slice the matching section(s) out of
// docs/APP_FEATURE_MAP.md, call Azure OpenAI with SYSTEM_PROMPT +
// buildUserPrompt(), parse the strict-JSON reply, validate it, and write it to
// scripts/video/out/<episode.id>.json. Review-gated episodes also get a
// <id>.REVIEW.md flag file.
//
// RUN
//   node scripts/video/generate-scripts.mjs            # all episodes
//   node scripts/video/generate-scripts.mjs orders-escrow   # one episode
//
// ENV (from .env — see .env.example "Azure — Video Pipeline" block)
//   AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY,
//   AZURE_OPENAI_DEPLOYMENT, AZURE_OPENAI_API_VERSION
// =============================================================================

import 'dotenv/config';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EPISODES } from './episodes.mjs';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const FEATURE_MAP = join(REPO_ROOT, 'docs', 'APP_FEATURE_MAP.md');
const OUT_DIR = join(__dirname, 'out');

const ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT?.replace(/\/$/, '');
const API_KEY = process.env.AZURE_OPENAI_API_KEY;
const DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT;
const API_VERSION = process.env.AZURE_OPENAI_API_VERSION;

/**
 * Parse APP_FEATURE_MAP.md into a map of "## heading text" -> section markdown.
 * @param {string} md
 * @returns {Map<string, string>}
 */
function parseSections(md) {
  const sections = new Map();
  const lines = md.split(/\r?\n/);
  let heading = null;
  let buf = [];
  const flush = () => {
    if (heading !== null) sections.set(heading, buf.join('\n').trim());
  };
  for (const line of lines) {
    const m = /^##\s+(.*\S)\s*$/.exec(line);
    if (m) {
      flush();
      heading = m[1].trim();
      buf = [line];
    } else if (heading !== null) {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

/**
 * @param {string} md  full feature-map markdown
 * @param {string[]} sectionHeadings
 * @returns {string}
 */
export function sliceSections(md, sectionHeadings) {
  const sections = parseSections(md);
  const out = [];
  for (const h of sectionHeadings) {
    const body = sections.get(h.trim());
    if (!body) {
      const available = [...sections.keys()].map((k) => `  - ${k}`).join('\n');
      throw new Error(`Section not found in APP_FEATURE_MAP.md: "${h}"\nAvailable:\n${available}`);
    }
    out.push(body);
  }
  return out.join('\n\n');
}

/** @param {{system:string,user:string}} messages @returns {Promise<object>} */
export async function callAzureOpenAI({ system, user }) {
  const url = `${ENDPOINT}/openai/deployments/${DEPLOYMENT}/chat/completions?api-version=${API_VERSION}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'api-key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.7,
      max_tokens: 2500,
    }),
  });
  if (!res.ok) {
    throw new Error(`Azure OpenAI ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Azure OpenAI returned no content');
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`Model did not return valid JSON:\n${content.slice(0, 400)}`);
  }
}

/** Throw if the generated script is missing required fields. */
function validateScript(script, episode) {
  const problems = [];
  if (typeof script.youtubeTitle !== 'string' || !script.youtubeTitle.trim()) problems.push('youtubeTitle');
  if (!Array.isArray(script.beats) || script.beats.length === 0) problems.push('beats[]');
  else {
    script.beats.forEach((b, i) => {
      if (typeof b?.narration !== 'string' || !b.narration.trim()) problems.push(`beats[${i}].narration`);
    });
  }
  if (problems.length) {
    throw new Error(`Invalid script for "${episode.id}": missing/empty ${problems.join(', ')}`);
  }
}

const REVIEW_NOTE = (episode) =>
  `# REVIEW REQUIRED — ${episode.id}\n\n` +
  `This episode ("${episode.title}") touches money / ownership / certificates / auth.\n` +
  `Per the model-routing review gate, an Opus review pass of ${episode.id}.json is\n` +
  `required BEFORE recording. Check every claim against docs/APP_FEATURE_MAP.md and\n` +
  `confirm escrow / payout / certificate / ownership language is exact.\n`;

async function main() {
  if (!ENDPOINT || !API_KEY || !DEPLOYMENT || !API_VERSION) {
    console.error('Missing Azure OpenAI env vars. Check .env.');
    process.exit(1);
  }
  const only = process.argv[2];
  const episodes = only ? EPISODES.filter((e) => e.id === only) : EPISODES;
  if (episodes.length === 0) {
    console.error(`No episode matches "${only}". Valid ids: ${EPISODES.map((e) => e.id).join(', ')}`);
    process.exit(1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const featureMap = readFileSync(FEATURE_MAP, 'utf8');
  const summary = [];
  const failures = [];

  for (const episode of episodes) {
    try {
      const sourceMarkdown = sliceSections(featureMap, episode.sections);
      const user = buildUserPrompt({ episode, sourceMarkdown });
      const script = await callAzureOpenAI({ system: SYSTEM_PROMPT, user });
      script.id = episode.id; // authoritative
      validateScript(script, episode);

      writeFileSync(join(OUT_DIR, `${episode.id}.json`), JSON.stringify(script, null, 2), 'utf8');
      if (episode.reviewGate) {
        writeFileSync(join(OUT_DIR, `${episode.id}.REVIEW.md`), REVIEW_NOTE(episode), 'utf8');
      }
      summary.push({ id: episode.id, beats: script.beats.length, review: episode.reviewGate ? 'YES' : '-' });
      console.log(`  [ok]   ${episode.id}  (${script.beats.length} beats${episode.reviewGate ? ', review-gated' : ''})`);
    } catch (err) {
      failures.push(episode.id);
      console.error(`  [fail] ${episode.id}: ${err.message}`);
    }
  }

  console.log('\nSummary:');
  console.table(summary);
  if (failures.length) {
    console.error(`\n${failures.length} episode(s) failed: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log(`\nWrote ${summary.length} script(s) to ${OUT_DIR}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
