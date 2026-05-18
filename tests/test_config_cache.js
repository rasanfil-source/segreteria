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
  ['METRICS_SHEET_ID', 'metrics-1']
]);
const getCounts = new Map();
let getScriptPropertiesCalls = 0;

global.PropertiesService = {
  getScriptProperties: () => {
    getScriptPropertiesCalls++;
    return {
      getProperty: (key) => {
        getCounts.set(key, (getCounts.get(key) || 0) + 1);
        return backingProps.has(key) ? backingProps.get(key) : null;
      }
    };
  }
};

const gasConfigPath = path.join(__dirname, '..', 'gas_config.js');
const code = fs.readFileSync(gasConfigPath, 'utf8');
vm.runInThisContext(code, { filename: gasConfigPath });

assert(_getScriptProperty('GEMINI_API_KEY') === 'first-key', 'il primo accesso deve leggere la property reale');
backingProps.set('GEMINI_API_KEY', 'changed-key');
assert(_getScriptProperty('GEMINI_API_KEY') === 'first-key', 'il secondo accesso deve riusare il valore in cache');
assert(getCounts.get('GEMINI_API_KEY') === 1, 'getProperty deve essere chiamato una sola volta per chiave cached');
assert(getScriptPropertiesCalls === 1, 'getScriptProperties deve essere inizializzato una sola volta');

assert(CONFIG.SPREADSHEET_ID === 'sheet-1', 'il getter SPREADSHEET_ID deve usare _getScriptProperty');
backingProps.set('SPREADSHEET_ID', 'sheet-2');
assert(CONFIG.SPREADSHEET_ID === 'sheet-1', 'il getter SPREADSHEET_ID deve mantenere il valore cached');
assert(getCounts.get('SPREADSHEET_ID') === 1, 'SPREADSHEET_ID deve essere letto una sola volta');

assert(CONFIG.METRICS_SHEET_ID === 'metrics-1', 'il getter METRICS_SHEET_ID deve usare _getScriptProperty');
assert(getCounts.get('METRICS_SHEET_ID') === 1, 'METRICS_SHEET_ID deve essere letto una sola volta');

assert(CONFIG.MAX_SAFE_PROMPT_CHARS === 100000, 'MAX_SAFE_PROMPT_CHARS deve avere un fallback esplicito');
assert(CONFIG.MAX_PROVIDED_INFO_JSON_CHARS === 45000, 'MAX_PROVIDED_INFO_JSON_CHARS deve avere un fallback esplicito');
assert(CONFIG.MODEL_NAME === 'gemini-2.5-flash', 'MODEL_NAME deve puntare al modello qualita per le risposte');
assert(CONFIG.MODEL_STRATEGY.generation[0] === 'flash-2.5', 'la generazione deve partire da Gemini 2.5 Flash');
assert(CONFIG.MODEL_STRATEGY.quick_check[0] === 'flash-lite', 'quick_check/categoria/lingua devono partire dal modello lite');

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

console.log('✅ Test _getScriptProperty cache passato');
