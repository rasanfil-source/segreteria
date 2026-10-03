const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const silent = {log(){},info(){},warn(){},error(){},debug(){}};
const ctx = vm.createContext({console:silent, CONFIG:{}, Set});
require('./helpers/load_thread_components')(ctx);
for (const file of ['gas_classifier.js','gas_email_processor.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx,{filename:path.resolve(__dirname,'..',file)});
}
const thread = id => ({getId:()=>id});
function setup() {
  const effects={cleared:0,empty:0,processed:0};
  const p=Object.assign(Object.create(ctx.EmailProcessor.prototype),{
    config:{maxEmailsPerRun:2,maxExecutionTimeMs:300000,minRemainingTimeMs:30000,
      emptyInboxWarningThreshold:10,labelName:'IA',errorLabelName:'Errore',validationErrorLabel:'Verifica',skipLabelName:'·'},
    logger:silent,gmailService:{},_getLanguageProcessingMode_:()=> 'all',_getSafetyValveReducedLimit_:()=>null,
    _clearBatchCheckpoint_:()=>effects.cleared++,_trackEmptyInboxStreak:value=>{if(value)effects.empty++;return effects.empty;},
    _hasUnreadMessagesToProcess:()=>true,_getRemainingTimeMs:()=>60000,_isNearDeadline:()=>false,
    _storeBatchCheckpointAndScheduleContinuation_:(threads,index,delay)=>{effects.checkpoint={ids:threads.map(t=>t.getId()),index,delay};},
    processThread:(...args)=>{effects.processed++;effects.options=args[6];return {status:'replied'};}
  });
  return {p,effects};
}
const quota='Service invoked too many times for one day: gmail';
for(const error of [quota,'Service unavailable','Unexpected unclassified failure']) {
  for(const partial of [false,true]) {
    const {p,effects}=setup();
    ctx.GmailApp={getThreadById:id=>{if(partial && id==='first')return thread(id);throw Error(error);}};
    const result=p.processUnreadEmails('kb','',true,true,{threadIds:['first','second']});
    assert.equal(result.reason,error===quota?'gmail_daily_limit_reached':'thread_discovery_failed');
    assert.equal(effects.cleared,0,'retain original checkpoint, including partial hydration');
    assert.equal(effects.empty,0,'failed discovery is not an empty inbox');
    assert.equal(effects.processed,0);
  }
}
{
  const {p,effects}=setup();
  ctx.GmailApp={getThreadById:()=>null};
  p.processUnreadEmails('kb','',true,true,{threadIds:['deleted']});
  assert.equal(effects.cleared,1);
  assert.equal(effects.empty,1);
}
for(const label of ['Errore','Verifica','·']) {
  for(const failure of ['exception','partial-set','partial-array','invalid']) {
    const {p}=setup(),loaded=[];
    p._getLanguageProcessingMode_=()=> 'foreign_only';
    p.gmailService.getMessageIdsWithLabel=name=>{
      loaded.push(name);
      if(name!==label)return new Set();
      if(failure==='exception')throw Error('Service unavailable');
      if(failure==='invalid')return null;
      const result=failure==='partial-set'?new Set():[];result.complete=false;return result;
    };
    p.gmailService.getUnprocessedUnreadThreads=(...args)=>{
      const options=args[7];options.preloadBlacklistMessageIds();
      assert.equal(options.blacklistComplete,false,label+'/'+failure);
      return [];
    };
    p.processUnreadEmails('kb','',true);
    assert.deepEqual(loaded,['IA','Errore','Verifica','·'],'attempt labels independently');
  }
}
for(const resume of [false,true])for(const label of ['IA','Errore','Verifica','·']) {
  const {p,effects}=setup();
  p._getLanguageProcessingMode_=()=> 'foreign_only';
  p.gmailService.getMessageIdsWithLabel=name=>{if(name===label)throw Error(quota);return new Set();};
  p.gmailService.getUnprocessedUnreadThreads=(...args)=>{args[7].preloadBlacklistMessageIds();return [thread('t')];};
  ctx.GmailApp={getThreadById:()=>thread('t')};
  const result=p.processUnreadEmails('kb','',true,true,resume?{threadIds:['t']}:{});
  assert.equal(result.reason,'gmail_daily_limit_reached');
  assert.equal(effects.cleared,0);
  assert.equal(effects.processed,0);
}
{
  const {p,effects}=setup();let expired=false;
  p.gmailService.getUnprocessedUnreadThreads=()=>[thread('slow'),thread('next')];
  p._hasUnreadMessagesToProcess=()=>{expired=true;return true;};
  p._getRemainingTimeMs=()=>expired?5000:60000;
  p.processUnreadEmails('kb','',true);
  assert.equal(effects.processed,0);
  assert.deepEqual(effects.checkpoint.ids,['slow','next']);
}
{
  const {p,effects}=setup();
  p.gmailService.getUnprocessedUnreadThreads=()=>[thread('normal')];
  p.processUnreadEmails('kb','',true);
  assert.equal(effects.options.batchManagedStartTime,true);
}
// L'entrypoint diretto può rinnovare un timer vecchio; il batch deve conservarlo.
for(const managed of [true,false]) {
  const {p}=setup();const old=Date.now()-280000;p._startTime=old;
  p._threadLifecycleServices_=()=>({});
  const original=ctx.ThreadLifecycle.loggers;
  ctx.ThreadLifecycle.loggers=()=>({threadLogger:silent,restoreServiceLoggers(){}});
  p._acquireThreadLock=()=>({ok:false,reason:'thread_locked'});
  p._releaseThreadLock=()=>{};
  try{ctx.EmailProcessor.prototype.processThread.call(p,thread('timer'),'kb','',null,true,null,{batchManagedStartTime:managed});}
  finally{ctx.ThreadLifecycle.loggers=original;}
  assert.equal(p._startTime===old,managed);
}
const classifier=new ctx.Classifier();
for(const text of ['Mi sono sentito male','Mi sono sentita sola','Ci siamo sentiti male','Vi siete sentite sole','Non mi sono sentito con don Paolo'])
  assert.equal(classifier._detectPriorOralCommunication(text).detected,false,text);
for(const text of ['Mi sono sentito con don Paolo','Mi sono sentita al telefono','Ci siamo sentiti ieri','Vi siete sentiti per telefono'])
  assert.equal(classifier._detectPriorOralCommunication(text).strength,'strong',text);
const {p}=setup();
for(const text of ['Continuità sensibile','Qualità sensibile','Qualità mista','Qualita sensibile'])
  assert.equal(p._classifyValidationForRetry({errors:[text],details:{}}).sensitive_quality,true,text);
const memory={conversationState:{physicalPresenceState:{constraints:[{type:'health',status:'active',policy:'avoid_invitation'}]}}};
for(const [text,active] of [['Non sono guarito, ora sono guarito',false],['Non sono guarito, non sono guarito',true],['Non sono guarito ma sono guarito',false]])
  assert.equal(p._reconcilePhysicalPresenceConstraint_(null,'',text,memory).has_constraint,active,text);
for(const file of ['gas_config.js','gas_config.example.js']) {
  const cfgCtx=vm.createContext({console:silent,PropertiesService:{getScriptProperties:()=>({getProperty:()=>null,getProperties:()=>({})})}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),cfgCtx);
  assert.equal(vm.runInContext('CONFIG.MEMORY_RETENTION_DAYS',cfgCtx),30);
  assert(cfgCtx.validateConfig().warnings.some(w=>w.includes('180')));
  for(const value of [0,-1,1.5,NaN,Infinity,'30'])for(const key of ['MEMORY_RETENTION_DAYS','SENSITIVE_FLAGS_TTL_DAYS']) {
    cfgCtx.invalid=value;vm.runInContext('CONFIG.'+key+'=invalid',cfgCtx);
    assert(cfgCtx.validateConfig().errors.some(e=>e.includes(key)));
    vm.runInContext('CONFIG.'+key+'=180',cfgCtx);
  }
}
console.log('Checkpoint, label cache, batch timer, language and retention regressions passed');
