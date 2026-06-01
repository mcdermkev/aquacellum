import { getPersonality } from "./src/utils/personality.js";

let pass = 0;
let fail = 0;

function eq(label, actual, expected) {
  const ok = actual === expected;
  if (ok) {
    pass++;
    console.log(`  PASS ${label} -> ${JSON.stringify(actual)}`);
  } else {
    fail++;
    console.log(`  FAIL ${label} -> got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

function noThrow(label, fn) {
  try {
    const r = fn();
    pass++;
    console.log(`  PASS ${label} (no throw) -> ${JSON.stringify(r)}`);
    return r;
  } catch (e) {
    fail++;
    console.log(`  FAIL ${label} threw: ${e && e.message}`);
    return undefined;
  }
}

const full = {
  personality: {
    vibeLine: { casual: "Tiny neon torpedo of the planted tank.", pro: "Schooling characin; needs stable soft water." },
    flavorText: { casual: "Casual flavor here.", pro: "Pro flavor here." },
  },
};

console.log("Full entry, casual:");
{
  const r = getPersonality(full, "casual");
  eq("vibeLine", r.vibeLine, "Tiny neon torpedo of the planted tank.");
  eq("flavorText", r.flavorText, "Casual flavor here.");
}

console.log("Full entry, pro:");
{
  const r = getPersonality(full, "pro");
  eq("vibeLine", r.vibeLine, "Schooling characin; needs stable soft water.");
  eq("flavorText", r.flavorText, "Pro flavor here.");
}

console.log("Property 3 - mode isolation (casual content never leaks into pro):");
{
  const casualOnly = { personality: { vibeLine: { casual: "only casual" }, flavorText: { casual: "only casual flavor" } } };
  const r = getPersonality(casualOnly, "pro");
  eq("vibeLine", r.vibeLine, undefined);
  eq("flavorText", r.flavorText, undefined);
}

console.log("Property 1 - personality missing entirely:");
{
  const r = getPersonality({ commonName: "Mystery Fish" }, "casual");
  eq("vibeLine", r.vibeLine, undefined);
  eq("flavorText", r.flavorText, undefined);
}

console.log("Property 2 - partial: vibeLine present, flavorText missing:");
{
  const r = getPersonality({ personality: { vibeLine: { casual: "has vibe", pro: "has vibe pro" } } }, "casual");
  eq("vibeLine", r.vibeLine, "has vibe");
  eq("flavorText", r.flavorText, undefined);
}

console.log("Property 2 - partial: flavorText present, vibeLine missing:");
{
  const r = getPersonality({ personality: { flavorText: { pro: "only flavor pro" } } }, "pro");
  eq("vibeLine", r.vibeLine, undefined);
  eq("flavorText", r.flavorText, "only flavor pro");
}

console.log("Property 2 - vibeLine present but requested mode key missing:");
{
  const r = getPersonality({ personality: { vibeLine: { casual: "c" } } }, "pro");
  eq("vibeLine", r.vibeLine, undefined);
}

console.log("Empty-string and whitespace leaves treated as absent:");
{
  const r = getPersonality({ personality: { vibeLine: { casual: "" }, flavorText: { casual: "   \t\n  " } } }, "casual");
  eq("vibeLine (empty)", r.vibeLine, undefined);
  eq("flavorText (whitespace)", r.flavorText, undefined);
}

console.log("Property 2 - null/undefined profile and null nested objects (must not throw):");
{
  noThrow("null profile", () => getPersonality(null, "casual"));
  noThrow("undefined profile", () => getPersonality(undefined, "pro"));
  noThrow("personality null", () => getPersonality({ personality: null }, "casual"));
  noThrow("vibeLine null", () => getPersonality({ personality: { vibeLine: null, flavorText: null } }, "casual"));
  const r = getPersonality(null, "casual");
  eq("null profile vibeLine", r.vibeLine, undefined);
  eq("null profile flavorText", r.flavorText, undefined);
}

console.log("Property 3 - invalid mode returns both undefined (no default to casual):");
{
  const r = getPersonality(full, "PRO");
  eq("vibeLine (invalid mode)", r.vibeLine, undefined);
  eq("flavorText (invalid mode)", r.flavorText, undefined);
  const r2 = getPersonality(full, undefined);
  eq("vibeLine (undefined mode)", r2.vibeLine, undefined);
  const r3 = getPersonality(full, "");
  eq("vibeLine (empty mode)", r3.vibeLine, undefined);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
