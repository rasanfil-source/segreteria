const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const quiet = {log(){},warn(){},error(){}};
const load = (ctx,file)=>vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx,{filename:file});
const ctx = vm.createContext({console:quiet,CONFIG:{}});
load(ctx,'gas_email_processor.js');
load(ctx,'gas_classifier.js');
const p = Object.create(ctx.EmailProcessor.prototype);
for (const [ocr,pattern,category] of [
  ['Modulo sbattezzo e richiesta cancellazione dal registro battesimo',/protocollo FORMAL/,'formal'],
  ['Certificato di idoneità padrino',/idoneità padrino\/madrina/,'sacrament'],
  ['Scheda iscrizione catechesi',/tipologia di modulo\/documento/,'sacrament'],
  ['Documento generico',/Confermare la ricezione della documentazione allegata/,null]
]) {
  for (const questionIn of ['none','body','ocr']) {
    const body = 'Invio il documento.' + (questionIn==='body' ? ' Quando posso ritirarlo?' : '');
    const context = p._deriveAttachmentIntentContext_(body,'Documento allegato',[{name:'documento.pdf'}],
      ocr + (questionIn==='ocr' ? ' Quando posso ritirarlo?' : ''),'post_ocr');
    assert.equal(context.categoryHintSource,category,ocr);
    assert.match(context.responseDirective,pattern);
    assert.equal(context.hasQuestions,questionIn==='body');
    if(questionIn==='body') assert.match(context.responseDirective,/Rispondere inoltre puntualmente/);
    else assert.doesNotMatch(context.responseDirective,/Rispondere inoltre/);
  }
}
assert.equal(p._deriveAttachmentIntentContext_('Invio il documento.','',[],'Modulo sbattezzo','post_ocr'),null);
const classifier = new ctx.Classifier();
assert.equal(classifier._categorizeContent('Spedisco documento di identità per info'),'document_submission');
assert.equal(classifier._categorizeContent('sbattezzo documento di identità'),'sbattezzo');

for(const failedPersistence of [false,true]) {
  const cache = new Map([['sending_m','started']]);
  const props = new Map([['send_uncertain_m','started']]);
  let releases = 0;
  ctx.CacheService = {getScriptCache:()=>({put:(k,v)=>cache.set(k,v),remove:k=>cache.delete(k)})};
  p._getProperties_=()=>({deleteProperty:k=>props.delete(k)});
  p._persistSendIdempotencyBackup_=()=>{if(failedPersistence) throw Error('persistence failed'); props.set('confirmed','yes');};
  p._readSendIdempotencyBackup_=()=>props.get('confirmed');
  const transaction = {lock:{releaseLock(){releases++; throw Error('release failed');}}};
  // La consegna confermata conserva il proprio esito; un errore di persistenza mantiene il marcatore di incertezza.
  assert.doesNotThrow(()=>p._commitSendTransaction('m',transaction));
  assert.equal(releases,1);
  assert(cache.has('sent_m'));
  assert.equal(cache.has('sending_m'),false);
  assert.equal(props.has('send_uncertain_m'),failedPersistence);
}
for(const file of ['gas_config.js','gas_config.example.js']) {
  const cfg = vm.createContext({console:quiet});
  load(cfg,file);
  const fallback = ['fallback'];
  assert.deepEqual(Array.from(cfg._getScriptPropertyStringArray('LIST',fallback)),fallback);
  for(const bulk of [false,true]) {
    cfg._clearScriptPropertyCache();
    cfg._SCRIPT_PROPERTIES = bulk ? {getProperties:()=>({LIST:'[" one ", "two"]'})} : {getProperty:()=> 'one; two'};
    assert.deepEqual(Array.from(cfg._getScriptPropertyStringArray(' LIST ',fallback)),['one','two']);
  }
}
console.log('Attachment directives, category priority, send-lock cleanup and injected properties passed');
