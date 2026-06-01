#!/usr/bin/env node
/**
 * parse-review.cjs
 * -----------------------------------------------------------------------------
 * Read a human-edited Markdown review sheet for a personality batch and emit a
 * machine-readable JSON fragment (an array of entries keyed by specCode) that
 * `merge-personality.cjs` consumes.
 *
 * This is `.cjs` (CommonJS) on purpose: frontend/package.json declares
 * "type": "module", so a plain `.js` here would be treated as an ES module.
 *
 * Design reference: .kiro/specs/species-personality/design.md
 *   -> "Review Workflow (locked)" (the exact review-sheet format)
 *
 * CLI:
 *   node scripts/parse-review.cjs <batch-NN-review.md> [-o <output.json>]
 *
 * If -o is omitted, the fragment is written next to the input file with the
 * `-review` suffix stripped, e.g. batch-01-review.md -> batch-01.json
 *
 * Pure Node.js, no dependencies.
 * -----------------------------------------------------------------------------
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard ceiling for vibeLine length, per Style Guide v1 (target 6-10). */
const VIBELINE_WORD_CEILING = 12;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Count words in a string (whitespace-delimited, ignores empties). */
function wordCount(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

/** True if a value is a non-empty string after trimming. */
function isNonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse the raw Markdown into an array of "block" objects, one per species.
 * Each block records what it found; validation/approval is decided later so we
 * can report cleanly on every block (approved, skipped, or errored).
 *
 * @param {string} markdown
 * @returns {Array<{
 *   specCode: number|null,
 *   headingRaw: string,
 *   label: string,
 *   sawStatus: boolean,
 *   approveChecked: boolean,
 *   needsEditChecked: boolean,
 *   fields: { casualVibe: string|null, proVibe: string|null,
 *             casualFlavor: string|null, proFlavor: string|null },
 *   lineNo: number
 * }>}
 */
function parseBlocks(markdown) {
  const lines = markdown.split(/\r?\n/);

  // Heading: `## <specCode> — <commonName>  (<scientificName>)`
  // Tolerate em-dash (—), en-dash (–) or a plain hyphen as the separator, and
  // grab the first whitespace token after `## ` as the specCode candidate.
  const headingRe = /^##\s+(\S+)\s*(.*)$/;

  // Field line: `- Casual vibeLine (8w): <text>` — the `(8w)` count is optional
  // and stripped; we capture only the trimmed text after the colon.
  const fieldRe =
    /^-\s*(casual|pro)\s+(vibeline|flavortext)\s*(?:\([^)]*\))?\s*:\s*(.*)$/i;

  // Status checkboxes — match each independently so order/spacing is flexible.
  const approveRe = /\[\s*([xX ])\s*\]\s*approve/i;
  const needsEditRe = /\[\s*([xX ])\s*\]\s*needs\s*edit/i;

  const blocks = [];
  let current = null;

  const pushCurrent = () => {
    if (current) blocks.push(current);
  };

  lines.forEach((rawLine, idx) => {
    const line = rawLine.trim();

    const headingMatch = line.match(headingRe);
    if (headingMatch) {
      // New block starts here; finalize the previous one.
      pushCurrent();

      const firstToken = headingMatch[1];
      const rest = (headingMatch[2] || '').trim();
      // specCode is the integer first token after `## `; null if not numeric.
      const specCode = /^\d+$/.test(firstToken) ? parseInt(firstToken, 10) : null;

      current = {
        specCode,
        headingRaw: line,
        // Strip a leading dash separator from the label for nicer reporting.
        label: rest.replace(/^[—–-]\s*/, '').trim() || firstToken,
        sawStatus: false,
        approveChecked: false,
        needsEditChecked: false,
        imageWrong: false,
        fields: {
          casualVibe: null,
          proVibe: null,
          casualFlavor: null,
          proFlavor: null,
        },
        lineNo: idx + 1,
      };
      return;
    }

    // Lines outside any block (preamble, blank lines, etc.) are ignored.
    if (!current) return;

    // Status line.
    if (/^status\s*:/i.test(line)) {
      current.sawStatus = true;

      // Capture the image-wrong flag, then REMOVE that marker from the line so
      // its `[x]` can never be confused with the approve / needs-edit boxes.
      // Accepts "image wrong" or "wrong image".
      const imageWrongRe = /\[\s*([xX ])\s*\]\s*(?:image\s*wrong|wrong\s*image)/i;
      const imageWrongM = line.match(imageWrongRe);
      current.imageWrong = !!imageWrongM && imageWrongM[1].toLowerCase() === 'x';
      // Also treat a bare "[x] image wrong" with odd spacing or a trailing
      // marker without brackets as a flag if an x precedes the words.
      const statusForBoxes = line
        .replace(imageWrongRe, ' ')
        .replace(/\[\s*[xX ]?\s*\]\s*(?:image\s*wrong|wrong\s*image)/gi, ' ')
        .replace(/(?:image\s*wrong|wrong\s*image)/gi, ' ');

      const approveM = statusForBoxes.match(approveRe);
      const needsEditM = statusForBoxes.match(needsEditRe);
      current.approveChecked =
        !!approveM && approveM[1].toLowerCase() === 'x';
      current.needsEditChecked =
        !!needsEditM && needsEditM[1].toLowerCase() === 'x';
      return;
    }

    // Field line.
    const fieldMatch = line.match(fieldRe);
    if (fieldMatch) {
      const mode = fieldMatch[1].toLowerCase(); // casual | pro
      const kind = fieldMatch[2].toLowerCase(); // vibeline | flavortext
      const text = (fieldMatch[3] || '').trim();

      if (mode === 'casual' && kind === 'vibeline') current.fields.casualVibe = text;
      else if (mode === 'pro' && kind === 'vibeline') current.fields.proVibe = text;
      else if (mode === 'casual' && kind === 'flavortext') current.fields.casualFlavor = text;
      else if (mode === 'pro' && kind === 'flavortext') current.fields.proFlavor = text;
    }
  });

  pushCurrent();
  return blocks;
}

/**
 * Decide approval. The sheet has two checkboxes; we treat an entry as approved
 * only when "approve" is checked and "needs edit" is NOT — this honors both
 * "approved if approve is checked" and "needs edit checked => not approved".
 */
function isApproved(block) {
  return block.approveChecked && !block.needsEditChecked;
}

/**
 * Turn parsed blocks into an emit/skip/error breakdown.
 *
 * @returns {{
 *   entries: Array<object>,
 *   approved: number,
 *   skipped: Array<{specCode: number|null, label: string, reason: string}>,
 *   errors: Array<{specCode: number|null, label: string, reason: string}>
 * }}
 */
function buildFragment(blocks) {
  const entries = [];
  const skipped = [];
  const errors = [];
  const imageWrong = [];
  let approved = 0;

  for (const block of blocks) {
    // Collect image-wrong flags regardless of approval status (image fixes are
    // tracked separately and do not block text).
    if (block.imageWrong && block.specCode !== null) {
      imageWrong.push({ specCode: block.specCode, label: block.label });
    }

    // A heading whose first token is not an integer is malformed.
    if (block.specCode === null) {
      errors.push({
        specCode: null,
        label: block.label,
        reason: `invalid/missing specCode in heading (line ${block.lineNo}): "${block.headingRaw}"`,
      });
      continue;
    }

    // Not approved -> normal skip (record why for the report).
    if (!isApproved(block)) {
      let reason = 'not approved';
      if (!block.sawStatus) reason = 'no Status line found';
      else if (block.needsEditChecked) reason = 'marked "needs edit"';
      else if (!block.approveChecked) reason = 'approve checkbox unchecked';
      skipped.push({ specCode: block.specCode, label: block.label, reason });
      continue;
    }

    approved += 1;

    // --- Validation on approved entries ---------------------------------
    const { casualVibe, proVibe, casualFlavor, proFlavor } = block.fields;

    // 1) all four leaves present and non-empty.
    const missing = [];
    if (!isNonEmpty(casualVibe)) missing.push('Casual vibeLine');
    if (!isNonEmpty(proVibe)) missing.push('Pro vibeLine');
    if (!isNonEmpty(casualFlavor)) missing.push('Casual flavorText');
    if (!isNonEmpty(proFlavor)) missing.push('Pro flavorText');
    if (missing.length > 0) {
      errors.push({
        specCode: block.specCode,
        label: block.label,
        reason: `approved but missing/empty field(s): ${missing.join(', ')}`,
      });
      continue;
    }

    // 2) vibeLine word ceiling (<= 12 words each).
    const casualWords = wordCount(casualVibe);
    const proWords = wordCount(proVibe);
    const overLength = [];
    if (casualWords > VIBELINE_WORD_CEILING) {
      overLength.push(`Casual vibeLine (${casualWords}w)`);
    }
    if (proWords > VIBELINE_WORD_CEILING) {
      overLength.push(`Pro vibeLine (${proWords}w)`);
    }
    if (overLength.length > 0) {
      errors.push({
        specCode: block.specCode,
        label: block.label,
        reason: `approved but vibeLine over ${VIBELINE_WORD_CEILING}-word ceiling: ${overLength.join(', ')}`,
      });
      continue;
    }

    // Passed validation -> emit.
    entries.push({
      specCode: block.specCode,
      personality: {
        vibeLine: { casual: casualVibe.trim(), pro: proVibe.trim() },
        flavorText: { casual: casualFlavor.trim(), pro: proFlavor.trim() },
      },
    });
  }

  return { entries, approved, skipped, errors, imageWrong };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/** Parse argv into { input, output }. Throws on bad usage. */
function parseArgs(argv) {
  const args = argv.slice(2);
  let input = null;
  let output = null;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '-o' || arg === '--output') {
      output = args[i + 1];
      i += 1;
      if (!output) throw new Error(`${arg} requires a path argument`);
    } else if (!input) {
      input = arg;
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }

  if (!input) {
    throw new Error(
      'usage: node scripts/parse-review.cjs <batch-NN-review.md> [-o <output.json>]'
    );
  }
  return { input, output };
}

/** Default output path: strip `-review` from the basename, swap ext to .json. */
function defaultOutputPath(inputPath) {
  const dir = path.dirname(inputPath);
  const ext = path.extname(inputPath);
  const base = path.basename(inputPath, ext); // e.g. batch-01-review
  const stripped = base.replace(/-review$/i, ''); // -> batch-01
  return path.join(dir, `${stripped}.json`);
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(2);
    return;
  }

  const inputPath = path.resolve(opts.input);

  // Fatal: input must exist and be readable.
  let markdown;
  try {
    markdown = fs.readFileSync(inputPath, 'utf8');
  } catch (err) {
    console.error(`Error: cannot read input file "${inputPath}": ${err.message}`);
    process.exit(1);
    return;
  }

  const outputPath = opts.output
    ? path.resolve(opts.output)
    : defaultOutputPath(inputPath);

  // Parse + build.
  const blocks = parseBlocks(markdown);
  const { entries, approved, skipped, errors, imageWrong } = buildFragment(blocks);

  // Write the fragment (pretty 2-space indent + trailing newline).
  try {
    fs.writeFileSync(outputPath, `${JSON.stringify(entries, null, 2)}\n`, 'utf8');
  } catch (err) {
    console.error(`Error: cannot write output file "${outputPath}": ${err.message}`);
    process.exit(1);
    return;
  }

  // --- Report -----------------------------------------------------------
  console.log('parse-review: review sheet -> JSON fragment');
  console.log(`  input        : ${inputPath}`);
  console.log(`  blocks found : ${blocks.length}`);
  console.log(`  approved     : ${approved}`);
  console.log(`  emitted      : ${entries.length}`);
  console.log(`  skipped      : ${skipped.length} (not approved)`);
  console.log(`  errors       : ${errors.length} (excluded)`);
  console.log(`  image-wrong  : ${imageWrong.length} (flagged for image-fixes.md)`);

  if (imageWrong.length > 0) {
    console.log('\n  Image flagged wrong (log to image-fixes.md):');
    for (const i of imageWrong) {
      console.log(`    - [${i.specCode}] ${i.label}`);
    }
  }

  if (skipped.length > 0) {
    console.log('\n  Skipped (not approved):');
    for (const s of skipped) {
      console.log(`    - [${s.specCode ?? '?'}] ${s.label} — ${s.reason}`);
    }
  }

  if (errors.length > 0) {
    console.log('\n  Errors (excluded from output):');
    for (const e of errors) {
      console.log(`    - [${e.specCode ?? '?'}] ${e.label} — ${e.reason}`);
    }
  }

  console.log(`\n  output written: ${outputPath}`);

  // Skipped/not-approved entries are normal. Exit 0 even with skips/errors;
  // only input read/write failures are fatal (handled above).
  process.exit(0);
}

main();
