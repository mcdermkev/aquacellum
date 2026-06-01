import { SourceMapConsumer } from 'source-map';
import { readFileSync } from 'fs';

const rawMap = JSON.parse(readFileSync('dist/assets/app-Bvfq-2AS.js.map', 'utf8'));
const consumer = await new SourceMapConsumer(rawMap);

// The error message says "Cannot access '$' before initialization"
// The $ variable is likely defined somewhere in the bundle. Let me find it.
const content = readFileSync('dist/assets/app-Bvfq-2AS.js', 'utf8');
const lines = content.split('\n');

// Search for where $ is declared (let $, const $, var $) in line 48
const line48 = lines[47];

// Find patterns like ",$ " or ";$ " or "let $" that indicate $ declaration
const patterns = [/\blet \$/g, /\bconst \$/g, /,\$=/g, /,\$,/g];
for (const pat of patterns) {
  let match;
  while ((match = pat.exec(line48)) !== null) {
    const orig = consumer.originalPositionFor({ line: 48, column: match.index });
    console.log(`Found "${match[0]}" at col ${match.index} -> ${orig.source} line:${orig.line} name:${orig.name}`);
    if (orig.source && !orig.source.includes('node_modules')) {
      console.log('  *** THIS IS APP CODE ***');
    }
    break; // just first match per pattern
  }
}

// Also search for the actual error - where $ is USED before being defined
// Look for function calls or references to $ that come BEFORE its declaration
const firstUse = line48.indexOf('$(');
const firstDecl = line48.indexOf('$=');
console.log('\nFirst use of $( at col:', firstUse);
console.log('First declaration $= at col:', firstDecl);

if (firstUse > -1) {
  const orig = consumer.originalPositionFor({ line: 48, column: firstUse });
  console.log('First use maps to:', orig.source, 'line:', orig.line, 'name:', orig.name);
}
if (firstDecl > -1) {
  const orig = consumer.originalPositionFor({ line: 48, column: firstDecl });
  console.log('First decl maps to:', orig.source, 'line:', orig.line, 'name:', orig.name);
}

consumer.destroy();
