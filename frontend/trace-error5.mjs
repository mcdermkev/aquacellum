import { SourceMapConsumer } from 'source-map';
import { readFileSync } from 'fs';

const rawMap = JSON.parse(readFileSync('dist/assets/app-Bvfq-2AS.js.map', 'utf8'));
const consumer = await new SourceMapConsumer(rawMap);
const content = readFileSync('dist/assets/app-Bvfq-2AS.js', 'utf8');
const lines = content.split('\n');

console.log('Total lines:', lines.length);
console.log('Finding which lines contain our app code vs library code...\n');

for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
  if (lines[lineNum-1].length < 10) continue;
  // Check start of each line
  const orig = consumer.originalPositionFor({ line: lineNum, column: 0 });
  if (orig.source) {
    const isApp = !orig.source.includes('node_modules');
    if (isApp) {
      console.log(`Line ${lineNum} (${lines[lineNum-1].length} chars): ${orig.source} line:${orig.line}`);
    }
  }
}

consumer.destroy();
