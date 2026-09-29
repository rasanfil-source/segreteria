// Regression coverage for the 2026-09-29 audit; no external services.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const sent = [];
const context = vm.createContext({
  console: { log() {}, warn() {}, error() {}, info() {} },
  CONFIG: {},
  MailApp: { sendEmail: (...args) => sent.push(args) }
});
for (const name of ['gas_response_strategy.js', 'gas_email_processor.js', 'gas_classifier.js']) {
  const filename = path.join(root, name);
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
}
const processor = Object.create(context.EmailProcessor.prototype);
const failures = [];
function test(name, run) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); }
}

test('missing skip list never confirms an announced but absent document', () => {
  for (const attachmentSkipped of [undefined, null, []]) {
    const model = processor._buildDocumentDeliveryModel_({
      body: 'Allego il documento.', attachmentSkipped
    });
    assert.equal(model.status, 'missing');
    assert.equal(model.blocksReceiptOnly, true);
  }
  const model = processor._buildDocumentDeliveryModel_({
    body: 'Allego il documento.', physicalAttachmentsDetected: true,
    attachmentSkipped: [{ reason: 'message_too_large_for_attachment_download' }]
  });
  assert.equal(model.status, 'unverified_attachment');
  assert.equal(model.blocksReceiptOnly, true);
  assert.throws(() => processor._buildDocumentDeliveryModel_({ attachmentSkipped: {} }),
    { name: 'TypeError' });
});

test('collectAll normalizes body case and accents for personal constraints', () => {
  for (const [body, type] of [
    ['Sono in Ospedale', 'health'],
    ['SONO IN OSPEDALE', 'health'],
    ['HO MOBILITÀ RIDOTTA', 'mobility'],
    ['Sono agli Arresti Domiciliari', 'legal_restriction'],
    ['Vorrei partecipare ONLINE', 'remote_request']
  ]) {
    assert.ok(processor._detectPhysicalPresenceConstraint_('', body, true)
      .some(item => item.type === type), body);
  }
});

test('collectAll keeps body-only evidence, clause boundaries and negations', () => {
  for (const [subject, body] of [
    ['', 'Non sono in Ospedale'],
    ['', 'Mio fratello è in Ospedale'],
    ['Ospedale', 'Sono disponibile'],
    ['', 'Sono disponibile\nMio fratello è in Ospedale']
  ]) {
    assert.equal(processor._detectPhysicalPresenceConstraint_(subject, body, true)
      .some(item => item.type === 'health'), false, `${subject}: ${body}`);
  }
  for (const body of ['Sono in Ospedale', 'SONO IN OSPEDALE']) {
    assert.equal(processor._reconcilePhysicalPresenceConstraint_(null, '', body, {}).type, 'health');
  }
  for (const body of ['Se sono in ospedale', '"Sono in ospedale"', '> Sono in ospedale']) {
    assert.equal(processor._reconcilePhysicalPresenceConstraint_(null, '', body, {}).has_constraint, false);
  }
});

test('empty-body classification is invariant to reply prefix chains', () => {
  const classifier = new context.Classifier();
  for (const subject of ['Orari messe', 'Ab', 'Buongiorno', 'Grazie', 'x'.repeat(49), 'x'.repeat(50)]) {
    const expected = classifier.classifyEmail(`Re: ${subject}`, '', true);
    for (const prefix of ['Re: Fwd: ', 'Re: '.repeat(14), 'Re: Aw: Risp: ']) {
      const actual = classifier.classifyEmail(prefix + subject, '', true);
      assert.deepEqual(actual, expected, `${prefix}${subject}`);
    }
  }
});

// Exercise the real notifier with an in-memory transport. No email is sent.
test('review notification preserves paragraph spacing and optional fields', () => {
  processor.config = { validationReviewAlerts: { enabled: true }, validationErrorLabel: 'Verifica' };
  processor._getValidationReviewRecipient_ = () => 'review@example.test';
  processor._getValidationReviewTargetInfo_ = () => ({ subject: 'Richiesta', messageId: '', threadId: '' });
  processor._isValidationReviewAlertThrottled_ = () => false;
  processor._markValidationReviewAlertSent_ = () => {};
  processor._notifyValidationReview_({}, { reason: 'test', validation: { score: 0.5 } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0][2], 'Una risposta automatica richiede verifica umana.\n\n' +
    'Motivo: test\nPunteggio validazione: 0.50\nOggetto: Richiesta');
});

assert.equal(failures.length, 0, failures.join(', '));
