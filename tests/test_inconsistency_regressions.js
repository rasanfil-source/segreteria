// Regressioni deterministiche, senza servizi Google o invio email.
const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const ctx = { console, CONFIG: {} };
vm.createContext(ctx);
for (const file of ['gas_response_strategy.js', 'gas_gemini_service.js', 'gas_email_processor.js',
  'gas_memory_service.js', 'gas_prompt_engine.js', 'gas_response_validator.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ctx, { filename: file });
}
const run = code => vm.runInContext(code, ctx);
run(`var processor = Object.create(EmailProcessor.prototype);
var memory = Object.create(MemoryService.prototype);
var engine = Object.create(PromptEngine.prototype);
var validator = new ResponseValidator();
var gemini = Object.create(GeminiService.prototype);
gemini._getSpecialDayGreeting = () => null;
var morning = new Date(2026, 8, 8, 10), evening = new Date(2026, 8, 8, 21);`);
assert.match(run("gemini.getAdaptiveGreeting('Mario', 'it', morning).greeting"), /Buongiorno/);
assert.match(run("gemini.getAdaptiveGreeting('Mario', 'it', evening).greeting"), /Buonasera/);
assert.strictEqual(run("memory._mergeConversationState({}, {currentRelationalPosture:'uncertain'}).currentRelationalPosture"), 'hesitant');
assert.strictEqual(run("memory._mergeMemorySummaryText_('base\\nconcurrent', 'base\\nnew', 'base')"), 'base\nconcurrent\nnew');
assert.strictEqual(run("memory._mergeMemorySummaryText_('base\\nnew', 'base\\nnew', 'base')"), 'base\nnew');
run(`LockService = {getScriptLock: () => ({waitLock(){}, releaseLock(){}})};
memory._initialized = true;
memory._getLockTuning_ = () => ({maxRetries:3, shardedAcquireTimeoutMs:1});
memory._getShardedLockKey = () => 'test-lock';
memory._tryAcquireShardedLock = () => true;
memory._releaseShardedLock = memory._sleepLockBackoff_ = memory._invalidateCache = () => {};
memory._withSheetWriteLock = fn => fn();
memory._writeThroughMemoryCache_ = () => {};
var saved, reads;
memory._updateRow = (index, data) => {saved = data;};
memory._findRowByThreadId = () => ({rowIndex:2, values:[
  'thread', 'it', 'info', 'standard', '[{"topic":"battesimo","count":2}]',
  '2026-09-01T10:00:00.000Z', 7, ++reads === 1 ? 2 : 3, 'base\\nconcurrent']});`);
for (const method of ['updateMemory', 'updateMemoryAtomic']) {
  ctx.method = method;
  run("reads = 0; saved = null; memory[method]('thread', {_expectedVersion:1, _baseMemorySummary:'base', memorySummary:'base\\nnew'});");
  assert.strictEqual(run('reads'), 3);
  assert.strictEqual(run('saved.memorySummary'), 'base\nconcurrent\nnew', method);
  assert.strictEqual(run('saved.messageCount'), 7);
}
run("processor.memoryService = memory; processor._inferUserReaction('Grazie, ho capito.', [{topic:'battesimo'}], 'thread');");
assert.strictEqual(run('saved.providedInfo[0].userReaction'), 'acknowledged');
assert.strictEqual(run('saved.messageCount'), 7);
assert.strictEqual(run('saved.providedInfo[0].count'), 2);
assert.strictEqual(run("processor._reconcilePhysicalPresenceConstraint_(null, 'Sono agli arresti domiciliari', 'Vorrei informazioni.', {}, new Date()).type"), 'legal_restriction');
for (const lang of ['it', 'en', 'es', 'fr', 'pt', 'de', 'pl']) {
  ctx.lang = lang;
  const soft = run("engine._renderResponseGuidelines(lang, 'invernale', 'SALUTO_STANDARD', 'CLOSING', 'soft')");
  assert.match(soft, /SALUTO LEGGERO FACOLTATIVO/);
  assert.doesNotMatch(soft, /SALUTO_STANDARD|no greeting|nessun saluto|MANDATORY GREETING/);
}
assert.doesNotMatch(run("engine._renderContextualChecklist('it', null, 'soft', {}, null, {shift:'closure', confidence:1})"), /espliciti o impliciti/);
assert.match(run("engine._renderContextualChecklist('it', null, 'soft')"), /espliciti o impliciti/);
run(`var temporal = {messageDate:'2026-09-01', currentDate:'2026-11-02', messageDateAvailable:true};
var deadline = processor._extractSacramentalDeadlineContext_('', 'Vorrei ricevere la cresima entro metà ottobre', 'it', temporal);`);
assert.strictEqual(run('deadline.temporal.status'), 'past');
assert.strictEqual(run('deadline.temporal.endDate'), '2026-10-31');
assert.match(run('engine._renderSacramentalDeadlinePolicy(deadline)'), /già trascorsa/);
assert.strictEqual(run("validator._checkSacramentalDeadline('Potrà ricevere la cresima entro ottobre.', {sacramentalDeadlineContext:deadline}).errors.length"), 1);
assert.strictEqual(run("validator._checkSacramentalDeadline('La scadenza è già trascorsa. Ci indichi una nuova data.', {sacramentalDeadlineContext:deadline}).errors.length"), 0);
for (const response of ['The deadline has already passed.', 'La date est déjà passée.',
  'El plazo ha vencido.', 'O prazo está ultrapassado.', 'Die Frist ist bereits abgelaufen.']) {
  ctx.response = response;
  assert.strictEqual(run('validator._checkSacramentalDeadline(response, {sacramentalDeadlineContext:deadline}).errors.length'), 0, response);
}
assert.strictEqual(run("validator._checkSacramentalDeadline('La scadenza non è ancora trascorsa.', {sacramentalDeadlineContext:deadline}).errors.length"), 1);
assert.strictEqual(run("validator._runValidationChecks('Potrà ricevere la cresima entro ottobre.', 'it', '', 'soft', '', '', {temporal, sacramentalDeadlineContext:deadline}).details.sacramentalDeadline.errors.length"), 1);
assert.strictEqual(run("processor._resolveSacramentalDeadlineDate_('ottobre', {messageDate:'2026-11-01', currentDate:'2026-11-02'}).status"), 'ambiguous_year');
assert.strictEqual(run("processor._resolveSacramentalDeadlineDate_('31 febbraio 2026', temporal).status"), 'unresolved');
assert.strictEqual(run("processor._resolveSacramentalDeadlineDate_('metà ottobre', {messageDate:'2026-09-01', currentDate:'2026-10-20'}).status"), 'within_interval');
assert.strictEqual(run("processor._resolveSacramentalDeadlineDate_('October 2025', temporal).status"), 'past');
run(`var schedule = processor._resolveScheduleContext('domani', '',
  {messageDate:'2026-08-31', currentDate:'2026-11-02', messageDateAvailable:true}, 'it');`);
assert.strictEqual(run('schedule.targetDate'), '2026-09-01');
assert.strictEqual(run('schedule.targetDateIsPast'), true);
// Contratto renderer/validator: qualsiasi modifica a un'etichetta interna deve
// mantenere il rilevamento; il test ricava le etichette dal prompt reale.
const frame = run(`engine._renderDecisionFrame({caseKind:'standard', activeSignals:['test'],
  consumedSignals:['test'], validatorExpectations:['test'], moduleRouting:{test:'include'}})`);
const labels = frame.split('\n').filter(line => /^- [^:]+:/.test(line)).map(line => line.slice(2).split(':')[0]);
assert(labels.length >= 5);
for (const label of labels) {
  ctx.leak = label + ': test';
  assert(run('validator.thinkingPatterns.some(pattern => leak.toLowerCase().includes(pattern.toLowerCase()))'), label);
}
console.log('PASS inconsistency regressions');
