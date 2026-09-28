// Offline checks: production source is read unchanged; proposed diff runs only in memory.
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const ctx = vm.createContext({console:{log(){},warn(){},error(){}} ,CONFIG:{MAX_THREAD_LENGTH:8}});
const policy = fs.readFileSync(path.join(root,'gas_thread_policy.js'),'utf8');
vm.runInContext(policy,ctx);
const original = ctx.ThreadPolicy;
vm.runInContext(policy.replace('botRepliesCount >= MAX_CONSECUTIVE_EXTERNAL ||','botRepliesCount >= MAX_CONSECUTIVE_EXTERNAL || consecutiveExternal >= MAX_CONSECUTIVE_EXTERNAL ||'),ctx);
const patched = ctx.ThreadPolicy;
const deps={config:{maxConsecutiveExternal:5},_normalizeEmailAddress_:s=>s.toLowerCase(),_evaluatePreAiRules_:()=>null,_applyPreAiRuleDecision_:()=>false,_shouldIgnoreEmail:()=>false};
function run(target,senders){const result={};const decision=target.loopAndSender(deps,{messages:senders.map(s=>({getFrom:()=>s})),ownAddresses:new Set(['us']),messageState:{markFailureForCurrentBurst(){}},messageDetails:{senderEmail:'human',senderName:'Human'},result,buildRuleContext:x=>x});return {terminal:!!decision.terminal,...result};}
const evidence={loop:[Array(5).fill('human'),Array(12).fill('human'),['human','human','human','human','human','us','human'],['a','b','c','d','e']].map(senders=>({senders,original:run(original,senders),patched:run(patched,senders)}))};
vm.runInContext(fs.readFileSync(path.join(root,'gas_memory_service.js'),'utf8'),ctx);
evidence.memory=[];
for(const mode of ['success','write_error','wait_error','version_mismatch','shard_timeout']){
 const events=[];ctx.LockService={getScriptLock:()=>({waitLock(){events.push('wait');if(mode==='wait_error')throw Error('wait failed');},releaseLock(){events.push('release global');}})};
 const m=Object.create(ctx.MemoryService.prototype);
 Object.assign(m,{_initialized:true,_getLockTuning_:()=>({maxRetries:1,shardedAcquireTimeoutMs:1}),_getShardedLockKey:()=> 'shard',_tryAcquireShardedLock:()=>{events.push('acquire shard');return mode!=='shard_timeout';},_releaseShardedLock:()=>events.push('release shard'),_findRowByThreadId:()=>mode==='version_mismatch'?{values:[],rowIndex:1}:null,_rowToObject:()=>({version:2}),_validateAndNormalizeTimestamp:x=>x,_invalidateCache(){},_withSheetWriteLock:fn=>fn(),_appendRow(){if(mode==='write_error')throw Error('write failed');},_writeThroughMemoryCache_(){}});
 const result=m.updateMemoryAtomic('thread',{memorySummary:'text',...(mode==='version_mismatch'?{_expectedVersion:1}:{})});
 evidence.memory.push({mode,result,events});
}
let held=true,released=0;
ctx.LockService={getScriptLock:()=>({tryLock:()=>true,releaseLock(){held=false;released++;}})};
original.throttle(deps,{messageDetails:{senderEmail:'human'},lockCtx:{lockCovered:true,cache:{get:()=>null,put(){}}},threadLogger:{warn(){}},result:{}});
evidence.throttleCallerLock={held,released};
process.stdout.write(JSON.stringify(evidence,null,2)+'\n');
