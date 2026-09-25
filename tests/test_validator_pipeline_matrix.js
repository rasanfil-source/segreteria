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
  sacramentalDeadline: '_checkSacramentalDeadline', physicalPresenceConstraint: '_checkPhysicalPresenceConstraint',
  territoryConsistency: '_checkTerritoryConsistency', sensitiveContinuity: '_checkSensitiveContinuityQuality',
  documentMismatchTemplate: '_checkDocumentMismatchTemplate', expectedDocumentMissingTemplate: '_checkExpectedDocumentMissingTemplate'
};
// Isolate the orchestrator, not its decision: two independent penalties must multiply,
// and any blocking error wins even when the numeric threshold is satisfied.
for (const [first, firstMethod] of Object.entries(checks)) for (const [second, secondMethod] of Object.entries(checks)) {
  if (first === second) continue;
  for (const blocking of bools) row(`aggregate ${first}/${second}/${blocking}`, () => {
    const v = new context.ResponseValidator();
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
    // Check method results are exposed, rather than silently dropped.
    assert.ok(Object.values(result.details).some(detail => detail.score === 0.8));
    assert.ok(Object.values(result.details).some(detail => detail.score === 0.9));
  });
}

for (const initialValid of bools) for (const attempt of bools) for (const fixed of bools) for (const finalValid of bools) row(`refinement ${initialValid}/${attempt}/${fixed}/${finalValid}`, () => {
  const v = new context.ResponseValidator();
  let checksRun = 0;
  let refinements = 0;
  const texts = [];
  v._runValidationChecks = text => {
    texts.push(text);
    return { isValid: checksRun++ === 0 ? initialValid : finalValid, score: 1, errors: [], warnings: [], details: {} };
  };
  v._perfezionamentoAutomatico = () => { refinements++; return { fixed, text: 'Corrected response' }; };
  const result = v.validateResponse('Original response', 'it', '', '', '', 'full', attempt);
  const refined = !initialValid && attempt && fixed;
  assert.equal(refinements, Number(!initialValid && attempt));
  assert.equal(checksRun, refined ? 2 : 1);
  assert.equal(result.isValid, refined ? finalValid : initialValid);
  assert.equal(result.metadata.wasRefined, refined);
  assert.equal(result.fixedResponse, refined && finalValid ? 'Corrected response' : null);
  assert.equal(texts.at(-1), refined ? 'Corrected response' : 'Original response');
});

// Full truth table for the semantic mobility exception. Toggle each prerequisite
// independently so a weakening of any AND term causes a failing test.
for (let mask = 0; mask < 256; mask++) row(`mobility exception mask=${mask}`, () => {
  const flags = Array.from({ length: 8 }, (_, i) => Boolean(mask & (1 << i)));
  const [baseValid, highScore, thinkingValid, irrelevant, grounded, constrained, remote, recognized] = flags;
  const v = new context.ResponseValidator();
  const baseScore = highScore ? 0.85 : 0.849;
  v._runValidationChecks = () => ({ isValid: baseValid, score: baseScore, errors: baseValid ? [] : ['base error'], warnings: [], details: {} });
  let calls = 0;
  v.semanticValidator = {
    shouldRun: () => true,
    validateHallucinations: () => {
      calls++;
      return { isValid: false, confidence: 0.4, reason: 'semantic issue', details: { irrelevantDetails: irrelevant ? ['remote suggestion'] : [], unsupportedClaims: grounded ? [] : ['invented fact'] } };
    },
    validateThinkingLeak: () => ({ isValid: thinkingValid, confidence: 0.7, reason: 'thinking issue' })
  };
  const result = v.validateResponse(remote ? 'Rispondiamo via email.' : 'Grazie per il messaggio.', 'it', '', '', '', 'full', false, {
    physicalPresenceConstraint: { has_constraint: constrained, type: recognized ? 'mobility' : 'other' }
  });
  const exception = flags.every(Boolean);
  assert.equal(calls, 1);
  assert.equal(result.isValid, exception);
  assert.equal(result.score, exception ? baseScore : 0.4);
  assert.equal(result.warnings.length, Number(exception));
  if (!exception) assert.equal(result.reasonCode, !thinkingValid ? 'semantic_thinking_leak' : !grounded ? 'semantic_unsupported_claim' : irrelevant ? 'semantic_irrelevant_detail' : 'semantic_validation_failed');
});

// Exercise real checks through the public API as well as isolated decision tables.
const validText = 'Gentile signora, grazie per il suo messaggio. Restiamo a disposizione per rispondere alle sue domande. Cordiali saluti, Segreteria Parrocchia Sant\'Eugenio';
for (const threshold of [0, 0.6, 1]) for (const wrapper of ['plain', 'email', 'analysis']) for (const blocked of bools) row(`public ${threshold}/${wrapper}/${blocked}`, () => {
  const v = new context.ResponseValidator();
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
