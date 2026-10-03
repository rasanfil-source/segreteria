/* Test dei contratti di classificazione, cache semantica, configurazione e destinatari.
 * Carica le classi applicative e simula i servizi esterni.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const silent = { log() {}, warn() {}, error() {}, info() {} };
function load(files, globals = {}) {
  const context = vm.createContext({ console: silent, ...globals });
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
  return context;
}
function storage() {
  const values = new Map();
  return { values, get: k => values.get(k) || null, put: (k, v) => values.set(k, v), remove: k => values.delete(k) };
}
function validatorContext(cacheEnabled = true) {
  const cache = storage();
  return load(['gas_response_validator.js'], {
    CONFIG: { SEMANTIC_VALIDATION: { enabled: true, cacheEnabled } },
    CacheService: { getScriptCache: () => cache }, UrlFetchApp: {}
  });
}
const report = {};

// 1. Two equal-length responses differ in a material institutional claim.
{
  const ctx = validatorContext();
  const s = new ctx.SemanticValidator();
  const prefix = 'Gentile utente, grazie per averci scritto. '.repeat(9);
  const suffix = 'Per ulteriori informazioni può contattare la segreteria. '.repeat(7);
  const permitted = prefix + 'Il certificato è richiesto.' + suffix;
  const unsupported = prefix + 'Il certificato è opzionale.' + suffix;
  assert.equal(permitted.length, unsupported.length);
  assert.notEqual(s._hashText(permitted), s._hashText(unsupported));
  let generated = 0;
  s._generateSemantic = prompt => {
    generated++;
    return JSON.stringify({ isValid: !prompt.includes('Il certificato è opzionale.'), confidence: 0.99 });
  };
  const args = ['Il certificato è obbligatorio.', { score: 1, errors: [] }, 'Quali documenti servono?', { forceRelevanceReview: true }];
  const first = s.validateHallucinations(permitted, ...args);
  const second = s.validateHallucinations(unsupported, ...args);
  assert.equal(first.isValid, true);
  assert.equal(second.isValid, false);
  assert.equal(generated, 2);
  s.cache = null;
  const withoutCache = s.validateHallucinations(unsupported, ...args);
  assert.equal(withoutCache.isValid, false);
  report.semanticCache = { responseLength: permitted.length, sameHash: false, first, second, generatedWithCache: 2, withoutCache };
}

// Varia ogni ingresso semantico all’inizio, al centro e alla fine, conservando la lunghezza.
{
  const s = new (validatorContext().SemanticValidator)();
  let calls = 0;
  s._generateSemantic = () => { calls++; return '{"isValid":true,"confidence":0.95}'; };
  const inputs = ['R'.repeat(800), 'K'.repeat(800), 'E'.repeat(800), 'P'.repeat(800)];
  const check = values => s.validateHallucinations(values[0], values[1], { score: 1, errors: [] }, values[2], { forceRelevanceReview: true, requestPurpose: values[3] });
  check(inputs);
  check(inputs);
  assert.equal(calls, 1, 'Identical input must still use the cache');
  for (let field = 0; field < inputs.length; field++) {
    for (const index of [0, 400, 799]) {
      const changed = inputs.slice();
      changed[field] = changed[field].slice(0, index) + 'X' + changed[field].slice(index + 1);
      const before = calls;
      check(changed);
      assert.equal(calls, before + 1, `Changed field ${field}, index ${index} must miss`);
      check(changed);
      assert.equal(calls, before + 1);
    }
  }
  assert.ok(s._cacheKey('thinking', inputs[0]).startsWith('semantic_v5_'));
  s.validateThinkingLeak(inputs[0], { score: 0.7, errors: [] });
  const before = calls;
  s.validateThinkingLeak(inputs[0].slice(0, 400) + 'X' + inputs[0].slice(401), { score: 0.7, errors: [] });
  assert.equal(calls, before + 1);
}

// 2. Le espressioni negate sono distinte dalle affermazioni positive sul territorio.
{
  const ctx = validatorContext(false);
  const v = new ctx.ResponseValidator();
  v.semanticValidator = null;
  const context = { currentDate: '2026-09-28', currentTime: '12:00', territoryContext: 'NON RIENTRA' };
  const phrases = [
    "L'indirizzo non rientra nel territorio della parrocchia.",
    "L'indirizzo non fa parte del territorio della parrocchia.",
    "L'indirizzo non è nel nostro territorio."
  ];
  report.territory = phrases.map(phrase => {
    const result = v._checkTerritoryConsistency(phrase, context);
    assert.equal(result.score, 1);
    return { phrase, result };
  });
  const wrap = phrase => `Gentile utente,\n\ngrazie per averci scritto. ${phrase}\n\nCordiali saluti,\nSegreteria parrocchiale`;
  const validate = phrase => v.validateResponse(wrap(phrase), 'it', '', 'Il mio indirizzo rientra nella parrocchia?', 'Territorio', 'full', false, context);
  const negative = validate(phrases[0]);
  const outside = validate("L'indirizzo è fuori dal territorio.");
  assert.equal(negative.isValid, true);
  assert.equal(negative.errors.length, 0);
  assert.equal(outside.isValid, true);
  report.territoryPipeline = { negative: { isValid: negative.isValid, errors: negative.errors }, equivalentOutside: { isValid: outside.isValid, errors: outside.errors } };
  for (const phrase of phrases) {
    assert.equal(v._checkTerritoryConsistency(phrase, { territoryContext: 'RIENTRA' }).score, 0);
    assert.equal(v._checkTerritoryConsistency(phrase, { territoryContext: 'CIVICO NECESSARIO' }).score, 0);
    for (const join of ['. ', '; ', ', ma ']) {
      for (const mixed of [phrase + join + 'Rientra nel territorio.', 'Rientra nel territorio' + join + phrase]) {
        assert.equal(v._checkTerritoryConsistency(mixed, context).score, 0, mixed);
      }
    }
  }
  assert.equal(v._checkTerritoryConsistency('Sì, confermiamo: non rientra nel territorio.', context).score, 1);
}

// 3. Malformed semantic objects pass a mandatory relevance review.
{
  const ctx = validatorContext(false);
  const v = new ctx.ResponseValidator();
  const response = 'Gentile utente,\n\ngrazie per averci scritto. Per procedere non serve il certificato.\n\nCordiali saluti,\nSegreteria parrocchiale';
  const args = [response, 'it', 'Per procedere occorre il certificato.', 'Quali documenti servono?', 'Documenti', 'full', false, { currentDate: '2026-09-28', currentTime: '12:00' }];
  report.emptySemantic = [];
  for (const payload of ['{}', '{"error":"temporarily unavailable"}', '{"isValid":"false","confidence":0.99}', '{"isValid":true}', '{"isValid":true,"confidence":null}', '{"isValid":true,"confidence":"0.99"}']) {
    let calls = 0;
    v.semanticValidator._generateSemantic = () => { calls++; return payload; };
    const result = v.validateResponse(...args);
    assert.ok(calls > 0, 'Mandatory semantic review must actually run');
    assert.equal(result.isValid, false);
    report.emptySemantic.push({ payload, calls, isValid: result.isValid, errors: result.errors, semantic: result.details.semantic });
  }
  v.semanticValidator._generateSemantic = () => '{"isValid":false,"confidence":0.99,"reason":"Il certificato è obbligatorio"}';
  const properRejection = v.validateResponse(...args);
  assert.equal(properRejection.isValid, false);
  report.properSemanticRejection = { isValid: properRejection.isValid, errors: properRejection.errors };
  // Conserva le evidenze negative esplicite anche quando mancano verdetto o confidenza
  // o non validi; conserva l’esito restrittivo anche nei controlli opzionali.
  for (const isValid of [undefined, 'false', true]) {
    const negative = v.semanticValidator._normalizeSemanticPayload({ isValid, hallucinations: { unsupportedClaims: ['Unsupported requirement'] } });
    assert.equal(negative.isValid, false);
    assert.equal(negative.details.unsupportedClaims.length, 1);
  }
}

// 4. Exercise real GmailService -> ThreadDelivery -> real transaction methods.
function deliveryCase(stage, failure = 'Unexpected error', reconciled = false) {
  const cache = storage();
  const propValues = new Map();
  const props = {
    getProperty: k => propValues.get(k) || null,
    setProperty: (k, v) => propValues.set(k, v),
    deleteProperty: k => propValues.delete(k),
    getProperties: () => Object.fromEntries(propValues)
  };
  const ctx = load(['gas_error_types.js', 'gas_gmail_service.js', 'gas_email_processor.js', 'gas_thread_delivery.js'], {
    CONFIG: {}, CacheService: { getScriptCache: () => cache },
    PropertiesService: { getScriptProperties: () => props },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'bot@example.org' }) },
    GmailApp: { getAliases: () => [] }
  });
  let attempts = 0, delivered = 0, reconciliations = 0;
  const labels = [];
  const thread = {
    getId: () => 't1', getMessages: () => [message],
    reply: () => { attempts++; delivered++; throw new Error(failure); }
  };
  const message = {
    getId: () => 'm1', getThread: () => thread, getReplyTo: () => '', getFrom: () => 'user@example.org',
    reply: () => {
      attempts++;
      if (stage === 'html') { delivered++; throw new Error(failure); }
      if (attempts === 1 || stage === 'thread') throw new Error('Invalid argument');
      delivered++;
      throw new Error(failure);
    }
  };
  const gmail = Object.create(ctx.GmailService.prototype);
  gmail.addLabelToThread = (_thread, label) => labels.push(label);
  gmail.reconcileSendOperation = () => { reconciliations++; return reconciled; };
  const processor = Object.create(ctx.EmailProcessor.prototype);
  const deps = { config: { dryRun: false }, gmailService: gmail, props, _recordConfirmedDuplicateReply_() {}, _addValidationErrorLabel() {} };
  for (const name of ['_beginSendTransaction', '_rollbackSendTransaction', '_commitSendTransaction', '_classifyError']) deps[name] = processor[name].bind(processor);
  const result = {};
  const delivery = { confirmed: false };
  ctx.ThreadDelivery.send(deps, {
    response: 'Grazie per averci scritto.', result, startTime: Date.now(), threadLogger: silent,
    messageState: { candidate: message, responseContextMessages: [message], markHandledUnreadOnce() {}, markFailureForCurrentBurst: type => labels.push(type) },
    skipLock: false, messageDetails: { senderEmail: 'user@example.org', recipientEmail: 'bot@example.org', subject: 'Richiesta' },
    delivery, duplicateReplyFingerprintContext: null, threadId: 't1', usedLookbackAttachments: false
  });
  const guardAfterSend = props.getProperty('send_uncertain_m1');
  const nextTransaction = processor._beginSendTransaction('m1');
  const observed = { stage, attempts, simulatedDeliveries: delivered, reconciliations, labels, guardAfterSend: !!guardAfterSend, result, nextTransaction: { ok: nextTransaction.ok, reason: nextTransaction.reason } };
  assert.equal(delivered, 1);
  if (reconciled) {
    assert.equal(result.status, 'replied');
    assert.equal(result.reason, 'send_reconciled');
    assert.equal(delivery.confirmed, true);
    assert.equal(reconciliations, 1);
    assert.equal(guardAfterSend, null);
    assert.equal(nextTransaction.ok, false);
    assert.equal(nextTransaction.reason, 'already_sent');
    assert.deepEqual(labels, []);
    return observed;
  }
  assert.equal(result.errorClass, 'NETWORK');
  assert.equal(result.status, 'validation_failed');
  assert.equal(result.validationFailed, true);
  assert.equal(reconciliations, 1);
  assert.ok(guardAfterSend);
  assert.equal(nextTransaction.ok, false);
  assert.equal(nextTransaction.reason, 'gmail_send_uncertain');
  assert.deepEqual(labels, ['validation']);
  return observed;
}
report.delivery = [];
for (const stage of ['html', 'plain', 'thread']) {
  for (const failure of ['Unexpected error', 'Request timed out', 'Service unavailable (503)', 'ECONNRESET']) {
    for (const reconciled of [false, true]) report.delivery.push(deliveryCase(stage, failure, reconciled));
  }
}

console.log('Audit regressions: cache identity, semantic contract, territory polarity and ambiguous delivery passed.');
