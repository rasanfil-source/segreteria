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

const cacheStore = new Map();
const propsStore = new Map();
global.CacheService = {
  getScriptCache: () => ({
    get: (key) => cacheStore.get(key),
    put: (key, val) => cacheStore.set(key, val),
    remove: (key) => cacheStore.delete(key)
  })
};
global.PropertiesService = {
  getScriptProperties: () => ({
    getProperty: (key) => propsStore.get(key) || '',
    setProperty: (key, val) => propsStore.set(key, val),
    deleteProperty: (key) => propsStore.delete(key)
  })
};
global.LockService = {
  getScriptLock: () => ({
    tryLock: () => true,
    releaseLock: () => {}
  })
};

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
global.Session = {
  getEffectiveUser: () => ({ getEmail: () => 'info@example.org' })
};
global.GmailApp = {
  getAliases: () => []
};

const gasEmailProcessorPath = path.join(__dirname, '..', 'gas_email_processor.js');
const gasEmailProcessorCode = fs.readFileSync(gasEmailProcessorPath, 'utf8');
vm.runInThisContext(gasEmailProcessorCode, { filename: gasEmailProcessorPath });

const originalProcessThread = EmailProcessor.prototype.processThread;
EmailProcessor.prototype.processThread = function(...args) {
  cacheStore.clear();
  propsStore.clear();
  return originalProcessThread.apply(this, args);
};

const processor = new EmailProcessor();


console.log('--- Test timezone: usa BUSINESS_TIME_ZONE senza chiamare Session.getScriptTimeZone ---');
{
  const originalBusinessTimeZone = global.BUSINESS_TIME_ZONE;
  const originalSession = global.Session;
  global.BUSINESS_TIME_ZONE = 'Europe/Rome';
  let sessionTimeZoneCalled = false;
  global.Session = {
    getEffectiveUser: () => ({ getEmail: () => 'info@example.org' }),
    getScriptTimeZone: () => {
      sessionTimeZoneCalled = true;
      return 'America/New_York';
    }
  };

  const timezoneProcessor = new EmailProcessor();
  assert(timezoneProcessor._getCachedTimeZone() === 'Europe/Rome', 'deve usare BUSINESS_TIME_ZONE come sorgente autorevole');
  assert(sessionTimeZoneCalled === false, 'non deve chiamare Session.getScriptTimeZone');

  global.Session = originalSession;
  if (typeof originalBusinessTimeZone === 'undefined') {
    delete global.BUSINESS_TIME_ZONE;
  } else {
    global.BUSINESS_TIME_ZONE = originalBusinessTimeZone;
  }
}

console.log('--- Test safety valve: EmailProcessor legge il throttle persistito senza mutare CONFIG ---');
{
  const originalConfig = global.CONFIG;
  const originalUtilities = global.Utilities;
  global.CONFIG = Object.freeze(Object.assign({}, originalConfig, { MAX_EMAILS_PER_RUN: 8 }));
  global.Utilities = { formatDate: () => '2026-05-10' };
  const processorWithValve = new EmailProcessor({
    props: {
      getProperty: (key) => ({
        safety_valve_last_date: '2026-05-10',
        safety_valve_reduced_value: '3'
      })[key] || null
    }
  });

  assert(processorWithValve._getSafetyValveReducedLimit_(8) === 3, 'deve leggere il valore safety valve persistito');
  assert(global.CONFIG.MAX_EMAILS_PER_RUN === 8, 'non deve mutare CONFIG anche se congelato');

  global.CONFIG = originalConfig;
  global.Utilities = originalUtilities;
}

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

console.log('--- Test pre-AI rules: context, decision e action restano dichiarativi ---');
{
  const ruleProcessor = new EmailProcessor();
  const emptyContext = ruleProcessor._createRuleContext_();
  assert(emptyContext.actions && typeof emptyContext.actions === 'object', 'RuleContext deve esporre actions anche se vuoto');
  assert(emptyContext.gmailTargets && typeof emptyContext.gmailTargets === 'object', 'RuleContext deve esporre gmailTargets anche se vuoto');
  assert(emptyContext.state && typeof emptyContext.state === 'object', 'RuleContext deve esporre state anche se vuoto');

  let handledUnread = false;
  const lastSpeakerResult = { status: 'unknown' };
  const lastSpeakerContext = ruleProcessor._createRuleContext_({
    phase: 'pre_extract',
    lastSpeakerIsUs: true,
    actions: {
      markHandledUnread: () => { handledUnread = true; }
    }
  });
  const lastSpeakerDecision = ruleProcessor._evaluatePreAiRules_(lastSpeakerContext);
  assert(lastSpeakerDecision && lastSpeakerDecision.ruleId === 'last-speaker-is-us', 'last speaker deve mappare alla regola dedicata');
  assert(
    ruleProcessor._applyPreAiRuleDecision_(lastSpeakerDecision, lastSpeakerContext, lastSpeakerResult) === true,
    'la decisione last speaker deve essere applicabile'
  );
  assert(handledUnread === true, 'la action last speaker deve marcare gli unread gestiti');
  assert(
    lastSpeakerResult.status === 'skipped' && lastSpeakerResult.reason === 'last_speaker_is_me',
    'la action last speaker deve preservare status/reason storici'
  );

  let skipCall = null;
  const languageContext = ruleProcessor._createRuleContext_({
    phase: 'pre_extract',
    foreignOnlySubjectItalianPrecheck: true,
    subject: 'Appuntamento',
    skipLabelName: '·',
    actions: {
      markSkipped: (messages, labelName) => {
        skipCall = { messages, labelName };
      }
    },
    gmailTargets: {
      externalUnread: ['msg-1']
    }
  });
  const languageDecision = ruleProcessor._evaluatePreAiRules_(languageContext);
  const languageResult = { status: 'unknown' };
  ruleProcessor._applyPreAiRuleDecision_(languageDecision, languageContext, languageResult);
  assert(languageDecision && languageDecision.ruleId === 'foreign-only-subject-italian-precheck', 'pre-check lingua deve mappare alla regola dedicata');
  assert(skipCall && skipCall.labelName === '·' && skipCall.messages[0] === 'msg-1', 'pre-check lingua deve applicare label skip ai target esterni');
  assert(languageResult.reason === 'italian_skipped_foreign_only_precheck', 'pre-check lingua deve preservare la reason storica');

  const submissionState = { forceReceiptOnlyForSubmission: false };
  const submissionContext = ruleProcessor._createRuleContext_({
    phase: 'post_ocr_policy',
    state: submissionState,
    isDocumentSubmission: true,
    hasSubmissionQuestions: false,
    isSponsorSubmission: false,
    shouldProvideEligibilityGuidance: false
  });
  const submissionDecision = ruleProcessor._evaluateEmailPolicyRules_(submissionContext);
  assert(submissionDecision && submissionDecision.ruleId === 'document-submission-response-policy', 'submission documentale deve mappare alla policy receipt-only');
  assert(
    ruleProcessor._applyPreAiRuleDecision_(submissionDecision, submissionContext, { status: 'unknown' }) === false,
    'la policy receipt-only non deve fermare la pipeline'
  );
  assert(submissionState.forceReceiptOnlyForSubmission === true, 'submission senza domande deve forzare sola ricevuta');

  const implicitStateContext = {
    phase: 'post_ocr_policy',
    isDocumentSubmission: true,
    hasSubmissionQuestions: false,
    isSponsorSubmission: false,
    shouldProvideEligibilityGuidance: false
  };
  const implicitStateDecision = ruleProcessor._evaluateEmailPolicyRules_(implicitStateContext);
  ruleProcessor._applyPreAiRuleDecision_(implicitStateDecision, implicitStateContext, { status: 'unknown' });
  assert(
    implicitStateContext.state && implicitStateContext.state.forceReceiptOnlyForSubmission === true,
    'state assente deve essere creato e mutato dalla policy'
  );

  const routingState = {
    routedAiCore: 'AI_CORE',
    routedDoctrine: 'DOTTRINA',
    routedDoctrineStructured: [{ id: 'd1' }]
  };
  const routingContext = ruleProcessor._createRuleContext_({
    phase: 'context_routing',
    state: routingState,
    isTechnicalOnly: true
  });
  const routingDecision = ruleProcessor._evaluateEmailPolicyRules_(routingContext);
  assert(routingDecision && routingDecision.ruleId === 'technical-context-routing', 'routing tecnico deve mappare alla regola dedicata');
  ruleProcessor._applyPreAiRuleDecision_(routingDecision, routingContext, { status: 'unknown' });
  assert(
    routingState.routedAiCore === '' &&
      routingState.routedDoctrine === '' &&
      Array.isArray(routingState.routedDoctrineStructured) &&
      routingState.routedDoctrineStructured.length === 0,
    'routing tecnico deve disattivare i moduli dottrinali pesanti'
  );
}

console.log('--- Test periodo orari: usa la KB e la data richiesta ---');
{
  const scheduleKb = 'Orari Basilica | Periodo estivo | Dal 29 giugno al 30 agosto';

  const juneFirstPlusTwo = processor._resolveScheduleContext(
    'A che orari verra celebrata la messa dopodomani?',
    scheduleKb,
    '2026-06-01',
    'it'
  );
  assert(
    juneFirstPlusTwo.targetDate === '2026-06-03' && juneFirstPlusTwo.season === 'invernale',
    `1 giugno + dopodomani deve restare invernale, ottenuto ${juneFirstPlusTwo.targetDate}/${juneFirstPlusTwo.season}`
  );

  const juneTwentyEightTomorrow = processor._resolveScheduleContext(
    'A che orari verra celebrata la messa domani?',
    scheduleKb,
    '2026-06-28',
    'it'
  );
  assert(
    juneTwentyEightTomorrow.targetDate === '2026-06-29' && juneTwentyEightTomorrow.season === 'estivo',
    `28 giugno + domani deve entrare in estivo, ottenuto ${juneTwentyEightTomorrow.targetDate}/${juneTwentyEightTomorrow.season}`
  );

  assert(
    processor._resolveScheduleContext('Orari Messe', scheduleKb, '2026-06-29', 'it').season === 'estivo',
    '29 giugno deve essere incluso nel periodo estivo'
  );
  assert(
    processor._resolveScheduleContext('Orari Messe', scheduleKb, '2026-08-31', 'it').season === 'invernale',
    '31 agosto deve essere fuori dal periodo estivo'
  );
  assert(
    processor._resolveScheduleContext('Messa del 3 giugno', scheduleKb, '2026-06-01', 'it').targetDate === '2026-06-03',
    'le date esplicite tipo 3 giugno devono diventare data target'
  );
  const futureYearlessPastInCurrentYear = processor._resolveScheduleContext(
    'A che ora saranno le messe il 15 agosto?',
    scheduleKb,
    '2026-09-10',
    'it'
  );
  assert(
    futureYearlessPastInCurrentYear.targetDate === '2027-08-15' &&
      futureYearlessPastInCurrentYear.yearInference === 'next_year_from_future_intent' &&
      futureYearlessPastInCurrentYear.mentionedDateInCurrentYear === '2026-08-15',
    `data senza anno con futuro deve puntare alla prossima ricorrenza, ottenuto ${futureYearlessPastInCurrentYear.targetDate}/${futureYearlessPastInCurrentYear.yearInference}`
  );
  const ambiguousYearlessPast = processor._resolveScheduleContext(
    'Orari messe del 15 agosto',
    scheduleKb,
    '2026-09-10',
    'it'
  );
  assert(
    ambiguousYearlessPast.targetDate === '2026-08-15' &&
      ambiguousYearlessPast.targetDateIsPast === true &&
      ambiguousYearlessPast.yearInference === 'current_year_past_ambiguous',
    `data senza anno ambigua deve restare nell'anno corrente ma marcata passata, ottenuto ${ambiguousYearlessPast.targetDate}/${ambiguousYearlessPast.targetDateIsPast}/${ambiguousYearlessPast.yearInference}`
  );
  const formulaFallback2027 = processor._resolveScheduleContext(
    'Orari Messe',
    '',
    '2027-06-28',
    'it'
  );
  assert(
    formulaFallback2027.source === 'fallback_formula' &&
      formulaFallback2027.summerStartDate === '2027-06-28' &&
      formulaFallback2027.summerEndDate === '2027-09-05' &&
      formulaFallback2027.season === 'estivo',
    `fallback formula 2027 atteso 2027-06-28/2027-09-05, ottenuto ${formulaFallback2027.summerStartDate}/${formulaFallback2027.summerEndDate}/${formulaFallback2027.season}`
  );
  assert(
    processor._resolveScheduleContext('Orari Messe', '', '2027-06-27', 'it').season === 'invernale',
    'il fallback formula deve restare invernale prima del lunedi calcolato per il 2027'
  );
  assert(
    processor._detectTemporalMentions('Vorrei sapere gli orari della messa dopodomani', 'it') === true,
    'dopodomani deve attivare il rischio temporale'
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

console.log('--- Test _markMessagesAsSkipped: dry-run con label disabilitata non registra skip ---');
{
  const dryRunProcessor = new EmailProcessor();
  dryRunProcessor.config.dryRun = true;
  dryRunProcessor.config.skipLabelName = '';
  const skipped = new Set();
  dryRunProcessor._markMessagesAsSkipped(
    [createMessage('m-dry-empty-label', 'Utente <utente@example.org>', 'Info', 'Testo')],
    '',
    skipped
  );
  assert(skipped.size === 0, 'in dry-run con label skip vuota non deve aggiornare skippedMessageIds');
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


console.log('--- Test _shouldIgnoreEmail (sender senza @ non diventa bot username) ---');
{
  assert(
    processor._shouldIgnoreEmail({ senderEmail: 'newsletter', subject: 'Info', body: 'Ciao' }) === false,
    'mittente non email senza @ non deve essere confrontato come local-part bot'
  );
}

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
  shouldSkipByLanguageMode_('it', 'foreign_only') === true,
  'in foreign_only deve saltare email italiane'
);
assert(
  shouldSkipByLanguageMode_('en', 'foreign_only') === false,
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

console.log('--- Test error/review labels: message-level con notifica review unica ---');
{
  const calls = [];
  const processorLabels = new EmailProcessor({
    gmailService: {
      addLabelToMessage: (id, label) => calls.push({ type: 'message', id, label }),
      addLabelToThread: (_thread, label) => calls.push({ type: 'thread', label })
    }
  });
  processorLabels._notifyValidationReview_ = (target, context) => {
    calls.push({ type: 'notify', id: target.getId ? target.getId() : 'thread', reason: context.reason });
  };

  const messageTarget = {
    getId: () => 'm-label',
    getThread: () => ({ getId: () => 't-label' })
  };
  processorLabels._addErrorLabel(messageTarget);
  processorLabels._addValidationErrorLabel(messageTarget, { reason: 'review' });

  assert(calls.some((call) => call.type === 'message' && call.id === 'm-label' && call.label === CONFIG.ERROR_LABEL_NAME), 'Errore deve essere applicata al messaggio');
  assert(calls.some((call) => call.type === 'message' && call.id === 'm-label' && call.label === CONFIG.VALIDATION_ERROR_LABEL), 'Verifica deve essere applicata al messaggio');
  assert(!calls.some((call) => call.type === 'thread'), 'il target messaggio non deve cadere nel ramo thread-level');
  assert(calls.filter((call) => call.type === 'notify').length === 1, 'Verifica message-level deve inviare una sola notifica review');
}

console.log('--- Test error/review labels: fallback thread-level con notifica review unica ---');
{
  const calls = [];
  const processorLabels = new EmailProcessor({
    gmailService: {
      addLabelToMessage: (id, label) => calls.push({ type: 'message', id, label }),
      addLabelToThread: (_thread, label) => calls.push({ type: 'thread', label })
    }
  });
  processorLabels._notifyValidationReview_ = (_target, context) => {
    calls.push({ type: 'notify', reason: context.reason });
  };

  const threadTarget = { getId: () => 't-label' };
  processorLabels._addErrorLabel(threadTarget);
  processorLabels._addValidationErrorLabel(threadTarget, { reason: 'review' });

  assert(calls.some((call) => call.type === 'thread' && call.label === CONFIG.ERROR_LABEL_NAME), 'Errore deve cadere sul thread se il target non è un messaggio');
  assert(calls.some((call) => call.type === 'thread' && call.label === CONFIG.VALIDATION_ERROR_LABEL), 'Verifica deve cadere sul thread se il target non è un messaggio');
  assert(!calls.some((call) => call.type === 'message'), 'il target thread non deve usare addLabelToMessage');
  assert(calls.filter((call) => call.type === 'notify').length === 1, 'Verifica thread-level deve inviare una sola notifica review');
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

console.log('--- Test processThread: last speaker early-exit marca tutto il burst esterno ---');
{
  const originalSession = global.Session;
  const originalGmailApp = global.GmailApp;
  const originalLanguageMode = global.GLOBAL_CACHE.languageMode;
  let extractDetailsCalls = 0;
  const labeled = [];

  global.Session = {
    getEffectiveUser: () => ({ getEmail: () => 'info@example.org' })
  };
  global.GmailApp = {
    getAliases: () => ['segreteria@example.org']
  };
  global.GLOBAL_CACHE.languageMode = 'all';

  const lastSpeakerProcessor = new EmailProcessor({
    gmailService: {
      getMessageIdsWithLabel: () => new Set(),
      _extractEmailAddress: extractEmailAddress,
      extractMessageDetails: () => {
        extractDetailsCalls++;
        return {};
      },
      addLabelToMessage: (id) => labeled.push(id)
    }
  });

  const thread = {
    getId: () => 'thread-last-speaker-burst',
    getLabels: () => [],
    getMessages: () => [
      createMessage('m-last-speaker-first', 'Utente <utente@example.org>', 'Prima domanda', 'Vorrei informazioni.'),
      createMessage('m-last-speaker-second', 'Utente <utente@example.org>', 'Seconda domanda', 'Aggiungo un allegato.'),
      createMessage('m-last-speaker-us', 'Segreteria <segreteria@example.org>', 'Re: Seconda domanda', 'Risposta interna.', new Date('2026-04-01T10:10:00Z'), false)
    ]
  };

  const result = lastSpeakerProcessor.processThread(thread, '', [], new Set(), true);
  assert(result.status === 'skipped', 'last_speaker_is_me deve saltare il thread prima dello STEP 1');
  assert(result.reason === 'last_speaker_is_me', 'deve usare la reason last_speaker_is_me');
  assert(extractDetailsCalls === 0, 'non deve estrarre dettagli quando scatta last_speaker_is_me');
  assert(labeled.includes('m-last-speaker-first'), 'deve marcare il primo messaggio del burst esterno');
  assert(labeled.includes('m-last-speaker-second'), 'deve marcare il secondo messaggio del burst esterno');

  global.Session = originalSession;
  global.GmailApp = originalGmailApp;
  global.GLOBAL_CACHE.languageMode = originalLanguageMode;
}

console.log('--- Test processThread: quick check filtrato marca tutto il burst esterno ---');
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
  assert(labeled.includes('m-secondary'), 'deve marcare anche il secondario gia incluso nel burst valutato');

  global.Session = originalSession;
  global.GmailApp = originalGmailApp;
  global.GLOBAL_CACHE.languageMode = originalLanguageMode;
}

console.log('--- Test processThread: non filtra come OOO una richiesta pastorale con assente ---');
{
  const originalSession = global.Session;
  const originalGmailApp = global.GmailApp;
  const originalLanguageMode = global.GLOBAL_CACHE.languageMode;
  let quickCheckCalled = false;

  global.Session = {
    getEffectiveUser: () => ({ getEmail: () => 'info@example.org' })
  };
  global.GmailApp = {
    getAliases: () => []
  };
  global.GLOBAL_CACHE.languageMode = 'all';

  const processorPastoralAbsence = new EmailProcessor({
    geminiService: {
      detectEmailLanguage: () => ({ lang: 'it', safetyGrade: 5 }),
      shouldRespondToEmail: () => {
        quickCheckCalled = true;
        return { shouldRespond: false, reason: 'ack' };
      }
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
      addLabelToMessage: () => {}
    }
  });

  const thread = {
    getId: () => 'thread-assente-pastorale',
    getLabels: () => [],
    getMessages: () => [
      createMessage('m-assente-pastorale', 'Utente <utente@example.org>', 'Richiesta appuntamento', 'Don Raimondo è assente oggi, quando posso trovarlo?')
    ]
  };

  const result = processorPastoralAbsence.processThread(thread, '', [], new Set(), true);
  assert(result.reason !== 'out_of_office', 'la parola assente senza contesto auto-risposta non deve attivare OOO');
  assert(quickCheckCalled, 'la richiesta con assente deve arrivare al quick check invece di essere filtrata silenziosamente');

  global.Session = originalSession;
  global.GmailApp = originalGmailApp;
  global.GLOBAL_CACHE.languageMode = originalLanguageMode;
}

console.log('--- Test lingua: codice troppo corto non sovrascrive fallback valido ---');
assert(processor._normalizeLanguageCode_('en-US', 'it') === 'en', 'codici tipo en-US devono essere normalizzati a due lettere');
assert(processor._normalizeLanguageCode_('e', 'it') === 'it', 'codici di una sola lettera devono usare fallback');
assert(processor._normalizeLanguageCode_('', '') === '', 'fallback vuoto resta vuoto per quick-check non affidabile');

console.log('--- Test processThread: burst stesso mittente ordinato per data ---');
{
  const originalSession = global.Session;
  const originalGmailApp = global.GmailApp;
  const originalLanguageMode = global.GLOBAL_CACHE.languageMode;
  let capturedBody = '';

  global.Session = {
    getEffectiveUser: () => ({ getEmail: () => 'info@example.org' })
  };
  global.GmailApp = {
    getAliases: () => []
  };
  global.GLOBAL_CACHE.languageMode = 'all';

  const processorOrderedBurst = new EmailProcessor({
    geminiService: {
      detectEmailLanguage: () => ({ lang: 'it', safetyGrade: 5 }),
      shouldRespondToEmail: (body) => {
        capturedBody = body;
        return { shouldRespond: false, reason: 'ack' };
      }
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
      addLabelToMessage: () => {}
    }
  });

  const thread = {
    getId: () => 'thread-ordered-burst',
    getLabels: () => [],
    getMessages: () => [
      createMessage('m-second', 'Utente <utente@example.org>', 'Seconda', 'Secondo messaggio', new Date('2026-04-01T10:05:00Z')),
      createMessage('m-first', 'Utente <utente@example.org>', 'Prima', 'Primo messaggio', new Date('2026-04-01T10:00:00Z')),
      createMessage('m-candidate', 'Utente <utente@example.org>', 'Terza', 'Terzo messaggio', new Date('2026-04-01T10:10:00Z'))
    ]
  };

  const result = processorOrderedBurst.processThread(thread, '', [], new Set(), true);
  assert(result.status === 'filtered', 'quick check deve filtrare il burst di test');
  assert(capturedBody.indexOf('Primo messaggio') < capturedBody.indexOf('Secondo messaggio'), 'il primo messaggio cronologico deve precedere il secondo');
  assert(capturedBody.indexOf('Secondo messaggio') < capturedBody.indexOf('Terzo messaggio'), 'il candidato finale deve restare dopo i messaggi precedenti');

  global.Session = originalSession;
  global.GmailApp = originalGmailApp;
  global.GLOBAL_CACHE.languageMode = originalLanguageMode;
}

console.log('--- Test processThread: burst multi-mittente preserva mittenti non aggregati ---');
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

  const processorMultiSenderBurst = new EmailProcessor({
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
    getId: () => 'thread-multi-sender-burst',
    getLabels: () => [],
    getMessages: () => [
      createMessage('m-other-sender', 'Altro <altro@example.org>', 'Domanda separata', 'Vorrei informazioni sugli orari.', new Date('2026-04-01T09:00:00Z')),
      createMessage('m-same-sender', 'Utente <utente@example.org>', 'Prima domanda', 'Vorrei informazioni sulla catechesi.', new Date('2026-04-01T10:00:00Z')),
      createMessage('m-candidate', 'Utente <utente@example.org>', 'Re: Prima domanda', 'Grazie', new Date('2026-04-01T10:05:00Z'))
    ]
  };

  const result = processorMultiSenderBurst.processThread(thread, '', [], new Set(), true);
  assert(result.status === 'filtered', 'quick check shouldRespond=false deve filtrare il candidato');
  assert(labeled.includes('m-candidate'), 'deve marcare il candidato filtrato');
  assert(labeled.includes('m-same-sender'), 'deve marcare il messaggio dello stesso mittente incluso nel burst');
  assert(!labeled.includes('m-other-sender'), 'non deve marcare messaggi di altri mittenti non inclusi nel payload');

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

console.log('--- Test processThread: ping-pong alternato non attiva anti-loop al 50% bot ---');
{
  const originalSession = global.Session;
  const originalGmailApp = global.GmailApp;
  const originalLanguageMode = global.GLOBAL_CACHE.languageMode;
  let classifierCalls = 0;
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
      classifyEmail: () => {
        classifierCalls++;
        return { shouldReply: false, reason: 'unit_test_stop' };
      }
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
    const isBot = index % 2 === 0;
    return createMessage(
      `m-ping-pong-${index}`,
      isBot ? 'Segreteria <segreteria@example.org>' : 'Utente <utente@example.org>',
      `Ping pong ${index}`,
      isBot ? 'Risposta della segreteria.' : 'Messaggio di follow-up esterno.',
      new Date(baseDate.getTime() + index * 60000)
    );
  });

  const thread = {
    getId: () => 'thread-anti-loop-ping-pong',
    getLabels: () => [],
    getMessages: () => messages
  };

  const result = antiLoopProcessor.processThread(thread, '', [], new Set(), true);
  assert(result.status === 'filtered', 'il ping-pong alternato deve proseguire fino al classifier');
  assert(result.reason !== 'email_loop_detected', 'una densità bot del 50% non deve essere classificata come loop');
  assert(classifierCalls === 1, 'il classifier deve essere chiamato quando il thread alternato è sano');
  assert(labeled.includes('m-ping-pong-11'), 'il candidato finale deve essere marcato come gestito');

  global.Session = originalSession;
  global.GmailApp = originalGmailApp;
  global.GLOBAL_CACHE.languageMode = originalLanguageMode;
}

console.log('--- Test processThread: densità bot oltre metà finestra attiva anti-loop ---');
{
  const originalSession = global.Session;
  const originalGmailApp = global.GmailApp;
  const originalLanguageMode = global.GLOBAL_CACHE.languageMode;
  let classifierCalls = 0;
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
      classifyEmail: () => {
        classifierCalls++;
        return { shouldReply: false, reason: 'unit_test_stop' };
      }
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
  const botIndexes = new Set([0, 2, 4, 6, 7, 9, 10]);
  const messages = Array.from({ length: 12 }, (_, index) => {
    const isBot = botIndexes.has(index);
    return createMessage(
      `m-bot-density-${index}`,
      isBot ? 'Segreteria <segreteria@example.org>' : 'Utente <utente@example.org>',
      `Densità bot ${index}`,
      isBot ? 'Risposta della segreteria.' : 'Messaggio di follow-up esterno.',
      new Date(baseDate.getTime() + index * 60000)
    );
  });

  const thread = {
    getId: () => 'thread-anti-loop-density',
    getLabels: () => [],
    getMessages: () => messages
  };

  const result = antiLoopProcessor.processThread(thread, '', [], new Set(), true);
  assert(result.status === 'filtered', 'il thread con densità bot anomala deve essere filtrato');
  assert(result.reason === 'email_loop_detected', 'deve usare la reason anti-loop quando i bot superano metà finestra');
  assert(classifierCalls === 0, 'il classifier non deve essere chiamato quando scatta anti-loop');
  assert(labeled.includes('m-bot-density-11'), 'il candidato finale deve essere marcato come gestito');

  global.Session = originalSession;
  global.GmailApp = originalGmailApp;
  global.GLOBAL_CACHE.languageMode = originalLanguageMode;
}

console.log('--- Test processThread: anti-loop early-exit marca tutto il burst esterno ---');
{
  const originalSession = global.Session;
  const originalGmailApp = global.GmailApp;
  const originalLanguageMode = global.GLOBAL_CACHE.languageMode;
  let classifierCalls = 0;
  const labeled = [];

  global.Session = {
    getEffectiveUser: () => ({ getEmail: () => 'info@example.org' })
  };
  global.GmailApp = {
    getAliases: () => ['segreteria@example.org']
  };
  global.GLOBAL_CACHE.languageMode = 'all';

  const antiLoopBurstProcessor = new EmailProcessor({
    geminiService: {
      detectEmailLanguage: () => ({ lang: 'it', safetyGrade: 5 })
    },
    classifier: {
      _extractMainContent: (body) => body,
      classifyEmail: () => {
        classifierCalls++;
        return { shouldReply: false, reason: 'unit_test_stop' };
      }
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
  const messages = Array.from({ length: 5 }, (_, index) => createMessage(
    `m-loop-burst-${index}`,
    'Utente <utente@example.org>',
    `Follow-up ${index}`,
    `Messaggio esterno ${index}`,
    new Date(baseDate.getTime() + index * 60000)
  ));

  const thread = {
    getId: () => 'thread-anti-loop-burst',
    getLabels: () => [],
    getMessages: () => messages
  };

  const result = antiLoopBurstProcessor.processThread(thread, '', [], new Set(), true);
  assert(result.status === 'filtered', 'il burst esterno deve essere filtrato dall anti-loop');
  assert(result.reason === 'email_loop_detected', 'deve scattare l anti-loop prima dello STEP 1');
  assert(classifierCalls === 0, 'il classifier non deve essere chiamato quando scatta un early-exit anti-loop');
  messages.forEach((message) => {
    assert(labeled.includes(message.getId()), `deve marcare tutto il burst, incluso ${message.getId()}`);
  });

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

console.log('--- Test _markMessageAsProcessed: foreign_only preserva skip e non promuove a IA ---');
{
  const labels = [];
  const originalLanguageMode = global.GLOBAL_CACHE.languageMode;
  global.GLOBAL_CACHE.languageMode = 'foreign_only';

  const processor = new EmailProcessor({
    gmailService: {
      _getOptionalLabelIdByName: (labelName) => labelName === CONFIG.SKIP_LABEL_NAME ? 'label-skip' : null,
      _getMessageMetadataWithResilience: () => ({ labelIds: ['label-skip'] }),
      addLabelToMessage: (id, label) => labels.push({ id, label }),
      removeLabelFromMessage: (id, label) => labels.push({ id, label, removed: true })
    }
  });

  processor._markMessageAsProcessed(
    createMessage('m-skip-preserved', 'Utente <utente@example.org>', 'Italiano', 'Messaggio già saltato'),
    new Set(),
    new Set()
  );

  assert(!labels.some((entry) => entry.label === CONFIG.LABEL_NAME), 'foreign_only non deve promuovere a IA un messaggio con skip live');
  assert(!labels.some((entry) => entry.removed), 'foreign_only non deve rimuovere la label skip preservata');

  global.GLOBAL_CACHE.languageMode = originalLanguageMode;
}

console.log('--- Test _shouldPreserveSkipLabelInForeignOnly_: metadata error fail-closed ---');
{
  const originalLanguageMode = global.GLOBAL_CACHE.languageMode;
  global.GLOBAL_CACHE.languageMode = 'foreign_only';

  const processor = new EmailProcessor({
    gmailService: {
      _getOptionalLabelIdByName: (labelName) => labelName === CONFIG.SKIP_LABEL_NAME ? 'label-skip' : null,
      _getMessageMetadataWithResilience: () => { throw new Error('quota transitoria'); }
    }
  });

  assert(
    processor._shouldPreserveSkipLabelInForeignOnly_('m-skip-metadata-error') === true,
    'errori metadata in foreign_only devono preservare skip fail-closed senza propagare'
  );

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
