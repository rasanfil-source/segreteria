const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({console: {log(){},warn(){},error(){}}, CONFIG: {}});
for (const file of ['gas_thread_policy.js','gas_request_classifier.js','gas_response_validator.js',
  'gas_gmail_service.js','gas_email_processor.js','gas_thread_documents.js','gas_classifier.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx,{filename:file});
}
function closure(body, hasAttachments=false) {
  const candidate = {getId:()=> 'new'};
  let detected;
  ctx.ThreadPolicy.automaticReplies({
    gmailService: {_extractEmailAddress:x=>x}, _normalizeEmailAddress_:x=>x,
    _evaluatePreAiRules_:x=>x,
    _applyPreAiRuleDecision_(decision) {
      if ('isShortClosureReply' in decision) detected = decision.isShortClosureReply;
      return false;
    }
  }, {messageDetails:{body,hasAttachments,date:new Date('2026-10-01T10:01:00Z')},
    buildRuleContext:x=>x,result:{},messages:[{getId:()=> 'old',getFrom:()=> 'office@example.org',getDate:()=>new Date('2026-10-01T10:00:00Z')},candidate],
    messageState:{candidate},ownAddresses:new Set(['office@example.org'])});
  return detected;
}
for (const body of ['Non ho ricevuto nulla',"Non ho ricevuto l'allegato",'In allegato, grazie','Ok vengo alle 17','Ok passo domani']) assert.equal(closure(body),false,body);
assert.equal(closure('Grazie',true),false);
assert.equal(closure('Ecco, grazie',true),false);
assert.equal(closure('Perfetto, grazie'),true);

const r = new ctx.RequestTypeClassifier();
assert.match(r._sanitizeText('', '> Vecchia domanda\nVorrei sapere che documenti servono'), /Vorrei sapere/);
assert.doesNotMatch(r._sanitizeText('', 'Domanda\nOn Monday wrote:\nVorrei apostatare'), /apostatare/);
for(const body of ['Per uscire dalla chiesa con la carrozzina dopo la messa c’è una rampa?', 'Vorrei uscire dalla chiesa dopo la messa']) {
  assert.notEqual(r.classify('',body).isSbattezzo,true,body);
  assert.equal(r._externalHintIndicatesSbattezzo_({topic:body}),false,body);
}
assert.equal(r.classify('','Vorrei uscire dalla chiesa cattolica').isSbattezzo,true);
assert.equal(r._externalHintIndicatesSbattezzo_({topic:'Vorrei uscire dalla chiesa cattolica'}),true);
assert.equal(r.classify('','> Testo precedente\nVorrei apostatare').isSbattezzo,true);

const v = new ctx.ResponseValidator();
const reference = vm.runInContext("new Date('2026-10-01T12:00:00Z')",ctx);
for(const text of ['alle 09.10','10.05','15/04/85','15/04/1885']) assert.equal(v._extractExplicitDates_(text,reference).length,0,text);
for(const text of ['15/04/1985','15.04.1985','1985-04-15','15 aprile 1985','April 15, 1985']) {
  const dates = v._extractExplicitDates_(text,reference);
  assert.equal(dates.length,1,text);
  assert.equal(dates[0].date.getFullYear(),1985,text);
  assert.equal(dates[0].hasExplicitYear,true,text);
}
for(const text of ['il 10.12','del 15.05','15/04']) assert.equal(v._extractExplicitDates_(text,reference).length,1,text);
assert.equal(v._checkHallucinations('Nato il 15 aprile 1985.', 'Nato il 15/04/1985.', '', {currentDate:'2026-10-01'}).errors.length,0);
assert.equal(v._checkHallucinations('La messa è alle 09.10.', 'Messa ore 09:10.', '', {currentDate:'2026-10-01'}).errors.length,0);
const language = v._checkLanguage('Dear reader, this message mentions parrocchia.', 'it');
assert.ok(!language.warnings.includes('Possibile lingua mista IT/EN'));

const g = Object.create(ctx.GmailService.prototype);
const quoted = 'Domanda attuale\nOn Monday, office@example.org wrote:\nVecchia risposta\nP.S. STORICO DA ESCLUDERE';
assert.doesNotMatch(g.extractMainReply(quoted),/STORICO/);
assert.doesNotMatch(g._extractCurrentMessageBody_('', '<p>Domanda attuale</p><div id="divRplyFwdMsg">Vecchio</div><p>P.S. STORICO DA ESCLUDERE</p>'),/STORICO/);
assert.match(g.extractMainReply('Domanda\nCordiali saluti\nMario\nP.S. ATTUALE DA PRESERVARE'),/ATTUALE DA PRESERVARE/);

const p = Object.create(ctx.EmailProcessor.prototype);
for(const ending of ['sbattezzo','uscire dalla chiesa cattolica']) {
  const classification = {category:'document_submission'};
  const requestType = {type:'technical'};
  const result = ctx.ThreadDocuments.interpret({
    _detectDocumentRequestWithSupportingData_:()=>({detected:false}),
    _buildDocumentDeliveryModel_:()=>({status:'received_attachment',expectsDocument:true,hasDocumentContentAvailable:true}),
    _resolveRequestPurpose_:()=>({type:'status_update',confidence:0.9,source:'quick_check_model'}),
    _detectIndirectSbattezzoRequest_:p._detectIndirectSbattezzoRequest_.bind(p)
  }, {messageDetails:{subject:'Documento',body:'In allegato invio copia del documento per '+ending},
    physicalAttachmentsDetected:true,forceReceiptOnlyForSubmission:true,
    categoryHintSource:'document_submission',classification,requestType,quickCheck:{classification:{}},
    attachmentIntentContext:{intent:'document_submission'}});
  assert.equal(result.categoryHintSource,'formal');
  assert.equal(result.forceReceiptOnlyForSubmission,false);
  assert.equal(requestType.isSbattezzo,true);
}
assert.equal(new ctx.Classifier().classifyEmail('Re: Richiesta di sbattezzo','Buongiorno,\ngrazie mille!\nCordiali saluti',true).shouldReply,false);
console.log('Closure, quote, date and formal routing audit passed');
