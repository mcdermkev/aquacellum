// Temporary scan script — DELETE after use.
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('fishbase_master.json', 'utf8'));
const arr = Array.isArray(data) ? data : Object.values(data).find(Array.isArray);

function dump(label, s) {
  if (typeof s !== 'string') { console.log(label, '<<missing>>'); return; }
  const out = [];
  for (const ch of s) { // iterates by code point
    const cp = ch.codePointAt(0);
    if (cp > 0x7f) out.push(ch + '=U+' + cp.toString(16).toUpperCase());
  }
  // also flag double spaces
  const dbl = / {2,}/.test(s) ? '  [HAS MULTISPACE]' : '';
  console.log(label, out.length ? out.join('  ') : '(ascii-only)', dbl);
}

for (const sp of arr) {
  if (!sp.personality) continue;
  const p = sp.personality;
  console.log('=== ' + sp.commonName + ' (specCode ' + sp.specCode + ') ===');
  dump('  vibeLine.casual  :', p?.vibeLine?.casual);
  dump('  vibeLine.pro     :', p?.vibeLine?.pro);
  dump('  flavorText.casual:', p?.flavorText?.casual);
  dump('  flavorText.pro   :', p?.flavorText?.pro);
}
