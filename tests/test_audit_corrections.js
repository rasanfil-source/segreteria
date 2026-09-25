// Offline regressions for the verified audit; no Google/Gemini calls.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const root = path.resolve(__dirname, '..');
const logs = [];
const context = vm.createContext({
  console: { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), error() {} },
  CONFIG: { ATTACHMENT_CONTEXT: { enabled: true }, MAX_SAFE_TOKENS: 100000, MAX_SAFE_PROMPT_CHARS: 120000,
    KB_TOKEN_BUDGET_RATIO: 0.5, PROMPT_ENGINE: { OVERHEAD_TOKENS: 1000 } },
  createLogger: () => ({ info() {}, warn() {}, debug() {}, error() {} }),
  estimateTokenCount: text => Math.ceil(String(text || '').length / 4),
  Utilities: { formatDate: () => '2026-09-25' }
});
for (const file of ['gas_response_strategy.js', 'gas_prompt_engine.js', 'gas_email_processor.js',
  'gas_thread_attachments.js', 'gas_thread_documents.js', 'gas_thread_context.js', 'gas_response_validator.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: path.join(root, file) });
}
const processor = Object.create(context.EmailProcessor.prototype);
const details = { subject: 'Documento allegato', body: 'Invio in allegato il documento pesante.' };
const quickDelivery = { expected_document: true, delivery_channel: 'attachment',
  expected_document_description: 'documento pesante', source: 'quick_check' };
let downloads = 0;
const message = { getId: () => 'oversize', getAttachments: () => { downloads++; return [{}]; } };
const deps = {
  config: { maxExecutionTimeMs: 280000 }, _isNearDeadline: () => false,
  _getAttachmentDownloadLimitBytes_: () => 1024,
  _getMessageSizeEstimateForAttachmentDownload_: () => 50 * 1024 * 1024,
  _hasPastAttachmentReference_: body => processor._hasPastAttachmentReference_(body)
};
const attachments = context.ThreadAttachments.prepare(deps, {
  responseContextMessages: [message], candidate: message, threadLogger: context.console,
  messageDetails: details, messages: [message], ownAddresses: new Set(), result: {}
});
const model = processor._buildDocumentDeliveryModel_({ ...details, quickDocumentDelivery: quickDelivery, ...attachments });
assert.equal(downloads, 0, 'never download oversized messages');
assert.equal(model.status, 'unverified_attachment', 'skipped inspection is not missing');
assert.equal(model.hasPhysicalAttachment, false, 'message size does not prove an attachment exists');
assert.equal(model.blocksReceiptOnly, true);
assert.equal(model.hasExpectedDocumentMissing, false);
assert(attachments.attachmentSkipped.some(s => s.reason === 'message_too_large_for_attachment_download'));
assert(!logs.some(line => line.includes('nessun allegato nel messaggio')));
const missing = processor._buildDocumentDeliveryModel_({ ...details });
assert.equal(missing.status, 'missing', 'a checked message without attachments is still missing');
const bodyModel = processor._buildDocumentDeliveryModel_({ ...details, ...attachments,
  quickDocumentDelivery: { ...quickDelivery, body_contains_filled_document: true } });
assert.equal(bodyModel.status, 'received_body', 'usable body data remains available');
const promptOptions = {};
const systemDirectives = [];
const consistency = context.ThreadDocuments.consistency({ config: { documentConsistencyCheckEnabled: true },
  _evaluateDocumentConsistency_: () => { throw Error('incomplete inspection cannot establish a mismatch'); }
}, { documentDeliveryModel: model, messageDetails: details, attachmentItems: [], textFromAttachments: '',
  physicalAttachmentsDetected: false, quickDocumentDelivery: quickDelivery, systemDirectives, promptOptions,
  expectsDocument: true, hasExpectedDocumentMissing: false, forceReceiptOnlyForSubmission: true, runtimeContext: {} });
assert.equal(consistency.shouldUseReceiptOnly, false);
assert.equal(promptOptions.documentDelivery.hasExpectedDocumentMissing, false);
assert.equal(promptOptions.documentDelivery.hasDocumentDeliveryUnverified, true);
assert.equal(consistency.validationRuntimeContext.validationContext.documentMismatch.reason, 'attachment_inspection_skipped_for_size');
assert(!systemDirectives.join(' ').includes('Il file è ricevuto'));
assert(!systemDirectives.join(' ').includes('conferma la ricezione'));
assert(systemDirectives.join(' ').includes('dimensioni'));

const { runScenario } = require('./helpers/thread_scenario');
const lookback = { lookBack: true, body: 'Come da documento già inviato, quali passi devo seguire?' };
const first = runScenario(root, { ...lookback, repeat: true });
assert(first.effects.some(([event, value]) => event === 'attachments.process' && value[0] === 'past'));
assert.equal(first.props.filter(([key]) => key.startsWith('duplicate_reply_v1_')).length, 0);
assert.equal(first.effects.filter(([event]) => event === 'send').length, 1, 'message idempotency survives');
assert.equal(runScenario(root, { duplicate: true }).result.reason, 'duplicate_already_replied');
const legacy = runScenario(root, { ...lookback, legacyDuplicate: true });
assert.equal(legacy.props.filter(([key]) => key.startsWith('duplicate_reply_v1_')).length, 1, 'legacy marker was actually seeded and preserved');
assert.equal(legacy.result.status, 'replied', 'old text markers cannot suppress a referenced attachment');
assert(legacy.effects.some(([event, value]) => event === 'attachments.process' && value[0] === 'past'));
const validator = vm.runInContext('Object.create(ResponseValidator.prototype)', context);
const sizeContext = consistency.validationRuntimeContext;
for (const response of ["Abbiamo ricevuto l'allegato.", 'Non troviamo allegata né riportata nel testo la scheda.',
  'Il documento è corretto e completo.', 'We have received the attachment.']) {
  assert.equal(validator._checkDocumentMismatchTemplate(response, sizeContext).score, 0, response);
}
assert.equal(validator._checkDocumentMismatchTemplate('Abbiamo ricevuto il messaggio. Non è stato possibile verificare il documento; può inviare una copia più leggera?', sizeContext).score, 1);
for (const label of ['documento pesante', 'il certificato', "l’attestato", "l’attestazione", 'i certificati', 'le schede', 'moduli', 'scheda di iscrizione']) {
  const directive = context.ThreadDocuments.directives({}, { hasExpectedDocumentMissing: true,
    quickDocumentDelivery: { expected_document_description: label }, systemDirectives: [] }).injectedMissingDocumentDirective;
  assert(directive.includes(`la documentazione richiesta («${label}»)`), label);
  assert.equal(validator._checkExpectedDocumentMissingTemplate(directive, { validationContext: { expectedDocumentMissing: { active: true } } }).score, 1);
}
const engine = vm.runInContext('new PromptEngine()', context);
const input = { emailContent: 'Quali sono gli orari della segreteria?', emailSubject: 'Orari',
  knowledgeBase: 'Segreteria aperta il lunedì.', detectedLanguage: 'it', currentDate: '2026-09-25' };
const promptData = value => JSON.parse(JSON.stringify(value));
assert.deepStrictEqual(promptData(engine.buildPrompt({ ...input, promptProfile: 'light' })), promptData(engine.buildPrompt({ ...input, promptProfile: 'lite' })));
assert.deepStrictEqual(promptData(engine.buildPrompt(input)), promptData(engine.buildPrompt({ ...input, promptProfile: 'heavy' })));
assert(logs.some(line => line.includes('Profilo: lite | Saltati: 4')));
logs.length = 0;
context.ThreadContext.conversation({}, { messages: [], memoryContext: { lastUpdated: '2026-09-24T10:00:00Z' },
  ownConversationAnchor: {}, messageDetails: { date: new Date('2026-09-24T10:00:00Z') },
  processingTimestamp: new Date('2026-09-25T10:00:00Z') });
assert(logs.some(line => line.includes('lang=n/a')));
assert(!logs.some(line => line.includes('lang=undefined')));
for (const scenario of [
  { attachment: true, sizeEstimates: { m2: 50 * 1024 * 1024 } },
  { attachment: true, burst: true, sizeEstimates: { m1: 50 * 1024 * 1024 } },
  { attachment: true, burst: true, sizeEstimates: { m2: 50 * 1024 * 1024 }, attachmentSettings: { maxFiles: 1 } },
  { lookBack: true, body: 'Come da documento già inviato, allego il modulo precedente.', sizeEstimates: { past: 50 * 1024 * 1024 } }
]) {
  const output = runScenario(root, { body: details.body, quick: { document_delivery: quickDelivery }, ...scenario });
  assert.equal(output.result.status, 'replied');
  const prompt = output.effects.find(([event]) => event === 'prompt')[1];
  assert.equal(prompt.documentDelivery.status, 'unverified_attachment');
  assert.equal(prompt.documentDelivery.hasExpectedDocumentMissing, false);
  const runtime = output.effects.find(([event]) => event === 'validate')[1][7];
  assert.equal(runtime.validationContext.documentMismatch.reason, 'attachment_inspection_skipped_for_size');
  for (const id of Object.keys(scenario.sizeEstimates)) {
    assert(!output.effects.some(([event, value]) => event === 'attachments.read' && (value === id || value[0] === id)), `oversize read: ${id}`);
    assert(!output.effects.some(([event, value]) => event === 'attachments.process' && value[0] === id), `oversize process: ${id}`);
  }
}
// Taxonomy recognizes the type, not the person: point 3 must retain semantic checking.
let semanticCalls = 0;
const semanticDetails = { subject: 'Certificato di battesimo di Mario Rossi', body: 'Allego il certificato di battesimo di Mario Rossi.' };
const ocr = 'Certificato di battesimo di Lucia Bianchi.';
assert.equal(processor._evaluateDocumentConsistency_(semanticDetails.subject, semanticDetails.body, [], ocr).mode, 'match');
const semanticModel = { expectsDocument: true, hasAttachmentContent: true };
context.ThreadDocuments.assessConsistency({ config: { documentConsistencyCheckEnabled: true },
  _evaluateDocumentConsistency_: processor._evaluateDocumentConsistency_.bind(processor),
  _evaluateAttachmentSemanticConsistency_: () => { semanticCalls++; return { consistent: false, reason: 'Persona diversa' }; }
}, { documentDeliveryModel: semanticModel, messageDetails: semanticDetails, attachmentItems: [], textFromAttachments: ocr,
  physicalAttachmentsDetected: true, quickDocumentDelivery: { expected_document: true,
    expected_document_description: semanticDetails.subject, source: 'quick_check' } });
assert.equal(semanticCalls, 1);
assert.equal(semanticModel.status, 'incongruent', 'a mocked semantic mismatch still blocks receipt despite taxonomy match');
console.log('Audit corrections: points 1, 4, 2, 5 pass; semantic check and message idempotency preserved');
