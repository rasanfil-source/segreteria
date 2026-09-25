// Offline regressions: all Google services are in-memory mocks.
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const props = new Map(), cache = new Map(), notifications = [], labels = [];
const propertyService = {
  getProperty: key => props.get(key) || null,
  setProperty: (key, value) => props.set(key, value),
  deleteProperty: key => props.delete(key),
  getProperties: () => Object.fromEntries(props)
};
const ctx = {
  console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
  CONFIG: { LABEL_NAME: 'IA', ERROR_LABEL_NAME: 'Errore', VALIDATION_ERROR_LABEL: 'Verifica',
    VALIDATION_ENABLED: false, MAX_CONSECUTIVE_EXTERNAL: 5, SEMANTIC_VALIDATION: { enabled: true } },
  GLOBAL_CACHE: { languageMode: 'all' },
  PropertiesService: { getScriptProperties: () => propertyService },
  CacheService: { getScriptCache: () => ({ get: k => cache.get(k), put: (k,v) => cache.set(k,v), remove: k => cache.delete(k) }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  Session: { getEffectiveUser: () => ({ getEmail: () => 'bot@example.org' }) },
  GmailApp: { getAliases: () => [] },
  MailApp: { sendEmail: (...args) => notifications.push(args) }
};
vm.createContext(ctx);
require('./helpers/load_thread_components')(ctx);
for (const file of ['gas_response_strategy.js', 'gas_prompt_context.js', 'gas_email_processor.js',
  'gas_gmail_service.js', 'gas_memory_service.js', 'gas_rate_limiter.js', 'gas_response_validator.js', 'gas_main.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ctx, { filename: file });
}
const run = code => vm.runInContext(code, ctx);
run(`var p = Object.create(EmailProcessor.prototype), m = Object.create(MemoryService.prototype),
 g = Object.create(GmailService.prototype);
 p.config = {duplicateReplyGuardEnabled:true, duplicateReplyWindowSeconds:300};
 p.props = PropertiesService.getScriptProperties();`);

assert.strictEqual(run(`new PromptContext({email:{body:'Sono in crisi con il modulo, saluti al parroco'}, requestType:{type:'technical'}}).meta.crisisCritical`), false);
assert.strictEqual(run(`new PromptContext({})._detectPastoralCrisisSignal_('', 'Sono in crisi con il modulo, saluti al parroco').strong`), false);
assert.strictEqual(run(`new PromptContext({})._detectPastoralCrisisSignal_('', 'Vorrei morire, aiutatemi').critical`), true);
for (const posture of ['appreciative', 'open']) {
  ctx.posture = posture;
  assert.strictEqual(run(`new PromptContext({email:{body:'Grazie! A che ora è la Messa?',detectedLanguage:'it'},
    requestType:{type:'technical'}, relationalPosture:posture,relationalPostureConfidence:0.99})._computeResponseRegister()`), 'warm_institutional');
}
assert.strictEqual(run(`m._validateAndNormalizeTimestamp('bad')`), null);
assert.strictEqual(run(`m._validateAndNormalizeTimestamp(null)`), null);
assert.strictEqual(run(`computeSalutationMode({isReply:true,memoryExists:true,lastUpdated:null})`), 'full');
assert.strictEqual(run(`computeSalutationMode({isReply:true,memoryExists:true,lastUpdated:new Date(Date.now()-60000)})`), 'session');
assert.strictEqual(run(`p._deriveContextualFlagsUpdate_({classification:{category:'formal'},requestType:{type:'formal'}}).canonical_complexity`), undefined);
assert.strictEqual(run(`p._deriveContextualFlagsUpdate_({classification:{subIntents:{canonical_complexity:true}}}).canonical_complexity`), true);
run(`var oldEvidence = new Date(Date.now()-181*86400000).toISOString();
 var freshEvidence = new Date(Date.now()-86400000).toISOString();
 var row = ['t','it','information','standard','[]',new Date().toISOString(),1,1,'lutto',
   JSON.stringify({bereaved:true,_evidence:{bereaved:oldEvidence}})];
 var expired = m._rowToObject(row);`);
assert.strictEqual(run('expired.contextualFlags.bereaved'), false);
assert.strictEqual(run(`new PromptContext({memory:expired}).concerns.longitudinal_sensitivity`), false);
run(`row[9]=JSON.stringify({bereaved:true,_evidence:{bereaved:freshEvidence}}); var fresh=m._rowToObject(row);`);
assert.strictEqual(run('fresh.contextualFlags.bereaved'), true);
assert.strictEqual(run(`m._mergeContextualFlags_(fresh.contextualFlags, {bereaved:false})._evidence.bereaved`), false);
assert.strictEqual(run(`m._normalizeContextualFlags_({bereaved:false})._evidence.bereaved`), false);
assert.strictEqual(run(`m._normalizeContextualFlags_(m._serializeContextualFlagsForSheet(expired.contextualFlags))._evidence.bereaved`), false);
assert.strictEqual(run(`m._mergeContextualFlags_(fresh.contextualFlags, fresh.contextualFlags)._evidence.bereaved`), run('freshEvidence'));
assert.strictEqual(run(`p._deriveContextualFlagsUpdate_({existingFlags:fresh.contextualFlags})._evidence.bereaved`), run('freshEvidence'));
assert.strictEqual(run(`p._buildDuplicateReplyFingerprintContext_({getId:()=> 'm'}, {senderEmail:'user@example.org',subject:'Same',body:''})`), null);
assert.match(run(String.raw`g.extractMainReply('Domanda\nCordiali saluti\nNome\nP.S. Serve il modulo?')`), /Serve il modulo/);
assert.match(run(`g.extractMainReply('On the form I wrote: please help')`), /please help/);
assert.match(run(String.raw`g.extractMainReply('On 20 Sep user@example.org wrote:\n> old\n\nPosso passare domani?')`), /Posso passare domani/);
assert.strictEqual(run(`g._extractCurrentMessageBody_('', '<blockquote type="cite"><p>old</p></blockquote><p>Nuova richiesta?</p>')`), 'Nuova richiesta?');
assert.strictEqual(run(`g._extractCurrentMessageBody_('old', '<div class="gmail_quote">old</div>')`), '');
assert.strictEqual(run(`p._hasExplicitTimeExpectation('ho letto il modulo')`), false);
assert.strictEqual(run(`p._addTimeDiscrepancyNoteIfNeeded('Il corso inizia alle 18:00.',{body:'Pensavo alle 17:00'},'pl')`), 'Il corso inizia alle 18:00.');
assert.match(run(`p._addTimeDiscrepancyNoteIfNeeded('Il corso inizia alle 18:00.',{body:'Pensavo alle 17:00'},'it')`), /Nota:/);
assert.doesNotMatch(run(`p._addTimeDiscrepancyNoteIfNeeded('Il corso inizia alle 18:00.',{body:'Pensavo alle 18:00'},'it')`), /Nota:/);
props.set('PERSONAL_IGNORE_SENDERS', '[" blocked@example.org ", "BLOCKED@example.org"]');
assert.deepStrictEqual(Array.from(run('p._getPersonalIgnoreSenders_()')), ['blocked@example.org']);
assert.strictEqual(run(`p._shouldIgnoreEmail({senderEmail:'blocked@example.org'})`), true);
assert.strictEqual(run(`p._shouldIgnoreEmail({senderEmail:'allowed@example.org',body:'Richiesta orari'})`), false);
props.set('PERSONAL_IGNORE_SENDERS', '[broken');
assert.throws(() => run('p._getPersonalIgnoreSenders_()'), /PERSONAL_IGNORE_SENDERS/);
props.delete('PERSONAL_IGNORE_SENDERS');
run(`var limiter=Object.create(GeminiRateLimiter.prototype); limiter.props=PropertiesService.getScriptProperties();
 limiter.models={lite:{rpm:3,tpm:100}}; limiter.cache={};`);
props.set('rpm_window', '{bad');
assert.strictEqual(run(`limiter._getRequestsInWindow('rpm','lite')`), 3);
assert.strictEqual(run(`limiter._getRequestsInWindow('rpm','lite')`), 3);
props.set('rate_limit_corrupt_rpm_since', String(Date.now() - 61000));
assert.strictEqual(run(`limiter._getRequestsInWindow('rpm','lite')`), 0);
props.set('rpm_window', JSON.stringify([{modelKey:'lite',timestamp:Date.now(),nonce:'valid'}]));
assert.strictEqual(run(`limiter._getRequestsInWindow('rpm','lite')`), 1);
props.set('rate_limit_corrupt_rpm_since', String(Date.now()-120000));
run(`limiter._readWindowFromProperties('rpm')`);
props.set('rpm_window','{new corruption');
assert.strictEqual(run(`limiter._getRequestsInWindow('rpm','lite')`),3,'independent corruption needs a new quarantine');
run(`var sem = new SemanticValidator(); var lexical = {score:1,errors:[]};`);
assert.strictEqual(run(`sem.validateHallucinations('x','kb',lexical,'mail',{forceRelevanceReview:true}).isValid`), false);
assert.strictEqual(run(`sem.validateHallucinations('x','kb',lexical,'mail',{}).isValid`), true);
run(`sem.runtimeSemanticAvailable=true;sem._readCache=()=>null;sem._cacheKey=()=> 'test';
 sem._generateSemantic=()=>{throw new Error('offline outage')};`);
assert.strictEqual(run(`sem.validateHallucinations('x','kb',lexical,'mail',{forceRelevanceReview:true}).isValid`), false);

// Suspension: bounded cursor, cooldown, new pending message after handled backlog, unknown errors.
run(`var searches=0; var metadataReads=0; var pending=false;
 GmailService.prototype._getOptionalLabelIdByName=n=>'label-'+n;
 GmailService.prototype._getMessageMetadataWithResilience=id=>{metadataReads++;return {labelIds:id==='pending'?[]:['label-IA']}};
 GmailApp.search=(q,offset,limit)=>{searches++;return offset>=100 ? (pending?[{getMessages:()=>[{getId:()=> 'pending',getDate:()=>new Date(Date.now()-13*3600000),isUnread:()=>true}]}]:[]) :
 Array.from({length:limit},(_,i)=>({getMessages:()=>[{getId:()=> 'handled-'+(offset+i),getDate:()=>new Date(Date.now()-13*3600000),isUnread:()=>true}]}))};`);
cache.clear();
assert.strictEqual(run('hasStaleUnreadThreads()'), null);
assert.strictEqual(run('searches'), 4);
run('hasStaleUnreadThreads()');
assert.strictEqual(run('searches'), 4);
cache.delete('stale_scan_v2_12_100_7_all');
run('pending=true');
assert.strictEqual(run('hasStaleUnreadThreads()'), true);
cache.clear();
run(`GmailApp.search=()=>{throw new Error('offline')}`);
assert.strictEqual(run('hasStaleUnreadThreads()'), null);

// Full processor pipeline: normal send, accepted timeout, unresolved timeout, cache loss.
ctx.recordLabel = (id,label) => labels.push({id,label});
run(`var sendCalls=0, reconcileCalls=0, outcome='normal', capturedPrompt;
 var thread={getId:()=> 'audit-thread',getLabels:()=>[],getMessages:()=>[message]};
 var message={getId:()=> 'audit-message',getThread:()=>thread,getFrom:()=> 'user@example.org',
  getSubject:()=> 'Orari',getPlainBody:()=> 'Quali sono gli orari?',getDate:()=>new Date(),isUnread:()=>true};
 var processor=new EmailProcessor({
  gmailService:{_extractEmailAddress:raw=>raw,getMessageIdsWithLabel:()=>new Set(),
   extractMessageDetails:()=>({body:'Quali sono gli orari?',subject:'Orari',senderEmail:'user@example.org',senderName:'Utente',date:new Date(),headers:{}}),
   addLabelToMessage:recordLabel,addLabelToThread:()=>{},removeLabelFromThread:()=>{},removeLabelFromMessage:()=>{},
   getThreadHistory:()=>'',prepareOutboundText:t=>t,
   sendHtmlReply:()=>{sendCalls++;if(outcome!=='normal')throw new Error('network timeout')},
   reconcileSendOperation:()=>{reconcileCalls++;return outcome==='confirmed'}},
  classifier:{classifyEmail:()=>({shouldReply:true,category:'information',subIntents:{},confidence:1})},
  geminiService:{primaryKey:'mock',shouldRespondToEmail:()=>({shouldRespond:true,language:'it',classification:{topic:'orari'}}),
   buildGenerationStrategies:()=>({attemptStrategy:[{name:'mock',key:'mock',model:'offline'}]}),
   detectEmailLanguage:()=>({lang:'it'}),getAdaptiveGreeting:()=>({greeting:'Buongiorno',closing:'Saluti'}),
   getAdaptiveClosing:()=> 'Saluti',generateResponse:()=>({success:true,text:'La Messa è alle 18:00.'})},
  requestClassifier:{classify:()=>({type:'technical',dimensions:{pastoral:0}})},
  validator:{validateResponse:()=>({isValid:true,score:1,warnings:[],errors:[]})},
  memoryService:{getMemory:()=>({}),updateMemoryAtomic:()=>true},
  territoryValidator:{validateMultipleAddresses:()=>({addressFound:false,addresses:[],summary:''})},
  promptEngine:{buildPrompt:options=>{capturedPrompt=options;return 'mock prompt'}}
 });`);
for (const outcome of ['normal','confirmed','uncertain']) {
  props.clear(); cache.clear(); labels.length=0; notifications.length=0;
  props.set('VALIDATION_REVIEW_EMAIL','review@example.org');
  ctx.outcome=outcome;
  const result=run(`processor.processThread(thread,'Orario Messa: 18:00.','',new Set(),true)`);
  if (outcome==='uncertain') {
    assert.strictEqual(result.reason,'gmail_send_uncertain', JSON.stringify(result));
    assert.ok(props.has('send_uncertain_audit-message'));
    assert.ok(!props.has('sent_backup_audit-message'));
    assert.ok(labels.some(x=>x.label==='Verifica'));
    assert.ok(!labels.some(x=>x.label==='IA'));
    assert.strictEqual(notifications.length,1);
    const before=run('sendCalls'); cache.clear();
    const retry=run(`processor.processThread(thread,'Orario Messa: 18:00.','',new Set(),true)`);
    assert.strictEqual(retry.reason,'gmail_send_uncertain');
    assert.strictEqual(run('sendCalls'),before);
    assert.strictEqual(notifications.length,1,'review notification should be throttled');
  } else {
    assert.strictEqual(result.status,'replied',JSON.stringify(result));
    assert.ok(props.has('sent_backup_audit-message'));
    assert.ok(!props.has('send_uncertain_audit-message'));
    assert.ok(labels.some(x=>x.label==='IA'));
    assert.strictEqual(notifications.length,0);
  }
}
// Delivery delay and inter-message gap are distinct even when the user replied immediately.
props.clear(); cache.clear(); labels.length=0;
run(`outcome='normal';
 var oldDate=new Date(Date.now()-5*86400000);
 message.getDate=()=>new Date(oldDate.getTime()+60000);
 processor.gmailService.extractMessageDetails=()=>({body:'Quali sono gli orari?',subject:'Re: Orari',senderEmail:'user@example.org',date:message.getDate(),headers:{}});
 processor.memoryService.getMemory=()=>({exists:true,lastUpdated:oldDate.toISOString()});
 processor.processThread(thread,'Orario Messa: 18:00.','',new Set(),true);`);
assert.strictEqual(run('capturedPrompt.salutationMode'),'full');
props.clear(); cache.clear(); labels.length=0;
run(`var originalCommit=processor._commitSendTransaction;
 processor._commitSendTransaction=()=>{throw new Error('post-send storage failure')};
 var afterDelivery=processor.processThread(thread,'Orario Messa: 18:00.','',new Set(),true);
 processor._commitSendTransaction=originalCommit;`);
assert.strictEqual(run('afterDelivery.status'),'replied');
assert.ok(props.has('send_uncertain_audit-message'),'storage failure must preserve durable guard');
assert.strictEqual(run('capturedPrompt.responseDelay.shouldApologize'),true);
props.clear(); cache.clear();
run(`message.getDate=()=>new Date();processor.memoryService.getMemory=()=>({exists:true,lastUpdated:null});
 processor.processThread(thread,'Orario Messa: 18:00.','',new Set(),true);`);
assert.strictEqual(run('capturedPrompt.salutationMode'),'full');
run(`var own={getId:()=> 'own',getFrom:()=> 'bot@example.org',getDate:()=>new Date(Date.now()-60000)};
 var anchor=processor._getOwnConversationAnchor_([own,message],message,new Set(['bot@example.org']));`);
assert.strictEqual(run('anchor.lastMessageDate instanceof Date'),true);
assert.strictEqual(run(`computeSalutationMode({isReply:true,memoryExists:true,lastUpdated:anchor.lastMessageDate})`),'session');

// A mandatory semantic check cannot be skipped just because lexical confidence is high.
run(`var checks=0, forced=false;var validator=new ResponseValidator();
 validator.semanticValidator={shouldRun:()=>false,validateHallucinations:(r,k,l,e,o)=>{checks++;forced=o.forceRelevanceReview;return {isValid:false,confidence:0,reason:'offline mandatory review',fallback:true}},
 validateThinkingLeak:()=>({isValid:true,confidence:1})};
 var checked=validator.validateResponse('La dispensa è garantita. Per altri chiarimenti può contattare la segreteria.', 'it', 'La segreteria offre informazioni.', 'Posso sposarmi?', '', 'full');`);
assert.strictEqual(run('checks'),1);
assert.strictEqual(run('forced'),true);
assert.strictEqual(run('checked.isValid'),false);

// Unknown transport failures are ambiguous too: no native retry is allowed.
run(`var nativeAttempts=0;g._incrementGmailCallCounterOrThrow_=()=>{};
 var outgoing={getFrom:()=> 'user@example.org',getReplyTo:()=> '',reply:()=>{nativeAttempts++;throw new Error('unclassified transport failure')}};`);
assert.throws(()=>run(`g.sendHtmlReply(outgoing,'Test',{senderEmail:'user@example.org'})`), /ambiguo/);
assert.strictEqual(run('nativeAttempts'),1);

// The migration helper is offline and emits a local JSON file, never values to logs.
let exported, printed='';
const exportSource=fs.readFileSync(path.join(__dirname,'..','maintenance','export_legacy_blacklist.js'),'utf8');
vm.runInNewContext(exportSource, {__dirname:path.join(__dirname,'..','maintenance'),process:{argv:['node','helper']},
 console:{log:s=>{printed+=s}},require:name=>name==='fs'?{mkdirSync(){},writeFileSync:(_p,s)=>{exported=JSON.parse(s)}}:
 name==='child_process'?{execFileSync:()=> 'IGNORE_DOMAINS: ["blocked@example.org", "notifications.test"]'}:require(name)});
assert.deepStrictEqual(exported,['blocked@example.org']);
assert.ok(!printed.includes('blocked@example.org'));
console.log('Reliability audit regressions passed (offline Google mocks).');
