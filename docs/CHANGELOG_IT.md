# Changelog

Modifiche significative a questo progetto saranno documentate in questo file.

Il formato è basato su [Keep a Changelog](https://keepachangelog.com/it/1.1.0/),
e questo progetto aderisce a [Semantic Versioning](https://semver.org/lang/it/).

---

## [2.5.5] - 2026-01-27

### 🔧 Ottimizzato
- **Smart RAG Unificato**: Nuovo sistema `PromptEngine` che unifica il recupero dottrinale e direttivo. Utilizza Dimensioni (PhD/Pastorale), Tono suggerito e Profilo (Lite/Heavy) per selezionare il contesto perfetto. Rimossi layer ridondanti.
- **Struttura Prompt**: Riorganizzazione delle sezioni per massimizzare l'attenzione del modello sulle istruzioni più recenti (Recency Bias).
- **Checklist Contestuale**: Generazione dinamica dei controlli finali basata sulla lingua e sul tipo di richiesta.

## [2.5.4] - 2026-01-21

### 🐛 Corretto (Bug Fixes)
- **Race Condition Critica**: Risolto rilascio prematuro del lock globale in `GeminiRateLimiter` che permetteva esecuzioni sovrapposte.
- **Atomicità Memoria**: Migrazione da `CacheService` a `LockService` (globale) in `MemoryService` per garantire scritture atomiche e integrità dati.
- **Inconsistenza Cache**: Introdotta invalidazione forzata della cache locale in caso di errore di versione (concorrenza), prevenendo loop di retry falliti.
- **Falsi Positivi Classifier**: Corretta logica di rilevamento saluti/ringraziamenti che ignorava i punti di domanda (`?`), silenziando erroneamente domande brevi (es. "Tutto bene?").
- **Auto-Loop Detection**: Esteso il controllo mittente per includere alias configurati (`KNOWN_ALIASES`) oltre all'utente attivo.

## [2.5.3] - 2026-01-21

### 🔧 Modificato
- **Rafforzamento Logica Prompt**: Implementate regole rigorose "Rispondi SOLO a quanto chiesto" per evitare risposte eccessive (infodumping).
- **Prevenzione Loop "Contattaci"**: Aggiunto Errore Critico #5 che vieta al bot di suggerire di "contattare la segreteria" se l'utente sta già scrivendo alla segreteria.
- **Ascolto Attivo Migliorato**: Il bot ora integra le informazioni fornite dall'utente invece di ripeterle a pappagallo ("eco").

## [2.5.2] - 2026-01-21

### 🎉 Aggiunto
- **Template Formale Sbattezzo**: Template dedicato a livello di codice per garantire risposte amministrative, formali e non pastorali alle richieste di sbattezzo.
- **Categoria di Classificazione Formale**: Nuova categoria interna `FORMAL` per bypassare la logica pastorale generica per le richieste amministrative.
- **Rilevamento Parole Chiave Migliorato**: Aggiunti termini specifici per il rilevamento di richieste di sbattezzo e apostasia.

### 🔧 Modificato
- **Scaling PromptEngine**: Aumentato il numero di template modulari a **19** per ospitare la nuova procedura formale.
- **Validazione Risposta**: Allineato il validatore per supportare il nuovo template "blindato" mantenendo controlli rigorosi contro le allucinazioni.
- **Tono Istituzionale**: Standardizzate le risposte allo sbattezzo con il plurale istituzionale ("con la presente confermiamo").

## [2.5.1] - 2026-01-21

### 🔧 Migliorato
- **Logica di Risposta Rigorosa (Fail-Closed)**: Il sistema ora richiede una conferma esplicita per inviare una risposta. In caso di incertezza, privilegia il silenzio per evitare disturbi all'utente.
- **Controllo Ultimo Mittente**: Aggiunta verifica automatica della proprietà del thread. Se l'ultimo messaggio è stato inviato dalla segreteria, il sistema sospende l'elaborazione per evitare ripetizioni.
- **Supporto Conversazioni Continue**: Ottimizzazione della ricerca per elaborare nuove repliche dell'utente anche in thread precedentemente gestiti, mantenendo la coerenza del dialogo.
- **Filtro Mittenti Ottimizzato**: Il riconoscimento dei mittenti di sistema (no-reply) ora include l'analisi del nome visualizzato oltre all'indirizzo email.

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
