const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
const ctx = vm.createContext({ console: quiet, createLogger: () => quiet });
for (const file of ['gas_config.js', 'gas_response_strategy.js', 'gas_prompt_engine.js',
  'gas_response_validator.js', 'gas_email_processor.js', 'gas_thread_context.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
}
const { p, engine, validator, config } = vm.runInContext(`({
  p:Object.create(EmailProcessor.prototype), engine:new PromptEngine(),
  validator:new ResponseValidator(), config:CONFIG
})`, ctx);
const kb = 'Orario estivo: dal 28 giugno al 30 agosto 2026.';
const resolve = (text, written = '2026-10-01', answered = written, language = 'it') =>
  p._resolveScheduleContext(text, kb, { messageDate: written, currentDate: answered,
    messageDateAvailable: true, messageDateSource: 'gmail_message_date' }, language);
for (const text of [
  'Mio figlio è stato battezzato il 5 maggio 2026. Vorrei ritirare il certificato il 10 ottobre.',
  'Certificato di battesimo del 5 maggio. Vorrei ritirarlo il 10 ottobre.',
  'Mio padre è morto il 5 maggio 2026. Vorrei una messa il 10 ottobre.',
  'Sono nato il 5 maggio 1980. Vorrei passare il 10 ottobre.'
]) {
  const result = resolve(text);
  assert.equal(result.targetDate, '2026-10-10', text);
  assert.equal(result.season, 'invernale', text);
  assert(!result.targets, 'le date personali non diventano richieste multiple');
}
const backlog = resolve('Quali saranno gli orari il 15 agosto?', '2026-07-20', '2026-10-20');
assert.equal(resolve('Mio figlio sarà battezzato il 15 agosto 2026.', '2026-07-20').targetDate, '2026-08-15');
assert.equal(resolve('Sono stato qui in passato. Quali saranno gli orari il 15 agosto?', '2026-10-20').targetDate, '2027-08-15');
assert.equal(backlog.targetDate, '2026-08-15');
assert.equal(backlog.targetDateIsPast, true);
assert.equal(backlog.season, 'estivo');
assert.equal(resolve('Vorrei passare domani.', '2026-08-30', '2026-10-20').targetDate, '2026-08-31');
const prompt = engine.buildPrompt({ emailContent: 'Quali saranno gli orari il 15 agosto?',
  knowledgeBase: kb, currentDate: '2026-10-20', messageDate: '2026-07-20',
  detectedLanguage: 'it', scheduleContext: backlog });
assert(prompt.includes('senza ricalcolarne l\'anno rispetto a oggi'));
assert(!prompt.includes('confronta sempre quella data con la DATA ODIERNA'));
assert(prompt.includes('DATA GIÀ TRASCORSA'));
for (const [language, text] of [
  ['it', 'Quali orari lunedì prossimo?'], ['en', 'Opening hours next Monday?'],
  ['fr', 'Horaires lundi prochain?'], ['es', 'Horarios el próximo lunes?'],
  ['de', 'Öffnungszeiten nächsten Montag?'], ['pt', 'Horários próxima segunda-feira?']
]) {
  config.TEMPORAL_PARSING.nextWeekdayPolicy = 'upcoming';
  const result = resolve(text, '2026-06-26', '2026-10-20', language);
  assert.equal(result.targetDate, '2026-06-29', language);
  assert.equal(result.season, 'estivo', language);
  assert.equal(result.targetDateIsPast, true, language);
}
for (const policy of ['upcoming', 'strict_next_week']) {
  config.TEMPORAL_PARSING.nextWeekdayPolicy = policy;
  const result = resolve('Vorrei venire domenica prossima.', '2026-06-22');
  const anchor = p._coerceBusinessDateOnly_('2026-06-22');
  assert.equal(result.targetDate, p._formatDateOnlyIso_(validator._resolveWeekdayDate_(anchor, 0, 'next_week')));
  assert.equal(result.targetDate, policy === 'upcoming' ? '2026-06-28' : '2026-07-05');
  const boundary = resolve('Orari venerdì prossimo?', '2026-06-22');
  assert.equal(boundary.targetDate, policy === 'upcoming' ? '2026-06-26' : '2026-07-03');
  assert.equal(boundary.season, policy === 'upcoming' ? 'invernale' : 'estivo');
}
config.TEMPORAL_PARSING.nextWeekdayPolicy = 'upcoming';
assert.equal(resolve('Quali sono gli orari ogni domenica?').isExplicitTarget, false);
const multiple = resolve('Orari per il 15 agosto 2026 e il 15 ottobre 2026?', '2026-07-20', '2026-10-20');
assert.equal(multiple.targets.length, 2);
assert.equal(multiple.targets[0].season, 'estivo');
assert.equal(multiple.targets[1].season, 'invernale');
assert(p._renderRuntimeContextForCorrection_({ temporal: { currentDate: '2026-10-20' },
  scheduleContext: backlog }).includes('2026-08-15: estivo'));
let resolutions = 0;
const temporal = { messageDate: '2026-07-20', currentDate: '2026-10-20', messageDateAvailable: true };
const runtimeResult = ctx.ThreadContext.runtime({
  _buildRuntimeContext_: () => ({ temporal }),
  _resolveScheduleContext: (...args) => { resolutions++; return p._resolveScheduleContext(...args); },
  _extractSacramentalDeadlineContext_: () => null,
  _buildResponseValidationContext_: () => ({})
}, {
  messageDetails: { subject: '', body: 'Orari il 15 agosto?' },
  enrichedKnowledgeBase: kb, detectedLanguage: 'it', classification: {}
});
assert.equal(resolutions, 1);
assert.strictEqual(runtimeResult.runtimeContext.scheduleContext, runtimeResult.scheduleContext);
assert.equal(runtimeResult.scheduleContext.targetDate, '2026-08-15');
console.log('Lotto 5: ruoli delle date, email arretrate, stagioni e policy weekday verificati.');
