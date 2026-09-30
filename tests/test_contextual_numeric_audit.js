const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ctx = {console:{log(){},warn(){},error(){}},CONFIG:{}};
vm.createContext(ctx);
for (const file of ['gas_classifier.js','gas_email_processor.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx);
}
const c = new ctx.Classifier(), p = Object.create(ctx.EmailProcessor.prototype);
for (const text of ['Ho un bambino di 6-8 anni','aperto dalle 9-12','tra 1-2 giorni',
  '24/7','via Roma 10/4','civ. 10/4','interno 10/4']) {
  assert.equal(p._extractExplicitDateFromText_(text,2026),null,text);
  assert.equal(p._detectTemporalMentions(text,'it'),false,text);
}
for (const text of ['appuntamento il 12-09','appuntamento il 24/7','12/09',
  '12-09-2026','via Roma: appuntamento il 10/4']) {
  assert(p._extractExplicitDateFromText_(text,2026),text);
  assert.equal(p._detectTemporalMentions(text,'it'),true,text);
}
for (const [text,lang] of [['Guten Morgen','de'],['por la mañana','es'],['cada mañana','es']]) {
  assert.equal(p._detectTemporalMentions(text,lang),false,text);
}
assert.equal(p._detectTemporalMentions('übermorgen','de'),true);
assert.equal(p._detectTemporalMentions('esta mañana','es'),true);
for (const text of ['Il corso si tiene di sera e io ho difficoltà a camminare',
  'La messa si celebra alle 18 e mia madre è allettata',
  'Non ci si riesce a muovere con la sedia a rotelle']) {
  assert(p._presenceAssertionText_(text).trim(),text);
}
for (const text of ['Si je suis à Rome, je viens','Si estoy en Roma, voy',
  'Se il corso si tiene di sera io ho difficoltà']) {
  assert.equal(p._presenceAssertionText_(text),'',text);
}
for (const [text,expected] of [
  ['Dopo il matrimonio ho deciso di uscire dalla chiesa cattolica',true],
  ['Dopo la messa di domenica scorsa voglio uscire dalla chiesa cattolica',true],
  ['Dopo la messa voglio uscire dalla chiesa cattolica con la carrozzina: c’è una rampa?',false]
]) {
  assert.equal(c._isSbattezzoFormalRequest_(text),expected,text);
  assert.equal(p._detectIndirectSbattezzoRequest_('',text).detected,expected,text);
}
let releases = 0;
ctx.CacheService = {getScriptCache:()=>({get:()=>null,put(){}})};
ctx.LockService = {getScriptLock:()=>({
  tryLock:()=>true,releaseLock(){releases++;throw Error('release failed');}
})};
p.props = {};
assert.equal(p._beginSendTransaction('missing-state').reason,'send_state_unavailable');
p.props = {setProperty(){},getProperty:key=>key.startsWith('send_uncertain_')?'1':null};
assert.equal(p._beginSendTransaction('uncertain').reason,'gmail_send_uncertain');
assert.equal(releases,2);
console.log('Contextual numeric dates, relative text, Italian pronouns and safe lock release passed');
