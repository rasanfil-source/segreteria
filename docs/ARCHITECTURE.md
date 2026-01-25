# 🏗️ System Architecture - Parish Email AI

[![Language: IT](https://img.shields.io/badge/Language-Italian-green?style=flat-square)](ARCHITECTURE_IT.md)

## 📖 Overview

Parish Email Secretary is an intelligent auto-responder system specifically designed to **manage parish emails** with:
- Pastoral sensitivity
- Doctrinal accuracy  
- Operational efficiency

### Design Philosophy

**"Fail Pastoral, Not Technical"**

The system is designed to:
- ✅ **Never miss an email** → Prefers responding excessively than ignoring
- ✅ **Never give wrong info** → If uncertain, suggests human contact
- ✅ **Never inappropriate tone** → Multi-level tone validation
- ✅ **Always under control** → Everything marked with Gmail labels for review

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

**Each module is:**
- 🔒 **Self-contained** → Can be tested in isolation
- 🔄 **Replaceable** → Standard interfaces (factory pattern)
- 📊 **Observable** → Structured logging for debugging

### 2. Event-Driven Pipeline

```
Email Arrives
     │
     v
┌─────────────────────────────────────────────────────────┐
│  TRIGGER (Time-based)                                   │
│  - Every 5 minutes                                      │
│  - Max 5 minutes execution                              │
└──────────────┬──────────────────────────────────────────┘
               │
               v
┌──────────────────────────────────────────────────────────┐
│  PRE-CHECKS                                              │
│  ├─ Suspension time? (outside office hours)             │
│  ├─ Holiday? (calendar + dynamic override)              │
│  └─ Safety Valve? (API quota >80%)                      │
└──────────────┬──────────────────────────────────────────┘
               │
               v
┌──────────────────────────────────────────────────────────┐
│  LOCK ACQUISITION (Thread Level)                         │
│  - Prevents race conditions between parallel executions │
│  - TTL 30s with double-check                            │
└──────────────┬──────────────────────────────────────────┘
               │
               v
┌──────────────────────────────────────────────────────────┐
│  PRELIMINARY FILTERS                                     │
│  1. Already processed? (check label "IA")               │
│  2. Ignored sender? (noreply, newsletter)               │
│  3. Ignored keyword? (unsubscribe, opt-out)             │
│  4. Auto-sent? (from our own account)                   │
│  5. Loop detected? (>10 msgs in same thread)            │
└──────────────┬──────────────────────────────────────────┘
               │
               v
┌──────────────────────────────────────────────────────────┐
│  CLASSIFICATION (Classifier)                             │
│  ├─ Ultra-simple acknowledgment? (≤3 words)             │
│  ├─ Only greeting? ("Good morning", "Hi")               │
│  └─ Pass → Gemini for intelligent analysis              │
└──────────────┬──────────────────────────────────────────┘
               │
               v
┌──────────────────────────────────────────────────────────┐
│  QUICK CHECK (Gemini AI)                                 │
│  - Model: gemini-2.5-flash-lite (fast, cheap)           │
│  - Need reply? (true/false)                             │
│  - Language detected? (it/en/es/fr/de)                  │
│  - Category? (TECHNICAL/PASTORAL/DOCTRINAL/MIXED)       │
└──────────────┬──────────────────────────────────────────┘
               │
               v
┌──────────────────────────────────────────────────────────┐
│  REQUEST TYPE CLASSIFICATION                             │
│  - Determine request type (technical/pastoral/mixed)    │
│  - Set flag: needsDiscernment, needsDoctrine            │
│  - Decide which KB to load (LITE/STANDARD/HEAVY)        │
└──────────────┬──────────────────────────────────────────┘
               │
               v
┌──────────────────────────────────────────────────────────┐
│  KB ENRICHMENT (Conditional)                             │
│  ├─ Load Instructions (always)                          │
│  ├─ AI_CORE_LITE (if needsDiscernment || needsDoctrine) │
│  ├─ AI_CORE (if needsDiscernment)                       │
│  ├─ Doctrine (if needsDoctrine)                         │
│  └─ Special Mass Rules (if midweek holiday)             │
└──────────────┬──────────────────────────────────────────┘
               │
               v
┌──────────────────────────────────────────────────────────┐
│  CONTEXT BUILDING                                        │
│  ├─ Conversation history (last 10 thread msgs)          │
│  ├─ Conversational memory (topics already provided)     │
│  ├─ Territory check (if address in email)               │
│  ├─ Salutation mode (full/soft/none_or_continuity/session) │
│  └─ Dynamic prompt context (profile + concerns)         │
└──────────────┬──────────────────────────────────────────┘
               │
               v
┌──────────────────────────────────────────────────────────┐
│  PROMPT CONSTRUCTION (PromptEngine)                      │
│  - 18 composable modular templates                      │
│  - Dynamic filtering based on profile (lite/std/heavy)  │
│  - Token budget management (~100k max)                  │
│  - Semantic truncation if KB too large                  │
└──────────────┬──────────────────────────────────────────┘
               │
               v
┌──────────────────────────────────────────────────────────┐
│  RATE LIMITING (GeminiRateLimiter)                       │
│  - Automatic available model selection                  │
│  - Fallback chain: flash-2.5 → flash-lite → flash-2.0   │
│  - Quota tracking: RPM, TPM, RPD                        │
│  - Exponential backoff on errors                        │
└──────────────┬──────────────────────────────────────────┘
               │
               v
┌──────────────────────────────────────────────────────────┐
│  AI GENERATION (GeminiService)                           │
│  - Gemini API call with retry (max 3)                   │
│  - Safety settings configured                           │
│  - Token counting for billing                            │
└──────────────┬──────────────────────────────────────────┘
               │
               v
┌──────────────────────────────────────────────────────────┐
│  RESPONSE VALIDATION (7 Checks)                          │
│  1. Length (25-3000 chars)                              │
│  2. Consistent language (IT/EN/ES)                      │
│  3. Signature present (optional on follow-up)           │
│  4. No forbidden content                                │
│  5. No hallucinations (email/tel/hours not in KB)       │
│  6. No uppercase after comma (grammar IT)               │
│  7. No thinking leak (exposed reasoning)                │
│  → Score 0-1.0, min threshold 0.6                       │
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
│  ├─ Add label "IA"                                       │
│  ├─ Update conversational memory                         │
│  ├─ Release thread lock                                  │
│  └─ Log execution metrics                                │
└──────────────────────────────────────────────────────────┘
```

---

## 🧩 Module Details

### Main.gs - Orchestrator

**Responsibilities:**
- Load resources (KB, config, vacation periods)
- Check suspension (office hours, holidays)
- Initialize EmailProcessor
- Handle timed triggers

**Key Functions:**
```javascript
main()                  // Trigger entry point
loadResources()         // Loads KB + vacation + replacements
isInSuspensionTime()    // Verifies suspension
getSpecialMassTimeRule()// Holiday mass rules
```

**Handled Holidays:**
- ✅ Fixed (Christmas, New Year, etc.)
- ✅ Mobile (Easter, Pentecost, Corpus Christi)
- ✅ Dynamic (secretary vacation periods from Sheet)

**Quota Reset:**
- 📅 9:00 AM Italian Time (midnight Pacific Time)
- 🔄 Automatic daily

---

### EmailProcessor.gs - Pipeline Manager

**Responsibilities:**
- Coordinates the whole pipeline
- Manages thread-level locks
- Implements anti-loop detection
- Manages concurrency

**Key Features:**

#### 1. Thread-Level Locking
```javascript
// Prevents race conditions between parallel executions
const threadLockKey = `thread_lock_${threadId}`;
scriptCache.put(threadLockKey, lockValue, 30); // TTL 30s
Utilities.sleep(50); // Anti-race sleep
const checkValue = scriptCache.get(threadLockKey);
if (checkValue !== lockValue) return; // Race detected
```

**Why needed:**
- Trigger every 5 mins → possible overlap
- Same thread could be processed twice
- Lock guarantees atomic processing

#### 2. Anti-Loop Detection
```javascript
// Detects infinite conversations
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

**Protects against:**
- Auto-reply loops (e.g. two bots replying to each other)
- Circular conversations
- Spam attacks

#### 3. Salutation Mode Computing
```javascript
computeSalutationMode({
  isReply,           // Is it a "Re:"?
  messageCount,      // Num messages in thread
  memoryExists,      // Is there previous memory?
  lastUpdated,       // Last contact timestamp
  now                // Current date/time
})
```

**Modes:**
- **`full`** → First contact (full greeting)
- **`soft`** → Resume after pause (warm greeting)
- **`none_or_continuity`** → Close follow-up (no greeting)
- **`session`** → Rapid session follow-up (dry/concise tone)

**Logic:**
- If last message <= 15 min ago → `session`
- If last message < 48h ago → `none_or_continuity`
- If last message 48h-4d ago → `soft`
- If >4 days or first contact → `full`

---

### RequestTypeClassifier.gs - "Dimensional" Classification (Next Gen)

**Problem Solved:**
Old "binary" classification (Tech vs Pastoral) lost crucial nuances. A technical email with an anguished tone was treated as cold bureaucracy.

**New Approach: Continuous Dimensional Analysis**
The classifier no longer returns just a label, but a 4-dimensional profile with continuous scores (0.0 - 1.0):

```javascript
dimensions = {
  technical: 0.2,
  pastoral:  0.9,  // Dominant
  doctrinal: 0.1,
  formal:    0.0
}
```

**Data Sources:**
1.  **Regex Engine (Fallback):** Scores based on weighted keywords.
2.  **LLM (Gemini Flash-Lite):** Semantic scores extracted directly from AI analysis.
    *   *Hybrid Logic:* If LLM is confident (>0.6), its scores "win" over regex.

**Blended Hints:**
The Prompt Engine receives a rich hint instead of a flat label:
> *"70% Pastoral, 30% Technical. User asks for times but expresses loneliness. Answer precise data BUT with great human warmth."*

**Rationale:**
- Zero false negatives → Never miss legitimate email
- Delegate intelligence to Gemini
- Local filters only for obvious cases (performance)

---

### RequestTypeClassifier.gs - Hybrid Classification

**Hybrid Approach: Regex + Gemini**

```javascript
classify(subject, body, externalHint) {
  // Calculate regex score
  const technicalScore = this._scoreKeywords(TECHNICAL_INDICATORS);
  const pastoralScore = this._scoreKeywords(PASTORAL_INDICATORS);
  const doctrineScore = this._scoreKeywords(DOCTRINE_INDICATORS);
  
  // If Gemini confidence >= 0.75 → use Gemini
  if (externalHint && externalHint.confidence >= 0.75) {
    return { type: externalHint.category, source: 'gemini' };
  }
  
  // Otherwise fallback to regex
  return { type: determineFromScores(), source: 'regex' };
}
```

**Request Types:**
- **TECHNICAL** → Practical info (documents, hours, procedures)
- **PASTORAL** → Personal situations, spiritual support
- **DOCTRINAL** → Doctrinal/theological explanations
- **MIXED** → Both aspects

**KB Mapping:**
```javascript
{
  TECHNICAL: 'STANDARD',
  PASTORAL: 'HEAVY',  // Needs AI_CORE
  DOCTRINAL: 'HEAVY', // Needs Doctrine
  MIXED: 'HEAVY'
}
```

**Activation Flags:**
- `needsDiscernment` → Activates AI_CORE (extended pastoral principles)
- `needsDoctrine` → Activates Doctrine sheet (Catechism, Magisterium)

---

### PromptEngine.gs - Modular Composition

**18 Composable Templates:**

```
1. CriticalErrors     (ALWAYS - anti-error reinforcement)
2. SystemRole         (ALWAYS - assistant identity)
3. LanguageInstruction(ALWAYS - requested language)
4. ConversationContinuity (CONDITIONAL - if follow-up)
5. MemoryContext      (CONDITIONAL - if memory exists)
6. KnowledgeBase      (ALWAYS)
7. TerritoryVerification (ALWAYS)
8. SeasonalContext    (ALWAYS - winter/summer)
9. TemporalAwareness  (ALWAYS - current date)
10. CategoryHint      (CONDITIONAL - if category detected)
11. DynamicDirectives (CONDITIONAL - Smart RAG from Doctrine)
12. FormattingGuidelines (FILTERABLE - no on lite profile)
13. ResponseStructure (ALWAYS)
14. ConversationHistory (CONDITIONAL - if thread>1 msg)
15. EmailContent      (ALWAYS)
16. NoReplyRules      (ALWAYS)
17. HumanToneGuidelines (FILTERABLE - no on lite profile)
18. Examples          (FILTERABLE - no on lite/standard profile)
19. ResponseGuidelines (ALWAYS)
20. SpecialCases      (FILTERABLE - no on lite profile)
21. FinalChecklist    (ALWAYS - final reinforcement)
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
- **Standard** → Skip: Examples (if no formatting_risk)
- **Heavy** → Include everything

**Token Management:**
```javascript
MAX_SAFE_TOKENS = 100000;
KB_TOKEN_BUDGET = 50000; // 50%

if (estimatedTokens > MAX_SAFE_TOKENS) {
  // 1. Remove Examples
  // 2. Truncate KB semantically (preserve complete paragraphs)
}
```

---

### GeminiRateLimiter.gs - Intelligent Quota Management

**Multi-Model Architecture:**

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

**Process:**
1. Check preferred model for task
2. Check available quota (RPM, TPM, RPD)
3. If exhausted → try next in chain
4. If all exhausted → throw QUOTA_EXHAUSTED

**Safety Valve (80% Threshold):**
```javascript
if (rpdUsage > 0.8 * rpdLimit) {
  CONFIG.MAX_EMAILS_PER_RUN = Math.floor(CONFIG.MAX_EMAILS_PER_RUN / 2);
  console.warn('🚨 Safety Valve active: load reduced');
}
```

**Tracking:**
- **RPM** → Rolling window (last 60 seconds)
- **TPM** → Rolling window (last 60 seconds)
- **RPD** → Daily counter (reset 9:00 AM IT)

**Cache Optimization (WAL Pattern):**
```javascript
// Batch writes every 10 seconds (reduces PropertiesService I/O)
// Uses Write-Ahead Log (WAL) pattern for crash recovery
if (now - cache.lastCacheUpdate > 10000) {
  this._persistCacheWithWAL(); // Safe persistent write
}
```

**Robust Persistence:**
to prevent data loss, the system:
1. Writes accurate data to a temporary WAL property
2. Updates the main cache properties
3. Deletes the WAL property on success
4. Recovers from WAL automatically on next startup if a crash occurred

---

### Observability - Daily Metrics Dashboard

The system automatically exports operational metrics to a Google Sheet daily.

**Metrics Tracked:**
- **Date/Time** of export
- **RPD%** (Requests Per Day usage) for each model
- **Total Quota Used**

**Implementation:**
- `exportMetricsToSheet()` in `gas_main.js`
- Triggered daily (e.g., 23:55)
- Appends a new row to `METRICS_SHEET_ID`

---

### Token Estimation - Component-Level Analysis

Instead of a simple length check, the `PromptEngine` performs a detailed token estimation before generation.

**Logic:**
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

**Thresholds:**
- **> 70%**: Info log
- **> 90%**: Warning log + suggestion to optimize KB budget

#### Cross-Key Quality First Strategy

**Multi-API-Key Support:**

The system supports a backup API key for maximum response quality:

```javascript
// 4-Level Fallback Strategy
attemptStrategy = [
  { name: 'Primary High-Quality', key: primaryKey, model: 'gemini-2.5-flash', skipRateLimit: false },
  { name: 'Backup High-Quality', key: backupKey, model: 'gemini-2.5-flash', skipRateLimit: true },
  { name: 'Primary Lite', key: primaryKey, model: 'gemini-2.5-flash-lite', skipRateLimit: false },
  { name: 'Backup Lite', key: backupKey, model: 'gemini-2.5-flash-lite', skipRateLimit: true }
];

for (plan of attemptStrategy) {
  if (!plan.key) continue; // Skip if backup key not configured
  
  response = geminiService.generateResponse(prompt, {
    apiKey: plan.key,
    modelName: plan.model,
    skipRateLimit: plan.skipRateLimit
  });
  
  if (response) break; // Success!
}
```

**Benefits:**
- 🎯 **Quality First** → Always tries high-quality model first
- 🔄 **Graceful Degradation** → Falls back to lite model only when necessary
- 📊 **Clean Statistics** → Backup key bypasses local rate limiter
- ⏰ **Timeout Prevention** → Batch size reduced to 3 emails per run

**Configuration:**
```javascript
// In Script Properties (not in code!)
GEMINI_API_KEY = 'your-primary-key';
GEMINI_API_KEY_BACKUP = 'your-backup-key'; // Optional
```

---

### ResponseValidator.gs - 7-Layer Validation

**Layer 1: Length Check**
```javascript
MIN_LENGTH = 25;
OPTIMAL_MIN = 100;
WARNING_MAX = 3000;

if (length < 25) score = 0.0;      // Critical
if (length < 100) score *= 0.85;   // Warning
if (length > 3000) score *= 0.95;  // Verbose
```

**Layer 2: Language Consistency**
```javascript
// Counts language markers (characteristic words)
markerScores = {
  'it': count(['grazie', 'cordiali', 'saluti', ...]),
  'en': count(['thank', 'regards', 'dear', ...]),
  'es': count(['gracias', 'saludos', ...])
};

// If detected lang ≠ expected → score *= 0.30
```

**Layer 3: Signature Presence**
```javascript
// Mandatory on first contact ('full')
// Optional on follow-up ('none_or_continuity')

signaturePatterns = [
  /segreteria\s+parrocchia\s+sant'?eugenio/i,
  /parish\s+secretariat.../i
];
```

**Layer 4: Forbidden Content**
```javascript
forbiddenPhrases = [
  'not enough information',
  'I cannot answer',
  'I am not sure',
  'probably', 'maybe', ...
];

// If found → score *= 0.50
```

**Layer 5: Hallucination Detection**
```javascript
// Extract data from response
responseEmails = extractEmails(response);
responseTimes = extractTimes(response);
responsePhones = extractPhones(response);

// Compare with KB
kbEmails = extractEmails(knowledgeBase);
kbTimes = extractTimes(knowledgeBase);
kbPhones = extractPhones(knowledgeBase);

// If data NOT in KB → score *= 0.50 (severe)
```

**Special Protections:**
- ⏰ Times: Ignored pattern URL/filename (e.g. `page.19.html`)
- 📧 Email: Case-insensitive match
- 📞 Phones: Only if ≥8 digits (avoids false positives)

**Layer 6: Italian Grammar**
```javascript
// Detects "uppercase after comma" (common GPT error)
pattern = /,\s+([A-Z][a-z]+)/g;
forbiddenCaps = ['Siamo', 'Restiamo', 'Il', 'La', ...];

// Ex: "Buongiorno, Siamo lieti..." → ERROR
//     "Buongiorno, siamo lieti..." → OK
```

**Layer 7: Thinking Leak Detection**
```javascript
// Detects when AI exposes internal reasoning
thinkingPatterns = [
  'reviewing the knowledge base',
  'the kb says',
  'i need to correct',
  'note:',
  'the dates of 2025 have passed',
  ...
];

// If found → score = 0.0 (total block)
```

**Final Scoring:**
```javascript
finalScore = product(all_layer_scores);
isValid = (errors.length === 0) && (finalScore >= 0.6);

if (!isValid) {
  applyLabel('Verifica'); // Human review
  return { isValid: false, ... };
}
```

---

### MemoryService.gs - Memory & Continuity
**Key Feature: Hybrid Semantic Memory**

The system employs a dual-strategy memory to ensure natural continuity:

1.  **Structured Data (`providedInfo`)**:
    *   Technical JSON array of topics covered (e.g. `mass_times`, `baptism_info`).
    *   Used for *hard* logic (strict anti-repetition: "Do not repeat what the user already understood").

2.  **Semantic Summary (`memorySummary`)**:
    *   Compact narrative text (max 600 chars).
    *   Dynamically generated by analyzing bot responses.
    *   Example: *"I provided weekday mass times. I explained that permission is needed for Baptism."*
    *   Injected into the Prompt as "human" context, allowing Gemini to grasp conversation nuances.

#### Data Structure (Google Sheet)
The `ConversationMemory` sheet acts as the persistence database.
- **A (threadId)**: Unique conversation ID.
- **...**
- **E (providedInfo)**: Structured JSON array.
- **I (memorySummary)**: Semantic narrative summary.
**Storage: Google Sheet "ConversationMemory"**

| threadId | language | category | tone | providedInfo | lastUpdated | messageCount | version |
|----------|----------|----------|------|--------------|-------------|--------------|---------|
| 18d12... | it | sacrament | standard | ["orari_messe","contatti"] | 2026-01-19T10:30:00Z | 3 | 2 |

**Key Features:**

#### 1. Optimistic Locking
```javascript
updateMemoryAtomic(threadId, newData, providedTopics) {
  // 1. Read current version
  const currentVersion = existingData.version || 0;
  
  // 2. Check expected version
  if (newData._expectedVersion !== currentVersion) {
    throw new Error('VERSION_MISMATCH');
  }
  
  // 3. Update with incremented version
  mergedData.version = currentVersion + 1;
  updateRow(rowIndex, mergedData);
}
```

**Prevents:**
- Race conditions between parallel executions
- Data corruption
- Lost updates

#### 2. Topic Tracking (Anti-Repetition)
```javascript
// Detect topics provided in response
providedTopics = detectProvidedTopics(response);
// Ex: ['orari_messe', 'battesimo_info', 'territorio']

// Update memory
addProvidedInfoTopics(threadId, providedTopics);

// Next prompt will contain:
"⚠️ Information already provided: orari_messe, battesimo_info
DO NOT repeat unless explicitly requested."
```

**Detected Topics:**
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
_cacheExpiry = 5 * 60 * 1000; // 5 minutes

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

**Reduces:**
- Sheet reads (expensive)
- Operation latency
- Google Sheets API rate limits

#### 4. Granular Locking
```javascript
// Lock at THREAD level (not global)
const lockKey = `memory_lock_${threadId}`;
cache.put(lockKey, 'LOCKED', 10); // TTL 10s

// Only SPECIFIC thread is locked
// Other threads proceed in parallel
```

---

### TerritoryValidator.gs - Address Verification

**Territory Database:**
```javascript
territory = {
  'via flaminia': { 
    dispari: [109, 217],  // Only odd numbers 109-217
    pari: [158, 162]      // Only even numbers 158-162
  },
  'via adolfo cancani': { 
    tutti: true           // All numbers
  },
  'lungotevere flaminio': { 
    tutti: [16, 38]       // Numbers 16-38 (even and odd)
  }
}
```

**Extraction Process:**
```javascript
// Pattern 1: "via Rossi 10"
pattern = /(via|viale|piazza)\s+([a-zA-Z\s]+)\s+(\d+)/gi;

// Pattern 2: "live at via Rossi 10"
pattern = /abito\s+(?:in|al|alle)\s+(via|viale|piazza)\s+([a-zA-Z\s]+)\s+(\d+)/gi;

// ReDoS Protection: Max 1000 chars input
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

**Pipeline Integration:**
```javascript
// In EmailProcessor, after email extraction
const territoryResult = territoryValidator.analyzeEmailForAddress(
  messageDetails.body, 
  messageDetails.subject
);

if (territoryResult.addressFound) {
  // Inject block into prompt
  const territoryContext = `
  ════════════════════════════════════════════════
  🎯 AUTOMATIC TERRITORY VERIFICATION
  ════════════════════════════════════════════════
  Address: ${territoryResult.street} n. ${territoryResult.civic}
  Result: ${territoryResult.verification.inParish ? '✅ INSIDE' : '❌ OUTSIDE'}
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

- **No Data Retention by AI**: Gemini does not use data for training.
- **Audit Logs**: Available in Google Cloud logs (if enabled).
- **Right to be Forgotten**: Manual deletion of row in "ConversationMemory".
- **Access Control**: Data accessible only via authorized Google Workspace accounts.
