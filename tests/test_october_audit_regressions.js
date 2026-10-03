const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ctx=vm.createContext({console:{log(){},warn(){},error(){}},CONFIG:{}});
for(const file of ['gas_classifier.js','gas_email_processor.js','gas_gmail_service.js','gas_territory_validator.js','gas_prompt_context.js','gas_prompt_engine.js','gas_thread_completion.js','gas_error_types.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx,{filename:file});
const c=new ctx.Classifier(), p=Object.create(ctx.EmailProcessor.prototype), t=new ctx.TerritoryValidator();
for(const text of ['Non ho ricevuto',"Non l'ho ricevuto",'Nulla ricevuto','Niente ricevuto','Non è ok','Ok？']) assert.equal(c.classifyEmail('Re: Informazioni',text,true).shouldReply,true,text);
for(const text of ['Grazie','Ok','Perfetto grazie']) assert.equal(c._isUltraSimpleAcknowledgment(text),true,text);
assert.equal(c._isGreetingOnly('Ciao？'),false);
assert.equal(c._extractMainContent('Good morning\nQuando posso venire?'),'Quando posso venire?');
for(const text of ['Sarò fuori Roma ad agosto, possiamo fissare un appuntamento?', 'Sono in ferie e vorrei sapere gli orari','Assenza per malattia: posso rimandare?']) assert.equal(c._isOutOfOfficeAutoReply('',text),false,text);
assert.equal(c._isOutOfOfficeAutoReply('Risposta automatica','Sono assente'),true);
assert.equal(c._isOutOfOfficeAutoReply('', 'Vorrei gli orari\nOn Monday Mario wrote:\n> Out of office'),false);
for(const text of ['Le invio il certificato di battesimo','Invio il certificato di battesimo']) assert.equal(p._deriveAttachmentIntentContext_(text,'',[],'').intent,'suspected_submission');
for(const text of ['Vi mando il modulo: se può andare bene','Vi mando il modulo: se può andare bene'.normalize('NFD')]) assert.equal(p._deriveAttachmentIntentContext_(text,'',[],'').hasQuestions,true);
assert.equal(p._isTerritoryRequest('','al mio rientro dalle ferie'),false);
assert.equal(p._isTerritoryRequest('','La mia via rientra nel territorio?'),true);
for(const street of ['via Gramsci','via ignota']) {
 assert.equal(t.verifyAddress(street,10).inTerritory,null);
 assert.equal(t.verifyStreetWithoutCivic(street).inParish,null);
}
assert.equal(t.verifyAddress('piazza della marina',23).inTerritory,false);
assert.equal(t.verifyAddress('via antonio gramsci',10).inTerritory,true);
const unknown=t.analyzeEmailForAddress('Abito in via Gramsci 10','');
assert.equal(unknown.addresses[0].verification.inParish,null);
const engine=Object.create(ctx.PromptEngine.prototype);
assert(!engine._renderTerritoryVerification('VERIFICA MANUALE NECESSARIA').includes('È ASSOLUTAMENTE VIETATO'));
for(const url of ['https://www.youtube.com/@canale','https://example.com/a%23b%3Fc%26d','https://example.com/modulo%20iscrizione.pdf']) assert.equal(ctx.sanitizeUrl(url),url);
for(const url of ['https://user@example.com/','http://127.0.0.1/','javascript:alert(1)','http://example.com%2f@127.0.0.1/','http://example.com\\@127.0.0.1/']) assert.equal(ctx.sanitizeUrl(url),null);
const pc=Object.create(ctx.PromptContext.prototype);
assert.equal(pc._detectMultiQuestion('Validità e accessibilità?',''),true);
assert.equal(pc._detectMultiQuestion('Validità e accessibilità?'.normalize('NFD'),''),true);
assert.equal(Object.create(ctx.GmailService.prototype)._htmlToPlainText('<style>'+'x'.repeat(6000)+'</style><p>Buongiorno</p>').trim(),'Buongiorno');
const removed=[];
ctx.ThreadCompletion.labels({config:{errorLabelName:'Errore',validationErrorLabel:'Verifica'},gmailService:{removeLabelFromThread(){throw Error('thread cleanup forbidden');},removeLabelFromMessage(id,label){removed.push([id,label]);}}},{messageState:{candidate:{getId:()=> 'current'},responseContextMessages:[{getId:()=> 'current'}]},shouldLabelForReview:false,hasDocumentMismatch:false});
assert.deepEqual(removed,[['current','Errore'],['current','Verifica']]);
p.geminiService={rateLimiter:{_getNextResetTime:()=>new Date(Date.now()+3600000).toISOString()}};
assert(p._getQuotaCheckpointDelayMs_({reason:'rpd_exhausted'})<3700000);
assert.equal(p._getQuotaCheckpointDelayMs_({error:'GMAIL_DAILY_CALL_LIMIT_REACHED'}),-1);
console.log('October audit regressions passed');
for(const file of ['gas_response_validator.js','gas_thread_generation.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx,{filename:file});
const validator=new ctx.ResponseValidator();
assert.equal(validator._checkHallucinations('Visita https://example.org/falso','Info https://example.org/vero').score,0);
assert.equal(validator._checkHallucinations('Visita https://example.org/vero','Info https://example.org/vero').errors.length,0);
assert.equal(ctx.filterDocumentAttachments_([{getName:()=> 'logo.png',getContentType:()=> 'image/png'},{getName:()=> 'foto.png',getContentType:()=> 'image/png'}]).length,1);
for(const code of ['TRUNCATED_OUTPUT','NETWORK']) {
 const result={}, marks=[]; let attempts=0;
 const error=Object.assign(new Error(code),{code,isTransient:true});
 ctx.ThreadGeneration.generate({config:{},_isNearDeadline:()=>false,_buildGenerationStrategies_:()=>({attemptStrategy:[{name:'first',key:'mock'},{name:'second',key:'mock'}]}),_classifyError:ctx.classifyError,geminiService:{generateResponse(){attempts++;throw error;}}},{result,messageDetails:{},markFailureForCurrentBurst:(...args)=>marks.push(args)});
 assert.equal(attempts,2);
 assert.equal(marks.length,code==='TRUNCATED_OUTPUT'?1:0);
 assert.equal(result.retryable,code!=='TRUNCATED_OUTPUT');
}

for(const file of ['gas_thread_lifecycle.js','gas_thread_delivery.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx,{filename:file});
// Test ThreadLifecycle.handleError con string error
const lifecycleResult = ctx.ThreadLifecycle.handleError({_classifyError:ctx.classifyError}, {
  threadLogger: { error(){}, warn(){} },
  error: '403 Forbidden',
  delivery: { confirmed: false },
  messageState: { markFailureForCurrentBurst(){} },
  result: {},
  startTime: Date.now()
});
assert.equal(lifecycleResult.errorClass, 'SYSTEM_ERROR');
assert.equal(lifecycleResult.error, '403 Forbidden');

for (const confirmed of [false, true]) {
  for (const [error, expectedText] of [
    ['403 Forbidden', '403 Forbidden'],
    [null, 'Errore non specificato'],
    [undefined, 'Errore non specificato'],
    [new Error('storage failed'), 'storage failed'],
    [{status:403, detail:'denied'}, '{"status":403,"detail":"denied"}'],
    [0, '0']
  ]) {
    const logs = [], marks = [];
    const result = ctx.ThreadLifecycle.handleError({_classifyError:ctx.classifyError}, {
      threadLogger: {error:(text)=>logs.push(text),warn:(text)=>logs.push(text)},
      error, delivery:{confirmed}, result:{}, startTime:Date.now(),
      messageState:{
        markHandledUnreadOnce(){throw 'label unavailable';},
        markFailureForCurrentBurst(){marks.push('error'); throw null;}
      }
    });
    assert(logs[0].includes(expectedText));
    if(confirmed) {
      assert.equal(result.status,'replied');
      assert.equal(result.warning,'post_send_error: '+expectedText);
      assert.equal(marks.length,0);
      assert(logs.some(text=>text.includes('label unavailable')));
    } else {
      assert.equal(result.error,expectedText);
      if(expectedText.includes('403')) {
        assert.equal(result.errorClass,'SYSTEM_ERROR');
        assert.equal(marks.length,0);
      }
    }
  }
}

// Test ThreadDelivery.send con responseContextMessages vuoto/non definito
let txnRollbackCalled = false;
ctx.ThreadDelivery.send({
  config: { dryRun: false },
  _beginSendTransaction: () => ({ ok: true }),
  _rollbackSendTransaction: () => { txnRollbackCalled = true; },
  _classifyError: () => ({ type: 'FATAL', retryable: false }),
  gmailService: { sendHtmlReply() { throw new Error('invalid recipient'); } }
}, {
  response: 'test',
  result: {},
  startTime: Date.now(),
  threadLogger: { info(){}, warn(){}, error(){} },
  messageState: { candidate: { getId: () => 'cand-1' }, responseContextMessages: null, markFailureForCurrentBurst(){} },
  skipLock: false,
  messageDetails: { subject: 'test' },
  delivery: {},
  duplicateReplyFingerprintContext: {},
  threadId: 't1',
  usedLookbackAttachments: false
});
assert.equal(txnRollbackCalled, true);

// Verifica il percorso di invio incerto e la conservazione dello stato della transazione.
for(const propsPresent of [true,false]) for(const messages of [null,undefined,[]]) {
  const writes=[], marks=[], result={};
  ctx.ThreadDelivery.send({config:{dryRun:false},_beginSendTransaction:()=>({ok:true}),
    _rollbackSendTransaction(){assert.fail('uncertain send must not roll back');},
    _classifyError:()=>({type:'NETWORK',retryable:true}),
    props:propsPresent?{setProperty:(key)=>writes.push(key)}:null,
    gmailService:{sendHtmlReply(){throw Error('timeout');},reconcileSendOperation:()=>false}
  },{response:'test',result,startTime:Date.now(),threadLogger:{info(){},warn(){},error(){}},
    messageState:{candidate:{getId:()=> 'candidate'},responseContextMessages:messages,
      markFailureForCurrentBurst:(kind)=>marks.push(kind)},
    messageDetails:{subject:'test'},delivery:{},threadId:'thread'});
  assert.equal(result.reason,'gmail_send_uncertain');
  assert.equal(result.status,'validation_failed');
  assert.deepEqual(marks,['validation']);
  assert.deepEqual(writes,propsPresent?['send_uncertain_candidate']:[]);
}

