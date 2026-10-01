const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ctx = vm.createContext({ console: { log(){}, warn(){}, error(){} } });
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas_gmail_service.js'), 'utf8'), ctx);
for (const code of ['GMAIL_DAILY_CALL_LIMIT_REACHED', 'GMAIL_COUNTER_LOCK_NOT_ACQUIRED_RETRYABLE']) {
  for (const failureStage of ['lookup', 'first_chunk', 'second_chunk']) {
    const error = new Error(code);
    const service = Object.create(ctx.GmailService.prototype);
    let batchCalls = 0, singleCalls = 0, counterCalls = 0;
    service.getOrCreateLabel = () => { if (failureStage === 'lookup') throw error; };
    service._getOptionalLabelIdByName = () => 'label-id';
    service._incrementGmailCallCounterOrThrow_ = () => {
      counterCalls++;
      if (counterCalls === (failureStage === 'second_chunk' ? 2 : 1)) throw error;
    };
    service.addLabelToMessage = () => { singleCalls++; };
    ctx.Gmail = { Users: { Messages: { batchModify(){ batchCalls++; } } } };
    const ids = Array.from({length:1001}, (_, i) => `m-${i}`);
    assert.throws(() => service.batchAddLabelToMessages(ids, 'IA'), caught => caught === error);
    assert.equal(singleCalls, 0, `${code}: no fallback after ${failureStage}`);
    assert.equal(batchCalls, failureStage === 'second_chunk' ? 1 : 0);
  }
}
const service = Object.create(ctx.GmailService.prototype);
const fallbackIds = [];
service.getOrCreateLabel = () => {};
service._getOptionalLabelIdByName = () => 'label-id';
service._incrementGmailCallCounterOrThrow_ = () => {};
service.addLabelToMessage = id => fallbackIds.push(id);
ctx.Gmail = { Users: { Messages: { batchModify(){ throw new Error('Batch unavailable'); } } } };
service.batchAddLabelToMessages(['a','a',null,'b'], 'IA');
assert.deepEqual(fallbackIds, ['a','b']);
console.log('Batch label quota guards passed: lookup, partial batches, lock and normal fallback');
