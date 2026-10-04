const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const logs = [], warnings = [];
const ctx = vm.createContext({console: {log: text => logs.push(text), warn: text => warnings.push(text), error(){}},
  CONFIG: {SPREADSHEET_ID: 'test'}});
for (const file of ['gas_gmail_service.js', 'gas_thread_documents.js', 'gas_prompt_engine.js', 'gas_main.js', 'gas_email_processor.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, {filename: file});
}

// An invalid cached ID must recover via the advanced API with no native app.
for (const nativeApp of [undefined, {}]) {
  ctx.GmailApp = nativeApp;
  const service = new ctx.GmailService();
  const modifies = [], operations = [];
  service._labelCache.set('IA', {labelId: 'Label_old', ts: Date.now()});
  service._incrementGmailCallCounterOrThrow_ = op => operations.push(op);
  ctx.Gmail = {Users: {Labels: {list: () => ({labels: [{name: 'IA', id: 'Label_new'}]})},
    Messages: {modify: data => {modifies.push(data.addLabelIds[0]);
      if (data.addLabelIds[0] === 'Label_old') throw new Error('Invalid label: Label_old');}}}};
  const before = warnings.length;
  service.addLabelToMessage('m1', 'IA');
  assert.deepEqual(modifies, ['Label_old', 'Label_new']);
  assert(operations.includes('labels.list'));
  assert(!warnings.slice(before).some(text => /Riallineamento|TypeError/.test(text)));
}
const injected = new ctx.GmailService();
const label = {getName: () => 'IA'};
injected._gmailApp = {getUserLabelByName: () => label};
injected._ensureLabelExistsForMessageRetry_('IA');
assert.equal(injected._labelCache.get('IA').label, label);
const quotaService = new ctx.GmailService();
quotaService._incrementGmailCallCounterOrThrow_ = () => {throw new Error('GMAIL_DAILY_CALL_LIMIT_REACHED');};
assert.throws(() => quotaService._ensureLabelExistsForMessageRetry_('IA'), /GMAIL_DAILY_CALL_LIMIT_REACHED/);

for (const reason of ['expected_document_with_unknown_attachment', 'attachment_inspection_skipped_for_size']) {
  for (const hasQuestions of [true, false]) {
    const result = ctx.ThreadDocuments.directives({}, {systemDirectives: [], hasDocumentDeliveryUnverified: true,
      quickDocumentDelivery: {expected_document_description: 'modulo di iscrizione al corso prematrimoniale'},
      effectiveDocumentMismatchReason: reason, attachmentIntentContext: {hasQuestions}});
    assert(result.injectedMismatchDirective.includes('modulo di iscrizione al corso prematrimoniale'));
    assert(result.injectedMismatchDirective.includes(reason));
    assert(!result.injectedMismatchDirective.includes('undefined'));
  }
}
const engine = Object.create(ctx.PromptEngine.prototype);
const long = 'La segreteria riceve su appuntamento. '.repeat(2500);
const result = engine._truncateKbSemantically(long, 38355);
assert(result.includes('La segreteria riceve su appuntamento.'));
assert(result.includes('TESTO PARZIALE'));
assert(result.length <= 38355);
const structured = 'ORARI | ' + 'dettaglio '.repeat(1000) + '| solo festivi';
const later = engine._truncateKbSemantically(structured + '\nContatti | telefono 123456', 200);
assert(!later.includes('ORARI'));
assert(later.includes('Contatti | telefono 123456'));
assert.equal(engine._truncateKbSemantically(long, 0), '');

// Partial configuration uses actual default names for both reads and diagnostics.
ctx._loadAdvancedConfig = () => ({});
const names = [];
ctx.SpreadsheetApp = {openById: () => ({getSheetByName: name => {
  names.push(name);
  return ['Istruzioni', 'AI_CORE_LITE', 'AI_CORE'].includes(name)
    ? {getDataRange: () => ({getValues: () => [['Categoria', 'Informazione'], ['Info', 'Testo reale']]})} : null;
}})};
ctx._loadResourcesInternal(1, true);
assert(names.includes('AI_CORE_LITE') && names.includes('AI_CORE'));
const reports = logs.filter(line => String(line).includes('KB_HEALTH_REPORT'));
assert(reports.some(line => line.includes('"sheet":"AI_CORE_LITE"')));
assert(reports.some(line => line.includes('"sheet":"AI_CORE"')));
assert(!reports.some(line => line.includes('"sheet":"unknown"')));

const processor = Object.create(ctx.EmailProcessor.prototype);
const before = warnings.length;
const a = processor._resolveSummerScheduleRange_('Nessun periodo specificato', 2026);
const originalStart = a.start.getTime();
a.start.setFullYear(1900);
const b = processor._resolveSummerScheduleRange_('Nessun periodo specificato', 2026);
assert.equal(b.start.getTime(), originalStart);
assert.equal(warnings.slice(before).filter(line => line.includes('Periodo estivo non trovato')).length, 1);
const prefix = 'Testo identico '.repeat(12);
const first = processor._resolveSummerScheduleRange_(prefix + '\nPeriodo estivo dal 1 luglio al 1 settembre', 2026);
const second = processor._resolveSummerScheduleRange_(prefix + '\nPeriodo estivo dal 2 luglio al 2 settembre', 2026);
assert.notEqual(first.start.getTime(), second.start.getTime(), 'equal length and prefix must not collide');
const nextYear = processor._resolveSummerScheduleRange_(prefix + '\nPeriodo estivo dal 2 luglio al 2 settembre', 2027);
assert.equal(nextYear.start.getFullYear(), 2027);
console.log('Pasted findings: labels, document description, KB budget, sheet diagnostics and summer cache passed');
