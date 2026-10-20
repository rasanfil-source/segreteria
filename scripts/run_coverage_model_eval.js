// Valuta soltanto dati sintetici; gli esiti attesi non entrano nel prompt del modello.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root=path.resolve(__dirname,'..');
const live=process.argv.includes('--live');
const suite=JSON.parse(fs.readFileSync(path.join(root,'tests/fixtures/coverage_cases.json'),'utf8'));
const c=vm.createContext({console:{log(){},warn(){},error(){}},CONFIG:{SEMANTIC_VALIDATION:{enabled:true,completenessAlways:true,completenessMode:'enforce'}}});
for(const name of ['gas_response_strategy.js','gas_response_validator.js']) vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),c,{filename:path.join(root,name)});
const validator=new c.ResponseValidator();
const output=path.join(root,'outputs/coverage-model-eval');
fs.mkdirSync(output,{recursive:true});
function prepare(item) {
  const s=new c.SemanticValidator();s.coverageBodyMaxChars=item.bodyLimitChars||suite.defaults.bodyLimitChars;
  const msg=item.message;
  const pad=' Testo di contorno. '.repeat(Math.ceil((msg.bodyPadMiddleChars||0)/19)).slice(0,msg.bodyPadMiddleChars||0);
  const body=[msg.body,pad,msg.bodyMiddleText,pad,msg.bodyTail].filter(Boolean).join('\n');
  const context=s._prepareCoverageContext_(body,{requestCoverage:{openRequests:item.openRequests,
    extractionTruncated:item.sourceCompleteness.classifierSawFullBody===false},
    groundingParts:{subject:msg.subject,body,history:msg.history},
    sourceCompleteness:{bodyTruncated:item.sourceCompleteness.bodyComplete===false,
      historyTruncated:item.sourceCompleteness.historyComplete===false}});
  return {s,context,prompt:s._buildHallucinationPrompt(item.response,item.kb,body,'',null,context)};
}
function parseAnswer(item,prepared,rawAnswer) {
  return prepared.s._parseSemanticResponse(rawAnswer,{coverageRequired:true,coverageContext:prepared.context,
    knowledgeBase:item.kb,responseText:item.response||''});
}
function compare(item,result,context) {
  const pending=['undeterminable','contract_error','unavailable'].includes(result.coverageState);
  const state=pending?'undeterminable':result.isValid?'approved':'rejected';
  const reasonCode=pending ? (result.coverageState==='undeterminable'?'semantic_context_insufficient':
    result.coverageState==='contract_error'?'semantic_contract_error':'semantic_unavailable') :
    !result.contentValid?validator._deriveSemanticFailureReasonCode_(result,{isValid:true}):
    result.coverageState==='missing'?'semantic_omission':null;
  const statuses=Object.fromEntries([...(result.coverage?.requests||[]),...(result.coverage?.additionalRequests||[])].map(row=>[row.id,row.status]));
  const logged={bodyComplete:!context.completeness.bodyTruncated,classifierSawFullBody:!context.completeness.extractionTruncated};
  const actual={state,reasonCode,statuses,blocksSend:state!=='approved',requiresReview:pending,logged};
  const failures=[];
  for(const key of ['state','reasonCode']) if(item.expected[key]!==actual[key]) failures.push(key);
  for(const [id,status] of Object.entries(item.expected.statuses||{})) if(statuses[id]!==status) failures.push('status:'+id);
  for(const [key,value] of Object.entries(item.expected.mustLog||{})) if(logged[key]!==value) failures.push('log:'+key);
  if(item.expected.mustNotApprove&&state==='approved') failures.push('mustNotApprove');
  if(item.expected.requiresReview&&!pending) failures.push('requiresReview');
  return {actual,failures};
}
// Distanziamento condiviso tra casi e retry: il runner non usa il limitatore GAS.
function createModelCaller({apiKey,model,fetchFn=fetch,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  now=Date.now,intervalMs=5000,onWait=()=>{}}) {
  let lastStart=null;
  return async prompt=>{
    for(let attempt=1;attempt<=3;attempt++) {
      const spacing=lastStart===null?0:Math.max(0,intervalMs-(now()-lastStart));
      if(spacing) await sleep(spacing);
      lastStart=now();
      const response=await fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,{
        method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
        body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{maxOutputTokens:8192}}),
        signal:AbortSignal.timeout(55000)});
      if(response.ok) return {generated:await response.json(),attempts:attempt};
      const details=await response.json().catch(()=>({}));
      const retryInfo=(details.error?.details||[]).find(value=>typeof value.retryDelay==='string');
      const header=response.headers?.get('retry-after');
      const seconds=header&&/^\d+(\.\d+)?$/.test(header)?Number(header):
        header&&Number.isFinite(Date.parse(header))?Math.max(0,(Date.parse(header)-now())/1000):
        Number.parseFloat(retryInfo?.retryDelay);
      const delay=Number.isFinite(seconds)?Math.max(1000,Math.ceil(seconds*1000)):20000*attempt;
      if((response.status===429||response.status>=500)&&attempt<3&&delay<=60000) {
        onWait(response.status,delay);await sleep(delay);continue;
      }
      const error=new Error('HTTP '+response.status);
      error.httpStatus=response.status;error.apiStatus=details.error?.status||null;
      error.attempts=attempt;error.retryAfterMs=delay;
      throw error;
    }
  };
}
function summarize(cases) {
  return {passed:cases.filter(item=>!item.failures.length).length,
    decisionsMatched:cases.filter(item=>item.result&&item.result.coverageState!=='contract_error'&&
      !item.failures.includes('state')).length,
    judged:cases.filter(item=>item.result&&item.result.coverageState!=='contract_error').length,
    contractErrors:cases.filter(item=>item.result?.coverageState==='contract_error'||item.actual.reasonCode==='semantic_contract_error').length,
    unavailable:cases.filter(item=>item.failures.includes('model_error')).length,
    notRun:cases.filter(item=>item.failures.includes('not_run')).length};
}
async function main() {
  const prompts=suite.cases.map(item=>({id:item.id,prompt:prepare(item).prompt}));
  fs.writeFileSync(path.join(output,'prompts.json'),JSON.stringify(prompts,null,2));
  if(!live) {console.log(`${prompts.length} prompt esportati. Nessuna chiamata al modello; accuratezza non misurata. Per eseguire: --live con GEMINI_API_KEY e GEMINI_EVAL_MODEL.`);return;}
  const apiKey=process.env.GEMINI_API_KEY;
  const model=process.env.GEMINI_EVAL_MODEL;
  if(!apiKey||!model) throw new Error('Valutazione reale non eseguita: servono GEMINI_API_KEY e GEMINI_EVAL_MODEL nell’ambiente. Nessun segreto va inserito nei file.');
  if(!/^[a-zA-Z0-9._-]+$/.test(model)) throw new Error('Nome modello non valido');
  const selectedArg=process.argv.indexOf('--only');
  const selected=selectedArg<0?null:new Set(String(process.argv[selectedArg+1]||'').split(','));
  if(selected&&[...selected].some(id=>!suite.cases.some(item=>item.id===id))) throw new Error('Identificativo non valido dopo --only');
  const report={model,startedAt:new Date().toISOString(),schemaVersion:suite.schemaVersion,intervalMs:5000,cases:[]};
  const reportPath=path.join(output,'report.json');
  // Ogni prova conserva il report precedente, inclusi gli insuccessi.
  if(fs.existsSync(reportPath)) fs.copyFileSync(reportPath,path.join(output,'report-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json'));
  const callModel=createModelCaller({apiKey,model,onWait:(status,delay)=>console.log(`HTTP ${status}: attesa ${Math.ceil(delay/1000)} s prima del nuovo tentativo.`)});
  let quotaBlocked=false;
  for(const item of suite.cases.filter(item=>!selected||selected.has(item.id))) {
    if(quotaBlocked) {
      report.cases.push({id:item.id,actual:{state:'undeterminable',reasonCode:'semantic_unavailable'},failures:['not_run'],error:'Quota API: esecuzione sospesa',result:null});
      continue;
    }
    const {s,context,prompt}=prepare(item);const started=Date.now();
    let generated=null;let result=null;let failure=null;let rawAnswer=null;let apiError=null;let attempts=0;
    try {
      ({generated,attempts}=await callModel(prompt));
      rawAnswer=(generated.candidates?.[0]?.content?.parts||[]).filter(part=>!part.thought).map(part=>part.text||'').join('');
      if(generated.candidates?.[0]?.finishReason!=='STOP') throw new Error('Risposta non completa');
      result=parseAnswer(item,{s,context},rawAnswer);
    } catch(error) {
      failure=String(error.message).split(apiKey).join('[REDACTED]');
      if(error.code==='SEMANTIC_CONTRACT_ERROR') result={isValid:false,contentValid:null,coverageState:'contract_error',coverageError:failure};
      apiError={httpStatus:error.httpStatus||null,apiStatus:error.apiStatus||null,retryAfterMs:error.retryAfterMs||null};
      attempts=error.attempts||attempts;
      if(error.httpStatus===429) quotaBlocked=true;
    }
    const checked=result?compare(item,result,context):{actual:{state:'undeterminable',reasonCode:'semantic_unavailable'},failures:['model_error']};
    report.cases.push({id:item.id,...checked,latencyMs:Date.now()-started,attempts,
      promptHash:crypto.createHash('sha256').update(prompt).digest('hex'),
      modelVersion:generated?.modelVersion||null,usage:generated?.usageMetadata||null,rawAnswer,result,error:failure,apiError});
    fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
    console.log(`${item.id}: ${checked.failures.length?'FAIL '+checked.failures.join(','):'PASS'} (${Date.now()-started} ms)`);
  }
  report.passed=report.cases.filter(item=>!item.failures.length).length;
  report.failed=report.cases.length-report.passed;
  report.summary=summarize(report.cases);
  fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
  console.log(`${report.passed}/${report.summary.judged} giudizi conformi; ${report.summary.contractErrors} errori di contratto; ${report.summary.unavailable} errori API/output; ${report.summary.notRun} non eseguiti. Totale: ${report.cases.length}.`);
  console.log(`Decisione conforme: ${report.summary.decisionsMatched}/${report.summary.judged}; conformità completa richiede anche reasonCode e stati delle richieste.`);
  console.log('Controllare motivazioni, fonti e risposta originale in outputs/coverage-model-eval/report.json.');
  if(report.failed) process.exitCode=1;
}
if(require.main===module) main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={prepare,parseAnswer,compare,createModelCaller,summarize};
