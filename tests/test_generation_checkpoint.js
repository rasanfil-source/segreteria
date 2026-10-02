const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('node:assert/strict');
let now = 1000000;
const context = vm.createContext({console, Date: class extends Date { static now() { return now; } }});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas_thread_generation.js'), 'utf8'), context);
const data = {};
const props = {getProperty: k => data[k] || null, setProperty: (k,v) => {data[k]=v;},
  deleteProperty: k => {delete data[k];}, getProperties: () => ({...data})};
const plans = [
  {name:'primary',model:'model-a',key:'secret-primary'},
  {name:'backup',model:'model-a',key:'secret-backup',usesBackupKey:true},
  {name:'next',model:'model-b',key:'secret-primary'}
];
function run({message='m1', success=false, limit=1, plan=plans, error='503 overloaded'}={}) {
  const calls=[], result={}, marks=[];
  const deps={config:{}, _getProperties_:()=>props, _isNearDeadline:()=>calls.length>=limit,
    _buildGenerationStrategies_:()=>({attemptStrategy:plan}),
    _classifyError:()=>({type:'NETWORK',retryable:true}), _isNoReplyToken_:()=>false,
    geminiService:{generateResponse(prompt, options){
      assert.equal(prompt,'unchanged prompt');
      assert.equal(options.maxRetries,undefined,'do not alter internal retries');
      calls.push(plan.find(p=>p.model===options.modelName&&p.key===options.apiKey).name);
      if (!success) throw new Error(error);
      return {text:'Risposta valida'};
    }}};
  const output=context.ThreadGeneration.generate(deps,{threadId:'t1',generationMessageId:message,
    result,fullPrompt:'unchanged prompt',messageDetails:{},attachmentBlobs:[],quickCheck:{},
    markFailureForCurrentBurst:type=>marks.push(type)});
  return {calls,result,output,marks};
}
assert.deepEqual(run().calls,['primary']);
assert(!JSON.stringify(data).includes('secret'),'never persist API keys');
assert.equal(JSON.parse(data.generation_progress_t1).messageId,'m1');
assert.deepEqual(run().calls,['backup']);
assert.deepEqual(run({success:true}).calls,['next']);
assert.equal(data.generation_progress_t1,undefined,'success clears cursor');
run();
assert.deepEqual(run({message:'m2',success:true}).calls,['primary'],'new message starts fresh');
run(); now+=6*60*60*1000+1;
assert.deepEqual(run({success:true}).calls,['primary'],'expired cursor starts fresh');
run();
const changed=plans.map(p=>({...p,model:p.model+'-new'}));
assert.deepEqual(run({plan:changed,success:true}).calls,['primary'],'config changes reset cursor');
data.generation_progress_t1='{bad JSON';
assert.deepEqual(run({success:true}).calls,['primary']);
const exhausted=run({limit:100});
assert.deepEqual(exhausted.calls,['primary','backup','next']);
assert.equal(exhausted.result.retryable,true);
assert.equal(data.generation_progress_t1,undefined,'exhaustion starts new cycle next time');
assert.deepEqual(run({success:true}).calls,['primary']);
assert.deepEqual(run({limit:0}).calls,[],'no progress before any attempt');
assert.equal(data.generation_progress_t1,undefined);
const missing=run({error:'404 model not found'});
assert.deepEqual(missing.calls,['primary']);
assert.deepEqual(run({success:true}).calls,['next'],'missing model alternate key remains skipped');
data.generation_progress_old=JSON.stringify({expiresAt:now-1});
run({success:true});
assert.equal(data.generation_progress_old,undefined,'expired abandoned state is pruned');
console.log('Generation checkpoint: resume, message/config changes, expiry, exhaustion, 404 and unchanged retries pass');
