const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const silent={log(){},info(){},warn(){},error(){},debug(){}};
const ctx=vm.createContext({console:silent,CONFIG:{},Set});
require('./helpers/load_thread_components')(ctx);
for(const file of ['gas_classifier.js','gas_email_processor.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx,{filename:path.resolve(__dirname,'..',file)});
const p=Object.assign(Object.create(ctx.EmailProcessor.prototype),{logger:silent,config:{labelName:'IA',errorLabelName:'Errore',validationErrorLabel:'Verifica',skipLabelName:'·'},_getPersonalIgnoreSenders_:()=>[]});
const messages=[1,2,3].map(id=>({getId:()=>String(id),isUnread:()=>false}));
const thread={getId:()=> 'pending',getMessages:()=>messages};
for(const message of ['GMAIL_DAILY_CALL_LIMIT_REACHED','Service invoked too many times for one day: gmail','Service unavailable']){
  let calls=0,cleared=0,processed=0,checkpoint;
  p.gmailService={_getMessageMetadataWithResilience(){calls++;throw Error(message);},getUnprocessedUnreadThreads:()=>[thread,{getId:()=> 'next'}]};
  Object.assign(p,{_getLanguageProcessingMode_:()=> 'all',_getSafetyValveReducedLimit_:()=>null,
    _trackEmptyInboxStreak:()=>0,_clearBatchCheckpoint_:()=>cleared++,
    _storeBatchCheckpointAndScheduleContinuation_:(threads,index,delay)=>checkpoint={ids:threads.map(t=>t.getId()),delay},
    _getRemainingTimeMs:()=>60000,_isNearDeadline:()=>false,processThread:()=>{processed++;return {status:'replied'};}});
  Object.assign(p.config,{maxEmailsPerRun:2,maxExecutionTimeMs:300000,minRemainingTimeMs:30000});
  p.processUnreadEmails('kb','',true);
  assert.equal(calls,1,'stop metadata immediately');assert.equal(cleared,0);assert.equal(processed,0);
  assert.deepEqual(checkpoint.ids,['pending','next']);
  assert.equal(checkpoint.delay,message==='Service unavailable'?60000:-1);
}
for(const mode of ['foreign_only','all']){
  const labels=[];p._getLanguageProcessingMode_=()=>mode;
  p.gmailService={getMessageIdsWithLabel:label=>{labels.push(label);return label==='·'?new Set(['m']):new Set();}};
  const t={getId:()=> 't',getMessages:()=>[{getId:()=> 'm',isUnread:()=>true}]};
  assert.equal(p._hasUnreadMessagesToProcess(t),mode==='all');
  assert.equal(labels.includes('·'),mode==='foreign_only');
}
const classifier=new ctx.Classifier();
for(const text of ['Potete controllare nel registro del battesimo il nome del padrino?','Vorrei una copia dai registri del battesimo']){
  assert.equal(classifier._isSbattezzoFormalRequest_(text),false);
  assert.notEqual(classifier.classifyEmail('Informazioni',text).category,'formal');
  assert.equal(classifier._matchesCategoryKeyword_(text.toLowerCase(),'registri del battesimo','sbattezzo'),false);
}
for(const gender of ['rimosso','rimossa']){
  const text='Vorrei essere '+gender+' dai registri';
  assert.equal(classifier._isSbattezzoFormalRequest_(text),true);
  assert.equal(p._detectIndirectSbattezzoRequest_('',text).detected,true);
}
for(const text of ['Non posso passare domani in segreteria','Non possiamo venire in segreteria, chiediamo informazioni sul battesimo','Non posso proprio venire domani','Non riesco più a venire in segreteria','Non vengo domani'])
  assert.equal(classifier._isOfficeVisitLogisticsRequest(text),false,text);
for(const text of ['Posso passare domani in segreteria?','Non posso venire oggi, ma possiamo passare domani'])assert.equal(classifier._isOfficeVisitLogisticsRequest(text),true,text);
for(const suffix of [' - mi ha detto di scrivervi',' mi ha detto di scrivervi',' le ha detto di scrivervi',' — mi ha detto di scrivervi'])
  assert.equal(classifier._extractPriorCommunicationContact_('Ho parlato con Don Marco'+suffix),'Don Marco');
assert.equal(classifier._extractPriorCommunicationContact_('Ho parlato con Don Marco De Luca ieri'),'Don Marco De Luca');
assert.equal(classifier._extractPriorCommunicationContact_('Ho parlato con Don Jean-Pierre Le Goff ieri'),'Don Jean-Pierre Le Goff');
for(const [rule,email,ignored] of [['@amazon.com','user@news.amazon.com',true],['amazon.com','user@notamazon.com',false],['promo','user@studio.promo',false],['ads','user@studio.ads',false],['promo','promo@example.org',true],['person@example.org','person@sub.example.org',false]]){
  ctx.CONFIG.IGNORE_DOMAINS=[rule];
  assert.equal(p._shouldIgnoreEmail({senderEmail:email,subject:'Informazioni',body:'Vorrei informazioni sul battesimo'}),ignored,email);
}
delete p._trackEmptyInboxStreak;
let cached='NaN',stored='10',writes=0;
ctx.CacheService={getScriptCache:()=>({get:()=>cached,put:(k,v)=>cached=v})};
p._getProperties_=()=>({getProperty:()=>stored,setProperty:(k,v)=>{stored=v;writes++;}});
assert.equal(p._trackEmptyInboxStreak(true),11);
cached='0';assert.equal(p._trackEmptyInboxStreak(false),0);assert.equal(stored,'0');assert.equal(writes,1);
p._trackEmptyInboxStreak(false);assert.equal(writes,1);
cached=null;assert.equal(p._trackEmptyInboxStreak(true),1,'cache eviction must not resurrect stale persisted count');
for(const invalid of ['NaN','-1','12junk','Infinity']){cached=invalid;stored=invalid;assert.equal(p._trackEmptyInboxStreak(true),1);}
const summary=p._buildMemorySummary({responseText:'Va bene\nA presto',providedTopics:[],referenceDate:new Date('2026-10-04T12:00:00Z')});
assert.equal(summary.split('\n').length,1);assert(summary.endsWith('Va bene A presto'));
assert(p._buildMemorySummary({responseText:'La Messa è alle 10.30 e termina alle 11.30.',providedTopics:[]}).includes('10.30'));
const values=new Map([['send_uncertain_old','1'],['send_uncertain_bad','broken'],['send_uncertain_blank',''],['send_uncertain_confirmed','1'],['sent_backup_confirmed',JSON.stringify({ts:Date.now(),expiresAt:Date.now()+60000})]]);
const props={getProperties:()=>Object.fromEntries(values),getProperty:k=>values.has(k)?values.get(k):null,deleteProperty:k=>values.delete(k),setProperty:(k,v)=>values.set(k,v)};
p._getProperties_=()=>props;
p._pruneExpiredSendIdempotencyBackups_(props);
assert(values.has('send_uncertain_old'));assert(values.has('send_uncertain_bad'));assert(values.has('send_uncertain_blank'));
assert(!values.has('send_uncertain_confirmed'));
ctx.PropertiesService={getScriptProperties:()=>props};
ctx.CacheService={getScriptCache:()=>({get:()=>null,put(){}})};
ctx.LockService={getScriptLock:()=>({tryLock:()=>true,releaseLock(){}})};
for(const id of ['old','bad','blank'])assert.equal(p._beginSendTransaction(id).reason,'gmail_send_uncertain');
console.log('Unread quota, classification, domains, uncertainty, counters and summaries passed');
