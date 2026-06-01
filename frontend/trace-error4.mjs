import { SourceMapConsumer } from 'source-map';
import { readFileSync } from 'fs';

const rawMap = JSON.parse(readFileSync('dist/assets/app-Bvfq-2AS.js.map', 'utf8'));
const consumer = await new SourceMapConsumer(rawMap);
const content = readFileSync('dist/assets/app-Bvfq-2AS.js', 'utf8');
const lines = content.split('\n');

// The screenshot shows the error at app-Bvfq-2AS.js:fn:48
// Let me look for all non-react-dom source mappings in line 48 to find our app code
console.log('Searching for app code references in line 48...\n');

// Sample every 1000 columns to find where our app code starts
for (let col = 0; col < lines[47].length; col += 2000) {
  const orig = consumer.originalPositionFor({ line: 48, column: col });
  if (orig.source && !orig.source.includes('react-dom') && !orig.source.includes('react/')) {
    console.log(`Col ${col}: ${orig.source} line:${orig.line} name:${orig.name}`);
  }
}

consumer.destroy();
