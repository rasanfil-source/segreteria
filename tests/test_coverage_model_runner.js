const assert=require('node:assert/strict');
const {prepare,parseAnswer,createModelCaller,summarize}=require('../scripts/run_coverage_model_eval');
async function main() {
  const fixture=require('./fixtures/coverage_cases.json').cases.find(item=>item.id==='C05c');
  const prepared=prepare(fixture);
  const answer={hallucinations:{unsupportedClaims:['Segreteria Parrocchia']},irrelevantDetails:[],
    coverage:{evaluated:true,purpose:'operational',goal:'confermare la visita',
      requests:[{id:'r1',need:fixture.openRequests[0].need,evidence:fixture.openRequests[0].evidence,
        status:'addressed',reason:'La risposta conferma la visita.',sourceRef:'Segreteria aperta martedì e giovedì dalle 9:00 alle 11:00.'}],
      additionalRequests:[],unsupportedExtractedRequests:[],undeterminableReason:null},
    isValid:false,confidence:0.9,reason:'La risposta è corretta.'};
  const normalized=parseAnswer(fixture,prepared,JSON.stringify(answer));
  assert.equal(normalized.isValid,true,JSON.stringify(normalized));
  assert.deepEqual(Array.from(normalized.details.unsupportedClaims||[]),[]);

  let now=0;const starts=[];const sleeps=[];
  const sleep=async ms=>{sleeps.push(ms);now+=ms;};
  const ok={ok:true,json:async()=>({candidates:[]})};
  const call=createModelCaller({apiKey:'fixture',model:'fixture',now:()=>now,sleep,
    fetchFn:async(url,options)=>{starts.push(now);assert.ok(!url.includes('fixture-key'));
      assert.equal(options.headers['x-goog-api-key'],'fixture');now+=1000;return ok;}});
  await call('one');await call('two');await call('three');
  assert.deepEqual(starts,[0,5000,10000]);assert.deepEqual(sleeps,[4000,4000]);
  let attempts=0;now=0;starts.length=0;
  const retry=createModelCaller({apiKey:'fixture',model:'fixture',now:()=>now,sleep,
    fetchFn:async()=>{attempts++;starts.push(now);return attempts===1?
      {ok:false,status:429,headers:{get:()=> '10'},json:async()=>({error:{status:'RESOURCE_EXHAUSTED'}})}:ok;}});
  assert.equal((await retry('p')).attempts,2);assert.deepEqual(starts,[0,10000]);
  attempts=0;
  const blocked=createModelCaller({apiKey:'fixture',model:'fixture',now:()=>now,sleep,
    fetchFn:async()=>{attempts++;return {ok:false,status:429,headers:{get:()=>null},json:async()=>({error:{status:'RESOURCE_EXHAUSTED'}})};}});
  await assert.rejects(blocked('p'),error=>error.httpStatus===429&&error.attempts===3);
  assert.equal(attempts,3);
  const deferred=createModelCaller({apiKey:'fixture',model:'fixture',sleep:async()=>assert.fail('nessuna attesa oltre un minuto'),
    fetchFn:async()=>({ok:false,status:429,headers:{get:()=>null},json:async()=>({error:{details:[{retryDelay:'3600s'}]}})})});
  await assert.rejects(deferred('p'),error=>error.attempts===1&&error.retryAfterMs===3600000);
  const invalid=createModelCaller({apiKey:'fixture',model:'fixture',sleep:async()=>assert.fail('errore definitivo senza retry'),
    fetchFn:async()=>({ok:false,status:400,headers:{get:()=>null},json:async()=>({})})});
  await assert.rejects(invalid('p'),error=>error.httpStatus===400&&error.attempts===1);
  assert.deepEqual(summarize([
    {failures:[],actual:{},result:{coverageState:'complete'}},
    {failures:['state'],actual:{},result:{coverageState:'missing'}},
    {failures:['state'],actual:{},result:{coverageState:'contract_error'}},
    {failures:['model_error'],actual:{},result:null},
    {failures:['not_run'],actual:{},result:null}
  ]),{passed:1,decisionsMatched:1,judged:2,contractErrors:1,unavailable:1,notRun:1});
  console.log('Coverage model runner: pacing, retry limit, HTTP errors and result separation passed.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
