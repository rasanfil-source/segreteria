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

// Test rimosso perché la funzionalità di context caching è stata eliminata

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
  const compactPrimary = service._classifyError(new Error('PRIMARYQUOTAEXHAUSTED'));
  const allKeys = service._classifyError(new Error('QUOTA_EXHAUSTED_ALL_KEYS: Limite quota raggiunto'));
  const compactAllKeys = service._classifyError(new Error('quotaexhaustedallkeys'));

  assert(primary.type === 'QUOTA_EXHAUSTED', 'PRIMARY_QUOTA_EXHAUSTED deve restare quota esaurita');
  assert(primary.retryable === false, 'PRIMARY_QUOTA_EXHAUSTED non deve essere retryable localmente');
  assert(compactPrimary.type === 'QUOTA_EXHAUSTED', 'PRIMARYQUOTAEXHAUSTED compatto deve restare quota esaurita');
  assert(compactPrimary.retryable === false, 'PRIMARYQUOTAEXHAUSTED compatto non deve essere retryable localmente');
  assert(allKeys.type === 'QUOTA_EXHAUSTED', 'QUOTA_EXHAUSTED_ALL_KEYS deve restare quota esaurita');
  assert(allKeys.retryable === false, 'QUOTA_EXHAUSTED_ALL_KEYS non deve essere retryable localmente');
  assert(compactAllKeys.type === 'QUOTA_EXHAUSTED', 'quotaexhaustedallkeys compatto deve restare quota esaurita');
  assert(compactAllKeys.retryable === false, 'quotaexhaustedallkeys compatto non deve essere retryable localmente');
}

console.log('--- Test classifyError: testo vuoto Gemini è retryable ---');
{
  const emptyErr = new Error('Gemini ha restituito testo vuoto');
  emptyErr.isTransient = true;
  const classified = classifyError(emptyErr);

  assert(classified.retryable === true, 'errore testo vuoto marcato transient deve essere retryable');
  assert(classified.type === ErrorTypes.NETWORK, 'errore transient deve essere classificato come NETWORK');
}

console.log('--- Test _generateWithModel: testo vuoto marca isTransient ---');
{
  const service = Object.create(GeminiService.prototype);
  service.primaryKey = 'primary-key';
  service.backupKey = null;
  service.config = { MAX_OUTPUT_TOKENS: 128 };
  service._buildGenerateUrl = () => 'https://example.test/generate';
  service._normalizePromptPayload_ = (prompt) => ({ userPrompt: String(prompt), systemInstruction: '' });
  service.fetchFn = () => ({
    getResponseCode: () => 200,
    getContentText: () => JSON.stringify({
      candidates: [{ content: { parts: [{ text: '   ' }] } }]
    })
  });

  try {
    service._generateWithModel('ciao', 'gemini-test');
    assert(false, 'testo vuoto deve lanciare errore');
  } catch (error) {
    assert(error.message.includes('testo vuoto'), 'errore deve descrivere il testo vuoto');
    assert(error.isTransient === true, 'errore testo vuoto deve essere marcato isTransient');
  }
}



console.log('--- Test _withRetry: segnale switch chiave non consuma retry locali ---');
{
  const previousUtilities = global.Utilities;
  global.Utilities = {
    sleep: () => {
      assert(false, 'PRIMARY_QUOTA_EXHAUSTED non deve attendere retry locali');
    }
  };

  const service = Object.create(GeminiService.prototype);
  service.maxRetries = 3;
  service.retryDelay = 1;
  service.backoffFactor = 2;
  service.maxBackoffMs = 10;
  service.retryJitterMs = 0;
  service._classifyError = () => ({ type: 'RETRYABLE', retryable: true });
  let calls = 0;

  try {
    service._withRetry(() => {
      calls += 1;
      throw new Error('PRIMARY_QUOTA_EXHAUSTED');
    }, 'test switch chiave');
    assert(false, 'deve rilanciare immediatamente PRIMARY_QUOTA_EXHAUSTED');
  } catch (error) {
    assert(error.message === 'PRIMARY_QUOTA_EXHAUSTED', 'deve preservare il segnale di switch chiave');
    assert(calls === 1, 'deve eseguire un solo tentativo locale');
  } finally {
    global.Utilities = previousUtilities;
  }
}

console.log('--- Test classifyError: 404 cachedContent è rigenerabile, 404 generico no ---');
{
  const cacheExpired = classifyError(new Error('Errore API 404: Cached content not found'));
  const genericNotFound = classifyError(new Error('Errore API 404: model not found'));

  assert(cacheExpired.type === ErrorTypes.CACHE_EXPIRED, '404 cachedContent deve essere CACHE_EXPIRED');
  assert(cacheExpired.retryable === true, 'CACHE_EXPIRED deve essere retryable');
  assert(genericNotFound.type !== ErrorTypes.CACHE_EXPIRED, '404 generico non deve essere trattato come cache scaduta');
  assert(genericNotFound.retryable === false, '404 generico non deve essere retryable');
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

// Test rimossi perché la funzionalità di context caching è stata eliminata

console.log('--- Test model policy: quick_check non rate-limited usa lite, non MODEL_NAME qualita ---');
{
  const service = Object.create(GeminiService.prototype);
  service.useRateLimiter = false;
  service.modelName = 'gemini-3.5-flash';
  service.config = {
    MODEL_STRATEGY: {
      quick_check: ['flash-lite'],
      generation: ['flash-3.5']
    },
    GEMINI_MODELS: {
      'flash-3.5': { name: 'gemini-3.5-flash' },
      'flash-lite': { name: 'gemini-3.1-flash-lite' }
    }
  };
  service.detectEmailLanguage = () => ({ lang: 'it', confidence: 5, safetyGrade: 5 });
  service._withRetry = (fn) => fn();
  let modelUsed = null;
  service._quickCheckWithModel = (_content, _subject, modelName) => {
    modelUsed = modelName;
    return { shouldRespond: true, language: 'it', classification: { category: 'TECHNICAL' } };
  };

  const result = service.shouldRespondToEmail('Vorrei informazioni', 'Info');
  assert(result.shouldRespond === true, 'quick_check deve restituire il risultato del modello');
  assert(modelUsed === 'gemini-3.1-flash-lite', `quick_check deve usare lite, ottenuto ${modelUsed}`);
  assert(service.getModelNameForTask('generation') === 'gemini-3.5-flash', 'generation deve risolvere il modello qualita');
}

console.log('--- Test quickCheck generationConfig: responseMimeType escluso per modelli lite ---');
{
  const makeService = () => {
    const service = Object.create(GeminiService.prototype);
    service.primaryKey = 'primary-key';
    service.backupKey = null;
    service._buildGenerateUrl = (modelName) => `https://example.test/${modelName}:generateContent`;
    service._resolveLanguage = (_candidate, fallback) => fallback || 'it';
    return service;
  };

  let litePayload = null;
  const liteService = makeService();
  liteService.fetchFn = (_url, payload) => {
    litePayload = JSON.parse(payload.payload);
    return {
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"reply_needed":true,"language":"it","category":"TECHNICAL","topic":"info","confidence":0.9,"reason":"ok"}' }] } }]
      })
    };
  };

  const liteOut = liteService._quickCheckWithModel(
    'Vorrei informazioni',
    'Info',
    'gemini-3.1-flash-lite',
    { lang: 'it', confidence: 5, safetyGrade: 5 }
  );

  assert(liteOut.shouldRespond === true, 'quick check lite deve restare funzionante');
  assert(!Object.prototype.hasOwnProperty.call(litePayload.generationConfig, 'responseMimeType'), 'i modelli lite non devono ricevere responseMimeType');

  let flashPayload = null;
  const flashService = makeService();
  flashService.fetchFn = (_url, payload) => {
    flashPayload = JSON.parse(payload.payload);
    return {
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"reply_needed":true,"language":"it","category":"TECHNICAL","topic":"info","confidence":0.9,"reason":"ok"}' }] } }]
      })
    };
  };

  flashService._quickCheckWithModel(
    'Vorrei informazioni',
    'Info',
    'gemini-3.5-flash',
    { lang: 'it', confidence: 5, safetyGrade: 5 }
  );

  assert(flashPayload.generationConfig.responseMimeType === 'application/json', 'i modelli non-lite devono mantenere responseMimeType JSON');
}


console.log('✅ Test bilanciamento JSON Gemini passati');
