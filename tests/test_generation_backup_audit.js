const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const ctx = vm.createContext({console: {log(){}, warn(){}, error(){}}, CONFIG: {},
  Utilities: {sleep(){}}, LockService: {getScriptLock: () => ({tryLock: () => true, releaseLock(){}})}});
for (const file of ['gas_error_types.js', 'gas_rate_limiter.js', 'gas_gemini_service.js',
  'gas_email_processor.js', 'gas_thread_generation.js', 'gas_thread_policy.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, {filename: file});
}
function fixture() {
  const props = new Map(), calls = [], selections = [], finalized = [], tracked = [];
  const limiter = Object.create(ctx.GeminiRateLimiter.prototype);
  Object.assign(limiter, {models: {primary: {name: 'model', rpm: 10, tpm: 1000, rpd: 100}, 'primary-backup': {name: 'model', rpm: 10, tpm: 1000, rpd: 100, useCases: ['backup']}},
    strategies: {generation: ['primary', 'primary-backup']}, defaultMaxRetries: 2,
    props: {getProperty: k => props.has(k) ? props.get(k) : null, setProperty: (k,v) => props.set(k,v)},
    _getPacificDate: () => '2026-10-17',
    _selectAndReserveModel(_task, options = {}) {
      const excluded = options.excludeModelKeys || new Set();
      let modelKey = options.forceModel;
      if (!modelKey || excluded.has(modelKey) || (options.requireBackupKey && !this._modelUsesBackupKey_(modelKey, this.models[modelKey]))) {
        modelKey = this.strategies.generation.find(key => !excluded.has(key) &&
          (!options.requireBackupKey || this._modelUsesBackupKey_(key, this.models[key])));
      }
      if (!modelKey || !this.models[modelKey]) return {available: false, reason: 'all_quotas_exhausted'};
      const reservationId = `res-${selections.length + 1}`;
      props.set(`rpd_${modelKey}`, String((Number(props.get(`rpd_${modelKey}`)) || 0) + 1));
      if (!props.has(`tokens_${modelKey}`)) props.set(`tokens_${modelKey}`, '0');
      selections.push({modelKey, requireBackupKey: options.requireBackupKey === true, estimatedTokens: options.estimatedTokens});
      return {available: true, modelKey, model: this.models[modelKey], reservationId};
    },
    _trackRequest(modelKey, tokens) {
      props.set(`tokens_${modelKey}`, String((Number(props.get(`tokens_${modelKey}`)) || 0) + tokens));
      tracked.push({modelKey, tokens});
    },
    _finalizeReservation: modelKey => finalized.push(modelKey),
    _releaseReservation: modelKey => finalized.push(modelKey),
    _getRequestsInWindow: () => 0});
  const service = Object.create(ctx.GeminiService.prototype);
  Object.assign(service, {primaryKey: 'p', backupKey: 'b', modelName: 'model', config: {MAX_OUTPUT_TOKENS: 6000},
    useRateLimiter: true, rateLimiter: limiter, _estimateTokens: () => 20,
    _generateWithModelEnvelope_(prompt, model, key, attachments, overrides) {
      calls.push({key, budget: overrides?.maxOutputTokens || 6000});
      return {__rateLimiterEnvelope: true, text: 'Risposta completa', actualTokens: 12};
    }});
  return {service, limiter, props, calls, selections, finalized, tracked};
}
const truncated = () => Object.assign(new Error('Risposta troncata da Gemini (MAX_TOKENS)'),
  {code: 'TRUNCATED_OUTPUT', isTransient: false});

// Ogni tentativo su chiave backup passa dal limiter e usa il modelKey backup.
for (const mode of ['success', 'transient', 'truncated', 'exhausted', 'unlisted']) {
  const {service, limiter, props, calls, selections, tracked} = fixture();
  const generate = service._generateWithModelEnvelope_;
  service._generateWithModelEnvelope_ = function(...args) {
    const response = generate.apply(this, args);
    if (mode === 'truncated') throw truncated();
    if (mode === 'transient' && calls.length === 1) throw Object.assign(new Error('Network error'), {isTransient: true});
    return response;
  };
  if (mode === 'exhausted') service.isPrimaryExhausted = true;
  if (mode === 'unlisted') delete limiter.models['primary-backup'];
  const options = {apiKey: mode === 'exhausted' ? 'p' : 'b'};
  if (mode === 'truncated') assert.throws(() => service.generateResponse('prompt', options), e => e.code === 'TRUNCATED_OUTPUT');
  else assert.equal(service.generateResponse('prompt', options).text, 'Risposta completa');
  const attempts = ['transient', 'truncated'].includes(mode) ? 2 : 1;
  assert.equal(calls.length, attempts, mode);
  assert(calls.every(call => call.key === 'b'), mode);
  assert.equal(props.get('rpd_primary-backup'), String(attempts), mode);
  assert.equal(props.get('tokens_primary-backup'), mode === 'truncated' ? '0' : '12', mode);
  assert.equal(props.has('rpd_primary'), false, mode);
  assert(selections.every(selection => selection.modelKey === 'primary-backup' && selection.requireBackupKey), mode);
  assert.equal(tracked.length, mode === 'truncated' ? 0 : 1, mode);
  if (mode === 'truncated') assert.deepEqual(calls.map(c => c.budget), [6000, 12000]);
}

// Anche il failover deciso dopo il tentativo primary resta sotto controllo del limiter.
{
  const {service, limiter, props, calls, selections, tracked} = fixture();
  limiter.defaultMaxRetries = 1;
  service._generateWithModelEnvelope_ = (prompt, model, key) => {
    calls.push({key});
    if (key === 'p') throw Object.assign(new Error('PRIMARY_QUOTA_EXHAUSTED'), {isTransient: true});
    return {__rateLimiterEnvelope: true, text: 'Risposta completa', actualTokens: 12};
  };
  assert.equal(service.generateResponse('prompt', {apiKey: 'p'}).text, 'Risposta completa');
  assert.deepEqual(calls.map(call => call.key), ['p', 'b']);
  assert.equal(props.get('rpd_primary'), '1');
  assert.equal(props.get('rpd_primary-backup'), '1');
  assert.equal(props.get('tokens_primary-backup'), '12');
  assert.deepEqual(selections.map(selection => [selection.modelKey, selection.requireBackupKey]), [
    ['primary', false], ['primary-backup', true]
  ]);
  assert.deepEqual(tracked.map(entry => entry.modelKey), ['primary-backup']);
}

// Il retry con budget maggiore appartiene al servizio; la cascata termina dopo di esso.
for (const primary of [false, true]) for (const successOnRetry of [false, true]) {
  const {service, limiter, calls, props} = fixture();
  if (primary) {
    limiter._selectAndReserveModel = () => {
      limiter._incrementCountersAtomic('primary', 0);
      return {available: true, modelKey: 'primary', model: limiter.models.primary, reservationId: 'reserved'};
    };
    limiter._finalizeReservation = () => {};
    limiter._getRequestsInWindow = () => 0;
  }
  const generate = service._generateWithModelEnvelope_;
  service._generateWithModelEnvelope_ = function(...args) {
    const response = generate.apply(this, args);
    if (!successOnRetry || calls.length === 1) throw truncated();
    return response;
  };
  const result = {}, marks = [];
  const output = ctx.ThreadGeneration.generate({config: {}, geminiService: service,
    _isNearDeadline: () => false, _isNoReplyToken_: () => false,
    _classifyError: ctx.EmailProcessor.prototype._classifyError,
    _buildGenerationStrategies_: () => ({attemptStrategy: [
      {name: 'first', key: primary ? 'p' : 'b', model: 'model', usesBackupKey: !primary},
      {name: 'next', key: 'p', model: 'other'}]})},
  {result, messageDetails: {}, fullPrompt: 'prompt', attachmentBlobs: [],
    markFailureForCurrentBurst: (...args) => marks.push(args)});
  assert.equal(calls.length, 2);
  assert.equal(props.get(primary ? 'rpd_primary' : 'rpd_primary-backup'), '2');
  if (successOnRetry) { assert.equal(output.response, 'Risposta completa'); assert.equal(marks.length, 0); }
  else { assert.equal(result.reason, 'truncated_output'); assert.equal(result.retryable, false); assert.equal(marks.length, 1); }
}

// Sequenze proprie bloccate anche prima dell'ultimo messaggio esterno; integrazioni esterne ammesse.
for (const [senders, blocked] of [['BBBBBE', true], ['BBBBE', false], ['EEEEEE', false], ['BEBEBE', false]]) {
  const result = {};
  ctx.ThreadPolicy.loopAndSender({config: {maxConsecutiveBotReplies: 5}, _normalizeEmailAddress_: s => s,
    _evaluatePreAiRules_: () => null, _applyPreAiRuleDecision_: () => false, _shouldIgnoreEmail: () => false},
  {messages: [...senders].map((sender, i) => ({getFrom: () => sender, getDate: () => new Date(i * 1200000)})),
    ownAddresses: new Set(['B']), messageState: {markFailureForCurrentBurst(){}},
    messageDetails: {senderEmail: 'E'}, result, buildRuleContext: x => x});
  assert.equal(result.reason === 'possible_email_loop', blocked, senders);
}

// Il throttle viene prenotato solo dopo una decisione positiva dei filtri.
const {runScenario} = require('./helpers/thread_scenario');
for (const scenario of [{newsletter: true}, {autoReply: true}, {quickReject: true}, {}]) {
  const out = runScenario(root, scenario);
  const throttles = out.effects.filter(([event, value]) => event === 'cache.put' && value[0].startsWith('sender_throttle_'));
  assert.equal(throttles.length, Object.keys(scenario).length ? 0 : 1, JSON.stringify(scenario));
}
const throttled = runScenario(root, {throttled: true});
assert.equal(throttled.result.reason, 'cross_thread_burst');
assert(!throttled.effects.some(([event]) => event === 'generate' || event === 'send'));
console.log('Regressioni troncamento, backup, anti-loop e throttle superate');
