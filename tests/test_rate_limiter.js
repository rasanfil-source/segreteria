const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

const gasRateLimiterPath = path.join(__dirname, '..', 'gas_rate_limiter.js');
const gasRateLimiterCode = fs.readFileSync(gasRateLimiterPath, 'utf8');
vm.runInThisContext(gasRateLimiterCode, { filename: gasRateLimiterPath });

console.log('--- Test _readChunkedDataWindow: ignora chunk WAL corrotto ---');
{
  const propsData = new Map([
    ['rate_limit_wal_rpm_chunks', '3'],
    ['rate_limit_wal_rpm_0', JSON.stringify([{ timestamp: 1, model: 'flash-lite' }])],
    ['rate_limit_wal_rpm_1', '{json-corrotto'],
    ['rate_limit_wal_rpm_2', JSON.stringify([{ timestamp: 2, model: 'flash-3.5' }])]
  ]);

  const limiter = Object.create(GeminiRateLimiter.prototype);
  limiter.props = {
    getProperty: (key) => propsData.has(key) ? propsData.get(key) : null
  };

  const windowData = limiter._readChunkedDataWindow('rpm');
  assert(Array.isArray(windowData), 'deve restituire sempre un array');
  assert(windowData.length === 2, 'deve fondere i chunk validi ignorando quello corrotto');
  assert(windowData[0].timestamp === 1 && windowData[1].timestamp === 2, 'deve preservare ordine e contenuto dei chunk validi');
}

console.log('--- Test _applySafetyValve_: non aumenta MAX_EMAILS_PER_RUN già più basso ---');
{
  const originalConfig = global.CONFIG;
  global.CONFIG = { MAX_EMAILS_PER_RUN: 2 };
  const propsData = new Map([
    ['safety_valve_last_date', '2026-05-10'],
    ['safety_valve_reduced_value', '3'],
    ['safety_valve_original_value', '6']
  ]);
  const limiter = Object.create(GeminiRateLimiter.prototype);
  limiter.props = {
    getProperty: (key) => propsData.has(key) ? propsData.get(key) : null,
    setProperty: (key, value) => propsData.set(key, value)
  };
  limiter._getPacificDate = () => '2026-05-10';

  limiter._applySafetyValve_();

  assert(global.CONFIG.MAX_EMAILS_PER_RUN === 2, 'safety valve non deve aumentare un limite configurato manualmente più basso');
  global.CONFIG = originalConfig;
}


console.log('--- Test _applySafetyValve_: riapplica throttling se cap configurato cambia sopra il valore ridotto ---');
{
  const originalConfig = global.CONFIG;
  global.CONFIG = { MAX_EMAILS_PER_RUN: 8 };
  const propsData = new Map([
    ['safety_valve_last_date', '2026-05-10'],
    ['safety_valve_reduced_value', '3'],
    ['safety_valve_original_value', '6']
  ]);
  const limiter = Object.create(GeminiRateLimiter.prototype);
  limiter.props = {
    getProperty: (key) => propsData.has(key) ? propsData.get(key) : null,
    setProperty: (key, value) => propsData.set(key, value)
  };
  limiter._getPacificDate = () => '2026-05-10';

  limiter._applySafetyValve_();

  assert(global.CONFIG.MAX_EMAILS_PER_RUN === 3, 'safety valve persistita deve riapplicare il valore ridotto anche se il cap manuale supera quello originale');
  global.CONFIG = originalConfig;
}

console.log('--- Test trackAuxiliaryRequest: supporta lock già acquisito ---');

{
  const propsData = new Map();
  const limiter = Object.create(GeminiRateLimiter.prototype);
  limiter.models = {
    flash: { name: 'gemini-3.1-flash-lite', rpm: 2000, tpm: 2000000, rpd: 3500 }
  };
  limiter.props = {
    getProperty: (key) => propsData.has(key) ? propsData.get(key) : null,
    setProperty: (key, value) => propsData.set(key, String(value)),
    setProperties: (values) => Object.keys(values || {}).forEach((key) => propsData.set(key, String(values[key])))
  };
  limiter._getPacificDate = () => '2026-05-12';

  const counters = limiter.trackAuxiliaryRequest('gemini-3.1-flash-lite', 123, 'cache-create', true);
  assert(counters.rpd === 1, 'la chiamata ausiliaria deve incrementare RPD anche con lock esterno');
  assert(propsData.get('tokens_flash') === '123', 'la chiamata ausiliaria deve tracciare i token stimati');
}

console.log('--- Test model policy: preserva 3.5 Flash e normalizza solo storici ---');
{
  const limiter = Object.create(GeminiRateLimiter.prototype);
  const normalized = limiter._normalizeDeprecatedModelNames({
    quality: { name: 'gemini-2.5-flash', useCases: ['generation'] },
    oldLite: { name: 'gemini-2.5-flash-lite', useCases: ['quick_check'] },
    missingGeneration: { useCases: ['generation'] },
    missingQuick: { useCases: ['quick_check'] }
  });

  assert(normalized.quality.name === 'gemini-3.5-flash', 'il modello qualita 2.5 Flash deve essere riscritto a 3.5');
  assert(normalized.oldLite.name === 'gemini-3.1-flash-lite', 'i vecchi alias lite devono seguire la policy 3.1 Lite');
  assert(normalized.missingGeneration.name === 'gemini-3.5-flash', 'fallback generation mancante deve essere 3.5 Flash');
  assert(normalized.missingQuick.name === 'gemini-3.1-flash-lite', 'fallback quick_check mancante deve essere 3.1 Lite');
}

console.log('--- Test _getCandidateModels: task policy generation vs quick/language ---');
{
  const limiter = Object.create(GeminiRateLimiter.prototype);
  limiter.strategies = {
    generation: ['flash-3.5', 'flash-3.5-backup', 'flash-lite'],
    quick_check: ['flash-lite'],
    fallback: ['flash-lite']
  };

  assert(limiter._getCandidateModels('generation')[0] === 'flash-3.5', 'generation deve partire dal tier qualita');
  assert(limiter._getCandidateModels('quick_check')[0] === 'flash-lite', 'quick_check deve partire dal lite');
  assert(limiter._getCandidateModels('classification')[0] === 'flash-lite', 'classification deve ereditare quick_check');
  assert(limiter._getCandidateModels('language')[0] === 'flash-lite', 'language deve ereditare quick_check');
  assert(limiter._getCandidateModels('newsletter_summary')[0] === 'flash-lite', 'newsletter_summary deve ereditare quick_check');
}

console.log('--- Test _safeExecuteRequestFn_: preserva isTransient nel wrapping ---');
{
  const limiter = Object.create(GeminiRateLimiter.prototype);
  const original = new Error('Gemini ha restituito testo vuoto');
  original.isTransient = true;
  original.retryAfterMs = 250;

  try {
    limiter._safeExecuteRequestFn_(() => { throw original; }, 'gemini-test');
    assert(false, 'requestFn transient deve rilanciare errore wrappato');
  } catch (wrapped) {
    assert(wrapped.message.includes('requestFn exception (gemini-test)'), 'il wrapper deve includere il modello');
    assert(wrapped.isTransient === true, 'il wrapper deve preservare isTransient');
    assert(wrapped.retryAfterMs === 250, 'il wrapper deve preservare metadati custom');
  }
}

console.log('--- Test executeRequest: ritenta testo vuoto transitorio sullo stesso modello ---');
{
  const originalUtilities = global.Utilities;
  global.Utilities = {
    sleep: () => {}
  };

  try {
    const propsData = new Map([['rpd_flash', '0']]);
    const limiter = Object.create(GeminiRateLimiter.prototype);
    limiter.defaultMaxRetries = 2;
    limiter.backoffBase = 1;
    limiter.backoffMultiplier = 2;
    limiter.maxBackoff = 1;
    limiter.props = {
      getProperty: (key) => propsData.has(key) ? propsData.get(key) : null
    };
    limiter._selectAndReserveModel = () => ({
      available: true,
      modelKey: 'flash',
      model: { name: 'gemini-test' },
      shouldThrottle: null,
      reservationId: 'res-transient'
    });
    limiter._releaseReservation = () => {};
    limiter._trackRequest = () => {};
    limiter._getRequestsInWindow = () => 0;

    let calls = 0;
    const result = limiter.executeRequest('generation', () => {
      calls++;
      if (calls === 1) {
        const err = new Error('Gemini ha restituito testo vuoto');
        err.isTransient = true;
        throw err;
      }
      return 'ok';
    }, { maxRetries: 2, estimatedTokens: 10 });

    assert(calls === 2, 'errore transient testo vuoto deve attivare il secondo tentativo');
    assert(result.success === true && result.result === 'ok', 'il secondo tentativo deve completare la richiesta');
  } finally {
    global.Utilities = originalUtilities;
  }
}


console.log('--- Test sorgente rate limiter: nessun mojibake nei log operativi ---');
{
  const mojibakePattern = /(?:Ã.|â.|ð.|ï.)/;
  assert(!mojibakePattern.test(gasRateLimiterCode), 'gas_rate_limiter.js non deve contenere sequenze mojibake nei log/commenti');
}

console.log('✅ Rate limiter WAL tests completati');
