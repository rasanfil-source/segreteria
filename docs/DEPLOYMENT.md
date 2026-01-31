# 🚀 Production Deployment

> **Complete guide to deploying the system to production securely and professionally**

---

## 📋 Pre-Deployment Checklist

### Configuration Verification

- [ ] **Gemini API correctly configured**
  ```javascript
  // Run this test
  function testGeminiConnection() {
    const gemini = new GeminiService();
    const result = gemini.testConnection();
    console.log(result); // Should be { connectionOk: true }
  }
  ```

- [ ] **Knowledge Base populated**
  - Minimum 20 entries per "Instructions" sheet
  - AI_CORE_LITE completed with pastoral principles
  - AI_CORE completed for complex situations
  - Doctrine populated (if necessary)

- [ ] **Territory configured** (if applicable)
  - All parish streets inserted
  - Civic number ranges verified
  - Tested with real addresses

- [ ] **Test emails sent and responses verified**
  - Test in Italian ✓
  - Test in English ✓ (if necessary)
  - Test with attachments ✓
  - Test pastoral situations ✓

- [ ] **Validation functioning**
  - No false positives in the last 10 test emails
  - Average score > 0.7
  - No inappropriate "Check" emails

---

## 🔧 Production Configuration

### 1. Optimization Parameters

**In `gas_config.js`, configure:**

```javascript
// === PRODUCTION ===
CONFIG = {
  // Increase if you have high traffic
  MAX_EMAILS_PER_RUN: 10,  // Conservative to start
  
  // Production validation
  VALIDATION_ENABLED: true,
  VALIDATION_MIN_SCORE: 0.6,  // Recommended threshold
  VALIDATION_STRICT_MODE: false,  // Avoid excessive blocking
  
  // Rate limiting (important!)
  USE_RATE_LIMITER: true,
  
  // Logging
  LOGGING: {
    LEVEL: 'INFO',  // Do not use DEBUG in production
    STRUCTURED: true,
    SEND_ERROR_NOTIFICATIONS: true,
    ADMIN_EMAIL: 'your-admin-email@example.com'
  },
  
  // IMPORTANT: DO NOT use DRY_RUN in production!
  DRY_RUN: false
};
```

### 2. Operating Hours Configuration

**Define suspension hours:**

```javascript
// In gas_main.js
const SUSPENSION_HOURS = {
  1: [[9, 13], [16, 19]],  // Monday: 9-13, 16-19
  2: [[9, 13]],            // Tuesday: 9-13
  3: [[9, 13], [16, 19]],  // Wednesday: 9-13, 16-19
  4: [[9, 13]],            // Thursday: 9-13
  5: [[9, 13], [16, 19]]   // Friday: 9-13, 16-19
};
```

**💡 Tip:** During these hours the secretariat is operational, so the system suspends itself to leave room for human responses.

### 3. Production Trigger Setup

```javascript
function setupProductionTrigger() {
  // Remove all existing triggers
  ScriptApp.getProjectTriggers().forEach(trigger => {
    ScriptApp.deleteTrigger(trigger);
  });
  
  // Create trigger every 5 minutes (recommended)
  ScriptApp.newTrigger('main')
    .timeBased()
    .everyMinutes(5)
    .create();
  
  // Memory cleanup trigger (weekly)
  ScriptApp.newTrigger('cleanupOldMemory')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(3)
    .create();
  
  console.log('✓ Production triggers configured');
}
```

---

## 📊 Production Monitoring

### Daily Dashboard

**Run every morning:**

```javascript
function dailyHealthCheck() {
  console.log('═══════════════════════════════════');
  console.log('📊 DAILY HEALTH CHECK');
  console.log('═══════════════════════════════════');
  
  // 1. System verification
  const health = healthCheck();
  console.log('\n🏥 System Health:', health.status);
  
  // 2. API Quota
  if (typeof GeminiRateLimiter !== 'undefined') {
    const limiter = new GeminiRateLimiter();
    limiter.logUsageStats();
  }
  
  // 3. Emails processed yesterday
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  
  const label = GmailApp.getUserLabelByName('IA');
  if (label) {
    const threads = label.getThreads();
    const yesterdayThreads = threads.filter(t => 
      t.getLastMessageDate() >= yesterday
    );
    console.log(`\n📧 Emails processed yesterday: ${yesterdayThreads.length}`);
  }
  
  // 4. Emails to verify
  const verifyLabel = GmailApp.getUserLabelByName('Verifica');
  if (verifyLabel) {
    const toVerify = verifyLabel.getThreads().length;
    if (toVerify > 0) {
      console.warn(`⚠️ Emails to verify: ${toVerify}`);
    }
  }
  
  // 5. Errors
  const errorLabel = GmailApp.getUserLabelByName('Errore');
  if (errorLabel) {
    const errors = errorLabel.getThreads().length;
    if (errors > 0) {
      console.error(`❌ Emails with errors: ${errors}`);
    }
  }
  
  console.log('═══════════════════════════════════');
}
```

**💡 Tip:** Create a trigger to run this every morning at 8:00:

```javascript
ScriptApp.newTrigger('dailyHealthCheck')
  .timeBased()
  .everyDays(1)
  .atHour(8)
  .create();
```

### Automatic Alerts

**Configure notifications for critical situations:**

```javascript
function setupAlerts() {
  // In gas_config.js, ensure this is configured:
  LOGGING: {
    SEND_ERROR_NOTIFICATIONS: true,
    ADMIN_EMAIL: 'your-email@example.com'
  }
}
```

The system will automatically send emails for:
- ❌ Critical processing errors
- 🚨 API Quota > 90%
- ⚠️ Validation failed on >5 consecutive emails

---

## 🔐 Production Security

### 1. API Key Protection

**❌ NEVER do this:**
```javascript
// WRONG - hardcoded key in code
const GEMINI_API_KEY = 'AIzaSyD...';
```

**✅ ALWAYS do this:**
```javascript
// CORRECT - use Script Properties
const GEMINI_API_KEY = PropertiesService.getScriptProperties()
  .getProperty('GEMINI_API_KEY');
```

**How to set:**
1. Apps Script → ⚙️ Project Settings
2. Script Properties → Add property
3. Name: `GEMINI_API_KEY`
4. Value: your key

### 2. Minimum Permissions

**Verify that the script ONLY has necessary permissions:**

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

**DO NOT add:**
- `gmail.readonly` if you only need to read
- `drive` if you only use specific Sheets
- `calendar` if you don't manage appointments

### 3. Google Sheets Sharing

**Knowledge Base and Memory:**

```
Share with: info@parish.org (script account)
Permissions: Editor
Visibility: Private (NOT public)
```

**⚠️ NEVER make public** sheets containing parish information.

---

## 🤖 Gemini Model Selection Guide

### Decision Matrix

| Scenario | Recommended Model | RPD Budget | Estimated Cost/Month |
|----------|-------------------|------------|----------------------|
| Small parish (<50 emails/week) | Flash Lite | 1000 | €5-8 |
| Medium parish (100-200 emails/week) | Flash 2.5 | 250 | €10-15 |
| Large parish (>300 emails/week) | Flash 2.5 + Lite fallback | 250+1000 | €15-25 |
| Development/Test | Flash Lite | 1000 | €0-2 |

### When to Use Fallback Chain?

```javascript
// Recommended configuration for production
CONFIG.MODEL_STRATEGY = {
  'quick_check': ['flash-lite'],             // Economy for quick checks
  'generation': ['flash-2.5', 'flash-lite'], // Quality → Fallback
  'fallback': ['flash-lite', 'flash-2.0']    // Last resort
};
```

### Pros/Cons per Model

| Model | ✅ Pros | ❌ Cons |
|-------|---------|---------|
| **Flash 2.5** | Maximum quality, fewer hallucinations, better reasoning | Limited RPD (250/day) |
| **Flash Lite** | Generous RPD (1000), economical, fast | Sometimes generic responses |
| **Flash 2.0** | Stable, well tested | Less capable than 2.5, legacy |

### Configuration by Scenario

**Small Parish (economical):**
```javascript
CONFIG.MODEL_STRATEGY = {
  'quick_check': ['flash-lite'],
  'generation': ['flash-lite']
};
CONFIG.MAX_EMAILS_PER_RUN = 5;
```

**Medium Parish (balanced):**
```javascript
CONFIG.MODEL_STRATEGY = {
  'quick_check': ['flash-lite'],
  'generation': ['flash-2.5', 'flash-lite']
};
CONFIG.MAX_EMAILS_PER_RUN = 10;
```

**Large Parish (maximum quality):**
```javascript
CONFIG.MODEL_STRATEGY = {
  'quick_check': ['flash-lite'],
  'generation': ['flash-2.5']
};
CONFIG.MAX_EMAILS_PER_RUN = 15;
// Consider trigger every 5 minutes

```

---

## 📈 Scaling and Performance

### When to Increase Resources

**Scenario 1: High Email Volume (>100/day)**

```javascript
// Increase trigger frequency
ScriptApp.newTrigger('main')
  .timeBased()
  .everyMinutes(5)  // Standard frequency
  .create();

// Increase emails per run
CONFIG.MAX_EMAILS_PER_RUN = 15;  // Was 10
```

**Scenario 2: Very Large Knowledge Base (>50KB)**

```javascript
// Enable aggressive caching
CONFIG.KB_CACHE_ENABLED = true;
CONFIG.KB_CACHE_TTL = 7200000;  // 2 hours instead of 1

// Use lite profile more often
CONFIG.DEFAULT_PROMPT_PROFILE = 'lite';
```

**Scenario 3: Limited API Quota**

```javascript
// Reduce load
CONFIG.MAX_EMAILS_PER_RUN = 5;

// Use cheaper models
CONFIG.MODEL_STRATEGY = {
  'quick_check': ['flash-lite'],
  'generation': ['flash-lite', 'flash-2.5']  // Inverted
};
```

### Google Apps Script Limits

**Watch out for these limits:**

| Resource | Free Limit | Workspace Limit |
|---------|-------------|------------------|
| Execution time | 6 minutes | 6 minutes |
| Triggers/day | 20 | 20 |
| Emails/day | 100 | 1500 |
| UrlFetch/day | 20000 | 20000 |

**💡 Solution:** If you exceed limits, consider:
- Increasing trigger interval (e.g., every 10 min instead of 5)
- Reducing MAX_EMAILS_PER_RUN
- Upgrading to Google Workspace (more email quota)

---

## 🔄 Backup and Disaster Recovery

### Automatic Weekly Backup

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
    // Mask API key for security
    if (key === 'GEMINI_API_KEY') {
      propsCopy[key] = '***MASKED***';
    } else {
      propsCopy[key] = props[key];
    }
  }
  
  // 2. Backup Configuration (from CONFIG)
  const configBackup = {
    MAX_EMAILS_PER_RUN: CONFIG.MAX_EMAILS_PER_RUN,
    VALIDATION_MIN_SCORE: CONFIG.VALIDATION_MIN_SCORE,
    LANGUAGES_SUPPORTED: CONFIG.LANGUAGES_SUPPORTED,
    timestamp: timestamp
  };
  
  // 3. Save to dedicated Sheet
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
  
  console.log(`✓ Backup completed: ${timestamp}`);
}

// Setup weekly backup trigger
function setupBackupTrigger() {
  ScriptApp.newTrigger('weeklyBackup')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(2)
    .create();
}
```

### Recovery from Backup

```javascript
function restoreFromBackup(backupTimestamp) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const backupSheet = ss.getSheetByName('SystemBackup');
  
  if (!backupSheet) {
    console.error('❌ Backup sheet not found');
    return;
  }
  
  const data = backupSheet.getDataRange().getValues();
  
  // Find backup by timestamp
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === backupTimestamp && data[i][1] === 'config') {
      const backupData = JSON.parse(data[i][2]);
      console.log('📦 Backup found:', backupData);
      
      // Manually restore values in gas_config.js
      console.log('\n⚠️ Manually restore these values:');
      console.log(JSON.stringify(backupData, null, 2));
      return;
    }
  }
  
  console.error('❌ Backup not found for timestamp:', backupTimestamp);
}
```

---

## 📝 Logs and Production Debugging

### Structured Logging

**The system uses JSON logs for easy parsing:**

```javascript
// Log example
{
  "timestamp": "2026-01-19T10:30:00Z",
  "level": "INFO",
  "context": "EmailProcessor",
  "message": "Thread processed",
  "threadId": "18d123...",
  "status": "replied",
  "duration": 3421
}
```

### Accessing Logs

**Via Apps Script:**
1. Apps Script → ☰ Menu
2. Executions
3. Filter by date/status

**Exporting Logs:**

```javascript
function exportLogs(startDate, endDate) {
  // Retrieve execution logs
  const executions = ScriptApp.getProjectTriggers()
    .map(trigger => trigger.getHandlerFunction());
  
  // In production, use StackDriver for centralized logging
  console.log('For full log export, use Google Cloud Logging');
  console.log('https://console.cloud.google.com/logs');
}
```

---

## 🎯 Success Metrics

### KPIs to Monitor

**Weekly:**

| Metric | Target | Action if Off Target |
|---------|--------|------------------------|
| % Automated Emails | >70% | Enrich KB |
| % "Check" Emails | <15% | Lower validation threshold |
| % Errors | <5% | Investigate causes |
| Average Response Time | <10 min | Reduce trigger interval |
| Average Validation Score | >0.75 | Improve prompt |
| API Quota Used | <80% | Optimize model usage |

**Monthly:**

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
  console.log(`Period: ${oneMonthAgo.toLocaleDateString()} - ${now.toLocaleDateString()}`);
  console.log(`\nTotal Emails: ${total}`);
  console.log(`  Automated: ${stats.processed} (${automationRate}%)`);
  console.log(`  To Verify: ${stats.verify}`);
  console.log(`  Errors: ${stats.error}`);
  console.log('═══════════════════════════════════');
  
  return stats;
}
```

---

## 🚨 Emergency Plan

### Scenario 1: System Not Responding

**Rapid Diagnosis:**

```javascript
function emergencyDiagnostic() {
  console.log('🚨 EMERGENCY DIAGNOSTIC');
  
  // 1. Triggers active?
  const triggers = ScriptApp.getProjectTriggers();
  console.log(`Active triggers: ${triggers.length}`);
  triggers.forEach(t => {
    console.log(`  - ${t.getHandlerFunction()}`);
  });
  
  // 2. API Key valid?
  const apiKey = PropertiesService.getScriptProperties()
    .getProperty('GEMINI_API_KEY');
  console.log(`API Key present: ${!!apiKey}`);
  
  // 3. Knowledge Base accessible?
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    console.log('✓ Knowledge Base accessible');
  } catch (e) {
    console.error('❌ Knowledge Base NOT accessible:', e.message);
  }
  
  // 4. Last execution?
  console.log('Manually check in: Executions');
}
```

**Quick Solutions:**
1. Verify trigger is active
2. Re-authorize script (run `setupTrigger`)
3. Check API quota not exhausted
4. Check error logs

### Scenario 2: Too Many "Check" Emails

**Immediate Fix:**

```javascript
// In gas_config.js
CONFIG.VALIDATION_MIN_SCORE = 0.5;  // Was 0.6
// Restart trigger
main();
```

### Scenario 3: API Quota Exhausted

**Temporary Workaround:**

```javascript
// Temporarily ignore
CONFIG.MAX_EMAILS_PER_RUN = 0;  // Suspends processing

// Or use only lite model
CONFIG.MODEL_STRATEGY = {
  'quick_check': ['flash-lite'],
  'generation': ['flash-lite']
};
```

---

## ✅ Go-Live Checklist

**Before activating in production:**

- [ ] Tests completed with 10+ real emails
- [ ] Configuration backup performed
- [ ] Admin email configured for alerts
- [ ] Production triggers configured
- [ ] Monitoring dashboard accessible
- [ ] Disaster recovery plan documented
- [ ] Team trained on system usage
- [ ] Soft-launch period (1 week intensive monitoring)

**Soft Launch (First Week):**
- Monitor ALL processed emails
- Check "Check" label daily
- Collect user feedback
- Refine Knowledge Base based on identified gaps

**Full Go-Live:**
- Officially announce the service
- Communicate improved response times
- Maintain weekly monitoring for the first month

---

## 📞 Post-Deployment Support

**In case of problems:**

1. **Consult first** this guide and TROUBLESHOOTING.md
2. **Run** `emergencyDiagnostic()`
3. **Collect** error logs from Executions
4. **Contact** info@parrocchiasanteugenio.it with:
   - Problem description
   - Relevant logs
   - Configuration (masked)

**Support Channels:**
- 📧 Email: info@parrocchiasanteugenio.it (response within 24h)

---

**Happy deployment! 🚀**
