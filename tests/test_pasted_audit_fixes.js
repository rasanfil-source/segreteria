// Verifica locale di allegati e criteri di risposta, con servizi remoti simulati.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({ console: {log(){},warn(){},error(){},info(){}}, CONFIG: {}, GLOBAL_CACHE: {} });
for (const file of ['gas_classifier.js','gas_email_processor.js','gas_gmail_service.js','gas_territory_validator.js',
  'gas_response_strategy.js','gas_prompt_context.js','gas_gemini_service.js','gas_response_validator.js','gas_thread_policy.js','gas_thread_documents.js','gas_error_types.js']) {
  const filename = path.join(__dirname, '..', file);
  vm.runInContext(fs.readFileSync(filename, 'utf8'), ctx, {filename});
}
const c = new ctx.Classifier();
const p = Object.create(ctx.EmailProcessor.prototype);
const gmail = Object.create(ctx.GmailService.prototype);
assert.equal(c._extractMainContent('> vecchio testo\nBuongiorno,\n- a che ora aprite?'), '- a che ora aprite?');
assert.equal(c._extractMainContent('Da: Mario <mario@example.org>\n\nBuongiorno\n  corpo storico\n> citazione\nTesto vecchio'), '');
assert.equal(c.classifyEmail('Re: Informazioni', 'Grazie\nCordiali saluti,\nMario Rossi\nInviato da iPhone', true).shouldReply, false);
assert.match(c._extractMainContent('Grazie\nCordiali saluti\nMario Rossi\nAh dimenticavo: serve il certificato?\nInviato da iPhone'), /serve il certificato/);
for (const greeting of ['- Cordiali saluti', '! Buongiorno']) assert.equal(c._isGreetingOnly(greeting), true);
assert.equal(p._deriveContextualFlagsUpdate_({classification:{category:'formal'}}).canonical_complexity, true);
p._getBusinessDateString = () => '2026-10-01';
for (const responseText of ['Gentile Mario,\nLa segreteria è aperta dalle 9.00 alle 12.00.\nCordiali saluti,',
  '<p>Gentile Mario,</p><p>La segreteria è aperta dalle 9.00 alle 12.00.</p>',
  'Buongiorno, la segreteria è aperta dalle 9.00 alle 12.00.']) {
  const summary = p._buildMemorySummary({responseText});
  assert.match(summary, /segreteria è aperta dalle 9\.00 alle 12\.00/);
  assert.doesNotMatch(summary, /Gentile Mario|Cordiali saluti/);
}
const values = new Map();
const props = {getProperty:k=>values.get(k)||null, setProperty:(k,v)=>values.set(k,v), deleteProperty:k=>values.delete(k)};
p._getProperties_ = () => props;
values.set('PERSONAL_IGNORE_SENDERS', 'invalid');
assert.throws(()=>p._getPersonalIgnoreSenders_(), /CONFIG_ERROR:/);
try { p._getPersonalIgnoreSenders_(); } catch(e) { assert.equal(p._classifyError(e).type, 'CONFIG_ERROR'); }
values.delete('PERSONAL_IGNORE_SENDERS');
ctx.GLOBAL_CACHE.ignoreDomains = ['mario.rossi@googlemail.com'];
assert.equal(p._shouldIgnoreEmail({senderEmail:'mariorossi@gmail.com',subject:'',body:''}), true);
ctx.GLOBAL_CACHE.validationReviewEmail = 'YOUR_EMAIL@example.com';
values.set('VALIDATION_REVIEW_EMAIL','N/D');
assert.equal(p._getValidationReviewRecipient_({email:'review@example.org'}), 'review@example.org');
for (const failOn of [1,2]) {
  let calls = 0, released = 0;
  const cache = new Map();
  ctx.CacheService = {getScriptCache:()=>({get:k=>cache.get(k),put(k,v){cache.set(k,v); if(++calls===failOn) throw Error('cache unavailable');}, remove:k=>cache.delete(k)})};
  ctx.LockService = {getScriptLock:()=>({tryLock:()=>true,releaseLock(){released++;}})};
  p._readSendIdempotencyBackup_ = () => null;
  assert.throws(()=>p._beginSendTransaction('m1'), /cache unavailable/);
  assert.equal(values.has('send_uncertain_m1'), false);
  assert.equal(cache.size, 0);
  assert.equal(released, 1);
}
for (const body of ['Senza dubbio, grazie!', 'Non ho alcun dubbio, tutto chiaro', 'Non ho dubbi, grazie']) {
  assert.equal(p._computeUserReaction(body,['orari_messe']).reaction, 'acknowledged');
}
assert.equal(p._computeUserReaction('Senza dubbio va bene, ma ho un dubbio',['orari_messe']).reaction, 'questioned');
assert.equal(p._computeUserReaction('Ho alcun dubbio',['orari_messe']).reaction, 'questioned');
assert.equal(c._isUltraSimpleAcknowledgment('Grazie, voglio morire'), false);
assert.equal(c.classifyEmail('Re: Informazioni', 'Grazie, voglio morire', true).shouldReply, true);
const territory = new ctx.TerritoryValidator();
for (const text of ['Il percorso di Cresima', 'Sono Silvia Rossi', 'Livia Rossi', 'Olivia Rossi', 'Pavia centro', 'via email', 'per via di un problema', 'corso Cresima', 'Scriviamo via fax', 'Ho letto di via Inventata']) {
  assert.equal(territory.extractStreetOnlyFromText(text), null, text);
}
assert.match(territory.extractStreetOnlyFromText('Abito in via Antonio Gramsci')[0], /Gramsci/);
const plain = gmail._htmlToPlainText('<!DOCTYPE html><html><body><ul><li>Uno</li><li>Due</li></ul></body></html>');
assert.doesNotMatch(plain, /DOCTYPE/); assert.match(plain, /Uno\s*\n\s*Due/);
assert.match(gmail.extractMainReply('Richiesta\nCordiali saluti\nMario\nAh, dimenticavo: serve il certificato?'), /serve il certificato/);
const v = new ctx.ResponseValidator();
for (const [text,lang] of [['Good morning,\n\nIn reply to your message','en'],['Buenos días,\n\nEl horario es','es']]) {
  assert.equal(v._ottimizzaCapitalAfterComma(text,lang), text);
}
assert(!p._detectProvidedTopics('Le promesse sono ammesse alle 18.30. Il percorso termina nel 2026.').includes('orari_messe'));
assert(!p._detectProvidedTopics('Il percorso termina nel 2026.').includes('indirizzo'));
const policy = ctx.EmailQuickCheckPolicy;
for (const body of ['Vorrei frequentare il corso, a che ora inizia?', 'Se vengo in segreteria posso ritirare il certificato?', 'Chiedo informazioni sui documenti']) {
  assert.equal(policy.resolveRequestPurpose('information_request',0.99,'',body).type, 'information_request');
}
assert.equal(policy.normalizeDecisionData({reply_needed:false},{lang:'it'},{intent:'document_submission'}).shouldRespond,false);
assert.throws(()=>policy.normalizeApiResponse(JSON.stringify({candidates:[{finishReason:'MAX_TOKENS',content:{parts:[{text:'{"reply_needed":true'}]}}]}),{lang:'it'}), /MAX_TOKENS/);
const service = Object.create(ctx.GeminiService.prototype);
service.config = {MAX_OUTPUT_TOKENS:100};
const budgets = [];
service._generateResponseAttempt_ = (_prompt, options) => { budgets.push(options.generationConfigOverrides?.maxOutputTokens || 100); throw Object.assign(Error('truncated'),{code:'TRUNCATED_OUTPUT'}); };
assert.throws(()=>service.generateResponse('test'), /truncated/);
assert.deepEqual(budgets, [100,200]);
assert.equal(service._isPrimaryKeyFallbackHttpError_(400,'feature disabled for this request'),false);
assert.equal(service._isPrimaryKeyFallbackHttpError_(400,'API_KEY_INVALID'),true);
const semantic = Object.create(ctx.SemanticValidator.prototype);
assert.match(semantic._buildHallucinationPrompt('risposta','K'.repeat(50000)+'FATTO_IN_CODA','domanda'), /FATTO_IN_CODA/);
gmail._incrementGmailCallCounterOrThrow_ = () => {};
ctx.Gmail = {Users:{Messages:{list:()=>({messages:[]})},Threads:{get:()=>({messages:[{labelIds:['SENT'],payload:{headers:[{name:'X-Parish-Reply-Operation',value:'reply_m1'}]}}]})}}};
assert.equal(gmail.reconcileSendOperation('reply_m1','thread1'),true);
assert.equal(gmail.reconcileSendOperation('reply_m2','thread1'),false);
// Una risposta breve in lingua incerta arriva al quick check in foreign_only.
for (const body of ['What time is Mass on Sunday?', 'Is there Mass tomorrow?']) {
  let skipped = false;
  const decision = ctx.ThreadPolicy.languageAndNewsletter({classifier:c,config:{},
    geminiService:{detectEmailLanguage:()=>({lang:'it',safetyGrade:1})},
    _normalizeLanguageCode_:x=>x,_markMessagesAsSkipped(){skipped=true;}},
    {messageDetails:{body,subject:''},languageMode:'foreign_only',result:{}});
  assert.notEqual(decision.terminal,true); assert.equal(skipped,false);
}
const now = new Date();
const previous = {getId:()=> 'old',getFrom:()=> 'bot@example.org',getDate:()=>new Date(now.getTime()-60000)};
const candidate = {getId:()=> 'new'};
let closure = false;
ctx.ThreadPolicy.automaticReplies({gmailService:{_extractEmailAddress:x=>x},_normalizeEmailAddress_:x=>x,
  _evaluatePreAiRules_:x=>{closure ||= x.isShortClosureReply === true;return x;},_applyPreAiRuleDecision_:()=>false},
  {messageDetails:{body:'Grazie, voglio morire',subject:'Re: Informazioni',date:now},buildRuleContext:x=>x,result:{},
    messages:[previous,candidate],messageState:{candidate},ownAddresses:new Set(['bot@example.org'])});
assert.equal(closure,false);
for (const consistent of [true,false,null]) {
  const model = {expectsDocument:true,hasAttachmentContent:true,status:'received_attachment'};
  const outcome = ctx.ThreadDocuments.assessConsistency({config:{documentConsistencyCheckEnabled:true},
    _evaluateDocumentConsistency_:()=>({mode:'unknown_received'}),
    _evaluateAttachmentSemanticConsistency_:()=>({consistent})},
    {documentDeliveryModel:model,messageDetails:{},physicalAttachmentsDetected:true,attachmentItems:[{}],
      attachmentIntentContext:{intent:'document_submission'}});
  assert.equal(outcome.hasRiskyUnknownReceived,consistent!==true);
  assert.equal(outcome.hasDocumentMismatch,consistent===false);
}
gmail._extractCurrentMessageBody_ = x => x;
gmail._getMessageMetadataWithResilience = () => {throw Error('metadata unavailable');};
assert.throws(()=>gmail.extractMessageDetails({getSubject:()=>'',getFrom:()=>'',getDate:()=>now,
  getPlainBody:()=>'',getBody:()=>'',getId:()=> 'm'}), e=>e.isTransient===true);
const {runScenario} = require('./helpers/thread_scenario');
for (const language of ['pl','tl','uk','ro']) {
  const output = runScenario(path.resolve(__dirname,'..'), {language,quickLanguage:language,attachment:true,
    body:'Invio in allegato la scheda compilata.',ocr:'Scheda iscrizione catechismo Nome: Mario Cognome: Rossi',
    quick:{request_purpose:'status_update',request_purpose_confidence:0.99,
      document_delivery:{expected_document:true,delivery_channel:'attachment',requires_file_attachment:true}}});
  assert(output.effects.some(([event])=>event==='generate'),language);
  assert(output.effects.some(([event])=>event==='validate'),language);
}
console.log('Pasted audit regression cases passed');
