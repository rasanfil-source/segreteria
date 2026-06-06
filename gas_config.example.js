/**
 * Config.example.js - Configurazione centralizzata del sistema
 * Tutti i parametri configurabili sono definiti qui
 * NOTA: esempio sanificato per repository. Valori sensibili e alias reali vanno in Script Properties.
 */

var _SCRIPT_PROPERTIES = null;
var _CACHED_PROPS = {};
// Cache solo intra-esecuzione: riduce letture ripetute a PropertiesService
// durante la stessa run GAS; non e' pensata come persistenza fra trigger.
var _SCRIPT_PROPERTY_CACHE_TTL_MS = 60 * 1000;
function _getScriptProperty(key, forceRefresh = false) {
  if (!_SCRIPT_PROPERTIES) {
    _SCRIPT_PROPERTIES = PropertiesService.getScriptProperties();
  }
  const now = Date.now();
  const cached = _CACHED_PROPS[key];
  const hasFreshCachedValue = cached &&
    typeof cached === 'object' &&
    Object.prototype.hasOwnProperty.call(cached, 'value') &&
    Number.isFinite(cached.ts) &&
    (now - cached.ts) <= _SCRIPT_PROPERTY_CACHE_TTL_MS;
  if (forceRefresh) {
    delete _CACHED_PROPS[key];
  }
  if (forceRefresh || !hasFreshCachedValue) {
    _CACHED_PROPS[key] = {
      value: _SCRIPT_PROPERTIES.getProperty(key),
      ts: now
    };
  }
  return _CACHED_PROPS[key].value;
}

function _getScriptPropertyStringArray(key, fallback) {
  const safeFallback = Array.isArray(fallback) ? fallback.slice() : [];
  let raw = '';
  try {
    raw = (typeof PropertiesService !== 'undefined' && PropertiesService && typeof PropertiesService.getScriptProperties === 'function')
      ? _getScriptProperty(key)
      : '';
  } catch (e) {
    raw = '';
  }
  if (!raw) return safeFallback;

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .map(value => String(value || '').trim())
        .filter(Boolean);
    }
  } catch (e) {
    // Non JSON: accettiamo liste separate da virgola, punto e virgola o newline.
  }

  const normalized = String(raw).replace(/\r\n?/g, '\n');
  const hasStructuredSeparators = /[\n;]/.test(normalized);
  return normalized
    .split(hasStructuredSeparators ? /[\n;]/ : /,/)
    .map(value => value.trim())
    .filter(Boolean);
}

var CONFIG = {
  // === API ===
  get GEMINI_API_KEY() { return _getScriptProperty('GEMINI_API_KEY'); },
  MODEL_NAME: 'gemini-3.5-flash',

  // === Generazione ===
  MAX_OUTPUT_TOKENS: 6000,
  PAPAL_CONTEXT: {
    currentName: 'Leone XIV',
    previousName: 'Papa Francesco',
    currentSince: '2025-05-08',
    ministryStart: '2025-05-18'
  },

  // === Validazione ===
  VALIDATION_ENABLED: true,
  VALIDATION_MIN_SCORE: 0.6,
  VALIDATION_WARNING_THRESHOLD: 0.9,  // Soglia warning sotto cui aggiungere etichetta Verifica
  VALIDATION_REVIEW_ALERTS: {
    enabled: true,
    cooldownSeconds: 3600,
    recipientProperty: 'VALIDATION_REVIEW_EMAIL',
    get email() { return _getScriptProperty('VALIDATION_REVIEW_EMAIL') || ''; }
  },
  SEMANTIC_VALIDATION: {
    enabled: true,
    activationThreshold: 0.9,
    cacheEnabled: true,
    cacheTTL: 300,
    taskType: 'semantic',
    maxRetries: 1,
    fallbackOnError: true
  },
  // === Riprova Intelligente Post-Validazione ===
  INTELLIGENT_RETRY: {
    enabled: true,           // Abilita retry LLM su errori strutturali
    maxRetries: 1,           // Limite di esecuzione per sessione GAS
    minScoreToTrigger: 0.6,  // Soglia minima score per considerare retry non critici
    onlyForErrors: [         // Tipi di errore che giustificano una chiamata LLM
      'thinking_leak',
      'hallucination',
      'language',
      'placeholder',
      'length',
      'temporal'
    ]
  },

  // === Gmail ===
  LABEL_NAME: 'IA',                    // Label per email processate
  ERROR_LABEL_NAME: 'Errore',          // Label per errori
  VALIDATION_ERROR_LABEL: 'Verifica',  // Label per risposte da rivedere
  SKIP_LABEL_NAME: '·',              // Label per email italiane saltate in modalità foreign_only
  DOCUMENT_CONSISTENCY_CHECK_ENABLED: true, // Abilita verifica coerenza tra email e allegati
  // Configurazione dei limiti operativi per garantire stabilità e rispetto delle quote.
  MAX_EMAILS_PER_RUN: 2,
  SAFETY_VALVE_THRESHOLD: 0.8,       // Regolazione batch in base al carico operativo RPD
  MAX_CONSECUTIVE_EXTERNAL: 5,        // Soglia per rilevamento email loop
  EMPTY_INBOX_WARNING_THRESHOLD: 5,   // Soglia per warning inbox vuota
  SUSPENSION_STALE_UNREAD_HOURS: 12,    // Garanzia di elaborazione dei messaggi non letti persistenti
  STRICT_SUSPENSION_CONFIG: false,    // Se true: foglio Controllo presente ma senza fasce valide => errore configurazione (no fallback statico)
  MIN_REMAINING_TIME_MS: 90000,      // Margine di sicurezza temporale per la sessione
  EXECUTION_LOCK_WAIT_MS: 1000,      // Timeout acquisizione lock esecuzione (ms)
  SEARCH_PAGE_SIZE: 15,              // Buffer discovery per candidati message-level (≈ 5x MAX_EMAILS_PER_RUN)
  SENDER_THROTTLE_WINDOW_SECONDS: 60, // Previene burst simultanei su thread diversi dallo stesso sender
  // === DISCOVERY MODE ======================================================================
  // Modalità di scoperta messaggi non letti da elaborare.
  // - 'metadata': default operativo message-level (list INBOX/UNREAD + blacklist ID in RAM)
  // - 'query'   : compatibilità legacy via GmailApp.search('is:unread in:inbox')
  // Mantieni l'esempio allineato a gas_config.js per evitare divergenze tra test e produzione.
  MESSAGE_DISCOVERY_MODE: 'metadata',
  // =========================================================================================
  MAX_EXECUTION_TIME_MS: 280000,    // Tempo massimo stimato per singola esecuzione GAS
  GMAIL_LABEL_CACHE_TTL: 21600000,     // 6 ore in millisecondi
  MAX_HISTORY_MESSAGES: 8,             // Massimo messaggi in cronologia thread (ricalibrato)
  ATTACHMENT_CONTEXT: {
    enabled: true,                   // Includi testo allegati (PDF, immagini, Word, Excel, PowerPoint) nel prompt
    maxFiles: 3,                     // Numero massimo di allegati da processare
    maxBytesPerFile: 3 * 1024 * 1024,// 3 MB per file
    maxCharsPerFile: 3000,           // Limite testo per singolo allegato
    maxTotalChars: 9000,             // Limite totale testo allegati
    ocrLanguage: 'it',               // Lingua OCR (Drive Advanced API)
    ocrConfidenceWarningThreshold: 0.8, // Soglia warning leggibilità OCR in risposta
    pdfMaxPages: 2,                  // Limite pagine PDF (stima via OCR)
    pdfCharsPerPage: 1800,           // Stima caratteri per pagina PDF
    ocrTriggerKeywords: [            // Attiva OCR solo se il contenuto è rilevante
      'iban', 'bonifico', 'ricevuta', 'documento',
      'allego', 'in allegato', 'coordinate', 'modulo'
    ],
    ibanFocusEnabled: true,          // Focus OCR se viene trovato un IBAN
    ibanContextChars: 300,           // Finestra +/- per testo attorno all'IBAN
    maxCharsWhenKbTruncated: 1500    // Riduzione allegati se KB è troncata
  },
  OCR_ORPHAN_MAX_AGE_HOURS: 6,       // Età massima file OCR temporanei prima del cleanup
  OCR_CLEANUP_MAX_RUNTIME_MS: 8000,   // File di pulizia con durata limitata OCR orfani

  // === Token per tipo allegato (stima multimodale per budget prompt) ===
  ATTACHMENT_TOKEN_ESTIMATE: {
    image: 258,          // Token stimati per immagine (Gemini Vision)
    pdf: 1032,           // Token stimati per PDF
    defaultDoc: 1032     // Token stimati per altri documenti
  },

  // === Cache e Lock ===
  CACHE_MAX_BYTES: 90 * 1024,          // Margine sotto 100KB/entry CacheService per ridurre quota exceeded
  CACHE_LOCK_TTL: 310,                 // Secondi (>= MAX_EXECUTION_TIME_MS/1000 con margine)
  CACHE_RACE_SLEEP_MS: 200,             // Attesa anti-race condition
  DEBUG: false,                        // Abilita log verbose (console.log); in produzione tenerlo false
  GMAIL_DAILY_CALL_LIMIT: 18000,       // Soft limit locale anti-burst prima del limite Gmail reale
  GMAIL_METADATA_FALLBACK_MAX_PER_THREAD: 25, // Max messages.get recenti per thread quando GmailApp.isUnread e incoerente
  GMAIL_METADATA_DISCOVERY_MAX_GETS: 120, // Max messages.get per run di fallback discovery message-level
  GMAIL_LIST_MAX_PAGES: 20,            // Limite pagine Gmail list per bootstrap label cache
  GMAIL_LIST_MAX_MESSAGES: 2000,       // Limite messaggi Gmail list per bootstrap label cache
  GMAIL_LIST_MAX_RUNTIME_MS: 50000,     // Budget tempo bootstrap label cache per evitare timeout GAS
  GMAIL_LABEL_LOOKBACK_DAYS: 0,         // 0 = nessuna finestra temporale nel pre-caricamento label
  BATCH_CHECKPOINT_TTL_MS: 10 * 60 * 1000, // Scadenza checkpoint resume (10 minuti)
  BATCH_CHECKPOINT_MAX_RETRIES: 3,      // Tentativi di ripresa prima di marcare i residui in Errore
  BATCH_CHECKPOINT_MAX_THREADS: 150,    // Limite thread salvati nel checkpoint per restare sotto quota Properties

  // === Alias noti (anti-loop: il bot riconosce sé stesso anche quando invia da alias) ===
  get BOT_EMAIL() { return _getScriptProperty('BOT_EMAIL'); },
  KNOWN_ALIASES: _getScriptPropertyStringArray('KNOWN_ALIASES', ['YOUR_SENDING_ALIAS@example.com']),

  // === Knowledge Base ===
  get SPREADSHEET_ID() { return _getScriptProperty('SPREADSHEET_ID'); },
  get SCRIPT_ID() {
    try {
      return ScriptApp.getScriptId();
    } catch (e) {
      return 'unknown';
    }
  },
  KB_SHEET_NAME: 'Istruzioni',
  AI_CORE_LITE_SHEET: 'AI_CORE_LITE',
  AI_CORE_SHEET: 'AI_CORE',
  DOCTRINE_SHEET: 'Dottrina',
  REPLACEMENTS_SHEET_NAME: 'Sostituzioni',

  MEMORY_SHEET_NAME: 'ConversationMemory',
  MAX_PROVIDED_TOPICS: 50,             // Limite massimo topic in memoria
  MEMORY_LOCK_TTL: 30,                 // Lock TTL in secondi per MemoryService (>= timeout lock Sheet)
  SHEET_WRITE_LOCK_TIMEOUT_MS: 10000,  // Timeout attesa ScriptLock prima di scrivere su Sheet

  // === Riprova con i fogli API ===
  SHEETS_RETRY_MAX: 3,                 // Tentativi massimi
  SHEETS_RETRY_BACKOFF_MS: 1000,       // Backoff iniziale (raddoppia ad ogni tentativo)

  // === Modalità ===
  DRY_RUN: false,                      // True per test senza invio email
  FORCE_RELOAD: false,                 // Forza ricaricamento cache KB
  USE_RATE_LIMITER: true,              // Limitatore di velocità intelligente abilitato

  // === Limiti Token (Prompt Engine) ===
  CONTEXT_WINDOW_TOKENS: 1048576,      // Hard cap operativo condiviso dai modelli Flash configurati
  MAX_SAFE_TOKENS: 120000,             // Cap operativo locale: resta sotto 1M per evitare payload GAS ingestibili
  MAX_SAFE_PROMPT_CHARS: 100000,       // Limite caratteri prompt prima del troncamento di sicurezza
  KB_TOKEN_BUDGET_RATIO: 0.5,          // Budget percentuale KB rispetto a un token massimo
  KB_HALLUCINATION_RISK_THRESHOLD: 8000, // Soglia chars KB oltre cui scatta hallucination_risk
  MAX_PROVIDED_INFO_JSON_CHARS: 45000, // Limite serializzazione memoria providedInfo per riga Sheet
  PROMPT_ENGINE: {
    OVERHEAD_TOKENS: 15000             // Riserva token per istruzioni/fixed context fuori KB
  },

  // Fattore prudenziale per allineare il tracciamento TPM ai token output reali (thinking invisibile Gemini 3.5).
  TOKEN_ACCOUNTING: {
    enabled: true,
    outputMultiplier: 1.12
  },

  // === Limiti Thread ===
  MAX_THREAD_LENGTH: 8,                // Messaggi massimi per thread prima di anti-loop

  // === Logging ===
  LOGGING: {
    LEVEL: 'INFO',                     // DEBUG, INFO, WARN, ERROR
    STRUCTURED: true,                  // Log in formato JSON
    SEND_ERROR_NOTIFICATIONS: true,    // Invia email per errori critici
    get ADMIN_EMAIL() { return _getScriptProperty('ADMIN_EMAIL') || ''; }  // Email admin per notifiche
  },

  // === Metriche Giornaliere ===
  // Configurare METRICS_SHEET_ID in Script Properties per abilitare export
  get METRICS_SHEET_ID() { return _getScriptProperty('METRICS_SHEET_ID'); },
  METRICS_SHEET_NAME: 'DailyMetrics',

  // === Modelli Gemini (configurazione centralizzata) ===
  // Aggiornato: Maggio 2026
  // Policy operativa:
  // - Risposta finale: Gemini 3.5 Flash (qualità)
  // - Task rapidi/ausiliari: Gemini 3.1 Flash-Lite (categoria, lingua AI, semantica, scarti)
  // Fonte quote operative: verificare i limiti effettivi nel progetto AI Studio.
  // Le quote effettive possono variare per progetto: se AI Studio mostra limiti inferiori,
  // ridurre questi valori senza aumentare MAX_EMAILS_PER_RUN.
  // - Contesto massimo per prompt: 1.048.576 token
  // - RPM: 2.000
  // - TPM: 2.000.000
  // - RPD: 3.500
  // - Grounding Google Search: tenere disabilitato in Free Tier salvo disponibilità esplicita in AI Studio
  // - Vietato usare /countTokens: il conteggio resta locale e stimato.
  GEMINI_FREE_TIER_NOTES: {
    contextWindowTokens: 1048576,
    rpm: 15,
    tpm: 1000000,
    rpd: 1500,
    ipm: null,
    groundingSharedRpd: 1500,
    countTokensApiAllowed: false,
    dataUsedForTraining: true
  },

  GEMINI_BACKOFF: {
    maxRetries: 2,                     // Risparmia RPD: retry brevi e ripetuti consumano il collo di bottiglia giornaliero
    retryDelayMs: 4000,
    factor: 2.5,
    maxBackoffMs: 120000,
    jitterMs: 750,
    rateLimiterMaxRetries: 2
  },

  GEMINI_MODELS: {
    // Modello principale per la risposta finale: qualita.
    'flash-3.5': {
      name: 'gemini-3.5-flash',
      rpm: 15,
      tpm: 1000000,
      rpd: 1500,
      contextWindowTokens: 1048576,
      ipm: null,
      useCases: ['generation', 'all']
    },
    // Stesso tier qualita su chiave di riserva.
    'flash-3.5-backup': {
      name: 'gemini-3.5-flash',
      rpm: 15,
      tpm: 1000000,
      rpd: 1500,
      contextWindowTokens: 1048576,
      ipm: null,
      useCases: ['generation', 'backup']
    },
    // Modello rapido per categoria, lingua AI, semantica e scarti.
    'flash-lite': {
      name: 'gemini-3.1-flash-lite',
      rpm: 15,
      tpm: 1000000,
      rpd: 1500,
      contextWindowTokens: 1048576,
      ipm: null,
      useCases: ['quick_check', 'classification', 'language', 'semantic', 'newsletter_summary', 'fallback']
    },
    // Alias esplicito compatibile per la serie 3.5 Lite; non usato nelle strategie
    // primarie per evitare fallback ridondanti verso lo stesso modello fisico.
    'flash-3.5-lite': {
      name: 'gemini-3.1-flash-lite',
      rpm: 15,
      tpm: 1000000,
      rpd: 1500,
      contextWindowTokens: 1048576,
      ipm: null,
      useCases: ['quick_check', 'classification', 'language', 'semantic', 'newsletter_summary', 'fallback']
    },
    // Backup logico Lite per chiave di riserva o fallback controllati.
    'flash-3.5-lite-backup': {
      name: 'gemini-3.1-flash-lite',
      rpm: 15,
      tpm: 1000000,
      rpd: 1500,
      contextWindowTokens: 1048576,
      ipm: null,
      useCases: ['quick_check', 'classification', 'language', 'semantic', 'newsletter_summary', 'fallback', 'backup']
    }
  },

  // Strategia selezione modelli per task (ordine = priorità)
  MODEL_STRATEGY: {
    'quick_check': ['flash-lite'],
    'classification': ['flash-lite'],
    'language': ['flash-lite'],
    'newsletter_summary': ['flash-lite'],
    'generation': ['flash-3.5', 'flash-3.5-backup', 'flash-lite', 'flash-3.5-lite-backup'],
    'semantic': ['flash-lite', 'flash-3.5-lite-backup'],
    'fallback': ['flash-lite', 'flash-3.5-lite-backup']
  },

  // === Liste di esclusione ===
  // Nota: lista volutamente mista (domini + email complete).
  // Il matcher supporta sia exact match (email) sia suffisso dominio in _shouldIgnoreEmail.
  IGNORE_DOMAINS: [
    'noreply', 'no-reply', 'newsletter', 'marketing',
    'promo', 'ads', 'notifications',
    'amazon.com', 'eventbrite.com', 'paypal.com', 'ebay.com',
    'subito.it', 'mailchimp.com', 'mailup.com',
    'unclickperlascuolaelosport.it', 'sendinblue.com',
    'ignored.person1@example.com', 'ignored.person2@example.com',
    'donraimondo@example.com', 'comunicazioni@example.com'
  ],
  IGNORE_KEYWORDS: [
    'unsubscribe', 'opt-out', 'newsletter',
    'disiscriviti', 'disiscrizione', 'annulla iscrizione',
    'annulla l\'iscrizione', 'annulla l’iscrizione', 'gestisci la tua iscrizione',
    'gestisci le tue preferenze', 'aggiorna le tue preferenze',
    'cancella iscrizione', 'mailing list', 'inviato con mailup',
    'messaggio inviato con', 'non rispondere a questo messaggio',
    'avviso di sicurezza',
    'scopri i prodotti', 'scopri le novità', 'offerta esclusiva',
    'promozione', 'promozioni', 'sconto', 'webinar',
    'ti aspetta al', 'riservato a te', 'iscriviti ora',
    'invito all\'evento', 'nuovo arrivo', 'collezione',
    'ultima occasione'
  ]
};
// ====================================================================
// MARCATORI LINGUA (costante condivisa tra moduli)
// ====================================================================

var LANGUAGE_MARKERS = {
  'it': ['grazie', 'cordiali', 'saluti', 'gentile', 'parrocchia', 'messa', 'vorrei', 'quando', 'buongiorno', 'buonasera'],
  'en': ['thank', 'regards', 'dear', 'parish', 'mass', 'church', 'would', 'could', 'please', 'sincerely'],
  'es': ['gracias', 'saludos', 'estimado', 'parroquia', 'misa', 'iglesia', 'querría', 'buenos', 'días'],
  'pt': ['obrigado', 'obrigada', 'atenciosamente', 'prezado', 'paróquia', 'missa', 'gostaria', 'bom', 'dia', 'tarde'],
  'fr': ['merci', 'cordialement', 'cher', 'paroisse', 'messe', 'église', 'voudrais', 'pourrais', 'bonjour', 'bonsoir'],
  'de': ['danke', 'grüße', 'liebe', 'pfarrei', 'messe', 'kirche', 'möchte', 'könnte', 'bitte', 'guten']
};

// ====================================================================
// CACHE GLOBALE
// ====================================================================
// NOTA: GLOBAL_CACHE è dichiarata con init difensiva in gas_main.js.
// NON ridichiarare qui per evitare conflitti di ordine esecuzione file GAS.

// ====================================================================
// VALIDAZIONE CONFIGURAZIONE
// ====================================================================

/**
 * Valida la configurazione all'avvio con schema rigoroso
 * Previene silent failures da typo o tipi errati
 * @returns {Object} Risultato validazione {valid: boolean, errors: string[]}
 */
function validateConfig() {
  const errors = [];

  // Helper per validazione tipo
  const checkType = (path, value, expectedType) => {
    if (typeof value !== expectedType) {
      errors.push(`Errore Config: '${path}' deve essere di tipo ${expectedType}, trovato ${typeof value}`);
    }
  };

  // Helper per validazione range
  const checkRange = (path, value, min, max) => {
    if (typeof value === 'number' && (!Number.isFinite(value) || value < min || value > max)) {
      errors.push(`Errore Config: '${path}' (${value}) fuori range [${min}, ${max}]`);
    }
  };

  // 1. Validazione Campi Critici (fail-fast)
  if (!CONFIG.GEMINI_API_KEY) errors.push('CRITICO: GEMINI_API_KEY mancante');
  if (!CONFIG.SPREADSHEET_ID) errors.push('CRITICO: SPREADSHEET_ID mancante');

  // 2. Validazione Tipi e Valori Logici
  checkType('MODEL_NAME', CONFIG.MODEL_NAME, 'string');
  checkType('MAX_OUTPUT_TOKENS', CONFIG.MAX_OUTPUT_TOKENS, 'number');
  checkType('MAX_SAFE_TOKENS', CONFIG.MAX_SAFE_TOKENS, 'number');
  checkRange('MAX_SAFE_TOKENS', CONFIG.MAX_SAFE_TOKENS, 3000, 1000000);
  checkType('MAX_SAFE_PROMPT_CHARS', CONFIG.MAX_SAFE_PROMPT_CHARS, 'number');
  checkRange('MAX_SAFE_PROMPT_CHARS', CONFIG.MAX_SAFE_PROMPT_CHARS, 1000, 1000000);

  // Gmail & Process
  checkType('MAX_EMAILS_PER_RUN', CONFIG.MAX_EMAILS_PER_RUN, 'number');
  checkRange('MAX_EMAILS_PER_RUN', CONFIG.MAX_EMAILS_PER_RUN, 0, 50); // 0 = sospensione operativa temporanea
  checkType('SAFETY_VALVE_THRESHOLD', CONFIG.SAFETY_VALVE_THRESHOLD, 'number');
  checkRange('SAFETY_VALVE_THRESHOLD', CONFIG.SAFETY_VALVE_THRESHOLD, 0.5, 0.99);
  checkType('SENDER_THROTTLE_WINDOW_SECONDS', CONFIG.SENDER_THROTTLE_WINDOW_SECONDS, 'number');
  checkRange('SENDER_THROTTLE_WINDOW_SECONDS', CONFIG.SENDER_THROTTLE_WINDOW_SECONDS, 0, 86400);
  checkType('GMAIL_LABEL_LOOKBACK_DAYS', CONFIG.GMAIL_LABEL_LOOKBACK_DAYS, 'number');
  checkRange('GMAIL_LABEL_LOOKBACK_DAYS', CONFIG.GMAIL_LABEL_LOOKBACK_DAYS, 0, 3650);
  checkType('BATCH_CHECKPOINT_MAX_RETRIES', CONFIG.BATCH_CHECKPOINT_MAX_RETRIES, 'number');
  checkRange('BATCH_CHECKPOINT_MAX_RETRIES', CONFIG.BATCH_CHECKPOINT_MAX_RETRIES, 1, 20);
  checkType('BATCH_CHECKPOINT_MAX_THREADS', CONFIG.BATCH_CHECKPOINT_MAX_THREADS, 'number');
  checkRange('BATCH_CHECKPOINT_MAX_THREADS', CONFIG.BATCH_CHECKPOINT_MAX_THREADS, 1, 150);
  checkType('LABEL_NAME', CONFIG.LABEL_NAME, 'string');
  checkType('ERROR_LABEL_NAME', CONFIG.ERROR_LABEL_NAME, 'string');
  checkType('VALIDATION_ERROR_LABEL', CONFIG.VALIDATION_ERROR_LABEL, 'string');
  checkType('SKIP_LABEL_NAME', CONFIG.SKIP_LABEL_NAME, 'string');
  // SKIP_LABEL_NAME può essere stringa vuota ("") per disabilitare il labeling in foreign_only: è intenzionale.
  checkType('MESSAGE_DISCOVERY_MODE', CONFIG.MESSAGE_DISCOVERY_MODE, 'string');
  if (!['metadata', 'query'].includes(CONFIG.MESSAGE_DISCOVERY_MODE)) {
    errors.push("Errore Config: 'MESSAGE_DISCOVERY_MODE' deve essere uno tra 'metadata', 'query'");
  }

  // Cache & Lock
  checkType('CACHE_LOCK_TTL', CONFIG.CACHE_LOCK_TTL, 'number');
  checkType('OCR_ORPHAN_MAX_AGE_HOURS', CONFIG.OCR_ORPHAN_MAX_AGE_HOURS, 'number');
  checkRange('OCR_ORPHAN_MAX_AGE_HOURS', CONFIG.OCR_ORPHAN_MAX_AGE_HOURS, 1, 24);
  checkType('OCR_CLEANUP_MAX_RUNTIME_MS', CONFIG.OCR_CLEANUP_MAX_RUNTIME_MS, 'number');
  checkRange('OCR_CLEANUP_MAX_RUNTIME_MS', CONFIG.OCR_CLEANUP_MAX_RUNTIME_MS, 1000, 30000);
  checkType('GMAIL_LIST_MAX_RUNTIME_MS', CONFIG.GMAIL_LIST_MAX_RUNTIME_MS, 'number');
  checkRange('GMAIL_LIST_MAX_RUNTIME_MS', CONFIG.GMAIL_LIST_MAX_RUNTIME_MS, 1000, 120000);
  checkType('MAX_PROVIDED_TOPICS', CONFIG.MAX_PROVIDED_TOPICS, 'number');
  checkType('KB_HALLUCINATION_RISK_THRESHOLD', CONFIG.KB_HALLUCINATION_RISK_THRESHOLD, 'number');
  checkRange('KB_HALLUCINATION_RISK_THRESHOLD', CONFIG.KB_HALLUCINATION_RISK_THRESHOLD, 100, 100000);
  checkType('MAX_PROVIDED_INFO_JSON_CHARS', CONFIG.MAX_PROVIDED_INFO_JSON_CHARS, 'number');
  checkRange('MAX_PROVIDED_INFO_JSON_CHARS', CONFIG.MAX_PROVIDED_INFO_JSON_CHARS, 1000, 50000);

  // Validation Logic
  checkType('VALIDATION_ENABLED', CONFIG.VALIDATION_ENABLED, 'boolean');
  checkType('VALIDATION_MIN_SCORE', CONFIG.VALIDATION_MIN_SCORE, 'number');
  checkRange('VALIDATION_MIN_SCORE', CONFIG.VALIDATION_MIN_SCORE, 0.0, 100.0);
  checkType('VALIDATION_WARNING_THRESHOLD', CONFIG.VALIDATION_WARNING_THRESHOLD, 'number');
  checkRange('VALIDATION_WARNING_THRESHOLD', CONFIG.VALIDATION_WARNING_THRESHOLD, 0.0, 100.0);

  // Riprova Logica
  if (!CONFIG.INTELLIGENT_RETRY || typeof CONFIG.INTELLIGENT_RETRY !== 'object') {
    errors.push("Errore Config: 'INTELLIGENT_RETRY' deve essere un oggetto");
  } else {
    checkType('INTELLIGENT_RETRY.enabled', CONFIG.INTELLIGENT_RETRY.enabled, 'boolean');
  }

  // Arrays
  if (!Array.isArray(CONFIG.IGNORE_DOMAINS)) errors.push("Errore Config: 'IGNORE_DOMAINS' deve essere un array");
  if (!Array.isArray(CONFIG.IGNORE_KEYWORDS)) errors.push("Errore Config: 'IGNORE_KEYWORDS' deve essere un array");

  // 3. Validazione Strutturale Oggetti
  if (!CONFIG.GEMINI_MODELS || typeof CONFIG.GEMINI_MODELS !== 'object') {
    errors.push("Errore Config: 'GEMINI_MODELS' deve essere un oggetto");
  } else {
    if (Object.keys(CONFIG.GEMINI_MODELS).length === 0) {
      errors.push("Errore Config: 'GEMINI_MODELS' è vuoto");
    }
    // Verifica esistenza modelli chiave
    if (!CONFIG.GEMINI_MODELS['flash-3.5']) errors.push("Errore Config: Modello 'flash-3.5' mancante in GEMINI_MODELS");
    if (!CONFIG.GEMINI_MODELS['flash-3.5-backup']) errors.push("Errore Config: Modello 'flash-3.5-backup' mancante in GEMINI_MODELS");
    if (!CONFIG.GEMINI_MODELS['flash-lite']) errors.push("Errore Config: Modello 'flash-lite' mancante in GEMINI_MODELS");
    if (!CONFIG.GEMINI_MODELS['flash-3.5-lite-backup']) errors.push("Errore Config: Modello 'flash-3.5-lite-backup' mancante in GEMINI_MODELS");
  }

  if (!CONFIG.MODEL_STRATEGY || typeof CONFIG.MODEL_STRATEGY !== 'object') {
    errors.push("Errore Config: 'MODEL_STRATEGY' deve essere un oggetto");
  } else {
    const generationStrategy = CONFIG.MODEL_STRATEGY.generation || [];
    const quickStrategy = CONFIG.MODEL_STRATEGY.quick_check || [];
    if (!Array.isArray(generationStrategy) || generationStrategy[0] !== 'flash-3.5') {
      errors.push("Errore Config: MODEL_STRATEGY.generation deve partire da 'flash-3.5'");
    }
    if (!Array.isArray(quickStrategy) || quickStrategy[0] !== 'flash-lite') {
      errors.push("Errore Config: MODEL_STRATEGY.quick_check deve partire da 'flash-lite'");
    }
  }

  // Se ci sono errori, logghiamoli subito
  if (errors.length > 0) {
    console.error("🚨 VALIDAZIONE CONFIGURAZIONE FALLITA 🚨");
    errors.forEach(e => console.error(`   - ${e}`));
  }

  return {
    valid: errors.length === 0,
    errors: errors
  };
}


/**
 * Versione fail-fast della validazione configurazione da usare negli entrypoint.
 * Gli score possono essere espressi come 0.6 oppure 60: la normalizzazione runtime
 * avviene tramite normalizeValidationScore().
 */
function validateConfigOrThrow() {
  const result = validateConfig();
  if (!result.valid) {
    throw new Error('Configurazione non valida: ' + result.errors.join('; '));
  }
  return result;
}

/**
 * Ottiene la configurazione
 * @returns {Object} Oggetto CONFIG
 */
function getConfig() {
  return CONFIG;
}

/**
 * Healthcheck del sistema
 * @returns {Object} Stato dei componenti
 */
function healthCheck() {
  const health = {
    timestamp: new Date().toISOString(),
    status: 'OK',
    components: {}
  };

  try {
    // Controllo configurazione
    const configValidation = validateConfig();
    health.components.config = {
      status: configValidation.valid ? 'OK' : 'ERROR',
      errors: configValidation.errors
    };

    // Controllo Gmail
    try {
      GmailApp.getInboxThreads(0, 1);
      health.components.gmail = { status: 'OK' };
    } catch (e) {
      health.components.gmail = { status: 'ERROR', error: e.message };
    }

    // Controllo Knowledge Base
    try {
      SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
      health.components.knowledgeBase = { status: 'OK' };
    } catch (e) {
      health.components.knowledgeBase = { status: 'ERROR', error: e.message };
    }

    // Controllo Properties Service
    try {
      PropertiesService.getScriptProperties().getProperty('test');
      health.components.properties = { status: 'OK' };
    } catch (e) {
      health.components.properties = { status: 'ERROR', error: e.message };
    }

    // Determina stato complessivo
    const hasErrors = Object.values(health.components).some(c => c.status === 'ERROR');
    health.status = hasErrors ? 'DEGRADED' : 'OK';

  } catch (e) {
    health.status = 'ERROR';
    health.error = e.message;
  }

  return health;
}
