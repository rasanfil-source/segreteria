const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const quiet = {log(){}, warn(){}, error(){}};
const ctx = vm.createContext({console: quiet});
for (const file of ['gas_email_processor.js', 'gas_error_types.js', 'gas_thread_validation.js', 'gas_gmail_service.js', 'gas_classifier.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, {filename: file});
}
const p = Object.create(ctx.EmailProcessor.prototype);
const kb = 'Periodo estivo dal 1 luglio 2025 al 31 agosto 2025\nPeriodo estivo dal 15 giugno 2026 al 15 settembre 2026';
const period = p._resolveSummerScheduleRange_(kb, 2026);
assert.equal(period.start.getMonth(), 5);
assert.equal(period.start.getDate(), 15);
assert.equal(period.end.getMonth(), 8);
assert.equal(p._extractSummerScheduleRange_('Periodo estivo dal 1 luglio 2025 al 31 agosto 2025', 2026), null);
for (const text of ['dal 15 dicembre 2025 al 6 gennaio 2026', 'dal 15 dicembre al 6 gennaio 2026', 'dal 15 dicembre 2025 al 6 gennaio']) {
  const range = p._parseItalianDateRange_(text, 2030);
  assert.equal(range.start.getFullYear(), 2025, text);
  assert.equal(range.end.getFullYear(), 2026, text);
}
assert.equal(p._parseItalianDateRange_('dal 15 dicembre al 6 gennaio', 2026).end.getFullYear(), 2027);
assert.equal(p._parseItalianDateRange_('dal 1 luglio 2026 al 31 agosto 2025', 2026), null);

for (const failure of ['404 models/retired not found', 'Forbidden 403', 'Unauthorized 401', 'Network error']) {
  const calls = [];
  const out = ctx.ThreadValidation.regenerate({config: {}, _isNearDeadline: () => false,
    _classifyError: error => p._classifyError(error),
    geminiService: {generateResponse: (_, options) => {calls.push(options.modelName);
      if (calls.length === 1) throw new Error(failure); return 'Risposta corretta';}}
  }, {retryPlans: [{model:'primary',key:'a'}, {model:'backup',key:'b'}], retryPayload:'Correggi'});
  assert.deepEqual(calls, ['primary', 'backup']);
  assert.equal(out.retryResponse, 'Risposta corretta');
}
let invalidCalls = 0;
ctx.ThreadValidation.regenerate({config: {}, _isNearDeadline: () => false,
  _classifyError: error => p._classifyError(error),
  geminiService: {generateResponse: () => { invalidCalls++; throw new Error('Invalid argument 400'); }}
}, {retryPlans: [{model:'primary'}, {model:'backup'}]});
assert.equal(invalidCalls, 1);

const {runScenario} = require('./helpers/thread_scenario');
const helperPath = path.join(__dirname, 'helpers/thread_scenario.js');
const source = fs.readFileSync(helperPath, 'utf8');
for (const phase of ['outer', 'inner']) {
  const harness = {require, module: {exports: {}}};
  const deadlineHook = `let checksAfterValidation = 0;
    if (scenario.nearDeadline) processor._isNearDeadline = () => validations > 0 && ++checksAfterValidation >= ${phase === 'outer' ? 1 : 2};`;
  vm.runInNewContext(source.replace('if (scenario.nearDeadline) processor._isNearDeadline = () => true;', deadlineHook), harness, {filename: helperPath});
  const out = harness.module.exports.runScenario(root, {retry:true, nearDeadline:true});
  assert.equal(out.result.status, 'dilata', phase);
  assert.equal(out.result.reason, 'near_deadline_before_correction');
  assert(!out.effects.some(([event]) => event.startsWith('label.') || event === 'send'));
  assert.equal(out.effects.filter(([event]) => event === 'generate').length, 1);
}
assert.equal(runScenario(root, {retry:true}).result.status, 'replied');
assert.equal(runScenario(root, {invalid:true}).result.status, 'validation_failed');

ctx.Session = {getEffectiveUser: () => ({getEmail: () => 'primary@example.org'})};
ctx.GmailApp = {getAliases: () => ['segreteria@example.org']};
for (const successAt of [2, 3]) {
  const service = new ctx.GmailService();
  service._incrementGmailCallCounterOrThrow_ = () => {};
  const attempts = [];
  const reply = (body, options) => {attempts.push(options); if (attempts.length < successAt) throw new Error('Invalid argument 400');};
  const message = {getFrom: () => 'user@example.org', getReplyTo: () => '', reply,
    getThread: () => ({getMessages: () => [message], reply})};
  service.sendHtmlReply(message, 'Risposta', {senderEmail:'user@example.org', recipientEmail:'segreteria@example.org'});
  assert(attempts.every(options => options.from === 'segreteria@example.org'));
  assert(!attempts.at(-1).htmlBody);
}

// Integration: real extraction + classifier; metadata never supplies MIME parts.
const classifier = new ctx.Classifier();
const metadataService = new ctx.GmailService();
const reads = [];
let inventoryKind = 'pdf';
metadataService._getMessageMetadataWithResilience = (id, params) => {
  reads.push(params);
  if (params.format === 'metadata') return {id, sizeEstimate:2000, payload:{headers:[{name:'Message-ID', value:'<msg@example.org>'}]}};
  assert.equal(params.format, 'full');
  assert(!/body|data/.test(params.fields), 'inventory must never request binary data');
  return {payload: inventoryKind === 'unknown' ? {mimeType:'multipart/mixed'} :
    {mimeType:'multipart/mixed', parts:[{mimeType:'text/plain'},
      ...(inventoryKind === 'pdf' ? [{mimeType:'application/pdf', filename:'request.pdf'}] : [])]}};
};
const harness = {require, module:{exports:{}}, classifier, metadataService};
vm.runInNewContext(source.replace('const processor = new context.EmailProcessor(services);', `
  services.classifier.classifyEmail = (...args) => classifier.classifyEmail(...args);
  services.gmailService.extractMessageDetails = message => metadataService.extractMessageDetails({
    ...message, getBody: () => message.text, getReplyTo: () => '', getTo: () => 'bot@example.org', getCc: () => ''
  });
  const processor = new context.EmailProcessor(services);`), harness, {filename:helperPath});
for (const kind of ['pdf', 'unknown', 'none']) {
  inventoryKind = kind;
  const out = harness.module.exports.runScenario(root, {subject:'Re: Documenti catechismo',body:'Grazie',attachment:kind !== 'none',quickReject:true});
  if (kind === 'none') assert.equal(out.result.status, 'filtered');
  else {
    assert.equal(out.result.status, 'replied', JSON.stringify(out.result));
    assert(out.effects.some(([event]) => event === 'attachments.process'));
  }
}
assert(reads.some(params => params.format === 'full'));
console.log('Five audit regressions passed: metadata attachments, retry deadlines, explicit years, backup models and sender aliases');
