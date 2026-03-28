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

console.log('--- Test hallucination: civico non deve essere interpretato come orario ---');
const civicResult = validator._checkHallucinations(
  'Per la verifica territoriale risulta Via Roma civico 12.30.',
  'it',
  'Copertura territoriale: Via Roma civico 12.30',
  'Abito in Via Roma civico 12.30',
  'Verifica territorio'
);
assert(civicResult.score === 1.0, 'civico 12.30 non deve generare warning orari inventati');
assert(
  !civicResult.warnings.some((w) => w.includes('Orari non in KB')),
  'non deve segnalare orari inventati nel caso civico'
);

console.log('✅ Test core ResponseValidator passati');
