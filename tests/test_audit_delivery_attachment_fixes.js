const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const quiet = { log(){}, warn(){}, error(){} };
const ctx = vm.createContext({ console: quiet });
vm.runInContext(fs.readFileSync(path.join(root, 'gas_classifier.js'), 'utf8'), ctx);
const realClassifier = new ctx.Classifier();
// Keep the established pipeline harness, but use the real local classifier and
// attachment metadata as returned by Gmail. Do not modify baseline fixtures.
const helperPath = path.join(root, 'tests/helpers/thread_scenario.js');
let source = fs.readFileSync(helperPath, 'utf8');
source = source.replace('const processor = new context.EmailProcessor(services);', `
  services.classifier.classifyEmail = (...args) => realClassifier.classifyEmail(...args);
  const extract = services.gmailService.extractMessageDetails;
  services.gmailService.extractMessageDetails = message => ({...extract(message),
    hasAttachments: !!message.attachment && !(scenario.onlyEarlierAttachment && message.getId() === 'm2')});
  const processor = new context.EmailProcessor(services);`);
const harness = { require, module: { exports: {} }, realClassifier };
vm.runInNewContext(source, harness, { filename: helperPath });
const run = scenario => harness.module.exports.runScenario(root, scenario);
const has = (out, name) => out.effects.some(([event]) => event === name);
for (const body of ['Grazie', 'Cordiali saluti', '']) {
  const out = run({ subject: body ? 'Re: Documenti catechismo' : 'Re:', body,
    attachment: true, quickReject: true,
    attachmentAnalysis: {consistent: true, confidence: 0.99, requestPurpose: 'operational_request',
      category: 'document_request', documents: [{index: 0, role: 'request', request: 'Richiedo un certificato.'}]} });
  assert.equal(out.result.status, 'replied', JSON.stringify(out.result));
  assert(has(out, 'attachments.process'));
  assert(has(out, 'attachment.analysis'));
  assert(has(out, 'send'));
}
const earlier = run({burst: true, attachment: true, onlyEarlierAttachment: true, quickReject: true});
assert.equal(earlier.result.status, 'replied');
assert(has(earlier, 'attachments.process'));
const closing = run({subject: 'Re: Documenti catechismo', body: 'Grazie'});
assert.equal(closing.result.status, 'filtered');
assert(!has(closing, 'send'));
for (const scenario of [{newsletter: true}, {autoReply: true}, {quickError: 'Network error'},
  {quick: {shouldRespond: false, reason: 'quick_check_failed'}}]) {
  const out = run({attachment: true, ...scenario});
  assert(!has(out, 'send'));
}

const { runScenario } = require('./helpers/thread_scenario');
for (const sendError of ['Forbidden 403: permission denied', 'Unauthorized 401', 'Not found 404', 'CONFIG_ERROR: sender']) {
  const out = runScenario(root, {sendError, burst: true});
  assert.equal(out.result.errorClass, 'SYSTEM_ERROR');
  assert(!has(out, 'label.error'));
  assert(!has(out, 'label.processed'));
  assert(!out.props.some(([key]) => key.startsWith('send_uncertain_')), 'definite rejection releases transaction');
}
const badRecipient = runScenario(root, {sendError: 'Bad request 400: invalid recipient'});
assert(has(badRecipient, 'label.error'));
const uncertain = runScenario(root, {sendError: 'Network error'});
assert.equal(uncertain.result.status, 'validation_failed');
assert(uncertain.props.some(([key]) => key.startsWith('send_uncertain_')));

vm.runInContext(fs.readFileSync(path.join(root, 'gas_error_types.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'gas_thread_delivery.js'), 'utf8'), ctx);
for (const code of ['GMAIL_DAILY_CALL_LIMIT_REACHED', 'GMAIL_COUNTER_LOCK_NOT_ACQUIRED_RETRYABLE']) {
  let rollbacks = 0;
  const error = Object.assign(new Error(code), {sendNotAttempted: true});
  const result = {};
  ctx.ThreadDelivery.send({config: {}, _beginSendTransaction: () => ({ok: true}),
    _rollbackSendTransaction: () => { rollbacks++; }, _classifyError: ctx.classifyError,
    gmailService: {sendHtmlReply: () => { throw error; }}}, {
    response: 'Test', result, startTime: Date.now(), messageDetails: {}, delivery: {},
    messageState: {candidate: {getId: () => 'm1'},
      markFailureForCurrentBurst: () => assert.fail('a pre-send rejection must stay retryable')}
  });
  assert.equal(rollbacks, 1);
  assert.equal(result.status, 'error');
  assert.notEqual(result.reason, 'gmail_send_uncertain');
}

const gmailCtx = vm.createContext({ console: quiet,
  Session: {getEffectiveUser: () => ({getEmail: () => 'bot@example.org'})},
  GmailApp: {getAliases: () => []} });
vm.runInContext(fs.readFileSync(path.join(root, 'gas_gmail_service.js'), 'utf8'), gmailCtx);
for (const code of ['GMAIL_DAILY_CALL_LIMIT_REACHED', 'GMAIL_COUNTER_LOCK_NOT_ACQUIRED_RETRYABLE']) {
  for (const blockedAttempt of [1, 2, 3]) {
    const service = Object.create(gmailCtx.GmailService.prototype);
    let guards = 0, sends = 0;
    const error = new Error(code);
    service._incrementGmailCallCounterOrThrow_ = () => { if (++guards === blockedAttempt) throw error; };
    const reply = () => { sends++; throw new Error('Invalid argument 400'); };
    const message = {getReplyTo: () => '', getFrom: () => 'user@example.org', reply,
      getThread: () => ({getMessages: () => [message], reply})};
    assert.throws(() => service.sendHtmlReply(message, 'Test', {senderEmail: 'user@example.org'}),
      actual => actual === error && actual.sendNotAttempted === true);
    assert.equal(guards, blockedAttempt);
    assert.equal(sends, blockedAttempt - 1, 'no further fallback after budget or lock rejection');
  }
}
console.log('Attachment filters, systemic delivery failures and native quota guards: passed');
