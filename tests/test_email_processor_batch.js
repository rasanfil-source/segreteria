const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

function createMessage({ id, unread = true, from = 'utente@example.com' }) {
  return {
    getId: () => id,
    isUnread: () => unread,
    getFrom: () => from,
    getLabels: () => []
  };
}

function createThread({ id, messages }) {
  return {
    getId: () => id,
    getMessages: () => messages
  };
}

// Mock base
global.createLogger = () => ({ info: () => {}, warn: () => {}, debug: () => {}, error: () => {} });
global.GeminiService = class {};
global.Classifier = class {};
global.RequestTypeClassifier = class {};
global.ResponseValidator = class {};
global.PromptEngine = class {};
global.MemoryService = class {};
global.TerritoryValidator = class {};

global.CONFIG = {
  LABEL_NAME: 'IA',
  ERROR_LABEL_NAME: 'Errore',
  VALIDATION_ERROR_LABEL: 'Verifica',
  SEARCH_PAGE_SIZE: 20,
  MAX_EMAILS_PER_RUN: 3,
  MIN_REMAINING_TIME_MS: 5000
};

const cacheStore = new Map();
global.CacheService = {
  getScriptCache: () => ({
    get: (k) => cacheStore.get(k) || null,
    put: (k, v) => cacheStore.set(k, v),
    remove: (k) => cacheStore.delete(k)
  })
};

global.LockService = {
  getScriptLock: () => ({
    tryLock: () => true,
    releaseLock: () => {}
  })
};

// Session non disponibile: il codice ha già fallback difensivo
global.Session = undefined;
global.PropertiesService = {
  getScriptProperties: () => ({ getProperty: () => '' })
};

const gasEmailProcessorPath = path.join(__dirname, '..', 'gas_email_processor.js');
const code = fs.readFileSync(gasEmailProcessorPath, 'utf8');
vm.runInThisContext(code, { filename: gasEmailProcessorPath });

console.log('--- Test processThread: already_labeled_no_new_unread ---');
{
  const msg = createMessage({ id: 'm1', unread: true, from: 'utente@example.com' });
  const thread = createThread({ id: 't1', messages: [msg] });
  const labeled = new Set(['m1']);

  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => raw.includes('@') ? raw : '',
      addLabelToMessage: () => {}
    }
  });

  const res = processor.processThread(thread, 'kb', '', labeled, true);
  assert(res.status === 'skipped', 'deve saltare thread senza nuovi unread non etichettati');
  assert(res.reason === 'already_labeled_no_new_unread', 'reason atteso already_labeled_no_new_unread');
}

console.log('--- Test processThread: no_external_unread ---');
{
  const msg = createMessage({ id: 'm2', unread: true, from: 'bot@example.com' });
  const thread = createThread({ id: 't2', messages: [msg] });
  const labeled = new Set();
  const marked = [];

  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => raw,
      addLabelToMessage: (id) => marked.push(id)
    }
  });

  // Forza fallback anti-loop a bot@example.com
  global.PropertiesService = {
    getScriptProperties: () => ({ getProperty: (k) => (k === 'BOT_EMAIL' ? 'bot@example.com' : '') })
  };

  const res = processor.processThread(thread, 'kb', '', labeled, true);
  assert(res.status === 'skipped', 'deve saltare thread con soli unread interni');
  assert(res.reason === 'no_external_unread', 'reason atteso no_external_unread');
  assert(marked.includes('m2'), 'deve marcare messaggio come processato nel branch no_external_unread');
}

console.log('--- Test processUnreadEmails: stop preventivo per tempo insufficiente ---');
{
  const threadA = createThread({ id: 'ta', messages: [createMessage({ id: 'ma', unread: true })] });
  const processor = new EmailProcessor({
    gmailService: { getUnprocessedUnreadThreads: () => [threadA] }
  });

  processor._hasUnreadMessagesToProcess = () => true;
  processor._isNearDeadline = () => false;
  processor._getRemainingTimeMs = () => 1000; // sotto minRemainingTimeMs

  const stats = processor.processUnreadEmails('kb', '', true);
  assert(stats.total === 0, 'con tempo insufficiente non deve processare thread');
}

console.log('--- Test processUnreadEmails: KB vuota/whitespace blocca il batch ---');
{
  const processor = new EmailProcessor({
    gmailService: { getUnprocessedUnreadThreads: () => [] }
  });

  const statsWhitespace = processor.processUnreadEmails('   ', '', true);
  assert(statsWhitespace.errors === 1, 'KB whitespace deve essere trattata come mancante');
  assert(statsWhitespace.reason === 'knowledge_base_missing', 'reason atteso knowledge_base_missing per KB whitespace');

  const statsEmpty = processor.processUnreadEmails('', '', true);
  assert(statsEmpty.errors === 1, 'KB stringa vuota deve essere trattata come mancante');
  assert(statsEmpty.reason === 'knowledge_base_missing', 'reason atteso knowledge_base_missing per KB vuota');
}

console.log('--- Test processUnreadEmails: conteggio stats skipped/replied ---');
{
  const threads = [
    createThread({ id: 't10', messages: [createMessage({ id: 'm10', unread: true })] }),
    createThread({ id: 't11', messages: [createMessage({ id: 'm11', unread: true })] }),
    createThread({ id: 't12', messages: [createMessage({ id: 'm12', unread: true })] })
  ];

  const processor = new EmailProcessor({
    gmailService: { getUnprocessedUnreadThreads: () => threads }
  });

  processor._hasUnreadMessagesToProcess = (thread) => thread.getId() !== 't10'; // primo fast-skip
  processor._isNearDeadline = () => false;
  processor._getRemainingTimeMs = () => 60000;

  let call = 0;
  processor.processThread = () => {
    call += 1;
    if (call === 1) return { status: 'replied' };
    return { status: 'skipped', reason: 'no_external_unread' };
  };

  const stats = processor.processUnreadEmails('kb', '', true);
  assert(stats.total === 3, 'totale thread analizzati deve essere 3');
  assert(stats.replied === 1, 'deve contare 1 replied');
  assert(stats.skipped >= 2, 'deve contare almeno 2 skipped (fast-skip + no_external_unread)');
  assert(stats.skipped_processed >= 1, 'deve contare fast-skip come skipped_processed');
  assert(stats.skipped_internal >= 1, 'deve contare no_external_unread come skipped_internal');
}

function createExternalThread(id) {
  const msg = createMessage({ id: `m-${id}`, unread: true, from: 'utente@example.com' });
  return createThread({ id: `t-${id}`, messages: [msg] });
}

function buildProcessorForGenerationFailure(errorTypeToThrow) {
  global.ErrorTypes = {
    INVALID_RESPONSE: 'INVALID_RESPONSE',
    UNKNOWN: 'UNKNOWN',
    INVALID_API_KEY: 'INVALID_API_KEY'
  };
  global.classifyError = (err) => {
    // Simula il comportamento del classificatore reale mappando l'errore forzato
    if (err.message.includes('INVALID_RESPONSE')) return { type: 'UNKNOWN', retryable: false, message: err.message };
    if (err.message.includes('UNKNOWN')) return { type: 'UNKNOWN', retryable: false, message: err.message };
    return { type: 'FATAL', retryable: false, message: err.message || 'err' };
  };

  const calls = [];
  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => raw,
      extractMessageDetails: () => ({
        subject: 'Richiesta informazioni',
        body: 'Vorrei sapere gli orari.',
        senderEmail: 'utente@example.com',
        senderName: 'Utente Test',
        date: new Date(),
        headers: {},
        isNewsletter: false
      }),
      addLabelToMessage: () => {},
      addLabelToThread: () => {},
      buildConversationHistory: () => ''
    },
    classifier: {
      classifyEmail: () => ({ shouldReply: true, category: 'info', subIntents: {}, confidence: 0.9 })
    },
    geminiService: {
      primaryKey: 'primary-key',
      backupKey: 'backup-key',
      shouldRespondToEmail: () => ({ shouldRespond: true, language: 'it', classification: { topic: 'orari' } }),
      detectEmailLanguage: () => ({ lang: 'it' }),
      getAdaptiveGreeting: () => 'Buongiorno',
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: (_prompt, options) => {
        calls.push(options.modelName);
        throw new Error(`forced-${errorTypeToThrow}`);
      }
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
    },
    memoryService: {
      getMemory: () => ({})
    },
    territoryValidator: {
      validateMultipleAddresses: () => ({ addressFound: false, addresses: [], summary: '' })
    },
    promptEngine: {
      buildPrompt: () => 'PROMPT'
    }
  });

  return { processor, calls };
}

console.log('--- Test processThread: fallback end-to-end su INVALID_RESPONSE ---');
{
  const labeled = new Set();
  const { processor, calls } = buildProcessorForGenerationFailure('INVALID_RESPONSE');
  const res = processor.processThread(createExternalThread('invalid-response'), 'kb valida', '', labeled, true);
  // Con il nuovo classificatore, INVALID_RESPONSE -> UNKNOWN -> continua il loop di retry strategie
  assert(calls.length === 3, `con INVALID_RESPONSE deve tentare tutte le 3 strategie (fatti: ${calls.length})`);
  assert(res.status === 'error', 'con fallback esaurito deve restituire status error');
  assert(labeled.has('m-invalid-response'), 'deve marcare il messaggio candidato come processato');
}

console.log('--- Test processThread: fallback end-to-end su UNKNOWN ---');
{
  const labeled = new Set();
  const { processor, calls } = buildProcessorForGenerationFailure('UNKNOWN');
  const res = processor.processThread(createExternalThread('unknown'), 'kb valida', '', labeled, true);
  assert(calls.length === 3, 'con UNKNOWN deve tentare tutte le 3 strategie');
  assert(res.status === 'error', 'con fallback esaurito deve restituire status error');
  assert(labeled.has('m-unknown'), 'deve marcare il messaggio candidato come processato');
}

console.log('✅ Test batch EmailProcessor passati');
