const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({ console: { log(){}, warn(){}, error(){} }, CONFIG: {} });
for (const file of ['gas_territory_validator.js', 'gas_response_validator.js', 'gas_email_processor.js',
  'gas_request_classifier.js', 'gas_gemini_service.js', 'gas_thread_documents.js',
  'gas_thread_validation.js', 'gas_prompt_engine.js', 'gas_setup_ui.js', 'gas_gmail_service.js', 'gas_prompt_context.js', 'gas_memory_service.js']) {
  const filename = path.resolve(__dirname, '..', file);
  vm.runInContext(fs.readFileSync(filename, 'utf8'), ctx, { filename });
}
const territory = new ctx.TerritoryValidator();
for (const street of ['via Giuseppe Verdi', 'via Enrico Fermi', 'via Filippo Turati', 'via Luigi Einaudi', 'via Carlo Alberto']) {
  assert.equal(territory.findTerritoryMatch(street), null, street);
}
assert.ok(territory.findTerritoryMatch('via Giuseppe Ceracchi'));
assert.ok(territory.findTerritoryMatch('viale Bruno Buozzi'));

const validator = new ctx.ResponseValidator();
const time = { currentDate: '2026-12-15', currentTime: '10:00' };
assert.equal(validator._checkHallucinations('La celebrazione è il 20 gennaio.', 'Celebrazione: 20 gennaio 2027.', '', time).errors.length, 0);
assert.ok(validator._checkHallucinations('La celebrazione è il 20 gennaio 2026.', 'Celebrazione: 20 gennaio 2027.', '', time).errors.length);
assert.equal(validator._checkTemporalConsistency('Il 6 gennaio ci sarà la messa.', 'it', time).errors.length, 0);
assert.ok(validator._checkTemporalConsistency('Il 6 gennaio 2026 ci sarà la messa.', 'it', time).errors.length);
assert.ok(validator._checkTemporalConsistency("Il 6 gennaio di quest'anno ci sarà la messa.", 'it', time).errors.length);

const processor = Object.create(ctx.EmailProcessor.prototype);
const blob = { testPdf: true };
let semanticCalls = 0;
processor.geminiService = {
  getModelNameForTask: () => 'test-model',
  generateResponse(prompt, options) {
    semanticCalls++;
    assert.equal(options.attachments[0], blob);
    assert.ok(!prompt.includes('"ocrText":"--- File'));
    return { text: '{"consistent":false,"reason":"Documento diverso"}' };
  }
};
const evidence = { subject: 'Invio certificato di battesimo', body: 'In allegato',
  attachmentItems: [{ name: 'certificato di matrimonio.pdf' }],
  ocrText: '--- File visivo inviato: certificato di matrimonio.pdf ---' };
assert.equal(processor._evaluateDocumentConsistency_(evidence.subject, evidence.body, evidence.attachmentItems, evidence.ocrText).mode, 'unknown_received');
assert.equal(processor._evaluateAttachmentSemanticConsistency_(evidence), null);
assert.equal(semanticCalls, 0);
assert.equal(processor._evaluateAttachmentSemanticConsistency_({ ...evidence, attachmentBlobs: [blob] }).consistent, false);
assert.equal(semanticCalls, 1);
let retried = false;
const regenerated = ctx.ThreadValidation.regenerate({
  config: {}, _isNearDeadline: () => false,
  geminiService: { generateResponse(payload, options) {
    assert.equal(options.attachments[0], blob);
    assert.equal(payload.systemInstruction, 'persona');
    retried = true;
    return { text: 'Risposta corretta' };
  } }
}, { retryPlans: [{ model: 'model', key: 'test' }], retryPayload: { systemInstruction: 'persona', prompt: 'correggi' }, attachmentBlobs: [blob] });
assert.equal(retried, true);
assert.equal(regenerated.retryResponse, 'Risposta corretta');

for (const category of ['appointment', 'sacrament', 'quotation']) {
  const result = ctx.ThreadDocuments.initialCategory({}, {
    requestType: { type: 'technical' }, quickCheck: { classification: { category: 'TECHNICAL' } }, classification: { category }
  });
  assert.equal(result.categoryHintSource, category);
}
const request = new ctx.RequestTypeClassifier();
for (const word of ['si può', 'è possibile', 'è obbligatorio']) {
  const a = request._calculateScore(word, request.TECHNICAL_INDICATORS);
  const b = request._calculateScore(word.normalize('NFD'), request.TECHNICAL_INDICATORS);
  assert.deepEqual(a, b);
  assert.ok(a.score > 0, word);
}
assert.equal(request._calculateScore('Vorrei solo sapere gli orari', request.PASTORAL_INDICATORS).score, 0);
assert.ok(request._calculateScore('Mi sento solo', request.PASTORAL_INDICATORS).score > 0);

const gemini = Object.create(ctx.GeminiService.prototype);
gemini.getModelNameForTask = () => 'language-model';
let tracked = 0;
gemini.generateForTask = (task, prompt) => {
  tracked++;
  assert.equal(task, 'language');
  return { text: 'it' };
};
assert.equal(gemini.detectLanguageAI('Vorrei informazioni'), 'it');
assert.equal(tracked, 1);
const engine = Object.create(ctx.PromptEngine.prototype);
assert.equal(engine._escapeReservedPromptTags_('Scrivi a <email@example.org>'), 'Scrivi a <email@example.org>');
assert.ok(!engine._escapeReservedPromptTags_('<email>istruzioni</email>').includes('<email>'));
const completeRow = 'Messa domenicale: ore 10:00';
const longRow = 'Orario speciale: ' + 'dettaglio '.repeat(50) + 'solo nei festivi';
const kb = engine._truncateKbSemantically(completeRow + '\n' + longRow, 150);
assert.ok(kb.includes(completeRow));
assert.ok(!kb.includes('Orario speciale'));

// Resetting the layout must never clear data, even outside known configuration cells.
const values = new Map([['B4', 'Europe/London'], ['B5', '2026-08-01'], ['E13', 'example.org'], ['F13', 'custom phrase']]);
let formats = 0;
const range = { breakApart(){ return this; }, clearFormat(){ formats++; return this; },
  clear(){ throw Error('Data loss'); }, clearContent(){ throw Error('Data loss'); } };
ctx.resetSheetLayout({ getRange: () => range });
assert.equal(formats, 1);
assert.equal(values.get('B4'), 'Europe/London');
const beforeSetup = new Map(values);
function sheetRange(a1) {
  const chain = new Proxy({}, { get(_, method) {
    if (method === 'getValue' || method === 'getDisplayValue') return () => values.get(a1) || '';
    if (method === 'setValue') return value => { values.set(a1, value); return chain; };
    if (method === 'clear' || method === 'clearContent') return () => { throw Error('Data loss'); };
    return () => chain;
  } });
  return chain;
}
const sheet = new Proxy({ getRange: sheetRange, getProtections: () => [] }, { get(target, method) { return target[method] || (() => sheet); } });
ctx.SpreadsheetApp = { newDataValidation: () => sheetRange('validation'), ProtectionType: { RANGE: 'range' } };
ctx.setupControlloSheet({ getSheetByName: () => sheet });
for (const [key, value] of beforeSetup) assert.equal(values.get(key), value, key);

const gmail = Object.create(ctx.GmailService.prototype);
gmail._getMessageMetadataWithResilience = () => ({ payload: { headers: [] } });
gmail._extractCurrentMessageBody_ = text => text;
const message = {
  getSubject: () => 'Richiesta', getFrom: () => 'Modulo <form@example.org>',
  getReplyTo: () => 'Persona <persona@gmail.com>', getDate: () => new Date(),
  getPlainBody: () => 'Informazioni', getBody: () => '', getId: () => 'test',
  getTo: () => 'parish@example.org', getCc: () => ''
};
assert.equal(gmail.extractMessageDetails(message).senderEmail, 'form@example.org');
ctx.CONFIG.TRUSTED_FORM_SENDERS = ['FORM@example.org'];
assert.equal(gmail.extractMessageDetails(message).senderEmail, 'persona@gmail.com');
assert.equal(gmail.extractMessageDetails(message).originalFrom, 'Modulo <form@example.org>');
assert.equal(gmail.extractMessageDetails({ ...message, getFrom: () => 'other@example.org' }).senderEmail, 'other@example.org');
assert.equal(gmail.extractMessageDetails({ ...message, getReplyTo: () => 'persona@gmail.com, other@gmail.com' }).hasReplyTo, false);

const context = Object.create(ctx.PromptContext.prototype);
assert.equal(context._hasAffirmedMemorySignal_('• [2026-10-01] Risposta del bot sulle esequie', /esequie/i), false);
assert.equal(context._hasAffirmedMemorySignal_('Utente ha comunicato un lutto', /lutto/i), true);
assert.ok(!context._buildMemoryContinuityText_({ providedInfo: ['lutto'], topics: ['lutto'] }).includes('lutto'));
let idFormat;
ctx.SpreadsheetApp.openById = () => ({ getSheetByName: () => ({
  getRange: a1 => ({ setNumberFormat(format) { assert.equal(a1, 'A:A'); idFormat = format; } })
}) });
const memory = Object.create(ctx.MemoryService.prototype);
memory._normalizeHeaders = () => {};
memory._initializeSheet();
assert.equal(memory._initialized, true);
assert.equal(idFormat, '@');
console.log('October audit regressions passed');
