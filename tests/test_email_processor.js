const fs = require('fs');
const vm = require('vm');
const path = require('path');

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

global.createLogger = () => ({ info: () => {}, warn: () => {}, debug: () => {}, error: () => {} });
global.GeminiService = class {};
global.Classifier = class {};
global.RequestTypeClassifier = class {};
global.ResponseValidator = class {};
global.GmailService = class {};
global.PromptEngine = class {};
global.MemoryService = class {};
global.TerritoryValidator = class {};

global.CONFIG = {
  LABEL_NAME: 'IA',
  ERROR_LABEL_NAME: 'Errore',
  VALIDATION_ERROR_LABEL: 'Verifica',
  SKIP_LABEL_NAME: '·',
  IGNORE_DOMAINS: ['newsletter.com'],
  IGNORE_KEYWORDS: ['unsubscribe', 'annulla iscrizione'],
  ATTACHMENT_CONTEXT: {
    ocrTriggerKeywords: ['iban', 'bonifico']
  }
};

global.GLOBAL_CACHE = {
  languageMode: 'all',
  ignoreDomains: ['mailchimp.com'],
  ignoreKeywords: ['newsletter']
};

const gasEmailProcessorPath = path.join(__dirname, '..', 'gas_email_processor.js');
const gasEmailProcessorCode = fs.readFileSync(gasEmailProcessorPath, 'utf8');
vm.runInThisContext(gasEmailProcessorCode, { filename: gasEmailProcessorPath });

const processor = new EmailProcessor();

console.log('--- Test constructor: preserva requestClassifier iniettato ---');
{
  const injectedRequestClassifier = {
    classify: () => ({ type: 'custom' }),
    getRequestTypeHint: () => 'custom'
  };
  const processorWithInjectedClassifier = new EmailProcessor({
    requestClassifier: injectedRequestClassifier
  });
  assert(
    processorWithInjectedClassifier.requestClassifier === injectedRequestClassifier,
    'deve usare il requestClassifier iniettato senza sostituirlo con il default'
  );
}

function extractEmailAddress(fromField) {
  const match = String(fromField || '').match(/<([^>]+)>/) || String(fromField || '').match(/([^\s<]+@[^\s>]+)/);
  return match ? match[1] : '';
}

function createMessage(id, from, subject, plainBody, date = new Date('2026-04-01T10:00:00Z'), unread = true) {
  return {
    getId: () => id,
    getFrom: () => from,
    getSubject: () => subject,
    getPlainBody: () => plainBody,
    getDate: () => date,
    isUnread: () => unread
  };
}

console.log('--- Test _shouldIgnoreEmail (dominio blacklist) ---');
assert(
  processor._shouldIgnoreEmail({
    senderEmail: 'promo@mailchimp.com',
    subject: 'offerta',
    body: 'contenuto'
  }) === true,
  'deve ignorare email da dominio blacklist'
);


console.log('--- Test _shouldIgnoreEmail (confini dominio blacklist) ---');
{
  const previousGlobalCache = global.GLOBAL_CACHE;
  global.GLOBAL_CACHE = {
    languageMode: 'all',
    ignoreDomains: ['@mail.com', 'example.org'],
    ignoreKeywords: []
  };
  try {
    assert(
      processor._shouldIgnoreEmail({ senderEmail: 'utente@mail.com', subject: 'Info', body: 'Ciao' }) === true,
      'deve bloccare il dominio esatto @mail.com'
    );
    assert(
      processor._shouldIgnoreEmail({ senderEmail: 'utente@gmail.com', subject: 'Info', body: 'Ciao' }) === false,
      'non deve bloccare gmail.com quando la blacklist contiene @mail.com'
    );
    assert(
      processor._shouldIgnoreEmail({ senderEmail: 'utente@sub.example.org', subject: 'Info', body: 'Ciao' }) === true,
      'deve bloccare i sottodomini espliciti di example.org'
    );
  } finally {
    global.GLOBAL_CACHE = previousGlobalCache;
  }
}

console.log('--- Test _shouldIgnoreEmail (keyword blacklist) ---');
assert(
  processor._shouldIgnoreEmail({
    senderEmail: 'utente@example.com',
    subject: 'Newsletter settimanale',
    body: 'ciao'
  }) === true,
  'deve ignorare email con keyword blacklist'
);

console.log('--- Test _shouldIgnoreEmail (email valida) ---');
assert(
  processor._shouldIgnoreEmail({
    senderEmail: 'mario.rossi@example.com',
    subject: 'Richiesta orari battesimo',
    body: 'Buongiorno, vorrei informazioni.'
  }) === false,
  'non deve ignorare email normale utente'
);

console.log('--- Test _normalizeEmailAddress_ (gmail/googlemail + dots + plus) ---');
const normalizedGooglemail = processor._normalizeEmailAddress_('Info.Parrocchia+archivio@googlemail.com');
const normalizedGmail = processor._normalizeEmailAddress_('info.parrocchia@gmail.com');
assert(normalizedGooglemail === 'infoparrocchia@gmail.com', `googlemail con dots/+ deve canonicalizzare a infoparrocchia@gmail.com, ottenuto ${normalizedGooglemail}`);
assert(normalizedGmail === 'infoparrocchia@gmail.com', `gmail con dots deve canonicalizzare a infoparrocchia@gmail.com, ottenuto ${normalizedGmail}`);
assert(
  normalizedGooglemail === normalizedGmail,
  'gmail.com e googlemail.com dello stesso account devono essere equivalenti dopo normalizzazione'
);

console.log('--- Test _shouldTryOcr (keyword presente) ---');
assert(
  processor._shouldTryOcr('In allegato iban per bonifico', 'Documentazione', null) === true,
  'deve attivare OCR con keyword trigger'
);

console.log('--- Test _shouldTryOcr (nessuna keyword, testo presente) ---');
assert(
  processor._shouldTryOcr('Richiesta informazioni generica', 'Oggetto', null) === false,
  'non deve attivare OCR senza keyword se c’è testo'
);

console.log('--- Test modalità lingua (foreign_only) ---');
global.GLOBAL_CACHE.languageMode = 'foreign_only';
assert(
  processor._getLanguageProcessingMode_() === 'foreign_only',
  'deve leggere foreign_only da GLOBAL_CACHE'
);
assert(
  processor._shouldSkipByLanguageMode_('it', 'foreign_only') === true,
  'in foreign_only deve saltare email italiane'
);
assert(
  processor._shouldSkipByLanguageMode_('en', 'foreign_only') === false,
  'in foreign_only non deve saltare email straniere'
);

console.log('--- Test _markMessageAsProcessed: rimuove skip label se supportato ---');
{
  const applied = [];
  const removed = [];
  const processorWithSkipCleanup = new EmailProcessor({
    gmailService: {
      addLabelToMessage: (id, label) => applied.push({ id, label }),
      removeLabelFromMessage: (id, label) => removed.push({ id, label })
    }
  });

  const labeledIds = new Set();
  processorWithSkipCleanup._markMessageAsProcessed(createMessage('m-cleanup', 'Utente <utente@example.org>', 'Oggetto', 'Body'), labeledIds);
  assert(applied.length === 1 && applied[0].label === 'IA', 'deve applicare la label IA al messaggio processato');
  assert(removed.length === 1 && removed[0].label === CONFIG.SKIP_LABEL_NAME, 'deve rimuovere la skip label quando il messaggio viene processato');
  assert(labeledIds.has('m-cleanup'), 'deve aggiungere il messageId al set dei già etichettati');
}

console.log('--- Test processThread: alias Gmail recognized as unread internal ---');
{
  const originalSession = global.Session;
  const originalGmailApp = global.GmailApp;
  const originalLanguageMode = global.GLOBAL_CACHE.languageMode;
  const labeled = [];

  global.Session = {
    getEffectiveUser: () => ({ getEmail: () => 'info@example.org' })
  };
  global.GmailApp = {
    getAliases: () => ['segreteria@example.org']
  };
  global.GLOBAL_CACHE.languageMode = 'all';

  const aliasAwareProcessor = new EmailProcessor({
    gmailService: {
      getMessageIdsWithLabel: () => new Set(),
      _extractEmailAddress: extractEmailAddress,
      addLabelToMessage: (id) => labeled.push(id)
    }
  });

  const thread = {
    getId: () => 'thread-alias-last-speaker',
    getLabels: () => [],
    getMessages: () => [
      createMessage('m-ext', 'Utente <utente@example.org>', 'Info battesimo', 'Buongiorno, avrei bisogno di informazioni.', new Date('2026-04-01T10:00:00Z'), false),
      createMessage('m-me', 'Segreteria <segreteria@example.org>', 'Re: Info battesimo', 'Le abbiamo appena risposto dalla segreteria.')
    ]
  };

  const result = aliasAwareProcessor.processThread(thread, '', [], new Set(), true);
  assert(result.status === 'skipped', 'thread with last alias internal must be skipped');
  assert(result.reason === 'no_external_unread', 'unread internal alias must produce no_external_unread');
  assert(!labeled.includes('m-ext') && labeled.includes('m-me'), 'only the internal unread should be marked as processed');

  global.Session = originalSession;
  global.GmailApp = originalGmailApp;
  global.GLOBAL_CACHE.languageMode = originalLanguageMode;
}

console.log('--- Test processThread: quick check filtrato preserva secondari esterni ---');
{
  const originalSession = global.Session;
  const originalGmailApp = global.GmailApp;
  const originalLanguageMode = global.GLOBAL_CACHE.languageMode;
  const labeled = [];

  global.Session = {
    getEffectiveUser: () => ({ getEmail: () => 'info@example.org' })
  };
  global.GmailApp = {
    getAliases: () => []
  };
  global.GLOBAL_CACHE.languageMode = 'all';

  const processorQuickFiltered = new EmailProcessor({
    geminiService: {
      detectEmailLanguage: () => ({ lang: 'it', safetyGrade: 5 }),
      shouldRespondToEmail: () => ({ shouldRespond: false, reason: 'ack' })
    },
    classifier: {
      _extractMainContent: (body) => body,
      classifyEmail: () => ({ shouldReply: true, reason: 'candidate' })
    },
    gmailService: {
      getMessageIdsWithLabel: () => new Set(),
      _extractEmailAddress: extractEmailAddress,
      extractMessageDetails: (message) => ({
        subject: message.getSubject(),
        body: message.getPlainBody(),
        senderEmail: extractEmailAddress(message.getFrom()),
        senderName: 'Utente',
        headers: {},
        isNewsletter: false,
        date: message.getDate()
      }),
      addLabelToMessage: (id) => labeled.push(id)
    }
  });

  const thread = {
    getId: () => 'thread-quick-filtered-burst',
    getLabels: () => [],
    getMessages: () => [
      createMessage('m-secondary', 'Utente <utente@example.org>', 'Prima domanda', 'Vorrei informazioni sulla catechesi.'),
      createMessage('m-candidate', 'Utente <utente@example.org>', 'Re: Prima domanda', 'Grazie')
    ]
  };

  const result = processorQuickFiltered.processThread(thread, '', [], new Set(), true);
  assert(result.status === 'filtered', 'quick check shouldRespond=false deve filtrare il candidato');
  assert(labeled.includes('m-candidate'), 'deve marcare il candidato filtrato per evitare retry infinito');
  assert(!labeled.includes('m-secondary'), 'deve preservare il secondario esterno per un trigger successivo');

  global.Session = originalSession;
  global.GmailApp = originalGmailApp;
  global.GLOBAL_CACHE.languageMode = originalLanguageMode;
}

console.log('--- Test processThread: foreign_only marca skip label sui non letti italiani ---');
{
  const originalSession = global.Session;
  const originalGmailApp = global.GmailApp;
  const originalLanguageMode = global.GLOBAL_CACHE.languageMode;
  const labels = [];

  global.Session = {
    getEffectiveUser: () => ({ getEmail: () => 'info@example.org' })
  };
  global.GmailApp = {
    getAliases: () => []
  };
  global.GLOBAL_CACHE.languageMode = 'foreign_only';

  const processorItalianSkip = new EmailProcessor({
    geminiService: {
      detectEmailLanguage: () => ({ lang: 'it', safetyGrade: 5 })
    },
    classifier: {
      _extractMainContent: (body) => body
    },
    gmailService: {
      getMessageIdsWithLabel: () => new Set(),
      _extractEmailAddress: extractEmailAddress,
      extractMessageDetails: (message) => ({
        subject: message.getSubject(),
        body: message.getPlainBody(),
        senderEmail: extractEmailAddress(message.getFrom()),
        senderName: 'Utente',
        headers: {},
        isNewsletter: false,
        date: message.getDate()
      }),
      addLabelToMessage: (id, label) => labels.push({ id, label })
    }
  });

  const thread = {
    getId: () => 'thread-italian-skip',
    getLabels: () => [],
    getMessages: () => [
      createMessage('m-it', 'Utente <utente@example.org>', 'Info cresima', 'Buongiorno, vorrei informazioni sulla cresima adulti.')
    ]
  };

  const result = processorItalianSkip.processThread(thread, '', [], new Set(), true);
  assert(result.status === 'skipped', 'in foreign_only una mail italiana deve essere skipped');
  assert(result.reason === 'italian_skipped_foreign_only', 'deve mantenere la reason di skip per lingua');
  assert(labels.some((entry) => entry.id === 'm-it' && entry.label === CONFIG.SKIP_LABEL_NAME), 'deve applicare la skip label al messaggio italiano');

  global.Session = originalSession;
  global.GmailApp = originalGmailApp;
  global.GLOBAL_CACHE.languageMode = originalLanguageMode;
}

console.log('--- Test processThread: foreign_only non deve saltare body inglese con oggetto italiano ---');
{
  const originalSession = global.Session;
  const originalGmailApp = global.GmailApp;
  const originalLanguageMode = global.GLOBAL_CACHE.languageMode;
  const labeled = [];

  global.Session = {
    getEffectiveUser: () => ({ getEmail: () => 'info@example.org' })
  };
  global.GmailApp = {
    getAliases: () => []
  };
  global.GLOBAL_CACHE.languageMode = 'foreign_only';

  const processorForeignOnly = new EmailProcessor({
    geminiService: {
      detectEmailLanguage: () => ({ lang: 'en', safetyGrade: 5 })
    },
    classifier: {
      _extractMainContent: (body) => body,
      classifyEmail: () => ({ shouldReply: false, reason: 'unit_test_stop' })
    },
    gmailService: {
      getMessageIdsWithLabel: () => new Set(),
      _extractEmailAddress: extractEmailAddress,
      extractMessageDetails: (message) => ({
        subject: message.getSubject(),
        body: message.getPlainBody(),
        senderEmail: extractEmailAddress(message.getFrom()),
        senderName: 'Utente',
        headers: {},
        isNewsletter: false,
        date: message.getDate()
      }),
      addLabelToMessage: (id) => labeled.push(id)
    }
  });

  const thread = {
    getId: () => 'thread-foreign-only-body',
    getLabels: () => [],
    getMessages: () => [
      createMessage(
        'm-foreign',
        'Utente <utente@example.org>',
        'Richiesta informazioni battesimo',
        'Hello, I would like to know the available times for a baptism appointment.'
      )
    ]
  };

  const result = processorForeignOnly.processThread(thread, '', [], new Set(), true);
  assert(result.status === 'filtered', 'il flusso deve superare il pre-check e arrivare al classifier');
  assert(result.reason !== 'italian_skipped_foreign_only_precheck', 'oggetto italiano non deve bloccare un body inglese reale');
  assert(labeled.includes('m-foreign'), 'il messaggio deve seguire il normale flusso di labeling del classifier');

  global.Session = originalSession;
  global.GmailApp = originalGmailApp;
  global.GLOBAL_CACHE.languageMode = originalLanguageMode;
}

console.log('--- Test processThread: alias interno interrompe la sequenza esterna anti-loop ---');
{
  const originalSession = global.Session;
  const originalGmailApp = global.GmailApp;
  const originalLanguageMode = global.GLOBAL_CACHE.languageMode;
  const labeled = [];

  global.Session = {
    getEffectiveUser: () => ({ getEmail: () => 'info@example.org' })
  };
  global.GmailApp = {
    getAliases: () => ['segreteria@example.org']
  };
  global.GLOBAL_CACHE.languageMode = 'all';

  const antiLoopProcessor = new EmailProcessor({
    geminiService: {
      detectEmailLanguage: () => ({ lang: 'it', safetyGrade: 5 })
    },
    classifier: {
      _extractMainContent: (body) => body,
      classifyEmail: () => ({ shouldReply: false, reason: 'unit_test_stop' })
    },
    gmailService: {
      getMessageIdsWithLabel: () => new Set(),
      _extractEmailAddress: extractEmailAddress,
      extractMessageDetails: (message) => ({
        subject: message.getSubject(),
        body: message.getPlainBody(),
        senderEmail: extractEmailAddress(message.getFrom()),
        senderName: 'Utente',
        headers: {},
        isNewsletter: false,
        date: message.getDate()
      }),
      addLabelToMessage: (id) => labeled.push(id)
    }
  });

  const baseDate = new Date('2026-04-01T10:00:00Z');
  const messages = Array.from({ length: 12 }, (_, index) => {
    const isAliasMessage = index === 7;
    return createMessage(
      `m-${index}`,
      isAliasMessage ? 'Segreteria <segreteria@example.org>' : 'Utente <utente@example.org>',
      `Thread ${index}`,
      isAliasMessage ? 'Risposta interna della segreteria.' : 'Messaggio esterno di follow-up.',
      new Date(baseDate.getTime() + index * 60000)
    );
  });

  const thread = {
    getId: () => 'thread-anti-loop-alias',
    getLabels: () => [],
    getMessages: () => messages
  };

  const result = antiLoopProcessor.processThread(thread, '', [], new Set(), true);
  assert(result.status === 'filtered', 'il thread deve proseguire oltre il controllo anti-loop fino al classifier');
  assert(result.reason !== 'email_loop_detected', 'un alias interno negli ultimi messaggi deve interrompere la sequenza esterna');
  assert(labeled.includes('m-11'), 'il candidato finale deve essere gestito normalmente');

  global.Session = originalSession;
  global.GmailApp = originalGmailApp;
  global.GLOBAL_CACHE.languageMode = originalLanguageMode;
}

console.log('--- Test processThread: ignore rules applica label IA (processato) ---');
{
  const originalSession = global.Session;
  const originalGmailApp = global.GmailApp;
  const originalLanguageMode = global.GLOBAL_CACHE.languageMode;
  const labels = [];

  global.Session = {
    getEffectiveUser: () => ({ getEmail: () => 'info@example.org' })
  };
  global.GmailApp = {
    getAliases: () => []
  };
  global.GLOBAL_CACHE.languageMode = 'all';

  const ignoreRuleProcessor = new EmailProcessor({
    geminiService: {
      detectEmailLanguage: () => ({ lang: 'es', safetyGrade: 5 })
    },
    classifier: {
      _extractMainContent: (body) => body
    },
    gmailService: {
      getMessageIdsWithLabel: () => new Set(),
      _extractEmailAddress: extractEmailAddress,
      extractMessageDetails: (message) => ({
        subject: message.getSubject(),
        body: message.getPlainBody(),
        senderEmail: extractEmailAddress(message.getFrom()),
        senderName: 'Utente',
        headers: {},
        isNewsletter: false,
        date: message.getDate()
      }),
      addLabelToMessage: (id, label) => labels.push({ id, label })
    }
  });

  const thread = {
    getId: () => 'thread-ignore-rules',
    getLabels: () => [],
    getMessages: () => [
      createMessage('m-news', 'News <news@example.org>', 'Newsletter di maggio', 'Contenuto periodico della newsletter.')
    ]
  };

  const result = ignoreRuleProcessor.processThread(thread, '', [], new Set(), true);
  assert(result.status === 'filtered', 'una newsletter deve essere filtrata dalle ignore-rules');
  assert(result.reason === 'ignore_rules', 'la reason deve restare ignore_rules');
  assert(labels.some((entry) => entry.id === 'm-news' && entry.label === CONFIG.LABEL_NAME), 'deve applicare la label IA al messaggio filtrato (processo concluso)');
  assert(!labels.some((entry) => entry.id === 'm-news' && entry.label === CONFIG.SKIP_LABEL_NAME), 'non deve applicare la skip label · ai messaggi filtrati da ignore-rules');

  global.Session = originalSession;
  global.GmailApp = originalGmailApp;
  global.GLOBAL_CACHE.languageMode = originalLanguageMode;
}


console.log('--- Test processThread: newsletter in modalità all viene marcata IA ---');
{
  const labels = [];
  const originalLanguageMode = global.GLOBAL_CACHE.languageMode;
  global.GLOBAL_CACHE.languageMode = 'all';

  const processor = new EmailProcessor({
    classifier: {
      _extractMainContent: (body) => body,
      classifyEmail: () => ({ action: 'FILTER', reason: 'unit_test_stop' })
    },
    geminiService: {
      detectEmailLanguage: () => ({ lang: 'it', safetyGrade: 5 })
    },
    gmailService: {
      getMessageIdsWithLabel: () => new Set(),
      _extractEmailAddress: extractEmailAddress,
      extractMessageDetails: (message) => ({
        subject: message.getSubject(),
        body: message.getPlainBody(),
        senderEmail: extractEmailAddress(message.getFrom()),
        senderName: 'Utente',
        headers: { 'list-unsubscribe': '<mailto:test@example.org>' },
        isNewsletter: true,
        date: message.getDate()
      }),
      addLabelToMessage: (id, label) => labels.push({ id, label }),
      removeLabelFromMessage: (id, label) => labels.push({ id, label, removed: true })
    }
  });

  const thread = {
    getId: () => 'thread-newsletter-all-mode',
    getLabels: () => [],
    getMessages: () => [
      createMessage('m-news-all', 'news@example.org', 'Newsletter', 'Contenuto newsletter')
    ]
  };

  const result = processor.processThread(thread, '', [], new Set(), true);
  assert(result.status === 'filtered' && result.reason === 'newsletter_header', 'newsletter deve restare filtered');
  assert(labels.some((entry) => entry.id === 'm-news-all' && entry.label === CONFIG.LABEL_NAME), 'in modalità all newsletter deve ricevere label IA');
  assert(!labels.some((entry) => entry.id === 'm-news-all' && entry.label === CONFIG.SKIP_LABEL_NAME && !entry.removed), 'in modalità all newsletter non deve ricevere skip label');

  global.GLOBAL_CACHE.languageMode = originalLanguageMode;
}


console.log('--- Test processThread: foreign_only non aggiunge skip a messaggi già IA ---');
{
  const labels = [];
  const originalLanguageMode = global.GLOBAL_CACHE.languageMode;
  global.GLOBAL_CACHE.languageMode = 'foreign_only';

  const processor = new EmailProcessor({
    classifier: {
      _extractMainContent: (body) => body,
      classifyEmail: () => ({ action: 'FILTER', reason: 'unit_test_stop' })
    },
    geminiService: {
      detectEmailLanguage: () => ({ lang: 'en', safetyGrade: 5 })
    },
    gmailService: {
      getMessageIdsWithLabel: () => new Set(['m-news-ia']),
      _extractEmailAddress: extractEmailAddress,
      extractMessageDetails: (message) => ({
        subject: message.getSubject(),
        body: message.getPlainBody(),
        senderEmail: extractEmailAddress(message.getFrom()),
        senderName: 'Utente',
        headers: { 'list-unsubscribe': '<mailto:test@example.org>' },
        isNewsletter: true,
        date: message.getDate()
      }),
      addLabelToMessage: (id, label) => labels.push({ id, label })
    }
  });

  const thread = {
    getId: () => 'thread-newsletter-foreign-only-ia',
    getLabels: () => [],
    getMessages: () => [
      createMessage('m-news-ia', 'news@example.org', 'Newsletter', 'Newsletter body')
    ]
  };

  const result = processor.processThread(thread, '', [], new Set(['m-news-ia']), true);
  assert(result.status === 'skipped' && result.reason === 'already_labeled_no_new_unread', 'se già IA deve essere saltato come già processato');
  assert(!labels.some((entry) => entry.id === 'm-news-ia' && entry.label === CONFIG.SKIP_LABEL_NAME), 'se già IA non deve aggiungere skip label in foreign_only');

  global.GLOBAL_CACHE.languageMode = originalLanguageMode;
}

console.log('--- Test processThread: cache miss rispetta label terminali da metadata ---');
{
  const labels = [];
  const originalLanguageMode = global.GLOBAL_CACHE.languageMode;
  const labelIds = {
    IA: 'label-ia',
    Errore: 'label-error',
    Verifica: 'label-review',
    '·': 'label-skip'
  };

  const terminalMetadataProcessor = new EmailProcessor({
    gmailService: {
      _getOptionalLabelIdByName: (labelName) => labelIds[labelName] || null,
      _getMessageMetadataWithResilience: (messageId) => ({
        labelIds: messageId === 'm-review-cache-miss'
          ? ['label-review']
          : ['label-skip']
      }),
      addLabelToMessage: (id, label) => labels.push({ id, label })
    }
  });

  global.GLOBAL_CACHE.languageMode = 'all';
  const reviewThread = {
    getId: () => 'thread-review-cache-miss',
    getLabels: () => [],
    getMessages: () => [
      createMessage('m-review-cache-miss', 'Utente <utente@example.org>', 'Da verificare', 'Messaggio già in verifica')
    ]
  };
  const reviewResult = terminalMetadataProcessor.processThread(reviewThread, '', [], new Set(), true);
  assert(reviewResult.status === 'skipped', 'messaggio con label Verifica da metadata deve essere saltato');
  assert(reviewResult.reason === 'already_labeled_no_new_unread', 'label terminale da metadata deve chiudere il thread come già gestito');

  global.GLOBAL_CACHE.languageMode = 'foreign_only';
  const skipThread = {
    getId: () => 'thread-skip-cache-miss',
    getLabels: () => [],
    getMessages: () => [
      createMessage('m-skip-cache-miss', 'Utente <utente@example.org>', 'Italiano', 'Messaggio italiano già saltato')
    ]
  };
  const skipIds = new Set();
  const skipResult = terminalMetadataProcessor.processThread(skipThread, '', [], new Set(), true, skipIds);
  assert(skipResult.status === 'skipped', 'messaggio con label skip da metadata deve essere saltato in foreign_only');
  assert(skipResult.reason === 'already_labeled_no_new_unread', 'skip label da metadata deve evitare rientro pipeline');
  assert(skipIds.has('m-skip-cache-miss'), 'cache skip locale deve essere auto-riparata dal metadata');
  assert(labels.length === 0, 'non deve aggiungere nuove label ai messaggi già terminali');

  global.GLOBAL_CACHE.languageMode = originalLanguageMode;
}


console.log('--- Test foreign_only pre-check: marca skip solo sui messaggi esterni ---');
{
  const originalSession = global.Session;
  const originalGmailApp = global.GmailApp;
  const originalLanguageMode = global.GLOBAL_CACHE.languageMode;
  const labels = [];

  global.Session = {
    getEffectiveUser: () => ({ getEmail: () => 'info@example.org' })
  };
  global.GmailApp = {
    getAliases: () => ['segreteria@example.org']
  };
  global.GLOBAL_CACHE.languageMode = 'foreign_only';

  const precheckProcessor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: extractEmailAddress,
      _getOptionalLabelIdByName: () => null,
      addLabelToMessage: (id, label) => labels.push({ id, label })
    }
  });

  const thread = {
    getId: () => 'thread-foreign-only-precheck-external-only',
    getLabels: () => [],
    getMessages: () => [
      createMessage('m-internal', 'Segreteria <segreteria@example.org>', 'Promemoria interno', '', new Date('2026-04-01T09:00:00Z')),
      createMessage('m-external', 'Utente <utente@example.org>', 'Richiesta appuntamento', '', new Date('2026-04-01T10:00:00Z'))
    ]
  };

  const skippedIds = new Set();
  const result = precheckProcessor.processThread(thread, '', [], new Set(), true, skippedIds);

  assert(result.status === 'skipped', 'il pre-check foreign_only deve saltare il thread italiano subject-only');
  assert(result.reason === 'italian_skipped_foreign_only_precheck', 'deve usare la reason del pre-check locale');
  assert(labels.some(entry => entry.id === 'm-external' && entry.label === '·'), 'il messaggio esterno deve ricevere la label skip');
  assert(!labels.some(entry => entry.id === 'm-internal'), 'il messaggio interno non deve ricevere la label skip');
  assert(skippedIds.has('m-external') && !skippedIds.has('m-internal'), 'la cache skip deve includere solo il messaggio esterno');

  global.Session = originalSession;
  global.GmailApp = originalGmailApp;
  global.GLOBAL_CACHE.languageMode = originalLanguageMode;
}

console.log('✅ Test filtri EmailProcessor passati');


console.log('--- Test _trackEmptyInboxStreak (mantiene streak se CacheService fallisce dopo lettura) ---');
{
  const previousCacheService = global.CacheService;
  const previousPropertiesService = global.PropertiesService;
  global.CacheService = {
    getScriptCache: () => ({
      get: () => '4',
      put: () => { throw new Error('cache unavailable'); }
    })
  };
  global.PropertiesService = undefined;
  try {
    assert(
      processor._trackEmptyInboxStreak(true) === 5,
      'se la scrittura cache fallisce dopo la lettura, deve restituire lo streak aggiornato e non azzerarlo'
    );
  } finally {
    global.CacheService = previousCacheService;
    global.PropertiesService = previousPropertiesService;
  }
}
