const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const quiet = { log() {}, warn() {}, error() {}, info() {}, debug() {} };
const ctx = vm.createContext({ console: quiet, createLogger: () => quiet });
for (const file of ['gas_config.js', 'gas_response_strategy.js', 'gas_prompt_engine.js',
  'gas_response_validator.js', 'gas_email_processor.js', 'gas_thread_context.js', 'gas_thread_documents.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
}
const { engine, processor, validator, thread, source } = vm.runInContext(`({
  engine:new PromptEngine(), processor:Object.create(EmailProcessor.prototype),
  validator:new ResponseValidator(), thread:ThreadContext, source:getBaptismAnnotationProcedure_()
})`, ctx);
processor.config = {};
const requestType = { type: 'mixed', needsDoctrine: true, needsDiscernment: false,
  dimensions: { doctrinal: 1, technical: 1 } };
const documentType = { ...requestType };
ctx.ThreadDocuments.initialCategory({}, {
  preQuickAttachmentIntentContext: { intent: 'document_submission_with_question', allowBodyQuestions: true },
  requestType: documentType, quickCheck: {}, classification: { category: 'information' }
});
assert.equal(documentType.needsDoctrine, true);
assert.equal(documentType.type, 'mixed');
for (const category of ['information', 'document_submission', 'document_request']) {
  const routed = thread.routeKnowledge(processor, { effectiveSalutationMode: 'full',
    activeConcerns: {}, memoryContext: {}, categoryHintSource: category, requestType,
    routedAiCoreLite: 'LITE', routedAiCore: '', routedDoctrine: 'DOCTRINE',
    routedDoctrineStructured: [{ Categoria: 'Sacramenti', 'Sotto-tema': 'Eucaristia',
      'Principio dottrinale': 'EUCHARIST_SOURCE' }],
    buildRuleContext: value => value, result: {}, territoryRequested: false,
    quickCheckTerritoryCandidates: [], isCertRequest: false });
  assert.equal(routed.routedDoctrine, 'DOCTRINE');
  for (const prior of [null, { detected: true, strength: 'strong', mentioned_contact: 'don Mario' }]) {
    const prompt = engine.buildPrompt({ category, topic: 'Eucaristia',
      emailSubject: 'Domande', emailContent: 'Quando posso venire e che cosa significa Eucaristia?',
      detectedLanguage: 'it', currentDate: '2026-10-20', knowledgeBase: 'Segreteria aperta alle 10:00.',
      requestType, doctrineStructured: routed.routedDoctrineStructured, aiCoreLite: routed.routedAiCoreLite,
      priorOralCommunication: prior });
    assert(prompt.includes('EUCHARIST_SOURCE'));
    assert(prompt.includes('Segreteria aperta alle 10:00.'));
    assert(!prompt.includes('trasmetti e basta'));
  }
}
for (const prior of [null, { detected: true, strength: 'strong' }]) {
  const prompt = engine.buildPrompt({ category: 'information', topic: 'risurrezione',
    emailSubject: 'Domanda', emailContent: 'Che cosa significa la risurrezione dei morti?',
    detectedLanguage: 'it', currentDate: '2026-10-20', requestType,
    priorOralCommunication: prior, doctrineStructured: [
      { Categoria: 'Dottrina', 'Sotto-tema': 'risurrezione dei morti',
        'Principio dottrinale': 'RESURRECTION_SOURCE' }
    ] });
  assert(prompt.includes('RESURRECTION_SOURCE'));
}
for (const policy of ['conditional_only', 'avoid_invitation']) {
  const rule = engine._renderPhysicalPresenceConstraintGuideline({ has_constraint: true, visit_policy: policy });
  assert(/solo nei limiti/.test(rule));
  assert(rule.includes('IDONEITÀ PADRINO/MADRINA'));
}
for (const type of ['information_request', 'operational_request', 'mixed', 'status_update']) {
  const prompt = engine._renderSbattezzoTemplate('Mario', 'it', { type });
  assert(prompt.includes(source));
  assert(prompt.includes('domande residue'));
}
let checkedSource;
validator.semanticValidator = {
  shouldRun: () => true,
  validateHallucinations: (response, kb) => {
    checkedSource = kb;
    return { isValid: true, confidence: 1, details: {}, errors: [] };
  },
  validateThinkingLeak: () => ({ isValid: true, confidence: 1, errors: [] })
};
validator.validateResponse('Gentile Mario, abbiamo ricevuto la Sua richiesta. La verifica nei registri precede gli ulteriori passaggi. Cordiali saluti.',
  'it', 'Fonte ordinaria.', 'Chiedo lo sbattezzo.', 'Sbattezzo', 'full', true,
  { validationContext: { responseMode: 'sensitive_canonical', responseRegister: 'formal_institutional' } });
assert(checkedSource && checkedSource.includes(source));
console.log('Lotto 3: routing per bisogni, continuità, distanza e fonte procedurale condivisa verificati.');
