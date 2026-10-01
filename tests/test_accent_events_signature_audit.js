const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({console:{log(){},warn(){},error(){}},CONFIG:{}});
for (const file of ['gas_email_processor.js','gas_classifier.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx,{filename:file});
}
const p = Object.create(ctx.EmailProcessor.prototype);
const c = new ctx.Classifier();
for (const verb of ['sarà','ci sarà','avrà','terrà','quando sarà','quando avrà','quando terrà']) {
  assert.equal(p._detectYearlessDateTemporalIntent_(verb+' il 12 gennaio'),'future',verb);
}
assert.equal(p._detectYearlessDateTemporalIntent_('c’erano le celebrazioni'),'past');
assert.equal(p._detectYearlessDateTemporalIntent_('Casarà è un cognome'),'unspecified');
for (const verb of ['ritirerò','passerò','verrò']) {
  assert.equal(p._detectDocumentRequestWithSupportingData_('', 'Vorrei il certificato di battesimo, '+verb).detected,true,verb);
}
assert.equal(p._isReceivingOwnCresimaContext_('Farò la cresima'),true);
assert.equal(p._isReceivingOwnCresimaContext_('Il faro della cresima'),false);
assert.notEqual(p._computeUserReaction('Grazie, può aggiungere dettagli', ['battesimo'])?.reaction,'acknowledged');
assert.notEqual(p._computeUserReaction('Grazie, però può aggiungere dettagli', ['battesimo'])?.reaction,'acknowledged');
assert.equal(p._computeUserReaction('Grazie', ['battesimo']).reaction,'acknowledged');

for(const [text,language] of [
  ['Vi ho informato che farò da padrino','it'],
  ['Siccome farò da padrino, vi aggiorno','it'],
  ['Ho qualcosa da aggiungere sui requisiti del padrino','it'],
  ['The sponsor requirements were shown','en'],
  ['The sponsor requirements changed somewhat','en']
]) assert.equal(p._isExplicitSponsorEligibilityRequest_(text,language),false,text);
for (const text of ['Quali requisiti deve avere il padrino?', 'Vorrei sapere come fare da padrino', 'Info sui requisiti del padrino']) {
  assert.equal(p._isExplicitSponsorEligibilityRequest_(text),true,text);
}
const guidance = 'Abbiamo ricevuto il documento.\nIdoneità del padrino\n- essere cresimato\nRestiamo a disposizione.';
const trimmed = p._sanitizeUnrequestedSponsorGuidance_(guidance,'','Vi ho informato che farò da padrino');
assert.ok(!trimmed.includes('Idoneità'));
assert.ok(!trimmed.includes('essere cresimato'));
assert.ok(trimmed.includes('ricevuto il documento'));
assert.equal(p._sanitizeUnrequestedSponsorGuidance_(guidance,'','Quali requisiti deve avere il padrino?'),guidance);
assert.equal(p._shouldProvideEligibilityGuidance_('', 'Idoneità del padrino', {intent:'document_submission'},null),false);

for(const text of ['Das Treffen beginnt um 18:00 Uhr','Die Treffen beginnen um 18:00 Uhr',
  'Das Treffen findet um 18:00 Uhr statt','Das Treffen findet um 18.00 Uhr statt',
  'Les cours commencent à 18h','La réunion commencera à 18h',
  'La réunion a lieu à 18h','Les réunions ont lieu à 18h','La réunion se tient à 18h',
  'A reunião tem lugar às 18','As reuniões têm lugar às 18','A reunião terá lugar às 18']) {
  assert.deepEqual(Array.from(p._extractEventScheduleTimesForDiscrepancy_(text)),['18:00'],text);
}
assert.deepEqual(Array.from(p._extractEventScheduleTimesForDiscrepancy_('Das Treffen findet die Adresse um 18 Uhr.')),[]);
const details = {body:'Pensava às 17'};
const once = p._addTimeDiscrepancyNoteIfNeeded('A reunião tem lugar às 18.',details,'pt');
assert.match(once,/indicado por si/);
assert.equal(p._addTimeDiscrepancyNoteIfNeeded(once,details,'pt'),once);

for(const tail of ['Mario Rossi','Mario Rossi\nmario@example.org','Mario Rossi\n+39 061234567']) {
  const body = 'Buongiorno,\nCordiali saluti\n'+tail;
  assert.equal(c.classifyEmail('Re: Informazioni battesimo',body,true).shouldReply,false,tail);
  const greetings = c._extractMainContent(body,{preserveGreetings:true});
  assert.match(greetings,/Cordiali saluti/);
  assert.ok(!greetings.includes('Mario'));
}
assert.equal(c.classifyEmail('Re: Informazioni battesimo','Buongiorno\nCordiali saluti\nMario Rossi\nP.S. Posso venire domani?',true).shouldReply,true);
assert.equal(c.classifyEmail('Quando posso venire?','Buongiorno\nCordiali saluti\nMario Rossi',false).shouldReply,true);
console.log('Accent, event verbs, sponsor intent and signature regressions passed');
