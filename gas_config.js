/**
 * Config.js - Configurazione centralizzata del sistema
 * Tutti i parametri configurabili sono definiti qui
 */

var _SCRIPT_PROPERTIES = null;
var _CACHED_PROPS = {};
var _ALL_PROPS_CACHE_TS = 0;
// Cache solo intra-esecuzione: riduce letture ripetute a PropertiesService
// durante la stessa run GAS; non e' pensata come persistenza fra trigger.
var _SCRIPT_PROPERTY_CACHE_TTL_MS = 60 * 1000;
function _refreshScriptPropertyCache_(requestedKey, now) {
  requestedKey = typeof requestedKey === 'string' ? requestedKey.trim() : '';
  const hasGetProperties = typeof _SCRIPT_PROPERTIES.getProperties === 'function';
  const allProps = hasGetProperties
    ? (_SCRIPT_PROPERTIES.getProperties() || {})
    : {};
  if (hasGetProperties) {
    _CACHED_PROPS = {};
    _ALL_PROPS_CACHE_TS = now;
  }
  Object.keys(allProps).forEach(key => {
    _CACHED_PROPS[key] = {
      value: allProps[key],
      ts: now
    };
  });
  if (typeof requestedKey === 'string' && requestedKey.trim() && (!hasGetProperties || !Object.prototype.hasOwnProperty.call(_CACHED_PROPS, requestedKey))) {
    _CACHED_PROPS[requestedKey] = {
      value: (!hasGetProperties && typeof _SCRIPT_PROPERTIES.getProperty === 'function')
        ? _SCRIPT_PROPERTIES.getProperty(requestedKey)
        : null,
      ts: now
    };
  }
}

function _getScriptProperty(key, forceRefresh = false) {
  if (typeof key !== 'string' || !key.trim()) return null;
  key = key.trim();
  if (!_SCRIPT_PROPERTIES) {
    try {
      if (typeof PropertiesService === 'undefined' || !PropertiesService || typeof PropertiesService.getScriptProperties !== 'function') {
        return null;
      }
      _SCRIPT_PROPERTIES = PropertiesService.getScriptProperties();
    } catch (e) {
      return null;
    }
    if (!_SCRIPT_PROPERTIES) {
      return null;
    }
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
    _ALL_PROPS_CACHE_TS = 0;
  }
  if (!forceRefresh && !hasFreshCachedValue && typeof _SCRIPT_PROPERTIES.getProperties === 'function' &&
      _ALL_PROPS_CACHE_TS > 0 && (now - _ALL_PROPS_CACHE_TS) <= _SCRIPT_PROPERTY_CACHE_TTL_MS) {
    _CACHED_PROPS[key] = { value: null, ts: _ALL_PROPS_CACHE_TS };
    return null;
  }
  if (forceRefresh || !hasFreshCachedValue) {
    try {
      _refreshScriptPropertyCache_(key, now);
    } catch (e) {
      if (forceRefresh) throw e;
      return null;
    }
  }
  return _CACHED_PROPS[key] ? _CACHED_PROPS[key].value : null;
}

function _clearScriptPropertyCache(keys) {
  _ALL_PROPS_CACHE_TS = 0;
  if (!keys) {
    _CACHED_PROPS = {};
    _SCRIPT_PROPERTIES = null;
    return;
  }
  const keyList = Array.isArray(keys) ? keys : [keys];
  keyList.forEach(key => {
    if (typeof key === 'string' && key.trim()) delete _CACHED_PROPS[key.trim()];
  });
}

function _getScriptPropertyStringArray(key, fallback) {
  const safeFallback = Array.isArray(fallback) ? fallback.slice() : [];
  let raw = '';
  try {
    raw = String(_getScriptProperty(key) || '').trim();
  } catch (e) {
    raw = '';
  }
  if (!raw) return safeFallback;

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const values = parsed
        .map(value => String(value || '').trim())
        .filter(Boolean);
      return values.length ? values : safeFallback;
    }
  } catch (e) {
    // Non JSON: accettiamo liste separate da virgola, punto e virgola o newline.
  }

  const normalized = String(raw).replace(/\r\n?/g, '\n');
  const hasStructuredSeparators = /[\n;]/.test(normalized);
  const values = normalized
    .split(hasStructuredSeparators ? /[\n;]/ : /,/)
    .map(value => value.trim())
    .filter(Boolean);
  return values.length ? values : safeFallback;
}

var CONFIG = {
  // === API ===
  get GEMINI_API_KEY() { return _getScriptProperty('GEMINI_API_KEY'); },
  get MODEL_NAME() { return String(_getScriptProperty('GEMINI_MODEL_PRIMARY') || '').trim() || 'gemini-3.8-flash'; },
  get LITE_MODEL_NAME() { return String(_getScriptProperty('GEMINI_MODEL_LITE') || '').trim() || 'gemini-3.5-flash-lite'; },

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
  RELATIONAL_POSTURE_CONFIDENCE_THRESHOLD: 0.70,
  RESPONSE_STRATEGY_CONFIDENCE_THRESHOLD: 0.65,
  TEMPORAL_PARSING: {
    nextWeekdayPolicy: 'upcoming'
  },
  // Le crisi critiche passano in Verifica prima della generazione automatica.
  CRISIS_HUMAN_REVIEW: true,
  VALIDATION_REVIEW_ALERTS: {
    enabled: true,
    cooldownSeconds: 3600,
    recipientProperty: 'VALIDATION_REVIEW_EMAIL',
    get email() { return _getScriptProperty('VALIDATION_REVIEW_EMAIL') || ''; }
  },
  SENSITIVE_FLAGS_TTL_DAYS: 180, // Evidenza per flag; non rinnova con richieste estranee.
  MEMORY_RETENTION_DAYS: 30, // Intera conversazione: un limite minore elimina anche i flag prima del loro TTL.
  TRUSTED_FORM_SENDERS: [], // Indirizzi From esatti dei form autorizzati a usare Reply-To su un altro dominio.
  SEMANTIC_VALIDATION: {
    enabled: true,
    activationThreshold: 0.82,
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
      'kb_relevance',
      'language',
      'placeholder',
      'length',
      'temporal',
      'physical_presence',
      'sensitive_quality'
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
  DUPLICATE_REPLY_GUARD_ENABLED: true, // Blocca copie identiche già risposte, prima di memoria e AI
  // Blocca il reinvio dello stesso testo dallo stesso mittente nel giorno
  // successivo alla risposta. Le richieste realmente nuove cambiano il
  // fingerprint; 15 minuti non coprivano le ritrasmissioni manuali tardive.
  DUPLICATE_REPLY_WINDOW_SECONDS: 86400, // 24 ore dall'invio confermato
  DUPLICATE_REPLY_MAX_ENTRIES: 200,    // Limite marker persistenti per contenere ScriptProperties
  // === DISCOVERY MODE ======================================================================
  // Modalità di scoperta messaggi non letti da elaborare.
  // - 'metadata': default message-level (list INBOX/UNREAD + get(minimal) per labelIds)
  // - 'query'   : compatibile GmailApp.search a livello thread
  MESSAGE_DISCOVERY_MODE: 'metadata',
  // =========================================================================================
  MAX_EXECUTION_TIME_MS: 280000,    // Tempo massimo stimato per singola esecuzione GAS
  GMAIL_LABEL_CACHE_TTL: 21600000,     // 6 ore in millisecondi
  MAX_HISTORY_MESSAGES: 8,             // Massimo messaggi in cronologia thread (ricalibrato)
  ATTACHMENT_CONTEXT: {
    enabled: true,                   // Includi testo allegati (PDF, immagini, Word, Excel, PowerPoint) nel prompt
    maxFiles: 3,                     // Numero massimo di allegati da processare
    maxBytesPerFile: 3 * 1024 * 1024,// 3 MB per file
    maxMessageBytesForAttachmentDownload: 25 * 1024 * 1024, // Pre-check: non scaricare allegati se il messaggio supera 25 MB
    maxCharsPerFile: 3000,           // Limite testo per singolo allegato
    maxTotalChars: 9000,             // Limite totale testo allegati
    ocrLanguage: 'it',               // Lingua OCR (Drive Advanced API)
    ocrConfidenceWarningThreshold: 0.8, // Soglia warning leggibilità OCR in risposta
    pdfMaxPages: 2,                  // Limite pagine PDF (stima via OCR)
    pdfCharsPerPage: 1800,           // Stima caratteri per pagina PDF
    ocrTriggerKeywords: [            // Compatibilità helper compatibile; non filtra i documenti nel percorso visivo
      'iban', 'bonifico', 'ricevuta', 'documento',
      'allego', 'in allegato', 'coordinate', 'modulo'
    ],
    ibanFocusEnabled: true,          // Focus OCR se viene trovato un IBAN
    ibanContextChars: 300,           // Finestra +/- per testo attorno all'IBAN
    maxCharsWhenKbTruncated: 1500    // Riduzione allegati se KB è troncata
  },
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
  GMAIL_DAILY_CALL_LIMIT: 18000,       // Soft limit locale anti-burst prima del limite Gmail reale
  GMAIL_METADATA_FALLBACK_MAX_PER_THREAD: 25, // Max messages.get recenti per thread quando GmailApp.isUnread è incoerente
  GMAIL_METADATA_DISCOVERY_MAX_GETS: 120, // Numero massimo di chiamate messages.get per ricerca alternativa dei messaggi.
  GMAIL_LIST_MAX_PAGES: 20,            // Limite pagine Gmail list per bootstrap label cache
  GMAIL_LIST_MAX_MESSAGES: 2000,       // Limite messaggi Gmail list per bootstrap label cache
  GMAIL_LIST_MAX_RUNTIME_MS: 50000,     // Budget tempo bootstrap label cache per evitare timeout GAS
  GMAIL_LABEL_LOOKBACK_DAYS: 0,         // 0 = nessuna finestra temporale nel pre-caricamento label
  BATCH_CHECKPOINT_TTL_MS: 10 * 60 * 1000, // Scadenza checkpoint resume (10 minuti)
  BATCH_CHECKPOINT_MAX_RETRIES: 3,      // Riprese rapide sullo stesso set; poi torna al trigger periodico
  BATCH_CHECKPOINT_MAX_THREADS: 150,    // Limite thread salvati nel checkpoint per restare sotto quota Properties

  // === Alias noti (anti-loop: il bot riconosce sé stesso anche quando invia da alias) ===
  get BOT_EMAIL() { return _getScriptProperty('BOT_EMAIL'); },
  get KNOWN_ALIASES() { return _getScriptPropertyStringArray('KNOWN_ALIASES', ['info@parrocchiasanteugenio.it']); },

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
  MEMORY_MAX_SUMMARY_BULLETS: 5,       // Numero massimo di righe sintetiche conservate nel riepilogo memoria
  MEMORY_LOCK_TTL: 30,                 // Lock TTL in secondi per MemoryService (>= timeout lock Sheet)
  MEMORY_LOCK_MAX_RETRIES: 3,          // Retry brevi: la memoria è best-effort e non deve consumare tutto il trigger GAS
  MEMORY_SHARDED_LOCK_ACQUIRE_TIMEOUT_MS: 800, // Budget acquisizione lock sharded per tentativo
  MEMORY_LOCK_GLOBAL_GUARD_TIMEOUT_MS: 150,    // Timeout guard lock CacheService
  MEMORY_LOCK_BACKOFF_BASE_MS: 200,     // Backoff iniziale retry lock memoria
  MEMORY_LOCK_BACKOFF_CAP_MS: 1500,     // Cap backoff per evitare timeout serverless
  MEMORY_LOCK_BACKOFF_JITTER_MS: 120,   // Jitter anti-contesa
  MEMORY_LOCK_CACHE_VERIFY_DELAY_MS: 0, // 0 evita sleep nel guard lock; usare >0 solo se CacheService mostra propagazione lenta
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
  MAX_SAFE_TOKENS: 120000,             // Budget locale; non rappresenta una quota Google garantita.
  MAX_SAFE_PROMPT_CHARS: 120000,       // Limite caratteri prompt prima del troncamento.
  KB_TOKEN_BUDGET_RATIO: 0.5,          // Budget percentuale KB rispetto a un token massimo
  KB_HALLUCINATION_RISK_THRESHOLD: 8000, // Soglia chars KB oltre cui scatta hallucination_risk
  LONGITUDINAL_TONE_ONLY_MAX_CHARS: 500, // Parametro compatibile ignorato: la continuità del tono dipende dai segnali
  MAX_PROVIDED_INFO_JSON_CHARS: 45000, // Limite serializzazione memoria providedInfo per riga Sheet
  PROMPT_ENGINE: {
    OVERHEAD_TOKENS: 15000,            // Riserva token per istruzioni/fixed context fuori KB
    MEMORY_CONTEXT_MAX_CHARS: 10000,   // Budget massimo per memoria sintetica nel prompt
    CONVERSATION_HISTORY_MAX_CHARS: 16000, // Budget massimo per cronologia thread nel prompt
    RESPONSE_FOCUS_MIN_CONFIDENCE: 0.65, // Confidenza minima per riusare focus conversazionale
    RESPONSE_FOCUS_MAX_AGE_DAYS: 45    // Finestra massima continuità focus thread
  },

  // Fattore prudenziale per allineare il tracciamento TPM ai token output reali (thinking invisibile Gemini 3.5).
  TOKEN_ACCOUNTING: {
    enabled: true,
    outputMultiplier: 1.25
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
  // Aggiornato: Ottobre 2026
  // Policy operativa:
  // - Risposta finale: modello primario configurabile, generazioni precedenti e alias latest
  // - Task rapidi/ausiliari: Gemini 3.5 Flash-Lite (categoria, lingua AI, semantica, scarti)
  // Fonte quote operative: verificare i limiti effettivi nel progetto AI Studio.
  // Le quote effettive possono variare per progetto: se AI Studio mostra limiti inferiori,
  // ridurre questi valori senza aumentare MAX_EMAILS_PER_RUN.
  // - Contesto massimo per prompt: 1.048.576 token
  // - RPM: 10-15
  // - TPM: 250.000
  // - RPD: 1.000-1.500
  // - Grounding Google Search: tenere disabilitato in Free Tier salvo disponibilità esplicita in AI Studio
  // - Vietato usare /countTokens: il conteggio resta locale e stimato.
  GEMINI_FREE_TIER_NOTES: {
    contextWindowTokens: 1048576,
    rpm: 10,
    tpm: 250000,
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

  // Limiti operativi locali: verificare le quote del progetto in AI Studio.
  // Gli alias latest possono cambiare versione e non garantiscono il Free Tier.
  GEMINI_MODELS: {
    'flash-primary': {
      get name() { return CONFIG.MODEL_NAME; },
      rpm: 10, tpm: 250000, rpd: 1500,
      contextWindowTokens: 1048576, ipm: null,
      useCases: ['generation', 'fallback']
    },
    'flash-primary-backup': {
      get name() { return CONFIG.MODEL_NAME; },
      rpm: 10, tpm: 250000, rpd: 1500,
      contextWindowTokens: 1048576, ipm: null,
      useCases: ['generation', 'fallback', 'backup']
    },
    'flash-3.6': {
      name: 'gemini-3.6-flash',
      rpm: 10, tpm: 250000, rpd: 1500,
      contextWindowTokens: 1048576, ipm: null,
      useCases: ['generation', 'fallback']
    },
    'flash-latest': {
      name: 'gemini-flash-latest',
      rpm: 10, tpm: 250000, rpd: 1500,
      contextWindowTokens: 1048576, ipm: null,
      useCases: ['generation', 'fallback']
    },
    'flash-latest-backup': {
      name: 'gemini-flash-latest',
      rpm: 10, tpm: 250000, rpd: 1500,
      contextWindowTokens: 1048576, ipm: null,
      useCases: ['generation', 'fallback', 'backup']
    },
    'flash-lite': {
      get name() { return CONFIG.LITE_MODEL_NAME; },
      rpm: 15, tpm: 250000, rpd: 1000,
      contextWindowTokens: 1048576, ipm: null,
      useCases: ['quick_check', 'classification', 'language', 'semantic', 'newsletter_summary', 'fallback']
    },
    'flash-lite-backup': {
      get name() { return CONFIG.LITE_MODEL_NAME; },
      rpm: 15, tpm: 250000, rpd: 1000,
      contextWindowTokens: 1048576, ipm: null,
      useCases: ['quick_check', 'classification', 'language', 'semantic', 'newsletter_summary', 'fallback', 'backup']
    },
    'flash-lite-latest': {
      name: 'gemini-flash-lite-latest',
      rpm: 15, tpm: 250000, rpd: 1000,
      contextWindowTokens: 1048576, ipm: null,
      useCases: ['quick_check', 'classification', 'language', 'semantic', 'newsletter_summary', 'fallback']
    },
    'flash-lite-latest-backup': {
      name: 'gemini-flash-lite-latest',
      rpm: 15, tpm: 250000, rpd: 1000,
      contextWindowTokens: 1048576, ipm: null,
      useCases: ['quick_check', 'classification', 'language', 'semantic', 'newsletter_summary', 'fallback', 'backup']
    }
  },

  MODEL_STRATEGY: {
    generation: ['flash-primary', 'flash-primary-backup', 'flash-3.6', 'flash-latest', 'flash-latest-backup', 'flash-lite', 'flash-lite-backup'],
    quick_check: ['flash-lite', 'flash-lite-backup', 'flash-lite-latest', 'flash-lite-latest-backup', 'flash-primary', 'flash-primary-backup', 'flash-latest'],
    classification: ['flash-lite', 'flash-lite-backup', 'flash-lite-latest', 'flash-lite-latest-backup', 'flash-primary', 'flash-primary-backup', 'flash-latest'],
    language: ['flash-lite', 'flash-lite-backup', 'flash-lite-latest', 'flash-lite-latest-backup', 'flash-primary', 'flash-primary-backup', 'flash-latest'],
    newsletter_summary: ['flash-lite', 'flash-lite-backup', 'flash-lite-latest', 'flash-lite-latest-backup', 'flash-primary', 'flash-primary-backup', 'flash-latest'],
    semantic: ['flash-lite', 'flash-lite-backup', 'flash-lite-latest', 'flash-lite-latest-backup', 'flash-primary', 'flash-primary-backup', 'flash-latest'],
    fallback: ['flash-lite', 'flash-lite-backup', 'flash-lite-latest', 'flash-lite-latest-backup', 'flash-primary', 'flash-primary-backup', 'flash-latest']
  },

  // === Liste di esclusione ===
  // Nota: lista volutamente mista (domini + email complete).
  // Il matcher supporta sia exact match (email) sia suffisso dominio in _shouldIgnoreEmail.
  IGNORE_DOMAINS: [
    'noreply', 'no-reply', 'newsletter',
    'promo', 'ads', 'notifications',
    'amazon.com', 'eventbrite.com', 'paypal.com', 'ebay.com',
    'subito.it', 'mailchimp.com', 'mailup.com',
    'unclickperlascuolaelosport.it', 'sendinblue.com',
  ],
  IGNORE_KEYWORDS: [
    'unsubscribe', 'opt-out',
    'disiscriviti',
    'gestisci la tua iscrizione',
    'gestisci le tue preferenze', 'aggiorna le tue preferenze',
    'inviato con mailup',
    'messaggio inviato con', 'non rispondere a questo messaggio',
    'avviso di sicurezza',
    'scopri i prodotti', 'scopri le novità', 'offerta esclusiva',
    'ti aspetta al', 'riservato a te', 'iscriviti ora',
    'nuovo arrivo',
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
var _lastConfigWarningSignature = null;

function validateConfig() {
  const errors = [];
  const warnings = [];
  for (const key of ['SENSITIVE_FLAGS_TTL_DAYS', 'MEMORY_RETENTION_DAYS']) {
    if (!Number.isSafeInteger(CONFIG[key]) || CONFIG[key] <= 0) {
      errors.push(`Errore Config: '${key}' deve essere un numero intero positivo di giorni`);
    }
  }
  if (Number.isSafeInteger(CONFIG.MEMORY_RETENTION_DAYS) && CONFIG.MEMORY_RETENTION_DAYS > 0 &&
      Number.isSafeInteger(CONFIG.SENSITIVE_FLAGS_TTL_DAYS) &&
      CONFIG.MEMORY_RETENTION_DAYS < CONFIG.SENSITIVE_FLAGS_TTL_DAYS) {
    warnings.push('La memoria delle conversazioni inattive viene eliminata dopo ' +
      CONFIG.MEMORY_RETENTION_DAYS + ' giorni, inclusi i flag sensibili. Il loro TTL di ' +
      CONFIG.SENSITIVE_FLAGS_TTL_DAYS + ' giorni si applica alle conversazioni ancora conservate.');
  }

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
  checkType('LITE_MODEL_NAME', CONFIG.LITE_MODEL_NAME, 'string');
  checkType('MAX_OUTPUT_TOKENS', CONFIG.MAX_OUTPUT_TOKENS, 'number');
  checkType('MAX_SAFE_TOKENS', CONFIG.MAX_SAFE_TOKENS, 'number');
  checkRange('MAX_SAFE_TOKENS', CONFIG.MAX_SAFE_TOKENS, 3000, 1000000);
  checkType('MAX_SAFE_PROMPT_CHARS', CONFIG.MAX_SAFE_PROMPT_CHARS, 'number');
  checkRange('MAX_SAFE_PROMPT_CHARS', CONFIG.MAX_SAFE_PROMPT_CHARS, 1000, 1000000);

  // Gmail & Process
  checkType('MAX_EMAILS_PER_RUN', CONFIG.MAX_EMAILS_PER_RUN, 'number');
  checkRange('MAX_EMAILS_PER_RUN', CONFIG.MAX_EMAILS_PER_RUN, 0, 50); // 0 = sospensione operativa temporanea
  checkType('MAX_EXECUTION_TIME_MS', CONFIG.MAX_EXECUTION_TIME_MS, 'number');
  checkRange('MAX_EXECUTION_TIME_MS', CONFIG.MAX_EXECUTION_TIME_MS, 30000, 360000);
  checkType('MIN_REMAINING_TIME_MS', CONFIG.MIN_REMAINING_TIME_MS, 'number');
  checkRange('MIN_REMAINING_TIME_MS', CONFIG.MIN_REMAINING_TIME_MS, 5000, 300000);
  if (typeof CONFIG.MAX_EXECUTION_TIME_MS === 'number' &&
      typeof CONFIG.MIN_REMAINING_TIME_MS === 'number' &&
      CONFIG.MIN_REMAINING_TIME_MS >= CONFIG.MAX_EXECUTION_TIME_MS) {
    errors.push(`Errore Config: 'MIN_REMAINING_TIME_MS' (${CONFIG.MIN_REMAINING_TIME_MS}) deve essere inferiore a 'MAX_EXECUTION_TIME_MS' (${CONFIG.MAX_EXECUTION_TIME_MS})`);
  }
  checkType('SAFETY_VALVE_THRESHOLD', CONFIG.SAFETY_VALVE_THRESHOLD, 'number');
  checkRange('SAFETY_VALVE_THRESHOLD', CONFIG.SAFETY_VALVE_THRESHOLD, 0.5, 0.99);
  checkType('SENDER_THROTTLE_WINDOW_SECONDS', CONFIG.SENDER_THROTTLE_WINDOW_SECONDS, 'number');
  checkRange('SENDER_THROTTLE_WINDOW_SECONDS', CONFIG.SENDER_THROTTLE_WINDOW_SECONDS, 0, 86400);
  checkType('DUPLICATE_REPLY_GUARD_ENABLED', CONFIG.DUPLICATE_REPLY_GUARD_ENABLED, 'boolean');
  checkType('DUPLICATE_REPLY_WINDOW_SECONDS', CONFIG.DUPLICATE_REPLY_WINDOW_SECONDS, 'number');
  checkRange('DUPLICATE_REPLY_WINDOW_SECONDS', CONFIG.DUPLICATE_REPLY_WINDOW_SECONDS, 0, 86400);
  checkType('DUPLICATE_REPLY_MAX_ENTRIES', CONFIG.DUPLICATE_REPLY_MAX_ENTRIES, 'number');
  checkRange('DUPLICATE_REPLY_MAX_ENTRIES', CONFIG.DUPLICATE_REPLY_MAX_ENTRIES, 1, 1000);
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
  checkType('MEMORY_LOCK_MAX_RETRIES', CONFIG.MEMORY_LOCK_MAX_RETRIES, 'number');
  checkRange('MEMORY_LOCK_MAX_RETRIES', CONFIG.MEMORY_LOCK_MAX_RETRIES, 1, 10);
  checkType('MEMORY_SHARDED_LOCK_ACQUIRE_TIMEOUT_MS', CONFIG.MEMORY_SHARDED_LOCK_ACQUIRE_TIMEOUT_MS, 'number');
  checkRange('MEMORY_SHARDED_LOCK_ACQUIRE_TIMEOUT_MS', CONFIG.MEMORY_SHARDED_LOCK_ACQUIRE_TIMEOUT_MS, 100, 30000);
  checkType('MEMORY_LOCK_GLOBAL_GUARD_TIMEOUT_MS', CONFIG.MEMORY_LOCK_GLOBAL_GUARD_TIMEOUT_MS, 'number');
  checkRange('MEMORY_LOCK_GLOBAL_GUARD_TIMEOUT_MS', CONFIG.MEMORY_LOCK_GLOBAL_GUARD_TIMEOUT_MS, 1, 5000);
  checkType('MEMORY_LOCK_BACKOFF_BASE_MS', CONFIG.MEMORY_LOCK_BACKOFF_BASE_MS, 'number');
  checkRange('MEMORY_LOCK_BACKOFF_BASE_MS', CONFIG.MEMORY_LOCK_BACKOFF_BASE_MS, 1, 10000);
  checkType('MEMORY_LOCK_BACKOFF_CAP_MS', CONFIG.MEMORY_LOCK_BACKOFF_CAP_MS, 'number');
  checkRange('MEMORY_LOCK_BACKOFF_CAP_MS', CONFIG.MEMORY_LOCK_BACKOFF_CAP_MS, 1, 30000);
  checkType('MEMORY_LOCK_BACKOFF_JITTER_MS', CONFIG.MEMORY_LOCK_BACKOFF_JITTER_MS, 'number');
  checkRange('MEMORY_LOCK_BACKOFF_JITTER_MS', CONFIG.MEMORY_LOCK_BACKOFF_JITTER_MS, 0, 10000);
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
  const normalizedMin = CONFIG.VALIDATION_MIN_SCORE > 1 ? CONFIG.VALIDATION_MIN_SCORE / 100 : CONFIG.VALIDATION_MIN_SCORE;
  const normalizedWarning = CONFIG.VALIDATION_WARNING_THRESHOLD > 1 ? CONFIG.VALIDATION_WARNING_THRESHOLD / 100 : CONFIG.VALIDATION_WARNING_THRESHOLD;
  if (normalizedMin > normalizedWarning) errors.push('Errore Config: VALIDATION_MIN_SCORE deve essere <= VALIDATION_WARNING_THRESHOLD');
  checkType('RELATIONAL_POSTURE_CONFIDENCE_THRESHOLD', CONFIG.RELATIONAL_POSTURE_CONFIDENCE_THRESHOLD, 'number');
  checkRange('RELATIONAL_POSTURE_CONFIDENCE_THRESHOLD', CONFIG.RELATIONAL_POSTURE_CONFIDENCE_THRESHOLD, 0.0, 1.0);
  checkType('RESPONSE_STRATEGY_CONFIDENCE_THRESHOLD', CONFIG.RESPONSE_STRATEGY_CONFIDENCE_THRESHOLD, 'number');
  checkRange('RESPONSE_STRATEGY_CONFIDENCE_THRESHOLD', CONFIG.RESPONSE_STRATEGY_CONFIDENCE_THRESHOLD, 0.0, 1.0);
  if (!CONFIG.TEMPORAL_PARSING || typeof CONFIG.TEMPORAL_PARSING !== 'object') {
    errors.push("Errore Config: 'TEMPORAL_PARSING' deve essere un oggetto");
  } else if (!['upcoming', 'strict_next_week'].includes(CONFIG.TEMPORAL_PARSING.nextWeekdayPolicy)) {
    errors.push("Errore Config: 'TEMPORAL_PARSING.nextWeekdayPolicy' deve essere 'upcoming' o 'strict_next_week'");
  }

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
  }

  if (!CONFIG.MODEL_STRATEGY || typeof CONFIG.MODEL_STRATEGY !== 'object') {
    errors.push("Errore Config: 'MODEL_STRATEGY' deve essere un oggetto");
  } else {
    const requiredTasks = ['generation', 'quick_check', 'classification', 'language', 'semantic'];
    for (const task of new Set([...requiredTasks, ...Object.keys(CONFIG.MODEL_STRATEGY)])) {
      const chain = CONFIG.MODEL_STRATEGY[task];
      if (!Array.isArray(chain) || !chain.length) {
        errors.push('Errore Config: MODEL_STRATEGY.' + task + ' deve essere un array non vuoto');
        continue;
      }
      for (const key of chain) {
        const model = CONFIG.GEMINI_MODELS && CONFIG.GEMINI_MODELS[key];
        if (!model || typeof model.name !== 'string' || !/^gemini-[a-z0-9._-]+$/i.test(model.name.trim())) {
          errors.push('Errore Config: modello ' + key + ' mancante o nome non valido per ' + task);
        }
      }
    }
  }

  // Deduplica solo i log nella stessa esecuzione; il risultato conserva tutti gli avvisi.
  const warningSignature = JSON.stringify(warnings);
  if (_lastConfigWarningSignature !== warningSignature) {
    warnings.forEach(message => console.warn('Configurazione: ' + message));
    _lastConfigWarningSignature = warningSignature;
  }
  // Se ci sono errori, logghiamoli subito
  if (errors.length > 0) {
    console.error("🚨 VALIDAZIONE CONFIGURAZIONE FALLITA 🚨");
    errors.forEach(e => console.error(`   - ${e}`));
  }

  return {
    valid: errors.length === 0,
    errors: errors,
    warnings: warnings
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
