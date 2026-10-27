const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const filename = path.resolve(__dirname, '../gas_response_validator.js');
const context = vm.createContext({ console: { log() {}, warn() {}, error() {} }, CONFIG: { SEMANTIC_VALIDATION: { enabled: false } } });
vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
let cases = 0;
function row(label, fn) {
  try { fn(); cases++; } catch (error) { throw new Error(label, { cause: error }); }
}
const bools = [false, true];
const checks = {
  length: '_checkLength', language: '_checkLanguage', signature: '_checkSignature',
  content: '_checkForbiddenContent', hallucinations: '_checkHallucinations',
  capitalAfterComma: '_checkCapitalAfterComma', exposedReasoning: '_checkExposedReasoning',
  greeting: '_checkTimeBasedGreeting', temporalConsistency: '_checkTemporalConsistency',
  currentPopeReference: '_checkCurrentPopeReferences', originalDateQualification: '_checkOriginalDateQualification',
  sacramentalDeadline: '_checkSacramentalDeadline',
  territoryConsistency: '_checkTerritoryConsistency', sensitiveContinuity: '_checkSensitiveContinuityQuality',
  documentMismatchTemplate: '_checkDocumentMismatchTemplate', expectedDocumentMissingTemplate: '_checkExpectedDocumentMissingTemplate'
};
// Verifica l’orchestrazione: due penalità indipendenti si moltiplicano
// e gli errori bloccanti prevalgono anche quando la soglia numerica è soddisfatta.
for (const [first, firstMethod] of Object.entries(checks)) for (const [second, secondMethod] of Object.entries(checks)) {
  if (first === second) continue;
  for (const blocking of bools) row(`aggregate ${first}/${second}/${blocking}`, () => {
    const v = new context.ResponseValidator();
  v.semanticValidator = {shouldRun:()=>false, validateHallucinations:()=>({isValid:true,
    presence:{state:'compatible',reason:'Nessun conflitto nel test di orchestrazione.',requestEvidence:'',responseEvidence:''}})};
    for (const method of Object.values(checks)) v[method] = () => ({ score: 1, errors: [], warnings: [] });
    v._checkKnowledgeContextualizationRisk = () => ({ requiresSemanticReview: false });
    v[firstMethod] = () => ({ score: 0.8, errors: [], warnings: first === 'sacramentalDeadline' ? [] : ['warning-a'] });
    const canBlock = second !== 'greeting';
    v[secondMethod] = () => ({ score: 0.9, errors: blocking && canBlock ? ['block-b'] : [], warnings: [] });
    const result = v._runValidationChecks('Test', 'it', '', 'full');
    assert.ok(Math.abs(result.score - 0.72) < 1e-12);
    assert.equal(result.isValid, !(blocking && canBlock));
    assert.equal(result.errors.length, Number(blocking && canBlock));
    assert.equal(result.warnings.length, Number(first !== 'sacramentalDeadline'));
    // I risultati dei metodi di controllo sono presenti nel risultato pubblico.
    assert.ok(Object.values(result.details).some(detail => detail.score === 0.8));
    assert.ok(Object.values(result.details).some(detail => detail.score === 0.9));
  });
}

for (const initialValid of bools) for (const attempt of bools) for (const fixed of bools) for (const finalValid of bools) row(`refinement ${initialValid}/${attempt}/${fixed}/${finalValid}`, () => {
  const v = new context.ResponseValidator();
  v.semanticValidator = {shouldRun:()=>false, validateHallucinations:()=>({isValid:true,
    presence:{state:'compatible',reason:'Nessun conflitto nel test di orchestrazione.',requestEvidence:'',responseEvidence:''}})};
  let checksRun = 0;
  let refinements = 0;
  const texts = [];
  v._runValidationChecks = text => {
    texts.push(text);
    return { isValid: checksRun++ === 0 ? initialValid : finalValid, score: 1, errors: [], warnings: [], details: {} };
  };
  v._perfezionamentoAutomatico = (text, issues, language, temporal, cosmeticOnly) => {
    refinements++;
    assert.equal(cosmeticOnly, initialValid);
    return { fixed, text: 'Corrected response' };
  };
  const result = v.validateResponse('Original response', 'it', '', '', '', 'full', attempt);
  const refined = attempt && fixed;
  assert.equal(refinements, Number(attempt));
  assert.equal(checksRun, refined ? 2 : 1);
  assert.equal(result.isValid, refined ? finalValid : initialValid);
  assert.equal(result.metadata.wasRefined, refined);
  assert.equal(result.fixedResponse, refined && finalValid ? 'Corrected response' : null);
  assert.equal(texts.at(-1), refined ? 'Corrected response' : 'Original response');
});

// I conflitti di presenza seguono il contratto semantico dedicato.
// Verifica i controlli reali tramite API pubblica e tabelle decisionali isolate.
const validText = 'Gentile signora, grazie per il suo messaggio. Restiamo a disposizione per rispondere alle sue domande. Cordiali saluti, Segreteria Parrocchia Sant\'Eugenio';
for (const threshold of [0, 0.6, 1]) for (const wrapper of ['plain', 'email', 'analysis']) for (const blocked of bools) row(`public ${threshold}/${wrapper}/${blocked}`, () => {
  const v = new context.ResponseValidator();
  v.semanticValidator = {shouldRun:()=>false, validateHallucinations:()=>({isValid:true,
    presence:{state:'compatible',reason:'Nessun conflitto nel test di orchestrazione.',requestEvidence:'',responseEvidence:''}})};
  v.MIN_VALID_SCORE = threshold;
  const body = validText + (blocked ? ' [NOME]' : '');
  const input = wrapper === 'email' ? `<analisi>Internal reasoning</analisi><email>${body}</email>` : wrapper === 'analysis' ? `<analisi>Internal reasoning</analisi>${body}` : body;
  const result = v.validateResponse(input, 'it', '', '', '', 'full', false, { currentDate: '2026-09-25', currentTime: '10:00' });
  assert.equal(result.isValid, !blocked);
  assert.equal(result.score, blocked ? 0 : 1);
  assert.equal(result.metadata.responseLength, body.length);
  assert.equal(result.fixedResponse, null);
});
console.log(`Validator pipeline matrices: ${cases} cases passed`);
