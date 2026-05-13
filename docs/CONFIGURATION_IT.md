# Configurazione Avanzata

[![English Version](https://img.shields.io/badge/English-Version-blue?style=flat-square)](CONFIGURATION.md)

Questo documento descrive i parametri di configurazione disponibili nel file `gas_config.js`.
Usa `gas_config.example.js` come template nel repository e crea il file locale `gas_config.js` per i valori runtime.

## Configurazione Principale (`CONFIG`)

### Impostazioni API
- **GEMINI_API_KEY**: La tua chiave API Gemini (salvata nelle Proprietà dello Script).
- **MODEL_NAME**: Modello predefinito (attuale `gemini-3.1-flash-lite`).
- **GEMINI_CONTEXT_CACHE**: Di default è disabilitata per Free Tier. Abilitala solo se AI Studio mostra `cachedContents` disponibile per il progetto; se l'endpoint non è disponibile, il servizio degrada a `generateContent` diretto.
- **GEMINI_FREE_TIER_NOTES**: Profilo quote locale per Gemini 3.1 Flash-Lite Free Tier: 2.000 RPM, 2.000.000 TPM e 3.500 RPD. Il collo di bottiglia operativo resta RPD; Google Search Grounding resta disabilitato salvo disponibilità esplicita in AI Studio.

### Gmail e Processamento
- **LABEL_NAME**: `IA` (Email processate con successo).
- **ERROR_LABEL_NAME**: `Errore` (Elaborazione fallita).
- **VALIDATION_ERROR_LABEL**: `Verifica` (Richiede revisione umana).
- **MAX_EMAILS_PER_RUN**: `3` (Numero massimo di email per esecuzione per evitare timeout).

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
1. **flash-3.1-lite**: Percorso logico principale per generare risposte.
2. **flash-lite**: Alias compatibile per controlli rapidi, classificazione, controlli semantici e fallback.
3. **flash-3.1-lite-backup**: Percorso logico di backup per fallback cross-key.

## Proprietà dello Script
Questi valori devono essere impostati in **Impostazioni Progetto > Proprietà dello Script**:
- `GEMINI_API_KEY`
- `SPREADSHEET_ID`
- `METRICS_SHEET_ID` (Opzionale, per statistiche giornaliere)

## OCR Allegati (`ATTACHMENT_CONTEXT`)

> **Prerequisito**: Abilitare il **Drive Advanced Service** nell'editor dello script e la **Drive API** nel progetto GCP collegato.

Questa funzionalità estrae il testo da allegati PDF e immagini utilizzando l'OCR integrato di Google Drive, includendo poi il testo nel prompt per l'analisi.

### Parametri
| Parametro | Default | Descrizione |
|-----------|---------|-------------|
| `enabled` | `true` | Abilita/disabilita l'elaborazione OCR degli allegati |
| `maxFiles` | `4` | Numero massimo di allegati da processare per email |
| `maxBytesPerFile` | `5MB` | Dimensione massima per allegato |
| `maxCharsPerFile` | `4000` | Caratteri massimi estratti per file |
| `maxTotalChars` | `12000` | Caratteri totali massimi da tutti gli allegati |
| `ocrLanguage` | `'it'` | Codice lingua OCR (può essere sovrascritto dinamicamente con lingua email rilevata) |
| `ocrConfidenceWarningThreshold` | `0.8` | Soglia minima di affidabilità OCR per aggiungere una nota di leggibilità in risposta |
| `pdfMaxPages` | `2` | Limite pagine stimato per PDF |
| `pdfCharsPerPage` | `1800` | Caratteri stimati per pagina PDF |

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

