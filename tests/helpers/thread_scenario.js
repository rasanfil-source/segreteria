// Offline characterization harness: fixed clock, in-memory services and ordered effects.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const NOW = Date.UTC(2026, 8, 25, 10, 0);
const clean = value => JSON.parse(JSON.stringify(value, (key, item) => {
  if (key === 'stack') return undefined;
  if (typeof item === 'function') return '[function]';
  if (item instanceof Set) return [...item];
  return item;
}));

function runScenario(root, scenario = {}, instrumentation = {}) {
  const effects = [];
  const record = (name, value) => effects.push([name, clean(value === undefined ? null : value)]);
  const props = new Map();
  const cache = new Map();
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [NOW])); }
    static now() { return NOW; }
  }
  const logger = { info() {}, warn() {}, debug() {}, error() {},
    withMeta() { return this; }, withContext(name) { return { ...this, name }; } };
  const context = vm.createContext({
    Date: FixedDate, Set, Map, Math: Object.assign(Object.create(Math), { random: () => 0.123456789 }),
    console: { log() {}, warn() {}, error() {}, info() {} },
    CONFIG: { LABEL_NAME: 'IA', ERROR_LABEL_NAME: 'Errore', VALIDATION_ERROR_LABEL: 'Verifica',
      SKIP_LABEL_NAME: '·', VALIDATION_ENABLED: true, DRY_RUN: !!scenario.dryRun,
      ATTACHMENT_CONTEXT: { enabled: true, ...(scenario.attachmentSettings || {}) },
      INTELLIGENT_RETRY: { enabled: true, maxRetries: 1, onlyForErrors: ['thinking_leak'] } },
    GLOBAL_CACHE: { languageMode: scenario.foreignOnly ? 'foreign_only' : 'all',
      aiCore: 'Principi pastorali', doctrineBase: 'Dottrina di riferimento' },
    createLogger: () => logger,
    Session: { getEffectiveUser: () => ({ getEmail: () => 'bot@example.org' }), getScriptTimeZone: () => 'Europe/Rome' },
    GmailApp: { getAliases: () => ['alias@example.org'] },
    CacheService: { getScriptCache: () => ({ get: k => cache.get(k),
      put: (k, v) => { record('cache.put', [k, v]); cache.set(k, v); },
      remove: k => { record('cache.remove', k); cache.delete(k); } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props.get(k) || null,
      getProperties: () => Object.fromEntries(props),
      setProperty: (k, v) => { record('props.set', [k, v]); props.set(k, v); },
      deleteProperty: k => { record('props.delete', k); props.delete(k); } }) },
    LockService: { getScriptLock: () => ({ tryLock: ms => { record('lock.acquire', ms); return !scenario.lockDenied; },
      releaseLock: () => record('lock.release') }) },
    Utilities: { sleep: ms => record('sleep', ms) },
    TerritoryValidator: class {}, GeminiService: class {}, Classifier: class {},
    RequestTypeClassifier: class {}, ResponseValidator: class {}, GmailService: class {},
    PromptEngine: class {}, MemoryService: class {}
  });
  const files = ['gas_response_strategy.js', 'gas_error_types.js', 'gas_prompt_context.js',
    ...fs.readdirSync(root).filter(f => /^gas_thread_.*\.js$/.test(f)).sort(), 'gas_email_processor.js'];
  for (const file of (instrumentation.reverseLoad ? [...files].reverse() : files)) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: path.join(root, file) });
  }
  if (instrumentation.componentCalls) {
    for (const [name, component] of Object.entries(context).filter(([name]) => /^Thread/.test(name))) {
      for (const [method, original] of Object.entries(component)) {
        if (typeof original !== 'function') continue;
        const key = `${name}.${method}`;
        if (!instrumentation.componentCalls.has(key)) instrumentation.componentCalls.set(key, 0);
        component[method] = function(...args) {
          instrumentation.componentCalls.set(key, instrumentation.componentCalls.get(key) + 1);
          return original.apply(this, args);
        };
      }
    }
  }
  const body = scenario.body ?? 'Buongiorno, quali documenti servono per iscrivere mio figlio al catechismo?';
  const makeMessage = (id, text, offset, from = 'user@example.org', attachment = false) => ({
    getId: () => id, getFrom: () => from, getSubject: () => scenario.subject || 'Informazioni catechismo',
    getDate: () => new FixedDate(NOW + offset), getPlainBody: () => text,
    isUnread: () => true,
    getAttachments: () => { record('attachments.read', id); if (scenario.attachmentReadError) throw new Error('Attachment unavailable'); return attachment ? [{ getName: () => 'documento.pdf' }] : []; },
    text, attachment
  });
  const candidate = makeMessage('m2', body, -60000, scenario.sender || (scenario.ownOnly ? 'bot@example.org' : 'user@example.org'), scenario.attachment);
  let messages = scenario.burst
    ? [makeMessage('m1', 'Prima domanda: come iscriversi?', scenario.sameDate ? -60000 : -120000, 'user@example.org', scenario.attachment), candidate]
    : [candidate];
  if (scenario.otherSender) messages.unshift(makeMessage('m0', 'Domanda di altra persona', -180000, 'other@example.org'));
  if (scenario.ownLast) messages.push(makeMessage('own', 'Risposta precedente', -30000, 'bot@example.org'));
  if (scenario.history) messages.unshift(makeMessage('own0', 'Informazioni già inviate', -86400000, 'bot@example.org'));
  if (scenario.lookBack) {
    const past = makeMessage('past', 'Documento inviato', -86400000, 'user@example.org', true);
    past.isUnread = () => false;
    messages.unshift(past);
  }
  if (scenario.reverse) messages.reverse();
  const thread = { getId: () => 't1', getMessages: () => { record('messages.read'); return messages; },
    refresh: () => record('thread.refresh') };
  const fail = name => { throw new Error(name); };
  let generations = 0;
  let validations = 0;
  const services = {
    gmailService: {
      logger: { original: 'gmail' }, _extractEmailAddress: raw => raw,
      extractMessageDetails: message => { record('extract', message.getId()); return {
        body: message.text, subject: message.getSubject(), date: message.getDate(),
        senderEmail: message.getFrom(), senderName: 'Mario', originalFrom: message.getFrom(),
        headers: scenario.autoReply ? { 'Auto-Submitted': 'auto-replied' } : {}, isNewsletter: !!scenario.newsletter
      }; },
      getThreadHistory: (...args) => { record('history', [args[0].map(m => m.getId()), ...args.slice(1)]); return 'Precedente risposta della segreteria'; },
      getProcessableAttachments: (message, options) => { record('attachments.process', [message.getId(), options]);
        if (scenario.attachmentProcessError) fail('extraction failure'); return {
        blobs: [], textContext: scenario.ocr || 'Modulo compilato per il catechismo',
        items: [{ name: 'documento.pdf', mimeType: 'application/pdf' }], skipped: [], processedCount: 1
      }; },
      sendHtmlReply: (message, response, details) => { record('send', [message.getId(), response, details]); if (scenario.sendError) fail(scenario.sendError); },
      reconcileSendOperation: id => { record('send.reconcile', id); return !!scenario.reconciled; },
      removeLabelFromThread: (_, label) => { record('label.cleanThread', label); if (scenario.cleanupError) fail('cleanup failure'); },
      removeLabelFromMessage: (id, label) => record('label.cleanMessage', [id, label])
    },
    classifier: { logger: { original: 'classifier' }, classifyEmail: (...args) => { record('classify', args); return {
      shouldReply: !scenario.classifierReject, reason: 'fixture', category: 'technical', topic: 'catechismo'
    }; } },
    requestClassifier: { logger: { original: 'request' }, classify: (...args) => { record('request.classify', args); return { type: 'technical' }; } },
    geminiService: { logger: { original: 'gemini' }, primaryKey: 'fake-primary', backupKey: 'fake-backup',
      buildGenerationStrategies: () => ({ attemptStrategy: [
        { name: 'Primary', key: 'fake-primary', model: 'model-primary', skipRateLimit: false },
        { name: 'Backup', key: 'fake-backup', model: 'model-backup', skipRateLimit: false, usesBackupKey: true }
      ], fallbackModelName: 'model-backup' }),
      detectEmailLanguage: (...args) => { record('language', args); return { lang: scenario.language || 'it' }; },
      shouldRespondToEmail: (...args) => { record('quickCheck', args); if (scenario.quickError) fail(scenario.quickError); return scenario.quickNull ? null : {
        shouldRespond: !scenario.quickReject, reason: 'fixture', language: scenario.quickLanguage || scenario.language || 'it',
        classification: { category: 'technical', topic: 'catechismo' }, ...(scenario.quick || {})
      }; },
      getAdaptiveGreeting: (...args) => { record('greeting', args); return { greeting: 'Gentile Mario,', closing: 'Cordiali saluti' }; },
      generateResponse: (...args) => { record('generate', args); generations++;
        if (typeof args[0] === 'string' && args[0].startsWith('Rispondi SOLO con un oggetto JSON')) {
          record('semantic.check');
          return JSON.stringify({ consistent: !scenario.mismatch, reason: 'fixture consistency' });
        }
        if (scenario.firstGenerationError && generations === 1) fail(scenario.firstGenerationError);
        if (scenario.generationError) fail(scenario.generationError);
        if (scenario.retryError && generations > 1) fail(scenario.retryError);
        return scenario.response || '<email>Gentile Mario, può contattare la segreteria per iscrivere suo figlio al catechismo. Cordiali saluti.</email>';
      },
      checkAttachmentSemanticConsistency: (...args) => { record('semantic', args); return { consistent: !scenario.mismatch, reason: 'fixture' }; }
    },
    promptEngine: { buildPrompt: options => { record('prompt', options); return { systemInstruction: 'Persona test', prompt: 'Contenuto test' }; } },
    validator: { logger: { original: 'validator' }, validateResponse: (...args) => { record('validate', args); validations++;
      const invalid = scenario.invalid || (scenario.retry && validations === 1);
      return { isValid: !invalid, score: invalid ? 0.4 : (scenario.warning ? 0.85 : 1),
        errors: invalid ? ['ragionamento esposto'] : [], warnings: scenario.warning ? ['warning fixture'] : [],
        ...(scenario.selfHeal ? { fixedResponse: 'Risposta corretta dal validatore.' } : {}),
        details: invalid ? { exposedReasoning: { score: 0, errors: ['leak'] } } : {} };
    } },
    memoryService: { logger: { original: 'memory' }, getMemory: id => { record('memory.get', id); return scenario.memory || {}; },
      updateMemoryAtomic: (...args) => { record('memory.update', args); if (scenario.memoryError) fail('memory failure'); return true; } },
    territoryValidator: { analyzeEmailForAddress: (...args) => { record('territory', args); return { addressFound: false }; } }
  };
  const originals = Object.fromEntries(Object.entries(services).map(([key, value]) => [key, value.logger]));
  const processor = new context.EmailProcessor(services);
  if (scenario.crisis) context.createPromptContext = () => ({ profile: 'standard', concerns: {}, meta: { crisisCritical: true } });
  if (scenario.metadataTerminal) {
    services.gmailService._getOptionalLabelIdByName = name => 'Label_' + name;
    services.gmailService._getMessageMetadataWithResilience = id => {
      record('metadata', id); return { labelIds: ['UNREAD', 'Label_Verifica'] };
    };
  }
  processor._markMessageAsProcessed = message => { record('label.processed', message.getId()); if (scenario.markError) fail('mark failure'); };
  processor._markMessagesAsSkipped = (items, label) => record('label.skipped', [items.map(m => m.getId()), label]);
  processor._addErrorLabel = target => record('label.error', target.getId());
  processor._addValidationErrorLabel = (target, review) => record('label.review', [target.getId(), review]);
  if (scenario.commitError) processor._commitSendTransaction = () => fail('commit failure');
  if (scenario.nearDeadline) processor._isNearDeadline = () => true;
  if (scenario.sizeEstimates) processor._getMessageSizeEstimateForAttachmentDownload_ = message => scenario.sizeEstimates[message.getId()] || 0;
  if (scenario.alreadySent) cache.set('sent_m2', String(NOW));
  if (scenario.uncertainMarker) props.set('send_uncertain_m2', String(NOW));
  if (scenario.throttled) cache.set('sender_throttle_user@example.org', '1');
  if (scenario.duplicate || scenario.legacyDuplicate) {
    const details = services.gmailService.extractMessageDetails(candidate);
    const pastReference = processor._hasPastAttachmentReference_;
    if (scenario.legacyDuplicate) processor._hasPastAttachmentReference_ = () => false;
    const fingerprint = processor._buildDuplicateReplyFingerprintContext_(candidate, details);
    if (scenario.legacyDuplicate) processor._hasPastAttachmentReference_ = pastReference;
    processor._recordConfirmedDuplicateReply_(fingerprint, 'previous', 'previous-thread', NOW - 1000);
    effects.length = 0;
  }
  const labeled = new Set(scenario.labeled ? ['m2'] : []);
  const skipped = new Set();
  const result = processor.processThread(thread, 'Catechismo: iscrizioni in segreteria.', 'Dottrina', labeled, false, skipped,
    scenario.stale ? { staleOnlyMs: NOW - 120000 } : {});
  let repeatResult;
  if (scenario.repeat) {
    record('second.processing');
    repeatResult = processor.processThread(thread, 'Catechismo: iscrizioni in segreteria.', 'Dottrina', labeled, false, skipped);
  }
  const restored = Object.entries(services).every(([key, value]) => value.logger === originals[key]);
  return clean({ result, effects, restored, labeled: [...labeled], skipped: [...skipped], props: [...props],
    ...(scenario.repeat ? { repeatResult } : {}) });
}

module.exports = { runScenario };
