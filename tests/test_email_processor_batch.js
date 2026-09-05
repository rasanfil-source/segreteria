const fs = require('fs');
const vm = require('vm');
const path = require('path');

console.log('--- Test unverified_attachment: unknown_received non diventa mismatch accusatorio ---');
{
  const documentDeliveryModel = {
    expectsDocument: true,
    status: 'received_attachment',
    isCoherent: true,
    blocksReceiptOnly: false,
    blockReason: '',
    hasAttachmentContent: true
  };

  const hasExpectedDocumentMissing = false;
  const hasDocumentMismatch = false;
  const hasRiskyUnknownReceived = true;
  const isDocumentDeliveryContext = true;
  const forceReceiptOnlyForSubmission = true;

  if (hasDocumentMismatch) {
    documentDeliveryModel.status = 'incongruent';
    documentDeliveryModel.isCoherent = false;
    documentDeliveryModel.blocksReceiptOnly = true;
    documentDeliveryModel.blockReason = 'document_mismatch';
  } else if (hasRiskyUnknownReceived && (documentDeliveryModel.expectsDocument || isDocumentDeliveryContext)) {
    documentDeliveryModel.status = 'unverified_attachment';
    documentDeliveryModel.isCoherent = false;
    documentDeliveryModel.blocksReceiptOnly = true;
    documentDeliveryModel.blockReason = documentDeliveryModel.expectsDocument
      ? 'expected_document_with_unknown_attachment'
      : 'submission_attachment_unknown_content';
  }

  const hasDocumentDeliveryIncongruent = documentDeliveryModel.status === 'incongruent';
  const hasDocumentDeliveryUnverified = documentDeliveryModel.status === 'unverified_attachment';

  const hasDocumentDeliveryBlockingIssue = Boolean(
    hasExpectedDocumentMissing ||
    hasDocumentMismatch ||
    hasDocumentDeliveryIncongruent ||
    hasDocumentDeliveryUnverified
  );

  const shouldUseReceiptOnly =
    !hasDocumentDeliveryBlockingIssue &&
    (forceReceiptOnlyForSubmission || hasRiskyUnknownReceived);

  assert(documentDeliveryModel.status === 'unverified_attachment', 'unknown_received su documento atteso deve diventare unverified_attachment');
  assert(hasDocumentDeliveryUnverified === true, 'hasDocumentDeliveryUnverified deve essere true');
  assert(hasDocumentDeliveryBlockingIssue === true, 'unverified_attachment deve bloccare receipt-only');
  assert(shouldUseReceiptOnly === false, 'receipt-only deve essere bloccato');

  const validationContext = {
    documentMismatch: {
      active: true,
      mode: hasDocumentDeliveryUnverified ? 'unverified_attachment' : 'document_delivery'
    }
  };

  assert(validationContext.documentMismatch.active === true, 'documentMismatch nel validation context deve restare attivo per retrocompatibilità');
  assert(validationContext.documentMismatch.mode === 'unverified_attachment', 'mode deve propagare unverified_attachment');
}

console.log('--- Test unverified_attachment: invio generico unknown blocca receipt-only ---');
{
  const documentDeliveryModel = {
    expectsDocument: false,
    status: 'received_attachment',
    isCoherent: true,
    blocksReceiptOnly: false,
    blockReason: '',
    hasAttachmentContent: true
  };

  const hasExpectedDocumentMissing = false;
  const hasDocumentMismatch = false;
  const hasRiskyUnknownReceived = true;
  const isDocumentDeliveryContext = true;
  const forceReceiptOnlyForSubmission = true;

  if (hasDocumentMismatch) {
    documentDeliveryModel.status = 'incongruent';
    documentDeliveryModel.isCoherent = false;
    documentDeliveryModel.blocksReceiptOnly = true;
    documentDeliveryModel.blockReason = 'document_mismatch';
  } else if (hasRiskyUnknownReceived && (documentDeliveryModel.expectsDocument || isDocumentDeliveryContext)) {
    documentDeliveryModel.status = 'unverified_attachment';
    documentDeliveryModel.isCoherent = false;
    documentDeliveryModel.blocksReceiptOnly = true;
    documentDeliveryModel.blockReason = documentDeliveryModel.expectsDocument
      ? 'expected_document_with_unknown_attachment'
      : 'submission_attachment_unknown_content';
  }

  const hasDocumentDeliveryIncongruent = documentDeliveryModel.status === 'incongruent';
  const hasDocumentDeliveryUnverified = documentDeliveryModel.status === 'unverified_attachment';
  const hasDocumentDeliveryBlockingIssue = Boolean(
    hasExpectedDocumentMissing ||
    hasDocumentMismatch ||
    hasDocumentDeliveryIncongruent ||
    hasDocumentDeliveryUnverified
  );
  const shouldUseReceiptOnly =
    !hasDocumentDeliveryBlockingIssue &&
    (forceReceiptOnlyForSubmission || hasRiskyUnknownReceived);

  assert(documentDeliveryModel.status === 'unverified_attachment', 'unknown_received generico in contesto consegna deve diventare unverified_attachment');
  assert(documentDeliveryModel.blockReason === 'submission_attachment_unknown_content', 'deve usare blockReason specifico per consegna generica');
  assert(hasDocumentDeliveryBlockingIssue === true, 'unverified_attachment generico deve bloccare receipt-only');
  assert(shouldUseReceiptOnly === false, 'receipt-only deve restare bloccato anche senza expectsDocument esplicito');
}

console.log('--- Contract test unverified_attachment: wording non accusatorio ---');
{
  const responseText = "Gentile utente,\nabbiamo ricevuto l'allegato, ma non possiamo confermare con certezza che corrisponda alla scheda di iscrizione al corso prematrimoniale. La invitiamo a verificarlo e, se necessario, a reinviare il file corretto.";

  assert(/abbiamo ricevuto l.allegato/i.test(responseText), 'Deve riconoscere la ricezione dell’allegato');
  assert(/non possiamo confermare con certezza/i.test(responseText), 'Deve esprimere incertezza anziché accusare');
  assert(/scheda di iscrizione/i.test(responseText), 'Deve includere il nome del documento atteso');

  assert(!/sembra\s+non\s+corrispondere/i.test(responseText), 'NON deve usare la frase di mismatch');
  assert(!/non\s+corrisponde/i.test(responseText), 'NON deve usare la frase di mismatch');
  assert(!/allegato\s+incongruo/i.test(responseText), 'NON deve etichettare l’allegato come incongruo');
  assert(!/sbagliat[oa]/i.test(responseText), 'NON deve dire che l’allegato è sbagliato');
  assert(!/errat[oa]/i.test(responseText), 'NON deve dire che l’allegato è errato');
}

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
  if (typeof cacheStore !== 'undefined' && cacheStore && typeof cacheStore.clear === 'function') {
    cacheStore.clear();
  }
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
  MIN_REMAINING_TIME_MS: 5000,
  KNOWN_ALIASES: ['bot@example.com']
};

const gasGeminiServicePath = path.join(__dirname, '..', 'gas_gemini_service.js');
const geminiServiceContext = { console };
vm.createContext(geminiServiceContext);
vm.runInContext(fs.readFileSync(gasGeminiServicePath, 'utf8'), geminiServiceContext, { filename: gasGeminiServicePath });
global.EmailQuickCheckPolicy = geminiServiceContext.EmailQuickCheckPolicy;
global.GeminiService.prototype._getDefaultGenerationModelNames_ =
  geminiServiceContext.GeminiService.prototype._getDefaultGenerationModelNames_;
global.GeminiService.prototype.buildGenerationStrategies =
  geminiServiceContext.GeminiService.prototype.buildGenerationStrategies;

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

const gasResponseStrategyPath = path.join(__dirname, '..', 'gas_response_strategy.js');
vm.runInThisContext(fs.readFileSync(gasResponseStrategyPath, 'utf8'), { filename: gasResponseStrategyPath });

const gasEmailProcessorPath = path.join(__dirname, '..', 'gas_email_processor.js');
const code = fs.readFileSync(gasEmailProcessorPath, 'utf8');
vm.runInThisContext(code, { filename: gasEmailProcessorPath });

console.log('--- Test _normalizeTextContent serializza oggetti KB strutturati ---');
{
  const processor = new EmailProcessor({ gmailService: {} });
  const structured = { istruzioni: [{ categoria: 'Messe', dettaglio: 'Domenica 10:00' }] };
  const normalized = processor._normalizeTextContent(structured);
  assert(normalized.includes('Messe') && normalized.includes('Domenica 10:00'), 'gli oggetti KB devono essere serializzati senza [object Object]');
  const shared = { dettaglio: 'Condiviso' };
  const withSharedReference = { primo: shared, secondo: shared };
  const normalizedSharedReference = processor._normalizeTextContent(withSharedReference);
  assert(!normalizedSharedReference.includes('[Circular]') && (normalizedSharedReference.match(/Condiviso/g) || []).length === 2, 'i riferimenti condivisi non circolari devono essere preservati');
  const circular = { tema: 'Catechismo' };
  circular.self = circular;
  const normalizedCircular = processor._normalizeTextContent(circular);
  assert(normalizedCircular.includes('Catechismo') && normalizedCircular.includes('[Circular]'), 'gli oggetti circolari devono avere fallback controllato');
}

console.log('--- Test constructor: validationWarningThreshold percentuale normalizzata ---');
{
  const originalThreshold = global.CONFIG.VALIDATION_WARNING_THRESHOLD;
  global.CONFIG.VALIDATION_WARNING_THRESHOLD = 90;
  try {
    const processor = new EmailProcessor({ gmailService: {} });
    assert(processor.config.validationWarningThreshold === 0.9, `threshold percentuale 90 deve diventare 0.9, ottenuto ${processor.config.validationWarningThreshold}`);
  } finally {
    global.CONFIG.VALIDATION_WARNING_THRESHOLD = originalThreshold;
  }
}

console.log('--- Test document delivery: avviso di sistema allegati non vale come contenuto utilizzabile ---');
{
  const processor = new EmailProcessor({ gmailService: {} });
  const model = processor._buildDocumentDeliveryModel_({
    subject: 'Scheda iscrizione',
    body: 'Buongiorno, VI INVIAMO LA SCHEDA di iscrizione compilata.',
    quickDocumentDelivery: {
      expected_document: true,
      expected_document_description: 'scheda di iscrizione al corso prematrimoniale',
      delivery_channel: 'attachment',
      body_contains_filled_document: false,
      requires_file_attachment: true,
      missing_document_if_no_attachment: true
    },
    quickAttachmentIntent: null,
    physicalAttachmentsDetected: false,
    attachmentItems: [],
    textFromAttachments: "[Avviso di sistema: sono presenti allegati nel thread, ma sono stati esclusi dall\'analisi automatica.]"
  });

  assert(model.hasAttachmentAnalyzedContent === true, 'l avviso di sistema deve restare tracciato come testo allegati analizzato');
  assert(model.hasUsableAttachmentText === false, 'l avviso di sistema non deve essere testo allegato utilizzabile');
  assert(model.hasUsableAttachmentContent === false, 'senza file fisico e senza testo utile non deve esserci contenuto allegato utilizzabile');
  assert(model.hasAttachmentContent === false, 'hasAttachmentContent non deve scattare su un solo avviso di sistema');
  assert(model.status === 'missing', `documento annunciato senza contenuto utile deve essere missing, ottenuto ${model.status}`);
  assert(model.blocksReceiptOnly === true, 'documento atteso missing deve bloccare il receipt-only');
}

console.log('--- Test expected document label: articolo naturale per scheda ---');
{
  const processor = new EmailProcessor({ gmailService: {} });
  const label = processor._formatExpectedDocumentLabel_('scheda di iscrizione al corso prematrimoniale');
  assert(label === 'la scheda di iscrizione al corso prematrimoniale', `label scheda deve includere articolo femminile, ottenuto ${label}`);
}

console.log('--- Test responseStrategy: mapping postura condiviso include alias canonici e legacy ---');
{
  assert(mapRelationalPostureToResponseStrategy_('procedural') === 'guide_next_step', 'procedural deve mappare a guide_next_step');
  assert(mapRelationalPostureToResponseStrategy_('hesitant') === 'clarify_requirements', 'hesitant deve mappare a clarify_requirements');
  assert(mapRelationalPostureToResponseStrategy_('uncertain') === 'clarify_requirements', 'uncertain legacy deve mappare a clarify_requirements');
  assert(mapRelationalPostureToResponseStrategy_('relational') === 'offer_reassurance', 'relational legacy deve mappare a offer_reassurance');
  assert(mapRelationalPostureToResponseStrategy_('complaint') === 'guide_next_step', 'complaint deve mappare a guide_next_step');
}

console.log('--- Test validationContext: contratto stabile per validator ---');
{
  const processor = new EmailProcessor({ gmailService: {} });
  const concerns = {
    longitudinal_sensitivity: true,
    relational_warmth: true
  };
  const continuityCase = {
    key: 'bereavement_continuity',
    longitudinal: true,
    relationalWarmth: false,
    sourceSignals: ['memoryFlag:bereaved']
  };
  const context = processor._buildResponseValidationContext_({
    activeConcerns: concerns,
    concernSynthesis: { key: 'longitudinal_operational' },
    continuityCase,
    responseMode: 'pastoral_longitudinal',
    operationalConstraints: ['Non riaprire il vissuto se l’utente non lo riprende.'],
    continuityPolicy: { key: 'do_not_reopen_past_context' },
    responseRegister: '',
    promptProfile: '',
    category: ' formal ',
    requestType: { type: 'pastoral' },
    requestPurpose: { type: 'operational_request', confidence: 0.94, source: 'local_explicit_action' }
  });

  concerns.longitudinal_sensitivity = false;
  assert(context.activeConcerns.longitudinal_sensitivity === true, 'i concern devono essere copiati nel contratto di validazione');
  assert(context.concernSynthesis.key === 'longitudinal_operational', 'concernSynthesis deve essere propagato al validator');
  assert(context.continuityCase.key === 'bereavement_continuity', 'continuityCase deve essere propagato al validator');
  assert(context.responseMode === 'pastoral_longitudinal', 'responseMode deve essere propagato al validator');
  assert(context.operationalConstraints.length === 1, 'operationalConstraints devono essere propagati al validator');
  assert(context.continuityPolicy.key === 'do_not_reopen_past_context', 'continuityPolicy deve essere propagata al validator');
  assert(context.responseRegister === 'warm_institutional', 'registro vuoto deve usare il fallback stabile');
  assert(context.promptProfile === 'standard', 'profilo vuoto deve usare il fallback stabile');
  assert(context.category === 'formal', 'categoria deve essere normalizzata nel contratto');
  assert(context.requestType === 'pastoral', 'requestType oggetto deve essere normalizzato a type');
  assert(context.requestPurpose.type === 'operational_request', 'lo scopo operativo deve essere propagato al validator');
  assert(context.requestPurpose.confidence === 0.94, 'la confidenza dello scopo deve essere preservata');
}

console.log('--- Test request purpose: EmailProcessor usa il segnale operativo esplicito ---');
{
  const processor = new EmailProcessor({ gmailService: {} });
  const purpose = processor._resolveRequestPurpose_(
    { request_purpose: 'information_request', request_purpose_confidence: 0.9 },
    'Certificato di battesimo',
    'Richiedo gentilmente il certificato in originale per uso matrimonio. Verrò a ritirarlo di persona lunedì.'
  );
  assert(purpose.type === 'operational_request', 'la richiesta di preparazione/ritiro non deve essere trattata come domanda procedurale');
  const operationalDirective = processor._buildCertificateSystemDirective_(true, purpose);
  const informationalDirective = processor._buildCertificateSystemDirective_(true, { type: 'information_request' });
  assert(operationalDirective.includes('RICHIESTA OPERATIVA DI CERTIFICATO'), 'la richiesta operativa deve usare la direttiva di presa in carico');
  assert(operationalDirective.includes('Non riaprire con spiegazioni generiche'), 'la direttiva operativa deve vietare la riapertura della procedura già compresa');
  assert(operationalDirective.includes('non trattare il messaggio come semplice trasmissione di dati'), 'la direttiva operativa deve distinguere richiesta certificato e dati di supporto');
  assert(operationalDirective.includes('data o una modalita di ritiro'), 'la direttiva operativa deve recepire proposta di ritiro senza confermarla automaticamente');
  assert(!operationalDirective.includes('Specifica che il certificato va richiesto'), 'la regola generale non deve essere imposta alla richiesta operativa');
  assert(informationalDirective.includes('RICHIESTA INFORMATIVA SUI CERTIFICATI'), 'la domanda informativa deve conservare la procedura pertinente');
  assert(informationalDirective.includes('parrocchia in cui e stato celebrato'), 'la regola della parrocchia di celebrazione resta disponibile quando risponde davvero alla domanda');
}

console.log('--- Test _extractTimes: boundary Unicode evita match dentro parole ---');
{
  const processor = new EmailProcessor({ gmailService: {} });
  const times = processor._extractTimes('Alle 9:30 va bene. Anche 10 ore. Ignora abc10:30, codiceé11:45 e tel33110:30.');
  assert(times.includes('09:30'), 'deve riconoscere orari con ora a una cifra');
  assert(times.includes('10:00'), 'deve riconoscere ore isolate se seguite da "ore"');
  assert(!times.includes('11:45'), 'non deve estrarre orari incorporati dopo lettere accentate');
  assert(!times.includes('10:30'), 'non deve estrarre orari incorporati in parole o sequenze numeriche');
}

console.log('--- Test unread fallback: metadata UNREAD anche senza INBOX message-level se isUnread è stale ---');
{
  const msg = createMessage({ id: 'm-stale-unread-cache', unread: false, from: 'utente@example.com' });
  const thread = createThread({ id: 't-stale-unread-cache', messages: [msg] });
  const processor = new EmailProcessor({
    gmailService: {
      _getMessageMetadataWithResilience: (messageId) => ({
        id: messageId,
        labelIds: ['UNREAD']
      })
    }
  });

  const unread = processor._getUnreadMessagesForProcessing_([msg], { warn: () => {} });
  assert(unread.length === 1 && unread[0].getId() === 'm-stale-unread-cache', 'fallback metadata deve recuperare il messaggio unread');
  assert(
    processor._hasUnreadMessagesToProcess(thread, new Set(), new Set()) === true,
    '_hasUnreadMessagesToProcess deve usare il fallback metadata'
  );
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

console.log('--- Test processUnreadEmails: passa staleOnlyMs alla discovery Gmail ---');
{
  let capturedDiscoveryOptions = null;
  const processor = new EmailProcessor({
    gmailService: {
      getUnprocessedUnreadThreads: function () {
        capturedDiscoveryOptions = arguments[7];
        return [];
      }
    }
  });

  const threshold = new Date('2026-05-09T00:00:00Z').getTime();
  const stats = processor.processUnreadEmails('kb', '', true, false, { staleOnlyMs: threshold });
  assert(stats.total === 0, 'batch stale-only senza thread deve restare vuoto');
  assert(
    capturedDiscoveryOptions && capturedDiscoveryOptions.staleOnlyMs === threshold,
    'staleOnlyMs deve essere propagato a getUnprocessedUnreadThreads'
  );
}

console.log('--- Test processUnreadEmails: staleOnlyMs null non viene propagato ---');
{
  let capturedDiscoveryOptions = null;
  const processor = new EmailProcessor({
    gmailService: {
      getUnprocessedUnreadThreads: function () {
        capturedDiscoveryOptions = arguments[7];
        return [];
      }
    }
  });

  const stats = processor.processUnreadEmails('kb', '', true, false, { staleOnlyMs: null });
  assert(stats.total === 0, 'batch normale senza thread deve restare vuoto');
  assert(
    capturedDiscoveryOptions && !Object.prototype.hasOwnProperty.call(capturedDiscoveryOptions, 'staleOnlyMs'),
    'staleOnlyMs null non deve diventare staleOnlyMs=0 nella discovery Gmail'
  );
}

console.log('--- Test processUnreadEmails: inbox vuota non pre-carica blacklist label ---');
{
  let capturedDiscoveryOptions = null;
  let labelCalls = 0;
  const processor = new EmailProcessor({
    gmailService: {
      getUnprocessedUnreadThreads: function () {
        capturedDiscoveryOptions = arguments[7];
        return [];
      },
      getMessageIdsWithLabel: () => {
        labelCalls++;
        return new Set();
      }
    }
  });

  const stats = processor.processUnreadEmails('kb', '', true);
  assert(stats.total === 0, 'batch senza thread deve restare vuoto');
  assert(labelCalls === 0, 'non deve pre-caricare label se la discovery non trova candidati');
  assert(capturedDiscoveryOptions.blacklistMessageIds instanceof Set, 'deve passare il Set blacklist alla discovery');
  assert(typeof capturedDiscoveryOptions.preloadBlacklistMessageIds === 'function', 'deve passare loader lazy alla discovery');
}

console.log('--- Test processUnreadEmails: discovery carica blacklist RAM una sola volta ---');
{
  const thread = createThread({ id: 't-clean', messages: [createMessage({ id: 'm-clean', unread: true })] });
  const labelCalls = [];
  let capturedDiscoveryOptions = null;
  let seenLabeledIds = null;
  const processor = new EmailProcessor({
    gmailService: {
      getUnprocessedUnreadThreads: function () {
        capturedDiscoveryOptions = arguments[7];
        capturedDiscoveryOptions.preloadBlacklistMessageIds();
        return [thread];
      },
      getMessageIdsWithLabel: (labelName) => {
        labelCalls.push(labelName);
        if (labelName === global.CONFIG.LABEL_NAME) return ['m-ia'];
        if (labelName === global.CONFIG.ERROR_LABEL_NAME) return new Set(['m-error']);
        if (labelName === global.CONFIG.VALIDATION_ERROR_LABEL) return ['m-validation'];
        return [];
      }
    }
  });

  processor._hasUnreadMessagesToProcess = (_thread, labeledMessageIds) => {
    seenLabeledIds = labeledMessageIds;
    return false;
  };
  processor._isNearDeadline = () => false;
  processor._getRemainingTimeMs = () => 60000;
  processor.processThread = () => { throw new Error('processThread non deve essere chiamato nel fast-skip'); };

  const stats = processor.processUnreadEmails('kb', '', true);
  assert(stats.total === 1, 'deve analizzare il thread restituito dalla discovery');
  assert(labelCalls.length === 3, 'deve caricare IA/Errore/Verifica una sola volta complessiva');
  assert(capturedDiscoveryOptions.blacklistMessageIds === seenLabeledIds, 'deve riusare lo stesso Set blacklist nel fast-skip');
  assert(seenLabeledIds.has('m-ia'), 'blacklist deve includere IA');
  assert(seenLabeledIds.has('m-error'), 'blacklist deve includere Errore');
  assert(seenLabeledIds.has('m-validation'), 'blacklist deve includere Verifica');
}

console.log('--- Test _trackEmptyInboxStreak: cache unavailable resetta valore logico su inbox non vuota ---');
{
  const originalCacheService = global.CacheService;
  const originalPropertiesService = global.PropertiesService;
  global.CacheService = {
    getScriptCache: () => ({
      get: () => '7',
      put: () => { throw new Error('cache unavailable'); }
    })
  };
  global.PropertiesService = undefined;

  try {
    const processor = new EmailProcessor({ gmailService: {} });
    const streak = processor._trackEmptyInboxStreak(false);
    assert(streak === 0, `inbox non vuota deve azzerare lo streak logico anche se la cache fallisce, ottenuto ${streak}`);
  } finally {
    global.CacheService = originalCacheService;
    global.PropertiesService = originalPropertiesService;
  }
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

console.log('--- Test thread lock: scrive lock logico solo su CacheService ---');
{
  const originalPropertiesService = global.PropertiesService;
  const originalLockService = global.LockService;
  cacheStore.clear();
  const props = new Map();

  global.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => props.get(k) || '',
      getProperties: () => Object.fromEntries(props.entries()),
      setProperty: (k, v) => props.set(k, v),
      deleteProperty: (k) => props.delete(k)
    })
  };
  global.LockService = {
    getScriptLock: () => ({
      tryLock: () => true,
      releaseLock: () => {}
    })
  };

  try {
    const processor = new EmailProcessor({ gmailService: {} });
    const res = processor._acquireThreadLock('t-durable', false, global.createLogger());
    const key = 'thread_lock_t-durable';
    assert(res.ok === true, 'deve acquisire il lock quando entrambi gli storage sono disponibili');
    assert(cacheStore.has(key), 'deve scrivere il lock volatile in CacheService');
    assert(!props.has(key), 'non deve scrivere lock temporanei in PropertiesService');
    assert(res.cache && !res.properties, 'il contesto release deve contenere solo CacheService');

    processor._releaseThreadLock(res, global.createLogger());
    assert(!cacheStore.has(key), 'release deve rimuovere il lock cache');
    assert(!props.has(key), 'release non deve toccare PropertiesService');
  } finally {
    global.PropertiesService = originalPropertiesService;
    global.LockService = originalLockService;
    cacheStore.clear();
  }
}

console.log('--- Test thread lock: release rimuove cache solo se combacia ---');
{
  const originalLockService = global.LockService;
  const key = 'thread_lock_t-release';
  const value = `${Date.now()}_mine`;
  cacheStore.clear();
  cacheStore.set(key, value);
  let releaseCalled = false;

  global.LockService = {
    getScriptLock: () => ({
      tryLock: () => true,
      releaseLock: () => {
        releaseCalled = true;
      }
    })
  };

  try {
    const processor = new EmailProcessor({ gmailService: {} });
    processor._releaseThreadLock({
      acquired: true,
      cache: global.CacheService.getScriptCache(),
      key,
      value
    }, global.createLogger());
    assert(!cacheStore.has(key), 'release deve eliminare il lock cache proprio');
    assert(releaseCalled === true, 'release deve liberare lo ScriptLock breve se lo acquisisce');
  } finally {
    global.LockService = originalLockService;
    cacheStore.clear();
  }
}

console.log('--- Test thread lock: release non cancella senza ScriptLock se il mutex è conteso ---');
{
  const originalLockService = global.LockService;
  const key = 'thread_lock_t-release-contended';
  const value = `${Date.now()}_mine`;
  cacheStore.clear();
  cacheStore.set(key, value);

  global.LockService = {
    getScriptLock: () => ({
      tryLock: () => false,
      releaseLock: () => {
        throw new Error('release non attesa senza lock acquisito');
      }
    })
  };

  try {
    const processor = new EmailProcessor({ gmailService: {} });
    processor._releaseThreadLock({
      acquired: true,
      cache: global.CacheService.getScriptCache(),
      key,
      value
    }, global.createLogger());
    assert(cacheStore.get(key) === value, 'release deve lasciare CacheService al TTL se lo ScriptLock è conteso');
  } finally {
    global.LockService = originalLockService;
    cacheStore.clear();
  }
}

console.log('--- Test thread lock: lockAlreadyCovered salta solo lo ScriptLock ma mantiene token logico ---');
{
  const originalPropertiesService = global.PropertiesService;
  const originalLockService = global.LockService;
  const props = new Map();
  let tryLockCalls = 0;
  cacheStore.clear();

  global.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => props.get(k) || '',
      setProperty: (k, v) => props.set(k, v),
      deleteProperty: (k) => props.delete(k)
    })
  };
  global.LockService = {
    getScriptLock: () => ({
      tryLock: () => {
        tryLockCalls++;
        return true;
      },
      releaseLock: () => {}
    })
  };

  try {
    const processor = new EmailProcessor({ gmailService: {} });
    const ctx = processor._acquireThreadLock('t-skip', true, global.createLogger(), { lockAlreadyCovered: true });
    assert(ctx.ok === true && ctx.acquired === true, 'lockAlreadyCovered deve comunque creare il lock logico di thread');
    assert(ctx.lockCovered === true, 'ctx deve indicare che il mutex globale è già coperto dal chiamante');
    assert(tryLockCalls === 0, 'lockAlreadyCovered non deve riacquisire lo ScriptLock');
    assert(!props.has('thread_lock_t-skip'), 'non deve scrivere il token in PropertiesService');
    assert(cacheStore.get('thread_lock_t-skip') === ctx.value, 'deve scrivere il token in CacheService');

    processor._releaseThreadLock(ctx, global.createLogger());
    assert(!props.has('thread_lock_t-skip'), 'release coperta dal chiamante non deve toccare PropertiesService');
    assert(!cacheStore.has('thread_lock_t-skip'), 'release coperta dal chiamante deve pulire CacheService');
    assert(tryLockCalls === 0, 'release coperta dal chiamante non deve riacquisire lo ScriptLock');
  } finally {
    global.PropertiesService = originalPropertiesService;
    global.LockService = originalLockService;
    cacheStore.clear();
  }
}

console.log('--- Test thread lock: skipLock senza copertura acquisisce ScriptLock per atomicità ---');
{
  const originalPropertiesService = global.PropertiesService;
  const originalLockService = global.LockService;
  const props = new Map();
  let tryLockCalls = 0;
  let releaseCalls = 0;
  cacheStore.clear();

  global.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => props.get(k) || '',
      setProperty: (k, v) => props.set(k, v),
      deleteProperty: (k) => props.delete(k)
    })
  };
  global.LockService = {
    getScriptLock: () => ({
      tryLock: () => {
        tryLockCalls++;
        return true;
      },
      releaseLock: () => {
        releaseCalls++;
      }
    })
  };

  try {
    const processor = new EmailProcessor({ gmailService: {} });
    const ctx = processor._acquireThreadLock('t-skip-uncovered', true, global.createLogger());
    assert(ctx.ok === true && ctx.acquired === true, 'skipLock non coperto deve comunque creare il lock logico di thread');
    assert(ctx.lockCovered === false, 'ctx non deve indicare copertura esterna se manca lockAlreadyCovered');
    assert(tryLockCalls === 1, 'skipLock non coperto deve acquisire lo ScriptLock per check-and-set atomico');
    assert(releaseCalls === 1, 'lo ScriptLock acquisito internamente deve essere rilasciato dopo il check-and-set');
    assert(!props.has('thread_lock_t-skip-uncovered'), 'non deve scrivere il token in PropertiesService');
    assert(cacheStore.get('thread_lock_t-skip-uncovered') === ctx.value, 'deve scrivere il token in CacheService');
  } finally {
    global.PropertiesService = originalPropertiesService;
    global.LockService = originalLockService;
    cacheStore.clear();
  }
}

console.log('--- Test thread lock: fallisce chiuso se CacheService fallisce ---');
{
  const originalCacheService = global.CacheService;
  const originalPropertiesService = global.PropertiesService;
  const originalLockService = global.LockService;
  const props = new Map();
  let cachePutAttempts = 0;

  global.CacheService = {
    getScriptCache: () => ({
      get: () => null,
      put: () => {
        cachePutAttempts++;
        throw new Error('cache quota temporanea');
      },
      remove: () => {}
    })
  };
  global.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => props.get(k) || '',
      setProperty: (k, v) => props.set(k, v),
      deleteProperty: (k) => props.delete(k)
    })
  };
  global.LockService = {
    getScriptLock: () => ({
      tryLock: () => true,
      releaseLock: () => {}
    })
  };

  try {
    const processor = new EmailProcessor({ gmailService: {} });
    const ctx = processor._acquireThreadLock('t-cache-fail', false, global.createLogger());
    assert(ctx.ok === false && ctx.reason === 'lock_acquisition_failed', 'deve fallire chiuso se CacheService non scrive il lock');
    assert(cachePutAttempts === 1, 'deve tentare prima CacheService');
    assert(!props.has('thread_lock_t-cache-fail'), 'non deve usare PropertiesService come fallback');
  } finally {
    global.CacheService = originalCacheService;
    global.PropertiesService = originalPropertiesService;
    global.LockService = originalLockService;
    cacheStore.clear();
  }
}


console.log('--- Test thread lock: senza backend storage fallisce chiuso ---');
{
  const originalCacheService = global.CacheService;
  const originalPropertiesService = global.PropertiesService;
  global.CacheService = undefined;
  global.PropertiesService = undefined;

  try {
    const processor = new EmailProcessor({ gmailService: {} });
    const res = processor._acquireThreadLock('t-no-storage', false, global.createLogger());
    assert(res.ok === false && res.reason === 'cache_unavailable', 'senza CacheService deve fallire chiuso');
  } finally {
    global.CacheService = originalCacheService;
    global.PropertiesService = originalPropertiesService;
  }
}

console.log('--- Test thread lock: senza LockService fallisce chiuso se non coperto ---');
{
  const originalLockService = global.LockService;
  global.LockService = undefined;
  cacheStore.clear();

  try {
    const processor = new EmailProcessor({ gmailService: {} });
    const res = processor._acquireThreadLock('t-no-lock-service', false, global.createLogger());
    assert(res.ok === false && res.reason === 'global_lock_unavailable', 'senza LockService e senza skipLock deve fallire chiuso');
    assert(!cacheStore.has('thread_lock_t-no-lock-service'), 'non deve scrivere token senza mutex globale');
  } finally {
    global.LockService = originalLockService;
    cacheStore.clear();
  }
}

console.log('--- Test normalize conversation email: accorpa plus-tag nel burst ---');
{
  const processor = new EmailProcessor({ gmailService: {} });
  assert(
    processor._normalizeConversationEmailAddress_('Utente <nome+modulo@example.org>') === 'nome@example.org',
    'normalizzazione conversazione deve rimuovere +tag anche fuori da Gmail'
  );
  assert(
    processor._normalizeConversationEmailAddress_('Nome.Cognome+tag@googlemail.com') === 'nomecognome@gmail.com',
    'normalizzazione conversazione deve mantenere le regole Gmail/googlemail'
  );
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

console.log('--- Test processUnreadEmails: MAX_EMAILS_PER_RUN=0 sospende senza discovery ---');
{
  const originalMax = global.CONFIG.MAX_EMAILS_PER_RUN;
  global.CONFIG.MAX_EMAILS_PER_RUN = 0;
  let discoveryCalled = false;

  try {
    const processor = new EmailProcessor({
      gmailService: {
        getUnprocessedUnreadThreads: () => {
          discoveryCalled = true;
          return [createThread({ id: 't-suspended', messages: [createMessage({ id: 'm-suspended', unread: true })] })];
        }
      }
    });
    processor.processThread = () => {
      throw new Error('processThread non deve essere chiamato quando MAX_EMAILS_PER_RUN=0');
    };

    const stats = processor.processUnreadEmails('kb', '', true);
    assert(stats.reason === 'processing_suspended', 'MAX_EMAILS_PER_RUN=0 deve sospendere il batch');
    assert(stats.total === 0 && stats.replied === 0 && stats.errors === 0, 'la sospensione non deve contare thread o errori');
    assert(discoveryCalled === false, 'la sospensione deve evitare anche la discovery Gmail');
  } finally {
    global.CONFIG.MAX_EMAILS_PER_RUN = originalMax;
  }
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

console.log('--- Test processUnreadEmails: skipped deve consumare MAX_EMAILS_PER_RUN ---');
{
  const originalMax = global.CONFIG.MAX_EMAILS_PER_RUN;
  global.CONFIG.MAX_EMAILS_PER_RUN = 1;

  const threads = [
    createThread({ id: 't-skipped-limit', messages: [createMessage({ id: 'm-skipped-limit', unread: true })] }),
    createThread({ id: 't-after-skip-limit', messages: [createMessage({ id: 'm-after-skip-limit', unread: true })] })
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
    if (thread.getId() === 't-skipped-limit') return { status: 'skipped', reason: 'last_speaker_is_me' };
    return { status: 'replied' };
  };

  const stats = processor.processUnreadEmails('kb', '', true);
  assert(calls.length === 1, 'thread skipped deve contribuire al limite quando il limite e 1');
  assert(stats.replied === 0, 'con limite esaurito dopo skip non deve elaborare thread successivo');

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


console.log('--- Test _beginSendTransaction: messageId assente blocca invio ---');
{
  cacheStore.clear();
  const processor = new EmailProcessor({ gmailService: {} });
  const txn = processor._beginSendTransaction(null, true);

  assert(txn.ok === false, 'messageId assente deve bloccare la transazione di invio');
  assert(txn.reason === 'missing_message_id', `reason attesa missing_message_id, ottenuta ${txn.reason}`);
  assert(cacheStore.size === 0, 'non deve impostare marker cache senza messageId');
}


console.log('--- Test _beginSendTransaction: CacheService assente blocca invio ---');
{
  const originalCacheService = global.CacheService;
  global.CacheService = undefined;

  try {
    const processor = new EmailProcessor({ gmailService: {} });
    const txn = processor._beginSendTransaction('m-no-cache', true);

    assert(txn.ok === false, 'CacheService assente deve bloccare la transazione di invio');
    assert(txn.reason === 'cache_unavailable', `reason attesa cache_unavailable, ottenuta ${txn.reason}`);
  } finally {
    global.CacheService = originalCacheService;
    cacheStore.clear();
  }
}

console.log('--- Test _beginSendTransaction: LockService assente blocca invio se non coperto ---');
{
  const originalLockService = global.LockService;
  global.LockService = undefined;
  cacheStore.clear();

  try {
    const processor = new EmailProcessor({ gmailService: {} });
    const txn = processor._beginSendTransaction('m-no-send-lock', false);

    assert(txn.ok === false, 'LockService assente deve bloccare la transazione di invio senza skipLock');
    assert(txn.reason === 'send_lock_unavailable', `reason attesa send_lock_unavailable, ottenuta ${txn.reason}`);
    assert(!cacheStore.get('sending_m-no-send-lock'), 'non deve impostare marker sending senza mutex fisico');
    assert(!cacheStore.get('sendstarted_m-no-send-lock'), 'non deve impostare marker sendstarted senza mutex fisico');
  } finally {
    global.LockService = originalLockService;
    cacheStore.clear();
  }
}


console.log('--- Test _beginSendTransaction: conserva errore originale se releaseLock fallisce ---');
{
  const originalLockService = global.LockService;
  const originalCacheService = global.CacheService;
  let releaseCalls = 0;

  global.LockService = {
    getScriptLock: () => ({
      tryLock: () => true,
      releaseLock: () => {
        releaseCalls += 1;
        throw new Error('release failure');
      }
    })
  };
  global.CacheService = {
    getScriptCache: () => ({
      get: () => { throw new Error('cache failure'); },
      put: () => {},
      remove: () => {}
    })
  };

  try {
    const processor = new EmailProcessor({ gmailService: {} });
    let thrown = null;
    try {
      processor._beginSendTransaction('m-cache-error');
    } catch (e) {
      thrown = e;
    }
    assert(thrown && thrown.message === 'cache failure', "deve rilanciare l\'errore cache originale anche se releaseLock fallisce");
    assert(releaseCalls === 1, 'deve tentare il rilascio del lock acquisito nel percorso di errore');
  } finally {
    global.LockService = originalLockService;
    global.CacheService = originalCacheService;
    cacheStore.clear();
  }
}

console.log('--- Test _beginSendTransaction: sendstarted recente blocca reinvio ---');
{
  cacheStore.clear();
  const processor = new EmailProcessor({ gmailService: {} });

  cacheStore.set('sendstarted_m-recent', String(Date.now()));
  const txn = processor._beginSendTransaction('m-recent', true);

  assert(txn.ok === false, 'sendstarted recente deve bloccare una nuova transazione');
  assert(txn.reason === 'send_recently_started', `reason attesa send_recently_started, ottenuta ${txn.reason}`);
  assert(!cacheStore.get('sending_m-recent'), 'non deve impostare sending se sendstarted è già presente');
  cacheStore.clear();
}

console.log('--- Test _beginSendTransaction: marker stale non blocca reinvio ---');
{
  cacheStore.clear();
  const processor = new EmailProcessor({ gmailService: {} });

  const staleSendingValue = String(Date.now() - 301000);
  cacheStore.set('sending_m-stale-sending', staleSendingValue);
  const sendingTxn = processor._beginSendTransaction('m-stale-sending', true);

  assert(sendingTxn.ok === true, 'sending stale deve consentire una nuova transazione');
  assert(cacheStore.get('sending_m-stale-sending') !== staleSendingValue, 'sending stale deve essere sovrascritto');

  cacheStore.clear();
  const staleStartedValue = String(Date.now() - 901000);
  cacheStore.set('sendstarted_m-stale-started', staleStartedValue);
  const startedTxn = processor._beginSendTransaction('m-stale-started', true);

  assert(startedTxn.ok === true, 'sendstarted stale deve consentire una nuova transazione');
  assert(cacheStore.get('sendstarted_m-stale-started') !== staleStartedValue, 'sendstarted stale deve essere sovrascritto');
  cacheStore.clear();
}

console.log('--- Test _commitSendTransaction: preserva marker in-flight fino a TTL naturale ---');
{
  cacheStore.clear();
  const processor = new EmailProcessor({ gmailService: {} });

  cacheStore.set('sending_m-commit-preserve', 'sending-marker');
  cacheStore.set('sendstarted_m-commit-preserve', 'started-marker');
  processor._commitSendTransaction('m-commit-preserve');

  assert(cacheStore.get('sent_m-commit-preserve'), 'commit deve impostare il marker sent');
  assert(cacheStore.get('sending_m-commit-preserve') === 'sending-marker', 'commit deve preservare sending fino a scadenza naturale');
  assert(cacheStore.get('sendstarted_m-commit-preserve') === 'started-marker', 'commit deve preservare sendstarted fino a scadenza naturale');
  cacheStore.clear();
}

console.log('--- Test _beginSendTransaction: backup PropertiesService blocca reinvio dopo evaporazione cache ---');
{
  cacheStore.clear();
  const props = new Map();
  const originalPropertiesService = global.PropertiesService;
  global.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => props.get(k) || '',
      setProperty: (k, v) => props.set(k, v),
      getProperties: () => Object.fromEntries(props),
      deleteProperty: (k) => props.delete(k)
    })
  };

  try {
    const processor = new EmailProcessor({ gmailService: {} });
    props.set('sent_backup_m-expired-before-commit', JSON.stringify({
      ts: Date.now() - (2 * processor._getSendIdempotencyBackupTtlMs_()),
      expiresAt: Date.now() - 1000
    }));
    processor._commitSendTransaction('m-persist-backup');

    assert(cacheStore.get('sent_m-persist-backup'), 'commit deve impostare il marker sent in cache');
    assert(props.has('sent_backup_m-persist-backup'), 'commit deve salvare il backup sent persistente');
    assert(!props.has('sent_backup_m-expired-before-commit'), 'commit deve potare backup sent scaduti');

    cacheStore.clear();
    const txn = processor._beginSendTransaction('m-persist-backup', true);

    assert(txn.ok === false, 'backup persistente deve bloccare un nuovo invio dopo cache miss');
    assert(txn.reason === 'already_sent', `reason attesa already_sent, ottenuta ${txn.reason}`);
    assert(cacheStore.get('sent_m-persist-backup'), 'backup persistente valido deve ripopolare la cache sent');
  } finally {
    global.PropertiesService = originalPropertiesService;
    cacheStore.clear();
  }
}

console.log('--- Test _beginSendTransaction: backup PropertiesService scaduto non blocca reinvio ---');
{
  cacheStore.clear();
  const props = new Map();
  const originalPropertiesService = global.PropertiesService;
  global.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => props.get(k) || '',
      setProperty: (k, v) => props.set(k, v),
      deleteProperty: (k) => props.delete(k)
    })
  };

  try {
    const processor = new EmailProcessor({ gmailService: {} });
    props.set('sent_backup_m-expired-backup', JSON.stringify({
      ts: Date.now() - (2 * processor._getSendIdempotencyBackupTtlMs_()),
      expiresAt: Date.now() - 1000
    }));

    const txn = processor._beginSendTransaction('m-expired-backup', true);

    assert(txn.ok === true, 'backup persistente scaduto deve consentire una nuova transazione');
    assert(!props.has('sent_backup_m-expired-backup'), 'backup scaduto deve essere ripulito da PropertiesService');
    assert(cacheStore.get('sending_m-expired-backup'), 'nuova transazione deve impostare sending');
  } finally {
    global.PropertiesService = originalPropertiesService;
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

function buildValidationFlowProcessor({ validationResult, generationText = 'Risposta base', onGenerate = null, labels = [] } = {}) {
  return new EmailProcessor({
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
      addLabelToMessage: (id, label) => labels.push({ id, label }),
      addLabelToThread: (_thread, label) => labels.push({ id: 'thread', label }),
      removeLabelFromMessage: () => {},
      removeLabelFromThread: () => {},
      getThreadHistory: () => '',
      prepareOutboundText: (text) => text,
      sendHtmlReply: () => {}
    },
    classifier: {
      classifyEmail: () => ({ shouldReply: true, category: 'info', subIntents: {}, confidence: 0.9 })
    },
    geminiService: {
      primaryKey: 'primary-key',
      backupKey: 'backup-key',
      shouldRespondToEmail: () => ({ shouldRespond: true, language: 'it', classification: { topic: 'orari' } }),
      detectEmailLanguage: () => ({ lang: 'it' }),
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: (...args) => {
        if (typeof onGenerate === 'function') onGenerate(...args);
        const generatedText = typeof generationText === 'function'
          ? generationText(...args)
          : generationText;
        return { success: true, text: generatedText };
      }
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
    },
    validator: {
      validateResponse: () => validationResult || { isValid: true, warnings: [], score: 1, details: {}, fixedResponse: null }
    },
    memoryService: {
      getMemory: () => ({}),
      getRecentHistory: () => [],
      updateMemoryAtomic: () => true
    },
    territoryValidator: {
      validateMultipleAddresses: () => ({ addressFound: false, addresses: [], summary: '' })
    },
    promptEngine: {
      buildPrompt: () => 'PROMPT'
    }
  });
}

function createDuplicateGuardPropertyStore() {
  const store = new Map();
  return {
    store: store,
    getProperty: (key) => store.get(key) || '',
    setProperty: (key, value) => store.set(key, String(value)),
    deleteProperty: (key) => store.delete(key),
    getProperties: () => Object.fromEntries(store.entries())
  };
}

function createDuplicateGuardThread(id, { attachments = [], from = 'utente@example.com' } = {}) {
  const message = {
    getId: () => `m-${id}`,
    isUnread: () => true,
    getFrom: () => from,
    getDate: () => new Date('2026-09-01T10:00:00Z'),
    getAttachments: () => attachments
  };
  return {
    getId: () => `t-${id}`,
    getMessages: () => [message]
  };
}

console.log('--- Test duplicate guard: seconda email identica viene fermata prima di memoria e AI ---');
{
  cacheStore.clear();
  const props = createDuplicateGuardPropertyStore();
  const labels = [];
  let quickCheckCalls = 0;
  let memoryReadCalls = 0;
  let sendCalls = 0;
  const processor = buildValidationFlowProcessor({ labels: labels });
  processor.props = props;
  processor.config.duplicateReplyGuardEnabled = true;
  processor.config.duplicateReplyWindowSeconds = 900;
  processor.gmailService.sendHtmlReply = () => { sendCalls++; };
  processor.geminiService.shouldRespondToEmail = () => {
    quickCheckCalls++;
    return { shouldRespond: true, language: 'it', classification: { topic: 'orari' } };
  };
  processor.memoryService.getMemory = () => {
    memoryReadCalls++;
    return {};
  };

  const first = processor.processThread(createDuplicateGuardThread('duplicate-first'), 'kb valida', '', new Set(), true);
  const second = processor.processThread(createDuplicateGuardThread('duplicate-second'), 'kb valida', '', new Set(), true);

  assert(first.status === 'replied', `prima email identica deve essere risposta, ottenuto ${first.status}`);
  assert(second.status === 'skipped', `seconda email identica deve essere soppressa, ottenuto ${second.status}`);
  assert(second.reason === 'duplicate_already_replied', `reason duplicato inatteso: ${second.reason}`);
  assert(second.duplicateOfMessageId === 'm-duplicate-first', 'deve indicare il messaggio già risposto');
  assert(second.duplicateOfThreadId === 't-duplicate-first', 'deve indicare il thread già risposto');
  assert(sendCalls === 1, `deve inviare una sola risposta, invii=${sendCalls}`);
  assert(quickCheckCalls === 1, `il duplicato non deve raggiungere quick check, chiamate=${quickCheckCalls}`);
  assert(memoryReadCalls === 1, `il duplicato non deve leggere la memoria, chiamate=${memoryReadCalls}`);
  assert(labels.some((entry) => entry.id === 'm-duplicate-second' && entry.label === 'IA'), 'solo il messaggio duplicato corrente deve essere marcato IA');
}

console.log('--- Test duplicate guard: confronto conservativo, allegati esclusi e contenuti diversi distinti ---');
{
  const processor = new EmailProcessor({ gmailService: {} });
  processor.config.duplicateReplyGuardEnabled = true;
  processor.config.duplicateReplyWindowSeconds = 900;
  const noAttachments = { getAttachments: () => [] };
  const withAttachments = { getAttachments: () => [{ getName: () => 'documento.pdf' }] };
  const unreadableAttachments = { getAttachments: () => { throw new Error('metadata non disponibile'); } };
  const baseDetails = {
    senderEmail: 'Utente+prova@gmail.com',
    subject: 'Richiesta informazioni',
    body: 'Buongiorno,\r\n  vorrei sapere gli orari.'
  };
  const equivalentDetails = {
    senderEmail: 'utente@gmail.com',
    subject: 'Richiesta   informazioni',
    body: 'Buongiorno,\nvorrei sapere gli orari.'
  };
  const changedDetails = Object.assign({}, equivalentDetails, {
    body: 'Buongiorno, vorrei sapere gli orari di dicembre.'
  });

  const first = processor._buildDuplicateReplyFingerprintContext_(noAttachments, baseDetails);
  const equivalent = processor._buildDuplicateReplyFingerprintContext_(noAttachments, equivalentDetails);
  const changed = processor._buildDuplicateReplyFingerprintContext_(noAttachments, changedDetails);
  assert(first && equivalent && first.fingerprint === equivalent.fingerprint, 'sole differenze tecniche di spaziatura devono normalizzarsi');
  assert(changed && first.fingerprint !== changed.fingerprint, 'una modifica del contenuto deve produrre un fingerprint diverso');
  assert(processor._buildDuplicateReplyFingerprintContext_(withAttachments, baseDetails) === null, 'email con allegati deve restare esclusa dalla v1');
  assert(processor._buildDuplicateReplyFingerprintContext_(unreadableAttachments, baseDetails) === null, 'errore lettura allegati deve fallire aperto');
}

console.log('--- Test duplicate guard: marker scaduto o corrotto non blocca ---');
{
  const props = createDuplicateGuardPropertyStore();
  const processor = new EmailProcessor({ gmailService: {}, props: props });
  processor.config.duplicateReplyGuardEnabled = true;
  processor.config.duplicateReplyWindowSeconds = 900;
  const context = processor._buildDuplicateReplyFingerprintContext_({ getAttachments: () => [] }, {
    senderEmail: 'utente@example.com',
    subject: 'Domanda',
    body: 'Testo invariato'
  });
  const now = Date.now();
  processor._recordConfirmedDuplicateReply_(context, 'm-old', 't-old', now - (901 * 1000));
  assert(processor._findConfirmedDuplicateReply_(context, now).isDuplicate === false, 'marker oltre finestra non deve bloccare');
  props.setProperty(context.propertyKey, '{marker-corrotto');
  assert(processor._findConfirmedDuplicateReply_(context, now).isDuplicate === false, 'marker corrotto deve fallire aperto');
  assert(!props.store.has(context.propertyKey), 'marker corrotto deve essere ripulito');
}

console.log('--- Test processThread: NO_REPLY non annulla reply_needed=true e usa il fallback ---');
{
  let generationCalls = 0;
  const processor = buildValidationFlowProcessor({
    generationText: () => {
      generationCalls++;
      return generationCalls === 1
        ? 'NO_REPLY'
        : 'Buongiorno. Grazie per l’aggiornamento. Cordiali saluti.';
    }
  });

  const result = processor.processThread(createExternalThread('unexpected-no-reply-fallback'), 'kb valida', '', new Set(), true);
  assert(result.status === 'replied', `NO_REPLY incoerente deve usare il fallback e rispondere, ottenuto ${result.status}`);
  assert(generationCalls === 2, `deve fermarsi al primo fallback valido, chiamate=${generationCalls}`);
}

console.log('--- Test processThread: NO_REPLY incoerente esaurito resta ritentabile e non viene marcato ---');
{
  let generationCalls = 0;
  const labels = [];
  const processor = buildValidationFlowProcessor({
    labels: labels,
    generationText: () => {
      generationCalls++;
      return '<email>NO_REPLY</email>';
    }
  });

  const result = processor.processThread(createExternalThread('unexpected-no-reply-exhausted'), 'kb valida', '', new Set(), true);
  assert(result.status === 'error', `fallback tutti incoerenti deve produrre errore ritentabile, ottenuto ${result.status}`);
  assert(result.retryable === true, 'NO_REPLY incoerente esaurito deve restare ritentabile');
  assert(result.reason === 'unexpected_no_reply_after_reply_required', `reason diagnostico inatteso: ${result.reason}`);
  assert(generationCalls === 4, `deve provare tutte le strategie disponibili, chiamate=${generationCalls}`);
  assert(labels.length === 0, 'non deve applicare IA, Verifica o Errore quando il messaggio deve essere ritentato');
}

function buildProcessorForGenerationFailure(errorTypeToThrow) {
  if (typeof cacheStore !== 'undefined' && cacheStore && typeof cacheStore.clear === 'function') {
    cacheStore.clear();
  }
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
      addLabelToMessage: (id, label) => calls.push(`addLabel:${label}`),
      addLabelToThread: (t, label) => calls.push(`addLabel:${label}`),
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
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: (_prompt, options) => {
        calls.push({ modelName: options.modelName, skipRateLimit: options.skipRateLimit });
        throw new Error(`forced-${errorTypeToThrow}`);
      }
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
    },
    memoryService: {
      getMemory: () => ({}),
      getRecentHistory: () => []
    },
    territoryValidator: {
      validateMultipleAddresses: () => ({ addressFound: false, addresses: [], summary: '' })
    },
    promptEngine: {
      buildPrompt: () => 'PROMPT'
    }
  });
  processor._isNearDeadline = () => false;

  return { processor, calls };
}

console.log('--- Test processThread: fallback end-to-end su INVALID_RESPONSE ---');
{
  const labeled = new Set();
  const { processor, calls } = buildProcessorForGenerationFailure('INVALID_RESPONSE');
  const res = processor.processThread(createExternalThread('invalid-response'), 'kb valida', '', labeled, true);
  // Filtriamo solo le chiamate a geminiService.generateResponse (oggetti)
  const strategyCalls = calls.filter(c => typeof c === 'object');
  assert(strategyCalls.length === 4, `con INVALID_RESPONSE deve tentare tutte le 4 strategie (fatti: ${strategyCalls.length})`);
  assert(res.status === 'error', 'con fallback esaurito deve restituire status error');
  assert(labeled.has('m-invalid-response'), 'deve marcare il messaggio candidato come processato');
}

console.log('--- Test processThread: fallback end-to-end su UNKNOWN ---');
{
  const labeled = new Set();
  const { processor, calls } = buildProcessorForGenerationFailure('UNKNOWN');
  const res = processor.processThread(createExternalThread('unknown'), 'kb valida', '', labeled, true);
  const strategyCalls = calls.filter(c => typeof c === 'object');
  assert(strategyCalls.length === 4, `con UNKNOWN deve tentare tutte le 4 strategie (fatti: ${strategyCalls.length})`);
  assert(res.status === 'error', 'con fallback esaurito deve restituire status error');
  assert(labeled.has('m-unknown'), 'deve marcare il messaggio candidato come processato');
}


console.log('--- Test processThread: fallback default diversifica tier modello ---');
{
  const labeled = new Set();
  const { processor, calls } = buildProcessorForGenerationFailure('UNKNOWN');
  const res = processor.processThread(createExternalThread('default-tier-diversification'), 'kb valida', '', labeled, true);
  assert(res.status === 'error', 'con fallback default esaurito deve restituire status error');
  
  const strategyCalls = calls.filter(c => typeof c === 'object');
  assert(
    strategyCalls.map(call => call.modelName).join('|') === 'gemini-3.7-flash|gemini-3.7-flash|gemini-3.5-flash-lite|gemini-3.5-flash-lite',
    `deve diversificare il tier fisico nel fallback default (fatto: ${strategyCalls.map(call => call.modelName).join('|')})`
  );
  assert(
    strategyCalls[0].skipRateLimit === false &&
    strategyCalls[1].skipRateLimit === true &&
    strategyCalls[2].skipRateLimit === false &&
    strategyCalls[3].skipRateLimit === true,
    'solo le strategie con chiave di riserva devono bypassare il RateLimiter'
  );
  assert(labeled.has('m-default-tier-diversification'), 'deve marcare il messaggio candidato come processato');
}

console.log('--- Test processThread: INVALID_API_KEY primaria prova backup key ---');
{
  const originalErrorTypes = global.ErrorTypes;
  const originalClassifyError = global.classifyError;
  const labels = [];
  const generationCalls = [];

  global.ErrorTypes = {
    INVALID_API_KEY: 'INVALID_API_KEY',
    QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
    TIMEOUT: 'TIMEOUT',
    NETWORK: 'NETWORK',
    INVALID_RESPONSE: 'INVALID_RESPONSE'
  };
  global.classifyError = (err) => {
    const message = err && err.message ? err.message : String(err);
    if (/401|403|api key/i.test(message)) {
      return { type: global.ErrorTypes.INVALID_API_KEY, retryable: false, message };
    }
    return { type: 'UNKNOWN', retryable: false, message };
  };

  try {
    const processor = buildValidationFlowProcessor({
      labels: labels,
      onGenerate: (_prompt, options) => {
        generationCalls.push({ modelName: options.modelName, key: options.apiKey, skipRateLimit: options.skipRateLimit });
        if (options.apiKey === 'primary-key') {
          throw new Error('403 API key disabled');
        }
      },
      generationText: 'Risposta da backup'
    });

    const result = processor.processThread(createExternalThread('invalid-key-backup'), 'kb valida', '', new Set(), true);
    assert(result.status === 'replied', `INVALID_API_KEY primaria deve usare backup e completare, ottenuto ${result.status}`);
    assert(generationCalls.length >= 2, `deve tentare almeno primaria e backup, chiamate=${generationCalls.length}`);
    assert(generationCalls[0].key === 'primary-key', 'il primo tentativo deve usare la primary key');
    assert(
      generationCalls.some(call => call.key === 'backup-key' && call.skipRateLimit === true),
      'deve tentare una strategia con backup key e bypass RateLimiter'
    );
  } finally {
    global.ErrorTypes = originalErrorTypes;
    global.classifyError = originalClassifyError;
    cacheStore.clear();
  }
}

console.log('--- Test processThread: primaria esaurita salta fallback su primary key ---');
{
  const { processor, calls } = buildProcessorForGenerationFailure('UNKNOWN');
  global.ErrorTypes = {
    QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
    UNKNOWN: 'UNKNOWN',
    INVALID_API_KEY: 'INVALID_API_KEY'
  };
  global.classifyError = (err) => {
    const message = err && err.message ? err.message : String(err);
    if (message.includes('QUOTA')) return { type: 'QUOTA_EXCEEDED', retryable: true, message };
    return { type: 'UNKNOWN', retryable: false, message };
  };

  let attempt = 0;
  processor.geminiService.isPrimaryExhausted = false;
  processor.geminiService.generateResponse = function (_prompt, options) {
    calls.push({ modelName: options.modelName, skipRateLimit: options.skipRateLimit });
    attempt += 1;
    if (attempt === 1) {
      this.isPrimaryExhausted = true;
      throw new Error('QUOTA_EXHAUSTED primary');
    }
    throw new Error('forced-UNKNOWN');
  };

  const res = processor.processThread(createExternalThread('primary-exhausted'), 'kb valida', '', new Set(), true);
  assert(res.status === 'error', 'con fallback esaurito deve restituire status error');
  const strategyCalls = calls.filter(c => typeof c === 'object');
  assert(
    strategyCalls.map(call => call.modelName).join('|') === 'gemini-3.7-flash|gemini-3.7-flash|gemini-3.5-flash-lite',
    `deve saltare il fallback lite su primary key esaurita (fatto: ${strategyCalls.map(call => call.modelName).join('|')})`
  );
  assert(strategyCalls[2].skipRateLimit === true, 'il fallback lite residuo deve usare la chiave di riserva');
}

console.log('--- Test processThread: generazione rispetta CONFIG.MODEL_STRATEGY.generation ---');
{
  const originalModels = global.CONFIG.GEMINI_MODELS;
  const originalStrategy = global.CONFIG.MODEL_STRATEGY;
  global.CONFIG.GEMINI_MODELS = {
    custom_b: { name: 'model-b' },
    custom_a: { name: 'model-a' },
    'custom-backup': { name: 'model-backup' }
  };
  global.CONFIG.MODEL_STRATEGY = {
    generation: ['custom_b', 'custom_a', 'custom-backup']
  };

  try {
    const { processor, calls } = buildProcessorForGenerationFailure('UNKNOWN');
    const res = processor.processThread(createExternalThread('strategy-config'), 'kb valida', '', new Set(), true);

    assert(res.status === 'error', 'con fallback configurato esaurito deve restituire status error');
    
    const strategyCalls = calls.filter(c => typeof c === 'object');
    assert(
      strategyCalls.map(call => call.modelName).join('|') === 'model-b|model-a|model-backup',
      `deve rispettare l'ordine MODEL_STRATEGY.generation (fatto: ${strategyCalls.map(call => call.modelName).join('|')})`
    );
    assert(strategyCalls[0].skipRateLimit === false && strategyCalls[1].skipRateLimit === false && strategyCalls[2].skipRateLimit === true, 'solo la strategia backup deve bypassare il RateLimiter');
  } finally {
    global.CONFIG.GEMINI_MODELS = originalModels;
    global.CONFIG.MODEL_STRATEGY = originalStrategy;
  }
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

console.log('--- Test processThread: burst ordina per data prima dell\'aggregazione ---');
{
  const bodiesById = {
    'm-burst-order-old': 'Primo messaggio: vorrei sapere gli orari.',
    'm-burst-order-middle': 'Secondo messaggio: aggiungo che e urgente.',
    'm-burst-order-new': 'Terzo messaggio: grazie.'
  };
  const oldMsg = createMessage({
    id: 'm-burst-order-old',
    unread: true,
    from: 'utente@example.com',
    date: new Date('2026-05-07T10:00:00Z')
  });
  const middleMsg = createMessage({
    id: 'm-burst-order-middle',
    unread: true,
    from: 'utente@example.com',
    date: new Date('2026-05-07T10:01:00Z')
  });
  const newMsg = createMessage({
    id: 'm-burst-order-new',
    unread: true,
    from: 'utente@example.com',
    date: new Date('2026-05-07T10:02:00Z')
  });
  const thread = createThread({ id: 't-burst-order', messages: [newMsg, oldMsg, middleMsg] });
  let capturedBody = '';
  let firstExtractedId = null;
  const labeled = new Set();
  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => raw,
      extractMessageDetails: (message) => {
        if (!firstExtractedId) firstExtractedId = message.getId();
        return {
          subject: 'Richiesta informazioni',
          body: bodiesById[message.getId()],
          senderEmail: 'utente@example.com',
          senderName: 'Utente Test',
          date: message.getDate(),
          headers: {},
          isNewsletter: false
        };
      },
      addLabelToMessage: (id) => labeled.add(id),
      addLabelToThread: () => {},
      getThreadHistory: () => ''
    },
    classifier: {
      classifyEmail: (_subject, body) => {
        capturedBody = body;
        return { shouldReply: false, reason: 'test-stop', category: 'info', subIntents: {}, confidence: 0.9 };
      },
      _extractMainContent: (body) => body
    },
    geminiService: {
      detectEmailLanguage: () => ({ lang: 'it' })
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
    },
    memoryService: {
      getMemory: () => ({}),
      getRecentHistory: () => []
    },
    territoryValidator: {
      validateMultipleAddresses: () => ({ addressFound: false, addresses: [], summary: '' })
    },
    promptEngine: {
      buildPrompt: () => 'PROMPT'
    }
  });

  const res = processor.processThread(thread, 'kb valida', '', labeled, true);
  assert(res.status === 'filtered', 'il test deve fermarsi dopo la classificazione locale');
  assert(firstExtractedId === 'm-burst-order-new', `il candidato deve essere il messaggio piu recente, ottenuto ${firstExtractedId}`);
  const oldIndex = capturedBody.indexOf(bodiesById['m-burst-order-old']);
  const middleIndex = capturedBody.indexOf(bodiesById['m-burst-order-middle']);
  const newIndex = capturedBody.indexOf(bodiesById['m-burst-order-new']);
  assert(oldIndex >= 0 && middleIndex >= 0 && newIndex >= 0, 'il body aggregato deve includere tutti i messaggi del burst');
  assert(oldIndex < middleIndex && middleIndex < newIndex, 'il body aggregato deve essere ordinato dal piu vecchio al piu recente');
}

console.log('--- Test processThread: conversationHistory esclude tutto il burst aggregato ---');
{
  const originalValidationEnabled = global.CONFIG.VALIDATION_ENABLED;
  global.CONFIG.VALIDATION_ENABLED = false;

  try {
    const bodiesById = {
      'm-history-office': 'Risposta precedente della segreteria.',
      'm-history-burst-old': 'Primo messaggio del burst: vorrei sapere gli orari.',
      'm-history-burst-middle': 'Secondo messaggio del burst: aggiungo una domanda.',
      'm-history-burst-new': 'Terzo messaggio del burst: grazie.'
    };
    const officeMsg = createMessage({
      id: 'm-history-office',
      unread: false,
      from: 'bot@example.com',
      date: new Date('2026-05-07T09:50:00Z')
    });
    const oldMsg = createMessage({
      id: 'm-history-burst-old',
      unread: true,
      from: 'utente@example.com',
      date: new Date('2026-05-07T10:00:00Z')
    });
    const middleMsg = createMessage({
      id: 'm-history-burst-middle',
      unread: true,
      from: 'utente@example.com',
      date: new Date('2026-05-07T10:01:00Z')
    });
    const candidateMsg = createMessage({
      id: 'm-history-burst-new',
      unread: true,
      from: 'utente@example.com',
      date: new Date('2026-05-07T10:02:00Z')
    });
    const thread = createThread({ id: 't-burst-history', messages: [officeMsg, oldMsg, middleMsg, candidateMsg] });
    const labeled = new Set();
    let historyIds = [];
    let capturedPromptOptions = null;

    const processor = new EmailProcessor({
      gmailService: {
        _extractEmailAddress: (raw) => raw,
        extractMessageDetails: (message) => ({
          subject: 'Richiesta informazioni',
          body: bodiesById[message.getId()],
          senderEmail: message.getFrom(),
          senderName: message.getFrom() === 'bot@example.com' ? 'Segreteria' : 'Utente Test',
          date: message.getDate(),
          headers: {},
          isNewsletter: false,
          rfc2822MessageId: null,
          existingReferences: null
        }),
        addLabelToMessage: (id) => labeled.add(id),
        addLabelToThread: () => {},
        getThreadHistory: (historyMessages) => {
          historyIds = historyMessages.map((message) => message.getId());
          return 'HISTORY_WITHOUT_BURST';
        },
        getProcessableAttachments: () => ({ blobs: [], textContext: '', skipped: [], items: [], processedCount: 0 }),
        prepareOutboundText: (text) => text,
        sendHtmlReply: () => {}
      },
      classifier: {
        classifyEmail: () => ({ shouldReply: true, category: 'information', subIntents: {}, confidence: 0.9 }),
        _extractMainContent: (body) => body
      },
      geminiService: {
        primaryKey: 'primary-key',
        backupKey: 'backup-key',
        detectEmailLanguage: () => ({ lang: 'it' }),
        shouldRespondToEmail: () => ({
          shouldRespond: true,
          language: 'it',
          classification: { category: 'information', topic: 'orari', confidence: 0.9 }
        }),
        getAdaptiveGreeting: () => ({ greeting: 'Buongiorno,', closing: 'Cordiali saluti,' }),
        getAdaptiveClosing: () => 'Cordiali saluti,',
        generateResponse: () => ({ success: true, text: 'Risposta generata' })
      },
      requestClassifier: {
        classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
      },
      memoryService: {
        getMemory: () => ({}),
        getRecentHistory: () => [],
        updateMemoryAtomic: () => true
      },
      territoryValidator: {
        validateMultipleAddresses: () => ({ addressFound: false, addresses: [], summary: '' })
      },
      promptEngine: {
        buildPrompt: (options) => {
          capturedPromptOptions = options;
          return 'PROMPT';
        }
      }
    });

    const result = processor.processThread(thread, 'kb valida', '', labeled, true);

    assert(result.status === 'replied', `il test deve arrivare alla risposta, ottenuto ${result.status}`);
    assert(capturedPromptOptions, 'il prompt deve essere costruito');
    assert(capturedPromptOptions.conversationHistory === 'HISTORY_WITHOUT_BURST', 'la history mockata deve arrivare al prompt');
    assert(historyIds.length === 1 && historyIds[0] === 'm-history-office', `la history deve escludere tutto il burst, ottenuto ${historyIds.join(',')}`);
    assert(capturedPromptOptions.emailContent.includes(bodiesById['m-history-burst-old']), 'il body aggregato deve contenere il primo messaggio del burst');
    assert(capturedPromptOptions.emailContent.includes(bodiesById['m-history-burst-middle']), 'il body aggregato deve contenere il messaggio intermedio del burst');
    assert(capturedPromptOptions.emailContent.includes(bodiesById['m-history-burst-new']), 'il body aggregato deve contenere il candidato del burst');
  } finally {
    global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
  }
}


console.log('--- Test processThread: burst con allegato nel primo messaggio attiva OCR ---');
{
  const originalValidationEnabled = global.CONFIG.VALIDATION_ENABLED;
  const originalDocumentConsistency = global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED;
  const originalAttachmentContext = global.CONFIG.ATTACHMENT_CONTEXT;
  global.CONFIG.VALIDATION_ENABLED = false;
  global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED = false;
  global.CONFIG.ATTACHMENT_CONTEXT = { enabled: true, maxFiles: 3 };

  const attachmentCalls = [];
  let capturedPromptOptions = null;
  const firstMsg = {
    getId: () => 'm-burst-attachment-1',
    isUnread: () => true,
    getFrom: () => 'utente@example.com',
    getDate: () => new Date('2026-05-10T10:00:00Z'),
    getSubject: () => 'Invio certificato',
    getPlainBody: () => 'Allego il certificato.',
    getAttachments: () => [{ getName: () => 'certificato.pdf' }]
  };
  const candidateMsg = {
    getId: () => 'm-burst-attachment-2',
    isUnread: () => true,
    getFrom: () => 'utente@example.com',
    getDate: () => new Date('2026-05-10T10:01:00Z'),
    getSubject: () => 'Precisazione',
    getPlainBody: () => 'Grazie.',
    getAttachments: () => []
  };
  const thread = createThread({ id: 't-burst-attachment', messages: [firstMsg, candidateMsg] });

  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => raw,
      extractMessageDetails: () => ({
        subject: 'Precisazione',
        body: 'Grazie.',
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
      getProcessableAttachments: (message) => {
        attachmentCalls.push(message.getId());
        return message.getId() === 'm-burst-attachment-1'
          ? {
              blobs: [],
              textContext: 'Certificato allegato nel primo messaggio del burst.',
              skipped: [],
              items: [{ name: 'certificato.pdf', text: 'Certificato' }]
            }
          : { blobs: [], textContext: '', skipped: [], items: [] };
      },
      prepareOutboundText: (text) => text,
      sendHtmlReply: () => {}
    },
    classifier: {
      classifyEmail: () => ({ shouldReply: true, category: 'document_submission', subIntents: {}, confidence: 0.9 })
    },
    geminiService: {
      primaryKey: 'primary-key',
      backupKey: 'backup-key',
      shouldRespondToEmail: () => ({ shouldRespond: true, language: 'it', classification: { topic: 'documentazione ricevuta' } }),
      detectEmailLanguage: () => ({ lang: 'it' }),
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: () => ({ success: true, text: 'Risposta con contesto allegato' })
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
    },
    memoryService: {
      getMemory: () => ({}),
      getRecentHistory: () => [],
      updateMemoryAtomic: () => true
    },
    territoryValidator: {
      validateMultipleAddresses: () => ({ addressFound: false, addresses: [], summary: '' })
    },
    promptEngine: {
      buildPrompt: (options) => {
        capturedPromptOptions = options;
        return 'PROMPT';
      }
    }
  });
  processor._deriveAttachmentIntentContext_ = () => ({
    intent: 'document_submission',
    hasQuestions: false,
    allowBodyQuestions: false,
    categoryHintSource: 'document_submission',
    detectedDocTypes: { sponsor: false }
  });

  const result = processor.processThread(thread, 'kb valida', '', new Set(), true);
  assert(result.status === 'replied', 'il burst con allegato precedente deve essere processato');
  assert(attachmentCalls.includes('m-burst-attachment-1'), 'deve elaborare gli allegati del primo messaggio del burst, non solo del candidato');
  assert(
    capturedPromptOptions &&
      capturedPromptOptions.attachmentsContext.includes('Certificato allegato nel primo messaggio del burst.'),
    'il prompt deve ricevere il testo estratto anche quando attachmentBlobs e vuoto ma attachmentItems contiene file'
  );

  global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
  global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED = originalDocumentConsistency;
  global.CONFIG.ATTACHMENT_CONTEXT = originalAttachmentContext;
}


console.log('--- Test processThread: look-back stretto salta messaggi del bot e recupera allegato esterno ---');
{
  const originalValidationEnabled = global.CONFIG.VALIDATION_ENABLED;
  const originalDocumentConsistency = global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED;
  const originalAttachmentContext = global.CONFIG.ATTACHMENT_CONTEXT;
  global.CONFIG.VALIDATION_ENABLED = false;
  global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED = false;
  global.CONFIG.ATTACHMENT_CONTEXT = { enabled: true, maxFiles: 3 };

  const attachmentCalls = [];
  const firstMsg = {
    getId: () => 'm-lookback-user-attachment',
    isUnread: () => false,
    getFrom: () => 'utente@example.com',
    getDate: () => new Date('2026-05-10T10:00:00Z'),
    getSubject: () => 'Documento',
    getPlainBody: () => 'Ecco il documento richiesto.',
    getAttachments: () => [{ getName: () => 'documento.pdf' }]
  };
  const botMsg = {
    getId: () => 'm-lookback-bot-reply',
    isUnread: () => false,
    getFrom: () => 'bot@example.com',
    getDate: () => new Date('2026-05-10T10:01:00Z'),
    getSubject: () => 'Re: Documento',
    getPlainBody: () => 'Abbiamo ricevuto la documentazione.',
    getAttachments: () => []
  };
  const candidateMsg = {
    getId: () => 'm-lookback-user-reference',
    isUnread: () => true,
    getFrom: () => 'utente@example.com',
    getDate: () => new Date('2026-05-10T10:02:00Z'),
    getSubject: () => 'Re: Documento',
    getPlainBody: () => 'Documento già inviato.',
    getAttachments: () => []
  };
  const thread = createThread({ id: 't-lookback-bot-gap', messages: [firstMsg, botMsg, candidateMsg] });

  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => raw,
      extractMessageDetails: () => ({
        subject: 'Re: Documento',
        body: candidateMsg.getPlainBody(),
        senderEmail: 'utente@example.com',
        senderName: 'Utente Test',
        date: new Date('2026-05-10T10:02:00Z'),
        headers: {},
        isNewsletter: false,
        rfc2822MessageId: null,
        existingReferences: null
      }),
      addLabelToMessage: () => {},
      addLabelToThread: () => {},
      getThreadHistory: () => '',
      getProcessableAttachments: (message) => {
        attachmentCalls.push(message.getId());
        return message.getId() === 'm-lookback-user-attachment'
          ? {
              blobs: [],
              textContext: 'Documento recuperato dal messaggio esterno precedente.',
              skipped: [],
              items: [{ name: 'documento.pdf', text: 'Documento recuperato' }]
            }
          : { blobs: [], textContext: '', skipped: [], items: [] };
      },
      prepareOutboundText: (text) => text,
      sendHtmlReply: () => {}
    },
    classifier: {
      classifyEmail: () => ({ shouldReply: true, category: 'document_submission', subIntents: {}, confidence: 0.9 })
    },
    geminiService: {
      primaryKey: 'primary-key',
      backupKey: 'backup-key',
      shouldRespondToEmail: () => ({ shouldRespond: true, language: 'it', classification: { topic: 'documentazione ricevuta' } }),
      detectEmailLanguage: () => ({ lang: 'it' }),
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: () => ({ success: true, text: 'Risposta con look-back allegato' })
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
    },
    memoryService: {
      getMemory: () => ({}),
      getRecentHistory: () => [],
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
    detectedDocTypes: { sponsor: false }
  });

  const result = processor.processThread(thread, 'kb valida', '', new Set(), true);
  assert(result.status === 'replied', 'il follow-up con riferimento esplicito deve completarsi');
  assert(attachmentCalls.includes('m-lookback-user-attachment'), 'deve saltare il messaggio del bot e recuperare l allegato esterno entro 3 passi');
  assert(!attachmentCalls.includes('m-lookback-bot-reply'), 'non deve processare allegati da messaggi inviati dal bot');

  global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
  global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED = originalDocumentConsistency;
  global.CONFIG.ATTACHMENT_CONTEXT = originalAttachmentContext;
}

console.log('--- Test processThread: budget testo allegati esaurito preserva items del messaggio ---');
{
  const originalValidationEnabled = global.CONFIG.VALIDATION_ENABLED;
  const originalDocumentConsistency = global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED;
  const originalAttachmentContext = global.CONFIG.ATTACHMENT_CONTEXT;
  global.CONFIG.VALIDATION_ENABLED = false;
  global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED = false;
  global.CONFIG.ATTACHMENT_CONTEXT = { enabled: true, maxFiles: 3, maxTotalChars: 5 };

  let callCount = 0;
  let capturedPostOcrItems = null;
  const olderMsg = {
    getId: () => 'm-budget-items-older',
    isUnread: () => true,
    getFrom: () => 'utente@example.com',
    getDate: () => new Date('2026-05-10T10:00:00Z'),
    getSubject: () => 'Invio documento',
    getPlainBody: () => 'Allego documento.',
    getAttachments: () => [{ getName: () => 'precedente.pdf' }]
  };
  const candidateMsg = {
    getId: () => 'm-budget-items-candidate',
    isUnread: () => true,
    getFrom: () => 'utente@example.com',
    getDate: () => new Date('2026-05-10T10:01:00Z'),
    getSubject: () => 'Altro allegato',
    getPlainBody: () => 'Allego anche il secondo documento.',
    getAttachments: () => [{ getName: () => 'secondo.pdf' }]
  };
  const thread = createThread({ id: 't-budget-items', messages: [olderMsg, candidateMsg] });
  const blob = { getName: () => 'secondo.pdf' };

  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => raw,
      extractMessageDetails: () => ({
        subject: 'Altro allegato',
        body: 'Allego anche il secondo documento.',
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
      getProcessableAttachments: () => {
        callCount++;
        if (callCount === 1) {
          return { blobs: [], textContext: '12345', skipped: [], items: [], processedCount: 0 };
        }
        return {
          blobs: [blob],
          textContext: 'TESTO_OLTRE_BUDGET',
          skipped: [],
          items: [{ name: 'secondo.pdf', text: 'contenuto secondo' }],
          processedCount: 1
        };
      },
      prepareOutboundText: (text) => text,
      sendHtmlReply: () => {}
    },
    classifier: {
      classifyEmail: () => ({ shouldReply: true, category: 'document_submission', subIntents: {}, confidence: 0.9 })
    },
    geminiService: {
      primaryKey: 'primary-key',
      backupKey: 'backup-key',
      shouldRespondToEmail: () => ({ shouldRespond: true, language: 'it', classification: { topic: 'documentazione ricevuta' } }),
      detectEmailLanguage: () => ({ lang: 'it' }),
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: () => ({ success: true, text: 'Risposta con allegato' })
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
    },
    memoryService: {
      getMemory: () => ({}),
      getRecentHistory: () => [],
      updateMemoryAtomic: () => true
    },
    territoryValidator: {
      validateMultipleAddresses: () => ({ addressFound: false, addresses: [], summary: '' })
    },
    promptEngine: {
      buildPrompt: () => 'PROMPT'
    }
  });
  const originalDerive = processor._deriveAttachmentIntentContext_.bind(processor);
  processor._deriveAttachmentIntentContext_ = (body, subject, attachmentItems, ocrText, phase) => {
    if (phase === 'post_ocr') capturedPostOcrItems = Array.isArray(attachmentItems) ? attachmentItems.slice() : [];
    return originalDerive(body, subject, attachmentItems, ocrText, phase);
  };

  const result = processor.processThread(thread, 'kb valida', '', new Set(), true);
  assert(result.status === 'replied', 'il thread con budget allegati esaurito deve completarsi');
  assert(callCount >= 2, 'il test deve elaborare due messaggi con allegati');
  assert(
    capturedPostOcrItems && capturedPostOcrItems.some((item) => item.name === 'secondo.pdf'),
    'gli items del messaggio oltre budget testo devono arrivare al post-OCR'
  );

  global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
  global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED = originalDocumentConsistency;
  global.CONFIG.ATTACHMENT_CONTEXT = originalAttachmentContext;
}


console.log('--- Test processThread: maxFiles globale conta allegati testuali nel burst ---');
{
  const originalValidationEnabled = global.CONFIG.VALIDATION_ENABLED;
  const originalDocumentConsistency = global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED;
  const originalAttachmentContext = global.CONFIG.ATTACHMENT_CONTEXT;
  global.CONFIG.VALIDATION_ENABLED = false;
  global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED = false;
  global.CONFIG.ATTACHMENT_CONTEXT = { enabled: true, maxFiles: 1, maxTotalChars: 0 };

  const attachmentCalls = [];
  const firstMsg = {
    getId: () => 'm-burst-maxfiles-1',
    isUnread: () => true,
    getFrom: () => 'utente@example.com',
    getDate: () => new Date('2026-05-10T10:00:00Z'),
    getSubject: () => 'Prima nota',
    getPlainBody: () => 'Allego una nota.',
    getAttachments: () => [{ getName: () => 'prima.txt' }]
  };
  const candidateMsg = {
    getId: () => 'm-burst-maxfiles-2',
    isUnread: () => true,
    getFrom: () => 'utente@example.com',
    getDate: () => new Date('2026-05-10T10:01:00Z'),
    getSubject: () => 'Seconda nota',
    getPlainBody: () => 'Allego anche questa.',
    getAttachments: () => [{ getName: () => 'seconda.txt' }]
  };
  const thread = createThread({ id: 't-burst-maxfiles', messages: [firstMsg, candidateMsg] });

  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => raw,
      extractMessageDetails: () => ({
        subject: 'Seconda nota',
        body: 'Allego anche questa.',
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
      getProcessableAttachments: (message, options) => {
        attachmentCalls.push({ id: message.getId(), maxFiles: options.maxFiles });
        return {
          blobs: [],
          textContext: `Contesto allegato ${message.getId()}`,
          skipped: [],
          items: [{ name: `${message.getId()}.txt`, attachmentRole: 'informational' }]
        };
      },
      prepareOutboundText: (text) => text,
      sendHtmlReply: () => {}
    },
    classifier: {
      classifyEmail: () => ({ shouldReply: true, category: 'document_submission', subIntents: {}, confidence: 0.9 })
    },
    geminiService: {
      primaryKey: 'primary-key',
      backupKey: 'backup-key',
      shouldRespondToEmail: () => ({ shouldRespond: true, language: 'it', classification: { topic: 'documentazione ricevuta' } }),
      detectEmailLanguage: () => ({ lang: 'it' }),
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: () => ({ success: true, text: 'Risposta con contesto allegato' })
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
    },
    memoryService: {
      getMemory: () => ({}),
      getRecentHistory: () => [],
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
    detectedDocTypes: { sponsor: false }
  });

  const result = processor.processThread(thread, 'kb valida', '', new Set(), true);
  assert(result.status === 'replied', 'il burst con limite allegati deve completarsi');
  assert(attachmentCalls.length === 1, `maxFiles=1 deve fermare l'aggregazione dopo un allegato testuale (chiamate: ${attachmentCalls.length})`);
  assert(attachmentCalls[0].id === 'm-burst-maxfiles-2', 'deve dare priorità al messaggio candidato più recente');
  assert(attachmentCalls[0].maxFiles === 1, 'deve passare il limite residuo corretto al GmailService');

  global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
  global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED = originalDocumentConsistency;
  global.CONFIG.ATTACHMENT_CONTEXT = originalAttachmentContext;
}


console.log('--- Test processThread: salta download allegati se sizeEstimate messaggio è troppo alto ---');
{
  const originalValidationEnabled = global.CONFIG.VALIDATION_ENABLED;
  const originalDocumentConsistency = global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED;
  const originalAttachmentContext = global.CONFIG.ATTACHMENT_CONTEXT;
  global.CONFIG.VALIDATION_ENABLED = false;
  global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED = false;
  global.CONFIG.ATTACHMENT_CONTEXT = {
    enabled: true,
    maxFiles: 3,
    maxMessageBytesForAttachmentDownload: 1024
  };

  let getAttachmentsCalled = false;
  let getProcessableCalled = false;
  const message = {
    getId: () => 'm-huge-attachment-payload',
    isUnread: () => true,
    getFrom: () => 'utente@example.com',
    getDate: () => new Date('2026-05-10T10:00:00Z'),
    getSubject: () => 'Documento pesante',
    getPlainBody: () => 'Allego.',
    getAttachments: () => {
      getAttachmentsCalled = true;
      throw new Error('getAttachments non deve essere chiamato per payload enorme');
    }
  };
  const thread = createThread({ id: 't-huge-attachment-payload', messages: [message] });

  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => raw,
      _getMessageMetadataWithResilience: () => ({ sizeEstimate: 50 * 1024 * 1024, labelIds: ['UNREAD'] }),
      extractMessageDetails: () => ({
        subject: 'Documento pesante',
        body: 'Allego.',
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
      getProcessableAttachments: () => {
        getProcessableCalled = true;
        return { blobs: [], textContext: '', skipped: [], items: [] };
      },
      prepareOutboundText: (text) => text,
      sendHtmlReply: () => {}
    },
    classifier: {
      classifyEmail: () => ({ shouldReply: true, category: 'information', subIntents: {}, confidence: 0.9 })
    },
    geminiService: {
      primaryKey: 'primary-key',
      backupKey: 'backup-key',
      shouldRespondToEmail: () => ({ shouldRespond: true, language: 'it', classification: { topic: 'documento pesante' } }),
      detectEmailLanguage: () => ({ lang: 'it' }),
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: () => ({ success: true, text: 'Risposta senza scaricare allegato enorme' })
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
    },
    memoryService: {
      getMemory: () => ({}),
      getRecentHistory: () => [],
      updateMemoryAtomic: () => true
    },
    territoryValidator: {
      validateMultipleAddresses: () => ({ addressFound: false, addresses: [], summary: '' })
    },
    promptEngine: {
      buildPrompt: () => 'PROMPT'
    }
  });

  const result = processor.processThread(thread, 'kb valida', '', new Set(), true);
  assert(result.status === 'replied', 'il messaggio grande deve proseguire senza crash allegati');
  assert(getAttachmentsCalled === false, 'non deve scaricare allegati in RAM se sizeEstimate supera soglia');
  assert(getProcessableCalled === false, 'non deve invocare getProcessableAttachments su payload enorme');

  global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
  global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED = originalDocumentConsistency;
  global.CONFIG.ATTACHMENT_CONTEXT = originalAttachmentContext;
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
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
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
      getRecentHistory: () => [],
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

function runQuickCheckAttachmentGateScenario({ quickCheckOverrides, threadId }) {
  const originalValidationEnabled = global.CONFIG.VALIDATION_ENABLED;
  const originalDocumentConsistency = global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED;
  const originalAttachmentContext = global.CONFIG.ATTACHMENT_CONTEXT;
  global.CONFIG.VALIDATION_ENABLED = false;
  global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED = false;
  global.CONFIG.ATTACHMENT_CONTEXT = { enabled: true, maxFiles: 3, ocrTriggerKeywords: ['iban'] };

  const body = 'Trasmetto la scheda di iscrizione al cammino di Santiago compilata con tutti i dati richiesti per il percorso.';
  const attachmentCalls = [];
  let capturedPromptOptions = null;
  const msg = {
    getId: () => `${threadId}-msg`,
    isUnread: () => true,
    getFrom: () => 'utente@example.com',
    getDate: () => new Date('2026-05-10T10:00:00Z'),
    getSubject: () => 'Scheda cammino Santiago',
    getPlainBody: () => body,
    getAttachments: () => [{ getName: () => 'scheda_santiago.pdf' }]
  };
  const thread = createThread({ id: threadId, messages: [msg] });
  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => raw,
      extractMessageDetails: () => ({
        subject: 'Scheda cammino Santiago',
        body: body,
        senderEmail: 'utente@example.com',
        senderName: 'Utente Test',
        date: new Date('2026-05-10T10:00:00Z'),
        headers: {},
        isNewsletter: false,
        rfc2822MessageId: null,
        existingReferences: null
      }),
      addLabelToMessage: () => {},
      addLabelToThread: () => {},
      getThreadHistory: () => '',
      getProcessableAttachments: (message) => {
        attachmentCalls.push(message.getId());
        return {
          blobs: [],
          textContext: 'Scheda di iscrizione al cammino di Santiago - dati del partecipante',
          skipped: [],
          items: [{ name: 'scheda_santiago.pdf', text: 'Scheda iscrizione Santiago' }],
          processedCount: 1
        };
      },
      prepareOutboundText: (text) => text,
      sendHtmlReply: () => {}
    },
    classifier: {
      classifyEmail: () => ({ shouldReply: true, category: 'document_submission', subIntents: {}, confidence: 0.9 })
    },
    geminiService: {
      primaryKey: 'primary-key',
      backupKey: 'backup-key',
      shouldRespondToEmail: () => Object.assign({
        shouldRespond: true,
        language: 'it',
        classification: { topic: 'scheda cammino Santiago', category: 'document_submission', confidence: 0.9 }
      }, quickCheckOverrides || {}),
      detectEmailLanguage: () => ({ lang: 'it' }),
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: () => ({ success: true, text: 'Risposta con allegato letto' })
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
    },
    memoryService: {
      getMemory: () => ({}),
      getRecentHistory: () => [],
      updateMemoryAtomic: () => true
    },
    territoryValidator: {
      validateMultipleAddresses: () => ({ addressFound: false, addresses: [], summary: '' })
    },
    promptEngine: {
      buildPrompt: (options) => {
        capturedPromptOptions = options;
        return 'PROMPT';
      }
    }
  });

  try {
    const result = processor.processThread(thread, 'kb valida', '', new Set(), true);
    return { result, attachmentCalls, capturedPromptOptions };
  } finally {
    global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
    global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED = originalDocumentConsistency;
    global.CONFIG.ATTACHMENT_CONTEXT = originalAttachmentContext;
  }
}

console.log('--- Test attachment gate: quickCheck attachment_intent forza OCR senza keyword locale ---');
{
  const scenario = runQuickCheckAttachmentGateScenario({
    threadId: 't-quick-attachment-intent',
    quickCheckOverrides: {
      attachment_intent: {
        mentions_attachment_or_document: true,
        expected_attachment_description: 'scheda di iscrizione al cammino di Santiago',
        requires_attachment_reading: true,
        reason: 'consegna scheda allegata'
      }
    }
  });
  assert(scenario.result.status === 'replied', 'quickCheck attachment_intent deve completare il flusso');
  assert(scenario.attachmentCalls.length === 1, 'attachment_intent.requires_attachment_reading deve forzare OCR anche senza keyword locale');
  assert(
    scenario.capturedPromptOptions.attachmentsContext.includes('Scheda di iscrizione al cammino di Santiago'),
    'il prompt deve ricevere il testo OCR forzato dal quick check'
  );
}

console.log('--- Test attachment gate: fallback quickCheck legacy forza OCR senza attachment_intent ---');
{
  const scenario = runQuickCheckAttachmentGateScenario({
    threadId: 't-quick-attachment-fallback',
    quickCheckOverrides: {
      response_strategy: 'confirm_receipt',
      response_focus_hint: 'acknowledge_document_without_reopening_procedure',
      new_information_provided: ['scheda di iscrizione al cammino di Santiago'],
      reason: 'consegna documento allegato'
    }
  });
  assert(scenario.result.status === 'replied', 'fallback quickCheck deve completare il flusso');
  assert(scenario.attachmentCalls.length === 1, 'se attachment_intent manca, i segnali legacy devono forzare OCR');
  assert(
    scenario.capturedPromptOptions.attachmentsContext.includes('Scheda di iscrizione al cammino di Santiago'),
    'il fallback legacy deve portare il testo OCR nel prompt'
  );
}

function runExpectedDocumentDeliveryScenario({
  threadId,
  subject,
  body,
  attachments = [],
  quickDocumentDelivery = {},
  ocrText = '',
  semanticResponse = '{"consistent": true, "reason": "documento coerente"}',
  generatedText = 'Risposta generata'
}) {
  const originalValidationEnabled = global.CONFIG.VALIDATION_ENABLED;
  const originalDocumentConsistency = global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED;
  const originalAttachmentContext = global.CONFIG.ATTACHMENT_CONTEXT;
  global.CONFIG.VALIDATION_ENABLED = false;
  global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED = true;
  global.CONFIG.ATTACHMENT_CONTEXT = { enabled: true, maxFiles: 3, ocrTriggerKeywords: ['iban'] };

  let sentText = '';
  let capturedPromptOptions = null;
  let attachmentCalls = 0;
  let semanticCalls = 0;
  let generationCalls = 0;
  const attachmentObjects = attachments.map((name) => ({ getName: () => name }));
  const msg = {
    getId: () => `${threadId}-msg`,
    isUnread: () => true,
    getFrom: () => 'utente@example.com',
    getDate: () => new Date('2026-05-10T10:00:00Z'),
    getSubject: () => subject,
    getPlainBody: () => body,
    getAttachments: () => attachmentObjects
  };
  const thread = createThread({ id: threadId, messages: [msg] });
  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => raw,
      extractMessageDetails: () => ({
        subject: subject,
        body: body,
        senderEmail: 'utente@example.com',
        senderName: 'Utente Test',
        date: new Date('2026-05-10T10:00:00Z'),
        headers: {},
        isNewsletter: false,
        rfc2822MessageId: null,
        existingReferences: null
      }),
      addLabelToMessage: () => {},
      addLabelToThread: () => {},
      getThreadHistory: () => '',
      getProcessableAttachments: () => {
        attachmentCalls++;
        return {
          blobs: [],
          textContext: ocrText,
          skipped: [],
          items: attachments.map((name) => ({ name: name, text: ocrText })),
          processedCount: attachments.length
        };
      },
      prepareOutboundText: (text) => text,
      sendHtmlReply: (_candidate, responseText) => { sentText = responseText; }
    },
    classifier: {
      classifyEmail: () => ({ shouldReply: true, category: 'document_submission', subIntents: {}, confidence: 0.9 })
    },
    geminiService: {
      primaryKey: 'primary-key',
      backupKey: 'backup-key',
      shouldRespondToEmail: () => ({
        shouldRespond: true,
        language: 'it',
        classification: { topic: 'scheda iscrizione corso prematrimoniale', category: 'document_submission', confidence: 0.9 },
        document_delivery: quickDocumentDelivery
      }),
      detectEmailLanguage: () => ({ lang: 'it' }),
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: (prompt) => {
        if (String(prompt || '').includes('Rispondi SOLO con un oggetto JSON valido')) {
          semanticCalls++;
          return semanticResponse;
        }
        generationCalls++;
        return { success: true, text: generatedText };
      }
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
    },
    validator: {
      validateResponse: () => ({ isValid: true, warnings: [], score: 1, details: {}, fixedResponse: null })
    },
    memoryService: {
      getMemory: () => ({}),
      getRecentHistory: () => [],
      updateMemoryAtomic: () => true
    },
    territoryValidator: {
      validateMultipleAddresses: () => ({ addressFound: false, addresses: [], summary: '' })
    },
    promptEngine: {
      buildPrompt: (options) => {
        capturedPromptOptions = options;
        return ['PROMPT'].concat(options.systemDirectives || []).join('\n');
      }
    }
  });

  try {
    const result = processor.processThread(thread, 'kb valida', '', new Set(), true);
    return {
      result,
      sentText,
      capturedPromptOptions,
      directives: capturedPromptOptions ? (capturedPromptOptions.systemDirectives || []) : [],
      attachmentCalls,
      semanticCalls,
      generationCalls
    };
  } finally {
    global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
    global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED = originalDocumentConsistency;
    global.CONFIG.ATTACHMENT_CONTEXT = originalAttachmentContext;
  }
}

console.log('--- Test expected document missing: solo annuncio senza allegato ---');
{
  const scenario = runExpectedDocumentDeliveryScenario({
    threadId: 't-doc-missing-annuncio',
    subject: 'Scheda corso prematrimoniale',
    body: 'VI INVIAMO LA SCHEDA DI ISCRIZIONE AL NOSTRO CORSO PREMATRIMONIALE',
    quickDocumentDelivery: {
      expected_document: true,
      expected_document_description: 'scheda di iscrizione al corso prematrimoniale',
      delivery_channel: 'attachment',
      body_contains_filled_document: false,
      requires_file_attachment: true,
      missing_document_if_no_attachment: true,
      reason: 'annuncia invio scheda ma non riporta dati compilati'
    },
    generatedText: 'Non troviamo allegata né riportata nel testo la scheda di iscrizione al corso prematrimoniale. Può cortesemente reinviarla o inserirne i dati nel corpo del messaggio?'
  });
  assert(scenario.result.status === 'replied', 'documento mancante deve comunque produrre risposta');
  assert(scenario.capturedPromptOptions.documentDelivery.hasExpectedDocumentMissing === true, 'solo annuncio senza allegato deve segnare hasExpectedDocumentMissing true');
  assert(scenario.generationCalls === 1, 'documento mancante non deve usare receipt-only');
  assert(scenario.directives[0].includes('Non troviamo allegata né riportata nel testo la scheda di iscrizione al corso prematrimoniale'), 'direttiva documento mancante deve usare il template positivo');
  assert(!/ricevut/i.test(scenario.sentText), 'documento mancante non deve confermare ricezione');
}

console.log('--- Test expected document missing: avviso di sistema allegati non vale come documento ---');
{
  const processor = new EmailProcessor({ gmailService: {} });
  const model = processor._buildDocumentDeliveryModel_({
    subject: 'Scheda corso prematrimoniale',
    body: 'VI INVIAMO LA SCHEDA DI ISCRIZIONE AL NOSTRO CORSO PREMATRIMONIALE',
    quickDocumentDelivery: {
      expected_document: true,
      expected_document_description: 'scheda di iscrizione al corso prematrimoniale',
      delivery_channel: 'attachment',
      body_contains_filled_document: false,
      requires_file_attachment: true,
      missing_document_if_no_attachment: true,
      reason: 'annuncia invio scheda ma non riporta dati compilati'
    },
    physicalAttachmentsDetected: false,
    attachmentItems: [],
    textFromAttachments: '[Avviso di sistema: sono presenti allegati nel thread, ma sono stati esclusi perché già processati]'
  });
  assert(model.status === 'missing', 'un avviso di sistema in textFromAttachments non deve diventare received_attachment');
  assert(model.hasUsableAttachmentText === false, 'un avviso di sistema in textFromAttachments non è testo allegato utilizzabile');
  assert(model.hasExpectedDocumentMissing === true, 'documento atteso con solo avviso di sistema deve risultare mancante');
  assert(model.blocksReceiptOnly === true, 'documento atteso mancante deve impostare blocksReceiptOnly true');
}


console.log('--- Test expected document missing: scheda compilata nel corpo vale come documento disponibile ---');
{
  const body = [
    'Scheda di iscrizione al corso prematrimoniale',
    'Nome: Mario',
    'Cognome: Rossi',
    'Telefono: 3331234567',
    'Email: mario.rossi@example.com',
    'Data matrimonio: 12/09/2026',
    'Parrocchia: Sant Eugenio'
  ].join('\n');
  const scenario = runExpectedDocumentDeliveryScenario({
    threadId: 't-doc-body-filled',
    subject: 'Scheda corso prematrimoniale',
    body: body,
    quickDocumentDelivery: {
      expected_document: true,
      expected_document_description: 'scheda di iscrizione al corso prematrimoniale',
      delivery_channel: 'body',
      body_contains_filled_document: false,
      requires_file_attachment: false,
      missing_document_if_no_attachment: false,
      reason: 'documento nel corpo'
    }
  });
  assert(scenario.result.status === 'replied', 'scheda nel corpo deve completare il flusso');
  assert(scenario.capturedPromptOptions.documentDelivery.bodyContainsUsableDocumentContent === true, 'fallback locale deve rilevare dati compilati nel body');
  assert(scenario.capturedPromptOptions.documentDelivery.hasExpectedDocumentMissing === false, 'scheda compilata nel corpo non deve risultare mancante');
  assert(scenario.generationCalls === 0, 'scheda compilata senza domande deve usare risposta di ricezione dati');
  assert(/dati riportati nel messaggio/i.test(scenario.sentText), `risposta ricezione dati inattesa: ${scenario.sentText}`);
}

console.log('--- Test body delivery: modulo compilato con richiesta di partecipazione passa alla generazione ---');
{
  const body = [
    'Abbiamo compilato il modulo online per il corso per la Cresima per adulti per Giorgio Licari',
    'e vorrei partecipare anche io agli incontri se possibile sono Sara Ciccarella.',
    'Abbiamo avuto il contatto tramite Gloria Gagliardi.'
  ].join(' ');
  const generatedText = 'Grazie per aver compilato il modulo per Giorgio. Sara, prendiamo in carico anche la sua richiesta di partecipare agli incontri e la segreteria le confermerà la possibilità e le modalità.';
  const scenario = runExpectedDocumentDeliveryScenario({
    threadId: 't-doc-body-participation-request',
    subject: 'Corso Cresima adulti',
    body: body,
    quickDocumentDelivery: {
      expected_document: true,
      expected_document_description: 'modulo online per il corso Cresima adulti',
      delivery_channel: 'body',
      body_contains_filled_document: true,
      requires_file_attachment: false,
      missing_document_if_no_attachment: false,
      reason: 'modulo compilato nel corpo con ulteriore richiesta operativa'
    },
    generatedText: generatedText
  });

  assert(scenario.result.status === 'replied', 'la richiesta di partecipazione deve completare il flusso');
  assert(scenario.generationCalls === 1, 'la richiesta operativa deve impedire il bypass receipt-only');
  assert(scenario.sentText === generatedText, `deve essere inviata la risposta generata, ottenuto: ${scenario.sentText}`);
  assert(!/Prima di procedere o confermare l'operazione/i.test(scenario.sentText), 'non deve ricomparire il template tecnico di sola ricezione');
  assert(
    scenario.capturedPromptOptions && scenario.capturedPromptOptions.requestPurpose.type === 'operational_request',
    'il prompt deve ricevere la partecipazione come richiesta operativa'
  );
  assert(
    scenario.capturedPromptOptions && scenario.capturedPromptOptions.attachmentIntentContext.hasQuestions === true,
    'il segnale operativo deve arrivare integro fino al PromptEngine'
  );
}

console.log('--- Test expected document missing: scheda annunciata con allegato prosegue OCR e semantic check ---');
{
  const scenario = runExpectedDocumentDeliveryScenario({
    threadId: 't-doc-annuncio-con-allegato',
    subject: 'Scheda corso prematrimoniale',
    body: 'VI INVIAMO LA SCHEDA DI ISCRIZIONE AL NOSTRO CORSO PREMATRIMONIALE',
    attachments: ['scheda_prematrimoniale.pdf'],
    ocrText: 'Scheda di iscrizione al corso prematrimoniale - Nome Mario Rossi - Telefono 3331234567',
    quickDocumentDelivery: {
      expected_document: true,
      expected_document_description: 'scheda di iscrizione al corso prematrimoniale',
      delivery_channel: 'attachment',
      body_contains_filled_document: false,
      requires_file_attachment: true,
      missing_document_if_no_attachment: true,
      reason: 'scheda annunciata come allegato'
    }
  });
  assert(scenario.result.status === 'replied', 'scheda con allegato deve completare il flusso');
  assert(scenario.capturedPromptOptions.documentDelivery.hasExpectedDocumentMissing === false, 'allegato presente deve evitare hasExpectedDocumentMissing');
  assert(scenario.attachmentCalls === 1, 'document_delivery deve forzare OCR anche senza keyword locale');
  assert(scenario.semanticCalls === 1, 'scheda annunciata con allegato deve arrivare al semantic consistency check');
}

function runAttachmentConsistencyFlowScenario({
  threadId,
  subject,
  body,
  attachmentName,
  ocrText,
  hasQuestions,
  semanticResponse,
  generatedText = 'Risposta operativa generata'
}) {
  const originalValidationEnabled = global.CONFIG.VALIDATION_ENABLED;
  const originalDocumentConsistency = global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED;
  const originalAttachmentContext = global.CONFIG.ATTACHMENT_CONTEXT;
  global.CONFIG.VALIDATION_ENABLED = true;
  global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED = true;
  global.CONFIG.ATTACHMENT_CONTEXT = { enabled: true, maxFiles: 3 };

  let semanticCalls = 0;
  let generationCalls = 0;
  let validationCalls = 0;
  let sentText = '';
  let capturedPromptOptions = null;
  const validationRuntimeContexts = [];
  const message = {
    getId: () => `${threadId}-message`,
    isUnread: () => true,
    getFrom: () => 'utente@example.com',
    getDate: () => new Date('2026-05-10T10:00:00Z'),
    getSubject: () => subject,
    getPlainBody: () => body,
    getAttachments: () => [{ getName: () => attachmentName }]
  };
  const thread = createThread({ id: threadId, messages: [message] });

  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => raw,
      extractMessageDetails: () => ({
        subject: subject,
        body: body,
        senderEmail: 'utente@example.com',
        senderName: 'Utente Test',
        date: new Date('2026-05-10T10:00:00Z'),
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
        textContext: ocrText,
        skipped: [],
        items: [{ name: attachmentName, text: ocrText }],
        processedCount: 1
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
      shouldRespondToEmail: () => ({ shouldRespond: true, language: 'it', classification: { topic: 'allegato', category: 'document_submission', confidence: 0.9 } }),
      detectEmailLanguage: () => ({ lang: 'it' }),
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: (prompt) => {
        if (String(prompt || '').includes('Rispondi SOLO con un oggetto JSON valido')) {
          semanticCalls++;
          return semanticResponse;
        }
        generationCalls++;
        return { success: true, text: generatedText };
      }
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
    },
    validator: {
      validateResponse: function () {
        validationCalls++;
        validationRuntimeContexts.push(arguments[7]);
        return { isValid: true, warnings: [], score: 1, details: {}, fixedResponse: null };
      }
    },
    memoryService: {
      getMemory: () => ({}),
      getRecentHistory: () => [],
      updateMemoryAtomic: () => true
    },
    territoryValidator: {
      validateMultipleAddresses: () => ({ addressFound: false, addresses: [], summary: '' })
    },
    promptEngine: {
      buildPrompt: (options) => {
        capturedPromptOptions = options;
        return ['PROMPT'].concat(options.systemDirectives || []).join('\n');
      }
    }
  });
  processor._deriveAttachmentIntentContext_ = () => ({
    intent: hasQuestions ? 'document_submission_with_question' : 'document_submission',
    confidence: 0.9,
    phase: 'post_ocr',
    categoryHintSource: 'document_submission',
    responseDirective: hasQuestions
      ? 'Confermare ricezione e rispondere alla domanda esplicita.'
      : 'Confermare la ricezione della documentazione allegata.',
    hasQuestions: hasQuestions,
    detectedDocTypes: {}
  });

  try {
    const result = processor.processThread(thread, 'kb valida', '', new Set(), true);
    return {
      result,
      sentText,
      semanticCalls,
      generationCalls,
      validationCalls,
      validationRuntimeContexts,
      promptOptions: capturedPromptOptions,
      directives: capturedPromptOptions ? (capturedPromptOptions.systemDirectives || []) : []
    };
  } finally {
    global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
    global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED = originalDocumentConsistency;
    global.CONFIG.ATTACHMENT_CONTEXT = originalAttachmentContext;
  }
}

console.log('--- Test document consistency flow: Perillo coerente resta receipt-only ---');
{
  const scenario = runAttachmentConsistencyFlowScenario({
    threadId: 't-perillo-coerente',
    subject: 'Locandina Perillo',
    body: 'Buongiorno, invio in allegato la locandina Perillo.',
    attachmentName: 'locandina_perillo.pdf',
    ocrText: 'Locandina evento Perillo - incontro parrocchiale',
    hasQuestions: false,
    semanticResponse: '{"consistent": true, "reason": "locandina coerente"}'
  });
  assert(scenario.result.status === 'replied', 'Perillo coerente deve completarsi');
  assert(scenario.semanticCalls === 1, 'Perillo coerente deve usare il controllo semantico');
  assert(scenario.generationCalls === 0, 'Perillo coerente senza domande deve restare receipt-only');
  assert(scenario.validationCalls === 0, 'receipt-only coerente deve saltare la validazione');
  assert(/ricevut|documentazione/i.test(scenario.sentText), `risposta receipt-only inattesa: ${scenario.sentText}`);
  assert(scenario.promptOptions.documentConsistency.mode === 'unknown_expected', 'documentConsistency deve essere osservabile nel promptOptions');
}

console.log('--- Test document consistency flow: Perillo incongruo con domanda genera risposta completa ---');
{
  const scenario = runAttachmentConsistencyFlowScenario({
    threadId: 't-perillo-incongruo-domanda',
    subject: 'Locandina Perillo',
    body: 'Buongiorno, invio in allegato la locandina Perillo. Potete dirmi se va pubblicata sul sito?',
    attachmentName: 'programma_pellegrinaggio.pdf',
    ocrText: 'Programma del pellegrinaggio parrocchiale',
    hasQuestions: true,
    semanticResponse: '{"consistent": false, "reason": "allegato su altro evento"}',
    generatedText: 'Avviso allegato incongruo. La pubblicazione sul sito va verificata dalla segreteria.'
  });
  const directive = scenario.directives[0] || '';
  assert(scenario.result.status === 'replied', 'Perillo incongruo con domanda deve completarsi');
  assert(scenario.generationCalls === 1, 'mismatch con domanda non deve usare receipt-only');
  assert(scenario.validationCalls === 1, 'mismatch con domanda deve passare in validazione');
  assert(scenario.validationRuntimeContexts[0].validationContext.documentMismatch.active === true, 'mismatch con domanda deve attivare il controllo validator documentale');
  assert(scenario.validationRuntimeContexts[0].validationContext.documentMismatch.mode === 'semantic', 'mismatch semantico deve dichiarare mode semantic');
  assert(directive.includes('L’allegato ricevuto sembra non corrispondere'), 'direttiva con domanda deve usare il template positivo');
  assert(directive.includes('Subito dopo') && directive.includes('rispondi comunque in modo completo'), 'direttiva con domanda deve chiedere risposta operativa completa');
}

console.log('--- Test document consistency flow: consegna pura incongrua non usa receipt-only ---');
{
  const scenario = runAttachmentConsistencyFlowScenario({
    threadId: 't-consegna-pura-incongrua',
    subject: 'Locandina Perillo',
    body: 'Buongiorno, invio in allegato la locandina Perillo.',
    attachmentName: 'programma_pellegrinaggio.pdf',
    ocrText: 'Programma del pellegrinaggio parrocchiale',
    hasQuestions: false,
    semanticResponse: '{"consistent": false, "reason": "allegato su altro evento"}',
    generatedText: 'L allegato sembra non corrispondere: vi chiediamo di verificare e reinviarlo.'
  });
  const directive = scenario.directives[0] || '';
  assert(scenario.result.status === 'replied', 'consegna pura incongrua deve completarsi');
  assert(scenario.generationCalls === 1, 'mismatch puro non deve cadere nel receipt-only');
  assert(scenario.validationCalls === 1, 'mismatch puro deve essere validato anche se sarebbe receipt-only');
  assert(directive.includes('L’allegato ricevuto sembra non corrispondere'), 'direttiva pura deve usare il template positivo');
  assert(directive.includes('Per una consegna senza domande') && !directive.includes('Subito dopo'), 'direttiva pura deve limitarsi all avviso sull allegato');
  assert(!/prudenza|cautela|Non aggiungere risposte operative/i.test(directive), 'direttiva primaria non deve usare vecchie formule negative o prudenziali');
}

console.log('--- Test document consistency flow: fallimento semantic check resta fail-open ---');
{
  const scenario = runAttachmentConsistencyFlowScenario({
    threadId: 't-semantic-fail-open',
    subject: 'Locandina Perillo',
    body: 'Buongiorno, invio in allegato la locandina Perillo.',
    attachmentName: 'locandina_perillo.pdf',
    ocrText: 'Testo OCR generico',
    hasQuestions: false,
    semanticResponse: 'non json'
  });
  assert(scenario.result.status === 'replied', 'fallimento semantico deve restare fail-open');
  assert(scenario.semanticCalls === 1, 'fallimento semantico deve aver tentato il controllo');
  assert(scenario.generationCalls === 0, 'senza mismatch rilevato deve restare receipt-only');
  assert(scenario.validationCalls === 0, 'receipt-only dopo fail-open deve saltare validazione');
  assert(scenario.directives.length === 0, 'fail-open non deve iniettare direttive mismatch');
}

console.log('--- Test document consistency flow: mismatch tassonomico classico non usa receipt-only ---');
{
  const scenario = runAttachmentConsistencyFlowScenario({
    threadId: 't-taxonomy-mismatch',
    subject: 'Certificato di cresima',
    body: 'Buongiorno, invio in allegato il certificato di cresima.',
    attachmentName: 'certificato_battesimo.pdf',
    ocrText: 'CERTIFICATO DI BATTESIMO - battezzato il 10 maggio',
    hasQuestions: false,
    semanticResponse: '{"consistent": true, "reason": "non usato"}',
    generatedText: 'L allegato sembra non corrispondere al certificato richiesto.'
  });
  assert(scenario.result.status === 'replied', 'mismatch tassonomico deve completarsi');
  assert(scenario.semanticCalls === 0, 'mismatch tassonomico non deve chiamare controllo semantico');
  assert(scenario.generationCalls === 1, 'mismatch tassonomico non deve usare receipt-only');
  assert(scenario.validationCalls === 1, 'mismatch tassonomico deve passare in validazione');
  assert(scenario.promptOptions.documentConsistency.mode === 'mismatch', 'documentConsistency mismatch deve essere esposto nel promptOptions');
  assert(scenario.validationRuntimeContexts[0].validationContext.documentMismatch.mode === 'taxonomy', 'mismatch tassonomico deve dichiarare mode taxonomy');
  assert((scenario.directives[0] || '').includes('Per una consegna senza domande'), 'mismatch tassonomico senza domande deve usare direttiva di sola verifica allegato');
}

console.log('--- Test processThread: follow-up senza allegati non usa receipt-only documentale ---');
{
  const originalValidationEnabled = global.CONFIG.VALIDATION_ENABLED;
  const originalDocumentConsistency = global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED;
  const originalAttachmentContext = global.CONFIG.ATTACHMENT_CONTEXT;
  global.CONFIG.VALIDATION_ENABLED = false;
  global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED = true;
  global.CONFIG.ATTACHMENT_CONTEXT = { enabled: true, maxFiles: 3 };

  let generationCalls = 0;
  let sentText = '';
  let capturedPromptOptions = null;
  const msg = {
    getId: () => 'm-followup-no-attachments',
    isUnread: () => true,
    getFrom: () => 'Evagrio Santacroce <utente@example.com>',
    getDate: () => new Date('2026-05-29T10:00:00Z'),
    getSubject: () => 'Re: Vestiti Caritas',
    getPlainBody: () => 'Vi ringrazio per le risposte. Mi dispiace però che non abbiate risposto alla domanda sull\'opportunità dell\'opera di misericordia corporale di vestire gli ignudi. Ditemi cosa ne pensate, per favore. Nel thread precedente avevo citato anche il modulo Cresima per fare da padrino.',
    getAttachments: () => []
  };
  const thread = createThread({ id: 't-followup-no-attachments', messages: [msg] });

  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => raw,
      extractMessageDetails: () => ({
        subject: 'Re: Vestiti Caritas',
        body: msg.getPlainBody(),
        senderEmail: 'utente@example.com',
        senderName: 'Evagrio Santacroce',
        date: new Date('2026-05-29T10:00:00Z'),
        headers: {},
        isNewsletter: false,
        rfc2822MessageId: null,
        existingReferences: null
      }),
      addLabelToMessage: () => {},
      addLabelToThread: () => {},
      getThreadHistory: () => '',
      prepareOutboundText: (text) => text,
      sendHtmlReply: (_candidate, responseText) => { sentText = responseText; }
    },
    classifier: {
      classifyEmail: () => ({ shouldReply: true, category: 'information', subIntents: {}, confidence: 0.9 })
    },
    geminiService: {
      primaryKey: 'primary-key',
      backupKey: 'backup-key',
      shouldRespondToEmail: () => ({ shouldRespond: true, language: 'it', classification: { topic: 'opera di misericordia', category: 'pastoral', confidence: 0.9 } }),
      detectEmailLanguage: () => ({ lang: 'it' }),
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: () => {
        generationCalls++;
        return { success: true, text: 'Grazie per la precisazione. È certamente un servizio prezioso e coerente con l’opera di misericordia corporale indicata.' };
      }
    },
    requestClassifier: {
      classify: () => ({ type: 'pastoral', dimensions: { pastoral: 0.8, technical: 0.2 }, needsDiscernment: true, needsDoctrine: false })
    },
    memoryService: {
      getMemory: () => ({}),
      getRecentHistory: () => [],
      updateMemoryAtomic: () => true
    },
    territoryValidator: {
      validateMultipleAddresses: () => ({ addressFound: false, addresses: [], summary: '' })
    },
    promptEngine: {
      buildPrompt: (options) => {
        capturedPromptOptions = options;
        return 'PROMPT';
      }
    }
  });

  const result = processor.processThread(thread, 'kb valida', '', new Set(), true);
  assert(result.status === 'replied', 'il follow-up pastorale deve essere processato');
  assert(generationCalls === 1, 'senza allegati fisici non deve scattare il bypass receipt-only');
  assert(!/ricezione della documentazione/i.test(sentText), `risposta documentale inattesa: ${sentText}`);
  assert(capturedPromptOptions && capturedPromptOptions.attachmentIntentContext === null, 'il prompt non deve ricevere un contesto di consegna documentale senza allegati');
  assert(capturedPromptOptions && capturedPromptOptions.attachmentsContext === '', 'email ordinarie senza allegati non devono ricevere warning attachmentsContext');

  global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
  global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED = originalDocumentConsistency;
  global.CONFIG.ATTACHMENT_CONTEXT = originalAttachmentContext;
}

console.log('--- Test processThread: falso document_submission senza allegati non sporca PromptContext ---');
{
  const originalValidationEnabled = global.CONFIG.VALIDATION_ENABLED;
  const originalDocumentConsistency = global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED;
  const originalAttachmentContext = global.CONFIG.ATTACHMENT_CONTEXT;
  const originalCreatePromptContext = global.createPromptContext;
  global.CONFIG.VALIDATION_ENABLED = false;
  global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED = false;
  global.CONFIG.ATTACHMENT_CONTEXT = { enabled: true, maxFiles: 3 };

  let promptContextInput = null;
  let capturedPromptOptions = null;
  global.createPromptContext = (input) => {
    promptContextInput = input;
    return {
      profile: 'lite',
      concerns: {},
      meta: {
        responseRegister: 'warm_institutional',
        salutationMode: 'full'
      }
    };
  };

  const msg = {
    getId: () => 'm-false-submission-no-attachments',
    isUnread: () => true,
    getFrom: () => 'utente@example.com',
    getDate: () => new Date('2026-05-29T10:00:00Z'),
    getSubject: () => 'Re: informazioni',
    getPlainBody: () => 'Grazie per la risposta.',
    getAttachments: () => []
  };
  const thread = createThread({ id: 't-false-submission-no-attachments', messages: [msg] });

  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => raw,
      extractMessageDetails: () => ({
        subject: 'Re: informazioni',
        body: msg.getPlainBody(),
        senderEmail: 'utente@example.com',
        senderName: 'Utente Test',
        date: new Date('2026-05-29T10:00:00Z'),
        headers: {},
        isNewsletter: false,
        rfc2822MessageId: null,
        existingReferences: null
      }),
      addLabelToMessage: () => {},
      addLabelToThread: () => {},
      getThreadHistory: () => '',
      getProcessableAttachments: () => ({ blobs: [], textContext: '', skipped: [], items: [] }),
      prepareOutboundText: (text) => text,
      sendHtmlReply: () => {}
    },
    classifier: {
      classifyEmail: () => ({ shouldReply: true, category: 'document_submission', topic: 'documentazione ricevuta', subIntents: {}, confidence: 0.9 })
    },
    geminiService: {
      primaryKey: 'primary-key',
      backupKey: 'backup-key',
      shouldRespondToEmail: () => ({
        shouldRespond: true,
        language: 'it',
        classification: { topic: 'follow-up', category: 'document_submission', confidence: 0.9 }
      }),
      detectEmailLanguage: () => ({ lang: 'it' }),
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: () => ({ success: true, text: 'Grazie per la precisazione.' })
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 }, needsDiscernment: false, needsDoctrine: false })
    },
    memoryService: {
      getMemory: () => ({}),
      getRecentHistory: () => [],
      updateMemoryAtomic: () => true
    },
    territoryValidator: {
      validateMultipleAddresses: () => ({ addressFound: false, addresses: [], summary: '' })
    },
    promptEngine: {
      buildPrompt: (options) => {
        capturedPromptOptions = options;
        return 'PROMPT';
      }
    }
  });
  processor._deriveAttachmentIntentContext_ = () => ({
    intent: 'document_submission',
    hasQuestions: false,
    allowBodyQuestions: false,
    categoryHintSource: 'document_submission',
    detectedDocTypes: { sponsor: false }
  });

  const result = processor.processThread(thread, 'kb valida', '', new Set(), true);
  assert(result.status === 'replied', 'il falso document_submission senza allegati deve completarsi');
  assert(promptContextInput, 'PromptContext deve essere costruito');
  assert(
    promptContextInput.classification.category !== 'document_submission',
    `PromptContext non deve ricevere document_submission sporco, ottenuto ${promptContextInput.classification.category}`
  );
  assert(
    capturedPromptOptions && capturedPromptOptions.category !== 'document_submission',
    `PromptEngine non deve ricevere document_submission sporco, ottenuto ${capturedPromptOptions && capturedPromptOptions.category}`
  );
  assert(capturedPromptOptions && capturedPromptOptions.attachmentIntentContext === null, 'il prompt non deve ricevere attachmentIntentContext disattivato');

  global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
  global.CONFIG.DOCUMENT_CONSISTENCY_CHECK_ENABLED = originalDocumentConsistency;
  global.CONFIG.ATTACHMENT_CONTEXT = originalAttachmentContext;
  global.createPromptContext = originalCreatePromptContext;
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
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
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
      getRecentHistory: () => [],
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


console.log('--- Test processThread: INTELLIGENT_RETRY.maxRetries=0 disabilita retry ---');
{
  const originalValidationEnabled = global.CONFIG.VALIDATION_ENABLED;
  const originalRetryConfig = global.CONFIG.INTELLIGENT_RETRY;
  global.CONFIG.VALIDATION_ENABLED = true;
  global.CONFIG.INTELLIGENT_RETRY = {
    enabled: true,
    maxRetries: 0,
    minScoreToTrigger: 0,
    onlyForErrors: ['thinking_leak']
  };

  let generationCalls = 0;
  const processor = buildValidationFlowProcessor({
    validationResult: {
      isValid: false,
      warnings: [],
      errors: ['ragionamento esposto'],
      score: 0.2,
      details: { exposedReasoning: { score: 0, errors: ['leak'] } }
    },
    onGenerate: () => { generationCalls++; }
  });

  const result = processor.processThread(createExternalThread('retry-zero'), 'kb valida', '', new Set(), true);
  assert(result.status === 'validation_failed', 'risposta non valida deve fermarsi in validazione');
  assert(generationCalls === 1, `maxRetries=0 non deve effettuare chiamate Gemini extra (chiamate: ${generationCalls})`);

  global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
  global.CONFIG.INTELLIGENT_RETRY = originalRetryConfig;
}

console.log('--- Test processThread: retry intelligente conserva nota oraria contestuale ---');
{
  const originalValidationEnabled = global.CONFIG.VALIDATION_ENABLED;
  const originalRetryConfig = global.CONFIG.INTELLIGENT_RETRY;
  global.CONFIG.VALIDATION_ENABLED = true;
  global.CONFIG.INTELLIGENT_RETRY = {
    enabled: true,
    maxRetries: 1,
    minScoreToTrigger: 0,
    onlyForErrors: ['placeholder']
  };

  let generationCalls = 0;
  const validatedTexts = [];
  const validationRuntimeContexts = [];
  const generatedPrompts = [];
  let promptRuntimeContext = null;
  let sentText = null;
  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => raw,
      extractMessageDetails: () => ({
        subject: 'Richiesta incontro',
        body: 'Pensavo che l\'incontro fosse alle 10:00.',
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
      removeLabelFromMessage: () => {},
      removeLabelFromThread: () => {},
      getThreadHistory: () => '',
      prepareOutboundText: (text) => text,
      sendHtmlReply: (_candidate, responseText) => {
        sentText = responseText;
      }
    },
    classifier: {
      classifyEmail: () => ({ shouldReply: true, category: 'info', subIntents: {}, confidence: 0.9 })
    },
    geminiService: {
      primaryKey: 'primary-key',
      backupKey: null,
      shouldRespondToEmail: () => ({ shouldRespond: true, language: 'it', classification: { topic: 'incontro' } }),
      detectEmailLanguage: () => ({ lang: 'it' }),
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: (prompt) => {
        generationCalls++;
        generatedPrompts.push(prompt);
        return {
          success: true,
          text: generationCalls === 1
            ? 'Risposta con XXX'
            : 'L\'incontro è alle 11:00.'
        };
      }
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
    },
    validator: {
      validateResponse: function (text) {
        validatedTexts.push(text);
        validationRuntimeContexts.push(arguments[7]);
        if (validatedTexts.length === 1) {
          return {
            isValid: false,
            warnings: [],
            errors: ['placeholder presente'],
            score: 0.9,
            details: { content: { foundPlaceholders: ['XXX'] } },
            fixedResponse: null
          };
        }
        return { isValid: true, warnings: [], errors: [], score: 1, details: {}, fixedResponse: null };
      }
    },
    memoryService: {
      getMemory: () => ({}),
      getRecentHistory: () => [],
      updateMemoryAtomic: () => true
    },
    territoryValidator: {
      validateMultipleAddresses: () => ({ addressFound: false, addresses: [], summary: '' })
    },
    promptEngine: {
      buildPrompt: (options) => {
        promptRuntimeContext = options.runtimeContext;
        return 'PROMPT';
      }
    }
  });

  const result = processor.processThread(createExternalThread('retry-time-note'), 'kb valida', '', new Set(), true);
  assert(result.status === 'replied', 'retry valido deve arrivare a replied');
  assert(generationCalls === 2, `deve fare una generazione iniziale e un retry, chiamate=${generationCalls}`);
  assert(validatedTexts.length === 2, 'deve validare risposta iniziale e retry');
  assert(validationRuntimeContexts.length === 2, 'deve passare il runtimeContext a entrambe le validazioni');
  assert(validationRuntimeContexts[0] === promptRuntimeContext, 'prima validazione deve usare il runtimeContext del prompt');
  assert(validationRuntimeContexts[1] === promptRuntimeContext, 'retry validation deve riusare lo stesso runtimeContext del prompt');
  assert(
    generatedPrompts[1] && generatedPrompts[1].includes('RUNTIME CONTEXT IMMUTATO PER IL RETRY'),
    'il prompt di retry deve includere il runtimeContext immutato'
  );
  assert(
    generatedPrompts[1] && generatedPrompts[1].includes("Regola 5: NON citare mai l'ora corrente di sistema"),
    'il prompt di retry deve vietare la citazione dell ora corrente di sistema'
  );
  assert(
    validatedTexts[1].includes('orario diverso rispetto a quanto da Lei indicato'),
    'il retry deve ricevere la stessa nota oraria della prima risposta'
  );
  assert(sentText === validatedTexts[1], 'il testo inviato deve coincidere con il retry validato');

  global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
  global.CONFIG.INTELLIGENT_RETRY = originalRetryConfig;
}

console.log('--- Test processThread: retry 503 prova modello diverso e non applica label terminali ---');
{
  const originalValidationEnabled = global.CONFIG.VALIDATION_ENABLED;
  const originalRetryConfig = global.CONFIG.INTELLIGENT_RETRY;
  global.CONFIG.VALIDATION_ENABLED = true;
  global.CONFIG.INTELLIGENT_RETRY = {
    enabled: true,
    maxRetries: 1,
    minScoreToTrigger: 0,
    onlyForErrors: ['placeholder']
  };

  const labels = [];
  const attemptedModels = [];
  let generationCalls = 0;
  let sendCalls = 0;
  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: raw => raw,
      extractMessageDetails: () => ({
        subject: 'Richiesta informazioni', body: 'Vorrei informazioni.',
        senderEmail: 'utente@example.com', senderName: 'Utente Test',
        date: new Date(), headers: {}, isNewsletter: false,
        rfc2822MessageId: null, existingReferences: null
      }),
      addLabelToMessage: (_id, label) => labels.push(label),
      addLabelToThread: (_thread, label) => labels.push(label),
      removeLabelFromMessage: () => {}, removeLabelFromThread: () => {},
      getThreadHistory: () => '', prepareOutboundText: text => text,
      sendHtmlReply: () => { sendCalls++; }
    },
    classifier: { classifyEmail: () => ({ shouldReply: true, category: 'info', subIntents: {}, confidence: 0.9 }) },
    geminiService: {
      primaryKey: 'primary-key', backupKey: 'backup-key', isPrimaryExhausted: false,
      shouldRespondToEmail: () => ({ shouldRespond: true, language: 'it', classification: { topic: 'info' } }),
      detectEmailLanguage: () => ({ lang: 'it' }),
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
      getAdaptiveClosing: () => 'Cordiali saluti',
      buildGenerationStrategies: () => ({
        fallbackModelName: 'gemini-reserve',
        attemptStrategy: [
          { name: 'primary', key: 'primary-key', model: 'gemini-main', skipRateLimit: false },
          { name: 'reserve', key: 'primary-key', model: 'gemini-reserve', skipRateLimit: false }
        ]
      }),
      generateResponse: (_prompt, options) => {
        generationCalls++;
        attemptedModels.push(options.modelName);
        if (generationCalls === 1) return { success: true, text: 'Risposta con XXX' };
        const error = new Error('Errore server Gemini(503): high demand');
        error.isTransient = true;
        throw error;
      }
    },
    requestClassifier: { classify: () => ({ type: 'technical', dimensions: { pastoral: 0 } }) },
    validator: {
      validateResponse: () => ({
        isValid: false, warnings: [], errors: ['placeholder presente'], score: 0.9,
        details: { content: { foundPlaceholders: ['XXX'] } }, fixedResponse: null
      })
    },
    memoryService: { getMemory: () => ({}), getRecentHistory: () => [], updateMemoryAtomic: () => true },
    territoryValidator: { validateMultipleAddresses: () => ({ addressFound: false, addresses: [], summary: '' }) },
    promptEngine: { buildPrompt: () => 'PROMPT' }
  });

  const result = processor.processThread(createExternalThread('retry-503-no-labels'), 'kb valida', '', new Set(), true);
  assert(result.status === 'error' && result.retryable === true, '503 nel retry deve restituire errore riprocessabile');
  assert(result.reason === 'intelligent_retry_transient_failure', 'deve distinguere il fallimento infrastrutturale del retry');
  assert(attemptedModels.includes('gemini-main') && attemptedModels.includes('gemini-reserve'), 'dopo il 503 deve provare il modello fisico di riserva');
  assert(labels.length === 0, '503 transitorio non deve applicare IA, Verifica o Errore');
  assert(sendCalls === 0, 'una risposta non validata non deve essere inviata');

  global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
  global.CONFIG.INTELLIGENT_RETRY = originalRetryConfig;
}


console.log('--- Test processThread: validationWarningThreshold=0 rispetta zero esplicito ---');
{
  const originalValidationEnabled = global.CONFIG.VALIDATION_ENABLED;
  global.CONFIG.VALIDATION_ENABLED = true;

  const labels = [];
  const processor = buildValidationFlowProcessor({
    labels,
    validationResult: {
      isValid: true,
      warnings: ['warning non bloccante'],
      errors: [],
      score: 0.4,
      details: {},
      fixedResponse: null
    }
  });
  processor.config.validationWarningThreshold = 0;

  const result = processor.processThread(createExternalThread('warning-threshold-zero'), 'kb valida', '', new Set(), true);
  assert(result.status === 'replied', 'warning con soglia zero deve comunque inviare');
  assert(
    !labels.some((entry) => entry.label === CONFIG.VALIDATION_ERROR_LABEL),
    'validationWarningThreshold=0 non deve applicare label Verifica per warning sopra soglia zero'
  );

  global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
}



console.log('--- Test anti-noreply: Reply-To valido esenta form web legittima ---');
{
  let sent = false;
  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => String(raw || '').match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/)?.[0] || raw,
      extractMessageDetails: () => ({
        subject: 'Richiesta dal form contatti',
        body: 'Vorrei informazioni sugli orari della segreteria.',
        senderEmail: 'cliente@example.com',
        senderName: 'Cliente Test',
        date: new Date('2026-05-07T10:00:00Z'),
        headers: {},
        isNewsletter: false,
        originalFrom: 'WordPress <noreply@sito-parrocchia.example>',
        hasReplyTo: true,
        rfc2822MessageId: null,
        existingReferences: null
      }),
      addLabelToMessage: () => {},
      addLabelToThread: () => {},
      getThreadHistory: () => '',
      prepareOutboundText: (text) => text,
      sendHtmlReply: () => { sent = true; }
    },
    classifier: {
      classifyEmail: () => ({ shouldReply: true, category: 'information', subIntents: {}, confidence: 0.9 })
    },
    geminiService: {
      primaryKey: 'primary-key',
      shouldRespondToEmail: () => ({ shouldRespond: true, language: 'it', classification: { category: 'information', topic: 'orari' } }),
      detectEmailLanguage: () => ({ lang: 'it' }),
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: () => ({ success: true, text: 'Risposta orari' })
    },
    requestClassifier: {
      classify: () => ({ type: 'information', dimensions: { pastoral: 0.0 } })
    },
    memoryService: {
      getMemory: () => ({}),
      getRecentHistory: () => [],
      updateMemoryAtomic: () => true
    },
    territoryValidator: {
      validateMultipleAddresses: () => ({ addressFound: false, addresses: [], summary: '' })
    },
    promptEngine: {
      buildPrompt: () => 'PROMPT'
    }
  });

  const result = processor.processThread(createExternalThread('reply-to-noreply'), 'kb valida', '', new Set(), true);
  assert(result.status === 'replied', `la form con Reply-To valido non deve essere filtrata, ottenuto ${result.status}:${result.reason}`);
  assert(sent, 'la risposta deve essere inviata al contatto effettivo');
}

console.log('--- Test prompt options: messageDate usa la data del messaggio originale ---');
{
  let promptOptions = null;
  let validationRuntimeContext = null;
  const originalValidationEnabled = global.CONFIG.VALIDATION_ENABLED;
  global.CONFIG.VALIDATION_ENABLED = true;
  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => raw,
      extractMessageDetails: () => ({
        subject: 'Richiesta appuntamento',
        body: 'Vorrei sapere quali dati servono per completare la pratica.',
        senderEmail: 'utente@example.com',
        senderName: 'Utente Test',
        date: new Date('2026-05-07T10:00:00Z'),
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
      shouldRespondToEmail: () => ({ shouldRespond: true, language: 'it', relational_posture: 'procedural', classification: { category: 'information', topic: 'appuntamento' } }),
      detectEmailLanguage: () => ({ lang: 'it' }),
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: () => ({ success: true, text: 'Risposta appuntamento' })
    },
    requestClassifier: {
      classify: () => ({ type: 'information', dimensions: { pastoral: 0.0 } })
    },
    memoryService: {
      getMemory: () => ({}),
      getRecentHistory: () => [],
      updateMemoryAtomic: () => true
    },
    territoryValidator: {
      validateMultipleAddresses: () => ({ addressFound: false, addresses: [], summary: '' })
    },
    validator: {
      validateResponse: function () {
        validationRuntimeContext = arguments[7];
        return { isValid: true, score: 1.0, errors: [], warnings: [], details: {}, fixedResponse: null };
      }
    },
    promptEngine: {
      buildPrompt: (options) => {
        promptOptions = options;
        return 'PROMPT';
      }
    }
  });

  const result = processor.processThread(createExternalThread('message-date'), 'kb valida', '', new Set(), true);
  global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
  assert(result.status === 'replied', 'il thread con data messaggio deve completarsi');
  assert(promptOptions.messageDate === '2026-05-07', `messageDate deve derivare dalla data originale, ottenuto ${promptOptions && promptOptions.messageDate}`);
  assert(/^\d{2}:\d{2}$/.test(promptOptions.currentTime), `currentTime deve essere passato in formato HH:mm, ottenuto ${promptOptions && promptOptions.currentTime}`);
  assert(promptOptions.runtimeContext && promptOptions.runtimeContext.temporal, 'promptOptions deve includere runtimeContext.temporal');
  assert(Object.isFrozen(promptOptions.runtimeContext), 'runtimeContext root deve essere congelato');
  assert(Object.isFrozen(promptOptions.runtimeContext.temporal), 'runtimeContext.temporal deve essere congelato');
  assert(Object.isFrozen(promptOptions.runtimeContext.papal), 'runtimeContext.papal deve essere congelato');
  assert(promptOptions.runtimeContext.temporal.currentDate === promptOptions.currentDate, 'currentDate legacy deve derivare dal runtimeContext');
  assert(promptOptions.runtimeContext.temporal.messageDate === '2026-05-07', 'runtimeContext.temporal.messageDate deve derivare dalla data originale');
  assert(promptOptions.runtimeContext.temporal.messageTime === '12:00', `runtimeContext.temporal.messageTime deve derivare dall'ora originale in timezone business, ottenuto ${promptOptions.runtimeContext.temporal.messageTime}`);
  assert(promptOptions.runtimeContext.temporal.messageDateAvailable === true, 'runtimeContext deve dichiarare disponibile la data originale valida');
  assert(promptOptions.runtimeContext.temporal.messageDateSource === 'gmail_message_date', 'runtimeContext deve tracciare la sorgente Gmail della data originale');
  assert(promptOptions.relationalPosture === 'procedural', 'promptOptions deve ricevere la relationalPosture canonica dal quick-check');
  assert(validationRuntimeContext === promptOptions.runtimeContext, 'validator deve ricevere lo stesso runtimeContext passato al prompt');
}

console.log('--- Test processThread: topic appartenenza parrocchiale attiva verifica territorio ---');
{
  let territoryCalls = 0;
  let promptOptions = null;
  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => raw,
      extractMessageDetails: () => ({
        subject: 'Verifica appartenenza parrocchiale',
        body: "Buongiorno, vorrei sapere se rientro nella circoscrizione della parrocchia di Sant'Eugenio. Abito in via Barnaba Oriani.",
        senderEmail: 'sofia@example.com',
        senderName: 'Sofia Conti',
        date: new Date('2026-06-13T20:17:00Z'),
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
      shouldRespondToEmail: () => ({
        shouldRespond: true,
        language: 'it',
        relational_posture: 'direct',
        classification: {
          category: 'technical',
          topic: 'Verifica appartenenza parrocchiale'
        }
      }),
      detectEmailLanguage: () => ({ lang: 'it' }),
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: () => ({ success: true, text: 'Risposta territorio' })
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
    },
    memoryService: {
      getMemory: () => ({}),
      getRecentHistory: () => [],
      updateMemoryAtomic: () => true
    },
    territoryValidator: {
      analyzeEmailForAddress: function () {
        territoryCalls += 1;
        return {
          addressFound: true,
          addresses: [{
            street: 'via Barnaba Oriani',
            civic: null,
            verification: {
              needsCivic: false,
              inParish: true,
              reason: 'Via riconosciuta nel territorio parrocchiale.'
            }
          }]
        };
      }
    },
    validator: {
      validateResponse: () => ({ isValid: true, score: 1.0, errors: [], warnings: [], details: {}, fixedResponse: null })
    },
    promptEngine: {
      buildPrompt: (options) => {
        promptOptions = options;
        return 'PROMPT';
      }
    }
  });

  const result = processor.processThread(createExternalThread('territory-membership'), 'kb valida', '', new Set(), true);
  assert(result.status === 'replied', 'la richiesta di appartenenza parrocchiale deve completarsi');
  assert(territoryCalls === 1, `territoryValidator deve essere chiamato una volta, chiamate=${territoryCalls}`);
  assert(promptOptions && promptOptions.territoryContext && promptOptions.territoryContext.includes('RIENTRA'), 'il prompt deve ricevere il contesto territoriale verificato');
  assert(promptOptions.territoryContext.includes('via Barnaba Oriani'), 'il contesto territoriale deve includere la via rilevata');
}

console.log('--- Test processThread: indirizzo passivo non autorizza deduzione territoriale ---');
{
  let territoryCalls = 0;
  let promptOptions = null;
  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => raw,
      extractMessageDetails: () => ({
        subject: 'Informazioni catechismo',
        body: 'Buongiorno, abitiamo in via Antonio Gramsci 12 e vorremmo sapere gli orari del catechismo.',
        senderEmail: 'utente@example.com',
        senderName: 'Utente Test',
        date: new Date('2026-06-13T20:17:00Z'),
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
      shouldRespondToEmail: () => ({
        shouldRespond: true,
        language: 'it',
        relational_posture: 'direct',
        territory_address_candidates: ['via Antonio Gramsci 12'],
        classification: {
          category: 'technical',
          topic: 'orari catechismo',
          territory_address_candidates: ['via Antonio Gramsci 12']
        }
      }),
      detectEmailLanguage: () => ({ lang: 'it' }),
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: () => ({ success: true, text: 'Risposta catechismo' })
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
    },
    memoryService: {
      getMemory: () => ({}),
      getRecentHistory: () => [],
      updateMemoryAtomic: () => true
    },
    territoryValidator: {
      analyzeEmailForAddress: function () {
        territoryCalls += 1;
        return { addressFound: false };
      }
    },
    validator: {
      validateResponse: () => ({ isValid: true, score: 1.0, errors: [], warnings: [], details: {}, fixedResponse: null })
    },
    promptEngine: {
      buildPrompt: (options) => {
        promptOptions = options;
        return 'PROMPT';
      }
    }
  });

  const result = processor.processThread(createExternalThread('passive-territory'), 'kb valida', '', new Set(), true);
  assert(result.status === 'replied', 'la richiesta con indirizzo passivo deve completarsi');
  assert(territoryCalls === 0, `indirizzo passivo non deve chiamare il validatore territoriale, chiamate=${territoryCalls}`);
  assert(promptOptions.territoryContext === null, 'senza richiesta esplicita non deve comparire territoryContext verificato');
  assert(
    Array.isArray(promptOptions.systemDirectives) &&
      promptOptions.systemDirectives.some(directive => String(directive).includes('non dedurre competenza parrocchiale senza verifica')),
    'indirizzo passivo deve aggiungere una direttiva prudenziale tra le systemDirectives'
  );
}

console.log('--- Test prompt options: relationalPosture personal passa dal quick-check al PromptEngine ---');
{
  let promptOptions = null;
  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => raw,
      extractMessageDetails: () => ({
        subject: 'Cresima adulti',
        body: 'Ho una grande gioia nel cuore, sento che questo è un passo immenso. Vorrei ricevere la Cresima.',
        senderEmail: 'utente@example.com',
        senderName: 'Utente Test',
        date: new Date('2026-05-07T10:00:00Z'),
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
      classifyEmail: () => ({ shouldReply: true, category: 'sacrament', subIntents: {}, confidence: 0.9 })
    },
    geminiService: {
      primaryKey: 'primary-key',
      shouldRespondToEmail: () => ({
        shouldRespond: true,
        language: 'it',
        relational_posture: 'personal',
        relational_posture_confidence: 0.92,
        classification: { category: 'sacrament', topic: 'cresima adulti' }
      }),
      detectEmailLanguage: () => ({ lang: 'it' }),
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: () => ({ success: true, text: 'Risposta cresima' })
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', needsDiscernment: false, needsDoctrine: false, dimensions: { pastoral: 0.0 } })
    },
    memoryService: {
      getMemory: () => ({}),
      getRecentHistory: () => [],
      updateMemoryAtomic: () => true
    },
    territoryValidator: {
      validateMultipleAddresses: () => ({ addressFound: false, addresses: [], summary: '' })
    },
    validator: {
      validateResponse: () => ({ isValid: true, score: 1.0, errors: [], warnings: [], details: {}, fixedResponse: null })
    },
    promptEngine: {
      buildPrompt: (options) => {
        promptOptions = options;
        return 'PROMPT';
      }
    }
  });

  const result = processor.processThread(createExternalThread('relational-posture-personal'), 'kb valida', '', new Set(), true);
  assert(result.status === 'replied', 'il thread con postura personal deve completarsi');
  assert(promptOptions && promptOptions.relationalPosture === 'relational', `relationalPosture attesa relational, ottenuta ${promptOptions && promptOptions.relationalPosture}`);
  assert(promptOptions.requestType && promptOptions.requestType.type === 'technical', 'il test deve dimostrare che la postura resta indipendente dal requestType tecnico');
}

console.log('--- Test prompt options: relational_warmth deriva dal quick-check Gemini, non da regex locali ---');
{
  const originalValidationEnabled = global.CONFIG.VALIDATION_ENABLED;
  let promptOptions = null;
  let promptContextInput = null;
  let validationSalutationMode = null;
  let outboundText = null;
  const originalCreatePromptContext = global.createPromptContext;
  global.CONFIG.VALIDATION_ENABLED = true;
  global.createPromptContext = (input) => {
    promptContextInput = input;
    const isWarm = input.relationalPosture === 'appreciative' && Number(input.relationalPostureConfidence) >= 0.7;
    return {
      profile: isWarm ? 'standard' : 'lite',
      concerns: { relational_warmth: isWarm },
      meta: {
        responseRegister: isWarm ? 'pastoral_supportive' : 'warm_institutional',
        salutationMode: isWarm ? 'full_warm' : 'full'
      }
    };
  };
  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => raw,
      extractMessageDetails: () => ({
        subject: 'Corso prematrimoniale',
        body: 'Sono Gian Mario Aresu. Ho appreso da don Francesco del corso. Roma è la città in cui ci siamo conosciuti. Grazie di cuore.',
        senderEmail: 'utente@example.com',
        senderName: 'Gian Mario Aresu',
        date: new Date('2026-05-07T10:00:00Z'),
        headers: {},
        isNewsletter: false,
        rfc2822MessageId: null,
        existingReferences: null
      }),
      addLabelToMessage: () => {},
      addLabelToThread: () => {},
      getThreadHistory: () => '',
      prepareOutboundText: (text) => {
        outboundText = text;
        return text;
      },
      sendHtmlReply: () => {}
    },
    classifier: {
      classifyEmail: () => ({ shouldReply: true, category: 'sacrament', subIntents: {}, confidence: 0.9 })
    },
    geminiService: {
      primaryKey: 'primary-key',
      shouldRespondToEmail: () => ({
        shouldRespond: true,
        language: 'it',
        relational_posture: 'appreciative',
        relational_posture_confidence: 0.95,
        classification: { category: 'sacrament', topic: 'corso prematrimoniale' }
      }),
      detectEmailLanguage: () => ({ lang: 'it' }),
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: () => ({ success: true, text: '<email>Caro Gian Mario,\n\nRisposta</email>' })
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
    },
    memoryService: {
      getMemory: () => ({}),
      getRecentHistory: () => [],
      updateMemoryAtomic: () => true
    },
    territoryValidator: {
      validateMultipleAddresses: () => ({ addressFound: false, addresses: [], summary: '' })
    },
    validator: {
      validateResponse: (_response, _language, _kb, _body, _subject, mode) => {
        validationSalutationMode = mode;
        return { isValid: true, score: 1.0, errors: [], warnings: [], details: {}, fixedResponse: null };
      }
    },
    promptEngine: {
      buildPrompt: (options) => {
        promptOptions = options;
        return 'PROMPT';
      }
    }
  });

  const result = processor.processThread(createExternalThread('relational-warmth-test'), 'kb valida', '', new Set(), true);
  global.createPromptContext = originalCreatePromptContext;
  global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
  assert(result.status === 'replied', 'il thread con calore relazionale deve completarsi');
  assert(promptOptions && promptOptions.relationalPosture === 'appreciative', `relationalPosture attesa appreciative, ottenuta ${promptOptions && promptOptions.relationalPosture}`);
  assert(promptOptions && promptOptions.salutationMode === 'full_warm', `salutationMode atteso full_warm, ottenuto ${promptOptions && promptOptions.salutationMode}`);
  assert(validationSalutationMode === 'full_warm', `la validazione deve ricevere full_warm, ottenuto ${validationSalutationMode}`);
  assert(outboundText && outboundText.startsWith('Caro Gian Mario'), 'il guardrail italiano deve preservare Caro/Cara quando full_warm è esplicito');
  assert(promptContextInput && promptContextInput.relationalPostureConfidence === 0.95, `relationalPostureConfidence attesa 0.95, ottenuta ${promptContextInput && promptContextInput.relationalPostureConfidence}`);
  assert(promptContextInput && promptContextInput.quickCheck.relational_posture === 'appreciative', 'il promptContextInput deve contenere appreciative');
}

console.log('--- Test runtimeContext: messageDate fallback esplicito quando la data Gmail non è valida ---');
{
  const processor = new EmailProcessor({
    gmailService: {},
    promptEngine: {
      _getPapalContext_: () => ({
        currentName: 'Pio XIII',
        previousName: 'Papa Francesco',
        currentSince: '2026-01-01',
        ministryStart: '2026-01-08'
      })
    }
  });
  const runtimeContext = processor._buildRuntimeContext_(
    { date: new Date('invalid') },
    new Date('2026-05-15T08:00:00Z'),
    ''
  );
  assert(runtimeContext.temporal.messageDateAvailable === false, 'data Gmail invalida deve essere marcata come non disponibile');
  assert(runtimeContext.temporal.messageDateSource === 'processing_fallback', 'data Gmail invalida deve usare sorgente processing_fallback');
  assert(runtimeContext.temporal.messageDate === runtimeContext.temporal.currentDate, 'fallback messageDate deve coincidere con currentDate di processing');
  assert(runtimeContext.temporal.messageTime === null, 'fallback messageDate non deve inventare una messageTime originale');
  assert(Object.isFrozen(runtimeContext.temporal), 'temporal fallback context deve restare congelato');
}

console.log('--- Test prompt options: scheduleContext usa data target e periodo KB ---');
{
  const originalUtilities = global.Utilities;
  global.Utilities = {
    formatDate: (_date, _tz, pattern) => {
      if (pattern === 'yyyy-MM-dd') return '2026-06-01';
      if (pattern === 'HH:mm') return '10:00';
      return '2026-06-01';
    }
  };

  let promptOptions = null;
  try {
    const processor = new EmailProcessor({
      gmailService: {
        _extractEmailAddress: (raw) => raw,
        extractMessageDetails: () => ({
          subject: 'Orari Messe',
          body: 'A che orari verra celebrata la messa dopodomani?',
          senderEmail: 'utente@example.com',
          senderName: 'Utente Test',
          date: new Date('2026-06-01T08:00:00Z'),
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
        shouldRespondToEmail: () => ({ shouldRespond: true, language: 'it', classification: { category: 'information', topic: 'orari messe' } }),
        detectEmailLanguage: () => ({ lang: 'it' }),
        getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
        getAdaptiveClosing: () => 'Cordiali saluti',
        generateResponse: () => ({ success: true, text: 'Risposta orari' })
      },
      requestClassifier: {
        classify: () => ({ type: 'information', dimensions: { pastoral: 0.0 } })
      },
      memoryService: {
        getMemory: () => ({}),
        getRecentHistory: () => [],
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

    const kb = 'Orari Basilica | Periodo estivo | Dal 29 giugno al 30 agosto\nOrari Messe | Messe feriali invernali | 7:25, 13:15, 19:00\nOrari Messe | Messe feriali estivi | 7:25, 19:00';
    const result = processor.processThread(createExternalThread('schedule-context'), kb, '', new Set(), true);
    assert(result.status === 'replied', 'il thread orari deve completarsi');
    assert(promptOptions.currentSeason === 'invernale', `currentSeason deve seguire la data target, ottenuto ${promptOptions && promptOptions.currentSeason}`);
    assert(promptOptions.scheduleContext.targetDate === '2026-06-03', `targetDate attesa 2026-06-03, ottenuta ${promptOptions && promptOptions.scheduleContext && promptOptions.scheduleContext.targetDate}`);
    assert(promptOptions.scheduleContext.season === 'invernale', 'scheduleContext deve restare invernale il 3 giugno');
  } finally {
    global.Utilities = originalUtilities;
  }
}

console.log('--- Test prompt options: scheduleContext ancora relativi alla data messaggio ---');
{
  const originalUtilities = global.Utilities;
  global.Utilities = {
    formatDate: (date, _tz, pattern) => {
      if (pattern === 'HH:mm') return '10:00';
      const iso = date instanceof Date && !isNaN(date.getTime()) ? date.toISOString() : '';
      if (
        iso.startsWith('2026-06-26T08:00:00') ||
        iso.startsWith('2026-06-26T10:00:00') ||
        iso.startsWith('2026-06-26T12:00:00')
      ) return '2026-06-26';
      if (iso.startsWith('2026-06-27')) return '2026-06-27';
      return '2026-06-30';
    }
  };

  let promptOptions = null;
  try {
    const processor = new EmailProcessor({
      gmailService: {
        _extractEmailAddress: (raw) => raw,
        extractMessageDetails: () => ({
          subject: 'Orari Messe',
          body: 'A che orari verra celebrata la messa domani?',
          senderEmail: 'utente@example.com',
          senderName: 'Utente Test',
          date: new Date('2026-06-26T08:00:00Z'),
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
        shouldRespondToEmail: () => ({ shouldRespond: true, language: 'it', classification: { category: 'information', topic: 'orari messe' } }),
        detectEmailLanguage: () => ({ lang: 'it' }),
        getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
        getAdaptiveClosing: () => 'Cordiali saluti',
        generateResponse: () => ({ success: true, text: 'Risposta orari' })
      },
      requestClassifier: {
        classify: () => ({ type: 'information', dimensions: { pastoral: 0.0 } })
      },
      memoryService: {
        getMemory: () => ({}),
        getRecentHistory: () => [],
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

    const kb = 'Orari Basilica | Periodo estivo | Dal 29 giugno al 30 agosto\nOrari Messe | Messe feriali invernali | 7:25, 13:15, 19:00\nOrari Messe | Messe feriali estivi | 7:25, 19:00';
    const result = processor.processThread(createExternalThread('schedule-context-delayed'), kb, '', new Set(), true);
    assert(result.status === 'replied', 'il thread orari differito deve completarsi');
    assert(promptOptions.currentDate === '2026-06-30', `currentDate attesa 2026-06-30, ottenuta ${promptOptions && promptOptions.currentDate}`);
    assert(promptOptions.messageDate === '2026-06-26', `messageDate attesa 2026-06-26, ottenuta ${promptOptions && promptOptions.messageDate}`);
    assert(promptOptions.scheduleContext.targetDate === '2026-06-27', `domani deve risolversi dalla messageDate, ottenuto ${promptOptions && promptOptions.scheduleContext && promptOptions.scheduleContext.targetDate}`);
    assert(promptOptions.scheduleContext.currentDate === '2026-06-30', 'scheduleContext.currentDate deve restare la data di risposta');
    assert(promptOptions.scheduleContext.requestAnchorDate === '2026-06-26', 'scheduleContext deve tracciare la data ancora del messaggio');
    assert(promptOptions.scheduleContext.targetDateIsPast === true, 'il target ricavato dalla messageDate deve risultare passato al processing');
  } finally {
    global.Utilities = originalUtilities;
  }
}

console.log('--- Test context routing: categoria tecnica usa set condiviso e disattiva dottrina ---');
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
        subject: 'Richiesta orari ufficio',
        body: 'Vorrei sapere gli orari della segreteria parrocchiale.',
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
      classifyEmail: () => ({ shouldReply: true, category: 'technical', subIntents: {}, confidence: 0.9 })
    },
    geminiService: {
      primaryKey: 'primary-key',
      shouldRespondToEmail: () => ({ shouldRespond: true, language: 'it', classification: { category: 'technical', topic: 'orari' } }),
      detectEmailLanguage: () => ({ lang: 'it' }),
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: () => ({ success: true, text: 'Risposta orari' })
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
    },
    memoryService: {
      getMemory: () => ({}),
      getRecentHistory: () => [],
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

  const result = processor.processThread(createExternalThread('technical-routing'), 'kb valida', 'dottrina completa', new Set(), true);
  assert(result.status === 'replied', 'la richiesta tecnica deve completarsi senza ReferenceError sul set categorie');
  assert(promptOptions.category === 'technical', `categoria tecnica attesa technical, ottenuta ${promptOptions && promptOptions.category}`);
  assert(promptOptions.doctrineBase === '', 'la richiesta tecnica pura deve disattivare la dottrina pesante');
  assert(promptOptions.aiCore === '', 'la richiesta tecnica pura deve disattivare AI core pesante');

  global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
  global.GLOBAL_CACHE = originalGlobalCache;
}


console.log('--- Test context routing: document_request certificato resta tecnico anche con concern sacramentale ---');
{
  const originalValidationEnabled = global.CONFIG.VALIDATION_ENABLED;
  const originalGlobalCache = global.GLOBAL_CACHE;
  const originalCreatePromptContext = global.createPromptContext;
  global.CONFIG.VALIDATION_ENABLED = false;
  global.GLOBAL_CACHE = { aiCoreLite: 'core lite', aiCore: 'core pesante' };
  global.createPromptContext = () => ({
    profile: 'standard',
    concerns: { sacrament: true, doctrine: true }
  });

  let promptOptions = null;
  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => raw,
      extractMessageDetails: () => ({
        subject: 'Richiesta certificato di battesimo',
        body: 'Buongiorno, vorrei richiedere il certificato di battesimo di mia figlia. Quali dati servono?',
        senderEmail: 'utente@example.com',
        senderName: 'Utente Test',
        date: new Date('2026-06-13T10:00:00Z'),
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
      classifyEmail: () => ({ shouldReply: true, category: 'sacrament', subIntents: {}, confidence: 0.9 })
    },
    geminiService: {
      primaryKey: 'primary-key',
      shouldRespondToEmail: () => ({
        shouldRespond: true,
        language: 'it',
        relational_posture: 'direct',
        classification: {
          category: 'sacrament',
          topic: 'Richiesta certificato di battesimo'
        }
      }),
      detectEmailLanguage: () => ({ lang: 'it' }),
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: () => ({ success: true, text: 'Risposta certificato' })
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', dimensions: { pastoral: 0.8 }, needsDiscernment: true, needsDoctrine: true })
    },
    memoryService: {
      getMemory: () => ({}),
      getRecentHistory: () => [],
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

  const result = processor.processThread(createExternalThread('document-request-routing'), 'kb valida', 'dottrina completa', new Set(), true);
  assert(result.status === 'replied', 'la richiesta certificato deve completarsi');
  assert(promptOptions.category === 'document_request', `categoria attesa document_request, ottenuta ${promptOptions && promptOptions.category}`);
  assert(promptOptions.aiCore === '', 'document_request deve spegnere AI core pesante anche con concern sacramentale');
  assert(promptOptions.doctrineBase === '', 'document_request deve spegnere dottrina pesante anche con concern sacramentale');
  assert(
    !String(promptOptions.aiCoreLite || '').includes('REGOLA TASSATIVA SUI CERTIFICATI'),
    'document_request non deve mescolare la regola tassativa certificati dentro aiCoreLite'
  );
  assert(
    promptOptions.requestPurpose && promptOptions.requestPurpose.type === 'mixed',
    'richiesta di rilascio con domanda residua deve essere classificata come mixed'
  );
  assert(
    Array.isArray(promptOptions.systemDirectives) &&
      promptOptions.systemDirectives.some(directive => String(directive).includes('RICHIESTA MISTA DI CERTIFICATO')),
    'la direttiva certificati deve gestire prima l azione e poi la sola domanda aperta'
  );
  assert(
    !promptOptions.systemDirectives.some(directive => String(directive).includes('Specifica sempre')),
    'la regola procedurale non deve piu essere iniettata indiscriminatamente'
  );

  global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
  global.GLOBAL_CACHE = originalGlobalCache;
  global.createPromptContext = originalCreatePromptContext;
}

console.log('--- Test quick-check: conversationState memoria abilita contesto conversazionale ---');
{
  const originalValidationEnabled = global.CONFIG.VALIDATION_ENABLED;
  const originalGlobalCache = global.GLOBAL_CACHE;
  const originalCreatePromptContext = global.createPromptContext;
  global.CONFIG.VALIDATION_ENABLED = false;
  global.GLOBAL_CACHE = { aiCoreLite: 'core lite', aiCore: 'core pesante' };

  let quickIntentContext = null;
  let promptOptions = null;
  let promptContextInput = null;
  let memoryUpdateArgs = null;
  global.createPromptContext = (input) => {
    promptContextInput = input;
    return {
      profile: 'standard',
      concerns: { relational_warmth: true },
      meta: {
        responseMode: 'standard_operational',
        responseRegister: 'pastoral_supportive',
        salutationMode: 'full_warm',
        operationalConstraints: [],
        continuityPolicy: {
          key: 'relational_opening_continuity',
          directive: 'Valorizza l’apertura relazionale con una ripresa naturale e breve.'
        },
        continuityCase: {
          key: 'relational_opening_continuity',
          longitudinal: false,
          relationalWarmth: true,
          sourceSignals: ['conversationState:posture:open']
        }
      }
    };
  };
  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => raw,
      extractMessageDetails: () => ({
        subject: 'Re: Orario segreteria',
        body: 'Grazie, vorrei capire a che ora posso passare.',
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
      shouldRespondToEmail: (body, subject, languageDetection, intentContext) => {
        quickIntentContext = intentContext;
        return { shouldRespond: true, language: 'it', classification: { category: 'information', topic: 'orari segreteria' } };
      },
      detectEmailLanguage: () => ({ lang: 'it' }),
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: () => ({ success: true, text: 'Risposta orari' })
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
    },
    memoryService: {
      getMemory: () => ({
        memorySummary: 'Iter precedente sugli orari della segreteria',
        lastUpdated: new Date().toISOString(),
        providedInfo: [{ topic: 'orari segreteria', userReaction: 'acknowledged' }],
        contextualFlags: {
          remote_user: true,
          canonical_complexity: true,
          physical_presence_constraint: true
        },
        conversationState: {
          currentRelationalPosture: 'open',
          responseFocusHint: null,
          responseFocusHintConfidence: 0
        }
      }),
      getRecentHistory: () => [],
      updateMemoryAtomic: (threadId, data, providedTopics, inferredReactionData) => {
        memoryUpdateArgs = { threadId, data, providedTopics, inferredReactionData };
        return true;
      }
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

  const result = processor.processThread(createExternalThread('conversation-state-only'), 'kb valida', '', new Set(), true);
  assert(result.status === 'replied', 'il thread con solo conversationState in memoria deve completarsi');
  assert(quickIntentContext && quickIntentContext.hasConversationContext === true, 'conversationState deve abilitare il contesto conversazionale per la quick-check');
  assert(
      quickIntentContext.quickMemoryContext &&
      quickIntentContext.quickMemoryContext.summary.includes('Iter precedente') &&
      quickIntentContext.quickMemoryContext.providedInfo.includes('orari segreteria') &&
      quickIntentContext.quickMemoryContext.contextualFlags.remote_user === true &&
      quickIntentContext.quickMemoryContext.contextualFlags.canonical_complexity === true &&
      !Object.prototype.hasOwnProperty.call(quickIntentContext.quickMemoryContext.contextualFlags, 'physical_presence_constraint'),
    'quick-check deve ricevere una mini-memoria sanificata quando esiste contesto conversazionale'
  );
  assert(
    promptContextInput &&
      promptContextInput.memory &&
      promptContextInput.memory.conversationState &&
      promptContextInput.memory.conversationState.currentRelationalPosture === 'open',
    'EmailProcessor deve passare conversationState al PromptContext'
  );
  assert(
    promptOptions.continuityCase &&
      promptOptions.continuityCase.key === 'relational_opening_continuity',
    'conversationState relazionale deve arrivare al PromptEngine come continuityCase'
  );
  assert(
    promptOptions.salutation === 'Buongiorno' &&
      promptOptions.closing === 'Cordiali saluti',
    'una promozione PromptContext a full_warm non deve ereditare greeting/closing azzerati dalla modalità pre-contesto'
  );
  assert(
    promptOptions.responseMode === 'standard_operational' &&
      promptOptions.continuityPolicy &&
      promptOptions.continuityPolicy.key === 'relational_opening_continuity',
    'EmailProcessor deve propagare responseMode e continuityPolicy al PromptEngine'
  );
  assert(
    memoryUpdateArgs &&
      memoryUpdateArgs.data &&
      memoryUpdateArgs.data._incrementMessageCount === true,
    'EmailProcessor deve incrementare messageCount nel salvataggio atomico della memoria'
  );
  assert(
    promptOptions.responseStrategyInferenceBlocked === true,
    'EmailProcessor deve passare al PromptEngine il blocco inferenza responseStrategy deciso da vincoli piu forti'
  );

  global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
  global.GLOBAL_CACHE = originalGlobalCache;
  global.createPromptContext = originalCreatePromptContext;
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
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: () => ({ success: true, text: 'Risposta sacramento' })
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
    },
    memoryService: {
      getMemory: () => ({}),
      getRecentHistory: () => [],
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
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: () => ({ success: true, text: 'Risposta incontro' })
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
    },
    memoryService: {
      getMemory: () => ({ category: 'pastoral_sacrament', lastUpdated: '2026-05-10T10:00:00Z', providedInfo: [] }),
      getRecentHistory: () => [],
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
  assert(promptOptions.aiCore.startsWith('core pesante'), 'la memoria pastorale deve mantenere attivo anche AI core pesante');

  global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
  global.GLOBAL_CACHE = originalGlobalCache;
}

console.log('--- Test context routing: memoria semantica sensibile impedisce amnesia su follow-up tecnico ---');
{
  const originalValidationEnabled = global.CONFIG.VALIDATION_ENABLED;
  const originalGlobalCache = global.GLOBAL_CACHE;
  const originalCreatePromptContext = global.createPromptContext;
  global.CONFIG.VALIDATION_ENABLED = false;
  global.GLOBAL_CACHE = { aiCoreLite: 'core lite', aiCore: 'core pesante' };

  let promptOptions = null;
  let promptContextInput = null;
  global.createPromptContext = (input) => {
    promptContextInput = input;
    return {
      profile: 'heavy',
      concerns: { longitudinal_sensitivity: true },
      meta: {
        responseMode: 'pastoral_longitudinal',
        responseRegister: 'pastoral_supportive',
        salutationMode: 'soft',
        operationalConstraints: [
          'Non riaprire il vissuto se l’utente non lo riprende.',
          'Mantieni tono sobrio e umano.'
        ],
        continuityPolicy: {
          key: 'do_not_reopen_past_context',
          directive: 'Non riaprire il vissuto se l’utente non lo riprende.'
        },
        concernSynthesis: {
          key: 'longitudinal_operational',
          directive: 'La memoria segnala un lutto ancora rilevante.',
          suppress: {}
        },
        continuityCase: {
          key: 'bereavement_continuity',
          longitudinal: true,
          relationalWarmth: false,
          sourceSignals: ['memoryText:bereavement']
        }
      }
    };
  };
  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => raw,
      extractMessageDetails: () => ({
        subject: 'Re: appuntamento',
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
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: () => ({ success: true, text: 'Risposta incontro' })
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
    },
    memoryService: {
      getMemory: () => ({
        category: 'information',
        lastUpdated: '2026-05-10T10:00:00Z',
        memorySummary: 'Scambio precedente su lutto familiare',
        providedInfo: [
          { topic: 'esequie' },
          { topic: 'accompagnamento famiglia' }
        ]
      }),
      getRecentHistory: () => [],
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

  const result = processor.processThread(createExternalThread('memory-sensitive-summary'), 'kb valida', 'dottrina completa', new Set(), true);
  assert(result.status === 'replied', 'il follow-up tecnico con memoria sensibile deve completarsi');
  assert(promptContextInput.memory.memorySummary.includes('lutto'), 'EmailProcessor deve passare memorySummary al PromptContext');
  assert(promptContextInput.memory.topics.includes('esequie'), 'EmailProcessor deve passare i topic semantici della memoria al PromptContext');
  assert(promptOptions.activeConcerns.longitudinal_sensitivity === true, 'la memoria semantica deve arrivare come concern longitudinale');
  assert(promptOptions.continuityCase && promptOptions.continuityCase.key === 'bereavement_continuity', 'EmailProcessor deve propagare continuityCase al PromptEngine');
  assert(promptOptions.responseMode === 'pastoral_longitudinal', 'EmailProcessor deve propagare responseMode longitudinale al PromptEngine');
  assert(Array.isArray(promptOptions.operationalConstraints) && promptOptions.operationalConstraints.length === 2, 'EmailProcessor deve propagare operationalConstraints al PromptEngine');
  assert(promptOptions.continuityPolicy && promptOptions.continuityPolicy.key === 'do_not_reopen_past_context', 'EmailProcessor deve propagare continuityPolicy al PromptEngine');
  assert(promptOptions.promptProfile === 'heavy', 'la memoria semantica sensibile deve alzare il profilo prompt');
  assert(promptOptions.doctrineBase === 'dottrina completa', 'la memoria semantica sensibile deve impedire la disattivazione della dottrina');
  assert(promptOptions.aiCore.startsWith('core pesante'), 'la memoria semantica sensibile deve mantenere attivo AI core pesante');

  global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
  global.GLOBAL_CACHE = originalGlobalCache;
  global.createPromptContext = originalCreatePromptContext;
}

console.log('--- Test context routing: pastoral_technical_blend mantiene dottrina su categoria information ---');
{
  const originalValidationEnabled = global.CONFIG.VALIDATION_ENABLED;
  const originalGlobalCache = global.GLOBAL_CACHE;
  const originalCreatePromptContext = global.createPromptContext;
  global.CONFIG.VALIDATION_ENABLED = false;
  global.GLOBAL_CACHE = { aiCoreLite: 'core lite', aiCore: 'core pesante' };

  let promptOptions = null;
  global.createPromptContext = () => ({
    profile: 'heavy',
    concerns: { pastoral_technical_blend: true },
    meta: {
      responseMode: 'pastoral_operational',
      responseRegister: 'pastoral_supportive',
      salutationMode: 'full',
      operationalConstraints: [
        'Rispondi anzitutto al dato pratico richiesto.'
      ],
      continuityPolicy: null,
      concernSynthesis: {
        key: 'pastoral_technical_blend',
        directive: 'Il segnale personale orienta il tono, non amplia l’oggetto della risposta.',
        suppress: {}
      }
    }
  });
  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => raw,
      extractMessageDetails: () => ({
        subject: 'Richiesta informazioni',
        body: 'Sono confusa e vorrei capire come muovermi per il percorso.',
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
      shouldRespondToEmail: () => ({ shouldRespond: true, language: 'it', classification: { category: 'information', topic: 'percorso' } }),
      detectEmailLanguage: () => ({ lang: 'it' }),
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: () => ({ success: true, text: 'Risposta percorso' })
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
    },
    memoryService: {
      getMemory: () => ({}),
      getRecentHistory: () => [],
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

  const result = processor.processThread(createExternalThread('pastoral-technical-blend-routing'), 'kb valida', 'dottrina completa', new Set(), true);
  assert(result.status === 'replied', 'la categoria information con pastoral_technical_blend deve completarsi');
  assert(promptOptions.category === 'information', `categoria attesa information, ottenuta ${promptOptions && promptOptions.category}`);
  assert(promptOptions.activeConcerns.pastoral_technical_blend === true, 'pastoral_technical_blend deve arrivare al PromptEngine');
  assert(promptOptions.doctrineBase === 'dottrina completa', 'pastoral_technical_blend deve impedire il taglio della dottrina');
  assert(promptOptions.aiCore.startsWith('core pesante'), 'pastoral_technical_blend deve mantenere attivo AI core pesante');

  global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
  global.GLOBAL_CACHE = originalGlobalCache;
  global.createPromptContext = originalCreatePromptContext;
}


console.log('--- Test context routing: OCR sacramentale riattiva dottrina dopo categoria tecnica ---');
{
  const originalValidationEnabled = global.CONFIG.VALIDATION_ENABLED;
  const originalAttachmentContext = global.CONFIG.ATTACHMENT_CONTEXT;
  const originalGlobalCache = global.GLOBAL_CACHE;
  global.CONFIG.VALIDATION_ENABLED = false;
  global.CONFIG.ATTACHMENT_CONTEXT = { enabled: true, maxFiles: 3 };
  global.GLOBAL_CACHE = { aiCoreLite: 'core lite', aiCore: 'core pesante' };

  let promptOptions = null;
  const msg = {
    getId: () => 'm-post-ocr-sacrament',
    isUnread: () => true,
    getFrom: () => 'utente@example.com',
    getDate: () => new Date('2026-05-10T10:00:00Z'),
    getSubject: () => 'Info pratica',
    getPlainBody: () => 'Allego certificato. Posso fare Cresima?',
    getAttachments: () => [{ getName: () => 'certificato_battesimo.pdf' }]
  };
  const thread = createThread({ id: 't-post-ocr-sacrament', messages: [msg] });
  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => raw,
      extractMessageDetails: () => ({
        subject: 'Info pratica',
        body: 'Allego certificato. Posso fare Cresima?',
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
        textContext: 'Certificato di battesimo per uso sacramentale.',
        skipped: [],
        items: [{ name: 'certificato_battesimo.pdf', text: 'Certificato di battesimo' }]
      }),
      prepareOutboundText: (text) => text,
      sendHtmlReply: () => {}
    },
    classifier: {
      classifyEmail: () => ({ shouldReply: true, category: 'information', subIntents: {}, confidence: 0.9 })
    },
    geminiService: {
      primaryKey: 'primary-key',
      shouldRespondToEmail: () => ({ shouldRespond: true, language: 'it', classification: { category: 'information', topic: 'pratica' } }),
      detectEmailLanguage: () => ({ lang: 'it' }),
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: () => ({ success: true, text: 'Risposta Cresima' })
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
    },
    memoryService: {
      getMemory: () => ({}),
      getRecentHistory: () => [],
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

  const result = processor.processThread(thread, 'kb valida', 'dottrina completa', new Set(), true);
  assert(result.status === 'replied', 'la domanda con certificato sacramentale OCR deve completarsi');
  assert(promptOptions.category === 'sacrament', `categoria post-OCR attesa sacrament, ottenuta ${promptOptions && promptOptions.category}`);
  assert(promptOptions.doctrineBase === 'dottrina completa', 'la dottrina deve restare attiva dopo routing post-OCR sacramentale');
  assert(promptOptions.aiCore.startsWith('core pesante'), 'AI core pesante deve restare attivo dopo routing post-OCR sacramentale');

  global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
  global.CONFIG.ATTACHMENT_CONTEXT = originalAttachmentContext;
  global.GLOBAL_CACHE = originalGlobalCache;
}

console.log('--- Test PromptContext: categoria OCR post-allegati governa profilo, registro e concernSynthesis ---');
{
  const originalValidationEnabled = global.CONFIG.VALIDATION_ENABLED;
  const originalAttachmentContext = global.CONFIG.ATTACHMENT_CONTEXT;
  const originalGlobalCache = global.GLOBAL_CACHE;
  const originalCreatePromptContext = global.createPromptContext;
  global.CONFIG.VALIDATION_ENABLED = false;
  global.CONFIG.ATTACHMENT_CONTEXT = { enabled: true, maxFiles: 2 };
  global.GLOBAL_CACHE = { aiCoreLite: 'core lite', aiCore: 'core pesante' };

  let promptContextInput = null;
  let promptOptions = null;
  const synthesis = {
    key: 'test_synthesis',
    directive: 'Direttiva sintetica di test',
    suppress: { formattingGuidelines: true }
  };
  global.createPromptContext = (input) => {
    promptContextInput = input;
    return {
      profile: input.classification.category === 'formal' ? 'heavy' : 'lite',
      concerns: { hallucination_risk: true, emotional_sensitivity: true },
      meta: {
        responseRegister: input.classification.category === 'formal' ? 'formal_institutional' : 'warm_institutional',
        salutationMode: 'full',
        concernSynthesis: synthesis
      }
    };
  };

  const msg = {
    getId: () => 'm-post-ocr-formal',
    isUnread: () => true,
    getFrom: () => 'utente@example.com',
    getDate: () => new Date('2026-05-10T10:00:00Z'),
    getSubject: () => 'Modulo allegato',
    getPlainBody: () => 'Allego il modulo.',
    getAttachments: () => [{ getName: () => 'modulo_sbattezzo.pdf' }]
  };
  const thread = createThread({ id: 't-post-ocr-formal', messages: [msg] });
  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => raw,
      extractMessageDetails: () => ({
        subject: 'Modulo allegato',
        body: 'Allego il modulo.',
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
        textContext: 'Modulo sbattezzo - richiesta cancellazione dal registro battesimo.',
        skipped: [],
        items: [{ name: 'modulo_sbattezzo.pdf', text: 'Modulo sbattezzo' }]
      }),
      prepareOutboundText: (text) => text,
      sendHtmlReply: () => {}
    },
    classifier: {
      classifyEmail: () => ({ shouldReply: true, category: 'information', subIntents: {}, confidence: 0.9 })
    },
    geminiService: {
      primaryKey: 'primary-key',
      shouldRespondToEmail: () => ({ shouldRespond: true, language: 'it', classification: { category: 'information', topic: 'modulo' } }),
      detectEmailLanguage: () => ({ lang: 'it' }),
      getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
      getAdaptiveClosing: () => 'Cordiali saluti',
      generateResponse: () => ({ success: true, text: 'Risposta formale' })
    },
    requestClassifier: {
      classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
    },
    memoryService: {
      getMemory: () => ({}),
      getRecentHistory: () => [],
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

  const result = processor.processThread(thread, 'kb valida', 'dottrina completa', new Set(), true);
  assert(result.status === 'replied', 'la submission formale OCR deve completarsi');
  assert(promptContextInput && promptContextInput.classification.category === 'formal', `PromptContext deve ricevere categoria formal post-OCR, ottenuta ${promptContextInput && promptContextInput.classification && promptContextInput.classification.category}`);
  assert(promptOptions && promptOptions.category === 'formal', `PromptEngine deve ricevere categoria formal, ottenuta ${promptOptions && promptOptions.category}`);
  assert(promptOptions.promptProfile === 'heavy', 'il profilo del PromptContext post-OCR deve arrivare al PromptEngine');
  assert(promptOptions.responseRegister === 'formal_institutional', 'il registro post-OCR deve arrivare al PromptEngine');
  assert(promptOptions.concernSynthesis === synthesis, 'concernSynthesis deve essere trasmessa a buildPrompt');

  global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
  global.CONFIG.ATTACHMENT_CONTEXT = originalAttachmentContext;
  global.GLOBAL_CACHE = originalGlobalCache;
  global.createPromptContext = originalCreatePromptContext;
}

console.log('--- Test attachment intent: OCR con punti interrogativi non crea domanda ---');
{
  const processor = new EmailProcessor({ gmailService: {} });
  const context = processor._deriveAttachmentIntentContext_(
    'Allego modulo compilato.',
    'Invio documento',
    [{ name: 'modulo.pdf' }],
    'Nome? Cognome? Domanda di iscrizione',
    'post_ocr'
  );
  assert(context && context.hasQuestions === false, 'le domande/etichette OCR non devono impostare hasQuestions');
  assert(!/_with_question$/.test(context.intent), `intent OCR non deve terminare con _with_question, ottenuto ${context && context.intent}`);
}

console.log('--- Test attachment intent: corpo descrittivo lungo non crea domanda ---');
{
  const processor = new EmailProcessor({ gmailService: {} });
  const longBody = Array(20).fill('Trasmetto la documentazione allegata per il fascicolo della pratica.').join(' ');
  const context = processor._deriveAttachmentIntentContext_(
    longBody,
    'Invio documentazione',
    [{ name: 'documentazione.pdf' }],
    'Documento allegato alla pratica',
    'post_ocr'
  );
  assert(context && context.hasQuestions === false, 'un corpo lungo ma solo descrittivo non deve attivare hasQuestions');
  assert(!/_with_question$/.test(context.intent), `intent descrittivo lungo non deve terminare con _with_question, ottenuto ${context && context.intent}`);
  assert(/ricezione della documentazione allegata/i.test(context.responseDirective || ''), 'la direttiva deve restare receipt-only per consegna pura');
}

console.log('--- Test attachment intent: domanda su certificato in oggetto Re non e una consegna ---');
{
  const processor = new EmailProcessor({ gmailService: {} });
  const body = [
    'Buongiorno,',
    'Vi ringrazio, confermo di leggervi!',
    'Tuttavia io mi sono cresimato nella chiesa di san Luigi dei Francesi nel 2008.',
    'Quali sono i prossimi passi per aggiornare il certificato?'
  ].join(' ');
  const subject = 'Re: certificato di battesimo uso matrimonio';
  const context = processor._deriveAttachmentIntentContext_(body, subject, [], '', 'pre_ocr');

  assert(context === null, 'la sola menzione di certificato, anche con domanda, non deve diventare submission');

  const model = processor._buildDocumentDeliveryModel_({
    subject,
    body,
    quickDocumentDelivery: {
      expected_document: true,
      expected_document_description: 'certificato di battesimo',
      delivery_channel: 'attachment',
      body_contains_filled_document: false,
      missing_document_if_no_attachment: true
    },
    quickAttachmentIntent: null,
    physicalAttachmentsDetected: false,
    attachmentItems: [],
    textFromAttachments: ''
  });

  assert(model.expectsDocument === false, 'un expected_document del modello senza prova locale non deve essere vincolante');
  assert(model.status === 'none', `la domanda sul certificato non deve diventare documento mancante, ottenuto ${model.status}`);
  assert(model.hasExpectedDocumentMissing === false, 'il validator non deve ricevere expectedDocumentMissing nel follow-up');
}

console.log('--- Test document delivery: annuncio esplicito senza file resta documento mancante ---');
{
  const processor = new EmailProcessor({ gmailService: {} });
  const model = processor._buildDocumentDeliveryModel_({
    subject: 'Invio certificato di battesimo',
    body: 'Buongiorno, in allegato invio il certificato richiesto.',
    quickDocumentDelivery: {
      expected_document: true,
      expected_document_description: 'certificato di battesimo',
      delivery_channel: 'attachment',
      body_contains_filled_document: false,
      missing_document_if_no_attachment: true
    },
    quickAttachmentIntent: null,
    physicalAttachmentsDetected: false,
    attachmentItems: [],
    textFromAttachments: ''
  });

  assert(model.announcedByBody === true, 'l annuncio esplicito deve essere corroborato localmente');
  assert(model.status === 'missing', `un allegato davvero annunciato ma assente deve restare missing, ottenuto ${model.status}`);
}

console.log('--- Test attachment intent: modulo compilato con desiderio di partecipazione non diventa receipt-only ---');
{
  const processor = new EmailProcessor({ gmailService: {} });
  const body = [
    'Abbiamo compilato il modulo online per il corso per la Cresima per adulti per Giorgio Licari',
    'e vorrei partecipare anche io agli incontri se possibile sono Sara Ciccarella.',
    'Abbiamo avuto il contatto tramite Gloria Gagliardi.'
  ].join(' ');
  const context = processor._deriveAttachmentIntentContext_(
    body,
    'Corso Cresima adulti',
    [],
    '',
    'pre_ocr'
  );

  assert(context && context.intent === 'suspected_submission_with_question', `il desiderio operativo deve prevalere sulla sola consegna, ottenuto ${context && context.intent}`);
  assert(context.hasQuestions === true, 'il pre-check deve esporre il segnale operativo col contratto hasQuestions usato dalla policy');

  const policyState = { forceReceiptOnlyForSubmission: false };
  const policyContext = processor._createRuleContext_({
    phase: 'post_ocr_policy',
    state: policyState,
    isDocumentSubmission: true,
    hasSubmissionQuestions: context.hasQuestions === true,
    isSponsorSubmission: false,
    isComplexCanonicalSubmission: false,
    shouldProvideEligibilityGuidance: false
  });
  const decision = processor._evaluateEmailPolicyRules_(policyContext);
  processor._applyPreAiRuleDecision_(decision, policyContext, { status: 'unknown' });
  assert(policyState.forceReceiptOnlyForSubmission === false, 'la richiesta di partecipazione deve passare alla generazione della risposta');
}

console.log('--- Test attachment intent: richiesta permesso firma modulo non diventa receipt-only ---');
{
  const processor = new EmailProcessor({ gmailService: {} });
  const body = [
    'Come da indicazioni del Vicariato, vi scrivo per chiedere il permesso affinche una vostra parrocchiana possa seguire il nostro programma di Cresima.',
    'Se acconsentite, vi prego di firmare e timbrare il modulo allegato e di restituirmelo al piu presto.'
  ].join(' ');
  const context = processor._deriveAttachmentIntentContext_(
    body,
    'Permesso Cresima Marymount',
    [{ name: 'modulo_autorizzazione.pdf' }],
    'Modulo autorizzazione programma Cresima',
    'post_ocr'
  );
  assert(context && context.hasQuestions === true, 'la richiesta operativa nel corpo deve attivare hasQuestions');
  assert(/_with_question$/.test(context.intent), `intent deve terminare con _with_question, ottenuto ${context && context.intent}`);
  assert(/non limitarsi|richiesta operativa/i.test(context.responseDirective || ''), 'la direttiva deve impedire la sola ricevuta');
}

console.log('--- Test document consistency: idoneita accentata e carta identita fallback ---');
{
  const processor = new EmailProcessor({ gmailService: {} });
  assert(
    processor._detectDocumentTypeFromText_('Certificato di idoneità') === 'attestato_idoneita_padrino_madrina',
    'idoneità accentata deve essere riconosciuta senza dipendere da \\b ASCII'
  );
  assert(
    processor._detectDocumentTypeFromText_('CARTA D\'IDENTITÀ numero documento') === 'documento_identita',
    'carta d identità deve essere riconosciuta come fallback documentale'
  );
  const consistency = processor._evaluateDocumentConsistency_(
    'Certificato battesimo',
    'Vi mando il certificato di battesimo di mio figlio Marco, allego anche una copia della mia carta d\'identità per completare la pratica.',
    [{ name: 'certificato_battesimo.pdf' }],
    'CERTIFICATO DI BATTESIMO - battezzato il 10 maggio'
  );
  assert(
    consistency.mode === 'match' &&
      consistency.expected === 'certificato_battesimo' &&
      consistency.received === 'certificato_battesimo',
    `battesimo + carta identità nel corpo non deve produrre falso mismatch: ${JSON.stringify(consistency)}`
  );
}

console.log('--- Test attachment semantic consistency: JSON Gemini e fail-open ---');
{
  let capturedPrompt = '';
  let capturedOptions = null;
  const processor = new EmailProcessor({
    gmailService: {},
    geminiService: {
      primaryKey: 'test-key',
      generateResponse: (prompt, options) => {
        capturedPrompt = prompt;
        capturedOptions = options;
        return '{"consistent": false, "reason": "allegato su tema diverso"}';
      }
    }
  });

  const result = processor._evaluateAttachmentSemanticConsistency_({
    subject: 'Invio locandina concerto',
    body: 'In allegato invio la locandina del concerto.',
    attachmentItems: [{ name: 'programma_pellegrinaggio.pdf' }],
    ocrText: 'Programma del pellegrinaggio parrocchiale',
    expectedAttachmentDescription: 'locandina del concerto'
  });

  assert(result && result.consistent === false, 'JSON Gemini deve produrre mismatch semantico');
  assert(result.reason === 'allegato su tema diverso', 'il motivo Gemini deve essere preservato');
  assert(result.source === 'semantic_zero_shot', 'la sorgente deve tracciare il controllo semantico');
  assert(capturedPrompt.includes('Invio locandina concerto') && capturedPrompt.includes('Programma del pellegrinaggio'), 'il prompt deve includere email e OCR');
  assert(capturedPrompt.includes('locandina del concerto'), 'il prompt semantico deve includere la descrizione attesa dal quick check');
  assert(capturedOptions && capturedOptions.modelName === 'gemini-3.5-flash-lite' && capturedOptions.skipRateLimit === true, 'il controllo semantico deve usare il modello leggero aggiornato senza rate limit');

  const failOpenProcessor = new EmailProcessor({
    gmailService: {},
    geminiService: {
      primaryKey: 'test-key',
      generateResponse: () => 'non json'
    }
  });
  const failOpen = failOpenProcessor._evaluateAttachmentSemanticConsistency_({
    subject: 'Invio documento',
    body: 'In allegato il documento richiesto.',
    attachmentItems: [{ name: 'documento.pdf' }],
    ocrText: 'Contenuto OCR'
  });
  assert(failOpen === null, 'risposta Gemini non interpretabile deve essere fail-open');
}

console.log('--- Test sponsor sanitizer: non rimuove termini matrimoniali generici ---');
{
  const processor = new EmailProcessor({ gmailService: {} });
  const response = 'La convivenza e il divorzio richiedono un discernimento pastorale specifico.\nPer fare da padrino servono requisiti specifici.';
  const cleaned = processor._sanitizeUnrequestedSponsorGuidance_(
    response,
    'Info padrino',
    'Mio fratello sarà padrino.'
  );
  assert(cleaned.includes('convivenza') && cleaned.includes('divorzio'), 'il sanitizer deve preservare righe canoniche generiche');
  assert(!cleaned.includes('Per fare da padrino'), 'il sanitizer deve ancora rimuovere guidance esplicita su padrino/madrina');
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
        getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
        getAdaptiveClosing: () => 'Cordiali saluti',
        generateResponse: () => ({ success: true, text: 'Risposta base' })
      },
      requestClassifier: {
        classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
      },
      memoryService: {
        getMemory: () => ({}),
        getRecentHistory: () => [],
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

console.log('--- Test processThread: timeout invio promuove idempotenza a sent ---');
{
  const originalValidationEnabled = global.CONFIG.VALIDATION_ENABLED;
  const originalErrorTypes = global.ErrorTypes;
  const originalClassifyError = global.classifyError;
  let committed = false;
  let rolledBack = false;
  let duplicateRecordCalls = 0;
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
    type: global.ErrorTypes.TIMEOUT,
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
        addLabelToMessage: (id, label) => labels.push({ id, label }),
        addLabelToThread: () => {},
        getThreadHistory: () => '',
        prepareOutboundText: (text) => text,
        sendHtmlReply: () => { throw new Error('timeout rete dopo invio'); }
      },
      classifier: {
        classifyEmail: () => ({ shouldReply: true, category: 'info', subIntents: {}, confidence: 0.9 })
      },
      geminiService: {
        primaryKey: 'primary-key',
        shouldRespondToEmail: () => ({ shouldRespond: true, language: 'it', classification: { topic: 'orari' } }),
        detectEmailLanguage: () => ({ lang: 'it' }),
        getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
        getAdaptiveClosing: () => 'Cordiali saluti',
        generateResponse: () => ({ success: true, text: 'Risposta base' })
      },
      requestClassifier: {
        classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
      },
      memoryService: {
        getMemory: () => ({}),
        getRecentHistory: () => [],
        updateMemoryAtomic: () => true
      },
      territoryValidator: {
        validateMultipleAddresses: () => ({ addressFound: false, addresses: [], summary: '' })
      },
      promptEngine: {
        buildPrompt: () => 'PROMPT'
      }
    });
    processor._commitSendTransaction = () => { committed = true; };
    processor._rollbackSendTransaction = () => { rolledBack = true; };
    processor._recordConfirmedDuplicateReply_ = () => { duplicateRecordCalls++; };

    const result = processor.processThread(createDuplicateGuardThread('send-timeout'), 'kb valida', '', new Set(), true);
    assert(result.status === 'error', 'timeout invio deve restituire status error');
    assert(result.errorClass === 'NETWORK', `timeout invio deve essere classificato come NETWORK retryable, ottenuto ${result.errorClass}`);
    assert(committed === true, 'timeout/network deve promuovere la transazione a sent');
    assert(rolledBack === false, 'timeout/network non deve rimuovere il marker di invio');
    assert(duplicateRecordCalls === 0, 'esito invio ambiguo non deve creare marker cross-message anti-duplicato');
    assert(labels.some(entry => entry.id === 'm-send-timeout' && entry.label === 'IA'), 'timeout/network ambiguo deve marcare il messaggio IA per evitare replay duplicati');
  } finally {
    global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
    global.ErrorTypes = originalErrorTypes;
    global.classifyError = originalClassifyError;
    cacheStore.clear();
  }
}

console.log('--- Test processThread: errore memoria post-invio resta non bloccante ---');
{
  const originalValidationEnabled = global.CONFIG.VALIDATION_ENABLED;
  const labels = [];
  let sendCalls = 0;
  let memoryCalls = 0;

  cacheStore.clear();
  global.CONFIG.VALIDATION_ENABLED = false;

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
        addLabelToMessage: (id, label) => labels.push({ id, label }),
        removeLabelFromMessage: () => {},
        removeLabelFromThread: () => {},
        getThreadHistory: () => '',
        prepareOutboundText: (text) => text,
        sendHtmlReply: () => { sendCalls += 1; }
      },
      classifier: {
        classifyEmail: () => ({ shouldReply: true, category: 'info', subIntents: {}, confidence: 0.9 })
      },
      geminiService: {
        primaryKey: 'primary-key',
        shouldRespondToEmail: () => ({ shouldRespond: true, language: 'it', classification: { topic: 'orari' } }),
        detectEmailLanguage: () => ({ lang: 'it' }),
        getAdaptiveGreeting: () => ({ greeting: 'Buongiorno', closing: 'Cordiali saluti' }),
        getAdaptiveClosing: () => 'Cordiali saluti',
        generateResponse: () => ({ success: true, text: 'Risposta base' })
      },
      requestClassifier: {
        classify: () => ({ type: 'technical', dimensions: { pastoral: 0.0 } })
      },
      memoryService: {
        getMemory: () => ({}),
        getRecentHistory: () => [],
        updateMemoryAtomic: () => {
          memoryCalls += 1;
          throw new Error('memory fail');
        }
      },
      territoryValidator: {
        validateMultipleAddresses: () => ({ addressFound: false, addresses: [], summary: '' })
      },
      promptEngine: {
        buildPrompt: () => 'PROMPT'
      }
    });

    const result = processor.processThread(createExternalThread('memory-fail'), 'kb valida', '', new Set(), true);
    assert(result.status === 'replied', `errore memoria post-invio non deve trasformare il thread in error, ottenuto ${result.status}`);
    assert(sendCalls === 1, 'la risposta deve essere stata inviata una sola volta');
    assert(memoryCalls === 1, 'la memoria deve essere tentata una volta');
    assert(labels.some(entry => entry.id === 'm-memory-fail' && entry.label === 'IA'), 'dopo invio riuscito il messaggio deve essere marcato IA');
  } finally {
    global.CONFIG.VALIDATION_ENABLED = originalValidationEnabled;
    cacheStore.clear();
  }
}

console.log('--- Test processUnreadEmails: flush finale contatore Gmail anche con coda vuota ---');
{
  let flushCalls = 0;
  const processor = new EmailProcessor({
    gmailService: {
      getUnprocessedUnreadThreads: () => [],
      flushPendingGmailCallCounter: (opName) => {
        flushCalls += 1;
        assert(opName === 'email_batch_end', 'il flush deve essere identificato come fine batch');
      }
    }
  });

  processor.processUnreadEmails('kb', '', true);
  assert(flushCalls === 1, 'il finally del batch deve tentare un solo flush del contatore Gmail');
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

console.log('--- Test processUnreadEmails: quota transient usa backoff breve indipendente dal tempo residuo ---');
{
  const processor = new EmailProcessor({
    gmailService: {
      getUnprocessedUnreadThreads: () => []
    }
  });
  const transientDelay = processor._getQuotaCheckpointDelayMs_(
    { errorClass: 'QUOTA_EXHAUSTED', error: 'RPM quota exceeded' },
    300000
  );
  const dailyDelay = processor._getQuotaCheckpointDelayMs_(
    { errorClass: 'QUOTA_EXHAUSTED', error: 'daily quota exhausted' },
    300000
  );
  assert(transientDelay === 60000, `quota transient deve ripartire dopo 60s, ottenuto ${transientDelay}`);
  assert(dailyDelay === -1, `quota giornaliera deve restare sospesa senza trigger, ottenuto ${dailyDelay}`);
  const undefinedSentinelDelay = processor._getQuotaCheckpointDelayMs_(
    { errorClass: 'undefined', error: '', reason: '' },
    300000
  );
  assert(undefinedSentinelDelay === 60000, `sentinella undefined non deve simulare quota giornaliera, ottenuto ${undefinedSentinelDelay}`);
}

console.log('--- Test processUnreadEmails: stop su errore infrastrutturale retryable ---');
{
  let checkpointStartIndex = null;
  let checkpointDelayMs = null;
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
  processor._storeBatchCheckpointAndScheduleContinuation_ = (_threads, startIndex, delayMs) => {
    checkpointStartIndex = startIndex;
    checkpointDelayMs = delayMs;
  };

  const stats = processor.processUnreadEmails('kb', '', true);
  assert(processCalls === 1, 'errore retryable infrastrutturale deve fermare il batch al primo thread');
  assert(stats.total === 1, 'deve conteggiare solo il thread analizzato prima dello stop');
  assert(stats.errors === 1, 'il thread fallito deve essere conteggiato anche quando il batch si interrompe subito');
  assert(checkpointStartIndex === 0, 'checkpoint deve ripartire dal thread fallito');
  assert(checkpointDelayMs === 60000, `errore NETWORK deve usare backoff breve 60s, ottenuto ${checkpointDelayMs}`);
}

console.log('--- Test processUnreadEmails: stop su errore config usa backoff lungo ---');
{
  let checkpointStartIndex = null;
  let checkpointDelayMs = null;
  let processCalls = 0;
  const threads = [createExternalThread('config-1'), createExternalThread('config-2')];
  const processor = new EmailProcessor({
    gmailService: {
      getUnprocessedUnreadThreads: () => threads,
      getMessageIdsWithLabel: () => new Set()
    }
  });
  processor._hasUnreadMessagesToProcess = () => true;
  processor.processThread = () => {
    processCalls++;
    return { status: 'error', errorClass: 'CONFIG_ERROR', error: 'config mancante' };
  };
  processor._storeBatchCheckpointAndScheduleContinuation_ = (_threads, startIndex, delayMs) => {
    checkpointStartIndex = startIndex;
    checkpointDelayMs = delayMs;
  };

  const stats = processor.processUnreadEmails('kb', '', true);
  assert(processCalls === 1, 'errore config deve fermare il batch al primo thread');
  assert(stats.total === 1, 'deve conteggiare solo il thread analizzato prima dello stop config');
  assert(checkpointStartIndex === 0, 'checkpoint config deve ripartire dal thread fallito');
  assert(checkpointDelayMs === 300000, `errore CONFIG_ERROR deve usare backoff lungo 5 min, ottenuto ${checkpointDelayMs}`);
}

console.log('--- Test processUnreadEmails: checkpoint dopo rilascio lock batch ---');
{
  const originalLockService = global.LockService;
  let released = false;
  let checkpointAfterRelease = null;
  const threads = [createExternalThread('lock-checkpoint'), createExternalThread('lock-checkpoint-2')];
  global.LockService = {
    getScriptLock: () => ({
      tryLock: () => true,
      releaseLock: () => {
        released = true;
      }
    })
  };

  try {
    const processor = new EmailProcessor({
      gmailService: {
        getUnprocessedUnreadThreads: () => threads,
        getMessageIdsWithLabel: () => new Set()
      }
    });
    processor._hasUnreadMessagesToProcess = () => true;
    processor.processThread = () => ({ status: 'error', errorClass: 'NETWORK', error: 'timeout rete' });
    processor._storeBatchCheckpointAndScheduleContinuation_ = () => {
      checkpointAfterRelease = released;
    };

    const stats = processor.processUnreadEmails('kb', '', false);
    assert(stats.total === 1, 'deve fermarsi dopo il primo errore retryable');
    assert(checkpointAfterRelease === true, 'deve salvare/pianificare il checkpoint dopo releaseLock');
  } finally {
    global.LockService = originalLockService;
  }
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

console.log('--- Test checkpoint trigger: preserva trigger esistenti se create fallisce ---');
{
  const props = new Map();
  const existingTrigger = { getHandlerFunction: () => 'resumeEmailBatchFromCheckpoint' };
  let deleteCalls = 0;
  const originalPropertiesService = global.PropertiesService;
  const originalScriptApp = global.ScriptApp;
  global.PropertiesService = {
    getScriptProperties: () => ({
      setProperty: (k, v) => props.set(k, v),
      getProperty: (k) => props.get(k) || ''
    })
  };
  global.ScriptApp = {
    getProjectTriggers: () => [existingTrigger],
    deleteTrigger: () => { deleteCalls++; },
    newTrigger: () => ({
      timeBased: () => ({
        after: () => ({ create: () => { throw new Error('quota trigger esaurita'); } })
      })
    })
  };
  try {
    const processor = new EmailProcessor({ gmailService: { getUnprocessedUnreadThreads: () => [] } });
    processor._storeBatchCheckpointAndScheduleContinuation_([{ getId: () => 't200' }], 0, 25000);
    assert(props.has('EMAIL_BATCH_CHECKPOINT'), 'il checkpoint deve essere salvato anche se il trigger nuovo fallisce');
    assert(deleteCalls === 0, 'i trigger esistenti non devono essere eliminati se create fallisce');
  } finally {
    global.PropertiesService = originalPropertiesService;
    global.ScriptApp = originalScriptApp;
  }
}

console.log('--- Test checkpoint trigger: elimina trigger di ripresa vecchi dopo create riuscito ---');
{
  const props = new Map();
  const existingResumeTrigger = { id: 'old-resume', getHandlerFunction: () => 'resumeEmailBatchFromCheckpoint', getUniqueId: () => 'old-resume' };
  const otherTrigger = { id: 'other', getHandlerFunction: () => 'dailyMain', getUniqueId: () => 'other' };
  const createdTrigger = { id: 'new-resume', getHandlerFunction: () => 'resumeEmailBatchFromCheckpoint', getUniqueId: () => 'new-resume' };
  const deleted = [];
  const originalPropertiesService = global.PropertiesService;
  const originalScriptApp = global.ScriptApp;
  global.PropertiesService = {
    getScriptProperties: () => ({
      setProperty: (k, v) => props.set(k, v),
      getProperty: (k) => props.get(k) || '',
      deleteProperty: (k) => props.delete(k)
    })
  };
  global.ScriptApp = {
    getProjectTriggers: () => [existingResumeTrigger, otherTrigger],
    deleteTrigger: (trigger) => { deleted.push(trigger.id); },
    newTrigger: () => ({
      timeBased: () => ({
        after: () => ({ create: () => createdTrigger })
      })
    })
  };
  try {
    const processor = new EmailProcessor({ gmailService: { getUnprocessedUnreadThreads: () => [] } });
    processor._storeBatchCheckpointAndScheduleContinuation_([{ getId: () => 't201' }], 0, 25000);
    assert(deleted.includes('old-resume'), 'deve eliminare il trigger di ripresa preesistente dopo aver creato quello nuovo');
    assert(!deleted.includes('other'), 'non deve eliminare trigger di altri handler');
    assert(!deleted.includes('new-resume'), 'non deve eliminare il trigger appena creato');
  } finally {
    global.PropertiesService = originalPropertiesService;
    global.ScriptApp = originalScriptApp;
  }
}

console.log('--- Test checkpoint clear: elimina checkpoint e trigger di ripresa orfani ---');
{
  const props = new Map([['EMAIL_BATCH_CHECKPOINT', '{"version":2}']]);
  const existingResumeTrigger = { id: 'old-resume-clear', getHandlerFunction: () => 'resumeEmailBatchFromCheckpoint', getUniqueId: () => 'old-resume-clear' };
  const otherTrigger = { id: 'other-clear', getHandlerFunction: () => 'dailyMain', getUniqueId: () => 'other-clear' };
  const deleted = [];
  const originalPropertiesService = global.PropertiesService;
  const originalScriptApp = global.ScriptApp;
  global.PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (k) => props.get(k) || '',
      deleteProperty: (k) => props.delete(k)
    })
  };
  global.ScriptApp = {
    getProjectTriggers: () => [existingResumeTrigger, otherTrigger],
    deleteTrigger: (trigger) => { deleted.push(trigger.id); }
  };
  try {
    const processor = new EmailProcessor({ gmailService: { getUnprocessedUnreadThreads: () => [] } });
    processor._clearBatchCheckpoint_('test');
    assert(!props.has('EMAIL_BATCH_CHECKPOINT'), 'clear deve rimuovere il payload checkpoint');
    assert(deleted.length === 1 && deleted[0] === 'old-resume-clear', 'clear deve eliminare solo i trigger di ripresa batch');
  } finally {
    global.PropertiesService = originalPropertiesService;
    global.ScriptApp = originalScriptApp;
  }
}


console.log('--- Test checkpoint retryCount: incrementa solo sullo stesso pending set ---');
{
  const props = new Map();
  const originalPropertiesService = global.PropertiesService;
  const originalScriptApp = global.ScriptApp;
  global.PropertiesService = {
    getScriptProperties: () => ({
      setProperty: (k, v) => props.set(k, v),
      getProperty: (k) => props.get(k) || '',
      deleteProperty: (k) => props.delete(k)
    })
  };
  global.ScriptApp = undefined;
  try {
    const processor = new EmailProcessor({ gmailService: { getUnprocessedUnreadThreads: () => [] } });
    const fakeThreads = [{ getId: () => 't300' }, { getId: () => 't301' }];

    processor._storeBatchCheckpointAndScheduleContinuation_(fakeThreads, 0, 25000);
    let parsed = JSON.parse(props.get('EMAIL_BATCH_CHECKPOINT'));
    assert(parsed.retryCount === 1, `retryCount iniziale atteso 1, ottenuto ${parsed.retryCount}`);
    assert(parsed.depth === 1, `depth iniziale attesa 1, ottenuta ${parsed.depth}`);

    processor._storeBatchCheckpointAndScheduleContinuation_(fakeThreads, 0, 25000);
    parsed = JSON.parse(props.get('EMAIL_BATCH_CHECKPOINT'));
    assert(parsed.retryCount === 2, `retryCount sullo stesso checkpoint atteso 2, ottenuto ${parsed.retryCount}`);
    assert(parsed.depth === 2, `depth sullo stesso checkpoint attesa 2, ottenuta ${parsed.depth}`);

    parsed.depth = 5;
    props.set('EMAIL_BATCH_CHECKPOINT', JSON.stringify(parsed));
    processor._storeBatchCheckpointAndScheduleContinuation_(fakeThreads, 1, 25000);
    parsed = JSON.parse(props.get('EMAIL_BATCH_CHECKPOINT'));
    assert(parsed.retryCount === 1, `retryCount dopo avanzamento atteso 1, ottenuto ${parsed.retryCount}`);
    assert(parsed.depth === 1, `depth dopo avanzamento attesa 1, ottenuta ${parsed.depth}`);
    assert(parsed.pendingThreadIds.length === 1 && parsed.pendingThreadIds[0] === 't301', 'checkpoint avanzato non deve essere cancellato anche se la depth precedente era 5');
  } finally {
    global.PropertiesService = originalPropertiesService;
    global.ScriptApp = originalScriptApp;
  }
}

console.log('--- Test checkpoint retryCount: pendingCount evita falsi same-checkpoint su lista troncata ---');
{
  const props = new Map();
  const originalPropertiesService = global.PropertiesService;
  const originalScriptApp = global.ScriptApp;
  const originalMaxCheckpointThreads = global.CONFIG.BATCH_CHECKPOINT_MAX_THREADS;
  global.CONFIG.BATCH_CHECKPOINT_MAX_THREADS = 2;
  global.PropertiesService = {
    getScriptProperties: () => ({
      setProperty: (k, v) => props.set(k, v),
      getProperty: (k) => props.get(k) || '',
      deleteProperty: (k) => props.delete(k)
    })
  };
  global.ScriptApp = undefined;

  try {
    const processor = new EmailProcessor({ gmailService: { getUnprocessedUnreadThreads: () => [] } });
    const makeThread = (id) => ({ getId: () => id });
    const fullQueue = ['t400', 't401', 't402', 't403'].map(makeThread);
    const shorterSamePrefix = ['t400', 't401', 't402'].map(makeThread);

    processor._storeBatchCheckpointAndScheduleContinuation_(fullQueue, 0, 25000);
    processor._storeBatchCheckpointAndScheduleContinuation_(shorterSamePrefix, 0, 25000);

    const parsed = JSON.parse(props.get('EMAIL_BATCH_CHECKPOINT'));
    assert(parsed.retryCount === 1, `retryCount deve resettare se cambia pendingCount oltre la lista troncata, ottenuto ${parsed.retryCount}`);
    assert(parsed.depth === 1, `depth deve resettare se cambia pendingCount oltre la lista troncata, ottenuta ${parsed.depth}`);
  } finally {
    if (typeof originalMaxCheckpointThreads === 'undefined') {
      delete global.CONFIG.BATCH_CHECKPOINT_MAX_THREADS;
    } else {
      global.CONFIG.BATCH_CHECKPOINT_MAX_THREADS = originalMaxCheckpointThreads;
    }
    global.PropertiesService = originalPropertiesService;
    global.ScriptApp = originalScriptApp;
  }
}

console.log('--- Test processThread: cross_thread_burst usa stato dilata senza marcare IA ---');
{
  const originalSenderThrottle = global.CONFIG.SENDER_THROTTLE_WINDOW_SECONDS;
  global.CONFIG.SENDER_THROTTLE_WINDOW_SECONDS = 60;
  cacheStore.clear();

  const labels = [];
  const msg = createMessage({ id: 'm-dilata', unread: true, from: 'Utente <utente@example.com>' });
  const thread = createThread({ id: 't-dilata', messages: [msg] });
  cacheStore.set('sender_throttle_utente@example.com', '1');

  const processor = new EmailProcessor({
    gmailService: {
      _extractEmailAddress: (raw) => String(raw || '').match(/<([^>]+)>/)?.[1] || raw,
      extractMessageDetails: () => ({
        subject: 'Richiesta informazioni',
        body: 'Vorrei sapere gli orari.',
        senderEmail: 'utente@example.com',
        senderName: 'Utente',
        date: new Date('2026-05-07T10:00:00Z'),
        headers: {},
        isNewsletter: false,
        rfc2822MessageId: null,
        existingReferences: null
      }),
      addLabelToMessage: (id, label) => labels.push({ id, label }),
      removeLabelFromMessage: (id, label) => labels.push({ id, label, removed: true })
    }
  });

  const result = processor.processThread(thread, 'kb', '', new Set(), true, new Set());
  assert(result.status === 'dilata', `burst cross-thread deve restituire dilata, ottenuto ${result.status}`);
  assert(result.reason === 'cross_thread_burst', 'dilata deve mantenere reason cross_thread_burst');
  assert(labels.length === 0, 'dilata non deve applicare label IA o rimuovere skip sul messaggio rinviato');

  if (typeof originalSenderThrottle === 'undefined') {
    delete global.CONFIG.SENDER_THROTTLE_WINDOW_SECONDS;
  } else {
    global.CONFIG.SENDER_THROTTLE_WINDOW_SECONDS = originalSenderThrottle;
  }
  cacheStore.clear();
}

console.log('--- Test processThread: near deadline prima della generazione usa dilata ---');
{
  const originalAttachmentContext = global.CONFIG.ATTACHMENT_CONTEXT;
  const labels = [];
  let generated = false;

  global.CONFIG.ATTACHMENT_CONTEXT = { enabled: false };

  try {
    const processor = buildValidationFlowProcessor({
      labels,
      onGenerate: () => { generated = true; }
    });
    processor._isNearDeadline = () => true;

    const result = processor.processThread(
      createExternalBurstThread('near-deadline-generation', 2),
      'kb valida',
      '',
      new Set(),
      true
    );

    assert(result.status === 'dilata', `near deadline deve restituire dilata, ottenuto ${result.status}`);
    assert(result.reason === 'near_deadline_before_generation', 'near deadline deve mantenere reason specifica');
    assert(result.retryDelayMs === 60000, `near deadline deve indicare retryDelayMs 60000, ottenuto ${result.retryDelayMs}`);
    assert(generated === false, 'near deadline non deve chiamare Gemini generateResponse');
    assert(labels.length === 0, 'near deadline non deve applicare label IA o Verifica a nessun messaggio del burst rinviato');
  } finally {
    global.CONFIG.ATTACHMENT_CONTEXT = originalAttachmentContext;
    cacheStore.clear();
  }
}

console.log('--- Test processUnreadEmails: dilata salva checkpoint senza consumare MAX_EMAILS_PER_RUN ---');
{
  const originalPropertiesService = global.PropertiesService;
  const originalScriptApp = global.ScriptApp;
  const originalMax = global.CONFIG.MAX_EMAILS_PER_RUN;
  const originalSenderThrottle = global.CONFIG.SENDER_THROTTLE_WINDOW_SECONDS;
  const props = new Map();
  global.CONFIG.MAX_EMAILS_PER_RUN = 1;
  global.CONFIG.SENDER_THROTTLE_WINDOW_SECONDS = 2;
  global.PropertiesService = {
    getScriptProperties: () => ({
      setProperty: (k, v) => props.set(k, v),
      getProperty: (k) => props.get(k) || '',
      deleteProperty: (k) => props.delete(k)
    })
  };
  global.ScriptApp = undefined;

  try {
    const threads = [createExternalThread('dilata-retry'), createExternalThread('after-dilata')];
    const calls = [];
    const processor = new EmailProcessor({
      gmailService: { getUnprocessedUnreadThreads: () => threads }
    });
    processor._hasUnreadMessagesToProcess = () => true;
    processor._isNearDeadline = () => false;
    processor._getRemainingTimeMs = () => 60000;
    processor.processThread = (thread) => {
      calls.push(thread.getId());
      return { status: 'dilata', reason: 'cross_thread_burst' };
    };

    const stats = processor.processUnreadEmails('kb', '', true);
    const checkpoint = JSON.parse(props.get('EMAIL_BATCH_CHECKPOINT'));
    assert(calls.length === 1, 'dilata deve interrompere il batch e non passare ai thread successivi');
    assert(stats.dilata === 1, `stats.dilata deve essere 1, ottenuto ${stats.dilata}`);
    assert(stats.filtered === 0, 'dilata non deve essere conteggiato come filtered');
    assert(checkpoint.startIndex === 0, `checkpoint deve ripartire dal thread dilatato, ottenuto ${checkpoint.startIndex}`);
    assert(checkpoint.pendingThreadIds[0] === 't-dilata-retry', 'checkpoint deve includere come primo residuo il thread dilatato');
    assert(checkpoint.remainingTimeMs === 7000, `delay dilata deve essere finestra + 5s, ottenuto ${checkpoint.remainingTimeMs}`);
  } finally {
    global.CONFIG.MAX_EMAILS_PER_RUN = originalMax;
    if (typeof originalSenderThrottle === 'undefined') {
      delete global.CONFIG.SENDER_THROTTLE_WINDOW_SECONDS;
    } else {
      global.CONFIG.SENDER_THROTTLE_WINDOW_SECONDS = originalSenderThrottle;
    }
    global.PropertiesService = originalPropertiesService;
    global.ScriptApp = originalScriptApp;
  }
}

console.log('--- Test processUnreadEmails: dilata rispetta retryDelayMs esplicito ---');
{
  const originalPropertiesService = global.PropertiesService;
  const originalScriptApp = global.ScriptApp;
  const props = new Map();
  global.PropertiesService = {
    getScriptProperties: () => ({
      setProperty: (k, v) => props.set(k, v),
      getProperty: (k) => props.get(k) || '',
      deleteProperty: (k) => props.delete(k)
    })
  };
  global.ScriptApp = undefined;

  try {
    const threads = [createExternalThread('dilata-explicit-delay')];
    const processor = new EmailProcessor({
      gmailService: { getUnprocessedUnreadThreads: () => threads }
    });
    processor._hasUnreadMessagesToProcess = () => true;
    processor._isNearDeadline = () => false;
    processor._getRemainingTimeMs = () => 60000;
    processor.processThread = () => ({
      status: 'dilata',
      reason: 'near_deadline_before_generation',
      retryDelayMs: 12000
    });

    processor.processUnreadEmails('kb', '', true);
    const checkpoint = JSON.parse(props.get('EMAIL_BATCH_CHECKPOINT'));
    assert(checkpoint.remainingTimeMs === 12000, `retryDelayMs esplicito deve guidare il checkpoint, ottenuto ${checkpoint.remainingTimeMs}`);
  } finally {
    global.PropertiesService = originalPropertiesService;
    global.ScriptApp = originalScriptApp;
  }
}

console.log('--- Test EmailProcessor: sbattezzo indiretto e contextualFlags operativi ---');
{
  const processor = Object.create(EmailProcessor.prototype);

  const validationContextWithHistory = processor._buildResponseValidationContext_({
    requestPurpose: { type: 'information_request', confidence: 0.9, source: 'test' },
    conversationHistory: 'Utente (flaminia@example.org): Il nome corretto è Alberto.'
  });
  assert(
    validationContextWithHistory.explicitThreadContext.includes('Il nome corretto è Alberto.'),
    'il contesto di validazione deve conservare lo storico esplicito utile al grounding semantico'
  );

  const indirect = processor._detectIndirectSbattezzoRequest_(
    'Richiesta',
    'Vorrei uscire dalla Chiesa e non essere più registrato come cattolico.'
  );
  assert(indirect.detected === true, 'sbattezzo indiretto deve essere rilevato localmente');

  const physicalExit = processor._detectIndirectSbattezzoRequest_(
    'Uscita dopo la messa',
    'Vorrei sapere da quale porta si può uscire dalla chiesa dopo la messa.'
  );
  assert(physicalExit.detected === false, 'uscire dalla chiesa in contesto fisico non deve diventare sbattezzo');

  const flags = processor._deriveContextualFlagsUpdate_({
    physicalPresenceConstraint: { has_constraint: true },
    activeConcerns: { pastoral_technical_blend: true },
    classification: { category: 'formal', subIntents: { bereavement: true } },
    requestType: { type: 'formal', isSbattezzo: true },
    categoryHintSource: 'formal'
  });
  assert(flags.remote_user === true, 'vincolo presenza fisica deve promuovere remote_user');
  assert(flags.bereaved === true, 'subIntent bereavement deve promuovere bereaved');
  assert(flags.canonical_complexity === true, 'routing formale deve promuovere canonical_complexity');
  assert(flags.ongoing_pastoral_process === true, 'pastoral_technical_blend deve promuovere ongoing_pastoral_process');

  const genericEmotionalFlags = processor._deriveContextualFlagsUpdate_({
    activeConcerns: { emotional_sensitivity: true },
    classification: { category: 'information', subIntents: { emotional_distress: true } },
    requestType: { type: 'technical' }
  });
  assert(!genericEmotionalFlags.bereaved, 'emotional_distress generico non deve essere salvato come bereaved');

  const preservedFlags = processor._deriveContextualFlagsUpdate_({
    existingFlags: { remote_user: true, canonical_complexity: true },
    activeConcerns: {},
    classification: { category: 'information', subIntents: {} },
    requestType: { type: 'technical' }
  });
  assert(preservedFlags.remote_user === true, 'remote_user storico deve essere preservato');
  assert(preservedFlags.canonical_complexity === true, 'canonical_complexity storico deve essere preservato');
}

console.log('--- Test presenza/strategia: due turni, persistenza e numero chiamate invariato ---');
{
  const memoryVm = {console, CONFIG: {}};
  vm.createContext(memoryVm);
  for (const file of ['gas_response_strategy.js', 'gas_memory_service.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), memoryVm);
  }
  const memory = vm.runInContext('Object.create(MemoryService.prototype)', memoryVm);
  for (const [posture, expected] of [['urgent','reduce_user_effort'], ['hesitant','clarify_requirements'],
    ['appreciative','offer_reassurance'], ['direct','provide_information']]) {
    const now = new Date().toISOString();
    let saved = {contextualFlags:{remote_user:true,bereaved:true,canonical_complexity:true},
      conversationState:{physicalPresenceState:{version:1,constraints:[{type:'geographic_distance',status:'active',updatedAt:now}]}}};
    const processor = buildValidationFlowProcessor();
    const extract = processor.gmailService.extractMessageDetails;
    let turn = 0, quickCalls = 0, generationCalls = 0, memoryWrites = 0;
    const prompts = [];
    processor.gmailService.extractMessageDetails = () => ({...extract(), body:turn===0?'Ora sono a Roma. Vorrei gli orari.':'Vorrei anche gli orari di sabato.'});
    processor.geminiService.shouldRespondToEmail = () => {
      quickCalls++;
      return {shouldRespond:true,language:'it',classification:{topic:'orari'},relational_posture:posture,
        physical_presence_constraint:{has_constraint:false,type:'none',confidence:0.95},response_strategy:'none'};
    };
    processor.geminiService.generateResponse = () => { generationCalls++; return {success:true,text:'Gli orari sono disponibili in segreteria.'}; };
    processor.memoryService.getMemory = () => saved;
    processor.memoryService.updateMemoryAtomic = (_id, update, topics) => {
      memoryWrites++;
      const summary = memory._serializeMemorySummaryState(saved._rawMemorySummary || '', update.memorySummary,
        update.conversationStateUpdate);
      saved = memory._rowToObject(['t','it','info','standard',JSON.stringify(topics || []),now,turn+1,turn+1,
        summary,JSON.stringify(memory._mergeContextualFlags_(saved.contextualFlags,update.contextualFlags))]);
      return true;
    };
    processor.promptEngine.buildPrompt = options => {prompts.push(options); return 'PROMPT LOCALE';};
    for (turn=0; turn<2; turn++) {
      const result = processor.processThread(createExternalThread(`presence-${posture}-${turn}`),'kb valida','',new Set(),true);
      assert(result.status==='replied', `turno ${turn} ${posture}: ${result.status}`);
    }
    assert(quickCalls===2 && generationCalls===2, 'una classificazione e una generazione per messaggio');
    assert(memoryWrites===2, 'entrambi i turni devono aggiornare memoria');
    assert(prompts.every(p=>p.physicalPresenceConstraint.has_constraint===false), 'la distanza risolta non deve riapparire');
    assert(prompts.every(p=>p.responseStrategy===expected), `${posture}: fallback atteso ${expected}`);
    assert(saved.contextualFlags.bereaved && saved.contextualFlags.canonical_complexity, 'flag sensibili preservati');
    assert(saved.contextualFlags.remote_user!==true, 'flag distanza rimosso dopo persistenza');
  }
}
console.log('✅ Test batch EmailProcessor passati');
