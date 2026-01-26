# Sistema GAS Autoresponder - Documentazione Tecnica

## Indice
1. [Panoramica](#panoramica)
2. [Architettura](#architettura)
3. [Setup e Configurazione](#setup-e-configurazione)
4. [Moduli](#moduli)
5. [Pipeline di Elaborazione](#pipeline-di-elaborazione)
6. [Testing](#testing)
7. [Troubleshooting](#troubleshooting)
8. [Manutenzione](#manutenzione)

---

## Panoramica

Sistema di autoresponder email basato su Google Apps Script e Gemini AI, progettato per:
- Processare automaticamente email in arrivo
- Classificare richieste e selezionare knowledge base appropriata
- Generare risposte contestuali e professionali
- Validare qualità prima dell'invio
- Mantenere memoria conversazionale

### Caratteristiche Principali
- ✅ Architettura modulare e manutenibile
- ✅ Rate limiting e gestione quote API
- ✅ Validazione qualità risposte
- ✅ Supporto multilingua
- ✅ Logging strutturato
- ✅ Memoria conversazionale
- ✅ Fallback automatici

---

## Architettura

### Struttura Moduli

```
GAS Autoresponder/
├── Config.gs                    # Configurazione centralizzata
├── Logger.gs                    # Sistema di logging
├── Main.gs                      # Entry point e trigger
├── GmailService.gs             # Interazione con Gmail
├── Classifier.gs               # Filtri base
├── RequestTypeClassifier.gs    # Classificazione richieste
├── KnowledgeBaseService.gs     # Gestione KB
├── GeminiService.gs            # API Gemini
├── GeminiRateLimiter.gs        # Rate limiting
├── PromptEngine.gs             # Composizione prompt
├── ResponseValidator.gs        # Validazione risposte
├── MemoryService.gs            # Memoria conversazionale
└── EmailProcessor.gs           # Orchestratore principale
```

### Diagramma Flusso Dati

```
Gmail Thread (Unread)
    ↓
EmailProcessor.processUnreadEmails()
    ↓
Per ogni thread:
    ├─→ GmailService.getThreadInfo()
    ├─→ Classifier.shouldIgnoreEmail()
    │   ↓ (se non ignorato)
    ├─→ Classifier.detectLanguage()
    ├─→ RequestTypeClassifier.classify()
    ├─→ KnowledgeBaseService.loadKB()
    ├─→ MemoryService.getHistory()
    ├─→ PromptEngine.buildPrompt()
    ├─→ GeminiRateLimiter.checkLimit()
    ├─→ GeminiService.generateResponse()
    ├─→ ResponseValidator.validate()
    ├─→ GmailService.sendReply()
    ├─→ GmailService.applyLabel()
    └─→ MemoryService.saveInteraction()
```

---

## Setup e Configurazione

### 1. Creazione Progetto GAS

1. Vai su [script.google.com](https://script.google.com)
2. Crea nuovo progetto
3. Copia tutti i file `.gs` nel progetto
4. Rinomina il progetto (es. "Autoresponder System")

### 2. Configurazione API Gemini

1. Vai su [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Crea API key
3. Copia l'API key

### 3. Setup Google Sheets

#### Knowledge Base Sheet
1. Crea nuovo Google Sheet per KB
2. Crea 3 fogli:
   - `KB_Lite` - Risposte semplici
   - `KB_Standard` - Conoscenza generale
   - `KB_Heavy` - Conoscenza approfondita

Formato colonne:
```
| Categoria | Domanda | Risposta |
|-----------|---------|----------|
| Generale  | ...     | ...      |
```

#### Memory Sheet
1. Crea nuovo Google Sheet per memoria
2. Rinomina foglio in `ConversationMemory`
3. Il sistema creerà automaticamente le colonne al primo utilizzo

### 4. Compilazione Config.gs

Sostituisci tutti i placeholder in `Config.gs`:

```javascript
// Esempio configurazione minima
GEMINI_API_KEY: 'your-actual-api-key-here'
KB_SHEET_ID: '1ABC...XYZ'  // ID del foglio KB
KB_LITE_SHEET_NAME: 'KB_Lite'
KB_STANDARD_SHEET_NAME: 'KB_Standard'
KB_HEAVY_SHEET_NAME: 'KB_Heavy'
MEMORY_SHEET_ID: '1DEF...UVW'  // ID del foglio memoria
MEMORY_SHEET_NAME: 'ConversationMemory'
LABEL_PROCESSED: 'AI/Processed'
LABEL_ERROR: 'AI/Error'
LABEL_SKIPPED: 'AI/Skipped'
```

### 5. Setup Trigger

Esegui la funzione `setupTrigger()` manualmente:

1. Apri editor script
2. Seleziona funzione `setupTrigger`
3. Clicca "Esegui"
4. Autorizza i permessi richiesti

Il trigger verrà impostato per eseguire `main()` ogni X minuti (configurabile).

### 6. Test Iniziale

1. Esegui `runHealthCheck()` per verificare la configurazione
2. Esegui `testRun()` per un test manuale
3. Verifica i log in "Esecuzioni"

---

## Moduli

### Config.gs
**Responsabilità**: Configurazione centralizzata

**Funzioni principali**:
- `getConfig()` - Restituisce configurazione
- `validateConfig()` - Valida configurazione
- `healthCheck()` - Verifica stato sistema

**Configurabili**:
- Modelli AI e parametri
- Rate limits
- Filtri email
- Lingue supportate
- Labels Gmail
- Orari di lavoro

### Logger.gs
**Responsabilità**: Logging strutturato

**Livelli**: DEBUG, INFO, WARN, ERROR

**Caratteristiche**:
- Log strutturato JSON
- Notifiche email per errori critici
- Context-aware logging
- Rate limiting notifiche

### GmailService.gs
**Responsabilità**: Interazione con Gmail

**Metodi principali**:
- `getUnreadThreads()` - Recupera thread non letti
- `getThreadInfo()` - Estrae info da thread
- `sendReply()` - Invia risposta
- `applyLabel()` / `removeLabel()` - Gestione label
- `getThreadHistory()` - Storico messaggi thread

### Classifier.gs
**Responsabilità**: Filtri base

**Filtri**:
- Domini ignorati
- Parole chiave ignorate
- Acknowledgment detection
- Auto-reply detection
- Rilevamento lingua
- Generazione saluti adattivi

### RequestTypeClassifier.gs
**Responsabilità**: Classificazione richieste

**Tipi richiesta**:
- `technical` - Richieste tecniche
- `pastoral` - Richieste pastorali
- `doctrinal` - Richieste dottrinali
- `simple` - Domande semplici
- `mixed` - Richieste miste

**Mapping KB**:
- technical → HEAVY
- doctrinal → HEAVY
- pastoral → STANDARD
- mixed → STANDARD
- simple → LITE

### KnowledgeBaseService.gs
**Responsabilità**: Gestione Knowledge Base

**Funzionalità**:
- Cache KB (1 ora di default)
- Caricamento lazy/eager
- Formattazione automatica
- Invalidazione cache
- Statistiche utilizzo

### GeminiRateLimiter.gs
**Responsabilità**: Rate limiting API

**Limiti tracciati**:
- RPM (Requests Per Minute)
- TPM (Tokens Per Minute)
- RPD (Requests Per Day)

**Funzionalità**:
- Auto-reset giornaliero
- Selezione modello dinamica
- Fallback automatico
- Statistiche utilizzo

### GeminiService.gs
**Responsabilità**: Chiamate API Gemini

**Funzionalità**:
- Retry con exponential backoff
- Gestione safety settings
- Quick check "should respond"
- Stima token usage
- Error handling robusto

### PromptEngine.gs
**Responsabilità**: Composizione prompt

**Elementi prompt**:
- System context
- Lingua e tono
- Knowledge Base
- Storico conversazione
- Istruzioni specifiche
- Validazione formato

### ResponseValidator.gs
**Responsabilità**: Validazione risposte

**Controlli**:
- ✓ Lunghezza (min/max)
- ✓ Presenza elementi richiesti
- ✓ Pattern proibiti
- ✓ Lingua corretta
- ✓ Coerenza con richiesta
- ✓ Tono professionale

**Scoring**: 0-100, soglia minima 50

### MemoryService.gs
**Responsabilità**: Memoria conversazionale

**Funzionalità**:
- Salvataggio interazioni
- Recupero storico
- Cleanup automatico vecchi record
- Formattazione per prompt
- Retention configurabile

### EmailProcessor.gs
**Responsabilità**: Orchestrazione pipeline

**Pipeline completa**:
1. Recupero thread non letti
2. Filtri base
3. Quick check AI
4. Rilevamento lingua
5. Classificazione richiesta
6. Caricamento KB
7. Recupero storico
8. Composizione prompt
9. Verifica rate limits
10. Generazione risposta
11. Validazione
12. Invio risposta
13. Applicazione label
14. Salvataggio memoria

---

## Pipeline di Elaborazione

### Fase 1: Filtri Preliminari

```
Thread non letto
    ↓
Già processato? → SÌ → Skip
    ↓ NO
Dominio ignorato? → SÌ → Skip
    ↓ NO
Keyword ignorata? → SÌ → Skip
    ↓ NO
Messaggio troppo corto/lungo? → SÌ → Skip
    ↓ NO
È acknowledgment? → SÌ → Skip
    ↓ NO
È auto-reply? → SÌ → Skip
    ↓ NO
Procedi →
```

### Fase 2: Classificazione

```
Quick Check AI
    ↓
Spam/Informativo? → SÌ → Skip
    ↓ NO
Rileva lingua → it/en/es/fr/de
    ↓
Classifica tipo richiesta → technical/pastoral/doctrinal/simple/mixed
    ↓
Seleziona KB → LITE/STANDARD/HEAVY
```

### Fase 3: Generazione

```
Carica KB
    ↓
Recupera storico conversazione
    ↓
Componi prompt
    ↓
Verifica rate limits → Limite raggiunto? → Fallback
    ↓
Chiama Gemini API
    ↓
Retry se fallisce (max 3)
```

### Fase 4: Validazione e Invio

```
Valida risposta
    ↓
Score < 30? → SÌ → Skip + Label "NeedsReview"
    ↓ NO
Score 30-50? → Label "NeedsReview" ma invia
    ↓
Invia risposta
    ↓
Applica label "Processed"
    ↓
Salva in memoria
```

---

## Testing

### Test Manuali

#### 1. Health Check
```javascript
runHealthCheck()
```
Verifica:
- ✓ Configurazione valida
- ✓ Accesso Gmail
- ✓ Accesso Knowledge Base
- ✓ Properties Service

#### 2. Test Singolo Thread
```javascript
// Invia email di test alla tua casella
// Poi esegui:
testRun()
```

#### 3. Test Componenti Individuali

```javascript
// Test classificatore
const classifier = new Classifier();
const result = classifier.shouldIgnoreEmail({
  from: 'test@example.com',
  subject: 'Test',
  body: 'Questo è un test'
});
console.log(result);

// Test knowledge base
const kb = new KnowledgeBaseService();
const content = kb.loadKB('LITE');
console.log(content.length);

// Test rate limiter
const limiter = new GeminiRateLimiter();
console.log(limiter.getStats());
```

### Checklist Test Pre-Produzione

- [ ] Health check passa
- [ ] Email di test viene processata
- [ ] Risposta è nella lingua corretta
- [ ] KB viene caricata correttamente
- [ ] Labels vengono applicate
- [ ] Memoria salva interazioni
- [ ] Rate limits funzionano
- [ ] Validazione blocca risposte invalide
- [ ] Trigger è configurato
- [ ] Notifiche errori funzionano

---

## Troubleshooting

### Problema: Nessuna email processata

**Possibili cause**:
1. Trigger non configurato
   - **Soluzione**: Esegui `setupTrigger()`

2. Fuori orario di lavoro
   - **Soluzione**: Verifica `SCHEDULE.PAUSE_OUTSIDE_HOURS` in Config
   
3. Tutte le email vengono ignorate
   - **Soluzione**: Verifica `FILTERS` in Config, riduci restrizioni

### Problema: Errore API Gemini

**Errori comuni**:

1. `401 Unauthorized`
   - **Causa**: API key non valida
   - **Soluzione**: Verifica `GEMINI_API_KEY` in Config

2. `429 Too Many Requests`
   - **Causa**: Rate limit raggiunto
   - **Soluzione**: Attendi o aumenta `TRIGGER.INTERVAL_MINUTES`

3. `500 Internal Server Error`
   - **Causa**: Errore temporaneo Google
   - **Soluzione**: Sistema riprova automaticamente

### Problema: Knowledge Base non caricata

**Verifiche**:
```javascript
const kb = new KnowledgeBaseService();
console.log(kb.getStats());
```

**Possibili cause**:
1. Sheet ID errato → Verifica `KB.SHEET_ID`
2. Nome foglio errato → Verifica `KB.SHEETS.*`
3. Permessi insufficienti → Condividi sheet con account script

### Problema: Risposte non validate

**Debug**:
```javascript
const validator = new ResponseValidator();
const result = validator.validate(response, {
  subject: '...',
  body: '...',
  language: 'it'
});
console.log(result);
```

**Soluzione**: Riduci soglie in `VALIDATION` config

### Problema: Memoria non salva

**Verifiche**:
1. `MEMORY.ENABLED = true`
2. `MEMORY_SHEET_ID` configurato
3. Permessi su sheet memoria

---

## Manutenzione

### Operazioni Periodiche

#### Settimanale
- Verifica log errori
- Controlla statistiche rate limiter
- Verifica quote API rimanenti

```javascript
// Stats rate limiter
const limiter = new GeminiRateLimiter();
console.log(limiter.getStats());

// Stats memoria
const memory = new MemoryService();
console.log(memory.getStats());

// Stats KB
const kb = new KnowledgeBaseService();
console.log(kb.getStats());
```

#### Mensile
- Cleanup memoria vecchia (automatico)
- Review email con label "NeedsReview"
- Aggiornamento Knowledge Base

#### Trimestrale
- Review configurazione
- Ottimizzazione prompt
- Aggiornamento modelli AI

### Aggiornamento Knowledge Base

1. Modifica Google Sheet KB
2. Invalida cache:
```javascript
const kb = new KnowledgeBaseService();
kb.invalidateCache(); // Invalida tutto
// oppure
kb.invalidateCache('LITE'); // Invalida solo un livello
```

### Reset Sistema

Reset completo (attenzione!):
```javascript
resetSystem()
```

Questo:
- Reset rate limiters
- Cancella cache KB
- Mantiene memoria conversazionale

### Backup

**Raccomandato**:
1. Export settimanale Memory Sheet
2. Backup configurazione
3. Versioning script in Git

### Monitoring

**Metriche da monitorare**:
- Numero email processate/giorno
- Tasso skip vs sent
- Errori API
- Usage rate limits
- Validation scores medi

**Dashboard consigliata**:
Crea Google Sheet con:
- Data
- Thread processati
- Risposte inviate
- Errori
- Token usati
- Validation score medio

---

## Best Practices

1. **Non modificare direttamente i moduli core** - Usa Config per personalizzazioni
2. **Testa sempre in ambiente separato** prima di deploy
3. **Monitora i log regolarmente** per individuare pattern di errore
4. **Mantieni KB aggiornata** per risposte più accurate
5. **Verifica quota API** per evitare interruzioni servizio
6. **Usa labels Gmail** per organizzare e debugare
7. **Backup regolari** della configurazione e memoria

---

## Supporto e Contributi

Per problemi o miglioramenti:
1. Verifica troubleshooting
2. Controlla log sistema
3. Esegui health check
4. Documenta errore con log completi

**Versione**: 1.0.0
**Ultimo aggiornamento**: 2026-01-19