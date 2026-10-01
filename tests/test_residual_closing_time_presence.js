const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({ console: { log(){}, warn(){}, error(){} }, CONFIG: {} });
for (const file of ['gas_classifier.js', 'gas_email_processor.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ctx);
}
const c = new ctx.Classifier();
const p = Object.create(ctx.EmailProcessor.prototype);
for (const subject of ['Re: Richiesta di sbattezzo', 'Re: Appuntamento']) {
  for (const body of ['Buongiorno,\ngrazie mille!\nCordiali saluti', 'Buongiorno\nGrazie\nSaluti']) {
    assert.equal(c.classifyEmail(subject, body, true).shouldReply, false, body);
  }
}
assert.equal(c.classifyEmail('Re: Richiesta di sbattezzo', '', true).reason, 'needs_ai_analysis');
assert.equal(c.classifyEmail('Richiesta di sbattezzo', '', false).reason, 'formal_request_detected');
assert.equal(c.classifyEmail('Re: Richiesta di sbattezzo', 'Grazie, confermo la richiesta di sbattezzo.', true).reason, 'formal_request_detected');
assert.equal(c.classifyEmail('Quando posso venire?', 'Buongiorno\nGrazie mille\nCordiali saluti', true).shouldReply, true);
assert.equal(c.classifyEmail('Re: Documenti', 'Buongiorno\nGrazie. Al termine vorrei sapere quando venire.\nSaluti', true).shouldReply, true);
for (const [text, expected] of [
  ['La reunión es a las 18', '18:00'], ['Das Treffen ist um 18', '18:00'],
  ['La messe est à 18', '18:00'], ['La messe commence à 18h30', '18:30'],
  ['A reunião é às 18', '18:00'], ['Das Treffen ist um 18 Uhr', '18:00'],
  ['The meeting is at 6 pm', '18:00'], ['La riunione inizia alle 18.30', '18:30']
]) {
  assert.deepEqual(Array.from(p._extractTimes(text)), [expected], text);
  assert.deepEqual(Array.from(p._extractEventScheduleTimesForDiscrepancy_(text)), [expected], text);
}
for (const text of ['Pensavo di venire il 10.12', "L'incontro del 15.05", 'am 10.12', '10.12.2026', 'Luca 15:10', '10 ore', 'alle 24', '18h99', 'ore 18.999']) {
  assert.deepEqual(Array.from(p._extractTimes(text)), [], text);
}
assert.deepEqual(Array.from(p._extractTimes('Il 10.12 alle 18.30')), ['18:30']);
const response = 'La riunione inizia alle 18.30.';
assert.equal(p._addTimeDiscrepancyNoteIfNeeded(response, { body: 'Pensavo di venire il 10.12' }, 'it'), response);
for (const [body, reply, language] of [
  ['Pensaba que era a las 17', 'La reunión es a las 18.', 'es'],
  ['Je pensais à 17h', 'La messe est à 18h30.', 'fr'],
  ['Pensava às 17', 'A reunião é às 18.', 'pt'],
  ['Ich dachte um 17 Uhr', 'Das Treffen ist um 18 Uhr.', 'de']
]) {
  assert.ok(p._addTimeDiscrepancyNoteIfNeeded(reply, { body }, language).length > reply.length, language);
}
for (const text of ['non ci si riesce a muovere', 'con le stampelle non ci si sposta facilmente', 'mi si è bloccata la schiena',
  'con la sedia a rotelle non ci si arriva', 'mi si blocca la gamba', 'ti si blocca la gamba', 'vi si gonfiano le gambe']) {
  assert.ok(p._presenceAssertionText_(text).trim(), text);
}
for (const text of ['Se non ci si riesce a muovere', 'Se mi si blocca la gamba', 'Se non ci si arriva',
  'Si je ne peux pas venir', 'Si no puedo venir', 'If I cannot walk']) {
  assert.equal(p._presenceAssertionText_(text), '', text);
}
console.log('Residual closing/time/presence regressions passed');
