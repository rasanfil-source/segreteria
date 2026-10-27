// Verifica il contratto e l'orchestrazione; i giudizi simulati non misurano l'accuratezza del modello.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {} }, CONFIG: {} });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../gas_response_validator.js'), 'utf8'), ctx);
const semantic = vm.runInContext('Object.create(SemanticValidator.prototype)', ctx);
const source = 'Sono a Roma ma non posso muovermi. Può venire una persona di fiducia?';
const response = 'Una persona di fiducia può passare in segreteria.';
const verdict = (state, requestEvidence = '', responseEvidence = '') => ({state, reason: 'Giudizio sui soggetti e sul vincolo.', requestEvidence, responseEvidence});
const options = {presenceSource: source, responseText: response};
assert.equal(semantic._normalizePresence_(verdict('compatible', 'Può venire una persona di fiducia?', response), options).state, 'compatible');
assert.equal(semantic._normalizePresence_(verdict('incompatible', 'non posso muovermi', response), options).state, 'incompatible');
assert.equal(semantic._normalizePresence_(verdict('incompatible'), options).state, 'uncertain');
assert.equal(semantic._normalizePresence_(verdict('compatible', 'citazione inventata', response), options).state, 'uncertain');
assert.equal(semantic._normalizePresence_(null, options).state, 'uncertain');
const prompt = semantic._buildHallucinationPrompt(response, 'KB', source, '', null, null, [], true);
assert(prompt.includes('mittente e delegato'));
assert(prompt.includes('presenza già dichiarata o programmata'));
for (const state of ['compatible', 'incompatible', 'uncertain', 'unavailable']) {
  const validator = vm.runInContext('new ResponseValidator()', ctx);
  validator._runValidationChecks = () => ({isValid:true,score:1,errors:[],warnings:[],details:{hallucinations:{score:1,errors:[]}}});
  let calls = 0;
  validator.semanticValidator = {
    shouldRun: () => false,
    validateHallucinations: (...args) => {
      calls++;
      assert.equal(args[4].presenceRequired, true);
      return state === 'unavailable' ? {isValid:true,skipped:true} :
        {isValid:true,presence:verdict(state,'non posso muovermi',response)};
    }
  };
  const result = validator.validateResponse(response, 'it', 'KB', source, 'Certificato', 'full', false);
  assert.equal(calls, 1);
  assert.equal(result.isValid, state === 'compatible', state);
  if (state === 'incompatible') assert.equal(result.reasonCode, 'semantic_presence_conflict');
  if (state === 'uncertain') assert.equal(result.pendingSemanticReview, 'semantic_presence_uncertain');
  if (state === 'unavailable') assert.equal(result.pendingSemanticReview, 'semantic_unavailable');
}
console.log('Contratto presenza semantica: verifiche superate.');
