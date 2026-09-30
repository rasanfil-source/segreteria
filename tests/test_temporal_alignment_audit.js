const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ctx = { console: { log(){}, warn(){}, error(){} }, CONFIG: {} };
vm.createContext(ctx);
for (const file of ['gas_classifier.js','gas_email_processor.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx);
}
const c = new ctx.Classifier(), p = Object.create(ctx.EmailProcessor.prototype);
for (const [text, expected] of [
  ['Per uscire dalla chiesa con la carrozzina c’è una rampa o ci sono scale?', false],
  ['Per uscire dalla chiesa cattolica c’è una rampa?', false],
  ['Dopo la messa posso uscire dalla chiesa?', false],
  ['Sono stato battezzato durante una messa nel 1990. Vorrei uscire dalla chiesa cattolica.', true],
  ['Durante la messa ero vicino alla porta\nVorrei uscire dalla chiesa cattolica.', true],
  ['Voglio lo sbattezzo. Per uscire dalla chiesa serve una rampa?', true]
]) {
  assert.equal(c._isSbattezzoFormalRequest_(text), expected, text);
  assert.equal(p._detectIndirectSbattezzoRequest_('',text).detected, expected, text);
}
assert.equal(p._detectIndirectSbattezzoRequest_('Porta e rampa', 'Vorrei uscire dalla chiesa.').detected, true);
const now = new Date(2026,9,1,12);
for (const [text, lang] of [['esta mañana','es'],['Diesen Morgen','de'],['heute frühen Morgen','de'],['heute Morgen','de']]) {
  const result = p._resolveRequestedScheduleDate_(text,now,lang);
  assert.equal(result.date.getDate(),1,text);
  assert.equal(result.isExplicit,true,text);
}
for (const [text,lang] of [['toda la mañana','es'],['cada mañana','es'],['durante la mañana','es'],['den ganzen Morgen','de'],['Guten Morgen','de']]) {
  assert.equal(p._resolveRequestedScheduleDate_(text,now,lang).isExplicit,false,text);
}
for (const [text,lang] of [['Morgen komme ich am frühen Morgen','de'],['mañana por la mañana','es']]) {
  assert.equal(p._resolveRequestedScheduleDate_(text,now,lang).date.getDate(),2,text);
}
for (const text of ['May I ask a question?', 'We may need assistance', 'How may I contact you?', 'You may come']) {
  assert.equal(p._detectTemporalMentions(text,'en'),false,text);
}
for (const text of ['May 12','12 May','May 2027','next May','in May','12th May','May 12th']) {
  assert.equal(p._detectTemporalMentions(text,'en'),true,text);
}
for (const text of ['12/09/2026','12/09','29/02/2028','12-09-2026','12.09.2026']) {
  assert.equal(p._detectTemporalMentions(text,'en'),true,text);
}
for (const text of ['99/99','31/02/2026','29/02/2027','42/15','18:30','12.09']) {
  assert.equal(p._detectTemporalMentions(text,'en'),false,text);
}
for (const text of ['aujourd’hui',"aujourd'hui",'février','août','après-demain']) {
  assert.equal(p._detectTemporalMentions(text,'fr'),true,text);
  assert.equal(p._detectTemporalMentions(text.normalize('NFD'),'fr'),true,text);
}
console.log('Temporal ambiguity and classifier/processor alignment passed');
