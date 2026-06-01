import { SourceMapConsumer } from 'source-map';
import { readFileSync } from 'fs';

const rawMap = JSON.parse(readFileSync('dist/assets/app-e6t3WWJh.js.map', 'utf8'));
const consumer = await new SourceMapConsumer(rawMap);
const content = readFileSync('dist/assets/app-e6t3WWJh.js', 'utf8');
const lines = content.split('\n');

console.log('Total lines:', lines.length);
console.log('\nLine lengths:');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].length > 100) {
    const orig = consumer.originalPositionFor({ line: i+1, column: 0 });
    console.log(`Line ${i+1}: ${lines[i].length} chars -> ${orig.source} line:${orig.line}`);
  }
}

// The screenshot shows stack frames at line 1 col 57, and other frames
// Let me check what's at the frames shown in the screenshot
// The stack shows: fn (line 1:57:1245), then several at line 49
console.log('\n--- Checking line 49 (where most stack frames point) ---');
const line49 = lines[48];
console.log('Line 49 length:', line49 ? line49.length : 'N/A');
if (line49) {
  // Sample to find what module is on line 49
  for (let col = 0; col < Math.min(line49.length, 50000); col += 5000) {
    const orig = consumer.originalPositionFor({ line: 49, column: col });
    if (orig.source) {
      console.log(`  Col ${col}: ${orig.source} line:${orig.line} name:${orig.name}`);
    }
  }
}

consumer.destroy();
