const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ctx = {console:{log(){},warn(){},error(){}},CONFIG:{}};
vm.createContext(ctx);
for (const file of ['gas_classifier.js','gas_email_processor.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx);
}
const c = new ctx.Classifier(), p = Object.create(ctx.EmailProcessor.prototype);
for (const text of ['mi sono sentito con Don Marco','mi sono sentita con Don Marco',
  'ci siamo sentiti con Don Marco','vi siete sentite con Don Marco']) {
  const prior = c._detectPriorOralCommunication(text);
  assert.equal(prior.strength,'strong',text);
  assert.equal(prior.mentioned_contact,'Don Marco',text);
}
for (const [text,name] of [
  ['Ho parlato con Don Marco ieri mattina per il battesimo','Don Marco'],
  ['Ho parlato con Don Marco De Luca per il battesimo','Don Marco De Luca'],
  ['contatto: Maria Rossi ieri mattina','Maria Rossi']
]) assert.equal(c._extractPriorCommunicationContact_(text),name,text);
for (const text of ['2026/05/12','100/05/12','telefono: 06/12/34',
  'protocollo: 06/12/34','tra le 9/12','dalle ore 9/12','orario 9/12']) {
  assert.equal(p._extractExplicitDateFromText_(text,2026),null,text);
}
for (const text of ['data: 15-08','data del 15-08','il 06/12/34','12/09/2026']) {
  assert(p._extractExplicitDateFromText_(text,2026),text);
}
for (const text of ['Mi madre se encuentra en el hospital',"Ma mère se trouve à l’hôpital",
  'Minha mãe se encontra no hospital','Sono a Roma da ieri','Sono a Roma fino a domani',
  'Sono ricoverato in ospedale da ieri','Mia madre è in ospedale da ieri',
  'Non ci si riesce a muovere']) assert(p._presenceAssertionText_(text).trim(),text);
for (const text of ['Se mi trovo a Roma da ieri','Si mi madre se encuentra en el hospital',
  'Ero a Roma da ieri','Sarò a Roma fino a domani','Andrò a Roma fino a domani e resto lì',
  'I was in Rome since yesterday','Je serai à Rome jusqu’à demain']) {
  assert.equal(p._presenceAssertionText_(text).trim(),'',text);
}
for (const [text,expected] of [
  ['Dopo il matrimonio vorrei uscire dalla chiesa cattolica',true],
  ['Dopo la messa chiedo come uscire dalla chiesa cattolica',true],
  ['Dopo la messa vorrei uscire dalla chiesa cattolica con la carrozzina',false],
  ['Dopo la messa uscire dalla chiesa cattolica',false]
]) {
  assert.equal(c._isSbattezzoFormalRequest_(text),expected,text);
  assert.equal(p._detectIndirectSbattezzoRequest_('',text).detected,expected,text);
}
for (const text of ['fosse alle 18','starts at 6 pm','begins at 6:30 pm','era alle ore 18']) {
  assert.equal(p._hasExplicitTimeExpectation(text),true,text);
}
for (const text of ['starts at 16 pm','fosse alle 18:99','era 18 persone']) {
  assert.equal(p._hasExplicitTimeExpectation(text),false,text);
}
for (const [text,topic] of [
  ['Could you clarify baptism?','battesimo'],
  ['Could you clarify mass times?','orari_messe'],
  ['Podría aclarar el bautismo?','battesimo'],
  ['Could you clarify the baptême?','battesimo'],
  ['Could you clarify the baptism and wedding?','battesimo']
]) {
  const result = p._computeUserReaction(text,['battesimo','orari_messe','matrimonio','contatti','indirizzo']);
  assert(result && result.topics.includes(topic),text);
  if (text.includes('and wedding')) assert(result.topics.includes('matrimonio'));
}
for (const text of ['Could you clarify this number?','Could you clarify via mail?']) {
  assert.equal(p._computeUserReaction(text,['battesimo','contatti','indirizzo']),null,text);
}
console.log('Contact extraction, contextual dates, presence, church intent and multilingual reactions passed');
