const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ctx = vm.createContext({ console: {log(){},warn(){},error(){},debug(){}}, CONFIG: {MAX_THREAD_LENGTH:8} });
for (const file of ['gas_classifier.js','gas_email_processor.js','gas_thread_policy.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx);
}
const p=Object.create(ctx.EmailProcessor.prototype), c=new ctx.Classifier();
const plain=x=>JSON.parse(JSON.stringify(x));
for(const [subject,body] of [['Re: Grazie',''],['Re: Buongiorno',''],['Re: Risposta automatica: sono in ferie',''],['','Buongiorno'],['Saluti','Cordiali saluti']]) {
  assert.equal(c.classifyEmail(subject,body,true).shouldReply,false,subject+' '+body);
}
assert.equal(c.classifyEmail('Quando posso ritirare il certificato?','Buongiorno',true).shouldReply,true);
assert.equal(c._isGreetingOnly(null),false);
assert.equal(c.classifyEmail('Saluti','Buongiorno\nCordiali saluti').shouldReply,false);
assert.equal(c._extractMainContent('> testo\n| vecchio\n* vecchio\n- vecchio\n[testo]\nRisposta'),'Risposta');
assert.equal(c._extractMainContent('> testo\n- Vorrei sapere quando venire'),'- Vorrei sapere quando venire');
assert.equal(p._extractExplicitDateFromText_('alle 18.30 del 15/07/2026',2026).date.getMonth(),6);
assert.equal(p._extractExplicitDateFromText_('alle 9.10',2026),null);
assert.equal(p._extractExplicitDateFromText_('15 LUGLIO 2026',2026).date.getMonth(),6);
for(const text of ['15.05.2026','10 ore','Luca 15:9','Luca 15:10']) assert.deepEqual(plain(p._extractTimes(text)),[]);
assert.deepEqual(plain(p._extractTimes('ore 10. Alle 9:30')),['10:00','09:30']);
for(const [text,lang] of [['demain','fr-FR'],['tomorrow','EN'],['tomorrow','en-US']]) assert.equal(p._detectTemporalMentions(text,lang),true);
assert.match(p._presenceAssertionText_("Vivo all'estero e non posso venire all'incontro"),/estero e non posso/);
assert.match(p._presenceAssertionText_('Sì, ora posso venire'),/ora posso venire/);
assert.match(p._presenceAssertionText_('si trova in ospedale'),/ospedale/);
assert.equal(p._presenceAssertionText_('Si je peux venir'),'');
assert.equal(p._presenceAssertionText_('Si puedo venir'),'');
assert.ok(p._detectPhysicalPresenceConstraint_('',p._presenceAssertionText_('Sono ricoverato in ospedale e non posso venire'),true).some(x=>x.type==='health'));
assert.ok(p._detectPhysicalPresenceConstraint_('',p._presenceAssertionText_('Sono anziano e non riesco'),true).some(x=>x.type==='mobility'));
for(const text of ['non ho ricevuto','non è tutto chiaro','not received','no he recibido']) assert.notEqual(p._computeUserReaction(text,['topic'])?.reaction,'acknowledged');
assert.equal(p._computeUserReaction('ricevuto',['topic']).reaction,'acknowledged');
for(let limit=1;limit<160;limit++) {
  const repaired=p._repairRetryPromptXmlFences_('<user_email>'+'x'.repeat(100)+'</user_email>',limit);
  assert.ok(repaired.length<=limit);
  assert.equal(p._getPendingRetryPromptXmlFenceClosures_(repaired).length,0,`limit ${limit}`);
}
const values=new Map();
const props={getProperty:k=>values.get(k)||null,setProperty:(k,v)=>values.set(k,v),deleteProperty:k=>values.delete(k)};
ctx.PropertiesService={getScriptProperties:()=>props};
const hash=p._hashValidationReviewSignature_('test'),old=Date.now()-10000;
values.set('VALIDATION_REVIEW_ALERT_STATE',JSON.stringify({[hash]:old}));
p._markValidationReviewAlertSent_('test');
assert.ok(JSON.parse(values.get('VALIDATION_REVIEW_ALERT_STATE'))[hash]>old);
for(const mode of ['no_cache','props_failure','cache_failure','no_message']) {
  let released=0;
  ctx.PropertiesService={getScriptProperties:()=>{if(mode==='props_failure')throw Error('failure');return props;}};
  ctx.CacheService={getScriptCache:()=>{if(mode==='cache_failure')throw Error('failure');return null;}};
  p._rollbackSendTransaction(mode==='no_message'?null:'id',{lock:{releaseLock(){released++;}}});
  assert.equal(released,1,mode);
}
ctx.PropertiesService={getScriptProperties:()=>props};
let deleted=0,created=0;
ctx.ScriptApp={getProjectTriggers:()=>[{getHandlerFunction:()=> 'resumeEmailBatchFromCheckpoint'}],deleteTrigger(){deleted++;},newTrigger(){created++;throw Error('unexpected');}};
p._storeBatchCheckpointAndScheduleContinuation_([],0,5000);
assert.equal(values.has('EMAIL_BATCH_CHECKPOINT'),false);assert.equal(deleted,1);assert.equal(created,0);
values.set('EMAIL_BATCH_CHECKPOINT',JSON.stringify({depth:5,pendingThreadIds:['a'],pendingCount:1}));
p._storeBatchCheckpointAndScheduleContinuation_([{getId:()=> 'a'}],0,5000);
// depth è diagnostico: il limite condiviso da writer e lettore riguarda retryCount.
assert.equal(values.has('EMAIL_BATCH_CHECKPOINT'),true);
assert.equal(JSON.parse(values.get('EMAIL_BATCH_CHECKPOINT')).depth,6);
assert.equal(deleted,1); // trigger preesistente preservato se la creazione fallisce
let acquisitions=0,releases=0,puts=0;
ctx.LockService={getScriptLock:()=>({tryLock(){acquisitions++;return true;},releaseLock(){releases++;}})};
const cache={get:()=>null,put(){puts++;},remove(){}};
ctx.CacheService={getScriptCache:()=>cache};
assert.equal(p._acquireThreadLock('a',true,ctx.console).lockCovered,true);
assert.equal(acquisitions,0);assert.equal(releases,0);
ctx.ThreadPolicy.throttle({}, {messageDetails:{senderEmail:'a'},lockCtx:{cache,lockCovered:true},threadLogger:ctx.console,result:{}});
assert.equal(acquisitions,0);assert.equal(releases,0);
const before=puts;
ctx.LockService={getScriptLock:()=>({tryLock:()=>false,releaseLock(){throw Error('not owned');}})};
const result={};
assert.equal(ctx.ThreadPolicy.throttle({}, {messageDetails:{senderEmail:'a'},lockCtx:{cache},threadLogger:ctx.console,result}).terminal,true);
assert.equal(result.status,'dilata');assert.equal(puts,before);
console.log('Verified audit regressions: OK');
