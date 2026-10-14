const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({ console: { log() {}, warn() {}, error() {} }, CONFIG: {} });
for (const file of ['gas_classifier.js', 'gas_email_processor.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ctx, { filename: file });
}
const classifier = vm.runInContext('new Classifier()', ctx);
const processor = vm.runInContext('Object.create(EmailProcessor.prototype)', ctx);

// Giorni completi, anche accentati, conservano il contenuto operativo.
for (const day of ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica', 'lunedi']) {
  for (const suffix of ['', '.', ' in segreteria']) {
    assert.equal(classifier._isOfficeVisitLogisticsRequest(`Passo ${day}${suffix}`), true);
  }
  assert.equal(classifier._isUltraSimpleAcknowledgment(`Grazie, a ${day}`), false);
}
assert.equal(classifier._isOfficeVisitLogisticsRequest('Passo lunedìprossimo'), false);
for (const text of ['senza passare in segreteria', 'impossibilitato a venire in segreteria',
  'impossibile passare', 'impossibile passare in segreteria', 'evitare di venire in segreteria',
  'non posso passare o venire in segreteria', 'non posso passare né venire o presentarci in segreteria']) {
  assert.equal(classifier._isOfficeVisitLogisticsRequest(text), false, text);
}
assert.equal(classifier._isOfficeVisitLogisticsRequest('Non posso passare oggi, ma posso venire domani'), true);
for (const text of ['Ok per sabato', 'Grazie, a lunedì', 'Perfetto, a dopodomani', 'Ok nel pomeriggio', 'Ok in mattina']) {
  assert.equal(classifier._isUltraSimpleAcknowledgment(text), false, text);
  assert.notEqual(classifier.classifyEmail('Re: Informazioni', text, true).reason, 'ultra_simple_acknowledgment');
}
assert.equal(classifier._isUltraSimpleAcknowledgment('Ok grazie'), true);

// L'ordine delle date segue il testo e scarta candidati non validi o anagrafici.
const mixed = 'Vorrei sapere gli orari per il 15/07/2026 e per il 20 settembre 2026';
assert.equal(processor._extractExplicitDateFromText_(mixed, 2026).source, 'explicit:numeric');
assert.equal(processor._extractExplicitDateFromText_('20 settembre 2026 e 15/07/2026', 2026).source, 'explicit:textual');
for (const text of ['1° luglio', '1º agosto']) assert(processor._extractExplicitDateFromText_(text, 2026));
assert.equal(processor._extractExplicitDateFromText_('31/02/2026 e 1° luglio', 2026).source, 'explicit:textual');
assert.equal(processor._extractExplicitDateFromText_('Nato il 1° luglio 2000, visita il 15/07/2026', 2026).source, 'explicit:numeric');
const context = processor._resolveScheduleContext(mixed, 'Periodo estivo dal 1 luglio al 1 settembre', vm.runInContext('new Date(2026, 0, 1)', ctx));
assert.equal(context.targetDate, '2026-07-15');
assert.equal(context.season, 'estivo');
assert.equal(context.targets.map(t => t.targetDate).join(','), '2026-07-15,2026-09-20');

const prompt = { systemInstruction: 'Istruzioni da preservare', prompt: 'Contenuto utente' };
assert.equal(processor._trimPromptForRetry_(prompt, 1000), processor._normalizePromptForRetry_(prompt));
assert.equal(processor._trimPromptForRetry_('Testo', 1000), 'Testo');
assert.equal(processor._trimPromptForRetry_(null, 1000), '');

// Un trigger difettoso non interrompe la pulizia degli altri.
const deleted = [];
ctx.ScriptApp = { deleteTrigger: trigger => deleted.push(trigger) };
const keep = { getUniqueId: () => 'keep' };
const duplicate = { getUniqueId: () => 'keep' };
const missing = {};
const broken = { getUniqueId() { throw new Error('non disponibile'); } };
const other = { getUniqueId: () => 'other' };
assert.equal(processor._deleteResumeBatchTriggers_([keep, duplicate, missing, broken, other], keep), 2);
assert.deepEqual(deleted, [missing, other]);
assert.equal(processor._deleteResumeBatchTriggers_([missing], missing), 0);

for (const initial of ['A', 'À', 'É', 'Ö']) {
  const summary = processor._buildMemorySummary({ responseText: `Contattare ${initial}. Rossi per ricevere tutte le informazioni. Portare il documento di identità.` });
  assert(summary.includes(`Contattare ${initial}. Rossi`));
  assert(summary.includes('Portare il documento'));
}
console.log('Verifiche visite, date, retry, trigger e iniziali superate.');
