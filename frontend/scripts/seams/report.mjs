#!/usr/bin/env node
/**
 * report.mjs — print the seam inventory for the whole app.
 *
 *   node scripts/seams/report.mjs            # human-readable report
 *   node scripts/seams/report.mjs --json     # machine-readable, for diffing
 *
 * This is the on-demand tool. `src/__tests__/seamInventory.test.js` is the CI
 * ratchet built on the same analyzer, so the report and the gate can never
 * disagree about what counts as a seam.
 */

import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeSeams, findings } from "./analyzeSeams.mjs";

const FRONTEND = fileURLToPath(new URL("../../", import.meta.url));
const SRC = join(FRONTEND, "src");

/** Source files to analyze. Tests are excluded: a key referenced only by a test is
 *  not a real reader, and counting it would hide exactly the dead controls we want. */
export function collectSourceFiles(dir = SRC) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "__tests__" || name === "__snapshots__" || name === "node_modules") continue;
      out.push(...collectSourceFiles(full));
      continue;
    }
    if (!/\.(js|jsx)$/.test(name)) continue;
    if (/\.test\.(js|jsx)$/.test(name)) continue;
    out.push(full);
  }
  return out;
}

const rel = (f) => relative(FRONTEND, f).split(sep).join("/");

function main() {
  const files = collectSourceFiles();
  const raw = analyzeSeams(files, { relativize: rel });
  const found = findings(raw);

  if (process.argv.includes("--json")) {
    process.stdout.write(JSON.stringify({ ...found, unresolved: raw.unresolved }, null, 2) + "\n");
    return;
  }

  const line = "─".repeat(72);
  console.log(`\n${line}\nSEAM INVENTORY`);
  console.log(`${files.length} source files · ${raw.storage.size} storage keys · ${raw.events.size} custom events\n${line}`);

  section(
    "WRITTEN BUT NEVER READ",
    "A control writes this and nothing consumes it. If a user can change it, changing it does nothing.",
    found.writtenNeverRead
  );

  section(
    "READ BUT NEVER WRITTEN",
    "Something depends on this and nothing produces it, so the read always falls back to its default.",
    found.readNeverWritten
  );

  section(
    "EVENT DISPATCHED BUT NEVER HANDLED",
    "Fired into the void — the action appears to succeed and nothing downstream reacts.",
    found.dispatchedNeverHandled
  );

  section(
    "EVENT HANDLED BUT NEVER DISPATCHED",
    "A listener that can never fire — the feature behind it is unreachable.",
    found.handledNeverDispatched
  );

  console.log(`\nPOSSIBLY HANDLED INDIRECTLY (${found.possiblyHandledIndirectly.length})`);
  console.log("  No direct addEventListener, but the name appears elsewhere as a literal —");
  console.log("  usually a declarative `completeOn:` feeding a dynamic listener. Not findings.");
  if (found.possiblyHandledIndirectly.length === 0) console.log("    none");
  for (const item of found.possiblyHandledIndirectly) {
    console.log(`    * ${item.key}`);
    console.log(`        dispatched: ${item.sites.join(", ")}`);
    console.log(`        also named: ${item.alsoAt.join(", ")}`);
  }

  if (raw.unresolved.length > 0) {
    console.log(`\nNOT STATICALLY RESOLVABLE (${raw.unresolved.length})`);
    console.log("  Keys built at runtime. Reviewed by hand, not by this tool.");
    for (const u of raw.unresolved) console.log(`    ${u.method} @ ${u.at}`);
  }

  const total =
    found.writtenNeverRead.length +
    found.readNeverWritten.length +
    found.dispatchedNeverHandled.length +
    found.handledNeverDispatched.length;
  console.log(`\n${line}\n${total} one-sided seam(s) found.\n${line}\n`);
  return total;
}

function section(title, why, items) {
  console.log(`\n${title} (${items.length})`);
  console.log(`  ${why}`);
  if (items.length === 0) {
    console.log("    none");
    return;
  }
  for (const item of items) {
    console.log(`    * ${item.key}${item.dynamic ? "   (prefix match)" : ""}`);
    for (const where of item.sites) console.log(`        ${where}`);
  }
}

// Only run the report when invoked directly. `seamInventory.test.js` imports
// `collectSourceFiles` from here so the CI ratchet and the report can never disagree
// about which files are in scope — but importing must not print anything.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
