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

function extractEmailAddress(fromField) {
  const match = String(fromField || '').match(/<([^>]+)>/) || String(fromField || '').match(/([^\s<]+@[^\s>]+)/);
  return match ? match[1] : '';
}

function createMessage(id, from, subject, plainBody, date = new Date('2026-04-01T10:00:00Z')) {
  return {
    getId: () => id,
    getFrom: () => from,
    getSubject: () => subject,
    getPlainBody: () => plainBody,
    getDate: () => date,
    isUnread: () => true
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

console.log('--- Test processThread: alias Gmail riconosciuto come ultimo mittente interno ---');
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
      createMessage('m-ext', 'Utente <utente@example.org>', 'Info battesimo', 'Buongiorno, avrei bisogno di informazioni.'),
      createMessage('m-me', 'Segreteria <segreteria@example.org>', 'Re: Info battesimo', 'Le abbiamo appena risposto dalla segreteria.')
    ]
  };

  const result = aliasAwareProcessor.processThread(thread, '', [], new Set(), true);
  assert(result.status === 'skipped', 'thread con ultimo alias interno deve essere skipped');
  assert(result.reason === 'last_speaker_is_me', 'ultimo alias interno deve produrre last_speaker_is_me');
  assert(labeled.includes('m-ext') && labeled.includes('m-me'), 'i non letti del thread devono essere marcati come processati');

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

console.log('✅ Test filtri EmailProcessor passati');
