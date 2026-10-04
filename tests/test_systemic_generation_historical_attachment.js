const assert = require('node:assert/strict');
const path = require('node:path');
const {runScenario} = require('./helpers/thread_scenario');
const root = path.resolve(__dirname, '..');
const has = (out, name) => out.effects.some(([event]) => event === name);
const noTerminalLabels = out => {
  for (const name of ['label.error', 'label.processed', 'label.review']) {
    assert(!has(out, name), `${name}: ${JSON.stringify(out.result)}`);
  }
};

for (const error of ['Forbidden 403: permission denied', 'Unauthorized 401',
  '404 models/missing not found', 'CONFIG_ERROR: invalid model', 'SYSTEM_ERROR: configuration unavailable']) {
  for (const scenario of [{generationError: error}, {retry: true, retryError: error}]) {
    const out = runScenario(root, {...scenario, burst: true});
    assert.equal(out.result.status, 'error');
    assert.equal(out.result.errorClass, 'SYSTEM_ERROR');
    noTerminalLabels(out);
    assert(!has(out, 'send'));
    assert(out.restored, 'restore loggers after failure');
  }
}
// A working backup still responds; permanent errors in the request remain terminal.
const backup = runScenario(root, {firstGenerationError: 'Forbidden 403'});
assert.equal(backup.result.status, 'replied');
for (const scenario of [{generationError: 'Bad request 400'}, {retry: true, retryError: 'Bad request 400'}]) {
  const out = runScenario(root, scenario);
  assert(has(out, 'label.error'));
  assert(has(out, 'label.processed'));
  assert(!has(out, 'send'));
}
const body = 'Come da documento già inviato, quali passi devo seguire?';
for (const error of ['Attachment unavailable', 'Unexpected error reading attachment']) {
  const out = runScenario(root, {lookBack: true, body, historicalAttachmentError: error});
  assert.equal(out.result.status, 'dilata');
  assert.equal(out.result.reason, 'historical_attachment_read_failed');
  assert.equal(out.result.retryDelayMs, 60000);
  noTerminalLabels(out);
  for (const event of ['send', 'generate', 'memory.update', 'prompt']) assert(!has(out, event));
  assert(out.restored);
}
for (const [error, expectedClass] of [['Network error', 'NETWORK'],
  ['Service invoked too many times', 'QUOTA_EXCEEDED'], ['Forbidden 403', 'SYSTEM_ERROR']]) {
  const out = runScenario(root, {lookBack: true, body, historicalAttachmentError: error});
  assert.equal(out.result.status, 'error');
  assert.equal(out.result.errorClass, expectedClass);
  noTerminalLabels(out);
  assert(!has(out, 'send'));
}
const recovered = runScenario(root, {lookBack: true, body, historicalAttachmentError: 'Attachment unavailable',
  historicalAttachmentRecovers: true, repeat: true});
assert.equal(recovered.result.status, 'dilata');
assert.equal(recovered.repeatResult.status, 'replied');
assert.equal(recovered.effects.filter(([name]) => name === 'send').length, 1);
const secondRunIndex = recovered.effects.findIndex(([name]) => name === 'second.processing');
assert(!recovered.effects.slice(0, secondRunIndex).some(([name]) => name.startsWith('label.')));
assert(recovered.effects.some(([name, args]) => name === 'attachments.process' && args[0] === 'past'));
console.log('Systemic generation/correction and historical attachment recovery regressions passed');
