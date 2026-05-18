/**
 * Config.gs - Configurazione centralizzata del sistema
 * Tutti i parametri configurabili sono definiti qui
 * 
 * NOTA: Configurazione base per repository. Valori sensibili vanno in Script Properties.
 * Le chiavi sensibili (API Key, Spreadsheet ID) sono rimosse o mascherate.
 */

var CONFIG = {
    // === API ===
    // In produzione: PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY')
    GEMINI_API_KEY: 'YOUR_GEMINI_API_KEY_HERE',
    MODEL_NAME: 'gemini-2.5-flash',

    // === Generazione ===
    TEMPERATURE: 0.5,
    MAX_OUTPUT_TOKENS: 6000,

    // === Validazione ===
    VALIDATION_ENABLED: true,
    VALIDATION_MIN_SCORE: 0.6,
    VALIDATION_WARNING_THRESHOLD: 0.9,
    VALIDATION_REVIEW_ALERTS: {
        enabled: true,
        cooldownSeconds: 3600,
        recipientProperty: 'VALIDATION_REVIEW_EMAIL',
        email: 'YOUR_ADMIN_EMAIL@example.com'
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
    maxRetries: 1,           // Mai più di 1: budget GAS limitato
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
    DOCUMENT_CONSISTENCY_CHECK_ENABLED: true, // Verifica coerenza tra email e allegati
    // Ridotto a 2 per supportare strategia "Cross-Key Quality First"
    // Fino a 4 chiamate API per email → batch ridotto per prevenire timeout GAS (6 min)
    MAX_EMAILS_PER_RUN: 2,
    SAFETY_VALVE_THRESHOLD: 0.8,       // Riduce dinamicamente il batch quando RPD supera l'80%
    MAX_CONSECUTIVE_EXTERNAL: 5,        // Soglia per rilevamento email loop
    EMPTY_INBOX_WARNING_THRESHOLD: 5,   // Soglia per warning inbox vuota
    SUSPENSION_STALE_UNREAD_HOURS: 12,    // Paracadute: processa unread vecchie anche in fascia sospesa
    STRICT_SUSPENSION_CONFIG: false,      // Se true: foglio Controllo presente ma invalido => fallback orari statici
    MIN_REMAINING_TIME_MS: 90000,       // Stop preventivo se resta meno di 90 secondi
    EXECUTION_LOCK_WAIT_MS: 1000,      // Timeout acquisizione lock esecuzione (ms)
    SEARCH_PAGE_SIZE: 15,              // Buffer discovery per candidati message-level (circa 5x MAX_EMAILS_PER_RUN)
    // === DISCOVERY MODE ======================================================================
    // Modalità di scoperta messaggi non letti da elaborare.
    // - 'query'   : default operativo, message-level con query Gmail -label:...
    // - 'metadata': fallback prudente/manuale (list INBOX/UNREAD + get(minimal) per labelIds)
    MESSAGE_DISCOVERY_MODE: 'query',
    // =========================================================================================
    MAX_EXECUTION_TIME_MS: 280000,    // Budget massimo per run (default GAS trigger ~6 minuti)
    GMAIL_LABEL_CACHE_TTL: 21600000,     // 6 ore in millisecondi
    MAX_HISTORY_MESSAGES: 8,             // Massimo messaggi in cronologia thread
    ATTACHMENT_CONTEXT: {
        enabled: true,                   // Includi testo allegati (PDF, immagini, Word, Excel, PowerPoint) nel prompt
        maxFiles: 3,                     // Numero massimo di allegati da processare (ridotto per payload multimodale)
        maxBytesPerFile: 3 * 1024 * 1024,// 3 MB per file (ridotto per payload Base64)
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
    OCR_ORPHAN_MAX_AGE_HOURS: 6,         // Età massima file OCR temporanei prima del cleanup
    OCR_CLEANUP_MAX_RUNTIME_MS: 8000,    // Limite durata cleanup file OCR orfani

    // === Token per tipo allegato (stima multimodale) ===
    ATTACHMENT_TOKEN_ESTIMATE: {
        image: 258,                      // Token stimati per immagine (Gemini Vision)
        pdf: 1032,                       // Token stimati per PDF
        defaultDoc: 1032                 // Token stimati per altri documenti
    },

    // === Cache e Lock ===
    CACHE_MAX_BYTES: 90 * 1024,          // Margine sotto 100KB/entry CacheService
    CACHE_LOCK_TTL: 310,                 // Secondi (>= MAX_EXECUTION_TIME_MS/1000 con margine)
    CACHE_RACE_SLEEP_MS: 200,             // Attesa anti-race condition
    DEBUG: false,                        // Log verbose: tenere false in produzione
    GMAIL_DAILY_CALL_LIMIT: 18000,        // Soft limit locale anti-burst prima del limite Gmail reale
    GMAIL_LIST_MAX_PAGES: 20,             // Limite pagine Gmail list per bootstrap label cache
    GMAIL_LIST_MAX_MESSAGES: 2000,        // Limite messaggi Gmail list per bootstrap label cache
    BATCH_CHECKPOINT_TTL_MS: 10 * 60 * 1000, // Scadenza checkpoint resume (10 minuti)

    // === Alias noti (anti-loop) ===
    // In produzione preferire Script Properties.KNOWN_ALIASES
    // Formati accettati: JSON array o lista separata da virgola/newline/punto e virgola.
    KNOWN_ALIASES: ['YOUR_SENDING_ALIAS@example.com'],

    // === Knowledge Base ===
    // In produzione: PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')
    SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID_HERE',
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
    CONTEXT_WINDOW_TOKENS: 1048576,      // Hard cap operativo condiviso dai modelli Flash configurati
    MAX_SAFE_TOKENS: 120000,             // Cap operativo locale sotto 1M per evitare payload GAS ingestibili
    MAX_SAFE_PROMPT_CHARS: 100000,       // Limite caratteri prompt prima del troncamento di sicurezza
    KB_TOKEN_BUDGET_RATIO: 0.5,          // Percentuale budget KB rispetto a max token
    KB_HALLUCINATION_RISK_THRESHOLD: 8000, // Soglia chars KB oltre cui scatta hallucination_risk
    MAX_PROVIDED_INFO_JSON_CHARS: 45000, // Limite serializzazione memoria providedInfo per riga Sheet
    PROMPT_ENGINE: {
        OVERHEAD_TOKENS: 15000           // Riserva token per istruzioni/fixed context fuori KB
    },

    // === Limiti Thread ===
    MAX_THREAD_LENGTH: 8,                // Messaggi massimi per thread prima di anti-loop

    // === Logging ===
    LOGGING: {
        LEVEL: 'INFO',                     // DEBUG, INFO, WARN, ERROR
        STRUCTURED: true,                  // Log in formato JSON
        SEND_ERROR_NOTIFICATIONS: true,    // Invia email per errori critici
        ADMIN_EMAIL: 'YOUR_ADMIN_EMAIL_HERE'  // Placeholder: preferire Script Properties.ADMIN_EMAIL
    },

    // === Metriche Giornaliere ===
    // Configurare METRICS_SHEET_ID in Script Properties per abilitare export
    METRICS_SHEET_ID: 'YOUR_METRICS_SHEET_ID_HERE',
    METRICS_SHEET_NAME: 'DailyMetrics',

    // === Modelli Gemini (configurazione centralizzata) ===
    // Aggiornato: Maggio 2026.
    // Policy: 2.5 Flash per risposte finali; 3.1 Flash-Lite per task rapidi/ausiliari.
    // Dati tecnici operativi Free Tier: verificare sempre i limiti effettivi in AI Studio.
    GEMINI_FREE_TIER_NOTES: {
        contextWindowTokens: 1048576,
        rpm: 2000,
        tpm: 2000000,
        rpd: 3500,
        ipm: null,
        groundingSharedRpd: 1500,
        countTokensApiAllowed: false,
        contextCachingSupported: false,
        dataUsedForTraining: true
    },

    GEMINI_CONTEXT_CACHE: {
        // Free Tier: lasciare false salvo disponibilità esplicita in AI Studio.
        // Il servizio degrada comunque a generateContent diretto se cachedContents non è disponibile.
        enabled: false,
        ttlSeconds: 3300,
        expirySkewMs: 90000,
        minCacheableTokens: 1024,
        splitMarker: '**EMAIL DA RISPONDERE:**',
        propertyPrefix: 'gemini_context_cache_v2_',
        googleSearchGrounding: {
            enabled: false,
            reservedQueriesPerRequest: 1
        }
    },

    GEMINI_BACKOFF: {
        maxRetries: 2,
        retryDelayMs: 4000,
        factor: 2.5,
        maxBackoffMs: 120000,
        jitterMs: 750,
        rateLimiterMaxRetries: 2
    },

    GEMINI_MODELS: {
        'flash-2.5': {
            name: 'gemini-2.5-flash',
            rpm: 10,
            tpm: 250000,
            rpd: 250,
            contextWindowTokens: 1048576,
            ipm: null,
            useCases: ['generation', 'all']
        },
        'flash-2.5-backup': {
            name: 'gemini-2.5-flash',
            rpm: 10,
            tpm: 250000,
            rpd: 250,
            contextWindowTokens: 1048576,
            ipm: null,
            useCases: ['generation', 'backup']
        },
        'flash-lite': {
            name: 'gemini-3.1-flash-lite',
            rpm: 2000,
            tpm: 2000000,
            rpd: 3500,
            contextWindowTokens: 1048576,
            ipm: null,
            useCases: ['quick_check', 'classification', 'language', 'semantic', 'newsletter_summary', 'fallback']
        },
        'flash-3.1-lite': {
            name: 'gemini-3.1-flash-lite',
            rpm: 2000,
            tpm: 2000000,
            rpd: 3500,
            contextWindowTokens: 1048576,
            ipm: null,
            useCases: ['quick_check', 'classification', 'language', 'semantic', 'newsletter_summary', 'fallback']
        },
        'flash-3.1-lite-backup': {
            name: 'gemini-3.1-flash-lite',
            rpm: 2000,
            tpm: 2000000,
            rpd: 3500,
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
        'generation': ['flash-2.5', 'flash-2.5-backup', 'flash-lite', 'flash-3.1-lite-backup'],
        'semantic': ['flash-lite', 'flash-3.1-lite-backup'],
        'fallback': ['flash-lite', 'flash-3.1-lite-backup']
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
// MARCATORI LINGUA
// ====================================================================
// NOTA: non dichiarare LANGUAGE_MARKERS qui per evitare doppia dichiarazione
// quando questo file è caricato insieme a gas_config.js in runtime GAS.
