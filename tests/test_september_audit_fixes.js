const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const root = path.resolve(__dirname, '..');
const quiet = { log() {}, warn() {}, error() {}, info() {} };
function context(files, globals = {}) {
  const ctx = vm.createContext({ console: quiet, CONFIG: {}, Set, Map, ...globals });
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
  return ctx;
}
function store() {
  const values = new Map();
  return { values, getProperty: k => values.get(k) || null,
    setProperty: (k, v) => values.set(k, String(v)), deleteProperty: k => values.delete(k),
    getProperties: () => Object.fromEntries(values) };
}

// Trasporto reale + orchestrazione: quota ritentabile, errore permanente solo sul burst,
// budget locale e lock non producono invii né marcature di esito incerto.
{
  const props = store(), cached = new Map();
  const ctx = context(['gas_error_types.js', 'gas_gmail_service.js', 'gas_email_processor.js',
    'gas_thread_delivery.js', 'gas_thread_selection.js'], {
    PropertiesService: { getScriptProperties: () => props },
    CacheService: { getScriptCache: () => ({ get: k => cached.get(k) || null,
      put: (k, v) => cached.set(k, String(v)), remove: k => cached.delete(k) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'bot@example.org' }) },
    GmailApp: { getAliases: () => [] }
  });
  function sendCase(errorText, limit, counterLock = false) {
    props.values.clear(); cached.clear();
    ctx.CONFIG.GMAIL_DAILY_CALL_LIMIT = limit || 18000;
    const gmail = new ctx.GmailService();
    gmail._base64EncodeUtf8_ = s => Buffer.from(s).toString('base64');
    gmail._base64UrlEncodeUtf8_ = s => Buffer.from(s).toString('base64url');
    if (limit) cached.set(gmail._getGmailCounterDateKey_(), String(limit - 1));
    if (counterLock) gmail._incrementGmailCallCounterOrThrow_ = () => {
      throw new Error('GMAIL_COUNTER_LOCK_NOT_ACQUIRED_RETRYABLE');
    };
    let raw = 0, native = 0;
    const labels = [], permanent = [];
    gmail.addLabelToThread = () => { throw new Error('Unexpected thread-wide label'); };
    ctx.Gmail = { Users: { Messages: { send() { raw++; if (errorText) throw new Error(errorText); } } } };
    const message = { getId: () => 'm1', getFrom: () => 'user@example.org', getReplyTo: () => '',
      getThread: () => thread, reply() { native++; if (errorText) throw new Error(errorText); } };
    const thread = { getId: () => 't1', getMessages: () => [message], reply: message.reply };
    const processor = Object.create(ctx.EmailProcessor.prototype);
    const deps = { config: { dryRun: false }, gmailService: gmail, props,
      _recordConfirmedDuplicateReply_() {}, _addValidationErrorLabel() { labels.push('validation'); } };
    for (const name of ['_beginSendTransaction', '_rollbackSendTransaction', '_commitSendTransaction', '_classifyError']) {
      deps[name] = processor[name].bind(processor);
    }
    const result = {}, delivery = { confirmed: false };
    ctx.ThreadDelivery.send(deps, {
      response: 'Test reply', result, startTime: Date.now(), threadLogger: quiet,
      messageState: { candidate: message, responseContextMessages: [message], markHandledUnreadOnce() {},
        markFailureForCurrentBurst(type) { permanent.push(type); } },
      skipLock: false, messageDetails: { senderEmail: 'user@example.org', recipientEmail: 'bot@example.org',
        subject: 'Info', rfc2822MessageId: '<m@example.org>' }, delivery,
      duplicateReplyFingerprintContext: null, threadId: 't1', usedLookbackAttachments: false
    });
    assert.deepStrictEqual(labels, []);
    if (!errorText && !limit && !counterLock) assert.equal(delivery.confirmed, true);
    else assert.equal(delivery.confirmed, false);
    assert(![...props.values.keys()].some(k => k.startsWith('send_uncertain_')));
    if (errorText === 'Quota exceeded (429)') {
      assert.equal(result.errorClass, 'QUOTA_EXCEEDED');
      assert.deepStrictEqual(permanent, []);
      gmail._getOptionalLabelIdByName = name => name ? 'Label_' + name : null;
      gmail._getMessageMetadataWithResilience = () => ({ labelIds: ['UNREAD', 'INBOX'] });
      const selected = ctx.ThreadSelection.unread({ config: { labelName: 'IA', errorLabelName: 'Errore', validationErrorLabel: 'Verifica' },
        gmailService: gmail, _normalizeEmailAddress_: x => x }, {
        labeledMessageIds: new Set(), skippedMessageIds: new Set(), languageMode: 'all',
        threadLogger: quiet, myEmail: 'bot@example.org', gmailAliases: [], unreadMessages: [message]
      });
      assert.equal(selected.unlabeledUnread.length, 1);
    }
    if (errorText === 'invalid argument') assert.deepStrictEqual(permanent, ['error']);
    if (limit || counterLock) {
      assert.equal(raw, 0); assert.equal(native, 0); assert.deepStrictEqual(permanent, []);
    }
  }
  sendCase('Quota exceeded (429)');
  sendCase('invalid argument');
  sendCase(null, 2);
  sendCase(null, null, true);
  sendCase(null);
}

// Estratti e certificati non implicano volontà di cancellazione dai registri.
{
  const ctx = context(['gas_request_classifier.js', 'gas_prompt_engine.js']);
  const classifier = new ctx.RequestTypeClassifier();
  const engine = Object.create(ctx.PromptEngine.prototype);
  const subject = 'Richiesta certificato di battesimo';
  const body = 'Vorrei un estratto dal registro del battesimo per il matrimonio. Come posso richiederlo?';
  for (const topic of ['Richiesta di un estratto dal registro del battesimo', 'Consultazione dei registri del battesimo']) {
    const result = classifier.classify(subject, body, { category: 'TECHNICAL', topic, confidence: 0.95,
      dimensions: { technical: 1, pastoral: 0, doctrinal: 0, formal: 0 } });
    assert.equal(result.isSbattezzo, false);
    assert.equal(result.type, 'technical');
    assert.equal(engine._isSbattezzoRequest_({ topic, category: 'document_request', requestType: result }), false);
  }
  for (const topic of ['sbattezzo', 'cancellazione dai registri del battesimo', 'uscire dalla chiesa']) {
    assert.equal(classifier.classify('Richiesta', 'Vorrei informazioni sulla procedura.', {
      category: 'FORMAL', topic, confidence: 0.95 }).isSbattezzo, true);
  }
}

// Esiti per indirizzo, compresi SNC, civici diversi della stessa via e fallback testuale.
{
  const ctx = context(['gas_territory_validator.js', 'gas_response_validator.js', 'gas_email_processor.js', 'gas_thread_context.js']);
  const processor = Object.create(ctx.EmailProcessor.prototype);
  processor.territoryValidator = new ctx.TerritoryValidator({ logger: quiet });
  const validator = new ctx.ResponseValidator();
  function territory(body) {
    return ctx.ThreadContext.territory(processor, { messageDetails: { subject: 'Territorio', body },
      quickCheck: {}, requestType: {}, bodyForLanguageDetection: body });
  }
  const snc = territory('Via Bruno Buozzi SNC rientra nel territorio?');
  assert(snc.territoryContext.includes('VERIFICA MANUALE NECESSARIA'));
  assert(!snc.territoryContext.includes('NON RIENTRA'));
  for (const input of [snc, { territoryContext: snc.territoryContext }]) {
    assert.equal(validator._checkTerritoryConsistency('Serve una verifica manuale del territorio.', input).score, 1);
    assert.equal(validator._checkTerritoryConsistency('L indirizzo non rientra nel territorio.', input).score, 0);
    assert.equal(validator._checkTerritoryConsistency('L indirizzo rientra nel territorio.', input).score, 0);
  }
  const mixed = territory('Via Adolfo Cancani 10 e via Flaminia 20 rientrano nel territorio?');
  for (const input of [mixed, { territoryContext: mixed.territoryContext }]) {
    for (const reply of [
      'Via Adolfo Cancani 10 rientra nel territorio. Via Flaminia 20 non rientra nel territorio.',
      'Via Flaminia 20 non rientra nel territorio; via Adolfo Cancani 10 rientra nel territorio.',
      'Non rientra nel territorio via Flaminia 20; rientra nel territorio via Adolfo Cancani 10.',
      'Via Adolfo Cancani rientra nel territorio; via Flaminia non rientra nel territorio.'
    ]) assert.equal(validator._checkTerritoryConsistency(reply, input).score, 1, reply);
    for (const reply of [
      'Via Adolfo Cancani 10 non rientra nel territorio. Via Flaminia 20 rientra nel territorio.',
      'Non rientra nel territorio via Adolfo Cancani 10; rientra nel territorio via Flaminia 20.',
      'Via Adolfo Cancani 10 e via Flaminia 20 rientrano nel territorio.',
      'Via Adolfo Cancani 10 e via Flaminia 20 non rientrano nel territorio.',
      'Si, rientra nel territorio.', 'L indirizzo non rientra nel territorio.'
    ]) assert.equal(validator._checkTerritoryConsistency(reply, input).score, 0, reply);
  }
  const sameStreet = territory('Via Flaminia 160 e via Flaminia 20 rientrano nel territorio?');
  assert.equal(sameStreet.territoryResult.addresses.length, 2);
  assert.equal(validator._checkTerritoryConsistency('Via Flaminia 160 rientra nel territorio; via Flaminia 20 non rientra nel territorio.', sameStreet).score, 1);
  assert.equal(validator._checkTerritoryConsistency('Via Flaminia 20 rientra nel territorio; via Flaminia 160 non rientra nel territorio.', sameStreet).score, 0);
  const missing = territory('Via Flaminia rientra nel territorio?');
  assert.equal(validator._checkTerritoryConsistency('Serve indicare il numero civico.', missing).score, 1);
  assert.equal(validator._checkTerritoryConsistency('L indirizzo rientra nel territorio.', missing).score, 0);
  const runtime = ctx.ThreadContext.runtime({
    _buildRuntimeContext_: () => ({ temporal: { currentDate: '2026-09-30' } }),
    _extractSacramentalDeadlineContext_: () => null, _buildResponseValidationContext_: () => ({}),
    _resolveScheduleContext: () => ({})
  }, { messageDetails: {}, classification: {}, territoryContext: mixed.territoryContext,
    territoryResult: mixed.territoryResult });
  assert.strictEqual(runtime.runtimeContext.territoryResult, mixed.territoryResult);
}

// FORCE_RELOAD salta entrambe le cache e riscrive il payload da Sheets.
{
  let reads = 0;
  const props = store(), values = new Map();
  const cache = { get: k => values.get(k) || null, put: (k, v) => values.set(k, v),
    remove: k => values.delete(k), removeAll: keys => keys.forEach(k => values.delete(k)) };
  const ctx = context(['gas_main.js'], { CONFIG: { SPREADSHEET_ID: 'test', FORCE_RELOAD: true, KB_SHEET_NAME: 'Istruzioni' },
    PropertiesService: { getScriptProperties: () => props },
    CacheService: { getScriptCache: () => cache },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    SpreadsheetApp: { openById() { reads++; return { getSheetByName: name => name === 'Istruzioni'
      ? { getDataRange: () => ({ getValues: () => [['Informazione aggiornata dal foglio']] }) } : null }; } }
  });
  values.set('SPA_KNOWLEDGE_BASE_V2', JSON.stringify({ loaded: true, lastLoadedAt: Date.now(), knowledgeBase: 'vecchia' }));
  ctx.GLOBAL_CACHE.loaded = true; ctx.GLOBAL_CACHE.lastLoadedAt = Date.now(); ctx.GLOBAL_CACHE.knowledgeBase = 'vecchia RAM';
  ctx.loadResources(true, false);
  assert.equal(reads, 1);
  assert(ctx.GLOBAL_CACHE.knowledgeBase.includes('Informazione aggiornata'));
  assert(JSON.parse(values.get('SPA_KNOWLEDGE_BASE_V2')).knowledgeBase.includes('Informazione aggiornata'));
  ctx.CONFIG.FORCE_RELOAD = false; ctx.GLOBAL_CACHE.loaded = false;
  ctx.loadResources(true, false);
  assert.equal(reads, 1, 'cache persistente riutilizzata senza FORCE_RELOAD');
}

// Writer e lettore condividono la soglia; soglie alte e avanzamento restano supportati.
for (const limit of [1, 3, 6, 10, 20]) {
  const props = store();
  const ctx = context(['gas_main.js', 'gas_email_processor.js'], {
    CONFIG: { BATCH_CHECKPOINT_MAX_RETRIES: limit },
    PropertiesService: { getScriptProperties: () => props }
  });
  const processor = Object.create(ctx.EmailProcessor.prototype);
  for (let attempt = 1; attempt <= limit; attempt++) {
    processor._storeBatchCheckpointAndScheduleContinuation_([{ getId: () => 'same' }], 0, 1000);
    const read = ctx._readBatchCheckpoint_();
    if (attempt === limit) {
      assert.equal(props.getProperty('EMAIL_BATCH_CHECKPOINT'), null, 'writer deve fermarsi alla stessa soglia del lettore');
      assert.equal(read, null);
    } else {
      assert(props.getProperty('EMAIL_BATCH_CHECKPOINT'), 'checkpoint sotto soglia conservato');
      assert.equal(Boolean(read.abandoned), false);
    }
  }
  assert.equal(props.getProperty('EMAIL_BATCH_CHECKPOINT'), null);
  if (limit > 1) {
    processor._storeBatchCheckpointAndScheduleContinuation_([{ getId: () => 'first' }], 0, 1000);
    processor._storeBatchCheckpointAndScheduleContinuation_([{ getId: () => 'second' }], 0, 1000);
    const read = ctx._readBatchCheckpoint_();
    assert.equal(read.retryCount, 1); assert.equal(read.depth, 1);
  }
}
console.log('September audit regressions: all seven fixes passed');
