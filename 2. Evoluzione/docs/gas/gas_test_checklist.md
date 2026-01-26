# Checklist Testing Sistema Autoresponder

## Pre-Setup

### Prerequisiti
- [ ] Account Google con accesso Gmail
- [ ] Progetto Google Apps Script creato
- [ ] API Key Gemini ottenuta
- [ ] Google Sheet per Knowledge Base creato
- [ ] Google Sheet per Memoria creato

---

## Setup Iniziale

### Configurazione Base
- [ ] Tutti i file `.gs` copiati nel progetto GAS
- [ ] `Config.gs` compilato con tutti i valori reali
- [ ] Nessun placeholder `[...]` rimasto in Config
- [ ] API Key Gemini valida e funzionante
- [ ] Sheet ID corretti per KB e Memoria

### Knowledge Base
- [ ] Fogli KB_Lite, KB_Standard, KB_Heavy creati
- [ ] Almeno 5 entry di test in ciascun foglio
- [ ] Formato colonne corretto: Categoria | Domanda | Risposta
- [ ] Sheet condiviso con permessi appropriati

### Permissions
- [ ] Script autorizzato per Gmail
- [ ] Script autorizzato per Google Sheets
- [ ] Script autorizzato per Properties Service
- [ ] Script autorizzato per Calendar (se festività abilitato)

---

## Test Funzionalità Core

### 1. Health Check
```javascript
runHealthCheck()
```

Verificare output:
- [ ] `status: "OK"` generale
- [ ] `components.config.status: "OK"`
- [ ] `components.gmail.status: "OK"`
- [ ] `components.knowledgeBase.status: "OK"`
- [ ] `components.properties.status: "OK"`
- [ ] Nessun errore nei componenti

### 2. Configurazione
```javascript
validateConfig()
```

- [ ] `valid: true`
- [ ] `errors: []` (array vuoto)
- [ ] Tutti i valori CONFIG accessibili
- [ ] Nessuna eccezione sollevata

### 3. Logger
```javascript
const logger = createLogger('Test');
logger.info('Test message', { data: 'test' });
logger.error('Test error', { error: 'test' });
```

- [ ] Log appaiono in "Esecuzioni"
- [ ] Formato JSON corretto (se structured=true)
- [ ] Livelli log rispettati
- [ ] Context presente nei log

### 4. Gmail Service
```javascript
const gmail = new GmailService();
const threads = gmail.getUnreadThreads();
console.log(threads.length);
```

- [ ] Funzione esegue senza errori
- [ ] Restituisce array (anche se vuoto)
- [ ] Thread info estratte correttamente

**Test con email reale**:
Inviare email di test alla casella e verificare:
- [ ] `getThreadInfo()` estrae subject corretto
- [ ] `getThreadInfo()` estrae body corretto
- [ ] `getThreadInfo()` estrae from corretto
- [ ] `extractEmail()` funziona
- [ ] `extractDomain()` funziona

### 5. Classifier
```javascript
const classifier = new Classifier();

// Test 1: Email normale
const test1 = classifier.shouldIgnoreEmail({
  from: 'user@example.com',
  subject: 'Domanda importante',
  body: 'Vorrei informazioni sul vostro servizio. Potete aiutarmi?'
});
console.log('Test 1 (deve passare):', test1);

// Test 2: Email con dominio ignorato
const test2 = classifier.shouldIgnoreEmail({
  from: 'noreply@example.com',
  subject: 'Test',
  body: 'Test message'
});
console.log('Test 2 (deve essere ignorata):', test2);

// Test 3: Acknowledgment
const test3 = classifier.shouldIgnoreEmail({
  from: 'user@example.com',
  subject: 'Re: Test',
  body: 'Ok, grazie!'
});
console.log('Test 3 (acknowledgment):', test3);
```

- [ ] Test 1: `shouldIgnore: false`
- [ ] Test 2: `shouldIgnore: true`, `reason: 'ignored_domain'`
- [ ] Test 3: `shouldIgnore: true`, `reason: 'acknowledgment'`

**Test rilevamento lingua**:
```javascript
const it = classifier.detectLanguage('Ciao, come stai? Vorrei delle informazioni.');
const en = classifier.detectLanguage('Hello, how are you? I would like some information.');
const es = classifier.detectLanguage('Hola, ¿cómo estás? Me gustaría información.');

console.log('IT:', it); // deve essere 'it'
console.log('EN:', en); // deve essere 'en'
console.log('ES:', es); // deve essere 'es'
```

- [ ] Italiano rilevato correttamente
- [ ] Inglese rilevato correttamente
- [ ] Spagnolo rilevato correttamente
- [ ] Fallback a DEFAULT per lingue non supportate

**Test saluti**:
```javascript
const greetingIT = classifier.generateGreeting('it');
const greetingEN = classifier.generateGreeting('en');
console.log('IT:', greetingIT);
console.log('EN:', greetingEN);
```

- [ ] Saluto generato in italiano
- [ ] Saluto generato in inglese
- [ ] Saluto varia in base all'ora del giorno

### 6. Request Type Classifier
```javascript
const rtc = new RequestTypeClassifier();

// Test classificazione
const tech = rtc.classify('Problema tecnico', 'Ho un errore nel codice...');
const pastoral = rtc.classify('Consiglio', 'Ho bisogno di supporto spirituale...');
const simple = rtc.classify('Informazioni', 'Quali sono gli orari?');

console.log('Technical:', tech);
console.log('Pastoral:', pastoral);
console.log('Simple:', simple);
```

- [ ] Richiesta tecnica classificata come `technical` o `mixed`
- [ ] KB level appropriato assegnato
- [ ] Richiesta pastorale classificata correttamente
- [ ] Richiesta semplice classificata come `simple`
- [ ] Scores presenti per ogni tipo

**Test quick check**:
```javascript
const check1 = rtc.quickShouldRespond('Domanda', 'Potete aiutarmi con questo problema?');
const check2 = rtc.quickShouldRespond('FYI', 'Vi informo che ho completato il lavoro.');

console.log('Check 1 (deve essere true):', check1);
console.log('Check 2 (deve essere false):', check2);
```

- [ ] Richiesta vera: `shouldRespond: true`
- [ ] Solo informativa: `shouldRespond: false`

### 7. Knowledge Base Service
```javascript
const kb = new KnowledgeBaseService();

// Test caricamento
const lite = kb.loadKB('LITE');
const standard = kb.loadKB('STANDARD');
const heavy = kb.loadKB('HEAVY');

console.log('LITE length:', lite.length);
console.log('STANDARD length:', standard.length);
console.log('HEAVY length:', heavy.length);

// Test stats
const stats = kb.getStats();
console.log('KB Stats:', stats);
```

- [ ] LITE caricata senza errori
- [ ] STANDARD caricata senza errori
- [ ] HEAVY caricata senza errori
- [ ] Contenuto formattato correttamente
- [ ] Stats mostrano info corrette
- [ ] Cache funziona (secondo caricamento più veloce)

**Test invalidazione cache**:
```javascript
kb.invalidateCache('LITE');
const reloaded = kb.loadKB('LITE');
```

- [ ] Cache invalidata
- [ ] KB ricaricata da Sheet

### 8. Rate Limiter
```javascript
const limiter = new GeminiRateLimiter();

// Test check limits
const check = limiter.checkLimit(1000);
console.log('Limit check:', check);

// Test record request
limiter.recordRequest(1500);

// Test stats
const stats = limiter.getStats();
console.log('Rate Limiter Stats:', stats);

// Test model selection
const model = limiter.selectModel();
console.log('Selected model:', model);
```

- [ ] Check limits funziona
- [ ] Request registrata correttamente
- [ ] Stats aggiornate
- [ ] Contatori incrementano
- [ ] Model selection funziona
- [ ] Reset giornaliero funziona

### 9. Gemini Service
```javascript
const gemini = new GeminiService();

// Test semplice
const result = gemini.generateResponse(
  'Rispondi con un saluto in italiano. Max 50 parole.',
  { model: 'gemini-1.5-flash' }
);

console.log('Success:', result.success);
console.log('Content:', result.content);
console.log('Tokens:', result.tokensUsed);
```

- [ ] API key funzionante
- [ ] Risposta generata con successo
- [ ] Content non vuoto
- [ ] Tokens counted
- [ ] Nessun errore

**Test retry**:
- [ ] Sistema riprova su errore temporaneo
- [ ] Backoff exponential funziona
- [ ] Max retries rispettato

### 10. Prompt Engine
```javascript
const promptEngine = new PromptEngine(kb);

const prompt = promptEngine.buildPrompt({
  subject: 'Richiesta informazioni',
  body: 'Vorrei sapere gli orari di apertura.',
  from: 'test@example.com',
  language: 'it',
  classification: { type: 'simple', kbLevel: 'LITE' },
  greeting: 'Buongiorno'
});

console.log('Prompt length:', prompt.length);
console.log('Prompt preview:', prompt.substring(0, 200));
```

- [ ] Prompt costruito senza errori
- [ ] Contiene lingua
- [ ] Contiene KB
- [ ] Contiene istruzioni
- [ ] Formato corretto

### 11. Response Validator
```javascript
const validator = new ResponseValidator();

// Test risposta valida
const valid = validator.validate(
  'Buongiorno,\n\nGrazie per la sua richiesta.\nGli orari sono...\n\nCordiali saluti',
  { language: 'it' }
);

// Test risposta troppo corta
const invalid = validator.validate(
  'Ok',
  { language: 'it' }
);

console.log('Valid:', valid);
console.log('Invalid:', invalid);
```

- [ ] Risposta valida: `valid: true`, score alto
- [ ] Risposta invalida: `valid: false`, issues presenti
- [ ] Lunghezza verificata
- [ ] Lingua verificata
- [ ] Pattern proibiti rilevati
- [ ] Scoring corretto

### 12. Memory Service
```javascript
const memory = new MemoryService();

// Test save
memory.saveInteraction('test-thread-123', {
  from: 'test@example.com',
  subject: 'Test',
  requestType: 'simple',
  language: 'it',
  userMessage: 'Messaggio test',
  assistantReply: 'Risposta test',
  kbLevel: 'LITE',
  validationScore: 85,
  status: 'sent'
});

// Test retrieve
const history = memory.getHistory('test-thread-123');
console.log('History:', history);

// Test stats
const stats = memory.getStats();
console.log('Memory Stats:', stats);
```

- [ ] Interazione salvata
- [ ] Sheet aggiornato
- [ ] History recuperato
- [ ] Stats corrette
- [ ] Cleanup automatico funziona

---

## Test Pipeline Completa

### Test End-to-End

**Setup**:
1. Invia email alla casella Gmail configurata
2. Email deve contenere:
   - Subject chiaro
   - Body con domanda specifica
   - Da dominio non ignorato
   - Lingua supportata

**Esecuzione**:
```javascript
testRun()
```

**Verifiche**:
- [ ] Email recuperata
- [ ] Thread info estratte
- [ ] Filtri applicati correttamente
- [ ] Lingua rilevata correttamente
- [ ] Richiesta classificata
- [ ] KB caricata
- [ ] Prompt costruito
- [ ] Rate limits verificati
- [ ] Risposta generata
- [ ] Risposta validata
- [ ] Email inviata
- [ ] Label "Processed" applicata
- [ ] Interazione salvata in memoria
- [ ] Thread marcato come letto (se configurato)

**Verifica email ricevuta**:
- [ ] Risposta nella lingua corretta
- [ ] Saluto presente
- [ ] Contenuto pertinente
- [ ] Firma presente (se configurata)
- [ ] Tono professionale

### Test Scenari Specifici

#### Scenario 1: Email da ignorare
Invia email con:
- From: noreply@test.com

**Atteso**:
- [ ] Thread saltato
- [ ] Label "Skipped" applicata
- [ ] Nessuna risposta inviata

#### Scenario 2: Acknowledgment
Invia reply breve:
- Body: "Ok, grazie!"

**Atteso**:
- [ ] Rilevato come acknowledgment
- [ ] Thread saltato
- [ ] Label "Skipped"

#### Scenario 3: Richiesta complessa
Invia email con domanda articolata

**Atteso**:
- [ ] Classificata come complex/mixed
- [ ] KB HEAVY o STANDARD caricata
- [ ] Risposta dettagliata

#### Scenario 4: Multilingua
Invia email in inglese, spagnolo, francese

**Atteso**:
- [ ] Lingua rilevata correttamente
- [ ] Risposta nella stessa lingua
- [ ] Saluto appropriato alla lingua

---

## Test Trigger e Automazione

### Setup Trigger
```javascript
setupTrigger()
```

- [ ] Trigger creato in "Trigger" project
- [ ] Intervallo corretto
- [ ] Function `main` associata

### Test Esecuzione Programmata
- [ ] Attendere intervallo trigger
- [ ] Verificare esecuzione in "Esecuzioni"
- [ ] Verificare log
- [ ] Verificare email processate

### Test Orari di Lavoro
**Se `PAUSE_OUTSIDE_HOURS: true`**:

- [ ] Durante orari di lavoro: sistema elabora
- [ ] Fuori orari di lavoro: sistema salta
- [ ] Log indica motivo skip

### Test Festività
**Se `PAUSE_ON_HOLIDAYS: true` e calendario configurato**:

- [ ] Durante festività: sistema salta
- [ ] Log indica festività

---

## Test Edge Cases

### Rate Limiting
**Simulare rate limit**:
```javascript
// Impostare temporaneamente limits molto bassi in Config
const limiter = new GeminiRateLimiter();
// Fare multiple request
```

- [ ] Sistema rileva limite raggiunto
- [ ] Fallback a modello alternativo
- [ ] O attesa fino a reset

### Validation Failure
**Creare prompt che genera risposta invalida**:

- [ ] Sistema valida e rileva problemi
- [ ] Score basso
- [ ] Label "NeedsReview" applicata
- [ ] Email non inviata se score < 30

### API Errors
**Simulare errore API** (temporaneamente invalidare API key):

- [ ] Sistema riprova
- [ ] Dopo max retries, segna errore
- [ ] Label "Error" applicata
- [ ] Log errore presente
- [ ] Notifica admin inviata (se configurata)

### Knowledge Base Indisponibile
**Temporaneamente rimuovere permessi su KB Sheet**:

- [ ] Sistema rileva errore
- [ ] Log warning
- [ ] Procede senza KB (se possibile)
- [ ] O segna errore

---

## Performance e Limiti

### Test Carico
**Creare 10+ email non lette**:

- [ ] Sistema processa fino a `MAX_THREADS_PER_RUN`
- [ ] Timeout esecuzione rispettato
- [ ] Thread rimanenti processati in run successivo

### Test Lunghezza Email
**Email con body molto lungo (5000+ parole)**:

- [ ] Sistema gestisce correttamente
- [ ] O ignora se > MAX_MESSAGE_LENGTH

### Test Thread Lunghi
**Thread con 10+ messaggi**:

- [ ] Storico recuperato
- [ ] Solo ultimi N messaggi usati

---

## Checklist Pre-Produzione

### Configurazione
- [ ] Tutte le API key valide
- [ ] Tutti i placeholder sostituiti
- [ ] Rate limits appropriati per uso previsto
- [ ] Orari di lavoro configurati
- [ ] Email admin per notifiche configurata
- [ ] Lingue supportate verificate
- [ ] Filtri testati e appropriati

### Knowledge Base
- [ ] KB popolata con contenuto reale
- [ ] Categorizzazione corretta
- [ ] Nessun dato sensibile in KB
- [ ] Formattazione verificata
- [ ] Backup KB effettuato

### Testing
- [ ] Tutti i test unitari passati
- [ ] Pipeline end-to-end testata
- [ ] Edge cases verificati
- [ ] Performance accettabile
- [ ] Nessun errore nei log

### Sicurezza
- [ ] API key protette (non in codice condiviso)
- [ ] Permessi minimi necessari
- [ ] Notifiche errori configurate
- [ ] Logging appropriato (no dati sensibili)

### Documentazione
- [ ] README completo
- [ ] Procedure troubleshooting documentate
- [ ] Contatti supporto definiti
- [ ] Backup procedure documentate

---

## Post-Deployment Monitoring

### Primo Giorno
- [ ] Verificare ogni esecuzione trigger
- [ ] Controllare tutte le email inviate
- [ ] Monitorare log continuamente
- [ ] Verificare rate limits non superati

### Prima Settimana
- [ ] Review giornaliera statistiche
- [ ] Verificare validazione scores
- [ ] Controllare memoria conversazionale
- [ ] Ottimizzare filtri se necessario

### Primo Mese
- [ ] Analisi completa metriche
- [ ] Feedback utenti
- [ ] Ottimizzazione KB
- [ ] Fine-tuning parametri

---

## Sign-off

**Tester**: _______________  
**Data**: _______________  
**Versione Testata**: _______________  

**Note Aggiuntive**:
_______________________________________
_______________________________________
_______________________________________