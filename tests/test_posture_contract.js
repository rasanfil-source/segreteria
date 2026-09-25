const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const sandbox = { console, CONFIG: {} };
vm.createContext(sandbox);
require('./helpers/load_thread_components')(sandbox);
for (const file of ['gas_response_strategy.js', 'gas_prompt_context.js', 'gas_prompt_engine.js', 'gas_email_processor.js', 'gas_memory_service.js', 'gas_gemini_service.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), sandbox, { filename: file });
}
const api = vm.runInContext(`({ processor: Object.create(EmailProcessor.prototype),
  engine: Object.create(PromptEngine.prototype), memory: Object.create(MemoryService.prototype),
  strategy: mapRelationalPostureToResponseStrategy_, normalize: normalizeRelationalPosture_,
  quickPolicy: EmailQuickCheckPolicy, memoryMeaningful: hasMeaningfulMemoryContext_, context: createPromptContext })`, sandbox);
const cases = {
  direct: 'direct', informational: 'direct', personal: 'personal', relational: 'personal',
  complaint: 'complaint', procedural: 'complaint', hesitant: 'hesitant', uncertain: 'hesitant',
  open: 'open', appreciative: 'appreciative', grateful: 'appreciative',
  gratitude: 'appreciative', enthusiastic: 'appreciative', urgent: 'urgent'
};
for (const [input, expected] of Object.entries(cases)) {
  const routed = api.processor._normalizeRelationalPostureAlias_(' ' + input.toUpperCase() + ' ');
  assert.equal(routed, expected, input + ': processor canonical');
  assert.equal(api.engine._normalizeRelationalPostureAlias(routed), expected, input + ': processor to renderer');
  assert.equal(api.memory._normalizeConversationPosture_(routed), expected, input + ': processor to memory');
  assert.equal(api.strategy(routed), api.strategy(input), input + ': strategy preserved');
}
assert.equal(api.quickPolicy.normalizeRelationalPosture('open', 0.95), 'open');
assert.equal(api.quickPolicy.normalizeRelationalPosture('hesitant', 0.95), 'hesitant');
assert.equal(api.memoryMeaningful({ exists: false, providedInfo: [] }), false);
assert.equal(api.memoryMeaningful({ exists: true, providedInfo: [] }), true);
const openPrompt = api.engine.renderRelationalPosture(api.processor._normalizeRelationalPostureAlias_('open'));
assert(openPrompt.includes('collaborativo e disponibile'));
assert(!openPrompt.includes('gratitudine dettagliata'));
assert(api.engine.renderRelationalPosture('appreciative').includes('gratitudine dettagliata'));
assert.equal(api.memory._normalizeConversationPosture_('unrecognised'), null);
assert.equal(api.engine._normalizeRelationalPostureAlias('unrecognised'), 'direct');
assert.equal(api.processor._normalizeRelationalPostureAlias_('unrecognised'), 'direct');
for (const [mentionsDates, containsDates, expected] of [[false, false, false], [true, false, true], [false, true, true], [true, true, true]]) {
  const ctx = api.context({ email: { subject: 'Informazioni', body: 'Come posso iscrivermi?', detectedLanguage: 'it' },
    requestType: { type: 'technical' }, classification: { category: 'information', confidence: 1 },
    temporal: { mentionsDates }, knowledgeBaseMeta: { containsDates } });
  assert.equal(ctx.concerns.temporal_risk, expected, 'temporal coverage includes KB-only dates');
}
console.log('Posture contract and temporal coverage tests passed.');
