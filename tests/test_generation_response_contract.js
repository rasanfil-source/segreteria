const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const ctx = {console:{log(){},warn(){},error(){}}, CONFIG:{}};
vm.createContext(ctx);
for (const file of ['gas_error_types.js','gas_email_processor.js','gas_thread_generation.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx);
}
const classify = ctx.EmailProcessor.prototype._classifyError;
function run(sequence, deadlines = [], options = {}) {
  let calls = 0, checks = 0;
  const marks = [], result = {};
  const plans = sequence.map((_,i) => ({key:'test-key-' + i,name:'plan-' + i,model:'test-model'}));
  const deps = {
    config:{maxExecutionTimeMs:100},
    _isNearDeadline(){return Boolean(deadlines[checks++]);},
    _buildGenerationStrategies_(){return {attemptStrategy:plans};},
    geminiService:{generateResponse(){
      const value = sequence[calls++];
      if (value instanceof Error) throw value;
      return value;
    }},
    _isNoReplyToken_(text){return typeof text === 'string' && text.trim() === 'NO_REPLY';},
    _classifyError:classify,
    _buildReceiptOnlySubmissionResponse_(){return 'Ricevuto';}
  };
  const outcome = ctx.ThreadGeneration.generate(deps, {
    result, messageDetails:{senderName:'Mario'}, fullPrompt:'test', attachmentBlobs:[],
    markFailureForCurrentBurst(type){marks.push(type);}, ...options
  });
  return {calls,checks,marks,result,outcome};
}
for (const invalid of [null,undefined,'',' \n\t ',42,true,{},[],
  {success:true,text:''},{success:true,text:42},{success:true,text:'   '}]) {
  const test = run([invalid,'  Risposta valida  ']);
  assert.equal(test.calls,2,JSON.stringify(invalid));
  assert.equal(test.outcome.response,'  Risposta valida  ');
  assert.equal(test.outcome.strategyUsedPlan.name,'plan-1');
  assert.equal(test.marks.length,0);
}
const validObject = run([{success:true,text:'Risposta valida'}]);
assert.equal(validObject.outcome.response,'Risposta valida');
for (const sequence of [[null,null],[42],['   ',{}]]) {
  const test = run(sequence);
  assert.equal(test.outcome.terminal,true);
  assert.equal(test.result.errorClass,'INVALID_RESPONSE');
  assert.equal(test.result.retryable,true);
  assert.equal(test.marks.length,0);
  assert.equal(test.outcome.response,undefined);
}
const network = new Error('Network error');
network.isTransient = true;
const nearFallback = run([network,'Risposta'],[false,false,true]);
assert.equal(nearFallback.calls,1);
assert.equal(nearFallback.result.status,'dilata');
assert.equal(nearFallback.result.retryDelayMs,60000);
assert.equal(nearFallback.marks.length,0);
const nearFirst = run(['Risposta'],[false,true]);
assert.equal(nearFirst.calls,0);
assert.equal(nearFirst.result.status,'dilata');
const firstDeadline = run(['Risposta'],[true]);
assert.equal(firstDeadline.calls,0);
assert.equal(firstDeadline.result.status,'dilata');
const unexpected = run(['NO_REPLY','Risposta'],[],{quickCheck:{shouldRespond:true}});
assert.equal(unexpected.calls,2);
assert.equal(unexpected.outcome.response,'Risposta');
const exhaustedNoReply = run(['NO_REPLY'],[],{quickCheck:{shouldRespond:true}});
assert.equal(exhaustedNoReply.result.reason,'unexpected_no_reply_after_reply_required');
assert.equal(exhaustedNoReply.result.retryable,true);
const allowedNoReply = run(['NO_REPLY'],[],{quickCheck:{shouldRespond:false}});
assert.equal(allowedNoReply.calls,1);
assert.equal(allowedNoReply.outcome.response,'NO_REPLY');
const receipt = run(['Risposta'],[],{shouldUseReceiptOnly:true});
assert.equal(receipt.calls,0);
assert.equal(receipt.outcome.response,'Ricevuto');
console.log('Generation response contracts, fallback deadlines, NO_REPLY and receipt guardrails passed');
