const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

function createMessage({ id, unread = true, from = 'utente@example.com', date = null }) {
  return {
    getId: () => id,
    isUnread: () => unread,
    getFrom: () => from,
    getDate: () => date || new Date('2026-05-07T10:00:00Z')
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

console.log('--- Test _normalizeTextContent serializza oggetti KB strutturati ---');
{
  const processor = new EmailProcessor({ gmailService: {} });
  const structured = { istruzioni: [{ categoria: 'Messe', dettaglio: 'Domenica 10:00' }] };
  const normalized = processor._normalizeTextContent(structured);
  assert(normalized.includes('Messe') && normalized.includes('Domenica 10:00'), 'gli oggetti KB devono essere serializzati senza [object Object]');
  const circular = { tema: 'Catechismo' };
  circular.self = circular;
  const normalizedCircular = processor._normalizeTextContent(circular);
  assert(normalizedCircular.includes('Catechismo') && normalizedCircular.includes('[Circular]'), 'gli oggetti circolari devono avere fallback controllato');
}


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

  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (message) => warnings.push(String(message));

  const res = processor.processThread(thread, 'kb', '', labeled, true);

  console.warn = originalWarn;
  assert(res.status === 'skipped', 'deve saltare thread senza nuovi unread non etichettati');
  assert(res.reason === 'already_labeled_no_new_unread', 'reason atteso already_labeled_no_new_unread');
  assert(
    !warnings.some(msgWarn => msgWarn.includes('Impossibile recuperare email utente')),
    'non deve loggare warning Session quando Session è undefined'
  );
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
  assert(marked.includes('m2'), 'deve marcare messaggio interno con label terminale IA nel branch no_external_unread');
}


console.log('--- Test processThread: stale-only salta thread con follow-up esterni recenti ---');
{
  const oldMsg = createMessage({
    id: 'm-stale-old',
    unread: true,
    from: 'utente@example.com',
    date: new Date('2026-05-07T08:00:00Z')
  });
  const recentMsg = createMessage({
    id: 'm-stale-recent',
    unread: true,
    from: 'utente@example.com',
    date: new Date('2026-05-10T08:00:00Z')
  });
  const thread = createThread({ id: 't-stale-follow-up', messages: [oldMsg, recentMsg] });
  const labeled = new Set();
  const marked = [];

  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => raw,
      addLabelToMessage: (id) => marked.push(id),
      extractMessageDetails: () => { throw new Error('non deve estrarre dettagli quando c\'è un follow-up recente'); }
    }
  });

  const res = processor.processThread(
    thread,
    'kb',
    '',
    labeled,
    true,
    null,
    { staleOnlyMs: new Date('2026-05-09T00:00:00Z').getTime() }
  );

  console.log(`Debug test: res.status=${res.status}, res.reason=${res.reason}`);
  assert(res.status === 'skipped', "deve saltare l'intero thread stale con follow-up recente");
  assert(res.reason === 'stale_thread_has_recent_messages', 'reason atteso stale_thread_has_recent_messages');
  assert(marked.length === 0, 'non deve marcare messaggi preservati per il ciclo normale');
}

console.log('--- Test processThread: non rilascia ScriptLock se tryLock fallisce ---');
{
  const originalLockService = global.LockService;
  cacheStore.clear();
  let releaseCalled = false;

  global.LockService = {
    getScriptLock: () => ({
      tryLock: () => false,
      releaseLock: () => {
        releaseCalled = true;
      }
    })
  };

  try {
    const thread = createThread({ id: 't-lock-fail', messages: [createMessage({ id: 'm-lock-fail', unread: true })] });
    const processor = new EmailProcessor({
      gmailService: {
        _extractEmailAddress: (raw) => raw,
        addLabelToMessage: () => {}
      }
    });

    const res = processor.processThread(thread, 'kb', '', new Set(), false);
    assert(res.status === 'skipped' && res.reason === 'global_lock_unavailable', 'deve saltare se lo ScriptLock thread non è disponibile');
    assert(releaseCalled === false, 'non deve chiamare releaseLock se tryLock non ha acquisito il lock');
  } finally {
    global.LockService = originalLockService;
    cacheStore.clear();
  }
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
  const seenSkipLocks = [];
  processor.processThread = (_thread, _kb, _doctrine, _labeled, skipLock) => {
    seenSkipLocks.push(skipLock);
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
  assert(seenSkipLocks.length === 2 && seenSkipLocks.every(Boolean), 'skipExecutionLock deve arrivare a processThread');
}


console.log('--- Test processUnreadEmails: normalizza labeledMessageIds da array/null/Set ---');
{
  const cases = [
    { name: 'array', value: ['m-array'], expectedIds: ['m-array'] },
    { name: 'null', value: null, expectedIds: [] },
    { name: 'set', value: new Set(['m-set']), expectedIds: ['m-set'] }
  ];

  cases.forEach(({ name, value, expectedIds }) => {
    const threads = [
      createThread({ id: `t-${name}`, messages: [createMessage({ id: `m-${name}`, unread: true })] })
    ];
    const seen = [];
    const processor = new EmailProcessor({
      gmailService: {
        getUnprocessedUnreadThreads: () => threads,
        getMessageIdsWithLabel: (labelName) => {
          if (labelName === global.CONFIG.LABEL_NAME) return value;
          return [];
        }
      }
    });

    processor._hasUnreadMessagesToProcess = (_thread, labeledMessageIds) => {
      seen.push(labeledMessageIds);
      return false;
    };
    processor._isNearDeadline = () => false;
    processor._getRemainingTimeMs = () => 60000;
    processor.processThread = () => { throw new Error('processThread non deve essere chiamato nel fast-skip'); };

    const stats = processor.processUnreadEmails('kb', '', true);
    assert(stats.total === 1, `${name}: deve analizzare il thread`);
    assert(seen.length === 1, `${name}: deve invocare il fast-skip una volta`);
    assert(seen[0] instanceof Set, `${name}: labeledMessageIds deve essere normalizzato a Set`);
    expectedIds.forEach((id) => {
      assert(seen[0].has(id), `${name}: il Set normalizzato deve preservare ${id}`);
    });
    assert(seen[0].size === expectedIds.length, `${name}: il Set normalizzato deve avere la dimensione attesa`);
  });
}



console.log('--- Test processUnreadEmails: filtered deve consumare MAX_EMAILS_PER_RUN ---');
{
  const originalMax = global.CONFIG.MAX_EMAILS_PER_RUN;
  global.CONFIG.MAX_EMAILS_PER_RUN = 1;

  const threads = [
    createThread({ id: 't-filtered', messages: [createMessage({ id: 'm-filtered', unread: true })] }),
    createThread({ id: 't-replied', messages: [createMessage({ id: 'm-replied', unread: true })] })
  ];

  const processor = new EmailProcessor({
    gmailService: { getUnprocessedUnreadThreads: () => threads }
  });
  processor._hasUnreadMessagesToProcess = () => true;
  processor._isNearDeadline = () => false;
  processor._getRemainingTimeMs = () => 60000;

  const calls = [];
  processor.processThread = (thread) => {
    calls.push(thread.getId());
    if (thread.getId() === 't-filtered') return { status: 'filtered', reason: 'newsletter_header' };
    return { status: 'replied' };
  };

  const stats = processor.processUnreadEmails('kb', '', true);
  assert(calls.length === 1, 'thread filtered deve contribuire al limite quando il limite è 1');
  assert(stats.replied === 0, 'con limite esaurito non deve elaborare thread successivo');

  global.CONFIG.MAX_EMAILS_PER_RUN = originalMax;
}

console.log('--- Test processUnreadEmails: lock batch locale propagato a processThread ---');
{
  const threads = [
    createThread({ id: 't-local-lock', messages: [createMessage({ id: 'm-local-lock', unread: true })] })
  ];
  let tryLockCalls = 0;
  let releaseCalls = 0;
  const originalLockService = global.LockService;

  global.LockService = {
    getScriptLock: () => ({
      tryLock: () => {
        tryLockCalls += 1;
        return true;
      },
      releaseLock: () => {
        releaseCalls += 1;
      }
    })
  };

  try {
    const processor = new EmailProcessor({
      gmailService: { getUnprocessedUnreadThreads: () => threads }
    });
    let seenSkipLock = null;

    processor._hasUnreadMessagesToProcess = () => true;
    processor._isNearDeadline = () => false;
    processor._getRemainingTimeMs = () => 60000;
    processor.processThread = (_thread, _kb, _doctrine, _labeled, skipLock) => {
      seenSkipLock = skipLock;
      return { status: 'skipped', reason: 'no_external_unread' };
    };

    const stats = processor.processUnreadEmails('kb', '', false);
    assert(stats.total === 1, 'il batch con lock locale deve processare il thread');
    assert(seenSkipLock === true, 'il lock batch acquisito da processUnreadEmails deve essere propagato a processThread');
    assert(tryLockCalls === 1, 'deve acquisire solo il batch lock, non un secondo ScriptLock nel thread');
    assert(releaseCalls === 1, 'deve rilasciare solo il batch lock a fine batch');
  } finally {
    global.LockService = originalLockService;
  }
}

console.log('--- Test _beginSendTransaction: skipLock evita riacquisizione ScriptLock ---');
{
  const originalLockService = global.LockService;
  cacheStore.clear();
  let tryLockCalls = 0;

  global.LockService = {
    getScriptLock: () => ({
      tryLock: () => {
        tryLockCalls += 1;
        return false;
      },
      releaseLock: () => {
        throw new Error('releaseLock non deve essere chiamato senza lock acquisito');
      }
    })
  };

  try {
    const processor = new EmailProcessor({ gmailService: {} });
    const blockedTxn = processor._beginSendTransaction('m-lock-required');
    assert(blockedTxn.ok === false && blockedTxn.reason === 'send_lock_unavailable', 'senza skipLock deve fallire se lo ScriptLock è occupato');
    assert(tryLockCalls === 1, 'senza skipLock deve provare ad acquisire lo ScriptLock');

    tryLockCalls = 0;
    const skippedLockTxn = processor._beginSendTransaction('m-skip-lock', true);
    assert(skippedLockTxn.ok === true, 'con skipLock deve iniziare la transazione anche se tryLock fallirebbe');
    assert(tryLockCalls === 0, 'con skipLock non deve riacquisire lo ScriptLock');
    assert(cacheStore.get('sending_m-skip-lock'), 'con skipLock deve comunque impostare la chiave sending');
  } finally {
    global.LockService = originalLockService;
    cacheStore.clear();
  }
}

function createExternalThread(id) {
  const msg = createMessage({ id: `m-${id}`, unread: true, from: 'utente@example.com' });
  return createThread({ id: `t-${id}`, messages: [msg] });
}

function createExternalBurstThread(id, count) {
  const baseDate = new Date('2026-05-07T10:00:00Z').getTime();
  const messages = Array.from({ length: count }, (_, index) => ({
    getId: () => `m-${id}-${index + 1}`,
    isUnread: () => true,
    getFrom: () => 'utente@example.com',
    getDate: () => new Date(baseDate + index * 60000),
    getSubject: () => 'Richiesta informazioni',
    getPlainBody: () => `Messaggio ${index + 1}: vorrei sapere gli orari.`
  }));
  return createThread({ id: `t-${id}`, messages });
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
      getThreadHistory: () => ''
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

console.log('--- Test processThread: fallback generazione marca atomicamente tutto il burst ---');
{
  const labeled = new Set();
  const { processor } = buildProcessorForGenerationFailure('UNKNOWN');
  const res = processor.processThread(createExternalBurstThread('burst-generation', 3), 'kb valida', '', labeled, true);
  assert(res.status === 'error', 'con fallback esaurito sul burst deve restituire status error');
  assert(labeled.has('m-burst-generation-1'), 'deve marcare come processato il primo messaggio del burst');
  assert(labeled.has('m-burst-generation-2'), 'deve marcare come processato il secondo messaggio del burst');
  assert(labeled.has('m-burst-generation-3'), 'deve marcare come processato il candidato del burst');
}

console.log('--- Test processThread: submission receipt-only non chiama Gemini generation ---');
{
  const originalValidationEnabled = global.CONFIG.VALIDATION_ENABLED;
  const originalDocumentConsistency = global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED;
  const originalAttachmentContext = global.CONFIG.ATTACHMENT_CONTEXT;
  global.CONFIG.VALIDATION_ENABLED = false;
  global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED = false;
  global.CONFIG.ATTACHMENT_CONTEXT = { enabled: true, maxFiles: 3 };
  let generationCalls = 0;
  let sentText = '';
  const msg = {
    getId: () => 'm-submission-receipt',
    isUnread: () => true,
    getFrom: () => 'utente@example.com',
    getDate: () => new Date('2026-05-10T10:00:00Z'),
    getSubject: () => 'Invio certificato',
    getPlainBody: () => 'Allego certificato.',
    getAttachments: () => [{ getName: () => 'idoneita.pdf' }]
  };
  const thread = createThread({ id: 't-submission-receipt', messages: [msg] });
  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => raw,
      extractMessageDetails: () => ({
        subject: 'Invio certificato',
        body: 'Allego certificato.',
        senderEmail: 'utente@example.com',
        senderName: 'Utente Test',
        date: new Date(),
        headers: {},
        isNewsletter: false,
        rfc2822MessageId: null,
        existingReferences: null
      }),
      addLabelToMessage: () => {},
      addLabelToThread: () => {},
      getThreadHistory: () => '',
      getProcessableAttachments: () => ({
        blobs: [],
        textContext: 'Certificato di idoneità padrino allegato.',
        skipped: [],
        items: [{ name: 'idoneita.pdf', text: 'Certificato idoneità' }]
      }),
      prepareOutboundText: (text) => text,
      sendHtmlReply: (_candidate, responseText) => { sentText = responseText; }
    },
    classifier: {
      classifyEmail: () => ({ shouldReply: true, category: 'document_submission', subIntents: {}, confidence: 0.9 })
    },
    geminiService: {
      primaryKey: 'primary-key',
      backupKey: 'backup-key',
      shouldRespondToEmail: () => ({ shouldRespond: true, language: 'it', classification: { topic: 'documentazione ricevuta' } }),
      detectEmailLanguage: () => ({ lang: 'it' }),
      getAdaptiveGreeting: () => 'Buongiorno',
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: () => {
        generationCalls++;
        throw new Error('generateResponse non deve essere chiamata per receipt-only submission');
      }
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
    },
    memoryService: {
      getMemory: () => ({}),
      updateMemoryAtomic: () => true
    },
    territoryValidator: {
      validateMultipleAddresses: () => ({ addressFound: false, addresses: [], summary: '' })
    },
    promptEngine: {
      buildPrompt: () => 'PROMPT'
    }
  });
  processor._deriveAttachmentIntentContext_ = () => ({
    intent: 'document_submission',
    hasQuestions: false,
    allowBodyQuestions: false,
    categoryHintSource: 'document_submission',
    detectedDocTypes: { sponsor: true }
  });

  const result = processor.processThread(thread, 'kb valida', '', new Set(), true);
  assert(result.status === 'replied', 'la consegna documento deve ricevere risposta di conferma');
  assert(generationCalls === 0, 'receipt-only submission non deve consumare chiamate Gemini di generazione');
  assert(/ricevut|document/i.test(sentText), `risposta di conferma inattesa: ${sentText}`);
  global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
  global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED = originalDocumentConsistency;
  global.CONFIG.ATTACHMENT_CONTEXT = originalAttachmentContext;
}


console.log('--- Test processThread: valida e invia esattamente il testo outbound preparato ---');
{
  const originalValidationEnabled = global.CONFIG.VALIDATION_ENABLED;
  global.CONFIG.VALIDATION_ENABLED = true;

  let validatedText = null;
  let sentText = null;

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
        isNewsletter: false,
        rfc2822MessageId: null,
        existingReferences: null
      }),
      addLabelToMessage: () => {},
      addLabelToThread: () => {},
      getThreadHistory: () => '',
      prepareOutboundText: (text) => `${text}\n[prepared-marker]`,
      sendHtmlReply: (_candidate, responseText) => {
        sentText = responseText;
      }
    },
    classifier: {
      classifyEmail: () => ({ shouldReply: true, category: 'info', subIntents: {}, confidence: 0.9 })
    },
    geminiService: {
      primaryKey: 'primary-key',
      shouldRespondToEmail: () => ({ shouldRespond: true, language: 'it', classification: { topic: 'orari' } }),
      detectEmailLanguage: () => ({ lang: 'it' }),
      getAdaptiveGreeting: () => 'Buongiorno',
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: () => ({ success: true, text: 'Risposta base' })
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
    },
    validator: {
      validateResponse: (text) => {
        validatedText = text;
        return { isValid: true, warnings: [], score: 1, details: {}, fixedResponse: null };
      }
    },
    memoryService: {
      getMemory: () => ({}),
      updateMemoryAtomic: () => true
    },
    territoryValidator: {
      validateMultipleAddresses: () => ({ addressFound: false, addresses: [], summary: '' })
    },
    promptEngine: {
      buildPrompt: () => 'PROMPT'
    }
  });

  const result = processor.processThread(createExternalThread('validated-send'), 'kb valida', '', new Set(), true);
  assert(result.status === 'replied', 'il branch replied con validazione attiva non deve lanciare errori post-send');
  assert(validatedText === 'Risposta base\n[prepared-marker]', `il validator deve ricevere il testo outbound preparato, ottenuto "${validatedText}"`);
  assert(sentText === validatedText, 'il testo inviato deve coincidere esattamente con quello validato');

  global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
}



console.log('--- Test context routing: categoria quickCheck ha priorità su euristica locale ---');
{
  const originalValidationEnabled = global.CONFIG.VALIDATION_ENABLED;
  const originalGlobalCache = global.GLOBAL_CACHE;
  global.CONFIG.VALIDATION_ENABLED = false;
  global.GLOBAL_CACHE = { aiCoreLite: 'core lite', aiCore: 'core pesante' };

  let promptOptions = null;
  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => raw,
      extractMessageDetails: () => ({
        subject: 'Info battesimo',
        body: 'Vorrei informazioni sul battesimo.',
        senderEmail: 'utente@example.com',
        senderName: 'Utente Test',
        date: new Date(),
        headers: {},
        isNewsletter: false,
        rfc2822MessageId: null,
        existingReferences: null
      }),
      addLabelToMessage: () => {},
      addLabelToThread: () => {},
      getThreadHistory: () => '',
      prepareOutboundText: (text) => text,
      sendHtmlReply: () => {}
    },
    classifier: {
      classifyEmail: () => ({ shouldReply: true, category: 'information', subIntents: {}, confidence: 0.9 })
    },
    geminiService: {
      primaryKey: 'primary-key',
      shouldRespondToEmail: () => ({ shouldRespond: true, language: 'it', classification: { category: 'sacrament', topic: 'battesimo' } }),
      detectEmailLanguage: () => ({ lang: 'it' }),
      getAdaptiveGreeting: () => 'Buongiorno',
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: () => ({ success: true, text: 'Risposta sacramento' })
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
    },
    memoryService: {
      getMemory: () => ({}),
      updateMemoryAtomic: () => true
    },
    territoryValidator: {
      validateMultipleAddresses: () => ({ addressFound: false, addresses: [], summary: '' })
    },
    promptEngine: {
      buildPrompt: (options) => {
        promptOptions = options;
        return 'PROMPT';
      }
    }
  });

  const result = processor.processThread(createExternalThread('quickcheck-category'), 'kb valida', 'dottrina completa', new Set(), true);
  assert(result.status === 'replied', 'la risposta con categoria quickCheck sacrament deve completarsi');
  assert(promptOptions.category === 'sacrament', `categoria attesa sacrament, ottenuta ${promptOptions && promptOptions.category}`);
  assert(promptOptions.doctrineBase === 'dottrina completa', 'la dottrina deve restare attiva quando quickCheck rileva categoria sacramentale');

  global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
  global.GLOBAL_CACHE = originalGlobalCache;
}

console.log('--- Test context routing: memoria pastorale impedisce amnesia su follow-up tecnico ---');
{
  const originalValidationEnabled = global.CONFIG.VALIDATION_ENABLED;
  const originalGlobalCache = global.GLOBAL_CACHE;
  global.CONFIG.VALIDATION_ENABLED = false;
  global.GLOBAL_CACHE = { aiCoreLite: 'core lite', aiCore: 'core pesante' };

  let promptOptions = null;
  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => raw,
      extractMessageDetails: () => ({
        subject: 'Re: percorso sacramentale',
        body: 'A che ora è l’incontro?',
        senderEmail: 'utente@example.com',
        senderName: 'Utente Test',
        date: new Date(),
        headers: {},
        isNewsletter: false,
        rfc2822MessageId: null,
        existingReferences: null
      }),
      addLabelToMessage: () => {},
      addLabelToThread: () => {},
      getThreadHistory: () => '',
      prepareOutboundText: (text) => text,
      sendHtmlReply: () => {}
    },
    classifier: {
      classifyEmail: () => ({ shouldReply: true, category: 'information', subIntents: {}, confidence: 0.9 })
    },
    geminiService: {
      primaryKey: 'primary-key',
      shouldRespondToEmail: () => ({ shouldRespond: true, language: 'it', classification: { category: 'information', topic: 'orario incontro' } }),
      detectEmailLanguage: () => ({ lang: 'it' }),
      getAdaptiveGreeting: () => 'Buongiorno',
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: () => ({ success: true, text: 'Risposta incontro' })
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
    },
    memoryService: {
      getMemory: () => ({ category: 'pastoral_sacrament', lastUpdated: '2026-05-10T10:00:00Z', providedInfo: [] }),
      updateMemoryAtomic: () => true
    },
    territoryValidator: {
      validateMultipleAddresses: () => ({ addressFound: false, addresses: [], summary: '' })
    },
    promptEngine: {
      buildPrompt: (options) => {
        promptOptions = options;
        return 'PROMPT';
      }
    }
  });

  const result = processor.processThread(createExternalThread('memory-pastoral'), 'kb valida', 'dottrina completa', new Set(), true);
  assert(result.status === 'replied', 'il follow-up tecnico con memoria pastorale deve completarsi');
  assert(promptOptions.category === 'information', `categoria tecnica attesa information, ottenuta ${promptOptions && promptOptions.category}`);
  assert(promptOptions.doctrineBase === 'dottrina completa', 'la memoria pastorale deve impedire la disattivazione della dottrina');
  assert(promptOptions.aiCore === 'core pesante', 'la memoria pastorale deve mantenere attivo anche AI core pesante');

  global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
  global.GLOBAL_CACHE = originalGlobalCache;
}


console.log('--- Test processThread: errore quota invio propaga errorClass senza label permanente ---');
{
  const originalValidationEnabled = global.CONFIG.VALIDATION_ENABLED;
  const originalErrorTypes = global.ErrorTypes;
  const originalClassifyError = global.classifyError;
  const labels = [];

  cacheStore.clear();
  global.CONFIG.VALIDATION_ENABLED = false;
  global.ErrorTypes = {
    QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
    TIMEOUT: 'TIMEOUT',
    NETWORK: 'NETWORK',
    INVALID_API_KEY: 'INVALID_API_KEY',
    INVALID_RESPONSE: 'INVALID_RESPONSE'
  };
  global.classifyError = (err) => ({
    type: global.ErrorTypes.QUOTA_EXCEEDED,
    retryable: true,
    message: err && err.message ? err.message : String(err)
  });

  try {
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
          isNewsletter: false,
          rfc2822MessageId: null,
          existingReferences: null
        }),
        addLabelToMessage: (message, label) => labels.push({ id: message.getId(), label }),
        addLabelToThread: (_thread, label) => labels.push({ id: 'thread', label }),
        getThreadHistory: () => '',
        prepareOutboundText: (text) => text,
        sendHtmlReply: () => { throw new Error('GMAIL_DAILY_CALL_LIMIT_REACHED quota invio'); }
      },
      classifier: {
        classifyEmail: () => ({ shouldReply: true, category: 'info', subIntents: {}, confidence: 0.9 })
      },
      geminiService: {
        primaryKey: 'primary-key',
        shouldRespondToEmail: () => ({ shouldRespond: true, language: 'it', classification: { topic: 'orari' } }),
        detectEmailLanguage: () => ({ lang: 'it' }),
        getAdaptiveGreeting: () => 'Buongiorno',
        getAdaptiveClosing: () => 'Cordiali saluti',
        generateResponse: () => ({ success: true, text: 'Risposta base' })
      },
      requestClassifier: {
        classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
      },
      memoryService: {
        getMemory: () => ({}),
        updateMemoryAtomic: () => true
      },
      territoryValidator: {
        validateMultipleAddresses: () => ({ addressFound: false, addresses: [], summary: '' })
      },
      promptEngine: {
        buildPrompt: () => 'PROMPT'
      }
    });

    const result = processor.processThread(createExternalThread('send-quota'), 'kb valida', '', new Set(), true);
    assert(result.status === 'error', 'errore invio quota deve restituire status error');
    assert(result.errorClass === 'QUOTA_EXCEEDED', `errore invio quota deve propagare QUOTA_EXCEEDED, ottenuto ${result.errorClass}`);
    assert(labels.length === 0, 'errore quota retryable non deve applicare label permanente');
  } finally {
    global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
    global.ErrorTypes = originalErrorTypes;
    global.classifyError = originalClassifyError;
    cacheStore.clear();
  }
}

console.log('--- Test processUnreadEmails: graceful stop su GMAIL_DAILY_CALL_LIMIT_REACHED ---');
{
  const processor = new EmailProcessor({
    gmailService: {
      getUnprocessedUnreadThreads: () => { throw new Error('GMAIL_DAILY_CALL_LIMIT_REACHED (18000/18000)'); }
    }
  });
  const stats = processor.processUnreadEmails('kb', '', true);
  assert(stats.reason === 'gmail_daily_limit_reached', 'deve restituire reason gmail_daily_limit_reached');
  assert(stats.errors === 0, 'non deve incrementare errors su stop quota locale');
}

console.log('--- Test processUnreadEmails: stop su errore infrastrutturale retryable ---');
{
  let checkpointStartIndex = null;
  let processCalls = 0;
  const threads = [createExternalThread('net-1'), createExternalThread('net-2')];
  const processor = new EmailProcessor({
    gmailService: {
      getUnprocessedUnreadThreads: () => threads,
      getMessageIdsWithLabel: () => new Set()
    }
  });
  processor._hasUnreadMessagesToProcess = () => true;
  processor.processThread = () => {
    processCalls++;
    return { status: 'error', errorClass: 'NETWORK', error: 'timeout rete' };
  };
  processor._storeBatchCheckpointAndScheduleContinuation_ = (_threads, startIndex) => {
    checkpointStartIndex = startIndex;
  };

  const stats = processor.processUnreadEmails('kb', '', true);
  assert(processCalls === 1, 'errore retryable infrastrutturale deve fermare il batch al primo thread');
  assert(stats.total === 1, 'deve conteggiare solo il thread analizzato prima dello stop');
  assert(checkpointStartIndex === 0, 'checkpoint deve ripartire dal thread fallito');
}

console.log('--- Test checkpoint payload include version e runId ---');
{
  const props = new Map();
  const originalPropertiesService = global.PropertiesService;
  const originalScriptApp = global.ScriptApp;
  global.PropertiesService = {
    getScriptProperties: () => ({
      setProperty: (k, v) => props.set(k, v),
      getProperty: (k) => props.get(k) || ''
    })
  };
  global.ScriptApp = {
    getProjectTriggers: () => [],
    newTrigger: () => ({
      timeBased: () => ({
        after: () => ({ create: () => {} })
      })
    })
  };
  try {
    const processor = new EmailProcessor({ gmailService: { getUnprocessedUnreadThreads: () => [] } });
    const fakeThreads = [{ getId: () => 't100' }, { getId: () => 't101' }];
    processor._storeBatchCheckpointAndScheduleContinuation_(fakeThreads, 0, 25000);
    const raw = props.get('EMAIL_BATCH_CHECKPOINT');
    const parsed = JSON.parse(raw);
    assert(parsed.version === 2, 'checkpoint deve avere version=2');
    assert(typeof parsed.runId === 'string' && parsed.runId.length > 5, 'checkpoint deve avere runId non vuoto');
  } finally {
    global.PropertiesService = originalPropertiesService;
    global.ScriptApp = originalScriptApp;
  }
}

console.log('✅ Test batch EmailProcessor passati');
