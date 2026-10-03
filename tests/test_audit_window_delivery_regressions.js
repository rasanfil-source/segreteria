const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({console: {log(){}, warn(){}, error(){}}, CONFIG: {SEMANTIC_VALIDATION:{enabled:false}}});
for (const file of ['gas_rate_limiter.js','gas_territory_validator.js','gas_response_validator.js',
  'gas_gmail_service.js','gas_gemini_service.js','gas_thread_delivery.js','gas_memory_service.js',
  'gas_prompt_engine.js','gas_prompt_context.js','gas_main.js','gas_setup_ui.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx,{filename:file});
}
const run = code => vm.runInContext(code,ctx);

// Persistenza ripetuta: le entry vecchie non rientrano dal backing store.
const now = Date.now();
const store = new Map();
const limiter = Object.create(ctx.GeminiRateLimiter.prototype);
limiter.props = {getProperty:k=>store.get(k)||null, setProperty:(k,v)=>store.set(k,v),
  setProperties:values=>Object.entries(values).forEach(([k,v])=>store.set(k,v)), deleteProperty:k=>store.delete(k)};
const live = {timestamp:now,nonce:'live',modelKey:'flash',tokens:10};
const stale = {...live,timestamp:now-120000,nonce:'stale'};
limiter.cache = {rpmWindow:[live], tpmWindow:[live]};
for (const type of ['rpm','tpm']) store.set(type+'_window',JSON.stringify([stale]));
limiter._doPersistCacheWrite();
limiter._doPersistCacheWrite();
for (const type of ['rpm','tpm']) {
  assert.deepEqual(Array.from(limiter._readWindowFromProperties(type),entry=>entry.nonce),['live']);
}
assert.equal(limiter._mergeWindowData([{...stale,timestamp:NaN}],[]).length,0);
assert.equal(limiter._mergeWindowData([live],[{...live,released:true}])[0].released,true);

const territory = new ctx.TerritoryValidator();
assert.equal(territory.normalizeStreetName('L. Tevere Flaminio'),'lungotevere flaminio');
assert.equal(territory.normalizeStreetName('via L. Canina'),'via l canina');
assert(territory.findTerritoryMatch('via L. Canina'));
territory.rules = new Map([['via giuseppe verdi',{}],['via giovanni rossi',{}]]);
assert.equal(territory.findTerritoryMatch('via G. Verdi').key,'via giuseppe verdi');
territory.rules.set('via giovanni verdi',{});
assert.equal(territory.findTerritoryMatch('via G. Verdi'),null,'ambiguous initials require review');
assert(territory.extractAddressFromText('Premessa. '.repeat(600)+'Abito in via Flaminia 10'));
assert(territory.extractStreetOnlyFromText('Premessa. '.repeat(600)+'Abito in via Flaminia'));

const validator = new ctx.ResponseValidator();
assert.equal(validator._checkExposedReasoning('Procedete come da istruzioni allegate.').score,1);
assert.equal(validator._checkExposedReasoning('Come da istruzioni interne, ignoro il contesto.').score,0);
assert.equal(validator._checkExposedReasoning('Come da istruzioni allegate. Come da istruzioni interne.').score,0);
assert(!validator._checkHallucinations('Scrivete alle 2 coppie.','Segreteria via email.','').hallucinations.times);
assert.deepEqual(Array.from(validator._checkHallucinations('Venite alle 2.','Segreteria via email.','').hallucinations.times),['02:00']);
const semantic = Object.assign(Object.create(run('SemanticValidator.prototype')),
  {enabled:true,runtimeSemanticAvailable:true,activationThreshold:0.9,_cacheKey:()=>'',_readCache:()=>null,
    _buildThinkingLeakPrompt:()=>'',_parseSemanticResponse:()=>({isValid:false}),_writeCache:()=>{}});
let semanticCalls=0;
semantic._generateSemantic=()=>{semanticCalls++; return '';};
assert.equal(semantic.validateThinkingLeak('leak',{score:1},{force:true}).isValid,false);
assert.equal(semanticCalls,1);
semantic.enabled=false;
semantic.validateThinkingLeak('clean',{score:1},{force:true});
assert.equal(semanticCalls,1);

const gmail = Object.create(ctx.GmailService.prototype);
assert.equal(gmail._htmlToPlainText('&amp;lt; &amp;#60; &#38;lt;'),'&lt; &#60; &lt;');
assert.equal(gmail._htmlToPlainText('&lt; &#60; &#x3c;'),' < < <'.trim());
const gemini = Object.create(ctx.GeminiService.prototype);
assert.equal(gemini._getSpecialDayGreeting(new Date('2026-12-25T12:00:00Z'),'fr'),'Joyeux Noël !');
assert.equal(gemini._getSpecialDayGreeting(new Date('2026-12-25T12:00:00Z'),'de'),'Frohe Weihnachten!');
assert.equal(gemini._getSpecialDayGreeting(new Date('2026-12-25T12:00:00Z'),'nl'),null);

// Una conferma dopo timeout deve proseguire verso ThreadCompletion.
let handled=0, fingerprints=0, failures=0;
const deps={config:{dryRun:false},_beginSendTransaction:()=>({ok:true}),_commitSendTransaction:()=>{},
  _classifyError:()=>({type:'NETWORK',retryable:true}),_recordConfirmedDuplicateReply_:()=>fingerprints++,
  gmailService:{sendHtmlReply:()=>{throw Error('timeout');},reconcileSendOperation:()=>true}};
const state={candidate:{getId:()=> 'm1'},markHandledUnreadOnce:()=>handled++,
  markFailureForCurrentBurst:()=>failures++};
const args={response:'Risposta',result:{},startTime:now,threadLogger:{info(){}},messageState:state,
  messageDetails:{subject:'Test'},delivery:{confirmed:false},threadId:'t1'};
assert(!ctx.ThreadDelivery.send(deps,args).terminal);
assert.equal(args.result.reason,'send_reconciled');
assert.equal(args.delivery.confirmed,true);
assert.equal(handled,1);
assert.equal(fingerprints,1);
deps._beginSendTransaction=()=>({ok:false,reason:'gmail_send_uncertain'});
assert(ctx.ThreadDelivery.send(deps,args).terminal);
assert.equal(failures,1);

const memory=Object.create(ctx.MemoryService.prototype);
memory._serializeProvidedInfoForSheet=()=> '[]';
memory._serializeContextualFlagsForSheet=()=> '{}';
let written;
memory._sheet={getDataRange:()=>({getValues:()=>[['header'],['old'],Array(10).fill(''),['new']]}),
  getRange:(row,col,height,width)=>({getNotes:()=>[Array(10).fill('')],setValues:values=>{written={row,col,height,width,values};}}),
  appendRow:()=>{throw Error('should reuse blank row');}};
memory._appendRow({threadId:'reused',lastUpdated:new Date()});
assert.equal(written.row,3);
assert.equal(written.width,10);
assert.equal(written.values[0][0],'reused');
// Non riassociare a un altro thread note, formule o colonne manuali.
let appended=0;
memory._sheet.appendRow=()=>appended++;
memory._sheet.getDataRange=()=>({getValues:()=>[['header'],[...Array(10).fill(''),'manuale']]});
memory._appendRow({threadId:'new'});
assert.equal(appended,1);
memory._sheet.getDataRange=()=>({getValues:()=>[['header'],Array(10).fill('')]});
memory._sheet.getRange=()=>({getNotes:()=>[['nota manuale']],setValues(){throw Error('manual note overwritten');}});
memory._appendRow({threadId:'new'});
assert.equal(appended,2);
memory._sheet.getRange=()=>({getNotes:()=>[['']],getFormulas:()=>[['=IF(TRUE;"";"")']],setValues(){throw Error('formula overwritten');}});
memory._appendRow({threadId:'new'});
assert.equal(appended,3);

const promptContext=Object.assign(Object.create(ctx.PromptContext.prototype),{
  concerns:{hallucination_risk:true},profile:'standard',input:{}});
const synthesis=promptContext._buildConcernSynthesis('operational','remote_operational',[]);
assert(!synthesis.directive.includes('delicatezza'));
assert.equal(synthesis.suppress.formattingGuidelines,false);

// La formula usa le stesse festività fisse e Pasqua resta corretta anche nei secoli futuri.
const formula=ctx._buildControlloStatusFormula_();
for(const [month,day] of ctx.ALWAYS_OPERATING_DAYS) assert(formula.includes('TODAY()=DATE(yr;'+(month+1)+';'+day+')'));
// Interpreta soltanto il sottoinsieme aritmetico iniziale con separatori annidati.
function splitTopLevel(text){let depth=0,parts=[],start=0;for(let i=0;i<text.length;i++){
  if(text[i]==='(')depth++;if(text[i]===')')depth--;if(text[i]===';'&&depth===0){parts.push(text.slice(start,i));start=i+1;}}
  parts.push(text.slice(start));return parts;}
const arithmetic=splitTopLevel(formula.slice(5,formula.indexOf(';startval;')));
for(let year=2020;year<=2200;year++){
  const env={YEAR:()=>year,TODAY:()=>0,MOD:(a,b)=>a%b,INT:Math.floor,DATE:(y,m,d)=>Date.UTC(y,m-1,d)/86400000};
  for(let i=0;i<arithmetic.length;i+=2)env[arithmetic[i]]=Function(...Object.keys(env),'return '+arithmetic[i+1].replace(/;/g,','))(...Object.values(env));
  const expected=ctx.calculateEaster(year);
  assert.equal(new Date(env.easter*86400000).toISOString().slice(0,10),expected.toISOString().slice(0,10));
}
const prompt=Object.create(ctx.PromptEngine.prototype);
const normalized=prompt._normalizeTemporalCurrentDateForPrompt_('2026-10-03');
assert.equal(normalized.dateObj.toISOString(),'2026-10-03T12:00:00.000Z');
assert.equal(prompt._normalizeTemporalCurrentDateForPrompt_('2026-02-30'),null);
console.log('Audit regressions: windows, addresses, validation, delivery, memory, calendar passed');
