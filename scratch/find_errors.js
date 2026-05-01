const fs = require('fs');
const log = fs.readFileSync('tests.log', 'utf16le'); // Try utf16le
const lines = log.split('\n');
const errors = lines.filter(l => !l.startsWith('PASS') && !l.startsWith('✓') && !l.startsWith('🔍') && !l.startsWith('🧠') && !l.startsWith('📊') && !l.startsWith('📧') && !l.startsWith('   ') && !l.startsWith('📍') && !l.startsWith('✅') && !l.startsWith('🤖') && !l.trim() === false);
console.log(errors.join('\n'));
