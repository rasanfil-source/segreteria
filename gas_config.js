/**
 * Config.js - Configurazione centralizzata del sistema
 * Tutti i parametri configurabili sono definiti qui
 */

var _SCRIPT_PROPERTIES = null;
var _CACHED_PROPS = {};
function _getScriptProperty(key) {
  if (!_SCRIPT_PROPERTIES) {
    _SCRIPT_PROPERTIES = PropertiesService.getScriptProperties();
  }
  if (!(key in _CACHED_PROPS)) {
    _CACHED_PROPS[key] = _SCRIPT_PROPERTIES.getProperty(key);
  }
  return _CACHED_PROPS[key];
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
      return parsed.map(value => String(value || '').trim()).filter(Boolean);
    }
  } catch (e) {
    // Non JSON: accettiamo lista separata da virgola, punto e virgola o newline.
  }

  return String(raw)
    .split(/[,\n;]/)
    .map(value => value.trim())
    .filter(Boolean);
}

var CONFIG = {
  // === API ===
  get GEMINI_API_KEY() { return _getScriptProperty('GEMINI_API_KEY'); },
  MODEL_NAME: 'gemini-2.5-flash',

  // === Generazione ===
  TEMPERATURE: 0.5,
  MAX_OUTPUT_TOKENS: 6000,

  // === Validazione ===
  VALIDATION_ENABLED: true,
  VALIDATION_MIN_SCORE: 0.6,
  VALIDATION_WARNING_THRESHOLD: 0.9,  // Soglia warning sotto cui aggiungere etichetta Verifica
  VALIDATION_REVIEW_ALERTS: {
    enabled: true,
    cooldownSeconds: 3600,
    recipientProperty: 'VALIDATION_REVIEW_EMAIL'
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
  // === Retry Intelligente Post-Validazione ===
  INTELLIGENT_RETRY: {
    enabled: true,           // Abilita retry LLM su errori strutturali
    maxRetries: 1,           // Limite di esecuzione per sessione GAS
    minScoreToTrigger: 0.6,  // Soglia minima score per considerare retry non critici
    onlyForErrors: [         // Tipi di errore che giustificano una chiamata LLM
      'thinking_leak',
      'hallucination',
      'language',
      'placeholder',
      'length'
    ]
  },

  // === Gmail ===
  LABEL_NAME: 'IA',                    // Label per email processate
  ERROR_LABEL_NAME: 'Errore',          // Label per errori
  VALIDATION_ERROR_LABEL: 'Verifica',  // Label per risposte da rivedere
  SKIP_LABEL_NAME: '·',              // Label per email italiane saltate in modalità foreign_only
  DOCUMENT_CONSISTENCY_CHECK_ENABLED: true, // Abilita verifica coerenza tra email e allegati
  // Configurazione dei limiti operativi per garantire stabilità e rispetto delle quote.
  MAX_EMAILS_PER_RUN: 3,
  SAFETY_VALVE_THRESHOLD: 0.8,       // Regolazione batch in base al carico operativo RPD
  MAX_CONSECUTIVE_EXTERNAL: 5,        // Soglia per rilevamento email loop
  EMPTY_INBOX_WARNING_THRESHOLD: 5,   // Soglia per warning inbox vuota
  SUSPENSION_STALE_UNREAD_HOURS: 12,    // Garanzia di elaborazione dei messaggi non letti persistenti
  STRICT_SUSPENSION_CONFIG: false,    // Se true: foglio Controllo presente ma invalido => fallback SUSPENSION_HOURS (non 24/7)
  MIN_REMAINING_TIME_MS: 90000,      // Margine di sicurezza temporale per la sessione
  EXECUTION_LOCK_WAIT_MS: 5000,      // Timeout acquisizione lock esecuzione (ms)
  SEARCH_PAGE_SIZE: 15,              // Buffer discovery per candidati message-level (≈ 5x MAX_EMAILS_PER_RUN)
  // === DISCOVERY MODE ======================================================================
  // Modalità di scoperta messaggi non letti da elaborare.
  // - 'query'   : default operativo, message-level con query Gmail -label:...
  // - 'metadata': fallback prudente/manuale (list INBOX/UNREAD + get(minimal) per labelIds)
  // Configurato su 'query' per ottimizzare l'uso della quota API in lettura
  MESSAGE_DISCOVERY_MODE: 'query',
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
  GMAIL_LIST_MAX_PAGES: 20,            // Limite pagine Gmail list per bootstrap label cache
  GMAIL_LIST_MAX_MESSAGES: 2000,       // Limite messaggi Gmail list per bootstrap label cache
  BATCH_CHECKPOINT_TTL_MS: 10 * 60 * 1000, // Scadenza checkpoint resume (10 minuti)

  // === Alias noti (anti-loop: il bot riconosce sé stesso anche quando invia da alias) ===
  KNOWN_ALIASES: _getScriptPropertyStringArray('KNOWN_ALIASES', ['info@parrocchiasanteugenio.it']),

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

  // === Retry API Sheets ===
  SHEETS_RETRY_MAX: 3,                 // Tentativi massimi
  SHEETS_RETRY_BACKOFF_MS: 1000,       // Backoff iniziale (raddoppia ad ogni retry)

  // === Modalità ===
  DRY_RUN: false,                      // True per test senza invio email
  FORCE_RELOAD: false,                 // Forza ricaricamento cache KB
  USE_RATE_LIMITER: true,              // Rate limiter intelligente abilitato

  // === Limiti Token (Prompt Engine) ===
  MAX_SAFE_TOKENS: 35000,              // Limite massimo token per prompt (ricalibrato su nuove quote)
  KB_TOKEN_BUDGET_RATIO: 0.5,          // Percentuale budget KB rispetto a max token
  KB_HALLUCINATION_RISK_THRESHOLD: 8000, // Soglia chars KB oltre cui scatta hallucination_risk
  PROMPT_ENGINE: {
    OVERHEAD_TOKENS: 15000             // Riserva token per istruzioni/fixed context fuori KB
  },

  // === Limiti Thread ===
  MAX_THREAD_LENGTH: 8,                // Messaggi massimi per thread prima di anti-loop

  // === Logging ===
  LOGGING: {
    LEVEL: 'INFO',                     // DEBUG, INFO, WARN, ERROR
    STRUCTURED: true,                  // Log in formato JSON
    SEND_ERROR_NOTIFICATIONS: true,    // Invia email per errori critici
    ADMIN_EMAIL: 'rasanfil@gmail.com'  // Email admin per notifiche
  },

  // === Metriche Giornaliere ===
  // Configurare METRICS_SHEET_ID in Script Properties per abilitare export
  get METRICS_SHEET_ID() { return _getScriptProperty('METRICS_SHEET_ID'); },
  METRICS_SHEET_NAME: 'DailyMetrics',

  // === Modelli Gemini (configurazione centralizzata) ===
  // Aggiornato: Marzo 2026
  // ATTENZIONE: Non modificare arbitrariamente. Verificare periodicamente in rete i limiti delle quote gratuiti stabiliti, mantenendo proporzionalità con le quote di base.
  // Dati tecnici operativi (piano gratuito, 17/03/2026)
  // - Contesto massimo per prompt: 1.048.576 token (Flash / Flash-Lite)
  // - IPM: 2 immagini/minuto (Flash / Flash-Lite)
  // - Grounding Google Search: 500 richieste/giorno condivise tra modelli nel progetto
  // - Privacy: nel piano gratuito input/output possono essere usati per training Google (valutare impatto GDPR)
  GEMINI_FREE_TIER_NOTES: {
    contextWindowTokens: 1048576,
    ipm: 2,
    groundingSharedRpd: 500,
    dataUsedForTraining: true
  },

  GEMINI_MODELS: {
    // Modello premium: qualità massima per generazione risposte
    'flash-2.5': {
      name: 'gemini-2.5-flash',
      rpm: 10,
      tpm: 250000,
      rpd: 250,
      contextWindowTokens: 1048576,
      ipm: 2,
      useCases: ['generation']
    },
    // Modello workhorse: quick check e fallback
    'flash-lite': {
      name: 'gemini-2.5-flash-lite',
      rpm: 15,
      tpm: 250000,
      rpd: 1000,
      contextWindowTokens: 1048576,
      ipm: 2,
      useCases: ['quick_check', 'classification', 'semantic', 'fallback']
    },
    // Modello backup: variante 2.5 Lite
    'flash-2.5-lite-backup': {
      name: 'gemini-2.5-flash-lite',
      rpm: 15,
      tpm: 250000,
      rpd: 1000,
      contextWindowTokens: 1048576,
      ipm: 2,
      useCases: ['fallback']
    }
  },

  // Strategia selezione modelli per task (ordine = priorità)
  MODEL_STRATEGY: {
    'quick_check': ['flash-lite', 'flash-2.5'],
    'generation': ['flash-2.5', 'flash-lite', 'flash-2.5-lite-backup'],
    'semantic': ['flash-lite', 'flash-2.5-lite-backup'],
    'fallback': ['flash-lite', 'flash-2.5-lite-backup']
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
    'miqueldg63@gmail.com', 'rego.juan@gmail.com',
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
    'clicca qui', 'clicca su', 'non perdere', 'ultimi posti',
    'registrati gratuitamente', 'scarica il catalogo'
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
    if (typeof value === 'number' && (value < min || value > max)) {
      errors.push(`Errore Config: '${path}' (${value}) fuori range [${min}, ${max}]`);
    }
  };

  // 1. Validazione Campi Critici (fail-fast)
  if (!CONFIG.GEMINI_API_KEY) errors.push('CRITICO: GEMINI_API_KEY mancante');
  if (!CONFIG.SPREADSHEET_ID) errors.push('CRITICO: SPREADSHEET_ID mancante');

  // 2. Validazione Tipi e Valori Logici
  // API & Gen
  checkType('MODEL_NAME', CONFIG.MODEL_NAME, 'string');
  checkType('TEMPERATURE', CONFIG.TEMPERATURE, 'number');
  checkRange('TEMPERATURE', CONFIG.TEMPERATURE, 0.0, 1.0);
  checkType('MAX_OUTPUT_TOKENS', CONFIG.MAX_OUTPUT_TOKENS, 'number');

  // Gmail & Process
  checkType('MAX_EMAILS_PER_RUN', CONFIG.MAX_EMAILS_PER_RUN, 'number');
  checkRange('MAX_EMAILS_PER_RUN', CONFIG.MAX_EMAILS_PER_RUN, 1, 50); // Sanity check
  checkType('SAFETY_VALVE_THRESHOLD', CONFIG.SAFETY_VALVE_THRESHOLD, 'number');
  checkRange('SAFETY_VALVE_THRESHOLD', CONFIG.SAFETY_VALVE_THRESHOLD, 0.5, 0.99);
  checkType('LABEL_NAME', CONFIG.LABEL_NAME, 'string');
  checkType('ERROR_LABEL_NAME', CONFIG.ERROR_LABEL_NAME, 'string');
  checkType('VALIDATION_ERROR_LABEL', CONFIG.VALIDATION_ERROR_LABEL, 'string');
  checkType('SKIP_LABEL_NAME', CONFIG.SKIP_LABEL_NAME, 'string');
  checkType('MESSAGE_DISCOVERY_MODE', CONFIG.MESSAGE_DISCOVERY_MODE, 'string');
  if (!['metadata', 'query'].includes(CONFIG.MESSAGE_DISCOVERY_MODE)) {
    errors.push("Errore Config: 'MESSAGE_DISCOVERY_MODE' deve essere uno tra 'metadata', 'query'");
  }

  // Cache & Lock
  checkType('CACHE_LOCK_TTL', CONFIG.CACHE_LOCK_TTL, 'number');

  // Validation Logic
  checkType('VALIDATION_ENABLED', CONFIG.VALIDATION_ENABLED, 'boolean');
  checkType('VALIDATION_MIN_SCORE', CONFIG.VALIDATION_MIN_SCORE, 'number');
  checkRange('VALIDATION_MIN_SCORE', CONFIG.VALIDATION_MIN_SCORE, 0.0, 1.0);
  checkType('VALIDATION_WARNING_THRESHOLD', CONFIG.VALIDATION_WARNING_THRESHOLD, 'number');
  checkRange('VALIDATION_WARNING_THRESHOLD', CONFIG.VALIDATION_WARNING_THRESHOLD, 0.0, 1.0);

  // Retry Logic
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
    // Check esistenza modelli chiave
    if (!CONFIG.GEMINI_MODELS['flash-2.5']) errors.push("Errore Config: Modello 'flash-2.5' mancante in GEMINI_MODELS");
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
