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
}

console.log('--- Test _quoteUnquotedJsonKeysSafely: non corrompe virgole e pseudo-chiavi nelle stringhe ---');
{
  const raw = '{reply_needed:true, topic: "Richiesta, info: sbattezzo", category:"TECHNICAL"}';
  const fixed = _quoteUnquotedJsonKeysSafely(raw);
  const parsed = JSON.parse(fixed);

  assert(parsed.reply_needed === true, 'chiave non virgolettata deve essere corretta');
  assert(parsed.topic === 'Richiesta, info: sbattezzo', 'contenuto testuale con virgola e due punti non deve essere alterato');
  assert(parsed.category === 'TECHNICAL', 'category deve restare leggibile');
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


console.log('--- Test shouldRespondToEmail: preserva errore RateLimiter non quota ---');
{
  const service = Object.create(GeminiService.prototype);
  const originalError = new Error('transiente interno');
  originalError._nonRetryable = true;
  service.useRateLimiter = true;
  service.rateLimiter = {
    executeRequest: () => { throw originalError; }
  };

  try {
    service.shouldRespondToEmail('contenuto', 'oggetto', { language: 'it' });
    assert(false, 'shouldRespondToEmail deve rilanciare errori RateLimiter non quota');
  } catch (error) {
    assert(error === originalError, 'deve preservare identità e stack trace dell’errore originale');
    assert(error._nonRetryable === true, 'deve preservare proprietà custom dell’errore originale');
  }
}

console.log('--- Test _generateWithModel: 429 senza backup propaga QUOTA_EXHAUSTED ---');
{
  const service = Object.create(GeminiService.prototype);
  service.primaryKey = 'primary-key';
  service.backupKey = '';
  service.config = { TEMPERATURE: 0.5, MAX_OUTPUT_TOKENS: 1000 };
  service._buildGenerateUrl = () => 'https://generativelanguage.googleapis.com/v1beta/models/test:generateContent';
  service.fetchFn = () => ({
    getResponseCode: () => 429,
    getContentText: () => JSON.stringify({ error: { message: 'rate limit' } })
  });

  let thrown = null;
  try {
    service._generateWithModel('prompt', 'gemini-test', 'primary-key', []);
  } catch (error) {
    thrown = error;
  }

  assert(thrown && thrown.message.includes('QUOTA_EXHAUSTED'), '429 deve includere QUOTA_EXHAUSTED per il RateLimiter');
}

console.log('--- Test Context Cache: payload minimale e auto-healing 404 ---');
{
  const previousUtilities = global.Utilities;
  const previousLockService = global.LockService;
  const previousEstimateTokenCount = global.estimateTokenCount;

  const store = new Map();
  const props = {
    getProperty: (key) => store.has(key) ? store.get(key) : null,
    setProperty: (key, value) => { store.set(key, String(value)); },
    setProperties: (values) => {
      Object.keys(values || {}).forEach((key) => store.set(key, String(values[key])));
    },
    deleteProperty: (key) => { store.delete(key); }
  };
  const calls = [];

  global.Utilities = {
    formatDate: () => '2026-05-12'
  };
  global.LockService = {
    getScriptLock: () => ({
      tryLock: () => true,
      releaseLock: () => { }
    })
  };
  global.estimateTokenCount = (text) => Math.max(1, Math.ceil(String(text || '').length / 4));

  const service = Object.create(GeminiService.prototype);
  service.primaryKey = 'primary-key';
  service.backupKey = '';
  service.config = { TEMPERATURE: 0.5, MAX_OUTPUT_TOKENS: 1000 };
  service.props = props;
  service.modelName = 'gemini-3.1-flash-lite';
  service.contextCacheConfig = {
    enabled: true,
    ttlSeconds: 3300,
    expirySkewMs: 90000,
    minCacheableTokens: 1,
    splitMarker: '**EMAIL DA RISPONDERE:**',
    propertyPrefix: 'test_context_cache_',
    googleSearchGrounding: { enabled: false, reservedQueriesPerRequest: 1 }
  };
  service.rateLimiter = {
    trackAuxiliaryRequest: () => { }
  };
  service.fetchFn = (url, options) => {
    const payload = JSON.parse(options.payload);
    calls.push({ url, payload });
    if (url.includes('/cachedContents') && calls.filter(c => c.url.includes('/cachedContents')).length === 1) {
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ name: 'cachedContents/one', expireTime: '2026-05-12T22:00:00Z' })
      };
    }
    if (url.includes(':generateContent') && calls.filter(c => c.url.includes(':generateContent')).length === 1) {
      return {
        getResponseCode: () => 404,
        getContentText: () => JSON.stringify({ error: { message: 'Cached content not found' } })
      };
    }
    if (url.includes('/cachedContents')) {
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify({ name: 'cachedContents/two', expireTime: '2026-05-12T22:00:00Z' })
      };
    }
    return {
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Risposta finale' }] } }] })
    };
  };

  try {
    const prompt = [
      'Sei la segreteria della Parrocchia.',
      '',
      'CONTESTO STATICO E KB',
      '',
      '**EMAIL DA RISPONDERE:**',
      'Contenuto nuovo utente'
    ].join('\n');
    const text = service._generateWithModel(prompt, 'gemini-3.1-flash-lite', 'primary-key', []);
    assert(text === 'Risposta finale', 'deve rigenerare cache e completare la generazione dopo 404');

    const cacheCreates = calls.filter(c => c.url.includes('/cachedContents'));
    const generations = calls.filter(c => c.url.includes(':generateContent'));
    assert(cacheCreates.length === 2, 'deve ricreare la cache dopo 404');
    assert(cacheCreates[0].payload.systemInstruction, 'systemInstruction deve stare nella create cache');
    assert(Array.isArray(cacheCreates[0].payload.contents), 'contents cache deve essere nella create cache');
    assert(generations.length === 2, 'deve tentare generateContent due volte');
    assert(generations[1].payload.cachedContent === 'cachedContents/two', 'generate finale deve usare la cache ricreata');
    assert(!generations[1].payload.systemInstruction, 'generateContent non deve ridefinire systemInstruction');
    assert(!generations[1].payload.tools, 'generateContent non deve ridefinire tools');
    assert(!generations[1].payload.generationConfig, 'generateContent cached deve restare minimale');
  } finally {
    global.Utilities = previousUtilities;
    global.LockService = previousLockService;
    global.estimateTokenCount = previousEstimateTokenCount;
  }
}


console.log('✅ Test bilanciamento JSON Gemini passati');
