const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

global.CONFIG = {
  VALIDATION_MIN_SCORE: 0.6,
  SEMANTIC_VALIDATION: { enabled: false }
};

global.LANGUAGE_MARKERS = {
  it: ['grazie', 'cordiali', 'saluti', 'gentile', 'parrocchia']
};

const gasValidatorPath = path.join(__dirname, '..', 'gas_response_validator.js');
const code = fs.readFileSync(gasValidatorPath, 'utf8');
vm.runInThisContext(code, { filename: gasValidatorPath });

const validator = new ResponseValidator();

console.log('--- Test _checkForbiddenContent (placeholder) ---');
const placeholderResult = validator._checkForbiddenContent('Gentile utente, XXX Cordiali saluti.');
assert(placeholderResult.score === 0.0, 'placeholder deve portare score a 0');
assert(
  placeholderResult.errors.some((e) => e.includes('Contiene placeholder')),
  'deve segnalare errore placeholder'
);

console.log('--- Test _checkForbiddenContent (frase incertezza) ---');
const uncertainResult = validator._checkForbiddenContent('Non sono sicuro di poter confermare.');
assert(uncertainResult.score <= 0.5, 'frase di incertezza deve ridurre fortemente score');
assert(
  uncertainResult.errors.some((e) => e.includes('frasi di incertezza')),
  'deve segnalare frasi di incertezza'
);

console.log('--- Test _checkExposedReasoning (thinking leak critico) ---');
const reasoningResult = validator._checkExposedReasoning(
  'Rivedendo la knowledge base, la invito a contattare la segreteria.'
);
assert(reasoningResult.score === 0.0, 'thinking leak critico deve portare score a 0');
assert(
  reasoningResult.errors.some((e) => e.includes('RAGIONAMENTO ESPOSTO CRITICO')),
  'deve segnalare ragionamento esposto critico'
);

console.log('--- Test _checkSignature (none_or_continuity) ---');
const signatureResult = validator._checkSignature('Messaggio follow-up senza firma', 'none_or_continuity');
assert(signatureResult.score === 1.0, 'in none_or_continuity la firma non deve penalizzare');
assert(signatureResult.warnings.length === 0, 'in none_or_continuity non deve esserci warning firma');

console.log('--- Test _checkSignature (session) ---');
const sessionSignatureResult = validator._checkSignature('Messaggio follow-up rapido senza firma', 'session');
assert(sessionSignatureResult.score === 1.0, 'in session la firma non deve penalizzare');
assert(sessionSignatureResult.warnings.length === 0, 'in session non deve esserci warning firma');

console.log('--- Test hallucination: civico non deve essere interpretato come orario ---');
const civicResult = validator._checkHallucinations(
  'Per la verifica territoriale risulta Via Roma civico 12.30.',
  'Copertura territoriale: Via Roma civico 12.30',
  'Abito in Via Roma civico 12.30'
);
assert(civicResult.score === 1.0, 'civico 12.30 non deve generare warning orari inventati');
assert(
  !civicResult.warnings.some((w) => w.includes('Orari non in KB')),
  'non deve segnalare orari inventati nel caso civico'
);

console.log('--- Test hallucination: numero civico non deve autorizzare orario inventato ---');
const streetNumberResult = validator._checkHallucinations(
  'La messa e alle 10:00.',
  'Orari disponibili: 09:00 e 11:00.',
  'Abito in Via Roma 10, vorrei informazioni.'
);
assert(
  streetNumberResult.warnings.some((w) => w.includes('Orari non in KB: 10:00')),
  'numero civico 10 non deve sdoganare 10:00 come orario presente nel messaggio originale'
);
assert(
  Array.isArray(streetNumberResult.hallucinations.times) &&
  streetNumberResult.hallucinations.times.includes('10:00'),
  '10:00 deve essere registrato tra gli orari inventati'
);

console.log('--- Test hallucination: ora solo numerica in KB deve validare 10:00 ---');
const hourOnlyKbResult = validator._checkHallucinations(
  'La messa è alle 10:00.',
  'Orari messe festive: domenica alle ore 10.',
  'Vorrei sapere gli orari della domenica.'
);
assert(hourOnlyKbResult.score === 1.0, 'una KB con "ore 10" deve autorizzare una risposta con 10:00');
assert(
  !hourOnlyKbResult.warnings.some((w) => w.includes('Orari non in KB')),
  'non deve segnalare orari inventati se la KB contiene un\'ora contestuale equivalente'
);
assert(
  !hourOnlyKbResult.hallucinations.times || hourOnlyKbResult.hallucinations.times.length === 0,
  'non deve registrare 10:00 tra gli orari allucinati quando la KB contiene "ore 10"'
);

console.log('--- Test SemanticValidator: fallback lazy senza GeminiService/CacheService ---');
{
  const originalConfig = global.CONFIG;
  const originalGeminiService = global.GeminiService;
  const originalCacheService = global.CacheService;
  const originalUrlFetchApp = global.UrlFetchApp;

  try {
    global.CONFIG = { VALIDATION_MIN_SCORE: 0.6, SEMANTIC_VALIDATION: { enabled: true } };
    global.GeminiService = undefined;
    global.CacheService = undefined;
    global.UrlFetchApp = undefined;

    const lazyValidator = new ResponseValidator();
    assert(lazyValidator.semanticValidator !== null, 'SemanticValidator deve inizializzarsi anche senza GeminiService');
    assert(lazyValidator.semanticValidator.runtimeSemanticAvailable === false, 'runtimeSemanticAvailable deve restare false fuori runtime GAS');

    const fallback = lazyValidator.semanticValidator.validateThinkingLeak('Risposta naturale.', { score: 0.9 });
    assert(fallback.skipped === true && fallback.fallback === true, 'senza runtime semantico deve usare fallback lazy');
    assert(fallback.isValid === true, 'fallback lazy con score alto deve restare valido');
  } finally {
    global.CONFIG = originalConfig;
    global.GeminiService = originalGeminiService;
    global.CacheService = originalCacheService;
    global.UrlFetchApp = originalUrlFetchApp;
  }
}

console.log('✅ Test core ResponseValidator passati');
