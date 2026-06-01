import { SourceMapConsumer } from 'source-map';
import { readFileSync } from 'fs';

const rawMap = JSON.parse(readFileSync('dist/assets/app-Bvfq-2AS.js.map', 'utf8'));
const consumer = await new SourceMapConsumer(rawMap);

// The error is at line 48, column 122798
const pos = consumer.originalPositionFor({ line: 48, column: 122798 });
console.log('Error origin:', pos);

// Also check nearby positions for context
for (let col = 122780; col <= 122820; col += 5) {
  const p = consumer.originalPositionFor({ line: 48, column: col });
  if (p.source) {
    console.log(`Col ${col}:`, p.source, 'line:', p.line, 'col:', p.column, 'name:', p.name);
  }
}

consumer.destroy();
