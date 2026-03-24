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

console.log('✅ Test batch EmailProcessor passati');
