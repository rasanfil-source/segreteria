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
const gasErrorTypesPath = path.join(__dirname, '..', 'gas_error_types.js');
vm.runInThisContext(fs.readFileSync(gasErrorTypesPath, 'utf8'), { filename: gasErrorTypesPath });
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

console.log('--- Test _classifyError: quota primaria non ritenta sulla stessa chiave ---');
{
  const service = Object.create(GeminiService.prototype);
  const primary = service._classifyError(new Error('PRIMARY_QUOTA_EXHAUSTED'));
  const allKeys = service._classifyError(new Error('QUOTA_EXHAUSTED_ALL_KEYS: Limite quota raggiunto'));

  assert(primary.type === 'QUOTA_EXHAUSTED', 'PRIMARY_QUOTA_EXHAUSTED deve restare quota esaurita');
  assert(primary.retryable === false, 'PRIMARY_QUOTA_EXHAUSTED non deve essere retryable localmente');
  assert(allKeys.type === 'QUOTA_EXHAUSTED', 'QUOTA_EXHAUSTED_ALL_KEYS deve restare quota esaurita');
  assert(allKeys.retryable === false, 'QUOTA_EXHAUSTED_ALL_KEYS non deve essere retryable localmente');
}

console.log('✅ Test bilanciamento JSON Gemini passati');
