const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const { runScenario } = require('./helpers/thread_scenario');
const root = path.resolve(__dirname, '..');
const ctx = vm.createContext({ console, CONFIG: {} });
for (const file of ['gas_email_processor.js', 'gas_prompt_engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx);
}
const processor = Object.create(ctx.EmailProcessor.prototype);
const engine = Object.create(ctx.PromptEngine.prototype);
const base = { subject: 'Invio documento', body: 'Allego il documento richiesto.' };
for (const skipped of [[{ reason: 'near_deadline' }], [{ reason: 'message_too_large_for_attachment_download' }]]) {
  const model = processor._buildDocumentDeliveryModel_({ ...base, attachmentSkipped: skipped });
  assert.equal(model.status, 'unverified_attachment');
  assert.equal(model.hasExpectedDocumentMissing, false);
}
for (const skipped of [undefined, null, [], [{ reason: 'no_attachments' }]]) {
  assert.equal(processor._buildDocumentDeliveryModel_({ ...base, attachmentSkipped: skipped }).status, 'missing');
}
assert.equal(processor._buildDocumentDeliveryModel_({ ...base, physicalAttachmentsDetected: true,
  attachmentSkipped: [{ reason: 'too_large' }] }).status, 'received_attachment');
for (const missing of [false, true]) {
  const prompt = engine._renderAttachmentContext('Contesto', {
    intent: 'suspected_submission', hasPhysicalAttachments: false, hasExpectedDocumentMissing: missing
  });
  assert.equal(prompt.includes('ALLEGATO DICHIARATO MA NON RICEVUTO'), missing);
}
for (const oversized of [false, true]) {
  const output = runScenario(root, {
    subject: 'LOCANDINA DA STAMPARE IN A3 PER PORTE E ICEF', body: '', attachment: true,
    attachmentSettings: { maxMessageBytesForAttachmentDownload: 5 * 1024 * 1024 },
    ...(oversized ? { sizeEstimates: { m2: 10 * 1024 * 1024 } } : {}),
    attachmentSkipped: [{ reason: 'too_large' }]
  });
  const prompt = output.effects.find(([event]) => event === 'prompt');
  assert(prompt, JSON.stringify(output.result));
  assert(!/NON ha inviato|non risultano allegati/.test(prompt[1].attachmentsContext));
  assert(!prompt[1].attachmentIntentContext?.hasExpectedDocumentMissing);
  if (oversized) assert(!output.effects.some(([event]) => event === 'attachments.read'));
}
console.log('Attachment presence: unread, oversized, confirmed missing and subject-only poster regressions passed');
