# 🏗️ System Architecture - Parish Email AI

[![Language: EN](https://img.shields.io/badge/Language-English-blue?style=flat-square)](ARCHITECTURE.md)

## 📖 Overview

SPA (Segreteria Parrocchiale Automatica) è un sistema di autorisponditore intelligente progettato specificamente per **gestire le email parrocchiali** con:
- Sensibilità pastorale
- Accuratezza dottrinale  
- Efficienza operativa

### Design Philosophy

**"Fail Pastoral, Not Technical"**

Il sistema è progettato per:
- ✅ **Mai perdere un'email** → Preferisce rispondere in eccesso che ignorare
- ✅ **Mai dare informazioni sbagliate** → Se incerto, suggerisce contatto umano
- ✅ **Mai tono inappropriato** → Validazione multi-livello del tono
- ✅ **Sempre sotto controllo** → Tutto marcato con etichette Gmail per revisione

---

## 🎯 Core Principles

### 1. Modular Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Main.gs                              │
│              (Orchestrator & Entry Point)                   │
└───────────────┬─────────────────────────────────────────────┘
                │
    ┌───────────┼───────────────────┐
    │           │                   │
    v           v                   v
┌────────┐ ┌────────┐      ┌──────────────┐
│ Config │ │ Logger │      │ loadResources│
└────────┘ └────────┘      └──────────────┘
                                   │
                        ┌──────────┴──────────┐
                        │                     │
                        v                     v
            ┌─────────────────┐   ┌─────────────────┐
            │ Knowledge Base  │   │  Vacation DB    │
            │  (Sheets)       │   │  (Sheets)       │
            └─────────────────┘   └─────────────────┘
```

**Ogni modulo è:**
- 🔒 **Self-contained** → Può essere testato isolatamente
- 🔄 **Replaceable** → Interfacce standard (factory pattern)
- 📊 **Observable** → Logging strutturato per debugging

### 2. Event-Driven Pipeline

```
Email Arriva
     │
     v
┌─────────────────────────────────────────────────────────┐
│  TRIGGER (Time-based)                                   │
│  - Ogni 5 minuti                                        │
│  - Max 5 minuti esecuzione                              │
└──────────────┬──────────────────────────────────────────┘
               │
               v
┌──────────────────────────────────────────────────────────┐
│  PRE-CHECKS                                              │
│  ├─ Orario sospensione? (fuori orari ufficio)          │
│  ├─ Festività? (calendario + override dinamico)        │
│  └─ Safety Valve? (quota API >80%)                      │
└──────────────┬──────────────────────────────────────────┘
               │
               v
┌──────────────────────────────────────────────────────────┐
│  LOCK ACQUISITION (Livello Thread)                       │
│  - Previene race condition tra esecuzioni parallele     │
│  - TTL 30s con double-check                              │
└──────────────┬──────────────────────────────────────────┘
               │
               v
┌──────────────────────────────────────────────────────────┐
│  FILTRI PRELIMINARI                                      │
│  1. Già processato? (check etichetta "IA")              │
│  2. Mittente ignorato? (noreply, newsletter)            │
│  3. Keyword ignorata? (unsubscribe, opt-out)            │
│  4. Auto-sent? (dal nostro stesso account)                   │
│  5. Loop rilevato? (>10 msg nello stesso thread)        │
└──────────────┬──────────────────────────────────────────┘
               │
               v
┌──────────────────────────────────────────────────────────┐
│  CLASSIFICATION (Classifier)                             │
│  ├─ Acknowledgment ultra-semplice? (≤3 parole)          │
│  ├─ Solo saluto? ("Buongiorno", "Ciao")                 │
│  └─ Passa → Gemini per analisi intelligente             │
└──────────────┬──────────────────────────────────────────┘
               │
               v
┌──────────────────────────────────────────────────────────┐
│  QUICK CHECK (Gemini AI)                                 │
│  - Modello: gemini-2.5-flash-lite (veloce, economico)   │
│  - Risposta necessaria? (true/false)                     │
│  - Lingua rilevata? (it/en/es/fr/de)                     │
│  - Categoria? (TECHNICAL/PASTORAL/DOCTRINAL/MIXED)       │
└──────────────┬──────────────────────────────────────────┘
               │
               v
┌──────────────────────────────────────────────────────────┐
│  REQUEST TYPE CLASSIFICATION                             │
│  - Determina tipo richiesta (technical/pastoral/mixed)   │
│  - Setta flag: needsDiscernment, needsDoctrine           │
│  - Decide quale KB caricare (LITE/STANDARD/HEAVY)        │
└──────────────┬──────────────────────────────────────────┘
               │
               v
┌──────────────────────────────────────────────────────────┐
│  KB ENRICHMENT (Condizionale)                            │
│  ├─ Carica Istruzioni (sempre)                          │
│  ├─ AI_CORE_LITE (se needsDiscernment || needsDoctrine) │
│  ├─ AI_CORE (se needsDiscernment)                       │
│  ├─ Dottrina (se needsDoctrine)                         │
│  └─ Regole Messe Speciali (se festivo infrasettimanale) │
└──────────────┬──────────────────────────────────────────┘
               │
               v
┌──────────────────────────────────────────────────────────┐
│  CONTEXT BUILDING                                        │
│  ├─ Storico conversazione (ultimi 10 msg thread)        │
│  ├─ Memoria conversazionale (topics già forniti)        │
│  ├─ Territory check (se indirizzo nell'email)           │
│  ├─ Modalità saluto (full/soft/none_or_continuity)     │
│  └─ Prompt context dinamico (profile + concerns)        │
└──────────────┬──────────────────────────────────────────┘
               │
               v
┌──────────────────────────────────────────────────────────┐
│  PROMPT CONSTRUCTION (PromptEngine)                      │
│  - 18 template modulari componibili                      │
│  - Filtering dinamico basato su profilo (lite/std/heavy)│
│  - Token budget management (~100k max)                   │
│  - Retrieval Selettivo Dottrina (riduzione 83% token)    │
│  - Semantic truncation se KB troppo grande               │
└──────────────┬──────────────────────────────────────────┘
               │
               v
┌──────────────────────────────────────────────────────────┐
│  RATE LIMITING (GeminiRateLimiter)                       │
│  - Selezione automatica modello disponibile              │
│  - Fallback chain: flash-2.5 → flash-lite → flash-2.0  │
│  - Quota tracking: RPM, TPM, RPD                         │
│  - Exponential backoff su errori                         │
└──────────────┬──────────────────────────────────────────┘
               │
               v
┌──────────────────────────────────────────────────────────┐
│  AI GENERATION (GeminiService)                           │
│  - Chiamata API Gemini con retry (max 3)                │
│  - Safety settings configurati                           │
│  - Token counting per billing                            │
└──────────────┬──────────────────────────────────────────┘
               │
               v
┌──────────────────────────────────────────────────────────┐
│  RESPONSE VALIDATION (7 Controlli)                       │
│  1. Lunghezza (25-3000 caratteri)                        │
│  2. Lingua consistente (IT/EN/ES)                        │
│  3. Firma presente (opzionale su follow-up)              │
│  4. Nessun contenuto vietato                             │
│  5. No allucinazioni (email/tel/orari non in KB)        │
│  6. No maiuscola dopo virgola (grammatica IT)            │
│  7. No thinking leak (ragionamento esposto)              │
│  → Score 0-1.0, soglia minima 0.6                        │
└──────────────┬──────────────────────────────────────────┘
               │
           ┌───┴────┐
           │ Valid? │
           └───┬────┘
               │
        ┌──────┴──────┐
        │             │
    YES │             │ NO
        │             │
        v             v
  ┌──────────┐  ┌─────────────┐
  │  SEND    │  │  Mark       │
  │  REPLY   │  │  "Verifica" │
  └────┬─────┘  └─────────────┘
       │
       v
┌──────────────────────────────────────────────────────────┐
│  POST-PROCESSING                                         │
│  ├─ Aggiungi label "IA"                                  │
│  ├─ Aggiorna memoria conversazionale                     │
│  ├─ Rilascia lock thread                                 │
│  └─ Log metriche esecuzione                              │
└──────────────────────────────────────────────────────────┘
```

---

## 🧩 Module Details

### Main.gs - Orchestrator

**Responsabilità:**
- Carica risorse (KB, configurazione, periodi ferie)
- Controlla sospensione (orari lavoro, festività)
- Inizializza EmailProcessor
- Gestisce trigger temporizzati

**Key Functions:**
```javascript
main()                  // Entry point trigger
loadResources()         // Carica KB + ferie (Cache 6 ore per KB < 100KB)
isInSuspensionTime()    // Verifica sospensione
getSpecialMassTimeRule()// Regole messe giorni festivi
```

**Festività Gestite:**
- ✅ Fisse (Natale, Pasquetta, 25 Aprile, ecc.)
- ✅ Mobili (Pasqua, Pentecoste, Corpus Domini)
- ✅ Dinamiche (periodi ferie segretario da Sheet)

**Reset Quota:**
- 📅 Ore 9:00 italiane (mezzanotte Pacific Time)
- 🔄 Automatico giornaliero

---

### EmailProcessor.gs - Pipeline Manager

**Responsabilità:**
- Coordina l'intera pipeline
- Gestisce lock a livello thread
- Implementa anti-loop detection
- Gestisce concurrency

**Key Features:**

#### 1. Thread-Level Locking
```javascript
// Previene race condition tra esecuzioni parallele
const threadLockKey = `thread_lock_${threadId}`;
scriptCache.put(threadLockKey, lockValue, 30); // TTL 30s
Utilities.sleep(50); // Anti-race sleep
const checkValue = scriptCache.get(threadLockKey);
if (checkValue !== lockValue) return; // Race rilevata
```

**Perché necessario:**
- Trigger ogni 5 minuti → possibile overlap
- Stesso thread potrebbe essere processato 2 volte
- Lock garantisce elaborazione atomica

#### 2. Anti-Loop Detection
```javascript
// Rileva conversazioni infinite
if (messages.length > MAX_THREAD_LENGTH) {
  let consecutiveExternal = 0;
  for (msg in messages.reverse()) {
    if (!msg.from.includes(ourEmail)) consecutiveExternal++;
    else break;
  }
  if (consecutiveExternal >= MAX_CONSECUTIVE_EXTERNAL) {
    return { status: 'skipped', reason: 'email_loop_detected' };
  }
}
```

**Protegge da:**
- Auto-reply loops (es. due bot che si rispondono)
- Conversazioni circolari
- Spam attacks

### MemoryService.gs - Memoria & Continuità
**Novità Fondamentale: Memoria Semantica Ibrida**

Il sistema utilizza una doppia strategia di memoria per garantire continuità naturale:

1.  **Dati Strutturati (`providedInfo`)**:
    *   Array JSON tecnico di argomenti trattati (es. `orari_messe`, `battesimo_info`).
    *   Usato per logiche *hard* (anti-ripetizione rigorosa: "Non ripetere ciò che l'utente ha già capito").

2.  **Riassunto Semantico (`memorySummary`)**:
    *   Testo narrativo compatto (max 600 caratteri).
    *   Generato dinamicamente analizzando le risposte del bot.
    *   Esempio: *"Ho fornito gli orari delle messe feriali. Ho spiegato che per il Battesimo serve il nulla osta."*
    *   Iniettato nel Prompt come contesto "umano", permette a Gemini di capire le sfumature della conversazione.

#### Struttura Dati (Google Sheet)
Il foglio `ConversationMemory` funge da database persistence.
- **A (threadId)**: ID univoco conversazione Gmail.
- **...**
- **E (providedInfo)**: JSON array strutturato.
- **I (memorySummary)**: Sintesi narrativa semantica.

#### 3. Salutation Mode Computing
```javascript
computeSalutationMode({
  isReply,           // È un "Re:"?
  messageCount,      // Numero messaggi nel thread
  memoryExists,      // C'è memoria precedente?
  lastUpdated,       // Timestamp ultimo contatto
  now                // Data/ora corrente
})
```

**Modalità:**
- **`full`** → Primo contatto (saluto completo)
- **`soft`** → Ripresa dopo pausa (saluto cordiale)
- **`none_or_continuity`** → Follow-up ravvicinato (nessun saluto)
- **`session`** → Sessione ravvicinata (tono più secco/conciso)

**Logica:**
- Se ultimo messaggio <= 15 min fa → `session`
- Se ultimo messaggio < 48h fa → `none_or_continuity`
- Se ultimo messaggio 48h-4gg fa → `soft`
- Se >4 giorni o primo contatto → `full`

---

### RequestTypeClassifier.gs - Classificazione "Dimensionale" (Nuova Gen)

**Problema Risolto:**
La vecchia classificazione "a binari" (Tech vs Pastoral) perdeva sfumature cruciali. Se un'email era tecnica ma con tono angosciato, il vecchio sistema la trattava come fredda burocrazia.

**Nuovo Approccio: Analisi Dimensionale Continua**
Il classifier non restituisce più solo un'etichetta, ma un profilo a 4 dimensioni con punteggi continui (0.0 - 1.0):

```javascript
dimensions = {
  technical: 0.2,
  pastoral:  0.9,  // Dominante
  doctrinal: 0.1,
  formal:    0.0
}
```

**Sorgenti del dato:**
1.  **Regex Engine (Fallback):** Punteggi basati su keyword pesate.
2.  **LLM (Gemini Flash-Lite):** Punteggi semantici estratti direttamente dall'analisi AI.
    *   *Logica Hybrid:* Se l'LLM è confidente (>0.6), i suoi punteggi "vincono" su quelli regex.

**Blended Hints (Suggerimenti Sfumati):**
Al Prompt Engine non viene più passato "Sei un pastore", ma un hint ricco:
> *"70% Pastorale, 30% Tecnico. L'utente chiede orari ma esprime solitudine. Rispondi ai dati precisi MA con grande calore umano."*

**Rationale:**
- Zero falsi negativi → Mai perdere email legittima
- Delega intelligenza a Gemini
- Filtri locali solo per casi ovvi (performance)

---

### RequestTypeClassifier.gs - Hybrid Classification

**Approccio Ibrido: Regex + Gemini**

```javascript
classify(subject, body, externalHint) {
  // Calcola score regex
  const technicalScore = this._scoreKeywords(TECHNICAL_INDICATORS);
  const pastoralScore = this._scoreKeywords(PASTORAL_INDICATORS);
  const doctrineScore = this._scoreKeywords(DOCTRINE_INDICATORS);
  
  // Se Gemini confidence >= 0.75 → usa Gemini
  if (externalHint && externalHint.confidence >= 0.75) {
    return { type: externalHint.category, source: 'gemini' };
  }
  
  // Altrimenti fallback a regex
  return { type: determineFromScores(), source: 'regex' };
}
```

**Tipi Richiesta:**
- **TECHNICAL** → Info pratiche (documenti, orari, procedure)
- **PASTORAL** → Situazioni personali, supporto spirituale
- **DOCTRINAL** → Spiegazioni dottrinali/teologiche
- **MIXED** → Entrambi aspetti
- **SIMPLE** → Segreteria di base

**Mapping KB:**
```javascript
{
  TECHNICAL: 'STANDARD',
  PASTORAL: 'HEAVY',  // Necessita AI_CORE
  DOCTRINAL: 'HEAVY', // Necessita Dottrina
  MIXED: 'HEAVY'
}
```

**Flags Attivazione:**
- `needsDiscernment` → Attiva AI_CORE (principi pastorali estesi)
- `needsDoctrine` → Attiva foglio Dottrina (Catechismo, Magistero)

---

### PromptEngine.gs - Modular Composition

**18 Template Componibili:**

```
1. CriticalErrors     (SEMPRE - rinforzo anti-errori)
2. SystemRole         (SEMPRE - identità assistente)
3. LanguageInstruction(SEMPRE - lingua richiesta)
4. ConversationContinuity (CONDIZIONALE - se follow-up)
5. MemoryContext      (CONDIZIONALE - se memoria exists)
6. KnowledgeBase      (SEMPRE)
7. TerritoryVerification (SEMPRE)
8. SeasonalContext    (SEMPRE - invernale/estivo)
9. TemporalAwareness  (SEMPRE - data corrente)
10. CategoryHint      (CONDIZIONALE - se category rilevata)
11. DynamicDirectives (CONDIZIONALE - Smart RAG da Dottrina)
12. FormattingGuidelines (FILTRABILE - no su profilo lite)
13. ResponseStructure (SEMPRE)
14. ConversationHistory (CONDIZIONALE - se thread>1 msg)
15. EmailContent      (SEMPRE)
16. NoReplyRules      (SEMPRE)
17. HumanToneGuidelines (FILTRABILE - no su profilo lite)
18. Examples          (FILTRABILE - no su profilo lite/standard)
19. ResponseGuidelines (SEMPRE)
20. SpecialCases      (FILTRABILE - no su profilo lite)
21. FinalChecklist    (SEMPRE - rinforzo finale)
```

**Prompt Profiling:**
```javascript
const profile = computeProfile({
  email,
  classification,
  requestType,
  memory,
  conversation,
  territory,
  knowledgeBase,
  temporal,
  salutationMode
});

// Profiles: 'lite', 'standard', 'heavy'
```

**Dynamic Filtering:**
- **Lite** → Skip: Examples, Formatting, HumanTone, SpecialCases
- **Standard** → Skip: Examples (se no formatting_risk)
- **Heavy** → Include tutto

**Token Management & Retrieval Selettivo:**
```javascript
MAX_SAFE_TOKENS = 100000;
KB_TOKEN_BUDGET = 50000; // 50%

// Unified Smart RAG (Dottrina + Direttive)
// Sostituisce i vecchi metodi di retrieval separati
// 1. Scoring basato su Topic, Keyword e Dimensioni (es. pastoral boost)
// 2. Tono Matching: Boost per righe con tono allineato a suggestedTone
// 3. Volume Adattivo: Max righe in base a promptProfile (Lite=3, Std=5, Heavy=8)
// 4. Output Unificato: Dottrina + Note AI + Warning in un unico blocco

if (estimatedTokens > MAX_SAFE_TOKENS) {
  // 1. Rimuovi Examples
  // 2. Tronca KB semanticamente (preserva paragrafi completi)
}
```

---

### GeminiRateLimiter.gs - Intelligent Quota Management

**Architettura Multi-Modello:**

```javascript
GEMINI_MODELS = {
  'flash-2.5': {
    name: 'gemini-2.5-flash',
    rpm: 10, tpm: 250000, rpd: 250,
    useCases: ['generation']
  },
  'flash-lite': {
    name: 'gemini-2.5-flash-lite',
    rpm: 15, tpm: 250000, rpd: 1000,
    useCases: ['quick_check', 'classification', 'fallback']
  },
  'flash-2.0': {
    name: 'gemini-2.0-flash',
    rpm: 5, tpm: 250000, rpd: 100,
    useCases: ['fallback']
  }
}
```

**Selection Strategy:**
```javascript
MODEL_STRATEGY = {
  'quick_check': ['flash-lite', 'flash-2.0'],
  'generation': ['flash-2.5', 'flash-lite', 'flash-2.0'],
  'fallback': ['flash-lite', 'flash-2.0']
}
```

**Processo Selezione:**
1. Controlla modello preferito per task
2. Verifica quota disponibile (RPM, TPM, RPD)
3. Se esaurito → prova prossimo in chain
4. Se tutti esauriti → throw QUOTA_EXHAUSTED

**Safety Valve (80% Threshold):**
```javascript
if (rpdUsage > 0.8 * rpdLimit) {
  CONFIG.MAX_EMAILS_PER_RUN = Math.floor(CONFIG.MAX_EMAILS_PER_RUN / 2);
  console.warn('🚨 Safety Valve attiva: ridotto carico');
}
```

**Tracking:**
- **RPM** → Rolling window (ultimi 60 secondi)
- **TPM** → Rolling window (ultimi 60 secondi)
- **RPD** → Counter giornaliero (reset 9:00 AM IT)

**Cache Ottimizzazione (WAL Pattern):**
```javascript
// Batch writes ogni 10 secondi (riduce I/O PropertiesService)
// Usa Write-Ahead Log (WAL) pattern per crash recovery
if (now - cache.lastCacheUpdate > 10000) {
  this._persistCacheWithWAL(); // Scrittura persistente sicura
}
```

**Persistenza Robusta:**
per prevenire la perdita di dati, il sistema:
1. Scrive i dati accurati in una proprietà WAL temporanea
2. Aggiorna le proprietà della cache principale
3. Elimina la proprietà WAL in caso di successo
4. Recupera automaticamente dal WAL al riavvio successivo se si è verificato un arresto anomalo

---

### Observability - Dashboard Metriche Giornaliere

Il sistema esporta automaticamente le metriche operative su un Google Sheet ogni giorno.

**Metriche Tracciate:**
- **Data/Ora** dell'esportazione
- **RPD%** (Utilizzo Richieste Per Giorno) per ogni modello
- **Quota Totale Usata**

**Implementazione:**
- `exportMetricsToSheet()` in `gas_main.js`
- Triggerato giornalmente (es. 23:55)
- Aggiunge una nuova riga a `METRICS_SHEET_ID`

---

### Stima Token - Analisi a Livello di Componente

Invece di un semplice controllo della lunghezza, il `PromptEngine` esegue una stima dettagliata dei token prima della generazione.

**Logica:**
```javascript
tokenComponents = {
  systemRole: 500,
  kb: length / 4,
  conversation: length / 4,
  email: length / 4,
  formatting: profile === 'heavy' ? 1500 : 300,
  examples: profile === 'heavy' ? 2000 : 0
};
```

**Soglie:**
- **> 70%**: Log informativo
- **> 90%**: Log di avviso + suggerimento per ottimizzare il budget KB

#### Strategia Cross-Key Quality First

**Supporto Multi-Chiave API:**

Il sistema supporta una chiave API di riserva per massimizzare la qualità delle risposte:

```javascript
// Strategia Fallback a 4 Livelli
attemptStrategy = [
  { name: 'Primary High-Quality', key: primaryKey, model: 'gemini-2.5-flash', skipRateLimit: false },
  { name: 'Backup High-Quality', key: backupKey, model: 'gemini-2.5-flash', skipRateLimit: true },
  { name: 'Primary Lite', key: primaryKey, model: 'gemini-2.5-flash-lite', skipRateLimit: false },
  { name: 'Backup Lite', key: backupKey, model: 'gemini-2.5-flash-lite', skipRateLimit: true }
];

for (plan of attemptStrategy) {
  if (!plan.key) continue; // Salta se chiave di riserva non configurata
  
  response = geminiService.generateResponse(prompt, {
    apiKey: plan.key,
    modelName: plan.model,
    skipRateLimit: plan.skipRateLimit
  });
  
  if (response) break; // Successo!
}
```

**Vantaggi:**
- 🎯 **Qualità Prima** → Prova sempre prima il modello di alta qualità
- 🔄 **Degrado Graduale** → Passa al modello lite solo quando necessario
- 📊 **Statistiche Pulite** → La chiave di riserva bypassa il rate limiter locale
- ⏰ **Prevenzione Timeout** → Batch ridotto a 3 email per esecuzione

**Configurazione:**
```javascript
// Nelle Script Properties (non nel codice!)
GEMINI_API_KEY = 'chiave-primaria';
GEMINI_API_KEY_BACKUP = 'chiave-di-riserva'; // Opzionale
```

---

### ResponseValidator.gs - 7-Layer Validation

**Layer 1: Length Check**
```javascript
MIN_LENGTH = 25;
OPTIMAL_MIN = 100;
WARNING_MAX = 3000;

if (length < 25) score = 0.0;      // Critico
if (length < 100) score *= 0.85;   // Warning
if (length > 3000) score *= 0.95;  // Prolissa
```

**Layer 2: Language Consistency**
```javascript
// Conta marker lingua (parole caratteristiche)
markerScores = {
  'it': count(['grazie', 'cordiali', 'saluti', ...]),
  'en': count(['thank', 'regards', 'dear', ...]),
  'es': count(['gracias', 'saludos', ...])
};

// Se lingua rilevata ≠ attesa → score *= 0.30
```

**Layer 3: Signature Presence**
```javascript
// Obbligatoria su primo contatto ('full')
// Opzionale su follow-up ('none_or_continuity')

signaturePatterns = [
  /segreteria\s+parrocchia\s+sant'?eugenio/i,
  /parish\s+secretariat.../i
];
```

**Layer 4: Forbidden Content**
```javascript
forbiddenPhrases = [
  'non ho abbastanza informazioni',
  'non posso rispondere',
  'non sono sicuro',
  'probabilmente', 'forse', ...
];

// Se trovato → score *= 0.50
```

**Layer 5: Hallucination Detection**
```javascript
// Estrae dati dalla risposta
responseEmails = extractEmails(response);
responseTimes = extractTimes(response);
responsePhones = extractPhones(response);

// Confronta con KB
kbEmails = extractEmails(knowledgeBase);
kbTimes = extractTimes(knowledgeBase);
kbPhones = extractPhones(knowledgeBase);

// Se dato NON in KB → score *= 0.50 (grave)
```

**Protezioni Speciali:**
- ⏰ Orari: Ignora pattern URL/filename (es. `page.19.html`)
- 📧 Email: Case-insensitive match
- 📞 Telefoni: Solo se ≥8 cifre (evita falsi positivi)

**Layer 6: Grammatica Italiana**
```javascript
// Rileva "maiuscola dopo virgola" (errore comune GPT)
pattern = /,\s+([A-Z][a-z]+)/g;
forbiddenCaps = ['Siamo', 'Restiamo', 'Il', 'La', ...];

// Es: "Buongiorno, Siamo lieti..." → ERRORE
//     "Buongiorno, siamo lieti..." → OK
```

**Layer 7: Thinking Leak Detection**
```javascript
// Rileva quando AI espone processo mentale
thinkingPatterns = [
  'rivedendo la knowledge base',
  'la kb says',
  'devo correggere',
  'nota:',
  'le date del 2025 sono passate',
  ...
];

// Se trovato → score = 0.0 (blocco totale)
```

**Final Scoring:**
```javascript
finalScore = product(all_layer_scores);
isValid = (errors.length === 0) && (finalScore >= 0.6);

if (!isValid) {
  applyLabel('Verifica'); // Revisione umana
  return { isValid: false, ... };
}
```

---

### MemoryService.gs - Conversational Memory

**Storage: Google Sheet "ConversationMemory"**

| threadId | language | category | tone | providedInfo | lastUpdated | messageCount | version |
|----------|----------|----------|------|--------------|-------------|--------------|---------|
| 18d12... | it | sacrament | standard | ["orari_messe","contatti"] | 2026-01-19T10:30:00Z | 3 | 2 |

**Key Features:**

#### 1. Optimistic Locking
```javascript
updateMemoryAtomic(threadId, newData, providedTopics) {
  // 1. Leggi versione corrente
  const currentVersion = existingData.version || 0;
  
  // 2. Controlla versione attesa
  if (newData._expectedVersion !== currentVersion) {
    throw new Error('VERSION_MISMATCH');
  }
  
  // 3. Aggiorna con versione incrementata
  mergedData.version = currentVersion + 1;
  updateRow(rowIndex, mergedData);
}
```

**Previene:**
- Race condition tra esecuzioni parallele
- Data corruption
- Lost updates

#### 2. Topic Tracking (Anti-Ripetizione)
```javascript
// Rileva topic forniti nella risposta
providedTopics = detectProvidedTopics(response);
// Es: ['orari_messe', 'battesimo_info', 'territorio']

// Aggiorna memoria
addProvidedInfoTopics(threadId, providedTopics);

// Prompt successivo conterrà:
"⚠️ Informazioni già fornite: orari_messe, battesimo_info
NON ripetere se non richiesto esplicitamente."
```

**Topic Rilevati:**
- orari_messe
- contatti
- battesimo_info
- comunione_info
- cresima_info
- matrimonio_info
- territorio
- indirizzo

#### 3. Cache Performance
```javascript
_cache = {};
_cacheExpiry = 5 * 60 * 1000; // 5 minuti

getMemory(threadId) {
  const cacheKey = `memory_${threadId}`;
  const cached = this._getFromCache(cacheKey);
  if (cached) return cached; // Hit
  
  // Miss → Query Sheet
  const row = this._findRowByThreadId(threadId);
  this._setCache(cacheKey, data);
  return data;
}
```

**Riduce:**
- Letture Sheet (costose)
- Latenza operazioni
- Rate limits Google Sheets API

#### 4. Granular Locking
```javascript
// Lock a livello THREAD (non globale)
const lockKey = `memory_lock_${threadId}`;
cache.put(lockKey, 'LOCKED', 10); // TTL 10s

// Solo thread SPECIFICO è bloccato
// Altri thread procedono in parallelo
```

---

### TerritoryValidator.gs - Address Verification

**Database Territorio:**
```javascript
territory = {
  'via flaminia': { 
    dispari: [109, 217],  // Solo numeri dispari 109-217
    pari: [158, 162]      // Solo numeri pari 158-162
  },
  'via adolfo cancani': { 
    tutti: true           // Tutti i numeri
  },
  'lungotevere flaminio': { 
    tutti: [16, 38]       // Numeri 16-38 (pari e dispari)
  }
}
```

**Extraction Process:**
```javascript
// Pattern 1: "via Rossi 10"
pattern = /(via|viale|piazza)\s+([a-zA-Z\s]+)\s+(\d+)/gi;

// Pattern 2: "abito in via Rossi 10"
pattern = /abito\s+(?:in|al|alle)\s+(via|viale|piazza)\s+([a-zA-Z\s]+)\s+(\d+)/gi;

// Protezione ReDoS: Max 1000 caratteri input
if (text.length > 1000) text = text.substring(0, 1000);
```

**Verification Logic:**
```javascript
verifyAddress(street, civicNumber) {
  const rules = territory[normalizeStreet(street)];
  
  if (!rules) return { inParish: false, reason: 'street_not_found' };
  
  if (rules.tutti === true) return { inParish: true };
  
  if (rules.tutti && civicNumber >= rules.tutti[0] && civicNumber <= rules.tutti[1])
    return { inParish: true };
  
  const isOdd = civicNumber % 2 === 1;
  if (isOdd && rules.dispari) {
    // Check range...
  }
  
  return { inParish: false, reason: 'civic_not_in_range' };
}
```

**Integrazione Pipeline:**
```javascript
// In EmailProcessor, dopo estrazione email
const territoryResult = territoryValidator.analyzeEmailForAddress(
  messageDetails.body, 
  messageDetails.subject
);

if (territoryResult.addressFound) {
  // Inietta blocco nel prompt
  const territoryContext = `
  ════════════════════════════════════════════════
  🎯 VERIFICA TERRITORIO AUTOMATICA
  ════════════════════════════════════════════════
  Indirizzo: ${territoryResult.street} n. ${territoryResult.civic}
  Risultato: ${territoryResult.verification.inParish ? '✅ RIENTRA' : '❌ NON RIENTRA'}
  `;
  
  knowledgeSections.unshift(territoryContext);
}
```

---

## 🔐 Security & Privacy

### Data Flow Security

```
Email Content
     │
     ├─> NEVER stored on external servers
     ├─> NEVER sent to third parties
     └─> ONLY used for:
           ├─ Gemini API (Google-owned, ephemeral)
           └─ Google Sheets (customer owned)
```

### GDPR Compliance

- **No Data Retention by AI**: Gemini non usa i dati per addestramento.
- **Audit Logs**: Accessibili in Google Cloud logs (se attivati).
- **Diritto all'Oblio**: Cancellazione manuale row in "ConversationMemory".
- **Access Control**: Dati accessibili solo via Google Workspace account autorizzati.