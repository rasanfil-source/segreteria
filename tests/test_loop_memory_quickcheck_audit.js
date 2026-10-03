const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const ctx=vm.createContext({console:{log(){},warn(){},error(){},info(){}},CONFIG:{},GLOBAL_CACHE:{}});
for(const file of ['gas_classifier.js','gas_email_processor.js','gas_thread_policy.js','gas_thread_validation.js',
  'gas_gemini_service.js','gas_gmail_service.js','gas_response_strategy.js','gas_memory_service.js','gas_response_validator.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx,{filename:file});
}
const p=Object.create(ctx.EmailProcessor.prototype);
p._getPersonalIgnoreSenders_=()=>[];
ctx.GLOBAL_CACHE.ignoreKeywords=['nuovo arrivo','ultima occasione'];
const mail={senderEmail:'persona@example.org',subject:'Battesimo',body:'Aspettiamo un nuovo arrivo in famiglia, vorremmo il battesimo'};
assert.equal(p._shouldIgnoreEmail(mail),false);
assert.equal(p._shouldIgnoreEmail({...mail,headers:{'List-Unsubscribe':'<https://example.org>'}}),true);
assert.equal(p._shouldIgnoreEmail({...mail,headers:{Precedence:'bulk'}}),true);
assert.equal(p._shouldIgnoreEmail({...mail,subject:'Ultima occasione'}),true);

const own=new Set(['parish@example.org']);
const makeMessages=(pairs,gap)=>Array.from({length:pairs*2},(_,i)=>({
  getFrom:()=>i%2?'person@example.org':'parish@example.org',getDate:()=>new Date(1800000000000+i*gap)
}));
for(const [pairs,gap,blocked] of [[3,60000,true],[4,300000,true],[2,60000,false],[5,1200000,false]]) {
  const marks=[],result={};
  ctx.ThreadPolicy.loopAndSender({config:{maxConsecutiveExternal:4},_normalizeEmailAddress_:s=>s,
    _evaluatePreAiRules_:()=>null,_applyPreAiRuleDecision_:()=>false,_shouldIgnoreEmail:()=>false},
    {messages:makeMessages(pairs,gap),ownAddresses:own,messageState:{markFailureForCurrentBurst:(type)=>marks.push(type)},
    messageDetails:{senderEmail:'person@example.org',subject:'test'},result,buildRuleContext:x=>x});
  assert.equal(result.reason==='possible_email_loop',blocked);
  if(blocked){assert.equal(result.validationFailed,true);assert.deepEqual(marks,['validation']);}
}

ctx.LockService={getScriptLock:()=>({waitLock(){},releaseLock(){}})};
const m=Object.create(ctx.MemoryService.prototype);
Object.assign(m,{_initialized:true,_getLockTuning_:()=>({maxRetries:1,shardedAcquireTimeoutMs:1}),
  _getShardedLockKey:()=> 'lock',_tryAcquireShardedLock:()=>true,_releaseShardedLock(){},_sleepLockBackoff_(){},
  _invalidateCache(){},_writeThroughMemoryCache_(){},_withSheetWriteLock:fn=>fn(),
  _validateAndNormalizeTimestamp:()=>new Date().toISOString()});
const raw=m._serializeMemorySummaryState('','Testo legacy',{currentRelationalPosture:'open',
  responseFocusHint:'answer_only_residual_question',responseFocusHintConfidence:0.9,updatedAt:new Date().toISOString(),source:'quick_check'});
let saved;
m._findRowByThreadId=()=>({rowIndex:2,values:['t','it','information','standard','["orari"]',new Date().toISOString(),4,2,raw,'{}']});
m._updateRow=(_,data)=>{saved=data;};
for(const call of [()=>m.addProvidedInfoTopics('t',['contatti']),
  ()=>m._updateProvidedTopicReactionWithoutIncrement('t','orari','acknowledged'),
  ()=>m._updateProvidedInfoWithoutIncrement('t',['contatti'])]) {
  saved=null;call();assert(saved);assert.equal(saved.memorySummary,raw);assert.equal(saved.messageCount,4);
  assert.equal(JSON.parse(saved.memorySummary).conversationState.responseFocusHint,'answer_only_residual_question');
}

const service=Object.create(ctx.GeminiService.prototype);
const truncated=()=>Object.assign(Error('MAX_TOKENS'),{code:'TRUNCATED_OUTPUT',_nonRetryable:true});
for(const limiter of [false,true]) for(const repeat of [false,true]) {
  let attempts=0,reservations=0;
  const budgets=[];
  Object.assign(service,{useRateLimiter:limiter,primaryKey:'p',config:{},detectEmailLanguage:()=>({language:'it'}),_estimateTokens:()=>10,
    _withRetry:fn=>fn(),_quickCheckWithModel(a,b,c,d,e,f,budget){budgets.push(budget);if(++attempts===1 || repeat) throw truncated();return {shouldRespond:true};},
    rateLimiter:{executeRequest(task,fn){reservations++;assert.equal(task,'quick_check');return {success:true,result:fn('model',{})};}}});
  if(repeat) assert.throws(()=>service.shouldRespondToEmail('body','subject'),/MAX_TOKENS/);
  else assert.equal(service.shouldRespondToEmail('body','subject').shouldRespond,true);
  assert.deepEqual(budgets,[2048,4096]);assert.equal(reservations,limiter?2:0);
}
// Il contenuto del controllo rapido rispetta il budget impostato dal chiamante.
const actualService=Object.create(ctx.GeminiService.prototype);
Object.assign(actualService,{config:{},primaryKey:'p',_buildGenerateUrl:()=> 'test',_isPrimaryKeyFallbackHttpError_:()=>false,
  fetchFn(url,options){assert.equal(JSON.parse(options.payload).generationConfig.maxOutputTokens,4096);
    return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({candidates:[{finishReason:'MAX_TOKENS'}]})};}});
assert.throws(()=>actualService._quickCheckWithModel('body','subject','gemini-flash-lite-latest',{language:'it'},null,'p',4096),/troncato/);
{
  const result={},marks=[];
  ctx.ThreadPolicy.quickCheck({_deriveAttachmentIntentContext_:()=>null,_classifySponsorGuidanceLocally_:()=>null,
    memoryService:{getMemory:()=>({})},_getOwnConversationAnchor_:()=>({exists:false}),
    geminiService:{shouldRespondToEmail(){throw truncated();}}},
    {messageDetails:{body:'test',subject:'test'},messages:[],messageState:{markFailureForCurrentBurst:(kind)=>marks.push(kind)},
      ownAddresses:new Set(),threadId:'t',result});
  assert.equal(result.status,'validation_failed');assert.equal(result.validationFailed,true);
  assert.equal(result.reason,'quick_check_truncated_output');assert.deepEqual(marks,['validation']);
}

const gmail=Object.create(ctx.GmailService.prototype);
assert.equal(gmail.applyReplacements('via inviato Via VIA',{via:'strada'}),'strada inviato Via VIA');
assert.equal(gmail.applyReplacements('café caffè caféX',{café:'$&'}),'$& caffè caféX');
assert.equal(gmail._sanitizeHeaders('From: Monday to Friday\r\nTo: Sunday'),'From: Monday to Friday\nTo: Sunday');
const v=new ctx.ResponseValidator();
assert.equal(v._ottimizzaCapitalAfterComma('Gentile Marco, Le comunichiamo il nome, A. Rossi','it'),'Gentile Marco, Le comunichiamo il nome, A. Rossi');
for(const [hour,greeting] of [[13,'Bonjour'],[17,'Bonjour'],[18,'Bonsoir']]) {
  assert.equal(v._checkTimeBasedGreeting(greeting+',','fr',{currentTime:hour+':00'}).score,1);
}
const props=new Map([['send_uncertain_old','1'],['send_uncertain_confirmed','1'],
  ['sent_backup_confirmed',JSON.stringify({ts:Date.now(),expiresAt:Date.now()+60000})]]);
p._pruneExpiredSendIdempotencyBackups_({getProperties:()=>Object.fromEntries(props),deleteProperty:k=>props.delete(k)});
assert(!props.has('send_uncertain_old'));assert(!props.has('send_uncertain_confirmed'));

ctx.CONFIG.INTELLIGENT_RETRY={enabled:true,maxRetries:1};
const result={};
ctx.ThreadValidation.correctionPlans=()=>({retryPlans:[]});
ctx.ThreadValidation.regenerate=()=>({retryResponse:'<email>partial'});
ctx.ThreadValidation.validate({config:{validationEnabled:true},_prepareOutboundResponse:x=>x,
  validator:{validateResponse:()=>({isValid:false,score:0,errors:['bad']})},_isNearDeadline:()=>false,
  _shouldAttemptIntelligentRetry:()=>true,_buildCorrectionPrompt:()=> 'prompt',_parseEmailResponse_:()=>({incomplete:true,text:'partial'})},
  {response:'test',messageDetails:{},markFailureForCurrentBurst(){},result});
assert.equal(result.reason,'truncated_output');assert.equal(result.validationFailed,true);
console.log('Loop, memory preservation, quick-check retry, language and outbound regressions passed');
