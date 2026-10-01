const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({console:{log(){},warn(){},error(){}},CONFIG:{}});
for(const file of ['gas_classifier.js','gas_email_processor.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx,{filename:file});
const c = new ctx.Classifier(), p = Object.create(ctx.EmailProcessor.prototype);
for(const closing of ['Cordialmente','In fede','Best regards','Kind regards','Warm regards','Sincerely','Sent from my iPhone','Inviato da mio telefono']) {
  for(const greeting of ['Buongiorno','Good morning','Hello','Buon pomeriggio']) {
    const body = greeting+',\n'+closing+',\nMario Rossi';
    assert.equal(c.classifyEmail('Re: Orari messe',body,true).shouldReply,false,body);
    assert.equal(c.classifyEmail('Re: Orari messe',body+'\nP.S. Quando posso venire?',true).shouldReply,true,body);
  }
}
assert.equal(c.classifyEmail('Come iscriversi?', 'Hello\nKind regards\nJohn',false).shouldReply,true);
assert.equal(c.classifyEmail('Re: Informazioni', 'Cordialmente chiedo quando posso venire',true).shouldReply,true);
for(const text of [
  'Vi allego il certificato di battesimo di mio figlio; come padrino abbiamo scelto mio fratello',
  'Certificato di battesimo del padrino Mario Rossi'
]) assert.equal(p._detectDocumentTypeFromText_(text),'certificato_battesimo',text);
const enrollment='Scheda di iscrizione al catechismo per la Cresima ragazzi';
assert.equal(p._evaluateDocumentConsistency_('',enrollment,[],enrollment+'\nNome del Padrino / Madrina: Mario').mode,'match');
for(const text of ['Attestato di idoneità del padrino','Certificato del padrino', 'Modulo per il padrino', 'Madrina']) {
  assert.equal(p._detectDocumentTypeFromText_(text),'attestato_idoneita_padrino_madrina',text);
}
assert.equal(p._evaluateDocumentConsistency_('', 'Allego attestato di idoneità del padrino', [], 'Certificato di battesimo').mode,'mismatch');
for(const text of ['Quando sarà il battesimo del 12 gennaio?', 'Quando sara il battesimo del 12 gennaio', 'ci sara la messa', 'quando avra luogo', 'quando terra la celebrazione']) {
  assert.equal(p._detectYearlessDateTemporalIntent_(text),'future',text);
  assert.equal(p._detectYearlessDateTemporalIntent_(text.normalize('NFD')),'future',text);
}
assert.equal(p._detectYearlessDateTemporalIntent_('Sara ha inviato il documento'),'unspecified');
assert.equal(p._detectYearlessDateTemporalIntent_('La terra del giardino'),'unspecified');
console.log('Closing alignment, document priority and yearless normalization passed');
