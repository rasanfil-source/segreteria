const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const filename = path.resolve(__dirname, '../gas_response_validator.js');
let cases = 0;
function row(label, fn) {
  try { fn(); cases++; } catch (error) { throw new Error(label, { cause: error }); }
}
function setup(config = {}, globals = {}) {
  const context = vm.createContext({ console: { log() {}, warn() {}, error() {} }, CONFIG: { SEMANTIC_VALIDATION: { enabled: true, ...config } }, ...globals });
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return { context, s: context.createSemanticValidator() };
}
for (const lenient of [false, true]) for (const input of ['{"isValid":true,"confidence":95}', '```json\n{"isValid":false,"confidence":0.4}\n```', 'null', '[]', 'broken']) row(`parse ${lenient}/${input}`, () => {
  const { s } = setup({}, lenient ? { parseGeminiJsonLenient: text => JSON.parse(text.replace(/```json\n|\n```/g, '')) } : {});
  if (['null', '[]', 'broken'].includes(input)) assert.throws(() => s._parseSemanticResponse(input), /JSON non valido/);
  else {
    const result = s._parseSemanticResponse(input);
    assert.equal(result.isValid, !input.startsWith('```'));
    assert.equal(result.confidence, input.startsWith('```') ? 0.4 : 0.95);
  }
});
for (const cacheEnabled of [false, true]) row(`cache roundtrip ${cacheEnabled}`, () => {
  const values = new Map();
  let generated = 0;
  const { s } = setup({ cacheEnabled }, {
    UrlFetchApp: {},
    CacheService: { getScriptCache: () => ({ get: key => values.get(key), put: (key, value, ttl) => { assert.equal(ttl, 300); values.set(key, value); }, remove: key => values.delete(key) }) }
  });
  s._generateSemantic = () => { generated++; return '{"isValid":true,"confidence":0.95}'; };
  const regex = { score: 0.7, errors: [] };
  for (let i = 0; i < 2; i++) {
    assert.equal(s.validateHallucinations('response', 'kb', regex, 'email', { requestPurpose: { type: 'information' } }).isValid, true);
    assert.equal(s.validateThinkingLeak('response', regex).isValid, true);
  }
  assert.equal(generated, cacheEnabled ? 2 : 4);
  // Changing any grounding input must cause a miss.
  for (const [response, kb, email, purpose] of [['changed', 'kb', 'email', 'information'], ['response', 'changed', 'email', 'information'], ['response', 'kb', 'changed', 'information'], ['response', 'kb', 'email', 'changed']]) {
    s.validateHallucinations(response, kb, regex, email, { requestPurpose: purpose });
  }
  assert.equal(generated, cacheEnabled ? 6 : 8);
  if (cacheEnabled) {
    values.set('bad', '{');
    assert.equal(s._readCache('bad'), null);
    assert.equal(values.has('bad'), false);
  }
});
for (const limited of [false, true]) for (const success of [false, true]) for (const backup of [false, true]) for (const resolver of [false, true]) row(`generation ${limited}/${success}/${backup}/${resolver}`, () => {
  const calls = [];
  const service = {
    useRateLimiter: limited, primaryKey: 'primary-fixture', backupKey: 'backup-fixture', modelName: 'fallback-model',
    _generateWithModel: (prompt, model, key) => { calls.push({ prompt, model, key }); return 'result'; },
    _withRetry: (fn, label, retries) => { assert.equal(retries, 2); return fn(); },
    rateLimiter: { executeRequest: (task, fn, options) => {
      assert.equal(task, 'semantic'); assert.ok(options.estimatedTokens > 0);
      return success ? { success: true, result: fn('limited-model', { usesBackupKey: backup }) } : { success: false };
    } }
  };
  if (resolver) service.getModelNameForTask = () => 'resolved-model';
  const { s } = setup({ maxRetries: 2 }, { GeminiService: function () { return service; } });
  assert.equal(s._generateSemantic('sample prompt'), 'result');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, limited && success ? 'limited-model' : resolver ? 'resolved-model' : 'fallback-model');
  assert.equal(calls[0].key, limited && success ? backup ? 'backup-fixture' : 'primary-fixture' : undefined);
});
row('missing Gemini service fails', () => assert.throws(() => setup().s._generateSemantic('prompt'), /GeminiService non disponibile/));
for (const length of [0, 2000, 2001, 30000, 30001]) row(`prompt truncation ${length}`, () => {
  const prompt = setup().s._buildHallucinationPrompt('reply', 'K'.repeat(length), 'E'.repeat(length));
  assert.equal(prompt.includes('K'.repeat(30001)), false);
  assert.equal(prompt.includes('E'.repeat(2001)), false);
  assert.equal(prompt.includes('[TRUNCATED]'), length > 2000);
});
console.log(`Semantic contracts: ${cases} cases passed`);
