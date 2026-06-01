const fs = require('fs');
const content = fs.readFileSync('dist/assets/app-DgYOwSA3.js', 'utf8');
const matches = [];
let idx = 0;
while ((idx = content.indexOf('Function(', idx)) !== -1) {
  const context = content.substring(Math.max(0, idx-80), idx+120);
  matches.push(context);
  idx += 10;
  if (matches.length >= 5) break;
}
matches.forEach((m, i) => {
  console.log('Match ' + (i+1) + ':', m.substring(0, 200));
  console.log('---');
});
