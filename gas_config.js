/**
 * Config.js - Configurazione centralizzata del sistema
 * Tutti i parametri configurabili sono definiti qui
 */

const CONFIG = {
  // === API ===
  GEMINI_API_KEY: PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY'),
  MODEL_NAME: 'gemini-2.5-flash',

  // === Generazione ===
  TEMPERATURE: 0.5,
  MAX_OUTPUT_TOKENS: 6000,

  // === Validazione ===
  VALIDATION_ENABLED: true,
  VALIDATION_MIN_SCORE: 0.6,
  VALIDATION_STRICT_MODE: false,
  SEMANTIC_VALIDATION: {
    enabled: true,
    activationThreshold: 0.9,
    cacheEnabled: true,
    cacheTTL: 300,
    taskType: 'semantic',
    maxRetries: 1,
    fallbackOnError: true
  },

  // === Gmail ===
  LABEL_NAME: 'IA',                    // Label per email processate
  ERROR_LABEL_NAME: 'Errore',          // Label per errori
  VALIDATION_ERROR_LABEL: 'Verifica',  // Label per risposte da rivedere
  // Ridotto a 3 per supportare strategia "Cross-Key Quality First"
  // Fino a 4 chiamate API per email → batch ridotto per prevenire timeout GAS (6 min)
  MAX_EMAILS_PER_RUN: 5,
  GMAIL_LABEL_CACHE_TTL: 3600000,      // 1 ora in millisecondi
  MAX_HISTORY_MESSAGES: 10,            // Massimo messaggi in cronologia thread

  // === Cache e Lock ===
  CACHE_LOCK_TTL: 30,                  // Secondi (CacheService usa secondi)
  CACHE_RACE_SLEEP_MS: 50,             // Attesa anti-race condition

  // === Knowledge Base ===
  SPREADSHEET_ID: PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'),
  KB_SHEET_NAME: 'Istruzioni',
  AI_CORE_LITE_SHEET: 'AI_CORE_LITE',
  AI_CORE_SHEET: 'AI_CORE',
  DOCTRINE_SHEET: 'Dottrina',
  REPLACEMENTS_SHEET_NAME: 'Sostituzioni',
  MEMORY_SHEET_NAME: 'ConversationMemory',
  MAX_PROVIDED_TOPICS: 50,             // Limite massimo topic in memoria
  MEMORY_LOCK_TTL: 10,                 // Lock TTL in secondi per MemoryService

  // === Retry API Sheets ===
  SHEETS_RETRY_MAX: 3,                 // Tentativi massimi
  SHEETS_RETRY_BACKOFF_MS: 1000,       // Backoff iniziale (raddoppia ad ogni retry)

  // === Modalità ===
  DRY_RUN: false,                      // True per test senza invio email
  FORCE_RELOAD: false,                 // Forza ricaricamento cache KB
  USE_RATE_LIMITER: true,              // Rate limiter intelligente abilitato

  // === Limiti Token (Prompt Engine) ===
  MAX_SAFE_TOKENS: 100000,             // Limite massimo token per prompt
  KB_TOKEN_BUDGET_RATIO: 0.5,          // Percentuale budget KB rispetto a max token

  // === Limiti Thread ===
  MAX_THREAD_LENGTH: 10,               // Messaggi massimi per thread prima di anti-loop

  // === Logging ===
  LOGGING: {
    LEVEL: 'INFO',                     // DEBUG, INFO, WARN, ERROR
    STRUCTURED: true,                  // Log in formato JSON
    SEND_ERROR_NOTIFICATIONS: false,   // Invia email per errori critici
    ADMIN_EMAIL: ''                    // Email admin per notifiche
  },

  // === Metriche Giornaliere ===
  // Configurare METRICS_SHEET_ID in Script Properties per abilitare export
  METRICS_SHEET_ID: PropertiesService.getScriptProperties().getProperty('METRICS_SHEET_ID'),
  METRICS_SHEET_NAME: 'DailyMetrics',

  // === Modelli Gemini (configurazione centralizzata) ===
  // Aggiornato: Gennaio 2026
  GEMINI_MODELS: {
    // Modello premium: qualità massima per generazione risposte
    'flash-2.5': {
      name: 'gemini-2.5-flash',
      rpm: 10,        // Richieste per minuto
      tpm: 250000,    // Token per minuto
      rpd: 250,       // Richieste per giorno
      useCases: ['generation']
    },
    // Modello workhorse: quick check e fallback
    'flash-lite': {
      name: 'gemini-2.5-flash-lite',
      rpm: 15,
      tpm: 250000,
      rpd: 1000,
      useCases: ['quick_check', 'classification', 'semantic', 'fallback']
    },
    // Modello legacy: backup se tutto esaurito
    'flash-2.0': {
      name: 'gemini-2.0-flash',
      rpm: 5,
      tpm: 250000,
      rpd: 100,
      useCases: ['fallback']
    }
  },

  // Strategia selezione modelli per task (ordine = priorità)
  MODEL_STRATEGY: {
    'quick_check': ['flash-lite', 'flash-2.0'],
    'generation': ['flash-2.5', 'flash-lite', 'flash-2.0'],
    'semantic': ['flash-lite', 'flash-2.0'],
    'fallback': ['flash-lite', 'flash-2.0']
  },

  // === Liste di esclusione ===
  IGNORE_DOMAINS: [
    'noreply', 'no-reply', 'newsletter', 'marketing',
    'promo', 'ads', 'notifications',
    'amazon.com', 'eventbrite.com', 'paypal.com', 'ebay.com',
    'subito.it', 'mailchimp.com', 'mailup.com',
    'unclickperlascuolaelosport.it', 'sendinblue.com',
    'miqueldg63@gmail.com', 'rego.juan@gmail.com'
  ],
  IGNORE_KEYWORDS: [
    'unsubscribe', 'opt-out', 'newsletter',
    'disiscriviti', 'disiscrizione', 'annulla iscrizione',
    'annulla l\'iscrizione', 'gestisci la tua iscrizione',
    'gestisci le tue preferenze', 'aggiorna le tue preferenze',
    'cancella iscrizione', 'mailing list', 'inviato con mailup',
    'messaggio inviato con', 'non rispondere a questo messaggio',
    'avviso di sicurezza'
  ]
};

// ====================================================================
// MARCATORI LINGUA (costante condivisa tra moduli)
// ====================================================================

const LANGUAGE_MARKERS = {
  'it': ['grazie', 'cordiali', 'saluti', 'gentile', 'parrocchia', 'messa', 'vorrei', 'quando', 'buongiorno', 'buonasera'],
  'en': ['thank', 'regards', 'dear', 'parish', 'mass', 'church', 'would', 'could', 'please', 'sincerely'],
  'es': ['gracias', 'saludos', 'estimado', 'parroquia', 'misa', 'iglesia', 'querría', 'buenos', 'días']
};

// ====================================================================
// CACHE GLOBALE (popolata da loadResources)
// ====================================================================

var GLOBAL_CACHE = {
  knowledgeBase: '',
  knowledgeStructured: [],
  aiCoreLite: '',
  aiCoreLiteStructured: [],
  aiCore: '',
  aiCoreStructured: [],
  doctrineBase: '',
  doctrineStructured: [],
  ignoreDomains: CONFIG.IGNORE_DOMAINS,
  ignoreKeywords: CONFIG.IGNORE_KEYWORDS,
  replacements: {},
  vacationPeriods: [],
  loaded: false
};

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
      errors.push(`Config Error: '${path}' deve essere di tipo ${expectedType}, trovato ${typeof value}`);
    }
  };

  // Helper per validazione range
  const checkRange = (path, value, min, max) => {
    if (typeof value === 'number' && (value < min || value > max)) {
      errors.push(`Config Error: '${path}' (${value}) fuori range [${min}, ${max}]`);
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
  checkType('LABEL_NAME', CONFIG.LABEL_NAME, 'string');

  // Cache & Lock
  checkType('CACHE_LOCK_TTL', CONFIG.CACHE_LOCK_TTL, 'number');

  // Validation Logic
  checkType('VALIDATION_ENABLED', CONFIG.VALIDATION_ENABLED, 'boolean');
  checkType('VALIDATION_MIN_SCORE', CONFIG.VALIDATION_MIN_SCORE, 'number');
  checkRange('VALIDATION_MIN_SCORE', CONFIG.VALIDATION_MIN_SCORE, 0.0, 1.0);

  // Arrays
  if (!Array.isArray(CONFIG.IGNORE_DOMAINS)) errors.push("Config Error: 'IGNORE_DOMAINS' deve essere un array");
  if (!Array.isArray(CONFIG.IGNORE_KEYWORDS)) errors.push("Config Error: 'IGNORE_KEYWORDS' deve essere un array");

  // 3. Validazione Strutturale Oggetti
  if (!CONFIG.GEMINI_MODELS || typeof CONFIG.GEMINI_MODELS !== 'object') {
    errors.push("Config Error: 'GEMINI_MODELS' deve essere un oggetto");
  } else {
    // Check esistenza modelli chiave
    if (!CONFIG.GEMINI_MODELS['flash-2.5']) errors.push("Config Error: Modello 'flash-2.5' mancante in GEMINI_MODELS");
  }

  // Se ci sono errori, logghiamoli subito in console in modo visibile
  if (errors.length > 0) {
    console.error("🚨 CONFIGURATION VALIDATION FAILED 🚨");
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