# 🚀 Deployment in Produzione

[![English Version](https://img.shields.io/badge/English-Version-blue?style=flat-square)](DEPLOYMENT.md)

> **Guida completa per mettere in produzione il sistema in modo sicuro e professionale**

---

## 📋 Pre-Deployment Checklist

### Verifica Configurazione

- [ ] **API Gemini configurata correttamente**
  ```javascript
  // Esegui questo test
  function testGeminiConnection() {
    const gemini = new GeminiService();
    const result = gemini.testConnection();
    console.log(result); // Deve essere { connectionOk: true }
  }
  ```

- [ ] **Knowledge Base popolata**
  - Minimo 20 entry per foglio Istruzioni
  - AI_CORE_LITE completato con principi pastorali
  - AI_CORE completato per situazioni complesse
  - Dottrina popolata (se necessaria)

- [ ] **Territorio configurato** (se applicabile)
  - Tutte le vie della parrocchia inserite
  - Range numeri civici verificati
  - Test con indirizzi reali effettuato

- [ ] **Email di test inviate e risposte verificate**
  - Test in italiano ✓
  - Test in inglese ✓ (se necessario)
  - Test con allegati ✓ (Verifica lettura OCR)
  - Test situazioni pastorali ✓

- [ ] **Validazione funzionante**
  - Nessun falso positivo nelle ultime 10 email di test
  - Score medio > 0.7
  - Nessuna email "Verifica" inappropriata

---

## 🔧 Configurazione Produzione

### 1. Ottimizzazione Parametri

**In `gas_config.js`, configura:**

```javascript
// === PRODUZIONE ===
CONFIG = {
  // Aumenta se hai molto traffico
  MAX_EMAILS_PER_RUN: 10,  // Conservativo per iniziare
  
  // Validazione in produzione
  VALIDATION_ENABLED: true,
  VALIDATION_MIN_SCORE: 0.6,  // Soglia consigliata
  VALIDATION_STRICT_MODE: false,  // Evita blocchi eccessivi
  
  // Rate limiting (importante!)
  USE_RATE_LIMITER: true,
  
  // Logging
  LOGGING: {
    LEVEL: 'INFO',  // Non usare DEBUG in produzione
    STRUCTURED: true,
    SEND_ERROR_NOTIFICATIONS: true,
    ADMIN_EMAIL: 'tuo-email-admin@example.com'
  },
  
  // IMPORTANTE: NON usare DRY_RUN in produzione!
  DRY_RUN: false
};
```

### 2. Configurazione Orari

**Definisci gli orari di sospensione:**

```javascript
// In gas_main.js
const SUSPENSION_HOURS = {
  1: [[9, 13], [16, 19]],  // Lunedì: 9-13, 16-19
  2: [[9, 13]],            // Martedì: 9-13
  3: [[9, 13], [16, 19]],  // Mercoledì: 9-13, 16-19
  4: [[9, 13]],            // Giovedì: 9-13
  5: [[9, 13], [16, 19]]   // Venerdì: 9-13, 16-19
};
```

**💡 Consiglio:** Durante questi orari la segreteria è operativa, quindi il sistema si sospende per lasciare spazio alle risposte umane.

### 3. Setup Trigger Produzione

```javascript
function setupProductionTrigger() {
  // Rimuovi tutti i trigger esistenti
  ScriptApp.getProjectTriggers().forEach(trigger => {
    ScriptApp.deleteTrigger(trigger);
  });
  
  // Crea trigger ogni 5 minuti (raccomandato)
  ScriptApp.newTrigger('main')
    .timeBased()
    .everyMinutes(5)
    .create();
  
  // Trigger cleanup memoria (settimanale)
  ScriptApp.newTrigger('cleanupOldMemory')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(3)
    .create();
  
  console.log('✓ Trigger produzione configurati');
}
```

---

## 📊 Monitoraggio Produzione

### Dashboard Quotidiana

**Esegui ogni mattina:**

```javascript
function dailyHealthCheck() {
  console.log('═══════════════════════════════════');
  console.log('📊 DAILY HEALTH CHECK');
  console.log('═══════════════════════════════════');
  
  // 1. Verifica sistema
  const health = healthCheck();
  console.log('\n🏥 System Health:', health.status);
  
  // 2. Quota API
  if (typeof GeminiRateLimiter !== 'undefined') {
    const limiter = new GeminiRateLimiter();
    limiter.logUsageStats();
  }
  
  // 3. Email elaborate ieri
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  
  const label = GmailApp.getUserLabelByName('IA');
  if (label) {
    const threads = label.getThreads();
    const yesterdayThreads = threads.filter(t => 
      t.getLastMessageDate() >= yesterday
    );
    console.log(`\n📧 Email elaborate ieri: ${yesterdayThreads.length}`);
  }
  
  // 4. Email da verificare
  const verifyLabel = GmailApp.getUserLabelByName('Verifica');
  if (verifyLabel) {
    const toVerify = verifyLabel.getThreads().length;
    if (toVerify > 0) {
      console.warn(`⚠️ Email da verificare: ${toVerify}`);
    }
  }
  
  // 5. Errori
  const errorLabel = GmailApp.getUserLabelByName('Errore');
  if (errorLabel) {
    const errors = errorLabel.getThreads().length;
    if (errors > 0) {
      console.error(`❌ Email con errori: ${errors}`);
    }
  }
  
  console.log('═══════════════════════════════════');
}
```

**💡 Consiglio:** Crea un trigger per eseguire questo ogni mattina alle 8:00:

```javascript
ScriptApp.newTrigger('dailyHealthCheck')
  .timeBased()
  .everyDays(1)
  .atHour(8)
  .create();
```

### Alert Automatici

**Configura notifiche per situazioni critiche:**

```javascript
function setupAlerts() {
  // In gas_config.js, assicurati che sia configurato:
  LOGGING: {
    SEND_ERROR_NOTIFICATIONS: true,
    ADMIN_EMAIL: 'tuo-email@example.com'
  }
}
```

Il sistema invierà email automaticamente per:
- ❌ Errori critici nell'elaborazione
- 🚨 Quota API > 90%
- ⚠️ Validazione fallita su >5 email consecutive

---

## 🔐 Sicurezza Produzione

### 1. Protezione API Key

**❌ MAI fare questo:**
```javascript
// SBAGLIATO - chiave hardcoded nel codice
const GEMINI_API_KEY = 'AIzaSyD...';
```

**✅ SEMPRE fare così:**
```javascript
// CORRETTO - usa Script Properties
const GEMINI_API_KEY = PropertiesService.getScriptProperties()
  .getProperty('GEMINI_API_KEY');
```

**Come impostare:**
1. Apps Script → ⚙️ Impostazioni Progetto
2. Script Properties → Aggiungi proprietà
3. Nome: `GEMINI_API_KEY`
4. Valore: la tua chiave

### 2. Permessi Minimi

**Verifica che lo script abbia SOLO i permessi necessari:**

```javascript
// In appsscript.json
{
  "oauthScopes": [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/script.external_request"
  ]
}
```

**NON aggiungere:**
- `gmail.readonly` se non serve solo leggere
- `drive` se usi solo Sheets specifici
- `calendar` se non gestisci appuntamenti

### 3. Condivisione Fogli Google

**Knowledge Base e Memoria:**

```
Condividi con: info@tuaparrocchia.it (account script)
Permessi: Editor
Visibilità: Privato (NON pubblico)
```

**⚠️ MAI rendere pubblici** i fogli con informazioni della parrocchia.

---

## 🤖 Guida Selezione Modello Gemini

### Decision Matrix

| Scenario | Modello Consigliato | RPD Budget | Costo Stimato/Mese |
|----------|---------------------|------------|---------------------|
| Parrocchia piccola (<50 email/settimana) | Flash Lite | 1000 | €5-8 |
| Parrocchia media (100-200 email/settimana) | Flash 2.5 | 250 | €10-15 |
| Parrocchia grande (>300 email/settimana) | Flash 2.5 + Lite fallback | 250+1000 | €15-25 |
| Sviluppo/Test | Flash Lite | 1000 | €0-2 |

### Quando Usare Fallback Chain?

```javascript
// Configurazione consigliata per produzione
CONFIG.MODEL_STRATEGY = {
  'quick_check': ['flash-lite'],           // Economia per check rapidi
  'generation': ['flash-2.5', 'flash-lite'], // Qualità → Fallback
  'fallback': ['flash-lite', 'flash-2.0']    // Ultimo resort
};
```

### Pro/Contro per Modello

| Modello | ✅ Pro | ❌ Contro |
|---------|--------|-----------|
| **Flash 2.5** | Qualità massima, meno allucinazioni, reasoning migliore | RPD limitato (250/giorno) |
| **Flash Lite** | RPD generoso (1000), economico, veloce | A volte risposte generiche |
| **Flash 2.0** | Stabile, ben testato | Meno capace di 2.5, legacy |

### Configurazione per Scenario

**Parrocchia Piccola (economica):**
```javascript
CONFIG.MODEL_STRATEGY = {
  'quick_check': ['flash-lite'],
  'generation': ['flash-lite']
};
CONFIG.MAX_EMAILS_PER_RUN = 5;
```

**Parrocchia Media (bilanciata):**
```javascript
CONFIG.MODEL_STRATEGY = {
  'quick_check': ['flash-lite'],
  'generation': ['flash-2.5', 'flash-lite']
};
CONFIG.MAX_EMAILS_PER_RUN = 10;
```

**Parrocchia Grande (qualità massima):**
```javascript
CONFIG.MODEL_STRATEGY = {
  'quick_check': ['flash-lite'],
  'generation': ['flash-2.5']
};
CONFIG.MAX_EMAILS_PER_RUN = 15;
// Considera trigger ogni 5 minuti

```

---

## 📈 Scaling e Performance

### Quando Aumentare Risorse

**Scenario 1: Volume Email Elevato (>100/giorno)**

```javascript
// Aumenta frequenza trigger
ScriptApp.newTrigger('main')
  .timeBased()
  .everyMinutes(5)  // Frequenza standard
  .create();

// Aumenta email per esecuzione
CONFIG.MAX_EMAILS_PER_RUN = 15;  // Era 10
```

**Scenario 2: Knowledge Base Molto Grande (>50KB)**

```javascript
// Abilita caching aggressivo
CONFIG.KB_CACHE_ENABLED = true;
CONFIG.KB_CACHE_TTL = 7200000;  // 2 ore invece di 1

// Usa profilo lite più spesso
CONFIG.DEFAULT_PROMPT_PROFILE = 'lite';
```

**Scenario 3: Quota API Limitata**

```javascript
// Riduci carico
CONFIG.MAX_EMAILS_PER_RUN = 5;

// Usa modelli più economici
CONFIG.MODEL_STRATEGY = {
  'quick_check': ['flash-lite'],
  'generation': ['flash-lite', 'flash-2.5']  // Invertito
};
```

### Limiti Google Apps Script

**Attenzione a questi limiti:**

| Risorsa | Limite Free | Limite Workspace |
|---------|-------------|------------------|
| Tempo esecuzione | 6 minuti | 6 minuti |
| Trigger/giorno | 20 | 20 |
| Email/giorno | 100 | 1500 |
| UrlFetch/giorno | 20000 | 20000 |

**💡 Soluzione:** Se superi i limiti, considera:
- Aumentare intervallo trigger (es. ogni 10 min invece di 5)
- Ridurre MAX_EMAILS_PER_RUN
- Passare a Google Workspace (più quota email)

---

## 🔄 Backup e Disaster Recovery

### Backup Automatico Settimanale

```javascript
function weeklyBackup() {
  const timestamp = Utilities.formatDate(
    new Date(), 
    'Europe/Rome', 
    'yyyyMMdd_HHmmss'
  );
  
  // 1. Backup Script Properties
  const props = PropertiesService.getScriptProperties().getProperties();
  const propsCopy = {};
  for (const key in props) {
    // Maschera API key per sicurezza
    if (key === 'GEMINI_API_KEY') {
      propsCopy[key] = '***MASKED***';
    } else {
      propsCopy[key] = props[key];
    }
  }
  
  // 2. Backup Configurazione (da CONFIG)
  const configBackup = {
    MAX_EMAILS_PER_RUN: CONFIG.MAX_EMAILS_PER_RUN,
    VALIDATION_MIN_SCORE: CONFIG.VALIDATION_MIN_SCORE,
    LANGUAGES_SUPPORTED: CONFIG.LANGUAGES_SUPPORTED,
    timestamp: timestamp
  };
  
  // 3. Salva in Sheet dedicato
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let backupSheet = ss.getSheetByName('SystemBackup');
  
  if (!backupSheet) {
    backupSheet = ss.insertSheet('SystemBackup');
    backupSheet.getRange('A1:C1').setValues([
      ['Timestamp', 'Type', 'Data']
    ]);
  }
  
  backupSheet.appendRow([
    timestamp,
    'config',
    JSON.stringify(configBackup)
  ]);
  
  backupSheet.appendRow([
    timestamp,
    'properties',
    JSON.stringify(propsCopy)
  ]);
  
  console.log(`✓ Backup completato: ${timestamp}`);
}

// Setup trigger backup settimanale
function setupBackupTrigger() {
  ScriptApp.newTrigger('weeklyBackup')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(2)
    .create();
}
```

### Recovery da Backup

```javascript
function restoreFromBackup(backupTimestamp) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const backupSheet = ss.getSheetByName('SystemBackup');
  
  if (!backupSheet) {
    console.error('❌ Sheet backup non trovato');
    return;
  }
  
  const data = backupSheet.getDataRange().getValues();
  
  // Trova backup per timestamp
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === backupTimestamp && data[i][1] === 'config') {
      const backupData = JSON.parse(data[i][2]);
      console.log('📦 Backup trovato:', backupData);
      
      // Ripristina manualmente i valori in gas_config.js
      console.log('\n⚠️ Ripristina manualmente questi valori:');
      console.log(JSON.stringify(backupData, null, 2));
      return;
    }
  }
  
  console.error('❌ Backup non trovato per timestamp:', backupTimestamp);
}
```

---

## 📝 Log e Debugging Produzione

### Structured Logging

**Il sistema usa log JSON per facile parsing:**

```javascript
// Esempio log
{
  "timestamp": "2026-01-19T10:30:00Z",
  "level": "INFO",
  "context": "EmailProcessor",
  "message": "Thread elaborato",
  "threadId": "18d123...",
  "status": "replied",
  "duration": 3421
}
```

### Accesso ai Log

**Via Apps Script:**
1. Apps Script → ☰ Menu
2. Esecuzioni
3. Filtra per data/stato

**Esportazione Log:**

```javascript
function exportLogs(startDate, endDate) {
  // Recupera execution logs
  const executions = ScriptApp.getProjectTriggers()
    .map(trigger => trigger.getHandlerFunction());
  
  // In produzione, usa StackDriver per log centralizzato
  console.log('Per export log completo, usa Google Cloud Logging');
  console.log('https://console.cloud.google.com/logs');
}
```

---

## 🎯 Metriche di Successo

### KPI da Monitorare

**Settimanalmente:**

| Metrica | Target | Azione se Fuori Target |
|---------|--------|------------------------|
| % Email automatizzate | >70% | Arricchire KB |
| % Email "Verifica" | <15% | Abbassare soglia validazione |
| % Errori | <5% | Investigare cause |
| Tempo medio risposta | <10 min | Ridurre intervallo trigger |
| Score validazione medio | >0.75 | Migliorare prompt |
| Quota API usata | <80% | Ottimizzare uso modelli |

**Mensile:**

```javascript
function monthlyReport() {
  const now = new Date();
  const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
  
  const labels = {
    processed: GmailApp.getUserLabelByName('IA'),
    verify: GmailApp.getUserLabelByName('Verifica'),
    error: GmailApp.getUserLabelByName('Errore')
  };
  
  const stats = {};
  
  for (const [name, label] of Object.entries(labels)) {
    if (label) {
      const threads = label.getThreads();
      stats[name] = threads.filter(t => 
        t.getLastMessageDate() >= oneMonthAgo
      ).length;
    }
  }
  
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  const automationRate = ((stats.processed / total) * 100).toFixed(1);
  
  console.log('═══════════════════════════════════');
  console.log('📊 MONTHLY REPORT');
  console.log('═══════════════════════════════════');
  console.log(`Periodo: ${oneMonthAgo.toLocaleDateString()} - ${now.toLocaleDateString()}`);
  console.log(`\nEmail Totali: ${total}`);
  console.log(`  Automatizzate: ${stats.processed} (${automationRate}%)`);
  console.log(`  Da Verificare: ${stats.verify}`);
  console.log(`  Errori: ${stats.error}`);
  console.log('═══════════════════════════════════');
  
  return stats;
}
```

---

## 🚨 Piano di Emergenza

### Scenario 1: Sistema Non Risponde

**Diagnosi rapida:**

```javascript
function emergencyDiagnostic() {
  console.log('🚨 EMERGENCY DIAGNOSTIC');
  
  // 1. Trigger attivi?
  const triggers = ScriptApp.getProjectTriggers();
  console.log(`Trigger attivi: ${triggers.length}`);
  triggers.forEach(t => {
    console.log(`  - ${t.getHandlerFunction()}`);
  });
  
  // 2. API Key valida?
  const apiKey = PropertiesService.getScriptProperties()
    .getProperty('GEMINI_API_KEY');
  console.log(`API Key presente: ${!!apiKey}`);
  
  // 3. Knowledge Base accessibile?
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    console.log('✓ Knowledge Base accessibile');
  } catch (e) {
    console.error('❌ Knowledge Base NON accessibile:', e.message);
  }
  
  // 4. Ultima esecuzione?
  console.log('Controlla manualmente in: Esecuzioni');
}
```

**Soluzioni rapide:**
1. Verifica trigger attivo
2. Re-autorizza script (esegui `setupTrigger`)
3. Verifica quota API non esaurita
4. Controlla log errori

### Scenario 2: Troppe Email "Verifica"

**Fix immediato:**

```javascript
// In gas_config.js
CONFIG.VALIDATION_MIN_SCORE = 0.5;  // Era 0.6

// Riavvia trigger
main();
```

### Scenario 3: Quota API Esaurita

**Workaround temporaneo:**

```javascript
// Disabilita temporaneamente
CONFIG.MAX_EMAILS_PER_RUN = 0;  // Sospende elaborazione

// Oppure usa solo modello lite
CONFIG.MODEL_STRATEGY = {
  'quick_check': ['flash-lite'],
  'generation': ['flash-lite']
};
```

---

## ✅ Checklist Go-Live

**Prima di attivare in produzione:**

- [ ] Test completati con 10+ email reali
- [ ] Backup configurazione effettuato
- [ ] Email admin configurata per alert
- [ ] Trigger produzione configurati
- [ ] Dashboard monitoring accessibile
- [ ] Piano disaster recovery documentato
- [ ] Team formato sull'uso del sistema
- [ ] Periodo di soft-launch (1 settimana monitoraggio intensivo)

**Soft Launch (Prima Settimana):**
- Monitora TUTTE le email elaborate
- Controlla quotidianamente etichetta "Verifica"
- Raccogli feedback utenti
- Affina Knowledge Base in base a gap rilevati

**Go-Live Completo:**
- Annuncia ufficialmente il servizio
- Comunica tempi di risposta migliorati
- Mantieni monitoraggio settimanale primo mese

---

## 📞 Supporto Post-Deployment

**In caso di problemi:**

1. **Consulta prima** questa guida e TROUBLESHOOTING.md
2. **Esegui** `emergencyDiagnostic()`
3. **Raccogli** log errori da Esecuzioni
4. **Contatta** info@parrocchiasanteugenio.it con:
   - Descrizione problema
   - Log rilevanti
   - Configurazione (mascherata)

**Canali supporto:**
- 📧 Email: info@parrocchiasanteugenio.it (risposta entro 24h)

---

**Buon deployment! 🚀**