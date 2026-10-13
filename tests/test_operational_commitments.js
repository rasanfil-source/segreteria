const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {} }, CONFIG: { SEMANTIC_VALIDATION: { enabled: false } } });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../gas_response_validator.js'), 'utf8'), ctx);
const validator = new ctx.ResponseValidator();
const subject = 'Per Giandomenico: Locandina per fb e sito';
const body = 'Se l’ho già mandata chiedo scusa. Altrimenti pubblichiamo in quei due posti questa più leggera. Grazie';
const reply = 'Buonasera. Abbiamo ricevuto la locandina e provvederemo a pubblicarla sul sito web e sulla pagina Facebook della parrocchia. Cordiali saluti, Segreteria';
for (const kb of ['', 'La parrocchia dispone di un sito web e di una pagina Facebook.']) {
  for (const purpose of ['operational_request', 'mixed', 'status_update']) {
    const runtime = { validationContext: { requestPurpose: purpose } };
    assert(validator._checkKnowledgeContextualizationRisk(reply, kb, body, runtime).requiresSemanticReview);
  }
}
for (const text of ['Pubblicheremo la locandina.', 'Stamperemo il documento.', 'Le faremo sapere.', 'We will publish it.']) {
  assert(validator._checkKnowledgeContextualizationRisk(text, '').requiresSemanticReview, text);
}
for (const text of ['Abbiamo ricevuto la locandina.', 'La richiesta riguarda la pubblicazione su sito e Facebook.', 'È possibile pubblicare la locandina?']) {
  assert.equal(validator._checkKnowledgeContextualizationRisk(text, '').requiresSemanticReview, false, text);
}
// Il riscontro semantico decide sulla fonte dell'impegno, non sul verbo isolato.
for (const authorized of [false, true]) {
  let calls = 0;
  validator.semanticValidator = {
    shouldRun: () => false,
    validateHallucinations(response, kb, regex, email, options) {
      calls++;
      assert.equal(options.forceRelevanceReview, true);
      assert(options.groundingParts.body.includes('pubblichiamo'));
      assert.equal(options.groundingParts.history.includes('pubblicazione confermata'), authorized);
      return { isValid: authorized, hallucinations: authorized ? [] : ['Impegno privo di riscontro'], confidence: 1 };
    },
    validateThinkingLeak: () => ({ isValid: true })
  };
  const result = validator.validateResponse(reply, 'it', 'Sito e Facebook parrocchiali.', body, subject, 'full', false,
    { validationContext: { requestPurpose: 'operational_request', explicitThreadContext: authorized ? 'Segreteria: pubblicazione confermata.' : '' } });
  assert.equal(calls, 1);
  assert.equal(result.isValid, authorized);
}
console.log('Impegni operativi: attivazione semantica, ricezione e accordi documentati verificati');
