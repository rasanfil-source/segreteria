const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const { runScenario } = require('./helpers/thread_scenario');
let count = 0;
function test(name, fn) { try { fn(); count++; } catch (error) { throw new Error(name, {cause:error}); } }
const request = {id:'r1', need:'documenti necessari', evidence:'Quali documenti servono?', role:'primary'};
const body = 'Quali documenti servono?';
const kb = 'Il documento non si invia via email.';
function setup(mode = 'enforce', extra = {}) {
  const values = new Map();
  const c = vm.createContext({console:{log(){},warn(){},error(){}}, UrlFetchApp:{},
    CONFIG:{SEMANTIC_VALIDATION:{enabled:true,completenessAlways:true,completenessMode:mode,...extra}},
    CacheService:{getScriptCache:()=>({get:key=>values.get(key),put:(key,value)=>values.set(key,value)})}});
  for (const file of ['gas_response_strategy.js','gas_response_validator.js','gas_email_processor.js','gas_gemini_service.js']) {
    vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),c,{filename:path.join(root,file)});
  }
  return {c,s:new c.SemanticValidator(),v:new c.ResponseValidator(),values};
}
function payload(status = 'addressed', changes = {}) {
  return {isValid:status!=='missing',confidence:0.95,hallucinations:{unsupportedClaims:[]},irrelevantDetails:[],
    coverage:{evaluated:true,purpose:'informational',goal:'ottenere documenti',
      requests:[{...request,status,reason:'motivazione della valutazione',sourceRef:kb}],
      additionalRequests:[],unsupportedExtractedRequests:[],undeterminableReason:null},...changes};
}
function options(changes = {}) { return {coverageRequired:true,requestCoverage:{goal:'documenti',openRequests:[request]},
  groundingParts:{subject:'Informazioni',body,history:''},...changes}; }
function parse(s,p,opts=options(),knowledge=kb) {
  return s._parseSemanticResponse(JSON.stringify(p),{coverageRequired:true,
    coverageContext:s._prepareCoverageContext_('',opts),knowledgeBase:knowledge});
}
for (const status of ['addressed','not_applicable','explicit_limit_info','explicit_limit_service','missing','undeterminable']) {
  test('stato '+status,()=>{
    const {s}=setup(); const out=parse(s,payload(status));
    assert.equal(out.coverage.requests[0].status,status);
    assert.equal(out.coverageState,status==='missing'?'missing':status==='undeterminable'?'undeterminable':'complete');
    assert.equal(out.contentValid,true);
  });
}
test('limite senza fonte contro limite informativo',()=>{
  const {s}=setup();
  const out=parse(s,payload('explicit_limit_service'),options(),'Nessuna procedura indicata.');
  assert.equal(out.coverageState,'missing'); assert.equal(out.contentValid,false);
  assert.equal(out.details.unsupportedClaims.length,1);
  assert.equal(parse(s,payload('explicit_limit_info'),options(),'Nessuna procedura indicata.').isValid,true);
});
test('prompt distingue divieti espliciti e richieste condizionali',()=>{
  const {s}=setup();
  const opts=options({requestCoverage:{goal:'ottenere documenti',openRequests:[
    {...request,role:'conditional',appliesWhen:'solo se l’invio email non basta'}
  ]}});
  const context=s._prepareCoverageContext_(body,opts);
  const prompt=s._buildHallucinationPrompt('Risposta',kb,body,'informational',opts.groundingParts,context);
  assert.ok(prompt.includes('la KB nega esplicitamente proprio quel servizio o canale'));
  assert.ok(prompt.includes('not_applicable vale solo se appliesWhen è falsa'));
  assert.ok(prompt.includes('quando è falsa assegna not_applicable anche se la risposta non ripete il ripiego'));
  assert.ok(prompt.includes('Se appliesWhen è vera, valutala come primaria'));
  assert.ok(prompt.includes('unsupportedClaims riguarda solo fatti senza riscontro o contrari alle fonti'));
  assert.ok(prompt.includes('mai il semplice fatto che non siano richiesti'));
  assert.ok(prompt.includes('un limite su scadenza o tempi non copre il diverso bisogno'));
  assert.ok(prompt.includes('explicit_limit_info solo alla richiesta del dato mancante'));
  assert.ok(prompt.includes('è explicit_limit_info, non un fatto infondato'));
  assert.ok(prompt.includes('per esempio se il certificato sarà pronto entro venerdì'));
  assert.ok(prompt.includes("non richiedere una frase della KB che autorizzi l'incertezza"));
  assert.ok(prompt.includes('Scomponi le frasi composte'));
  assert.ok(prompt.includes('non inserirle in unsupportedClaims o irrelevantDetails'));
  assert.ok(prompt.includes('mantienila solo in irrelevantDetails anche quando descrive più fatti'));
  assert.ok(prompt.includes('orari parziali e silenzio non bastano a provare una chiusura o un divieto'));
  assert.ok(prompt.includes('Ogni request deve avere reason non vuota e specifica'));
  assert.ok(prompt.includes('Riporta ogni openRequest con lo stesso id e need'));
  assert.ok(prompt.includes('mai per una risposta che nega o limita il servizio'));
  assert.ok(prompt.includes('un divieto non sostenuto dalla KB è missing'));
});
test('fatto letterale in KB classificato irrilevante non resta allucinazione',()=>{
  const {s,v}=setup();
  const fact='Tempi di preparazione: 3 giorni lavorativi.';
  const p=payload('addressed');
  p.hallucinations.unsupportedClaims=[fact];p.irrelevantDetails=[fact];
  const out=parse(s,p,options(),fact);
  assert.equal(out.isValid,false);
  assert.equal(out.details.unsupportedClaims.length,0);
  assert.deepEqual(Array.from(out.details.irrelevantDetails),[fact]);
  assert.equal(v._deriveSemanticFailureReasonCode_({details:out.details},null),'semantic_irrelevant_detail');
});
test('frammento della firma generica non è un’affermazione infondata',()=>{
  const {s}=setup();const p=payload();p.hallucinations.unsupportedClaims=['Parrocchia'];p.irrelevantDetails=['Segreteria Parrocchia'];
  const context=s._prepareCoverageContext_('',options());
  const out=s._parseSemanticResponse(JSON.stringify(p),{coverageRequired:true,coverageContext:context,
    knowledgeBase:kb,responseText:'La segreteria è aperta martedì. Segreteria Parrocchia'});
  assert.equal(out.isValid,true);
  assert.deepEqual(Array.from(out.details.unsupportedClaims),[]);
  assert.deepEqual(Array.from(out.details.irrelevantDetails || []),[]);
  const realClaim=s._parseSemanticResponse(JSON.stringify({...p,hallucinations:{unsupportedClaims:['La Parrocchia garantisce il rilascio oggi.']}}),
    {coverageRequired:true,coverageContext:context,knowledgeBase:kb,responseText:'La Parrocchia garantisce il rilascio oggi.'});
  assert.equal(realClaim.isValid,false);
  assert.equal(realClaim.details.unsupportedClaims.length,1);
});
test('reasonCode privilegia la pertinenza quando la motivazione esclude un difetto di radicamento',()=>{
  const {v}=setup();
  assert.equal(v._deriveSemanticFailureReasonCode_({reason:'La risposta inserisce dettagli irrilevanti e non richiesti.',
    details:{unsupportedClaims:['frase classificata erroneamente'] }},null),'semantic_irrelevant_detail');
  assert.equal(v._deriveSemanticFailureReasonCode_({reason:'La risposta contiene un’affermazione infondata e senza riscontro.',
    details:{unsupportedClaims:['divieto inventato'],irrelevantDetails:['frase superflua']}},null),'semantic_unsupported_claim');
});
for (const mutation of [p=>delete p.coverage,p=>delete p.coverage.requests,
  p=>p.coverage.requests=[],p=>p.coverage.requests.push({...p.coverage.requests[0]}),
  p=>p.coverage.requests[0].status='invented',p=>{p.coverage.requests[0].status='missing';p.coverage.requests[0].reason='';}]) {
  test('contratto incompleto non approva',()=>{const {s}=setup();const p=payload();mutation(p);
    const result=parse(s,p);assert.equal(result.isValid,false);assert.equal(result.coverageState,'contract_error');});
}
test('contratto copertura errato conserva allucinazioni',()=>{
  const {s}=setup();const p=payload();delete p.coverage;p.hallucinations.unsupportedClaims=['divieto inventato'];
  const out=parse(s,p);assert.equal(out.contentValid,false);assert.equal(out.details.unsupportedClaims.length,1);
});
test('verdetto malformato e JSON invalido',()=>{
  const {s}=setup(); assert.throws(()=>parse(s,{confidence:0.9}),{code:'SEMANTIC_CONTRACT_ERROR'});
  assert.throws(()=>s._parseSemanticResponse('{',{coverageRequired:true}),{code:'SEMANTIC_CONTRACT_ERROR'});
});
test('missing con why esplicito soddisfa il contratto di motivazione',()=>{
  const {s}=setup();const p=payload('missing');delete p.coverage.requests[0].reason;
  p.coverage.requests[0].why='La domanda non è trattata.';
  const out=parse(s,p);assert.equal(out.coverageState,'missing');assert.equal(out.isValid,false);
  assert.equal(out.coverage.requests[0].reason,p.coverage.requests[0].why);
});
test('diagnostica contrattuale indica la richiesta non valutata',()=>{
  const {s}=setup();const p=payload();p.coverage.requests=[];
  const out=parse(s,p);assert.equal(out.coverageState,'contract_error');
  assert.ok(out.coverageError.includes('richiesta estratta non valutata: r1'));
});
test('domanda aggiuntiva omessa non nascosta dal classificatore',()=>{
  const {s}=setup();const p=payload();p.coverage.additionalRequests=[{id:'r2',need:'orario',evidence:'Quando?',status:'missing',reason:'manca orario'}];
  const out=parse(s,p,options({groundingParts:{body:body+' Quando?'}}));
  assert.equal(out.coverageState,'missing');assert.equal(out.coverage.additionalRequests[0].why,'manca orario');
});
test('voce estratta priva di supporto può essere scartata con motivo',()=>{
  const {s}=setup();const p=payload();p.coverage.requests=[];
  p.coverage.unsupportedExtractedRequests=[{id:'r1',reason:'domanda solo citata e già risolta'}];
  assert.equal(parse(s,p).isValid,true);
  p.coverage.unsupportedExtractedRequests[0].id='inesistente';
  assert.equal(parse(s,p).coverageState,'contract_error');
});
for (const evidence of ['', 'citazione assente']) test('evidenza non visibile '+evidence,()=>{
  const {s}=setup();const opts=options({requestCoverage:{openRequests:[{...request,evidence}]}});
  // Le voci non estratte devono comunque citare l'originale corrente.
  const p=payload();p.coverage.requests[0].evidence=evidence;
  assert.equal(parse(s,p,opts).coverageState,'undeterminable');
});
test('allegati: evidenza originale e non riepilogo',()=>{
  const {s}=setup();const opts=options({requestCoverage:{openRequests:[{...request,source:'attachment'}]}});
  assert.equal(parse(s,payload(),opts).coverageState,'undeterminable');
  opts.groundingParts.attachments=body;
  assert.equal(parse(s,payload(),opts).coverageState,'complete');
});
for (const limit of [2000,6000]) test('richiesta centrale con budget '+limit,()=>{
  const {s}=setup('enforce',{coverageBodyMaxChars:limit});
  const opts=options({groundingParts:{body:'x'.repeat(2500)+body+'y'.repeat(2500)}});
  const out=parse(s,payload(),opts);
  assert.equal(out.coverageState,limit===2000?'undeterminable':'complete');
});
test('corpo parziale con richiesta visibile resta non determinabile',()=>{
  const {s}=setup();const opts=options({sourceCompleteness:{bodyTruncated:true}});
  assert.equal(parse(s,payload(),opts).coverageState,'undeterminable');
  const p=payload();p.coverage.requests=[];opts.requestCoverage={openRequests:[]};
  assert.equal(parse(s,p,opts).coverageState,'undeterminable');
});
test('storico parziale non blocca da solo; estrazione parziale con originale completo',()=>{
  const {s}=setup();const opts=options({sourceCompleteness:{historyTruncated:true},
    requestCoverage:{openRequests:[request],extractionTruncated:true}});
  assert.equal(parse(s,payload(),opts).coverageState,'complete');
});
test('cache include richieste vincoli completezza e metriche',()=>{
  const {s}=setup();let calls=0;s._generateSemantic=()=>{calls++;return JSON.stringify(payload());};
  const run=opts=>s.validateHallucinations('risposta',kb,{score:1,errors:[]},body,opts);
  assert.equal(run(options()).metrics.generatedCalls,1);assert.equal(run(options()).metrics.cacheHit,true);
  for (const opts of [options({requestCoverage:{goal:'diverso',openRequests:[request]}}),
    options({coverageConstraints:{territory:'altrove'}}),options({sourceCompleteness:{historyTruncated:true}}),
    options({requestCoverage:{openRequests:[{...request,role:'conditional',appliesWhen:'solo se necessario'}]}})]) run(opts);
  assert.equal(calls,5);
  s._generateSemantic=()=>'{"isValid":true,"confidence":0.9}';
  assert.equal(run(options({coverageConstraints:{new:true}})).coverageState,'contract_error');
  assert.equal(run(options({coverageConstraints:{new:true}})).metrics.generatedCalls,1);
});
test('errore tecnico e assenza runtime non sono omissioni',()=>{
  const {s}=setup();s._generateSemantic=()=>{throw new Error('network');};
  assert.equal(s.validateHallucinations('r',kb,{score:1,errors:[]},body,options()).coverageState,'unavailable');
  s.runtimeSemanticAvailable=false;
  assert.equal(s.validateHallucinations('r',kb,{score:1,errors:[]},body,options()).coverageState,'unavailable');
});
const reply="Gentile signora, grazie per il suo messaggio. Restiamo a disposizione per rispondere alle sue domande. Cordiali saluti, Segreteria Parrocchia Sant'Eugenio";
for (const mode of ['observe','enforce']) for (const state of ['addressed','missing','undeterminable','contract_error','unavailable']) {
  test('pipeline '+mode+'/'+state,()=>{
    const {v,c}=setup(mode);let calls=0;let thinking=0;
    v.semanticValidator._generateSemantic=()=>{calls++;if(state==='unavailable') throw new Error('network');
      return JSON.stringify(state==='contract_error'?{isValid:true,confidence:.9}:payload(state));};
    v.semanticValidator.validateThinkingLeak=()=>{thinking++;return {isValid:true};};
    const out=v.validateResponse(reply,'it',kb,body,'Informazioni','full',false,
      {validationContext:{requestCoverage:{openRequests:[request]}}});
    assert.equal(calls,1);assert.equal(thinking,0);assert.equal(out.score,1);
      assert.equal(out.isValid,mode==='enforce'&&state!=='addressed'?false:true);
    assert.equal(Boolean(out.pendingSemanticReview),mode==='enforce'&&['undeterminable','contract_error','unavailable'].includes(state));
    if(mode==='observe'){assert.equal(out.errors.length,0);assert.equal(out.warnings.length,0);}
    if(state==='missing'&&mode==='enforce') {
      assert.equal(out.reasonCode,'semantic_omission');
      const p=Object.create(c.EmailProcessor.prototype);
      assert.equal(p._classifyValidationForRetry(out,'it').omission,true);
      assert.equal(p._classifyValidationForRetry(out,'it').hallucination,false);
      assert.equal(p._shouldAttemptIntelligentRetry(out,'it',{onlyForErrors:['omission']}),true);
    }
  });
}
test('flag spento preserva il salto a punteggio uno',()=>{
  const {v,s}=setup('observe',{completenessAlways:false});
  v.semanticValidator._generateSemantic=()=>{throw new Error('non deve chiamare');};
  assert.equal(v.validateResponse(reply,'it',kb,body,'','full',false).isValid,true);
  assert.equal(s.validateHallucinations('r',kb,{score:1,errors:[]},body).skipped,true);
});
test('estrazione: normalizzazione, condizione e nessun limite inventato',()=>{
  const {c}=setup();const result=c.EmailQuickCheckPolicy.normalizeDecisionData({goal:'ottenere certificato',
    openRequests:[{...request,role:'conditional',appliesWhen:'email insufficiente'}]},
    {},null,{emailContent:'a'.repeat(6100),emailSubject:'Certificato'});
  assert.equal(result.requestCoverage.openRequests[0].appliesWhen,'email insufficiente');
  assert.equal(result.requestCoverage.extractionTruncated,true);
});
test('trasporto nel thread senza seconda classificazione',()=>{
  const out=runScenario(root,{quick:{requestCoverage:{goal:'documenti',openRequests:[request]}}});
  const prompt=out.effects.find(([event])=>event==='prompt')[1];
  const checked=out.effects.find(([event])=>event==='validate')[1][7].validationContext;
  assert.equal(prompt.requestCoverage.goal,'documenti');assert.equal(checked.requestCoverage.openRequests[0].id,'r1');
  assert.equal(typeof checked.coverageSources.currentBody,'string');
  assert.equal(out.effects.filter(([event])=>event==='send').length,1);
});
for (const reason of ['semantic_unavailable','semantic_context_insufficient','semantic_contract_error']) test('thread sospende '+reason,()=>{
  const out=runScenario(root,{}, {setup(c,services){services.validator.validateResponse=()=>({isValid:true,score:1,errors:[],warnings:[],details:{},pendingSemanticReview:reason});}});
  assert.equal(out.result.reason,reason);assert.equal(out.effects.some(([event])=>event==='send'),false);
  assert.equal(out.result.status,reason==='semantic_unavailable'?'dilata':'validation_review');
  assert.equal(out.effects.some(([event])=>event==='label.review'),reason!=='semantic_unavailable');
});
test('omissione e dettagli superflui: una rigenerazione e una rivalidazione',()=>{
  let checked=0;
  const out=runScenario(root,{}, {setup(c,services){
    c.CONFIG.INTELLIGENT_RETRY={enabled:true,maxRetries:5,onlyForErrors:['omission','kb_relevance']};
    services.validator.validateResponse=()=>{
      checked++;return checked===1?{isValid:false,score:1,errors:['Copertura incompleta'],warnings:[],reasonCode:'semantic_omission',
        details:{coverage:{mode:'enforce',evaluation:{requests:[{...request,status:'missing',why:'non risponde'}]}},
          semantic:{hallucinations:{isValid:false,contentValid:false,details:{irrelevantDetails:['dettaglio superfluo']}}}}}:
        {isValid:true,score:1,errors:[],warnings:[],details:{}};
    };
  }});
  assert.equal(checked,2);assert.equal(out.result.status,'replied');
  const retry=out.effects.filter(([event])=>event==='generate')[1][1][0];
  assert.equal(retry.systemInstruction,'Persona test');
  assert.ok(retry.prompt.includes('Integra in modo conciso'));
  assert.ok(retry.prompt.includes('rimuovi nello stesso tentativo'));
});
test('omissione persistente non invia e non ripete la correzione',()=>{
  let checked=0;
  const out=runScenario(root,{}, {setup(c,services){
    c.CONFIG.INTELLIGENT_RETRY={enabled:true,maxRetries:5,onlyForErrors:['omission']};
    services.validator.validateResponse=()=>{checked++;return {isValid:false,score:1,errors:['Copertura incompleta'],warnings:[],reasonCode:'semantic_omission',
      details:{coverage:{mode:'enforce',evaluation:{requests:[{...request,status:'missing',why:'non risponde'}]}}}};};
  }});
  assert.equal(checked,2);assert.equal(out.result.status,'validation_failed');
  assert.equal(out.effects.some(([event])=>event==='send'),false);
  assert.equal(out.effects.filter(([event])=>event==='generate').length,2);
});
test('indisponibilità di controllo obbligatorio non diventa allucinazione',()=>{
  const {v}=setup();v._checkKnowledgeContextualizationRisk=()=>({requiresSemanticReview:true});
  v.semanticValidator._generateSemantic=()=>{throw new Error('network');};
  const out=v.validateResponse(reply,'it',kb,body,'','full',false,{validationContext:{requestCoverage:{openRequests:[request]}}});
  assert.equal(out.pendingSemanticReview,'semantic_unavailable');assert.equal(out.errors.length,0);
  assert.equal(out.isValid,false);assert.equal(out.reasonCode,null);
});
test('esportazione dei 23 casi senza includere gli esiti attesi nel prompt',()=>{
  const {prepare,compare}=require('../scripts/run_coverage_model_eval');
  const suite=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/coverage_cases.json'),'utf8'));
  assert.equal(suite.cases.length,23);
  for(const item of suite.cases) {
    const {context,prompt}=prepare(item);
    assert.ok(prompt.includes('fonte esclusiva'));
    assert.ok(!prompt.includes('"expected"'));
    if(item.id==='C06a') assert.equal(context.completeness.bodyTruncated,false);
    if(['C06b','C06c'].includes(item.id)) assert.equal(context.completeness.bodyTruncated,true);
    if(item.id==='C06b') assert.ok(!context.sources.body.includes(item.message.bodyMiddleText));
  }
  const sample=suite.cases[0];const {s,context}=prepare(sample);
  const p=payload('missing');p.coverage.requests=sample.openRequests.map((r,index)=>({...r,status:index?'missing':'addressed',reason:'domanda scoperta'}));
  const result=s._parseSemanticResponse(JSON.stringify(p),{coverageRequired:true,coverageContext:context,knowledgeBase:sample.kb});
  assert.deepEqual(compare(sample,result,context).failures,[]);
});
console.log(`Request coverage: ${count} cases passed (risposte del modello simulate; nessuna misura di accuratezza semantica).`);
