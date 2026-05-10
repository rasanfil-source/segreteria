const fs = require('fs');
let content = fs.readFileSync('gas_rate_limiter.js', 'utf8');

const old = [
  '    let currentChunk = [];',
  '',
  '    for (const entry of (Array.isArray(windowEntries) ? windowEntries : [])) {',
  '      const candidate = currentChunk.concat([entry]);',
  '      if (JSON.stringify(candidate).length > maxChunkBytes) {',
  '        if (currentChunk.length > 0) {',
  '          chunks.push(JSON.stringify(currentChunk));',
  '        }',
  '        currentChunk = [entry];',
  '      } else {',
  '        currentChunk = candidate;',
  '      }',
  '    }'
].join('\r\n');

const replacement = [
  '    let currentChunk = [];',
  '    let currentChunkBytes = 2; // []',
  '',
  '    for (const entry of (Array.isArray(windowEntries) ? windowEntries : [])) {',
  '      const serializedEntry = JSON.stringify(entry);',
  '      const candidateBytes = currentChunk.length === 0',
  '        ? 2 + serializedEntry.length',
  '        : currentChunkBytes + 1 + serializedEntry.length; // virgola separatrice',
  '',
  '      if (candidateBytes > maxChunkBytes && currentChunk.length > 0) {',
  '        chunks.push(JSON.stringify(currentChunk));',
  '        currentChunk = [entry];',
  '        currentChunkBytes = 2 + serializedEntry.length;',
  '      } else {',
  '        currentChunk.push(entry);',
  '        currentChunkBytes = candidateBytes;',
  '      }',
  '    }'
].join('\r\n');

if (!content.includes(old)) {
  console.error('OLD CONTENT NOT FOUND');
  process.exit(1);
}

content = content.replace(old, replacement);
fs.writeFileSync('gas_rate_limiter.js', content);
console.log('OK: _chunkWindowForProperties optimized');
