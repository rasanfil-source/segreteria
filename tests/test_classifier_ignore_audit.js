const fs = require('fs'), vm = require('vm'), path = require('path'), assert = require('assert');
const root = path.join(__dirname,'..');
const ctx = {console:{log(){},warn(){},error(){}},CONFIG:{},GLOBAL_CACHE:{}};
vm.createContext(ctx);
for (const file of ['gas_classifier.js','gas_email_processor.js','COLLAUDO_PERSONAL_IGNORE_UNA_TANTUM.js']) {
  vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx);
}
const c = new ctx.Classifier();
for (const [subject,body,reason] of [
  ['Re: Richiesta di sbattezzo','Risposta automatica: sono in ferie','out_of_office_auto_reply'],
  ['Re: Documenti','Risposta automatica: in allegato il modulo','out_of_office_auto_reply'],
  ['Re: Richiesta di sbattezzo','Grazie mille','ultra_simple_acknowledgment'],
  ['Re: Richiesta di sbattezzo','Buongiorno, grazie','ultra_simple_acknowledgment'],
  ['Re: Richiesta di sbattezzo','Buongiorno','greeting_only'],
  ['Re: Quando posso ritirare il certificato?','Buongiorno','greeting_only'],
  ['Re: Orari messe','Buongiorno\nCordiali saluti','greeting_only']
]) {
  const result = c.classifyEmail(subject,body,true);
  assert.equal(result.shouldReply,false,body);
  assert.equal(result.reason,reason,body);
}
for (const [subject,body,isReply] of [
  ['Richiesta di sbattezzo','Buongiorno',false],
  ['Richiesta di sbattezzo','Grazie mille',false],
  ['Re: Richiesta di sbattezzo','Confermo la richiesta di sbattezzo',true],
  ['Re: Richiesta di sbattezzo','Grazie, richiesta sbattezzo',true],
  ['Re: Richiesta di sbattezzo','Grazie, come posso procedere?',true],
  ['Re: Documenti','In allegato il certificato richiesto',true],
  ['Orari messe','Buongiorno',false],
  ['Quando posso ritirare il certificato?','Buongiorno',true]
]) assert.equal(c.classifyEmail(subject,body,isReply).shouldReply,true,body);
const empty = c.classifyEmail('Re: Orari messe','',true);
assert.equal(empty.shouldReply,true);
assert.equal(empty.category,c._categorizeContent('Orari messe'));
assert(empty.category);
const p = Object.create(ctx.EmailProcessor.prototype);
let raw = 'u.tente+tag@googlemail.com';
p.props = {getProperty:()=>raw};
ctx.PropertiesService = {getScriptProperties:()=>p.props};
ctx.Logger = {log(){}};
for (const sender of ['utente@gmail.com','u.tente+altro@gmail.com','Nome <utente@googlemail.com>']) {
  assert.equal(p._shouldIgnoreEmail({senderEmail:sender}),true,sender);
}
assert.equal(p._shouldIgnoreEmail({senderEmail:'altroutente@gmail.com'}),false);
ctx.COLLAUDO_PERSONAL_IGNORE_SENDERS_UNA_TANTUM();
raw = JSON.stringify(['u.tente@gmail.com','utente+tag@googlemail.com']);
assert.deepEqual(Array.from(p._getPersonalIgnoreSenders_()),['utente@gmail.com']);
ctx.COLLAUDO_PERSONAL_IGNORE_SENDERS_UNA_TANTUM();
raw = 'first.last+tag@example.com';
assert.equal(p._shouldIgnoreEmail({senderEmail:'first.last+tag@example.com'}),true);
assert.equal(p._shouldIgnoreEmail({senderEmail:'firstlast@example.com'}),false);
for (const invalid of ['["utente@gmail.com"','Nome <utente@gmail.com>','[42]']) {
  raw = invalid;
  assert.throws(()=>p._getPersonalIgnoreSenders_(),/non valido/);
  assert.throws(()=>ctx.COLLAUDO_PERSONAL_IGNORE_SENDERS_UNA_TANTUM(),/non valido/);
}
assert(fs.readFileSync(path.join(root,'.claspignore'),'utf8').split(/\r?\n/).includes('COLLAUDO_PERSONAL_IGNORE_UNA_TANTUM.js'));
console.log('Classifier filter precedence, empty replies, canonical personal blacklist and real dry-run passed');
