# Changelog

Modifiche significative a questo progetto saranno documentate in questo file.

Il formato è basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/),
e questo progetto aderisce a [Semantic Versioning](https://semver.org/lang/it/).

---

## [2.5.0] - 2026-01-20

### 🎉 Aggiunto
- **WAL (Write-Ahead Log) Pattern**: Persistenza cache sicura in `GeminiRateLimiter`
  - `_persistCacheWithWAL()`: Scrive checkpoint prima dei dati completi
  - `_recoverFromWAL()`: Recupero automatico dopo crash
  - `_mergeWindowData()`: Merge sicuro evitando duplicati
- **Test Alto Volume**: `testHighVolumeScenario()` valida performance classificazione 50 email
- **Dashboard Metriche Giornaliere**: Export statistiche quota su Google Sheets
  - `exportMetricsToSheet()`: Scrive riga metriche giornaliere
  - `setupMetricsTrigger()`: Configura trigger giornaliero alle 23:00
  - Nuova config: `METRICS_SHEET_ID`, `METRICS_SHEET_NAME`
- **Stima Token Migliorata**: Analisi per componente in `PromptEngine.buildPrompt()`
  - Stima token per: systemRole, KB, conversation, email, formatting, examples
  - Warning proattivo al 90% del limite con dettaglio componenti

### 🔧 Modificato
- `gas_config.js`: Aggiunta sezione configurazione metriche
- `gas_unit_tests.js`: Aggiunto `testHighVolumeScenario()` alla suite test

---

## [2.4.0] - UNRELEASED

### 🎉 Aggiunto
- [x] **Strategia Cross-Key Quality First**: Supporto multi-chiave API con fallback intelligente
  - Usa chiave di riserva quando la quota primaria è esaurita
  - Privilegia il modello di alta qualità (Flash 2.5) rispetto ai modelli lite
  - Fallback a 4 livelli: Primary High → Backup High → Primary Lite → Backup Lite
- [ ] Dashboard web statistiche (in sviluppo)
- [x] Supporto Gemini 2.5 Flash ottimizzato
- [x] Quick Decision Tree per troubleshooting rapido
- [x] Diagrammi architettura visivi (Mermaid)
- [x] Runbooks operativi per gestione incidenti
- [x] Checklist pre-commit per sviluppatori

### 🔧 Modificato
- [x] `MAX_EMAILS_PER_RUN` ridotto da 10 a 3 (previene timeout con strategia multi-tentativo)
- [x] Rate Limiter: aggiunto bypass `skipRateLimit` per chiavi di riserva
- [x] GeminiService: `generateResponse()` ora accetta opzioni per override chiave/modello
- [x] Rate Limiter: cache ottimizzata (ridotto I/O 60%)
- [x] Prompt Engine: profiling dinamico (lite/standard/heavy)
- [x] MemoryService: ricerca ottimizzata con TextFinder

### 🐛 Corretto
- [x] Race condition in cache refresh loop (`gas_rate_limiter.js`)
- [x] Logica booleana quick check (`gas_gemini_service.js`)

### 🔒 Sicurezza
- [x] Sanitizzazione link markdown (XSS/SSRF)
- [x] Header injection protection in GmailService
- [x] Hard slice safety cap in rate limiter windows

### 📚 Documentazione
- [x] Quick Decision Tree (`docs/QUICK_DECISION_TREE_IT.md`)
- [x] Diagrammi Architettura (`docs/ARCHITECTURE_DIAGRAMS_IT.md`)
- [x] Checklist Pre-Commit (`.github/PRE_COMMIT_CHECKLIST_IT.md`)
- [x] Runbooks Operativi (`docs/runbooks/`)
- [x] Sezione Known Issues in Troubleshooting
- [x] Guida selezione modello Gemini

---

## [2.3.9] - 2026-01-19

### 🔧 Modificato
- Rifattorizzata la logica di `gas_email_processor.js` per maggiore modularità e sicurezza thread
- Potenziato `gas_prompt_engine.js` con supporto test migliorato
- Configurate impostazioni predefinite sanitizzate per il rilascio pubblico
- Espansa la copertura dei test unitari (`gas_unit_tests.js`)

### 🐛 Corretto
- Risolto bug critico in `gas_rate_limiter.js` riguardante i cicli di refresh della cache
- Corretta logica booleana in `gas_gemini_service.js` per i controlli rapidi

---

## [2.3.8] - 2026-01-17

### 🔒 Sicurezza
- Rafforzati i pattern regex in `gas_response_validator.js` contro attacchi ReDoS
- Aggiunto controllo tipi rigoroso per input API

### 🔧 Modificato
- Implementato meccanismo "Safety Valve" per limitare richieste se quota API > 80%
- Aggiornato logging al formato strutturato JSON per migliore osservabilità

---

## [2.3.6] - 2026-01-15

### 🎉 Aggiunto
- Supporto nativo per modello Gemini 2.5 Flash
- Gestione dinamica ferie tramite integrazione Google Sheets
- Ascolto Attivo 2.0: Previene che l'AI faccia domande già risposte nel thread email

### 🐛 Corretto
- Risolto problema con la regola "virgola seguita da maiuscola" nella grammatica italiana

---

## Breaking Changes tra Versioni

### 2.3.x → 2.4.x
- ⚠️ `CONFIG.GEMINI_MODELS` ora obbligatorio in `gas_config.js`
- ⚠️ `VALIDATION_STRICT_MODE` deprecato (usa `VALIDATION_MIN_SCORE`)

### 2.2.x → 2.3.x
- ⚠️ Formato log cambiato a JSON strutturato
- ⚠️ Nuovi fogli richiesti: AI_CORE_LITE
