/**
 * CONFIG_TEMPLATE.txt
 * 
 * Template per compilazione rapida Config.gs
 * Copia questo contenuto e sostituisci i valori segnaposto
 */

// =============================================================================
// SEZIONE 1: INFORMAZIONI PROGETTO
// =============================================================================

PROJECT_NAME: 'Autoresponder System'
SCRIPT_ID: 'AKfyc...'  // ID dello script GAS (opzionale)
GCP_PROJECT_ID: 'project-id-12345'  // Opzionale

// =============================================================================
// SEZIONE 2: API GEMINI (OBBLIGATORIO)
// =============================================================================

GEMINI_API_KEY: 'AIza...'  // ⚠️ OBBLIGATORIO - Ottieni da Google AI Studio
MODEL_PRIMARY: 'gemini-1.5-pro'  // Modello principale
MODEL_FALLBACK: 'gemini-1.5-flash'  // Modello fallback (più veloce/economico)

// Rate Limits (adatta in base al tuo piano API)
RPM: 60  // Requests per minute
TPM: 1000000  // Tokens per minute
RPD: 1500  // Requests per day

// Parametri generazione
TEMPERATURE: 0.7  // 0.0-1.0, più alto = più creativo
MAX_OUTPUT_TOKENS: 2048
TOP_P: 0.95
TOP_K: 40

// =============================================================================
// SEZIONE 3: KNOWLEDGE BASE (OBBLIGATORIO)
// =============================================================================

KB_SHEET_ID: '1ABC...XYZ'  // ⚠️ OBBLIGATORIO - ID Google Sheet per KB
KB_LITE_SHEET_NAME: 'KB_Lite'  // Nome foglio KB leggera
KB_STANDARD_SHEET_NAME: 'KB_Standard'  // Nome foglio KB standard
KB_HEAVY_SHEET_NAME: 'KB_Heavy'  // Nome foglio KB completa

// Durata cache KB (millisecondi)
KB_CACHE_DURATION_MS: 3600000  // 1 ora

// =============================================================================
// SEZIONE 4: MEMORIA CONVERSAZIONALE
// =============================================================================

MEMORY_ENABLED: true  // true/false - Abilita memoria
MEMORY_SHEET_ID: '1DEF...UVW'  // ID Google Sheet per memoria
MEMORY_SHEET_NAME: 'ConversationMemory'  // Nome foglio
MEMORY_MAX_HISTORY: 5  // Numero max messaggi storici da considerare
MEMORY_RETENTION_DAYS: 30  // Giorni di retention

// =============================================================================
// SEZIONE 5: TRIGGER E ESECUZIONE
// =============================================================================

TRIGGER_INTERVAL_MINUTES: 10  // Intervallo trigger (5, 10, 15, 30)
MAX_THREADS_PER_RUN: 50  // Max thread da processare per esecuzione
MAX_EXECUTION_TIME_MS: 300000  // Timeout esecuzione (5 minuti)

// =============================================================================
// SEZIONE 6: ORARI DI LAVORO E FESTIVITÀ
// =============================================================================

WORKING_HOURS_START: 8  // Ora inizio (0-23)
WORKING_HOURS_END: 20  // Ora fine (0-23)
TIMEZONE: 'Europe/Rome'  // Timezone
PAUSE_OUTSIDE_HOURS: false  // true = pausa fuori orario
PAUSE_ON_HOLIDAYS: false  // true = pausa durante festività

HOLIDAY_CALENDAR_ID: ''  // ID calendario Google (opzionale)
// Esempio: 'it.italian#holiday@group.v.calendar.google.com'

// =============================================================================
// SEZIONE 7: FILTRI EMAIL
// =============================================================================

// Domini da ignorare (anche parziali)
IGNORED_DOMAINS: [
  'noreply',
  'no-reply',
  'mailer-daemon',
  'postmaster',
  'bounce',
  'automated'
]

// Parole chiave da ignorare (case-insensitive)
IGNORED_KEYWORDS: [
  'unsubscribe',
  'out of office',
  'automatic reply',
  'autoreply',
  'risposta automatica',
  'fuori ufficio'
]

// Limiti lunghezza messaggi
MIN_MESSAGE_LENGTH: 10
MAX_MESSAGE_LENGTH: 50000

// Acknowledgment detection
ACKNOWLEDGMENT_MAX_LENGTH: 50
ACKNOWLEDGMENT_KEYWORDS: ['grazie', 'thanks', 'ok', 'ricevuto', 'received']

// =============================================================================
// SEZIONE 8: CLASSIFICAZIONE
// =============================================================================

// Tipi di richiesta disponibili
TYPES: {
  TECHNICAL: 'technical',
  PASTORAL: 'pastoral',
  DOCTRINAL: 'doctrinal',
  MIXED: 'mixed',
  SIMPLE: 'simple'
}

// Mapping tipo -> livello KB
KB_MAPPING: {
  technical: 'HEAVY',
  pastoral: 'STANDARD',
  doctrinal: 'HEAVY',
  mixed: 'STANDARD',
  simple: 'LITE'
}

// =============================================================================
// SEZIONE 9: LINGUE SUPPORTATE
// =============================================================================

SUPPORTED_LANGUAGES: ['it', 'en', 'es', 'fr', 'de']
DEFAULT_LANGUAGE: 'it'

// =============================================================================
// SEZIONE 10: VALIDAZIONE RISPOSTE
// =============================================================================

VALIDATION_MIN_LENGTH: 50  // Caratteri minimi risposta
VALIDATION_MAX_LENGTH: 5000  // Caratteri massimi risposta

// Elementi richiesti nella risposta
REQUIRED_GREETING: true
REQUIRED_SIGNATURE: false  // Firma aggiunta automaticamente
REQUIRED_CONTENT: true

// Pattern da evitare nelle risposte
FORBIDDEN_PATTERNS: [
  /\[.*\]/,  // [placeholder text]
  /TODO/i,
  /XXX/i,
  /FIXME/i
]

// =============================================================================
// SEZIONE 11: GMAIL LABELS (OBBLIGATORIO)
// =============================================================================

LABEL_PROCESSED: 'AI/Processed'  // ⚠️ Label per email processate
LABEL_ERROR: 'AI/Error'  // ⚠️ Label per errori
LABEL_SKIPPED: 'AI/Skipped'  // ⚠️ Label per email saltate
LABEL_NEEDS_REVIEW: 'AI/NeedsReview'  // Label per risposte da rivedere

// =============================================================================
// SEZIONE 12: CONFIGURAZIONE RISPOSTA
// =============================================================================

REPLY_SENDER_NAME: 'Assistente Virtuale'  // Nome mittente risposta
REPLY_SIGNATURE: `
---
Assistente Virtuale
Email automatica generata con AI
Per assistenza: support@example.com
`  // Firma email (lascia vuoto per disabilitare)

INCLUDE_ORIGINAL: false  // Include messaggio originale in risposta
MARK_AS_READ: true  // Marca thread come letto dopo risposta

// =============================================================================
// SEZIONE 13: LOGGING E NOTIFICHE
// =============================================================================

LOG_LEVEL: 'INFO'  // DEBUG, INFO, WARN, ERROR
STRUCTURED_LOGGING: true  // Log formato JSON
ADMIN_EMAIL: 'admin@example.com'  // Email per notifiche errori critici
SEND_ERROR_NOTIFICATIONS: true  // Invia notifiche via email

// =============================================================================
// ESEMPIO CONFIGURAZIONE COMPLETA MINIMA
// =============================================================================

/*
Per iniziare rapidamente, compila almeno questi campi:

const CONFIG = {
  PROJECT_NAME: 'Autoresponder System',
  
  GEMINI: {
    API_KEY: 'TUA_API_KEY_QUI',
    MODEL_PRIMARY: 'gemini-1.5-pro',
    MODEL_FALLBACK: 'gemini-1.5-flash'
  },
  
  KB: {
    SHEET_ID: 'ID_SHEET_KB',
    SHEETS: {
      LITE: 'KB_Lite',
      STANDARD: 'KB_Standard',
      HEAVY: 'KB_Heavy'
    }
  },
  
  MEMORY: {
    ENABLED: true,
    SHEET_ID: 'ID_SHEET_MEMORIA',
    SHEET_NAME: 'ConversationMemory'
  },
  
  LABELS: {
    PROCESSED: 'AI/Processed',
    ERROR: 'AI/Error',
    SKIPPED: 'AI/Skipped'
  },
  
  REPLY: {
    SENDER_NAME: 'Assistente Virtuale'
  }
};
*/

// =============================================================================
// CHECKLIST PRE-DEPLOYMENT
// =============================================================================

/*
Prima di attivare il sistema, verifica:

☐ API_KEY Gemini configurata e valida
☐ KB_SHEET_ID configurato e accessibile
☐ MEMORY_SHEET_ID configurato (se MEMORY_ENABLED=true)
☐ Tutti i nomi fogli KB esistono nello Sheet
☐ Labels Gmail configurate
☐ ADMIN_EMAIL configurata per notifiche
☐ Rate limits appropriati per il tuo piano API
☐ Filtri testati e appropriati
☐ Eseguito validateConfig() senza errori
☐ Eseguito healthCheck() con successo
☐ Testato con email di prova

Per testare la configurazione:
1. Apri Script Editor
2. Esegui: validateConfig()
3. Esegui: healthCheck()
4. Se entrambi OK, esegui: testRun()
*/

// =============================================================================
// NOTE SICUREZZA
// =============================================================================

/*
⚠️ IMPORTANTE:

1. NON condividere questo file con API key configurata
2. NON committare API key in repository pubblici
3. Usa Properties Service per dati sensibili in produzione:
   
   PropertiesService.getScriptProperties().setProperty('GEMINI_API_KEY', 'key');
   const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');

4. Limita accesso agli Sheet KB e Memoria
5. Monitora utilizzo API per evitare costi inattesi
6. Testa sempre in ambiente separato prima di produzione
*/