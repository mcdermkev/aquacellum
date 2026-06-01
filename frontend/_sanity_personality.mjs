import { getPersonality } from "./src/utils/personality.js";

const cases = [
  ["null profile", null, "casual"],
  ["undefined profile", undefined, "pro"],
  ["empty object", {}, "casual"],
  ["missing flavorText sub-obj", { personality: { vibeLine: { casual: "Hi" } } }, "casual"],
  ["whitespace value", { personality: { vibeLine: { casual: "   " }, flavorText: { casual: "ok" } } }, "casual"],
  ["non-string value", { personality: { vibeLine: { casual: 42 }, flavorText: { casual: "ok" } } }, "casual"],
  ["full casual", { personality: { vibeLine: { casual: "c-vibe", pro: "p-vibe" }, flavorText: { casual: "c-flavor", pro: "p-flavor" } } }, "casual"],
  ["full pro", { personality: { vibeLine: { casual: "c-vibe", pro: "p-vibe" }, flavorText: { casual: "c-flavor", pro: "p-flavor" } } }, "pro"],
  ["bad mode", { personality: { vibeLine: { casual: "c", pro: "p" }, flavorText: { casual: "cf", pro: "pf" } } }, "banana"],
];

let threw = false;
for (const [name, profile, mode] of cases) {
  try {
    const r = getPersonality(profile, mode);
    console.log(name, "=>", JSON.stringify(r));
  } catch (e) {
    threw = true;
    console.log(name, "=> THREW:", e.message);
  }
}
console.log("ANY_THROW:", threw);
