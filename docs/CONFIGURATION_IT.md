# Configurazione Avanzata

[![English Version](https://img.shields.io/badge/English-Version-blue?style=flat-square)](CONFIGURATION.md)

Questo documento descrive i parametri di configurazione disponibili nel file `gas_config.js`.
Usa `gas_config.example.js` come template nel repository e crea il file locale `gas_config.js` per i valori runtime.

## Configurazione Principale (`CONFIG`)

### Impostazioni API
- **GEMINI_API_KEY**: La tua chiave API Gemini (salvata nelle Proprietà dello Script).
- **MODEL_NAME**: Modello predefinito per la generazione qualità (attuale `gemini-3.5-flash`).
- **GEMINI_CONTEXT_CACHE**: Di default è disabilitata per Free Tier. Abilitala solo se AI Studio mostra `cachedContents` disponibile per il progetto; se l'endpoint non è disponibile, il servizio degrada a `generateContent` diretto.
- **GEMINI_FREE_TIER_NOTES**: Profilo quote locale per i task rapidi su Gemini 3.1 Flash-Lite; per la generazione qualità il sistema parte da Gemini 3.5 Flash. Verifica sempre i limiti effettivi in AI Studio.

### Gmail e Processamento
- **LABEL_NAME**: `IA` (Email processate con successo).
- **ERROR_LABEL_NAME**: `Errore` (Elaborazione fallita).
- **VALIDATION_ERROR_LABEL**: `Verifica` (Richiede revisione umana).
- **SKIP_LABEL_NAME**: `·` (Email italiane saltate quando è attiva la modalità `foreign_only`).
- **MAX_EMAILS_PER_RUN**: `2` (Numero massimo di email per esecuzione per evitare timeout). Impostalo a `0` per sospendere temporaneamente l'elaborazione senza fare discovery Gmail.
- **MESSAGE_DISCOVERY_MODE**: `metadata` (Discovery message-level predefinita via list/get metadata Gmail; `query` resta il fallback legacy).

### Knowledge Base (Google Sheets)
- **SPREADSHEET_ID**: ID del tuo foglio Google (salvato nelle Proprietà dello Script).
- **Nomi Fogli**:
    - `KB_SHEET_NAME`: Istruzioni e info generali.
    - `AI_CORE_LITE_SHEET`: Info tecniche/semplici.
    - `AI_CORE_SHEET`: Info pastorali profonde.
    - `DOCTRINE_SHEET`: Riferimenti dottrinali.
    - `MEMORY_SHEET_NAME`: Memoria conversazioni.

### Funzionalità
- **DRY_RUN**: `false` (Imposta a `true` per testare senza inviare email reali).
- **USE_RATE_LIMITER**: `true` (Abilita il limitatore di velocità intelligente).
- **VALIDATION_ENABLED**: `true` (Abilita il controllo qualità sulle risposte).

### Configurazione Modelli Gemini
Il sistema usa una strategia per selezionare i modelli:
1. **flash-3.5**: Percorso principale per generare risposte finali di qualità.
2. **flash-3.5-backup**: Stesso modello qualità su chiave di riserva.
3. **flash-lite / flash-3.5-lite**: Controlli rapidi, categoria, lingua AI, controlli semantici e scarti newsletter.
4. **flash-3.5-lite-backup**: Fallback lite su chiave di riserva.

## Proprietà dello Script
Questi valori devono essere impostati in **Impostazioni Progetto > Proprietà dello Script**:
- `GEMINI_API_KEY`
- `SPREADSHEET_ID`
- `METRICS_SHEET_ID` (Opzionale, per statistiche giornaliere)
- `ADMIN_EMAIL` (Opzionale, notifiche errori critici)
- `VALIDATION_REVIEW_EMAIL` (Opzionale, alert di validazione per revisione umana)

## OCR Allegati (`ATTACHMENT_CONTEXT`)

> **Prerequisito**: Abilitare il **Drive Advanced Service** nell'editor dello script e la **Drive API** nel progetto GCP collegato.

Questa funzionalità estrae il testo da allegati PDF e immagini utilizzando l'OCR integrato di Google Drive, includendo poi il testo nel prompt per l'analisi.

### Parametri
| Parametro | Default | Descrizione |
|-----------|---------|-------------|
| `enabled` | `true` | Abilita/disabilita l'elaborazione OCR degli allegati |
| `maxFiles` | `3` | Numero massimo di allegati da processare per email |
| `maxBytesPerFile` | `3MB` | Dimensione massima per allegato |
| `maxMessageBytesForAttachmentDownload` | `25MB` | Dimensione massima stimata del messaggio prima di scaricare gli allegati |
| `maxCharsPerFile` | `3000` | Caratteri massimi estratti per file |
| `maxTotalChars` | `9000` | Caratteri totali massimi da tutti gli allegati |
| `ocrLanguage` | `'it'` | Codice lingua OCR (può essere sovrascritto dinamicamente con lingua email rilevata) |
| `ocrConfidenceWarningThreshold` | `0.8` | Soglia minima di affidabilità OCR per aggiungere una nota di leggibilità in risposta |
| `pdfMaxPages` | `2` | Limite pagine stimato per PDF |
| `pdfCharsPerPage` | `1800` | Caratteri stimati per pagina PDF |
| `ocrTriggerKeywords` | `iban`, `bonifico`, `ricevuta`, `documento`, `allego`, `in allegato`, `coordinate`, `modulo` | Keyword che attivano OCR quando il body è rilevante |
| `ibanFocusEnabled` | `true` | Riduce il contesto OCR attorno all'IBAN quando viene rilevato |
| `maxCharsWhenKbTruncated` | `1500` | Limite più prudente per allegati quando la KB è già troncata |

### Tipi di File Supportati
- **Documenti PDF** (`.pdf`)
- **Immagini** (`.jpg`, `.png`, `.gif`, `.bmp`, ecc.)

### Funzionamento
1. Il sistema carica l'allegato su Google Drive con OCR abilitato
2. Drive converte automaticamente il file in un Google Doc con testo estratto
3. Il testo viene recuperato e il file temporaneo eliminato
4. Il testo estratto viene incluso nel prompt come contesto

## Soglie di Validazione
- **VALIDATION_MIN_SCORE**: `0.6` (Punteggio minimo per invio automatico). Abbassalo a 0.5 se troppe email vengono marcate come "Verifica".

