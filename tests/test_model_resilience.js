// Offline: real routing and fallback code, mocked remote requests/storage only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const quiet = {log(){}, warn(){}, error(){}, info(){}};
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const load = (ctx, ...files) => files.forEach(file => vm.runInContext(read(file), ctx, {filename:file}));
let config;
for (const file of ['gas_config.js', 'gas_config.example.js']) {
  const counts = {}, values = {GEMINI_API_KEY:'test', SPREADSHEET_ID:'sheet', A:'one', B:'two'};
  const ctx = vm.createContext({console:quiet, PropertiesService:{getScriptProperties:()=>({getProperty(key){
    counts[key] = (counts[key] || 0) + 1; return values[key] || null;
  }})}});
  load(ctx, file);
  assert.equal(ctx._getScriptProperty(' A '), 'one');
  assert.equal(ctx._getScriptProperty('B'), 'two');
  assert.equal(ctx._getScriptProperty('A'), 'one');
  assert.equal(counts.A, 1, 'single-key backend retains other fresh keys');
  values.A = 'updated';
  assert.equal(ctx._getScriptProperty(' A ', true), 'updated');
  const cfg = ctx.CONFIG;
  assert.equal(cfg.MODEL_NAME, 'gemini-3.8-flash');
  values.GEMINI_MODEL_PRIMARY = ' gemini-future-flash ';
  values.GEMINI_MODEL_LITE = 'gemini-future-lite';
  ctx._clearScriptPropertyCache();
  assert.equal(cfg.GEMINI_MODELS['flash-primary'].name, 'gemini-future-flash');
  assert.equal(cfg.GEMINI_MODELS['flash-lite'].name, 'gemini-future-lite');
  assert.equal(ctx.validateConfig().valid, true, file);
  for (const task of ['quick_check', 'classification', 'language', 'semantic']) {
    assert(cfg.MODEL_STRATEGY[task].includes('flash-lite-latest'));
    assert(cfg.MODEL_STRATEGY[task].includes('flash-primary'));
  }
  assert(cfg.MODEL_STRATEGY.generation.includes('flash-3.6'));
  cfg.MODEL_STRATEGY.generation = ['flash-primary', 'flash-latest'];
  delete cfg.GEMINI_MODELS['flash-3.7'];
  delete cfg.GEMINI_MODELS['flash-3.7-backup'];
  assert.equal(ctx.validateConfig().valid, true, 'no mandatory historic model names');
  cfg.MODEL_STRATEGY.semantic = ['missing'];
  assert.equal(ctx.validateConfig().valid, false);
  cfg.MODEL_STRATEGY.semantic = ['flash-lite', 'flash-lite-backup', 'flash-lite-latest', 'flash-primary'];
  if (config) assert.deepEqual(JSON.parse(JSON.stringify(cfg.MODEL_STRATEGY)), JSON.parse(JSON.stringify(config.MODEL_STRATEGY)));
  config = cfg;
}
const ctx = vm.createContext({console:quiet, CONFIG:config, Utilities:{sleep(){throw Error('unexpected sleep');}}});
load(ctx, 'gas_classifier.js','gas_email_processor.js','gas_gemini_service.js','gas_rate_limiter.js','gas_thread_generation.js');
const classifier = new ctx.Classifier();
for (const body of ['> vecchio testo', '-- \nMario Rossi']) {
  assert.equal(classifier.classifyEmail('Re:',body,true).reason,'empty_email');
  assert.equal(classifier.classifyEmail('',body,false).reason,'empty_email');
}
assert.equal(classifier.classifyEmail('Quali sono gli orari?', '> vecchio',false).shouldReply,true);
const processor = Object.create(ctx.EmailProcessor.prototype);
for (const withGlobal of [false,true]) {
  if (withGlobal) load(ctx, 'gas_error_types.js');
  for (const error of ['401 UNAUTHENTICATED','403 PERMISSION_DENIED','400 INVALID_ARGUMENT: API key not valid','API_KEY_INVALID','Forbidden']) {
    assert.equal(processor._classifyError(Error(error)).type, 'INVALID_API_KEY', error);
  }
  assert.equal(processor._classifyError(Error('400 INVALID_ARGUMENT: unsupported parameter')).type,'FATAL');
}
const service = Object.create(ctx.GeminiService.prototype);
Object.assign(service, {config, primaryKey:'primary', backupKey:'backup', _withRetry:fn=>fn()});
let calls = [];
assert.equal(service._runConfiguredTask_('semantic', name=>{
  calls.push(name);
  if (name !== 'gemini-future-flash') throw Error('404 models/' + name + ' not found');
  return 'ok';
}), 'ok');
assert.deepEqual(calls, ['gemini-future-lite','gemini-flash-lite-latest','gemini-future-flash']);
calls = [];
assert.equal(service._runConfiguredTask_('semantic', (name, context)=>{
  calls.push(context.usesBackupKey);
  if (!context.usesBackupKey) throw Error('PRIMARY_QUOTA_EXHAUSTED');
  return 'backup-ok';
}), 'backup-ok');
assert.deepEqual(calls, [false,true]);
calls = [];
assert.throws(()=>service._runConfiguredTask_('semantic', name=>{calls.push(name); throw Error('404 cachedContent missing');}), /cachedContent/);
assert.equal(calls.length,1, 'cache miss does not retire models');

// Limiter: consecutive 404s traverse the full configured chain even with one retry.
const limiter = Object.create(ctx.GeminiRateLimiter.prototype);
Object.assign(limiter, {models:config.GEMINI_MODELS, strategies:config.MODEL_STRATEGY,
  props:{getProperty:()=>null}, _getRequestsInWindow:()=>1, _trackRequest(){}, _releaseReservation(){}});
limiter._selectAndReserveModel = (task, options)=>{
  const key = (options.forceModel ? [options.forceModel] : limiter.strategies[task]).find(k=>!options.excludeModelKeys.has(k));
  return key ? {available:true, modelKey:key, model:limiter.models[key], reservationId:key} : {available:false, reason:'exhausted'};
};
calls = [];
const response = limiter.executeRequest('semantic', name=>{
  calls.push(name);
  if (name !== 'gemini-future-flash') throw Error('404 models/' + name + ' not found');
  return {__rateLimiterEnvelope:true,result:'success',actualTokens:37};
}, {maxRetries:1, estimatedTokens:10});
assert.equal(response.result,'success');
assert.equal(response.actualTokens,37);
assert.deepEqual(calls,['gemini-future-lite','gemini-flash-lite-latest','gemini-future-flash']);
calls = [];
assert.throws(()=>limiter.executeRequest('semantic', name=>{calls.push(name); throw Error('404 model not found');}, {maxRetries:1}),/404/);
assert.equal(calls.length,3, 'all absent models terminate without repeats');
assert.equal(limiter._normalizeDeprecatedModelNames({'old':{name:'gemini-3.6-flash'}}).old.name,'gemini-3.6-flash');

// Generation must skip the backup key of a missing endpoint and recover on the next model.
const plans = ['retired','retired','current'].map((model,i)=>({model,key:'key',name:String(i),usesBackupKey:i===1}));
calls = [];
const outcome = ctx.ThreadGeneration.generate({config:{}, _isNearDeadline:()=>false,
  _buildGenerationStrategies_:()=>({attemptStrategy:plans}), _classifyError:e=>processor._classifyError(e),
  _isNoReplyToken_:()=>false, geminiService:{generateResponse(prompt,opts){
    calls.push(opts.modelName); if(opts.modelName==='retired') throw Error('404 models/retired not found'); return 'answer';
  }}}, {result:{},messageDetails:{},fullPrompt:'prompt',markFailureForCurrentBurst(){assert.fail('unexpected failure');}});
assert.equal(outcome.response,'answer');
assert.deepEqual(calls,['retired','current']);

// Auxiliary calls retain accounting, attachments and the selected backup key.
service.useRateLimiter = true;
service._estimateTokens = (prompt, attachments)=>{assert.equal(attachments.length,1); return 99;};
service._generateWithModelEnvelope_ = (prompt,model,key,attachments)=>{
  assert.equal(key,'backup'); assert.equal(attachments.length,1);
  return {__rateLimiterEnvelope:true,result:'semantic result',actualTokens:123};
};
service.rateLimiter = {executeRequest(task, fn, options){
  assert.equal(task,'semantic'); assert.equal(options.estimatedTokens,99);
  const envelope = fn('configured-model',{usesBackupKey:true});
  assert.equal(envelope.actualTokens,123);
  return {success:true,result:envelope.result};
}};
assert.equal(service.generateForTask('semantic','prompt',{attachments:[{}]}),'semantic result');
console.log('Model resilience and configuration regressions passed');
