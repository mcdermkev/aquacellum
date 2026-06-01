// Temporary scan script — DELETE after use.
const fs = require('fs');
const path = 'fishbase_master.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));

const arr = Array.isArray(data) ? data : data.species || data.fish || Object.values(data).find(Array.isArray);

// Emoji / pictographic detection regex (covers most emoji + variation selectors + ZWJ)
const emojiRe = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{2300}-\u{23FF}\u{2B50}\u{2049}\u{203C}]/gu;

function listEmoji(s) {
  if (typeof s !== 'string') return [];
  const m = s.match(emojiRe);
  return m || [];
}

let total = 0;
let withPersonality = 0;
const report = [];

for (const sp of arr) {
  total++;
  if (!sp.personality) continue;
  withPersonality++;
  const p = sp.personality;
  const fields = {
    'vibeLine.casual': p?.vibeLine?.casual,
    'vibeLine.pro': p?.vibeLine?.pro,
    'flavorText.casual': p?.flavorText?.casual,
    'flavorText.pro': p?.flavorText?.pro,
  };
  const entry = { name: sp.commonName, specCode: sp.specCode, fields: {} };
  for (const [k, v] of Object.entries(fields)) {
    const em = listEmoji(v);
    if (em.length) entry.fields[k] = { count: em.length, emoji: em, text: v };
  }
  report.push(entry);
}

console.log('TOTAL SPECIES:', total);
console.log('WITH PERSONALITY:', withPersonality);
console.log(JSON.stringify(report, null, 2));
