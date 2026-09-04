// Diagnostica di bug ancora aperti: gli assert documentano il comportamento attuale.
// Nessuna chiamata a Google, Gemini o Gmail.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const ctx = { console, CONFIG: {} };
vm.createContext(ctx);
for (const file of ['gas_response_strategy.js', 'gas_email_processor.js', 'gas_memory_service.js', 'gas_prompt_context.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, {filename: file});
}
const source = fs.readFileSync(path.join(root, 'gas_email_processor.js'), 'utf8');
function extract(start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert(first >= 0 && last > first, 'Blocco del codice non trovato');
  return source.slice(first, last);
}
vm.runInContext(`
  const processor = Object.create(EmailProcessor.prototype);
  const memory = Object.create(MemoryService.prototype);
  // QuickCheck riconosce correttamente l'assenza di un vincolo attuale.
  const quickCheck = {physical_presence_constraint: {
    has_constraint: false, type: 'none', confidence: 0.95, visit_policy: 'visit_ok'
  }, response_strategy: 'none', relational_posture: 'urgent'};
  const messageDetails = {subject: 'Appuntamento', body: 'Ora sono a Roma. Posso venire domani?'};
  const memoryContextualFlags = {remote_user: true};
  globalThis.currentPresence = processor._resolvePhysicalPresenceConstraint_(
    quickCheck.physical_presence_constraint, messageDetails.subject, messageDetails.body);
`, ctx);
// Esegue il blocco produttivo che fonde il vincolo corrente con la memoria.
vm.runInContext(`(function () {
  ${extract('      let physicalPresenceConstraint = this._resolvePhysicalPresenceConstraint_(', '      // ====================================================================\n      // STEP 4:').replace(/\r/g, '')}
  globalThis.resolvedPresence = physicalPresenceConstraint;
}).call(processor);`, ctx);
assert.strictEqual(ctx.currentPresence.has_constraint, false);
assert.strictEqual(ctx.resolvedPresence.has_constraint, true);
assert.strictEqual(ctx.resolvedPresence.source, 'memory_contextual_flags');
vm.runInContext(`
  globalThis.flagsAfterOverride = processor._deriveContextualFlagsUpdate_({
    existingFlags: {remote_user: true},
    physicalPresenceConstraint: {has_constraint: false, source: 'current_local_presence_override'}
  });
  const promptContext = new PromptContext({
    email: {body: messageDetails.body, subject: messageDetails.subject, detectedLanguage: 'it'},
    memory: {contextualFlags: {remote_user: true}},
    physicalPresenceConstraint: {has_constraint: false, source: 'current_local_presence_override'},
    classification: {category: 'information'}, requestType: {type: 'technical'}
  });
  globalThis.remoteConcern = promptContext.concerns.physical_presence_constraint;
  globalThis.remoteInstructions = promptContext._computeOperationalConstraints('standard_operational');
`, ctx);
assert.strictEqual(ctx.flagsAfterOverride.remote_user, true);
assert.strictEqual(ctx.remoteConcern, true);
assert(Array.from(ctx.remoteInstructions).some(text => text.includes('Non proporre presenza fisica')));
console.log('BUG 1: presenza a Roma sovrascritta da memoria remote_user; anche override esplicito non cancella il flag.');

vm.runInContext(`(function () {
  const quickCheck = {response_strategy: 'none', relational_posture: 'urgent'};
  const physicalPresenceConstraint = processor._resolvePhysicalPresenceConstraint_(null, 'Informazioni', 'Quali sono gli orari?');
  const memoryContext = {};
  const categoryHintSource = 'information';
  const requestTypeName = 'technical';
  const requestType = {type: 'technical'};
  const threadId = 'audit';
  ${extract('      const allowedResponseStrategies = new Set([', '      const rawGoalContinuity =').replace(/\r/g, '')}
  globalThis.routingResult = {physicalPresenceConstraint, hasStrongerResponseRoutingSignal, responseStrategy,
    expectedFallback: mapRelationalPostureToResponseStrategy_(normalizedRelationalPosture)};
}).call(processor);`, ctx);
assert.strictEqual(ctx.routingResult.physicalPresenceConstraint.has_constraint, false);
assert.strictEqual(ctx.routingResult.hasStrongerResponseRoutingSignal, true);
assert.strictEqual(ctx.routingResult.responseStrategy, 'none');
assert.strictEqual(ctx.routingResult.expectedFallback, 'reduce_user_effort');
console.log('BUG 2: oggetto vincolo negativo blocca il fallback di strategia; urgent produce none invece di reduce_user_effort.');

vm.runInContext(`
  const previousTopics = Array.from({length: 50}, (_, i) => ({
    topic: 'topic_' + i, timestamp: '2026-08-01T12:00:00Z', userReaction: 'unknown'
  }));
  const freshTopics = [
    {topic: 'topic_0', timestamp: '2026-09-05T12:00:00Z', userReaction: 'unknown'},
    {topic: 'topic_50', timestamp: '2026-09-05T12:00:00Z', userReaction: 'unknown'}
  ];
  const mergedTopics = memory._mergeProvidedTopics(previousTopics, freshTopics);
  globalThis.topicOrder = mergedTopics.map(t => t.topic);
  globalThis.savedTopics = mergedTopics.slice(-50).map(t => t.topic);
`, ctx);
assert.strictEqual(ctx.topicOrder[0], 'topic_0');
assert.strictEqual(ctx.savedTopics.includes('topic_0'), false);
assert.strictEqual(ctx.savedTopics.includes('topic_1'), true);
console.log('BUG 3: il topic appena aggiornato resta in testa e viene eliminato dal limite 50, mentre sopravvivono topic più vecchi.');
