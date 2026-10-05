const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const helper = path.join(__dirname, 'helpers/thread_scenario.js');
const source = fs.readFileSync(helper, 'utf8');
function run(edits, scenario) {
  let code = source;
  for (const [from, to] of edits) {
    assert(code.includes(from), `Missing harness hook: ${from}`);
    code = code.replace(from, to);
  }
  const sandbox = { require, module: { exports: {} } };
  vm.runInNewContext(code, sandbox, { filename: helper });
  return sandbox.module.exports.runScenario(root, scenario);
}
function assertUnconsumed(out) {
  assert(!out.effects.some(([event]) => event === 'send' || event.startsWith('label.')));
  assert(!out.effects.some(([event]) => event === 'generate'));
}
const realReader = `vm.runInContext(fs.readFileSync(path.join(root, 'gas_gmail_service.js'), 'utf8'), context);
  const reader = new context.GmailService();
  services.gmailService.getProcessableAttachments = reader.getProcessableAttachments.bind(reader);
  const processor = new context.EmailProcessor(services);`;
const processorHook = 'const processor = new context.EmailProcessor(services);';
for (const [error, expected] of [['Network error', 'NETWORK'], ['Service invoked too many times', 'QUOTA_EXCEEDED'], ['Forbidden 403', 'SYSTEM_ERROR'], ['Attachment unavailable', null]]) {
  // Fail at pre-check, or only after the inventory succeeds (real Gmail reader).
  for (const late of [false, true]) {
    const out = run([
      [processorHook, realReader],
      ["if (scenario.attachmentReadError) throw new Error('Attachment unavailable');", `if (scenario.attachmentReadError && (!${late} || effects.filter(([name]) => name === 'attachments.read').length >= 3)) throw new Error('${error}');`]
    ], { attachment: true, attachmentReadError: true });
    assertUnconsumed(out);
    assert.equal(out.result.status, expected ? 'error' : 'dilata');
    if (expected) assert.equal(out.result.errorClass, expected);
    else assert.equal(out.result.reason, 'attachment_read_failed');
  }
  const crashed = run([["fail('extraction failure')", `fail('${error}')`]], { attachment: true, attachmentProcessError: true });
  assertUnconsumed(crashed);
  assert.equal(crashed.result.status, expected ? 'error' : 'dilata');
}
// Service errors returned in skipped entries are still classified.
for (const reason of ['read_error', 'text_extract_error', 'conversion_error']) {
  const out = run([], { attachment: true, attachmentSkipped: [{ reason, error: 'Network error' }] });
  assertUnconsumed(out);
  assert.equal(out.result.errorClass, 'NETWORK');
}
// Unsupported formats/size limits remain ordinary document restrictions.
for (const reason of ['unsupported_type', 'too_large']) {
  const out = run([], { attachment: true, attachmentSkipped: [{ reason }] });
  assert.equal(out.result.status, 'replied');
}
for (const [older, latest, shouldRead] of [[null, false, true], [false, null, true], [true, null, true], [null, true, true], [false, false, false]]) {
  const out = run([[
    'body: message.text, subject: message.getSubject(), date: message.getDate(),',
    `body: message.text, subject: message.getSubject(), date: message.getDate(), hasAttachments: message.getId() === 'm1' ? ${older} : ${latest},`
  ]], { burst: true, attachment: true, quickReject: true });
  assert.equal(out.effects.some(([event]) => event === 'attachments.read'), shouldRead);
  assert.equal(out.result.status, shouldRead ? 'replied' : 'filtered');
}
const truncated = run([[
  'if (scenario.retryError && generations > 1) fail(scenario.retryError);',
  "if (scenario.retryError && generations > 1) { const error = new Error('Risposta troncata da Gemini (MAX_TOKENS)'); error.code = 'TRUNCATED_OUTPUT'; error.isTransient = false; throw error; }"
]], { retry: true, retryError: true });
assert.equal(truncated.result.status, 'validation_failed');
assert.equal(truncated.result.reason, 'truncated_output');
assert(truncated.effects.some(([event, value]) => event === 'label.review' && value[1].reason === 'truncated_output'));
assert(!truncated.effects.some(([event]) => event === 'label.error' || event === 'send'));
console.log('Pipeline failure boundaries: attachment errors, tri-state bursts and truncated correction passed');
