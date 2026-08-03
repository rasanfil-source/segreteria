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

console.log('--- Test _getPacificDate: fallback non richiama timezone rotto ---');
{
  const originalUtilities = global.Utilities;
  global.Utilities = {
    formatDate: (_date, timezone) => {
      if (timezone === 'America/Los_Angeles') {
        throw new Error('timezone unavailable');
      }
      throw new Error(`timezone inatteso: ${timezone}`);
    }
  };

  try {
    const limiter = Object.create(GeminiRateLimiter.prototype);
    const pacificDate = limiter._getPacificDate();
    assert(/^\d{4}-\d{2}-\d{2}$/.test(pacificDate), 'fallback Pacific deve restituire una data ISO');
  } finally {
    global.Utilities = originalUtilities;
  }
}

console.log('--- Test _getPacificDate: fallback Intl preserva timezone Pacific ---');
{
  const originalUtilities = global.Utilities;
  const originalIntl = global.Intl;
  let receivedTimeZone = '';
  global.Utilities = {
    formatDate: () => {
      throw new Error('timezone unavailable');
    }
  };
  global.Intl = {
    DateTimeFormat: function (_locale, options) {
      receivedTimeZone = options && options.timeZone;
      return {
        formatToParts: () => [
          { type: 'month', value: '12' },
          { type: 'day', value: '31' },
          { type: 'year', value: '2026' }
        ]
      };
    }
  };

  try {
    const limiter = Object.create(GeminiRateLimiter.prototype);
    const pacificDate = limiter._getPacificDate();
    assert(
      pacificDate === '2026-12-31' && receivedTimeZone === 'America/Los_Angeles',
      `fallback Intl deve usare America/Los_Angeles, ottenuto ${pacificDate}/${receivedTimeZone}`
    );
  } finally {
    global.Utilities = originalUtilities;
    global.Intl = originalIntl;
  }
}

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

console.log('--- Test _chunkWindowForProperties: chunk sotto limite PropertiesService ---');
{
  const limiter = Object.create(GeminiRateLimiter.prototype);
  const entries = Array.from({ length: 160 }, (_, index) => ({
    timestamp: 1700000000000 + index,
    nonce: `1700000000000-${index}`,
    modelKey: 'gemini-3.5-flash',
    reserved: true
  }));

  const chunks = limiter._chunkWindowForProperties(entries);
  const restored = chunks.flatMap(chunk => JSON.parse(chunk));

  assert(chunks.length > 1, 'una finestra alta RPM deve essere divisa in più chunk');
  assert(chunks.every(chunk => chunk.length <= 4000), 'ogni chunk deve restare entro il limite conservativo di 4000 caratteri');
  assert(restored.length === entries.length, 'chunking deve preservare tutte le entry');
}

console.log('--- Test _mergeWindowData: non dimentica burst RPM oltre 8KB ---');
{
  const limiter = Object.create(GeminiRateLimiter.prototype);
  const entries = Array.from({ length: 160 }, (_, index) => ({
    timestamp: 1700000000000 + index,
    nonce: `1700000000000-${index}`,
    modelKey: 'gemini-3.5-flash',
    reserved: true
  }));

  const merged = limiter._mergeWindowData([], entries);
  assert(merged.length === entries.length, 'merge finestra deve preservare tutte le chiamate vive anche oltre 8KB');
}

console.log('--- Test _mergeWindowData: tie-break deterministico su timestamp uguale ---');
{
  const limiter = Object.create(GeminiRateLimiter.prototype);
  const entries = [
    { timestamp: 1700000000000, nonce: 'b', modelKey: 'gemini-3.5-flash', reserved: true },
    { timestamp: 1700000000000, nonce: 'a', modelKey: 'gemini-3.5-flash', reserved: true },
    { timestamp: 1700000000000, nonce: 'z', modelKey: 'gemini-3.1-flash-lite', reserved: true }
  ];

  const merged = limiter._mergeWindowData([], entries);
  assert(
    merged.map(entry => `${entry.modelKey}:${entry.nonce}`).join('|') ===
      'gemini-3.1-flash-lite:z|gemini-3.5-flash:a|gemini-3.5-flash:b',
    'merge deve ordinare in modo deterministico a parità di timestamp'
  );
}

console.log('--- Test persistenza chunkata: finestra completa e legacy compatto ---');
{
  const now = Date.now();
  const entries = Array.from({ length: 160 }, (_, index) => ({
    timestamp: now - 1000 + index,
    nonce: `${now}-${index}`,
    modelKey: 'gemini-3.5-flash',
    reserved: true
  }));
  const propsData = new Map();
  const limiter = Object.create(GeminiRateLimiter.prototype);
  limiter.props = {
    getProperty: (key) => propsData.has(key) ? propsData.get(key) : null,
    setProperty: (key, value) => propsData.set(key, String(value)),
    setProperties: (values) => Object.keys(values || {}).forEach((key) => propsData.set(key, String(values[key]))),
    deleteProperty: (key) => propsData.delete(key)
  };
  limiter.cache = {
    rpmWindow: entries,
    tpmWindow: [],
    lastCacheUpdate: 0,
    lastPersistUpdate: 0,
    cacheTTL: 10000
  };

  limiter._doPersistCacheWrite();

  const fullRpm = limiter._readWindowFromProperties('rpm', 'rate_limit_rpm_backup');
  const legacyRpm = JSON.parse(propsData.get('rpm_window') || '[]');

  assert(fullRpm.length === entries.length, 'lettura chunkata deve ricostruire tutta la finestra RPM');
  assert(legacyRpm.length < entries.length, 'dump legacy deve essere solo un fallback compatto');
  assert((propsData.get('rpm_window') || '').length <= 4000, 'dump legacy rpm_window deve restare sotto il limite conservativo');
  assert(parseInt(propsData.get('rate_limit_window_rpm_chunks') || '0', 10) > 1, 'finestra RPM completa deve essere salvata su chunk persistenti');
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

  assert(global.CONFIG.MAX_EMAILS_PER_RUN === 8, "safety valve persistita non deve mutare CONFIG: il throttling viene letto dall'EmailProcessor");
  global.CONFIG = originalConfig;
}

console.log('--- Test _applySafetyValve_: non muta CONFIG congelato ---');
{
  const originalConfig = global.CONFIG;
  global.CONFIG = Object.freeze({ MAX_EMAILS_PER_RUN: 8 });
  const propsData = new Map();
  const limiter = Object.create(GeminiRateLimiter.prototype);
  limiter.props = {
    getProperty: (key) => propsData.has(key) ? propsData.get(key) : null,
    setProperty: (key, value) => propsData.set(key, value)
  };
  limiter._getPacificDate = () => '2026-05-10';

  limiter._applySafetyValve_();

  assert(global.CONFIG.MAX_EMAILS_PER_RUN === 8, 'CONFIG congelato deve rimanere invariato');
  assert(propsData.get('safety_valve_last_date') === '2026-05-10', 'safety valve deve persistere la data');
  assert(propsData.get('safety_valve_reduced_value') === '4', 'safety valve deve persistere il valore ridotto');
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

console.log('--- Test _incrementCountersAtomic: lock timeout non incrementa senza protezione ---');
{
  const originalLockService = global.LockService;
  const propsData = new Map([
    ['rpd_flash', '4'],
    ['tokens_flash', '100']
  ]);
  const limiter = Object.create(GeminiRateLimiter.prototype);
  limiter.props = {
    getProperty: (key) => propsData.has(key) ? propsData.get(key) : null,
    setProperty: (key, value) => propsData.set(key, String(value))
  };
  limiter._getPacificDate = () => '2026-05-12';
  global.LockService = {
    getScriptLock: () => ({
      tryLock: () => false,
      releaseLock: () => {}
    })
  };

  try {
    limiter._incrementCountersAtomic('flash', 25);
    assert(false, 'lock timeout deve bloccare il tracciamento quota');
  } catch (error) {
    assert(String(error.message).includes('QUOTA_TRACKING_FAILED'), 'errore lock timeout deve essere esplicito');
    assert(propsData.get('rpd_flash') === '4', 'RPD non deve essere mutato senza lock');
    assert(propsData.get('tokens_flash') === '100', 'token non devono essere mutati senza lock');
  } finally {
    global.LockService = originalLockService;
  }
}

console.log('--- Test _incrementCountersAtomic: reset giorno e token in scrittura aggregata ---');
{
  const propsData = new Map([
    ['rpd_date_flash', '2026-05-11'],
    ['rpd_flash', '8'],
    ['tokens_flash', '9999']
  ]);
  const setPropertiesCalls = [];
  const limiter = Object.create(GeminiRateLimiter.prototype);
  limiter.props = {
    getProperty: (key) => propsData.has(key) ? propsData.get(key) : null,
    setProperty: (key, value) => propsData.set(key, String(value)),
    setProperties: (values) => {
      setPropertiesCalls.push(Object.assign({}, values));
      Object.keys(values || {}).forEach((key) => propsData.set(key, String(values[key])));
    }
  };
  limiter._getPacificDate = () => '2026-05-12';

  const counters = limiter._incrementCountersAtomic('flash', 25, true);

  assert(counters.rpd === 1, 'nuovo giorno deve ripartire da RPD 1');
  assert(counters.tokens === 25, 'nuovo giorno deve ripartire dai token della richiesta corrente');
  assert(propsData.get('rpd_date_flash') === '2026-05-12', 'data RPD deve essere aggiornata al giorno corrente');
  assert(propsData.get('rpd_flash') === '1', 'RPD persistente deve essere resettato e incrementato');
  assert(propsData.get('tokens_flash') === '25', 'token persistenti devono essere resettati e incrementati');
  assert(setPropertiesCalls.length === 1, 'reset e incremento devono avvenire in una sola scrittura aggregata');
  assert(setPropertiesCalls[0].rpd_date_flash === '2026-05-12', 'scrittura aggregata deve includere la data');
  assert(setPropertiesCalls[0].rpd_flash === '1', 'scrittura aggregata deve includere RPD finale');
  assert(setPropertiesCalls[0].tokens_flash === '25', 'scrittura aggregata deve includere token finali');
}

console.log('--- Test _initializeCounters: lock mancato riallinea cache se reset gia persistito ---');
{
  const originalLockService = global.LockService;
  const originalUtilities = global.Utilities;
  const now = Date.now();
  const propsData = new Map([
    ['rate_limit_date', '2026-05-12'],
    ['rpm_window', JSON.stringify([{ timestamp: now, modelKey: 'flash', nonce: 'rpm-current' }])],
    ['tpm_window', JSON.stringify([{ timestamp: now, modelKey: 'flash', nonce: 'tpm-current', tokens: 10 }])]
  ]);

  const limiter = Object.create(GeminiRateLimiter.prototype);
  limiter.cache = {
    rpmWindow: [],
    tpmWindow: [],
    lastCacheUpdate: 0,
    lastPersistUpdate: 0,
    cacheTTL: 10000
  };
  limiter.props = {
    getProperty: (key) => propsData.has(key) ? propsData.get(key) : null
  };
  limiter._getPacificDate = () => '2026-05-12';

  global.LockService = {
    getScriptLock: () => ({
      tryLock: () => false,
      releaseLock: () => {}
    })
  };
  global.Utilities = {
    sleep: () => {}
  };

  try {
    limiter._initializeCounters();
    assert(limiter.cache.rpmWindow.length === 1, 'lock miss con reset gia persistito deve rileggere RPM da storage');
    assert(limiter.cache.tpmWindow.length === 1, 'lock miss con reset gia persistito deve rileggere TPM da storage');
  } finally {
    global.LockService = originalLockService;
    global.Utilities = originalUtilities;
  }
}

console.log('--- Test _validateModelAvailability: RPD stale non blocca nuovo giorno ---');
{
  const propsData = new Map([
    ['rpd_date_flash', '2026-05-11'],
    ['rpd_flash', '10'],
    ['tokens_flash', '5000']
  ]);
  const limiter = Object.create(GeminiRateLimiter.prototype);
  limiter.models = {
    flash: { name: 'gemini-test', rpm: 10, tpm: 10000, rpd: 10 }
  };
  limiter.cache = {
    rpmWindow: [],
    tpmWindow: [],
    lastCacheUpdate: Date.now(),
    lastPersistUpdate: 0,
    cacheTTL: 10000
  };
  limiter.safetyMargin = { rpm: 0.8, tpm: 0.8, rpd: 0.8 };
  limiter.throttleDelays = { rpm: 250, tpm: 1000, rpd: 15000 };
  limiter.props = {
    getProperty: (key) => propsData.has(key) ? propsData.get(key) : null
  };
  limiter._getPacificDate = () => '2026-05-12';

  const result = limiter._validateModelAvailability('flash', 100);
  assert(result.available === true, 'RPD della giornata precedente non deve esaurire il modello nel nuovo giorno');
  assert(result.quotaLeft.rpd === 10, 'quota RPD disponibile deve ripartire dal limite giornaliero');
}

console.log('--- Test model policy: normalizza gli alias storici sui modelli GA correnti ---');
{
  const limiter = Object.create(GeminiRateLimiter.prototype);
  const normalized = limiter._normalizeDeprecatedModelNames({
    quality: { name: 'gemini-2.5-flash', useCases: ['generation'] },
    oldLite: { name: 'gemini-2.5-flash-lite', useCases: ['quick_check'] },
    missingGeneration: { useCases: ['generation'] },
    missingQuick: { useCases: ['quick_check'] }
  });

  assert(normalized.quality.name === 'gemini-3.6-flash', 'il modello qualita 2.5 Flash deve essere riscritto a 3.6');
  assert(normalized.oldLite.name === 'gemini-3.5-flash-lite', 'i vecchi alias lite devono seguire la policy 3.5 Flash-Lite');
  assert(normalized.missingGeneration.name === 'gemini-3.6-flash', 'fallback generation mancante deve essere 3.6 Flash');
  assert(normalized.missingQuick.name === 'gemini-3.5-flash-lite', 'fallback quick_check mancante deve essere 3.5 Flash-Lite');
}

console.log('--- Test _getCandidateModels: task policy generation vs quick/language ---');
{
  const limiter = Object.create(GeminiRateLimiter.prototype);
  limiter.strategies = {
    generation: ['flash-3.6', 'flash-3.6-backup', 'flash-lite'],
    quick_check: ['flash-lite'],
    fallback: ['flash-lite']
  };

  assert(limiter._getCandidateModels('generation')[0] === 'flash-3.6', 'generation deve partire dal tier qualita aggiornato');
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
    let released = 0;
    let finalized = 0;
    limiter._releaseReservation = () => { released++; };
    limiter._finalizeReservation = () => { finalized++; };
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
    assert(finalized === 1 && released === 0, 'errore transient deve consumare la reservation minuto invece di rilasciarla');
    assert(result.success === true && result.result === 'ok', 'il secondo tentativo deve completare la richiesta');
  } finally {
    global.Utilities = originalUtilities;
  }
}

console.log('--- Test executeRequest bypass: traccia forceModel invece del nome fisico ---');
{
  const originalLockService = global.LockService;
  const propsData = new Map();
  const limiter = Object.create(GeminiRateLimiter.prototype);
  limiter.models = {
    'flash-3.5-backup': { name: 'gemini-3.5-flash', rpm: 2000, tpm: 2000000, rpd: 3500 },
    'flash-lite': { name: 'gemini-3.1-flash-lite', rpm: 2000, tpm: 2000000, rpd: 3500 }
  };
  limiter.props = {
    getProperty: (key) => propsData.has(key) ? propsData.get(key) : null,
    setProperty: (key, value) => propsData.set(key, String(value))
  };
  limiter._getPacificDate = () => '2026-05-12';
  global.LockService = {
    getScriptLock: () => ({
      tryLock: () => true,
      releaseLock: () => {}
    })
  };

  try {
    const result = limiter.executeRequest(
      'generation',
      (modelName) => {
        assert(modelName === 'gemini-3.5-flash', 'il bypass deve chiamare il nome modello fisico richiesto');
        return 'ok';
      },
      {
        skipRateLimit: true,
        forceModel: 'flash-3.5-backup',
        modelNameOverride: 'gemini-3.5-flash',
        estimatedTokens: 42
      }
    );

    assert(result.success === true && result.modelUsed === 'gemini-3.5-flash', 'il bypass deve completare la richiesta col modello fisico');
    assert(propsData.get('rpd_flash-3.5-backup') === '1', 'il bypass deve tracciare RPD sul model key forzato');
    assert(propsData.get('tokens_flash-3.5-backup') === '42', 'il bypass deve tracciare token sul model key forzato');
    assert(!propsData.has('rpd_flash-lite'), 'il bypass non deve cadere su un modello risolto dal solo nome fisico');
  } finally {
    global.LockService = originalLockService;
  }
}


console.log('--- Test executeRequest: usa usageMetadata reale quando disponibile ---');
{
  const originalUtilities = global.Utilities;
  global.Utilities = {
    sleep: () => {}
  };

  try {
    const propsData = new Map([['rpd_flash', '3']]);
    const limiter = Object.create(GeminiRateLimiter.prototype);
    limiter.defaultMaxRetries = 1;
    limiter.props = {
      getProperty: (key) => propsData.has(key) ? propsData.get(key) : null
    };
    limiter._selectAndReserveModel = () => ({
      available: true,
      modelKey: 'flash',
      model: { name: 'gemini-test' },
      shouldThrottle: null,
      reservationId: 'res-usage'
    });
    limiter._getRequestsInWindow = () => 1;

    let trackedTokens = 0;
    limiter._trackRequest = (_modelKey, tokensUsed) => {
      trackedTokens = tokensUsed;
    };

    const result = limiter.executeRequest('generation', () => ({
      __rateLimiterEnvelope: true,
      result: 'ok',
      usageMetadata: { totalTokenCount: 77, promptTokenCount: 50, candidatesTokenCount: 27 }
    }), { maxRetries: 1, estimatedTokens: 10 });

    assert(result.success === true && result.result === 'ok', 'envelope deve essere spacchettato nel risultato applicativo');
    assert(trackedTokens === 77, 'usageMetadata.totalTokenCount deve prevalere sulla stima');
    assert(result.actualTokens === 77, 'executeRequest deve esporre i token reali');
    assert(result.quotaUsed.tokens === 77, 'quotaUsed deve riportare i token contabilizzati');
  } finally {
    global.Utilities = originalUtilities;
  }
}


console.log('--- Test _withRateLimitLock_: releaseLock fallito non maschera il risultato ---');
{
  const originalLockService = global.LockService;
  let releaseCalls = 0;
  global.LockService = {
    getScriptLock: () => ({
      tryLock: () => true,
      releaseLock: () => {
        releaseCalls++;
        throw new Error('release failure');
      }
    })
  };

  try {
    const limiter = Object.create(GeminiRateLimiter.prototype);
    const lockResult = limiter._withRateLimitLock_(() => ({ available: true, reservationId: 'res-ok' }), {
      lockDescription: 'test release failure'
    });

    assert(lockResult.ok === true, 'releaseLock fallito non deve trasformare il risultato in errore');
    assert(lockResult.result.reservationId === 'res-ok', 'il risultato della callback deve essere preservato');
    assert(releaseCalls === 1, 'deve comunque tentare il rilascio del lock');
  } finally {
    global.LockService = originalLockService;
  }
}


console.log('--- Test reservation lifecycle: release/finalize idempotenti e monotoni ---');
{
  const limiter = Object.create(GeminiRateLimiter.prototype);
  limiter.cache = {
    rpmWindow: [{ timestamp: 1, nonce: 'res-ok', modelKey: 'flash', reserved: true, completed: false }],
    tpmWindow: [{ timestamp: 1, nonce: 'res-ok', modelKey: 'flash', tokens: 10, reserved: true, completed: false }]
  };
  limiter._refreshCache = () => {};
  limiter._persistCache = () => {};
  limiter._withRateLimitLock_ = (fn) => ({ ok: true, result: fn() });

  limiter._finalizeReservation('flash', 'res-ok', 123, 77);
  limiter._releaseReservation('flash', 'res-ok');

  assert(limiter.cache.rpmWindow[0].completed === true, 'reservation finalizzata deve restare completed');
  assert(limiter.cache.rpmWindow[0].released !== true, 'release tardivo non deve escludere una richiesta completata dalla finestra RPM');
  assert(limiter.cache.tpmWindow[0].released !== true, 'release tardivo non deve escludere una richiesta completata dalla finestra TPM');
  assert(limiter.cache.tpmWindow[0].tokens === 77, 'reservation TPM deve essere riallineata ai token reali');
  assert(limiter.cache.tpmWindow[0].estimatedTokens === 10, 'reservation TPM deve conservare la stima originale per diagnostica');
  assert(limiter.cache.tpmWindow[0].actualTokens === 77, 'reservation TPM deve esporre i token reali');

  limiter.cache = {
    rpmWindow: [{ timestamp: 2, nonce: 'res-cancel', modelKey: 'flash', reserved: true, completed: false }],
    tpmWindow: [{ timestamp: 2, nonce: 'res-cancel', modelKey: 'flash', tokens: 10, reserved: true, completed: false }]
  };

  limiter._releaseReservation('flash', 'res-cancel');
  limiter._finalizeReservation('flash', 'res-cancel', 456);

  assert(limiter.cache.rpmWindow[0].released === true, 'reservation rilasciata deve restare released');
  assert(limiter.cache.rpmWindow[0].completed !== true, 'finalize tardivo non deve riattivare reservation rilasciata');
  assert(limiter.cache.tpmWindow[0].completed !== true, 'finalize tardivo non deve riattivare token reservation rilasciata');
}


console.log('--- Test sorgente rate limiter: nessun mojibake nei log operativi ---');
{
  const mojibakePattern = /(?:Ã.|â.|ð.|ï.)/;
  assert(!mojibakePattern.test(gasRateLimiterCode), 'gas_rate_limiter.js non deve contenere sequenze mojibake nei log/commenti');
}

console.log('✅ Rate limiter WAL tests completati');
