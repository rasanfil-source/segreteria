const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

const gasGeminiServicePath = path.join(__dirname, '..', 'gas_gemini_service.js');
const code = fs.readFileSync(gasGeminiServicePath, 'utf8');
vm.runInThisContext(code, { filename: gasGeminiServicePath });

console.log('--- Test _tryBalanceJsonBraces: chiusura corretta oggetti+array annidati ---');
{
  const truncated = '{"dimensions":[1,2,{"k":"v"';
  const balanced = _tryBalanceJsonBraces(truncated);
  const parsed = JSON.parse(balanced);

  assert(Array.isArray(parsed.dimensions), 'dimensions deve essere un array valido');
  assert(parsed.dimensions[2].k === 'v', 'oggetto annidato in array deve restare valido');
}

console.log('--- Test _tryBalanceJsonBraces: parentesi in stringa non alterano lo stack ---');
{
  const truncated = '{"note":"valore con ] e } nel testo","arr":[1,2';
  const balanced = _tryBalanceJsonBraces(truncated);
  const parsed = JSON.parse(balanced);

  assert(parsed.note.includes('] e }'), 'caratteri strutturali in stringa non devono essere interpretati');
  assert(parsed.arr.length === 2, 'array deve essere chiuso correttamente');
}

console.log('✅ Test bilanciamento JSON Gemini passati');
