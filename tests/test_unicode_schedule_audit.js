const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ctx = {console: {log(){}, warn(){}, error(){}}, CONFIG: {}};
vm.createContext(ctx);
for (const file of ['gas_classifier.js', 'gas_email_processor.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ctx);
}
const c = new ctx.Classifier(), p = Object.create(ctx.EmailProcessor.prototype);
for (const [method, text, lang] of [
  ['_hasSponsorEligibilityTopic_', 'idoneità', 'it'],
  ['_hasConfirmationTopic_', 'confirmé', 'fr'],
  ['_hasMissingConfirmationSignal_', 'pas confirmé', 'fr'],
  ['_hasSacramentalContext_', 'église', 'fr'],
  ['_hasSponsorRoleIntent_', 'être parrain', 'fr'],
  ['_hasSponsorRoleIntent_', 'demandé parrain', 'fr']
]) {
  assert.equal(p[method](text, lang), true, text);
  assert.equal(p[method](text.normalize('NFD'), lang), true, text + ' NFD');
}
assert.equal(p._hasSponsorEligibilityTopic_('xidoneità', 'it'), false);
assert.equal(p._hasSponsorEligibilityTopic_('idoneitàx', 'it'), false);
assert.equal(p._hasConfirmationTopic_('confirmément', 'fr'), false);
assert.equal(p._hasSacramentalContext_('xéglise', 'fr'), false);
assert.equal(p._hasSponsorRoleIntent_('être parrainage', 'fr'), false);
for (const text of ['10 maggiorenni', '2 marzolini', '5 agostiniani', '10 maggioα']) {
  assert.equal(p._extractExplicitDateFromText_(text, 2026), null, text);
}
assert.equal(p._extractExplicitDateFromText_('10 maggio 2027', 2026).date.getFullYear(), 2027);
const base = new Date(2026, 11, 31, 12);
for (const [lang, words] of Object.entries({
  it: ['oggi', 'domani', 'dopodomani'], en: ['today', 'tomorrow', 'day after tomorrow'],
  es: ['hoy', 'mañana', 'pasado mañana'], fr: ["aujourd’hui", 'demain', 'après-demain'],
  pt: ['hoje', 'amanhã', 'depois de amanhã'], de: ['heute', 'morgen', 'übermorgen']
})) {
  words.forEach((word, offset) => {
    for (const text of [word, word.normalize('NFD')]) {
      const result = p._resolveRequestedScheduleDate_(text, base, lang);
      assert.equal(result.isExplicit, true, word);
      assert.equal(result.date.getDate(), offset === 0 ? 31 : offset, word);
      assert.equal(result.date.getFullYear(), offset === 0 ? 2026 : 2027, word);
    }
  });
}
for (const [text, lang] of [['Guten Morgen', 'de'], ['am Morgen', 'de'], ['por la mañana', 'es'], ['de la mañana', 'es'], ['tomorrow', 'it']]) {
  assert.equal(p._resolveRequestedScheduleDate_(text, base, lang).isExplicit, false, text);
}
assert.equal(p._resolveRequestedScheduleDate_('Guten Morgen! Morgen um 18 Uhr.', base, 'de').date.getDate(), 1);
assert.equal(p._resolveRequestedScheduleDate_('mañana por la mañana', base, 'es').date.getDate(), 1);
assert.equal(p._resolveRequestedScheduleDate_('heute Morgen', base, 'de').source, 'relative:oggi');
for (const header of ['Objet', 'Asunto', 'Assunto', 'Envoyé', 'Gesendet', 'Betreff', 'Para', 'Von']) {
  assert.equal(c._extractMainContent('Da: Mario <mario@example.org>\n' + header + ': test\n> Vecchio testo\nVorrei informazioni'), 'Vorrei informazioni');
}
assert.equal(c._extractMainContent('Grazie\n-----Messaggio originale-----\n- vorrei informazioni'), 'Grazie');
for (const text of ['Dopo la messa per uscire dalla chiesa c’è una rampa?', 'Come uscire dalla chiesa in carrozzina?']) {
  const result = c.classifyEmail('Accessibilità', text, false);
  assert.notEqual(result.category, 'formal');
  assert.notEqual(result.category, 'sbattezzo');
  assert.equal(result.shouldReply, true);
}
for (const text of ['Vorrei uscire dalla Chiesa.', 'La messa è alle 18. Vorrei uscire dalla Chiesa.',
  'Vorrei lo sbattezzo, nonostante il mio matrimonio in chiesa.']) {
  assert.equal(c.classifyEmail('Richiesta', text, false).category, 'formal', text);
}
console.log('Unicode, dates, relative languages, quote headers and church-exit regressions passed');
