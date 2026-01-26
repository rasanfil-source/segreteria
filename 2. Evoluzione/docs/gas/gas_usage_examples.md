# Esempi Pratici di Utilizzo

Questa guida contiene esempi pratici per le operazioni più comuni del sistema autoresponder.

## Indice
1. [Setup Iniziale](#setup-iniziale)
2. [Operazioni Comuni](#operazioni-comuni)
3. [Debugging](#debugging)
4. [Personalizzazioni](#personalizzazioni)
5. [Manutenzione](#manutenzione)

---

## Setup Iniziale

### 1. Primo Avvio del Sistema

```javascript
// Passo 1: Valida configurazione
function checkSetup() {
  Logger.log('=== Validazione Configurazione ===');
  const validation = validateConfig();
  
  if (validation.valid) {
    Logger.log('✓ Configurazione valida');
  } else {
    Logger.log('✗ Errori di configurazione:');
    validation.errors.forEach(err => Logger.log('  - ' + err));
    return;
  }
  
  // Passo 2: Health check
  Logger.log('\n=== Health Check ===');
  const health = healthCheck();
  Logger.log(JSON.stringify(health, null, 2));
  
  if (health.status === 'OK') {
    Logger.log('✓ Sistema pronto');
  } else {
    Logger.log('✗ Problemi rilevati');
  }
}

// Esegui questa funzione prima di attivare il trigger
checkSetup();
```

### 2. Configurazione Trigger

```javascript
// Configura trigger per esecuzione ogni 10 minuti
function setupMyTrigger() {
  // Rimuovi trigger esistenti
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(trigger => {
    if (trigger.getHandlerFunction() === 'main') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  
  // Crea nuovo trigger
  ScriptApp.newTrigger('main')
    .timeBased()
    .everyMinutes(10)
    .create();
  
  Logger.log('✓ Trigger configurato per esecuzione ogni 10 minuti');
}

setupMyTrigger();
```

### 3. Popolamento Knowledge Base

```javascript
// Script helper per popolare KB di test
function populateTestKB() {
  const config = getConfig();
  const ss = SpreadsheetApp.openById(config.KB.SHEET_ID);
  
  // KB Lite - Domande semplici
  const liteSheet = ss.getSheetByName(config.KB.SHEETS.LITE);
  liteSheet.clear();
  liteSheet.appendRow(['Categoria', 'Domanda', 'Risposta']);
  liteSheet.appendRow([
    'Orari',
    'Quali sono gli orari di apertura?',
    'Siamo aperti dal lunedì al venerdì, dalle 9:00 alle 18:00.'
  ]);
  liteSheet.appendRow([
    'Contatti',
    'Come posso contattarvi?',
    'Puoi contattarci via email a info@example.com o telefonicamente al 123-456-7890.'
  ]);
  
  // KB Standard - Informazioni generali
  const standardSheet = ss.getSheetByName(config.KB.SHEETS.STANDARD);
  standardSheet.clear();
  standardSheet.appendRow(['Categoria', 'Domanda', 'Risposta']);
  standardSheet.appendRow([
    'Servizi',
    'Quali servizi offrite?',
    'Offriamo consulenza, supporto tecnico e formazione personalizzata...'
  ]);
  
  // KB Heavy - Informazioni dettagliate
  const heavySheet = ss.getSheetByName(config.KB.SHEETS.HEAVY);
  heavySheet.clear();
  heavySheet.appendRow(['Categoria', 'Domanda', 'Risposta']);
  heavySheet.appendRow([
    'Tecnico',
    'Come configuro il sistema?',
    'La configurazione del sistema richiede i seguenti passaggi dettagliati...'
  ]);
  
  Logger.log('✓ Knowledge Base di test popolata');
}

populateTestKB();
```

---

## Operazioni Comuni

### 1. Processare Manualmente un Thread Specifico

```javascript
// Processa un singolo thread per ID
function processSpecificThread(threadId) {
  const logger = createLogger('Manual');
  logger.info('Processamento manuale thread', { threadId });
  
  try {
    // Inizializza servizi
    const services = initializeServices();
    
    // Recupera thread
    const thread = GmailApp.getThreadById(threadId);
    if (!thread) {
      logger.error('Thread non trovato', { threadId });
      return;
    }
    
    // Crea processor
    const processor = new EmailProcessor(services);
    
    // Processa (usa metodo privato via workaround)
    const result = processor._processThread(thread);
    
    logger.info('Risultato processamento', { result });
    
  } catch (e) {
    logger.error('Errore processamento manuale', { error: e.message });
  }
}

// Uso:
processSpecificThread('18d1234567890abcd');
```

### 2. Test Classificazione Email

```javascript
// Testa classificazione di un testo
function testClassification() {
  const classifier = new RequestTypeClassifier();
  
  const tests = [
    {
      name: 'Richiesta tecnica',
      subject: 'Problema con il sistema',
      body: 'Il sistema mi dà un errore quando provo ad accedere al database. Potete aiutarmi?'
    },
    {
      name: 'Richiesta pastorale',
      subject: 'Bisogno di supporto',
      body: 'Sto attraversando un momento difficile e avrei bisogno di un consiglio spirituale.'
    },
    {
      name: 'Domanda semplice',
      subject: 'Orari',
      body: 'Quali sono gli orari di apertura?'
    }
  ];
  
  tests.forEach(test => {
    Logger.log(`\n=== ${test.name} ===`);
    const result = classifier.classify(test.subject, test.body);
    Logger.log('Tipo:', result.type);
    Logger.log('KB Level:', result.kbLevel);
    Logger.log('Confidence:', result.confidence);
    Logger.log('Scores:', JSON.stringify(result.scores, null, 2));
  });
}

testClassification();
```

### 3. Test Generazione Risposta

```javascript
// Testa generazione risposta completa
function testResponseGeneration() {
  const services = initializeServices();
  const promptEngine = new PromptEngine(services.knowledgeBase);
  
  const testEmail = {
    subject: 'Richiesta informazioni',
    body: 'Buongiorno, vorrei sapere quali sono i vostri orari di apertura e come posso contattarvi. Grazie.',
    from: 'test@example.com',
    language: 'it',
    classification: { type: 'simple', kbLevel: 'LITE' },
    greeting: 'Buongiorno'
  };
  
  // Costruisci prompt
  const prompt = promptEngine.buildPrompt(testEmail);
  Logger.log('=== PROMPT ===');
  Logger.log(prompt);
  
  // Genera risposta
  Logger.log('\n=== GENERAZIONE ===');
  const response = services.gemini.generateResponse(prompt);
  
  if (response.success) {
    Logger.log('✓ Risposta generata:');
    Logger.log(response.content);
    Logger.log('\nToken usati:', response.tokensUsed);
    
    // Valida
    Logger.log('\n=== VALIDAZIONE ===');
    const validation = services.validator.validate(response.content, {
      language: 'it'
    });
    Logger.log('Valid:', validation.valid);
    Logger.log('Score:', validation.score);
    if (validation.issues.length > 0) {
      Logger.log('Issues:', validation.issues);
    }
  } else {
    Logger.log('✗ Errore:', response.error);
  }
}

testResponseGeneration();
```

### 4. Monitoraggio Rate Limits

```javascript
// Controlla stato rate limits
function checkRateLimits() {
  const limiter = new GeminiRateLimiter();
  const stats = limiter.getStats();
  
  Logger.log('=== Rate Limits Status ===');
  Logger.log('Current Usage:');
  Logger.log(`  RPM: ${stats.current.rpm}/${stats.limits.RPM} (${stats.usage.rpm})`);
  Logger.log(`  TPM: ${stats.current.tpm}/${stats.limits.TPM} (${stats.usage.tpm})`);
  Logger.log(`  RPD: ${stats.current.rpd}/${stats.limits.RPD} (${stats.usage.rpd})`);
  Logger.log('Last Reset:', stats.lastReset);
  
  // Verifica se vicino ai limiti
  const rpmPercent = (stats.current.rpm / stats.limits.RPM) * 100;
  const tpmPercent = (stats.current.tpm / stats.limits.TPM) * 100;
  const rpdPercent = (stats.current.rpd / stats.limits.RPD) * 100;
  
  if (rpmPercent > 80 || tpmPercent > 80 || rpdPercent > 90) {
    Logger.log('\n⚠️ WARNING: Vicino ai limiti!');
  } else {
    Logger.log('\n✓ Usage OK');
  }
}

checkRateLimits();
```

---

## Debugging

### 1. Debug Pipeline Completa

```javascript
// Esegue pipeline con logging dettagliato
function debugPipeline() {
  // Imposta temporaneamente log level a DEBUG
  const originalLevel = getConfig().LOGGING.LEVEL;
  getConfig().LOGGING.LEVEL = 'DEBUG';
  
  try {
    Logger.log('=== DEBUG MODE ===');
    
    // Esegui main con logging verboso
    main();
    
  } finally {
    // Ripristina log level
    getConfig().LOGGING.LEVEL = originalLevel;
  }
}

debugPipeline();
```

### 2. Analisi Email Saltate

```javascript
// Analizza perché le email vengono saltate
function analyzeSkippedEmails() {
  const gmail = new GmailService();
  const classifier = new Classifier();
  
  // Recupera thread con label "Skipped"
  const label = GmailApp.getUserLabelByName(getConfig().LABELS.SKIPPED);
  if (!label) {
    Logger.log('Nessuna email saltata');
    return;
  }
  
  const threads = label.getThreads(0, 20);
  Logger.log(`=== Analisi ${threads.length} email saltate ===\n`);
  
  const reasons = {};
  
  threads.forEach(thread => {
    const info = gmail.getThreadInfo(thread);
    const check = classifier.shouldIgnoreEmail(info);
    
    const reason = check.reason || 'unknown';
    reasons[reason] = (reasons[reason] || 0) + 1;
    
    Logger.log(`Thread: ${thread.getFirstMessageSubject()}`);
    Logger.log(`  From: ${info.from}`);
    Logger.log(`  Reason: ${reason}`);
    Logger.log('');
  });
  
  Logger.log('=== Riepilogo Motivi ===');
  Object.entries(reasons).forEach(([reason, count]) => {
    Logger.log(`${reason}: ${count}`);
  });
}

analyzeSkippedEmails();
```

### 3. Test Validazione Specifica

```javascript
// Testa validazione su risposta problematica
function debugValidation(responseText) {
  const validator = new ResponseValidator();
  
  const result = validator.validate(responseText, {
    language: 'it',
    subject: 'Test',
    body: 'Messaggio di test'
  });
  
  Logger.log('=== Risultato Validazione ===');
  Logger.log('Valid:', result.valid);
  Logger.log('Score:', result.score);
  Logger.log('\nIssues:');
  result.issues.forEach(issue => Logger.log('  - ' + issue));
  
  // Test singoli controlli
  Logger.log('\n=== Dettaglio Controlli ===');
  Logger.log('Lunghezza:', responseText.length);
  Logger.log('Ha saluto:', validator._hasGreeting(responseText));
  Logger.log('Pattern proibiti:', 
    getConfig().VALIDATION.FORBIDDEN_PATTERNS.filter(p => p.test(responseText))
  );
}

// Esempio uso:
const problematicResponse = `Ok`;
debugValidation(problematicResponse);
```

---

## Personalizzazioni

### 1. Aggiungere Nuovo Tipo di Classificazione

```javascript
// In RequestTypeClassifier.gs, aggiungi:

_scoreUrgent(text) {
  const urgentKeywords = [
    'urgente',
    'immediato',
    'asap',
    'emergency',
    'critico'
  ];
  
  let score = this._calculateScore(text, urgentKeywords);
  
  // Bonus per parole in maiuscolo o punti esclamativi
  if (/[A-Z]{4,}/.test(text) || (text.match(/!/g) || []).length > 2) {
    score *= 1.5;
  }
  
  return score;
}

// Poi modifica classify() per includere:
scores.urgent = this._scoreUrgent(text);

// E aggiungi in Config.gs:
CLASSIFICATION: {
  TYPES: {
    // ... esistenti ...
    URGENT: 'urgent'
  },
  KB_MAPPING: {
    // ... esistenti ...
    urgent: 'HEAVY'
  }
}
```

### 2. Personalizzare Saluti per Tipologia

```javascript
// Estendi Classifier.gs
generateGreeting(language, requestType) {
  const hour = new Date().getHours();
  
  // Saluti base
  const baseGreetings = {
    it: {
      morning: 'Buongiorno',
      afternoon: 'Buon pomeriggio',
      evening: 'Buonasera'
    }
    // ... altre lingue
  };
  
  // Personalizzazioni per tipo
  const customGreetings = {
    pastoral: {
      it: 'Pace e bene',
      en: 'Peace and good'
    },
    technical: {
      it: 'Salve',
      en: 'Hello'
    }
  };
  
  // Usa custom se disponibile, altrimenti base
  if (customGreetings[requestType] && customGreetings[requestType][language]) {
    return customGreetings[requestType][language];
  }
  
  const timeOfDay = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  return baseGreetings[language][timeOfDay];
}
```

### 3. Aggiungere Hook Pre/Post Elaborazione

```javascript
// In EmailProcessor.gs, aggiungi hook methods:

_beforeProcessThread(thread) {
  // Hook eseguito prima di processare thread
  // Utile per logging custom, metriche, etc.
  const threadId = thread.getId();
  PropertiesService.getScriptProperties()
    .setProperty(`processing_${threadId}`, Date.now().toString());
}

_afterProcessThread(thread, result) {
  // Hook eseguito dopo processamento
  const threadId = thread.getId();
  const startTime = PropertiesService.getScriptProperties()
    .getProperty(`processing_${threadId}`);
  
  if (startTime) {
    const duration = Date.now() - parseInt(startTime);
    Logger.log(`Thread ${threadId} processato in ${duration}ms`);
    
    // Salva metriche
    this._saveMetrics(threadId, duration, result);
  }
}

// Poi chiama nei punti appropriati di _processThread()
```

---

## Manutenzione

### 1. Backup Completo Sistema

```javascript
// Esporta configurazione e dati
function backupSystem() {
  const timestamp = Utilities.formatDate(new Date(), 'GMT', 'yyyyMMdd_HHmmss');
  
  // 1. Backup Properties
  const props = PropertiesService.getScriptProperties().getProperties();
  Logger.log('=== Script Properties ===');
  Logger.log(JSON.stringify(props, null, 2));
  
  // 2. Backup Memory
  const memory = new MemoryService();
  const memoryStats = memory.getStats();
  Logger.log('\n=== Memory Stats ===');
  Logger.log(JSON.stringify(memoryStats, null, 2));
  
  // 3. Backup KB Stats
  const kb = new KnowledgeBaseService();
  const kbStats = kb.getStats();
  Logger.log('\n=== KB Stats ===');
  Logger.log(JSON.stringify(kbStats, null, 2));
  
  // 4. Backup Rate Limiter
  const limiter = new GeminiRateLimiter();
  const limiterStats = limiter.getStats();
  Logger.log('\n=== Rate Limiter Stats ===');
  Logger.log(JSON.stringify(limiterStats, null, 2));
  
  Logger.log(`\n✓ Backup completato: ${timestamp}`);
  Logger.log('IMPORTANTE: Salva questo log per backup!');
}

backupSystem();
```

### 2. Pulizia Periodica

```javascript
// Script di pulizia da eseguire mensile
function monthlyCleanup() {
  Logger.log('=== Monthly Cleanup ===');
  
  // 1. Pulizia memoria vecchia (automatico in MemoryService)
  const memory = new MemoryService();
  Logger.log('✓ Memoria pulita automaticamente');
  
  // 2. Rimozione label vecchie
  const daysOld = 90;
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysOld);
  
  const labels = [
    getConfig().LABELS.PROCESSED,
    getConfig().LABELS.SKIPPED
  ];
  
  labels.forEach(labelName => {
    const label = GmailApp.getUserLabelByName(labelName);
    if (label) {
      const threads = label.getThreads();
      let removed = 0;
      
      threads.forEach(thread => {
        if (thread.getLastMessageDate() < cutoffDate) {
          thread.removeLabel(label);
          removed++;
        }
      });
      
      Logger.log(`✓ Rimossi ${removed} thread dalla label ${labelName}`);
    }
  });
  
  // 3. Refresh cache KB
  const kb = new KnowledgeBaseService();
  kb.invalidateCache();
  kb.preloadAll();
  Logger.log('✓ Cache KB refreshata');
  
  Logger.log('\n✓ Cleanup mensile completato');
}

monthlyCleanup();
```

### 3. Report Statistiche

```javascript
// Genera report settimanale
function weeklyReport() {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  
  const config = getConfig();
  const labels = [
    config.LABELS.PROCESSED,
    config.LABELS.SKIPPED,
    config.LABELS.ERROR,
    config.LABELS.NEEDS_REVIEW
  ];
  
  Logger.log('=== Weekly Report ===');
  Logger.log(`Periodo: ${oneWeekAgo.toLocaleDateString()} - ${new Date().toLocaleDateString()}\n`);
  
  const stats = {};
  
  labels.forEach(labelName => {
    const label = GmailApp.getUserLabelByName(labelName);
    if (label) {
      const threads = label.getThreads();
      const recentThreads = threads.filter(t => 
        t.getLastMessageDate() >= oneWeekAgo
      );
      stats[labelName] = recentThreads.length;
    } else {
      stats[labelName] = 0;
    }
  });
  
  Logger.log('Thread Processati:', stats[config.LABELS.PROCESSED] || 0);
  Logger.log('Thread Saltati:', stats[config.LABELS.SKIPPED] || 0);
  Logger.log('Errori:', stats[config.LABELS.ERROR] || 0);
  Logger.log('Da Rivedere:', stats[config.LABELS.NEEDS_REVIEW] || 0);
  
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  Logger.log('\nTotale Thread:', total);
  
  // Rate limiter usage
  const limiter = new GeminiRateLimiter();
  const limiterStats = limiter.getStats();
  Logger.log('\n=== API Usage ===');
  Logger.log('RPD Usage:', limiterStats.usage.rpd);
  
  return stats;
}

// Può essere schedulato settimanalmente
weeklyReport();
```

---

## Script Utility Rapidi

```javascript
// Raccolta di script one-liner utili

// Reset tutto
function quickReset() {
  resetSystem();
  Logger.log('✓ Sistema resettato');
}

// Rimuovi tutti i trigger
function removeAllTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log('✓ Trigger rimossi');
}

// Test veloce email specifica
function quickTest(subject, body) {
  const classifier = new RequestTypeClassifier();
  const result = classifier.classify(subject, body);
  Logger.log(JSON.stringify(result, null, 2));
}

// Conta email non lette
function countUnread() {
  const threads = GmailApp.getInboxThreads(0, 100);
  const unread = threads.filter(t => t.isUnread());
  Logger.log(`Email non lette: ${unread.length}`);
}

// Forza reload KB
function reloadKB() {
  const kb = new KnowledgeBaseService();
  kb.invalidateCache();
  kb.preloadAll();
  Logger.log('✓ KB ricaricata');
}
```