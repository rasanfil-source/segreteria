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
global.MemoryService = class {
  getMemory() { return {}; }
  getRecentHistory() { return []; }
  updateMemoryAtomic() { return true; }
  updateReaction() { return true; }
};
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

const gasResponseStrategyPath = path.join(__dirname, '..', 'gas_response_strategy.js');
vm.runInThisContext(fs.readFileSync(gasResponseStrategyPath, 'utf8'), { filename: gasResponseStrategyPath });

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

console.log('--- Test _isTerritoryRequest: confini parrocchiali attiva verifica territorio ---');
assert(
  processor._isTerritoryRequest(
    'Confini parrocchiali',
    'Buongiorno, vorrei sapere se via Bartolo Oriani fa parte della vostra parrocchia.',
    { topic: 'informazioni generiche' }
  ) === true,
  'confini parrocchiali/fa parte della parrocchia deve attivare la verifica territorio'
);
assert(
  processor._isTerritoryRequest(
    'Appartenenza',
    'Vorrei verificare l\'appartenenza parrocchiale di via Bartolo Oriani.',
    { topic: 'informazioni generiche' }
  ) === true,
  'appartenenza parrocchiale deve attivare la verifica territorio anche senza topic Gemini'
);
assert(
  processor._isTerritoryRequest(
    'Catechismo',
    'Mio figlio fa parte del gruppo cresima?',
    { topic: 'catechismo' }
  ) === false,
  'fa parte senza contesto territoriale non deve attivare la verifica territorio'
);
assert(
  processor._isTerritoryRequest(
    'Informazioni',
    'Buongiorno, avrei una domanda su via Bartolo Oriani.',
    { topic: 'indirizzo generico', is_territory_request: true }
  ) === true,
  'il flag AI is_territory_request deve attivare la verifica territorio anche senza keyword locali'
);
{
  const territoryCandidateProcessor = new EmailProcessor({
    territoryValidator: {
      analyzeEmailForAddress: (content) => {
        if (content === 'via Bartolo Oriani') {
          return {
            addressFound: true,
            addresses: [{
              street: 'via Bartolo Oriani',
              civic: null,
              verification: {
                inParish: false,
                needsCivic: false,
                reason: "'via Bartolo Oriani' non è nel territorio della nostra parrocchia",
                details: 'fuori_territorio'
              }
            }]
          };
        }
        return { addressFound: false };
      }
    }
  });
  const candidates = territoryCandidateProcessor._extractQuickCheckTerritoryCandidates_({
    territory_address_candidates: ['via Bartolo Oriani', 'via Bartolo Oriani', 'Bartolo Oriani']
  });
  assert(candidates.length === 1 && candidates[0] === 'via Bartolo Oriani', 'il processor deve estrarre candidati AI validi con tipo strada');
  const candidateResult = territoryCandidateProcessor._analyzeAiTerritoryCandidates_(candidates);
  assert(candidateResult.addressFound === true, 'il processor deve usare i candidati AI come fallback di analisi territorio');
  assert(candidateResult.addresses[0].verification.details === 'fuori_territorio', 'il fallback AI deve preservare fuori_territorio');
}

console.log('--- Test business date/time: fallback estremo resta su Europe/Rome ---');
{
  const originalUtilities = global.Utilities;
  const originalDateTimeFormat = global.Intl.DateTimeFormat;
  const originalGetHours = Date.prototype.getHours;
  const originalGetFullYear = Date.prototype.getFullYear;
  const originalGetMonth = Date.prototype.getMonth;
  const originalGetDate = Date.prototype.getDate;
  global.Utilities = {
    formatDate: () => { throw new Error('Utilities unavailable'); }
  };
  global.Intl.DateTimeFormat = function() {
    throw new Error('Intl unavailable');
  };
  Date.prototype.getHours = Date.prototype.getUTCHours;
  Date.prototype.getFullYear = Date.prototype.getUTCFullYear;
  Date.prototype.getMonth = Date.prototype.getUTCMonth;
  Date.prototype.getDate = Date.prototype.getUTCDate;
  try {
    const summerMidnightRome = new Date('2026-06-07T22:15:00Z');
    assert(
      processor._getBusinessTimeString(summerMidnightRome) === '00:15' &&
        processor._getBusinessDateString(summerMidnightRome) === '2026-06-08',
      `fallback Roma estivo deve convertire UTC->CEST, ottenuto ${processor._getBusinessDateString(summerMidnightRome)} ${processor._getBusinessTimeString(summerMidnightRome)}`
    );
    const winterMidnightRome = new Date('2026-01-01T23:30:00Z');
    assert(
      processor._getBusinessTimeString(winterMidnightRome) === '00:30' &&
        processor._getBusinessDateString(winterMidnightRome) === '2026-01-02',
      `fallback Roma invernale deve convertire UTC->CET, ottenuto ${processor._getBusinessDateString(winterMidnightRome)} ${processor._getBusinessTimeString(winterMidnightRome)}`
    );
  } finally {
    global.Utilities = originalUtilities;
    global.Intl.DateTimeFormat = originalDateTimeFormat;
    Date.prototype.getHours = originalGetHours;
    Date.prototype.getFullYear = originalGetFullYear;
    Date.prototype.getMonth = originalGetMonth;
    Date.prototype.getDate = originalGetDate;
  }
}

console.log('--- Test runtimeContext: fallback messageDate non implica email vecchia ---');
{
  const fallbackRuntime = processor._buildRuntimeContext_(
    { date: new Date('invalid') },
    new Date('2026-06-08T10:00:00Z'),
    ''
  );
  assert(
    fallbackRuntime.temporal.messageDateAvailable === false &&
      fallbackRuntime.temporal.messageDateSource === 'processing_fallback' &&
      fallbackRuntime.temporal.messageTime === null &&
      fallbackRuntime.temporal.isOldMessage === false,
    `fallback messageDate deve restare esplicito senza fingere email vecchia, ottenuto ${fallbackRuntime.temporal.messageDateSource}/${fallbackRuntime.temporal.isOldMessage}`
  );

  const oldRuntime = processor._buildRuntimeContext_(
    { date: new Date('2026-06-01T10:00:00Z') },
    new Date('2026-06-08T10:00:00Z'),
    ''
  );
  assert(
    oldRuntime.temporal.messageDateAvailable === true &&
      oldRuntime.temporal.messageTime === '12:00' &&
      oldRuntime.temporal.daysAgo === 7 &&
      oldRuntime.temporal.isOldMessage === true,
    `data Gmail valida vecchia deve restare marcata come old, ottenuto ${oldRuntime.temporal.daysAgo}/${oldRuntime.temporal.isOldMessage}`
  );
}

console.log('--- Test correction prompt: fallback papale esplicito ---');
{
  const prompt = processor._renderRuntimeContextForCorrection_({
    temporal: {
      currentDate: '2026-06-08',
      currentTime: '10:00',
      messageDate: '2026-06-08'
    },
    papal: {}
  }, 'it', 'full');
  assert(
    prompt.includes('Papa attuale/regnante: Leone XIV') &&
      prompt.includes('Papa precedente/non regnante: Papa Francesco') &&
      prompt.includes('non presentare Papa Francesco come Papa attuale'),
    'il prompt correttivo deve nominare esplicitamente Papa attuale e precedente anche con runtime papal parziale'
  );
}

console.log('--- Test memory summary: usa referenceDate stabile ---');
{
  const summary = processor._buildMemorySummary({
    existingSummary: '',
    responseText: 'Buongiorno. Le confermiamo che le Messe domenicali sono alle 9:00 e alle 11:00. Cordiali saluti.',
    providedTopics: ['orari messe'],
    referenceDate: new Date('2026-01-02T12:00:00Z')
  });
  assert(
    summary && summary.includes('[2026-01-02]'),
    `memory summary deve usare referenceDate invece del clock corrente, ottenuto ${summary}`
  );
}

console.log('--- Test salutation mode: timestamp invalido/futuro resta safe e diagnostico ---');
{
  const originalParseDateSafe = global.parseDateSafe;
  global.parseDateSafe = () => null;
  try {
    assert(
      computeSalutationMode({ isReply: true, memoryExists: true, lastUpdated: 'not-a-date', now: new Date('2026-06-01T10:00:00Z') }) === 'full',
      'lastUpdated invalido con parseDateSafe null deve tornare full senza eccezioni'
    );
  } finally {
    if (typeof originalParseDateSafe === 'undefined') {
      delete global.parseDateSafe;
    } else {
      global.parseDateSafe = originalParseDateSafe;
    }
  }

  global.parseDateSafe = () => {
    throw new Error('parse failure');
  };
  try {
    assert(
      computeSalutationMode({ isReply: true, memoryExists: true, lastUpdated: '2026-06-01', now: new Date('2026-06-01T10:00:00Z') }) === 'full',
      'computeSalutationMode deve tornare full se parseDateSafe lancia eccezione'
    );
    const delay = computeResponseDelay({ messageDate: '2026-06-01', now: new Date('2026-06-05T10:00:00Z') });
    assert(
      delay.shouldApologize === false && delay.hours === 0 && delay.days === 0,
      'computeResponseDelay deve tornare valori neutri se parseDateSafe lancia eccezione'
    );
  } finally {
    if (typeof originalParseDateSafe === 'undefined') {
      delete global.parseDateSafe;
    } else {
      global.parseDateSafe = originalParseDateSafe;
    }
  }

  const originalWarn = console.warn;
  let warning = '';
  console.warn = (message) => {
    warning = String(message || '');
  };
  try {
    const mode = computeSalutationMode({
      isReply: true,
      memoryExists: true,
      lastUpdated: new Date('2026-06-01T10:05:00Z'),
      now: new Date('2026-06-01T10:00:00Z')
    });
    assert(
      mode === 'full' &&
        warning.includes('computeSalutationMode') &&
        warning.includes('delta=-300s'),
      `timestamp futuro deve loggare diagnostica utile, ottenuto ${mode}/${warning}`
    );
  } finally {
    console.warn = originalWarn;
  }
}


console.log('--- Test safety valve: fallback Pacific usa Intl America/Los_Angeles ---');
{
  const originalUtilities = global.Utilities;
  const originalIntl = global.Intl;
  let receivedTimeZone = '';
  global.Utilities = {
    formatDate: () => {
      throw new Error('timezone unavailable');
    }
  };
  global.Intl = {
    DateTimeFormat: function (_locale, options) {
      receivedTimeZone = options && options.timeZone;
      return {
        formatToParts: () => [
          { type: 'month', value: '01' },
          { type: 'day', value: '02' },
          { type: 'year', value: '2026' }
        ]
      };
    }
  };

  try {
    const safetyProcessor = new EmailProcessor();
    const safetyDate = safetyProcessor._getPacificDateForSafetyValve_();
    assert(
      safetyDate === '2026-01-02' && receivedTimeZone === 'America/Los_Angeles',
      `fallback safety valve deve usare America/Los_Angeles via Intl, ottenuto ${safetyDate}/${receivedTimeZone}`
    );
  } finally {
    global.Utilities = originalUtilities;
    global.Intl = originalIntl;
  }
}


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

console.log('--- Test time discrepancy: delta orario circolare cross-midnight ---');
{
  assert(
    processor._timeDistanceMinutesCircular_(23 * 60 + 30, 30) === 60,
    '23:30 e 00:30 devono distare 60 minuti nel delta circolare'
  );
  assert(
    processor._timeDistanceMinutesCircular_(16 * 60 + 30, 17 * 60) === 30,
    'delta circolare deve preservare distanze ordinarie nello stesso giorno'
  );
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

  const certificateRequest = ruleProcessor._detectDocumentRequestWithSupportingData_(
    'Certificato di battesimo',
    "Agnese Tonchei 28/02/1998\nbattesimo 24/05/1998 a sant eugenio\n\nRichiedo gentilmente certificato in copia originale. Sant'Agnese non vuole email e certificato di battesimo in copia pdf verrò io a ritirarlo di persona lunedì 27 o 28 luglio. Se gentilmente può stamparlo per uso matrimonio."
  );
  assert(certificateRequest.detected === true, 'richiesta certificato con dati anagrafici non deve essere trattata come mera submission');
  assert(certificateRequest.requested_action === 'prepare_certificate', 'la richiesta deve preservare l’azione concreta di preparare il certificato');
  assert(certificateRequest.requires_archive_verification === true, 'i dati sacramentali devono attivare verifica archivistica condizionata');

  const routingState = {
    routedAiCoreLite: 'AI_CORE_LITE',
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
    routingState.routedAiCoreLite === '' &&
      routingState.routedAiCore === '' &&
      routingState.routedDoctrine === '' &&
      Array.isArray(routingState.routedDoctrineStructured) &&
      routingState.routedDoctrineStructured.length === 0,
    'routing tecnico deve disattivare AI_CORE_LITE e i moduli dottrinali pesanti'
  );

  const sensitiveRoutingState = {
    routedAiCore: 'AI_CORE',
    routedDoctrine: 'DOTTRINA',
    routedDoctrineStructured: [{ id: 'd1' }]
  };
  const sensitiveConcernFlags = {
    emotional_sensitivity: true,
    discernment_risk: true
  };
  const hasPastoralConcern = Boolean(
    sensitiveConcernFlags.emotional_sensitivity ||
      sensitiveConcernFlags.discernment_risk ||
      sensitiveConcernFlags.doctrine ||
      sensitiveConcernFlags.sensitive ||
      sensitiveConcernFlags.canonLaw ||
      sensitiveConcernFlags.sacrament ||
      sensitiveConcernFlags.formalComplaint
  );
  const sensitiveRoutingContext = ruleProcessor._createRuleContext_({
    phase: 'context_routing',
    state: sensitiveRoutingState,
    isTechnicalOnly: false,
    hasPastoralConcern: hasPastoralConcern
  });
  const sensitiveRoutingDecision = ruleProcessor._evaluateEmailPolicyRules_(sensitiveRoutingContext);
  assert(
    sensitiveRoutingDecision && sensitiveRoutingDecision.ruleId === 'full-context-routing',
    'concern emotivi/discernimento devono impedire il routing tecnico puro'
  );
  ruleProcessor._applyPreAiRuleDecision_(sensitiveRoutingDecision, sensitiveRoutingContext, { status: 'unknown' });
  assert(
    sensitiveRoutingState.routedAiCore === 'AI_CORE' &&
      sensitiveRoutingState.routedDoctrine === 'DOTTRINA' &&
      sensitiveRoutingState.routedDoctrineStructured.length === 1,
    'routing con concern pastorali reali deve mantenere i moduli pesanti'
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

  const delayedProcessingTomorrow = processor._resolveScheduleContext(
    'A che orari verra celebrata la messa domani?',
    scheduleKb,
    '2026-06-26',
    'it',
    '2026-06-30'
  );
  assert(
    delayedProcessingTomorrow.targetDate === '2026-06-27' &&
      delayedProcessingTomorrow.currentDate === '2026-06-30' &&
      delayedProcessingTomorrow.requestAnchorDate === '2026-06-26' &&
      delayedProcessingTomorrow.targetDateIsPast === true,
    `domani deve ancorarsi alla data messaggio e risultare passato al processing, ottenuto ${delayedProcessingTomorrow.targetDate}/${delayedProcessingTomorrow.currentDate}/${delayedProcessingTomorrow.targetDateIsPast}`
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
  const crossYearRange = processor._parseItalianDateRange_('Periodo natalizio: dal 15 dicembre al 6 gennaio', 2026);
  assert(
    crossYearRange &&
      processor._formatDateOnlyIso_(crossYearRange.start) === '2026-12-15' &&
      processor._formatDateOnlyIso_(crossYearRange.end) === '2027-01-06',
    `range dicembre-gennaio deve attraversare l'anno, ottenuto ${crossYearRange ? `${processor._formatDateOnlyIso_(crossYearRange.start)}/${processor._formatDateOnlyIso_(crossYearRange.end)}` : 'null'}`
  );
  assert(
    processor._coerceBusinessDateOnly_(null) === null &&
      processor._coerceBusinessDateOnly_('') === null,
    'input data null/vuoto non deve diventare epoch 1970'
  );
  const nullDateContext = processor._resolveScheduleContext(
    'Orari Messe',
    scheduleKb,
    null,
    'it',
    null
  );
  assert(
    nullDateContext.currentDate !== '1970-01-01' &&
      nullDateContext.requestAnchorDate !== '1970-01-01',
    `schedule context con date nulle non deve cadere su 1970, ottenuto ${nullDateContext.currentDate}/${nullDateContext.requestAnchorDate}`
  );
  const mixedSeparatorDate = processor._resolveScheduleContext(
    'Messa 01/02-2026',
    scheduleKb,
    '2026-01-01',
    'it'
  );
  assert(
    mixedSeparatorDate.isExplicitTarget === false &&
      mixedSeparatorDate.targetDate === '2026-01-01',
    `date con separatori misti devono essere ignorate dal processor, ottenuto ${mixedSeparatorDate.targetDate}/${mixedSeparatorDate.isExplicitTarget}`
  );
  const coherentSeparatorDate = processor._resolveScheduleContext(
    'Messa 01-02-2026',
    scheduleKb,
    '2026-01-01',
    'it'
  );
  assert(
    coherentSeparatorDate.isExplicitTarget === true &&
      coherentSeparatorDate.targetDate === '2026-02-01',
    `date numeriche con separatore coerente devono restare valide, ottenuto ${coherentSeparatorDate.targetDate}/${coherentSeparatorDate.isExplicitTarget}`
  );
  const sameDayYearlessDate = processor._resolveScheduleContext(
    'A che ora saranno le messe il 15 agosto?',
    scheduleKb,
    '2026-08-15',
    'it'
  );
  assert(
    sameDayYearlessDate.targetDate === '2026-08-15' &&
      sameDayYearlessDate.yearInference === 'current_year',
    `data senza anno citata nel giorno stesso deve restare current_year, ottenuto ${sameDayYearlessDate.targetDate}/${sameDayYearlessDate.yearInference}`
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
  const delayedYearlessFuture = processor._resolveScheduleContext(
    'A che ora saranno le messe il 15 agosto?',
    scheduleKb,
    '2026-08-14',
    'it',
    '2026-09-10'
  );
  assert(
    delayedYearlessFuture.targetDate === '2026-08-15' &&
      delayedYearlessFuture.yearInference === 'current_year' &&
      delayedYearlessFuture.targetDateIsPast === true,
    `data senza anno deve usare messageDate come ancora e currentDate solo per passato/futuro, ottenuto ${delayedYearlessFuture.targetDate}/${delayedYearlessFuture.yearInference}/${delayedYearlessFuture.targetDateIsPast}`
  );
  const structuredTemporalCrossYear = processor._resolveScheduleContext(
    'A che ora saranno le messe il 15 agosto?',
    scheduleKb,
    {
      currentDate: '2027-01-02',
      messageDate: '2026-12-31',
      messageDateAvailable: true,
      messageDateSource: 'gmail_message_date'
    },
    'it',
    '2027-01-02'
  );
  assert(
    structuredTemporalCrossYear.targetDate === '2027-08-15' &&
      structuredTemporalCrossYear.currentDate === '2027-01-02' &&
      structuredTemporalCrossYear.requestAnchorDate === '2026-12-31' &&
      structuredTemporalCrossYear.requestAnchorSource === 'gmail_message_date',
    `contesto temporale strutturato deve distinguere messageDate/currentDate, ottenuto ${structuredTemporalCrossYear.targetDate}/${structuredTemporalCrossYear.currentDate}/${structuredTemporalCrossYear.requestAnchorDate}/${structuredTemporalCrossYear.requestAnchorSource}`
  );
  const fallbackTemporalContext = processor._resolveScheduleContext(
    'A che ora saranno le messe il 15 agosto?',
    scheduleKb,
    {
      currentDate: '2027-01-02',
      messageDate: '2027-01-02',
      messageDateAvailable: false,
      messageDateSource: 'processing_fallback'
    },
    'it'
  );
  assert(
    fallbackTemporalContext.requestAnchorDateIsFallback === true &&
      fallbackTemporalContext.messageDateAvailable === false &&
      fallbackTemporalContext.requestAnchorSource === 'processing_fallback',
    `fallback messageDate deve essere marcato nei metadati schedule, ottenuto ${fallbackTemporalContext.requestAnchorDateIsFallback}/${fallbackTemporalContext.messageDateAvailable}/${fallbackTemporalContext.requestAnchorSource}`
  );
  const leapDayFuture = processor._resolveScheduleContext(
    'Quando saranno le messe il 29 febbraio?',
    scheduleKb,
    '2024-03-01',
    'it'
  );
  assert(
    leapDayFuture.targetDate === '2028-02-29' &&
      leapDayFuture.yearInference === 'next_valid_year_from_future_intent',
    `29 febbraio con intento futuro deve puntare al prossimo anno valido, ottenuto ${leapDayFuture.targetDate}/${leapDayFuture.yearInference}`
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
  const formulaFallback2022 = processor._resolveScheduleContext(
    'Orari Messe',
    '',
    '2022-06-27',
    'it'
  );
  assert(
    formulaFallback2022.source === 'fallback_formula' &&
      formulaFallback2022.summerStartDate === '2022-06-27' &&
      formulaFallback2022.season === 'estivo',
    `fallback formula con 26 giugno domenica deve iniziare il 27 giugno, ottenuto ${formulaFallback2022.summerStartDate}/${formulaFallback2022.season}`
  );
  assert(
    processor._resolveScheduleContext('Orari Messe', '', '2022-06-26', 'it').season === 'invernale',
    'se il 26 giugno cade di domenica, il periodo estivo deve partire dal lunedi successivo'
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

console.log('--- Test receipt-only response: passa senderName al saluto bypass ---');
{
  const greetingCalls = [];
  const receiptProcessor = new EmailProcessor({
    geminiService: {
      getAdaptiveGreeting: (senderName, language) => {
        greetingCalls.push({ senderName, language });
        return {
          greeting: `Gentile ${senderName},`,
          closing: 'Cordiali saluti,'
        };
      }
    }
  });

  const response = receiptProcessor._buildReceiptOnlySubmissionResponse_(
    'it',
    'formal',
    'attachment',
    { senderName: 'Mario Rossi' }
  );

  assert(greetingCalls.length === 1, 'receipt-only deve invocare il saluto adattivo una volta');
  assert(greetingCalls[0].senderName === 'Mario Rossi', 'receipt-only deve passare il senderName reale al saluto bypass');
  assert(greetingCalls[0].language === 'it', 'receipt-only deve passare la lingua normalizzata al saluto bypass');
  assert(response.startsWith('Gentile Mario Rossi,'), 'receipt-only deve usare il saluto generato con il nome del mittente');
  assert(!response.includes('fallbackSenderName'), 'receipt-only non deve esporre placeholder tecnici');
}

console.log('--- Test quick-check memory context: propaga canonical_complexity e rimuove flag non persistibile ---');
{
  const quickMemory = processor._buildQuickCheckMemoryContext_({
    memorySummary: 'Thread formale canonico',
    contextualFlags: {
      remote_user: true,
      canonical_complexity: true,
      physical_presence_constraint: true
    }
  });

  assert(quickMemory.contextualFlags.remote_user === true, 'quick-check deve ricevere remote_user persistito');
  assert(quickMemory.contextualFlags.canonical_complexity === true, 'quick-check deve ricevere canonical_complexity persistito');
  assert(
    !Object.prototype.hasOwnProperty.call(quickMemory.contextualFlags, 'physical_presence_constraint'),
    'quick-check non deve esporre physical_presence_constraint come flag memoria persistita'
  );
}

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
assert(
  shouldSkipByLanguageMode_('unknown', 'foreign_only') === false,
  'in foreign_only non deve saltare lingua non determinata'
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

console.log('--- Test _markMessageAsProcessed: dry-run non muta Gmail ma aggiorna cache locale ---');
{
  const calls = [];
  const dryRunProcessor = new EmailProcessor({
    gmailService: {
      addLabelToMessage: (id, label) => calls.push({ type: 'add', id, label }),
      removeLabelFromMessage: (id, label) => calls.push({ type: 'remove', id, label })
    }
  });
  dryRunProcessor.config.dryRun = true;

  const labeledIds = new Set();
  dryRunProcessor._markMessageAsProcessed(createMessage('m-dry-ia', 'Utente <utente@example.org>', 'Oggetto', 'Body'), labeledIds);

  assert(calls.length === 0, 'dry-run non deve aggiungere o rimuovere label Gmail per messaggio processato');
  assert(labeledIds.has('m-dry-ia'), 'dry-run deve aggiornare labeledMessageIds per coerenza del batch locale');
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

console.log('--- Test error/review labels: dry-run blocca label e notifica review ---');
{
  const calls = [];
  const processorLabels = new EmailProcessor({
    gmailService: {
      addLabelToMessage: (id, label) => calls.push({ type: 'message', id, label }),
      addLabelToThread: (_thread, label) => calls.push({ type: 'thread', label })
    }
  });
  processorLabels.config.dryRun = true;
  processorLabels._notifyValidationReview_ = (target, context) => {
    calls.push({ type: 'notify', id: target.getId ? target.getId() : 'thread', reason: context.reason });
  };

  const messageTarget = {
    getId: () => 'm-dry-label',
    getThread: () => ({ getId: () => 't-dry-label' })
  };
  processorLabels._addErrorLabel(messageTarget);
  processorLabels._addValidationErrorLabel(messageTarget, { reason: 'review' });
  processorLabels._addErrorLabel({ getId: () => 't-dry-label' });
  processorLabels._addValidationErrorLabel({ getId: () => 't-dry-label' }, { reason: 'review' });

  assert(calls.length === 0, 'dry-run non deve applicare label errore/verifica né inviare notifiche review');
}

console.log('--- Test _notifyValidationReview_: dry-run non invia email e non aggiorna throttling ---');
{
  const previousMailApp = global.MailApp;
  const previousGmailApp = global.GmailApp;
  let sent = 0;
  let throttled = 0;

  global.MailApp = {
    sendEmail: () => { sent++; }
  };
  global.GmailApp = {
    getAliases: () => [],
    sendEmail: () => { sent++; }
  };

  try {
    const processorNotify = new EmailProcessor();
    processorNotify.config.dryRun = true;
    processorNotify.config.validationReviewAlerts = {
      enabled: true,
      email: 'admin@example.org'
    };
    processorNotify._isValidationReviewAlertThrottled_ = () => {
      throttled++;
      return false;
    };

    processorNotify._notifyValidationReview_({
      getId: () => 'm-dry-review',
      getSubject: () => 'Oggetto',
      getThread: () => ({ getId: () => 't-dry-review' })
    }, { reason: 'dry_run_review' });

    assert(sent === 0, 'dry-run non deve inviare email di revisione tramite MailApp/GmailApp');
    assert(throttled === 0, 'dry-run non deve aggiornare stato di throttling notifica review');
  } finally {
    if (typeof previousMailApp === 'undefined') {
      delete global.MailApp;
    } else {
      global.MailApp = previousMailApp;
    }
    global.GmailApp = previousGmailApp;
  }
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
assert(processor._normalizeLanguageCode_('', 'unknown') === 'it', 'fallback testuale generico unknown deve usare fallback sicuro');
assert(processor._normalizeLanguageCode_('unknown', '') === '', 'unknown dal quick-check non deve sovrascrivere la lingua corrente');

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

console.log('--- Test processThread: burst multi-mittente consuma la coda temporale ---');
{
  const originalSession = global.Session;
  const originalGmailApp = global.GmailApp;
  const originalLanguageMode = global.GLOBAL_CACHE.languageMode;
  const labeled = [];
  let capturedBody = '';

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
  assert(!capturedBody.includes('Vorrei informazioni sugli orari.'), 'il burst di risposta non deve aggregare mittenti diversi');
  assert(labeled.includes('m-candidate'), 'deve marcare il candidato filtrato');
  assert(labeled.includes('m-same-sender'), 'deve marcare il messaggio dello stesso mittente incluso nel burst');
  assert(labeled.includes('m-other-sender'), 'deve marcare anche messaggi esterni antecedenti di altri mittenti');

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
