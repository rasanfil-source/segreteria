// Verifica locale dei contratti di classificazione, calendario, memoria e checkpoint.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ctx = vm.createContext({console: {log(){},warn(){},error(){},info(){}}, CONFIG: {}, GLOBAL_CACHE: {}});
require('./helpers/load_thread_components')(ctx);
for (const file of ['gas_classifier.js', 'gas_email_processor.js', 'gas_response_strategy.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ctx, {filename: file});
}
const run = code => vm.runInContext(code, ctx);
run('var c = new Classifier(); var p = Object.create(EmailProcessor.prototype); p.classifier = c; p._getPersonalIgnoreSenders_ = () => [];');
const c = ctx.c, p = ctx.p;
for (const subject of ['(no subject)', 'nessun oggetto', 'Messaggio', 'Saluti']) {
  for (const prefix of ['', 'Re: ']) assert.equal(c.classifyEmail(prefix + subject, '').shouldReply, false, prefix + subject);
}
for (const body of ['Re: domani?', 'Re: quando?', 'Re: quando？']) assert.equal(c.classifyEmail('Re: Grazie', body).shouldReply, true, body);
assert.equal(c._extractPriorCommunicationContact_('Contatto: il parroco'), 'il parroco');
assert.equal(c._extractPriorCommunicationContact_('Referente: la segretaria'), 'la segretaria');
for (const body of ['Contatto: email o telefono', 'Riferimento: nessuno']) assert.equal(c._extractPriorCommunicationContact_(body), null);
assert.equal(c.classifyEmail('Messaggio', '--\nCordiali saluti\nMario Rossi').reason, 'greeting_only');
for (const footer of ['Inviato dal mio iPhone', 'Inviato da Outlook per Android']) {
  assert.equal(c.classifyEmail('Re: Orari', 'Grazie\n\n' + footer).shouldReply, false);
}
assert.match(c._extractMainContent('> vecchia domanda\n¿A qué hora es la misa?'), /¿A qué/);
assert.match(c._extractMainContent('Cordiali saluti\nVengo domani mattina per ritirare il certificato.'), /Vengo domani/);
for (const subject of ['Re: Out of office', 'Re: Risposta automatica: Assenza']) {
  const body = 'Quando posso fissare un appuntamento?';
  assert.equal(c.classifyEmail(subject, body).shouldReply, true);
  assert.equal(p._shouldIgnoreEmail({senderEmail:'user@example.org', subject, body}), false);
}
assert.equal(p._shouldIgnoreEmail({senderEmail:'user@example.org', subject:'Incontro fuori sede', body:'Vorrei fissare un appuntamento'}), false);
assert.equal(p._shouldIgnoreEmail({senderEmail:'user@example.org', subject:'Informazioni', body:'Vorrei informazioni\n> do not reply to this email'}), false);
assert.equal(p._normalizeEmailAddress_('"Mario <Ufficio>" <mario@example.com>'), 'mario@example.com');
assert.equal(p._normalizeTextContent([]), '');
assert.equal(p._normalizeTextContent({}), '');
assert.equal(p._hasExplicitTimeExpectation('Mi risulta alle 10'), true);
assert.deepEqual(Array.from(p._extractTimes('15.00 euro, 15.00 €, entro 12h, alle 16h')), ['16:00']);
assert.equal(p._computeUserReaction('Grazie, chiarito ogni dubbio\n> A che ora?',['orari']).reaction, 'acknowledged');
assert.equal(p._computeUserReaction('> Grazie',['orari']), null);
for (const text of ['Non sono ricoverato in ospedale', 'Visito i malati in ospedale', "Non abito all'estero", 'Non vivo a Milano', 'Non assisto mia madre']) {
  const result = p._reconcilePhysicalPresenceConstraint_(null, '', text);
  assert.equal(result.has_constraint, false, text);
  assert.equal(result.visit_policy, 'unknown', text);
}
for (const text of ['Si, sono a Roma', 'Si figuri, adesso sono a Roma', 'Non sono a Roma; ora sono a Roma']) {
  assert.equal(p._detectCurrentLocalPresence_('', text).detected, true, text);
}
assert.equal(run(`p._reconcilePhysicalPresenceConstraint_(null, 'Sono guarito', '', {conversationState:{physicalPresenceState:{constraints:[{type:'health',status:'active',policy:'avoid_invitation'}]}}}).has_constraint`), false);
assert.equal(run(`p._resolveScheduleContext('Orari del 29 febbraio', '', new Date(2026, 0, 1)).yearInference`), 'next_valid_year_from_leap_day');
assert.equal(run(`p._resolveScheduleContext('Orari del 29 febbraio', '', new Date(2026, 0, 1)).mentionedDateInCurrentYear`), '');
assert.equal(run(`p._resolveScheduleContext('Orari del 29 febbraio scorso', '', new Date(2025, 5, 1)).yearInference`), 'previous_year_from_past_intent');
assert.equal(run(`p._resolveScheduleContext('Oggi vi scrivo per gli orari del 15 agosto', '', new Date(2026, 0, 1)).targetDate`), '2026-08-15');
for (const text of ['Nato il 12/05/2000', 'Nata il 12 maggio 2000', 'data di nascita: 12/05/2000', '12/05/100']) assert.equal(p._extractExplicitDateFromText_(text, 2026), null, text);
assert.equal(run(`p._extractSummerScheduleRange_('Dal 1 ottobre al 28 giugno orario invernale; dal 29 giugno al 30 settembre orario estivo', 2026).start.getMonth()`), 5);
run(`var candidate = {getId:()=> 'candidate',getDate:()=>new Date(2026,0,1)};
var own = {getId:()=> 'own', getFrom:()=> 'USER@example.org',getDate:()=>null};`);
assert.equal(run(`p._getOwnConversationAnchor_([candidate,own],candidate,['user@example.org']).exists`), false);
assert.equal(run(`p._getOwnConversationAnchor_([own,candidate],candidate,['USER@example.org']).exists`), true);
p.props = {getProperty(){throw Error('transient');}};
assert.equal(p._getSafetyValveReducedLimit_(3), null);
for (const initial of ['null', '[]', '42']) {
  let stored = initial;
  p._getProperties_ = () => ({getProperty:()=>stored,setProperty:(k,v)=>{stored=v;}});
  p._markValidationReviewAlertSent_('test');
  assert.equal(p._isValidationReviewAlertThrottled_('test'), true);
}
let checkpoint;
p._getProperties_ = () => ({getProperty:()=>null,setProperty:(k,v)=>{checkpoint=JSON.parse(v);}});
p._storeBatchCheckpointAndScheduleContinuation_(['old','a','a','b'].map(id=>({getId:()=>id})),1,5000);
assert.deepEqual(checkpoint.pendingThreadIds,['a','b']);
assert.equal(checkpoint.startIndex,0);
let released = 0;
p._getProperties_ = () => ({deleteProperty(){throw Error('transient');}});
p._persistSendIdempotencyBackup_ = ()=>{};
p._readSendIdempotencyBackup_ = ()=>true;
assert.doesNotThrow(()=>p._commitSendTransaction('id',{lock:{releaseLock(){released++;}}}));
assert.equal(released,1);
const validation = {errors:['riferimento papale non aggiornato'],details:{hallucinations:{hallucinations:{phones:['0612345678']}}}};
assert.equal(p._classifyValidationForRetry(validation,'it').hasDirectHallucination,true);
const correction = p._buildCorrectionPrompt('Istruzioni', 'Risposta errata', validation,'it','full');
assert.match(correction,/0612345678/);
assert.match(correction,/Papa/);
ctx.CONFIG.MEMORY_MAX_SUMMARY_BULLETS = 2;
assert.equal(p._buildMemorySummary({existingSummary:'uno\ndue\ntre'}),'due\ntre');
p._getBusinessDateString = ()=>'2026-10-03';
const sentence='La segreteria apre alle ore nove del mattino.';
const oldSummary='...• [2026-10-01] '+sentence;
assert.equal(p._buildMemorySummary({existingSummary:oldSummary,responseText:sentence}),oldSummary);
run(`var lifecycleProcessor = new EmailProcessor({geminiService:{}, classifier:c, validator:{}, gmailService:{}, props:{}, promptEngine:{}, memoryService:{}});`);
const lifecycleProcessor=ctx.lifecycleProcessor;
assert.equal(lifecycleProcessor.config.validationEnabled,true);
assert.equal(lifecycleProcessor.config.labelName,'IA');
let lifecycleReleased=0;
const oldLogger={};
lifecycleProcessor.geminiService.logger=oldLogger;
lifecycleProcessor._getLanguageProcessingMode_=()=> 'all';
lifecycleProcessor._acquireThreadLock=()=>({ok:true,acquired:true,key:'thread'});
lifecycleProcessor._releaseThreadLock=()=>{lifecycleReleased++;};
lifecycleProcessor._classifyError=()=>({type:'SYSTEM_ERROR',retryable:true});
const originalCreate=ctx.ThreadMessageState.create;
ctx.ThreadMessageState.create=()=>{throw Error('state initialization failed');};
const failedThread=lifecycleProcessor.processThread({getId:()=> 'thread'},'KB','');
assert.equal(failedThread.status,'error');
assert.equal(lifecycleReleased,1);
assert.equal(lifecycleProcessor.geminiService.logger,oldLogger);
ctx.ThreadMessageState.create=originalCreate;
for (const filename of ['gas_config.js','gas_config.example.js']) {
  const configCtx=vm.createContext({console:ctx.console,PropertiesService:{getScriptProperties:()=>null}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..',filename),'utf8'),configCtx);
  assert.equal(vm.runInContext('_getScriptProperty("missing")',configCtx),null);
}
console.log('PASS consolidated report regressions');
