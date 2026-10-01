const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const quiet = {log(){},warn(){},error(){},info(){}};
function load(ctx, ...files) {
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx,{filename:file});
}
const ctx = vm.createContext({console:quiet,CONFIG:{},GLOBAL_CACHE:{}});
load(ctx,'gas_classifier.js','gas_email_processor.js');
const p = Object.create(ctx.EmailProcessor.prototype);
for (const central of [false,true]) {
  if (central) load(ctx,'gas_error_types.js');
  for (const [message,type] of [
    ['400 INVALID_ARGUMENT: unsupported temperature','FATAL'],
    ['400 INVALID_ARGUMENT: API key not valid','INVALID_API_KEY'],
    ['403 PERMISSION_DENIED','INVALID_API_KEY'],
    ['SYSTEM_ERROR: storage unavailable','SYSTEM_ERROR'],
    ['FATAL: initialization failed','FATAL']
  ]) {
    const result = p._classifyError(new Error(message));
    assert.equal(result.type,type,`${central}: ${message}`);
    assert.equal(result.retryable,false);
  }
}
assert.equal(ctx.classifyError(Error('malformed JSON')).type,'INVALID_RESPONSE');

const now = Date.now();
const reset = new Date(now + 3600000).toISOString();
for (const error of ['requests per day exhausted','GenerateRequestsPerDayPerProjectPerModel','daily quota exhausted','RPD exhausted']) {
  p.geminiService = {};
  assert.equal(p._getQuotaCheckpointDelayMs_({errorClass:'QUOTA_EXHAUSTED',error}),-1,error);
  p.geminiService = {rateLimiter:{_getNextResetTime:()=>reset}};
  const delay = p._getQuotaCheckpointDelayMs_({errorClass:'QUOTA_EXHAUSTED',error});
  assert(delay > 3590000 && delay <= 3660000,error);
}
for (const error of ['RPM quota exceeded','tokens per minute exhausted','QUOTA_EXHAUSTED','QUOTA_EXHAUSTED_ALL_KEYS']) {
  assert.equal(p._getQuotaCheckpointDelayMs_({errorClass:'QUOTA_EXHAUSTED',error}),60000,error);
}
assert.equal(p._getQuotaCheckpointDelayMs_({error:'GMAIL_DAILY_CALL_LIMIT_REACHED'}),-1);
p.geminiService = {rateLimiter:{_getNextResetTime:()=> 'invalid date'}};
assert.equal(p._getQuotaCheckpointDelayMs_({error:'requests per day'}),-1);

for (const separator of ['. ', '! ', '? ', '; ', '\n']) {
  const flags = p._detectPhysicalPresenceConstraint_('',`Non ho ancora il certificato${separator}Sono ricoverato in ospedale`,true);
  assert(flags.some(flag=>flag.type==='health'),separator);
}
for (const body of ['Non sono ricoverato in ospedale','Ho il certificato. Mio fratello è ricoverato in ospedale']) {
  assert(!p._detectPhysicalPresenceConstraint_('',body,true).some(flag=>flag.type==='health'),body);
}
const sentence = 'La segreteria apre alle 9.00 e chiude alle 12.00.';
p._getBusinessDateString = ()=>'2026-10-01';
for (const prefix of ['', '• ', '- ', '* ', '  -   ']) {
  const existingSummary = `${prefix}[2026-09-30] ${sentence}`;
  const summary = p._buildMemorySummary({existingSummary,responseText:sentence});
  assert.equal(summary,existingSummary.trim());
  assert.equal(p._buildMemorySummary({existingSummary,responseText:sentence+' Il sabato la segreteria resta chiusa.'}).split('\n').length,2);
}
for (const withContext of [false,true]) {
  if(withContext) load(ctx,'gas_prompt_context.js');
  const c = new ctx.Classifier();
  assert.equal(c.classifyEmail('Sono disperato, voglio farla finita','Aiutatemi',false).reason,'pastoral_crisis_detected');
  assert.equal(c.classifyEmail('Voglio morire','Grazie',false).reason,'pastoral_crisis_detected');
  for(const subject of ['Re: OK','Re: '+ 'Informazioni '.repeat(8)]) {
    for(const body of ['','> messaggio storico','--\nMario Rossi']) {
      assert.equal(c.classifyEmail(subject,body,true).shouldReply,false,subject+'/'+body);
    }
  }
  assert.equal(c.classifyEmail('Re: Orari messe','',true).shouldReply,true);
  assert.equal(c.classifyEmail('Quali sono i documenti necessari per iscrivere mio figlio al catechismo?','',true).shouldReply,true);
}
for(const file of ['gas_config.js','gas_config.example.js']) {
  for(const bulk of [false,true]) {
    const values = {A:'one', B:'two'};
    const props = {getProperty:k=>values[k] ?? null};
    if(bulk) props.getProperties=()=>({...values});
    const cfg = vm.createContext({console:quiet,PropertiesService:{getScriptProperties:()=>props}});
    load(cfg,file);
    assert.equal(cfg._getScriptProperty(' A '),'one');
    values.A = 'new';
    cfg._clearScriptPropertyCache([' A ',null,'']);
    assert.equal(cfg._getScriptProperty('A'),'new');
    values.B = 'updated';
    cfg._refreshScriptPropertyCache_(' B ',Date.now());
    assert.equal(cfg._getScriptProperty('B'),'updated');
    assert.equal(Object.hasOwn(cfg._CACHED_PROPS,' B '),false);
  }
}
console.log('Follow-up audit: errors, quotas, sentence boundaries, memory, crisis subjects and property cache passed');
