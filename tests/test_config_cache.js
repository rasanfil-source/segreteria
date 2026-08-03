const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

console.log('--- Test _getScriptProperty: primo accesso e cache ---');

const backingProps = new Map([
  ['GEMINI_API_KEY', 'first-key'],
  ['SPREADSHEET_ID', 'sheet-1'],
  ['METRICS_SHEET_ID', 'metrics-1'],
  ['ADMIN_EMAIL', 'admin@example.test'],
  ['VALIDATION_REVIEW_EMAIL', 'review@example.test']
]);
const getCounts = new Map();
let getScriptPropertiesCalls = 0;
let getPropertiesCalls = 0;
let throwOnKey = null;

global.PropertiesService = {
  getScriptProperties: () => {
    getScriptPropertiesCalls++;
    return {
      getProperties: () => {
        getPropertiesCalls++;
        if (throwOnKey) {
          throw new Error(`forced getProperties failure: ${throwOnKey}`);
        }
        return Object.fromEntries(backingProps.entries());
      },
      getProperty: (key) => {
        if (key === throwOnKey) {
          throw new Error(`forced getProperty failure: ${key}`);
        }
        getCounts.set(key, (getCounts.get(key) || 0) + 1);
        return backingProps.has(key) ? backingProps.get(key) : null;
      }
    };
  }
};

const gasConfigPath = path.join(__dirname, '..', 'gas_config.js');
const code = fs.readFileSync(gasConfigPath, 'utf8');
vm.runInThisContext(code, { filename: gasConfigPath });
const exampleCode = fs.readFileSync(path.join(__dirname, '..', 'gas_config.example.js'), 'utf8');

function loadExampleConfig() {
  const sandbox = {
    console,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    JSON,
    RegExp,
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: () => null
      })
    },
    ScriptApp: {
      getScriptId: () => 'example-script'
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(exampleCode, sandbox, { filename: path.join(__dirname, '..', 'gas_config.example.js') });
  return sandbox.CONFIG;
}

function collectConfigPaths(value, prefix = '', paths = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (prefix) paths.push(prefix);
    return paths;
  }

  Object.keys(value).forEach((key) => {
    const nextPath = prefix ? `${prefix}.${key}` : key;
    paths.push(nextPath);

    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const child = descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ? descriptor.value
      : undefined;

    if (child && typeof child === 'object' && !Array.isArray(child)) {
      collectConfigPaths(child, nextPath, paths);
    }
  });

  return paths;
}

assert(
  exampleCode.includes('_SCRIPT_PROPERTY_CACHE_TTL_MS'),
  'gas_config.example.js deve usare un TTL per la cache delle ScriptProperties'
);
assert(
  exampleCode.includes('!Number.isFinite(value)'),
  'gas_config.example.js deve validare NaN/Infinity nei range numerici'
);
assert(
  !/rasanfil@/i.test(code) && !/rasanfil@/i.test(exampleCode),
  'gli indirizzi email reali non devono essere hardcoded nei file di config'
);

const productionConfigPaths = new Set(collectConfigPaths(CONFIG));
const exampleConfigPaths = new Set(collectConfigPaths(loadExampleConfig()));
const missingInExample = [...productionConfigPaths].filter((pathName) => !exampleConfigPaths.has(pathName)).sort();
const extraInExample = [...exampleConfigPaths].filter((pathName) => !productionConfigPaths.has(pathName)).sort();
assert(
  missingInExample.length === 0,
  `gas_config.example.js manca chiavi presenti in gas_config.js: ${missingInExample.join(', ')}`
);
assert(
  extraInExample.length === 0,
  `gas_config.example.js contiene chiavi non presenti in gas_config.js: ${extraInExample.join(', ')}`
);

assert(_getScriptProperty('GEMINI_API_KEY') === 'first-key', 'il primo accesso deve leggere la property reale');
backingProps.set('GEMINI_API_KEY', 'changed-key');
assert(_getScriptProperty('GEMINI_API_KEY') === 'first-key', 'il secondo accesso deve riusare il valore in cache');
assert(!getCounts.has('GEMINI_API_KEY'), 'getProperty non deve essere chiamato per chiavi disponibili nel bulk getProperties');
assert(getPropertiesCalls === 1, 'getProperties deve essere chiamato una sola volta per popolare la cache bulk');
assert(getScriptPropertiesCalls === 1, 'getScriptProperties deve essere inizializzato una sola volta');

assert(CONFIG.SPREADSHEET_ID === 'sheet-1', 'il getter SPREADSHEET_ID deve usare _getScriptProperty');
backingProps.set('SPREADSHEET_ID', 'sheet-2');
assert(CONFIG.SPREADSHEET_ID === 'sheet-1', 'il getter SPREADSHEET_ID deve mantenere il valore cached');
assert(!getCounts.has('SPREADSHEET_ID'), 'SPREADSHEET_ID deve arrivare dal bulk getProperties');

assert(CONFIG.METRICS_SHEET_ID === 'metrics-1', 'il getter METRICS_SHEET_ID deve usare _getScriptProperty');
assert(!getCounts.has('METRICS_SHEET_ID'), 'METRICS_SHEET_ID deve arrivare dal bulk getProperties');
assert(CONFIG.LOGGING.ADMIN_EMAIL === 'admin@example.test', 'ADMIN_EMAIL deve arrivare da Script Properties');
assert(CONFIG.VALIDATION_REVIEW_ALERTS.email === 'review@example.test', 'VALIDATION_REVIEW_EMAIL deve arrivare da Script Properties');

assert(_getScriptProperty('MISSING_OPTIONAL') === null, 'una property assente deve restituire null');
backingProps.set('MISSING_OPTIONAL', 'late-value');
assert(_getScriptProperty('MISSING_OPTIONAL') === null, 'il null iniziale deve restare cached e non rileggere la property');
assert(!getCounts.has('MISSING_OPTIONAL'), 'la property assente non deve causare fallback getProperty dopo getProperties');

console.log('--- Test _getScriptPropertyStringArray: separatori strutturati preservano virgole interne ---');
_clearScriptPropertyCache(['CUSTOM_COMMA_LIST', 'CUSTOM_STRUCTURED_LIST', 'CUSTOM_JSON_LIST']);
backingProps.set('CUSTOM_COMMA_LIST', 'uno@example.com,due@example.com');
assert(
  JSON.stringify(_getScriptPropertyStringArray('CUSTOM_COMMA_LIST', [])) === JSON.stringify(['uno@example.com', 'due@example.com']),
  'senza separatori strutturati la virgola deve restare separatore semplice'
);

backingProps.set('CUSTOM_STRUCTURED_LIST', 'uno@example.com\r\nDisplay, Name <due@example.com>;tre@example.com');
assert(
  JSON.stringify(_getScriptPropertyStringArray('CUSTOM_STRUCTURED_LIST', [])) === JSON.stringify([
    'uno@example.com',
    'Display, Name <due@example.com>',
    'tre@example.com'
  ]),
  'con newline/punto e virgola le virgole interne agli elementi devono essere preservate'
);

backingProps.set('CUSTOM_JSON_LIST', JSON.stringify([' Display, Name <json@example.com> ', '', 'altro@example.com']));
assert(
  JSON.stringify(_getScriptPropertyStringArray('CUSTOM_JSON_LIST', [])) === JSON.stringify([
    'Display, Name <json@example.com>',
    'altro@example.com'
  ]),
  'la lista JSON deve restare la forma più precisa e filtrare valori vuoti'
);

const originalDateNow = Date.now;
let fakeNow = 1000000;
Date.now = () => fakeNow;
try {
  _clearScriptPropertyCache('GEMINI_API_KEY');
  backingProps.set('GEMINI_API_KEY', 'ttl-key-1');
  assert(_getScriptProperty('GEMINI_API_KEY') === 'ttl-key-1', 'cache TTL: primo accesso legge il valore corrente');
  backingProps.set('GEMINI_API_KEY', 'ttl-key-2');
  assert(_getScriptProperty('GEMINI_API_KEY') === 'ttl-key-1', 'cache TTL: prima della scadenza resta cached');
  fakeNow += 60001;
  assert(_getScriptProperty('GEMINI_API_KEY') === 'ttl-key-2', 'cache TTL: dopo scadenza rilegge ScriptProperties');
} finally {
  Date.now = originalDateNow;
}

_clearScriptPropertyCache('GEMINI_API_KEY');
backingProps.set('GEMINI_API_KEY', 'force-key-1');
assert(_getScriptProperty('GEMINI_API_KEY') === 'force-key-1', 'forceRefresh: primo accesso popola la cache');
backingProps.set('GEMINI_API_KEY', 'force-key-2');
throwOnKey = 'GEMINI_API_KEY';
let forcedRefreshError = null;
try {
  _getScriptProperty('GEMINI_API_KEY', true);
} catch (error) {
  forcedRefreshError = error;
} finally {
  throwOnKey = null;
}
assert(forcedRefreshError, 'forceRefresh: errore PropertiesService bulk deve propagarsi');
assert(
  _getScriptProperty('GEMINI_API_KEY') === 'force-key-2',
  'forceRefresh fallito deve invalidare lo stale cached e rileggere al tentativo successivo'
);

assert(CONFIG.MAX_SAFE_PROMPT_CHARS === 100000, 'MAX_SAFE_PROMPT_CHARS deve avere un fallback esplicito');
assert(CONFIG.MAX_PROVIDED_INFO_JSON_CHARS === 45000, 'MAX_PROVIDED_INFO_JSON_CHARS deve avere un fallback esplicito');
assert(CONFIG.MODEL_NAME === 'gemini-3.6-flash', 'MODEL_NAME deve puntare al modello qualita aggiornato per le risposte');
assert(CONFIG.MODEL_STRATEGY.generation[0] === 'flash-3.6', 'la generazione deve partire da Gemini 3.6 Flash');
assert(CONFIG.MODEL_STRATEGY.quick_check[0] === 'flash-lite', 'quick_check/categoria/lingua devono partire dal modello lite');
assert(CONFIG.PAPAL_CONTEXT.currentName === 'Leone XIV', 'PAPAL_CONTEXT deve essere presente anche nella config di produzione');
assert(CONFIG.PAPAL_CONTEXT.previousName === 'Papa Francesco', 'PAPAL_CONTEXT deve definire il Papa precedente');

const originalMaxEmailsPerRun = CONFIG.MAX_EMAILS_PER_RUN;
CONFIG.MAX_EMAILS_PER_RUN = 0;
assert(validateConfig().valid === true, 'MAX_EMAILS_PER_RUN=0 deve essere valido per sospendere il processamento');
CONFIG.MAX_EMAILS_PER_RUN = -1;
let negativeMaxValidation;
const originalConsoleError = console.error;
console.error = () => {};
try {
  negativeMaxValidation = validateConfig();
} finally {
  console.error = originalConsoleError;
}
assert(
  negativeMaxValidation.valid === false &&
  negativeMaxValidation.errors.some((error) => error.includes('MAX_EMAILS_PER_RUN')),
  'MAX_EMAILS_PER_RUN negativo deve restare invalido'
);
CONFIG.MAX_EMAILS_PER_RUN = originalMaxEmailsPerRun;

const originalValidationMinScore = CONFIG.VALIDATION_MIN_SCORE;
const originalValidationWarningThreshold = CONFIG.VALIDATION_WARNING_THRESHOLD;
CONFIG.VALIDATION_MIN_SCORE = 60;
CONFIG.VALIDATION_WARNING_THRESHOLD = 90;
assert(validateConfig().valid === true, 'score di validazione percentuali 60/90 devono essere accettati dalla config');
assert(validateConfigOrThrow().valid === true, 'validateConfigOrThrow deve restituire il risultato valido');
CONFIG.VALIDATION_MIN_SCORE = 101;
let thrownConfigError = null;
console.error = () => {};
try {
  validateConfigOrThrow();
} catch (error) {
  thrownConfigError = error;
} finally {
  console.error = originalConsoleError;
}
assert(thrownConfigError && String(thrownConfigError.message || '').includes('Configurazione non valida'), 'validateConfigOrThrow deve fallire su score fuori range');
CONFIG.VALIDATION_MIN_SCORE = originalValidationMinScore;
CONFIG.VALIDATION_WARNING_THRESHOLD = originalValidationWarningThreshold;

const originalMaxSafeTokens = CONFIG.MAX_SAFE_TOKENS;
CONFIG.MAX_SAFE_TOKENS = NaN;
let nanRangeValidation;
console.error = () => {};
try {
  nanRangeValidation = validateConfig();
} finally {
  console.error = originalConsoleError;
}
assert(
  nanRangeValidation.valid === false &&
  nanRangeValidation.errors.some((error) => error.includes('MAX_SAFE_TOKENS') && error.includes('NaN')),
  'NaN deve essere rifiutato dai controlli di range numerici'
);
CONFIG.MAX_SAFE_TOKENS = originalMaxSafeTokens;

const originalKbHallucinationRiskThreshold = CONFIG.KB_HALLUCINATION_RISK_THRESHOLD;
CONFIG.KB_HALLUCINATION_RISK_THRESHOLD = 0;
let kbThresholdValidation;
console.error = () => {};
try {
  kbThresholdValidation = validateConfig();
} finally {
  console.error = originalConsoleError;
}
assert(
  kbThresholdValidation.valid === false &&
  kbThresholdValidation.errors.some((error) => error.includes('KB_HALLUCINATION_RISK_THRESHOLD')),
  'KB_HALLUCINATION_RISK_THRESHOLD fuori range deve essere rifiutato'
);
CONFIG.KB_HALLUCINATION_RISK_THRESHOLD = originalKbHallucinationRiskThreshold;

console.log('✅ Test _getScriptProperty cache passato');
