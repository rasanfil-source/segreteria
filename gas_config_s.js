/**
 * Config.gs - Configurazione centralizzata del sistema
 * Tutti i parametri configurabili sono definiti qui
 * 
 * NOTA: Questa è una versione SANITIZZATA per GitHub.
 * Le chiavi sensibili (API Key, Spreadsheet ID) sono rimosse o mascherate.
 */

const CONFIG = {
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
    MAX_EMAILS_PER_RUN: 3,
    GMAIL_LABEL_CACHE_TTL: 3600000,      // 1 ora in millisecondi
    MAX_HISTORY_MESSAGES: 10,            // Massimo messaggi in cronologia thread
    ATTACHMENT_CONTEXT: {
        enabled: true,                   // Includi OCR allegati (PDF e immagini) nel prompt
        maxFiles: 4,                     // Numero massimo di allegati da processare
        maxBytesPerFile: 5 * 1024 * 1024,// 5 MB per file
        maxCharsPerFile: 4000,           // Limite testo per singolo allegato
        maxTotalChars: 12000,            // Limite totale testo allegati
        ocrLanguage: 'it',               // Lingua OCR (Drive Advanced API)
        pdfMaxPages: 2,                  // Limite pagine PDF (stima via OCR)
        pdfCharsPerPage: 1800            // Stima caratteri per pagina PDF
    },

    // === Cache e Lock ===
    CACHE_LOCK_TTL: 30,                  // Secondi (CacheService usa secondi)
    CACHE_RACE_SLEEP_MS: 50,             // Attesa anti-race condition

    // === Knowledge Base ===
    // In produzione: PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')
    SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID_HERE',
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
        ADMIN_EMAIL: 'admin@example.com'   // Email admin per notifiche
    },

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
    'es': ['gracias', 'saludos', 'estimado', 'parroquia', 'misa', 'iglesia', 'querría', 'buenos', 'días'],
    'fr': ['merci', 'cordialement', 'cher', 'paroisse', 'messe', 'église', 'voudrais', 'pourrais', 'bonjour', 'bonsoir'],
    'de': ['danke', 'grüße', 'liebe', 'pfarrei', 'messe', 'kirche', 'möchte', 'könnte', 'bitte', 'guten']
};
