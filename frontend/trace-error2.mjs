import { SourceMapConsumer } from 'source-map';
import { readFileSync } from 'fs';

const rawMap = JSON.parse(readFileSync('dist/assets/app-Bvfq-2AS.js.map', 'utf8'));
const consumer = await new SourceMapConsumer(rawMap);

// Stack trace positions from the screenshot (line 48, various columns)
const positions = [
  { line: 48, column: 2187, label: 'Ls (first frame)' },
  { line: 48, column: 29727, label: 'at frame 2' },
  { line: 48, column: 83053, label: 'at frame 3' },
  { line: 48, column: 84869, label: 'at frame 4' },
  { line: 48, column: 115363, label: 'at frame 5' },
  { line: 48, column: 111583, label: 'at frame 6' },
  { line: 48, column: 113277, label: 'at frame 7' },
  { line: 48, column: 122798, label: 'error location' },
];

for (const p of positions) {
  const orig = consumer.originalPositionFor(p);
  console.log(`${p.label} (col ${p.column}):`, orig.source, 'line:', orig.line, 'name:', orig.name);
}

consumer.destroy();
