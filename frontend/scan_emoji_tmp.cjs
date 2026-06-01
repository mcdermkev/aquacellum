const fs = require('fs');
const data = JSON.parse(fs.readFileSync('public/fishbase_master.json', 'utf8'));
const arr = Array.isArray(data) ? data : data.species;
const emojiRe = /\p{Extended_Pictographic}/u;
let withPersonality = 0;
let problems = 0;
for (const s of arr) {
  const p = s.personality;
  if (!p) continue;
  withPersonality++;
  const fields = {
    'vibeLine.casual': p.vibeLine && p.vibeLine.casual,
    'vibeLine.pro': p.vibeLine && p.vibeLine.pro,
    'flavorText.casual': p.flavorText && p.flavorText.casual,
    'flavorText.pro': p.flavorText && p.flavorText.pro,
  };
  for (const [k, v] of Object.entries(fields)) {
    if (typeof v !== 'string') continue;
    const matches = [...v].filter(ch => emojiRe.test(ch));
    if (k === 'vibeLine.casual') {
      if (matches.length > 1) { console.log(`PROBLEM ${s.commonName} ${k}: ${matches.length} emoji`); problems++; }
    } else {
      if (matches.length > 0) { console.log(`PROBLEM ${s.commonName} ${k}: emoji ${matches.join('')}`); problems++; }
    }
  }
  // report remaining vibeLine.casual emoji (should be 0 after normalization)
  const vc = p.vibeLine && p.vibeLine.casual;
  if (typeof vc === 'string') {
    const m = [...vc].filter(ch => emojiRe.test(ch));
    if (m.length) console.log(`NOTE ${s.commonName} casual vibeLine still has emoji: ${m.join('')}`);
  }
}
console.log(`Entries with personality: ${withPersonality}`);
console.log(`Problems: ${problems}`);
