# 🔧 Troubleshooting

> **Complete guide to resolving common system problems**

---

## 🚨 Critical Problems (Total Blockage)

### 1. System Processes NO Emails

**Symptoms:**
- No "IA" label applied
- No emails in "Verifica" (Check) or "Errore" (Error)
- Inbox full of unread emails

**Diagnosis:**

```javascript
function diagnoseNoProcessing() {
  console.log('🔍 DIAGNOSIS: No processing');
  
  // 1. Trigger active?
  const triggers = ScriptApp.getProjectTriggers();
  const mainTrigger = triggers.find(t => t.getHandlerFunction() === 'main');
  
  if (!mainTrigger) {
    console.error('❌ Trigger "main" NOT found!');
    console.log('Solution: Run setupTrigger()');
    return;
  }
  
  console.log('✓ Trigger active');
  
  // 2. Last executions?
  console.log('\nCheck manually:');
  console.log('Apps Script → Executions → See if "main" ran');
  
  // 3. Time suspension?
  if (isInSuspensionTime()) {
    console.warn('⚠️ WE ARE IN SUSPENSION TIME');
    console.log('The system will resume outside office hours');
    return;
  }
  
  console.log('✓ Not in suspension');
  
  // 4. Unread emails present?
  const unread = GmailApp.getInboxThreads(0, 5);
  console.log(`\n📬 Unread emails: ${unread.filter(t => t.isUnread()).length}`);
}
```

**Solutions:**

| Cause | Solution |
|-------|-----------|
| Missing Trigger | Run `setupTrigger()` |
| Trigger Disabled | Apps Script → Triggers → Enable |
| Expired Permissions | Re-run `setupTrigger()` and authorize |
| Suspension Time | Wait for end of office hours or modify SUSPENSION_HOURS |
| Script Crashed | Check "Executions" for errors |

---

### 2. Error "Invalid API Key"

**Symptom:**
```
Error: 401 Unauthorized - GEMINI_API_KEY invalid
```

**Diagnosis:**

```javascript
function testApiKey() {
  const apiKey = PropertiesService.getScriptProperties()
    .getProperty('GEMINI_API_KEY');
  
  if (!apiKey) {
    console.error('❌ API Key NOT configured!');
    return;
  }
  
  console.log('API Key present:', apiKey.substring(0, 10) + '...');
  
  // Test connection
  const gemini = new GeminiService();
  const test = gemini.testConnection();
  
  if (test.connectionOk) {
    console.log('✓ API Key VALID');
  } else {
    console.error('❌ API Key INVALID');
    console.log('Errors:', test.errors);
  }
}
```

**Solutions:**

1. **Verify API Key:**
   - Go to: https://aistudio.google.com/apikey
   - Check that key exists and is active
   - If invalid, generate new key

2. **Re-configure in Script Properties:**
   ```
   Apps Script → ⚙️ Project Settings
   → Script Properties
   → Edit "GEMINI_API_KEY"
   → Paste new key
   ```

3. **Verify quota not exhausted:**
   - Go to: https://console.cloud.google.com/apis/api/generativelanguage.googleapis.com/quotas
   - Check daily quota

---

### 3. Error "Spreadsheet Not Found"

**Symptom:**
```
Error: Cannot find spreadsheet with ID: 1ABC...
```

**Diagnosis:**

```javascript
function testSpreadsheetAccess() {
  const sheetId = CONFIG.SPREADSHEET_ID;
  
  if (!sheetId || sheetId.includes('YOUR_')) {
    console.error('❌ SPREADSHEET_ID not configured!');
    console.log('Go to gas_config.js and replace YOUR_SPREADSHEET_ID_HERE');
    return;
  }
  
  try {
    const ss = SpreadsheetApp.openById(sheetId);
    console.log('✓ Spreadsheet accessible:', ss.getName());
    
    // Verify sheets
    const sheets = {
      'Instructions': ss.getSheetByName('Istruzioni'),
      'AI_CORE_LITE': ss.getSheetByName('AI_CORE_LITE'),
      'AI_CORE': ss.getSheetByName('AI_CORE'),
      'Doctrine': ss.getSheetByName('Dottrina')
    };
    
    for (const [name, sheet] of Object.entries(sheets)) {
      if (!sheet) {
        console.error(`❌ Sheet "${name}" missing!`);
      } else {
        console.log(`✓ Sheet "${name}" present`);
      }
    }
    
  } catch (e) {
    console.error('❌ Spreadsheet access error:', e.message);
  }
}
```

**Solutions:**

1. **Verify correct ID:**
   - Open Google Sheet
   - URL: `https://docs.google.com/spreadsheets/d/1ABC...XYZ/edit`
   - The part `1ABC...XYZ` is the ID

2. **Verify permissions:**
   - Sheet must be shared with parish Gmail account
   - Minimum permission: "Editor"

3. **Verify sheets exist:**
   - Must exist: Istruzioni, AI_CORE_LITE, AI_CORE, Dottrina

---

## ⚠️ Frequent Problems

### 4. Too Many Emails Marked "Verifica" (Check)

**Symptom:**
- >30% of emails end up in "Verifica"
- Even simple emails require review

**Cause:**
Validation threshold too high

**Diagnosis:**

```javascript
function analyzeValidationScores() {
  const verifyLabel = GmailApp.getUserLabelByName('Verifica');
  if (!verifyLabel) {
    console.log('No emails in Check');
    return;
  }
  
  const threads = verifyLabel.getThreads(0, 20);
  console.log(`\n📊 Analysis ${threads.length} emails in Check:`);
  console.log('Check execution logs to see validation scores');
  console.log('\nSearch rows like: "Validation FAILED (score: 0.XX)"');
}
```

**Solutions:**

**Temporary (test):**
```javascript
// In gas_config.js
CONFIG.VALIDATION_MIN_SCORE = 0.5;  // Was 0.6 (lowered)
```

**Permanent:**
1. Analyze common errors in logs
2. If errors on:
   - **Length** → Responses too short? Enrich KB
   - **Language** → Mixed IT/EN emails? Improve detection
   - **Signature** → Check signature pattern in ResponseValidator
   - **Hallucinations** → Missing data in KB

---

### 5. Responses in Wrong Language

**Symptom:**
- Email in Italian → Answer in English
- Multilingual email → Random language

**Diagnosis:**

```javascript
function testLanguageDetection() {
  const classifier = new Classifier();
  
  const tests = [
    { text: 'Buongiorno, vorrei informazioni', expected: 'it' },
    { text: 'Hello, I would like information', expected: 'en' },
    { text: 'Hola, me gustaría información', expected: 'es' }
  ];
  
  tests.forEach(test => {
    const detected = classifier.detectEmailLanguage(test.text, '');
    const match = detected.lang === test.expected ? '✓' : '❌';
    console.log(`${match} "${test.text.substring(0, 30)}..." → ${detected.lang} (expected: ${test.expected})`);
  });
}
```

**Solutions:**

1. **Truly mixed email (e.g., "Grazie / Thank you"):**
   - System chooses prevalent language
   - It is correct behavior
   - User should write in a single language

2. **Wrong detection:**
   ```javascript
   // In gas_classifier.js, increase language marker weight
   // Or in gas_gemini_service.js:
   
   _resolveLanguage(geminiLang, localLang, localSafetyGrade) {
     // Always trust Gemini for exotic languages
     const supportedLangs = ['it', 'en', 'es'];
     if (!supportedLangs.includes(geminiLang)) {
       return geminiLang;  // ← Gemini priority
     }
     // ...
   }
   ```

---

### 6. System Responds to Newsletter/Spam

**Symptom:**
- Emails from "noreply@..." processed
- Newsletters receive auto-response

**Diagnosis:**

```javascript
function testSpamFilter() {
  const classifier = new Classifier();
  
  const spamTests = [
    'noreply@marketing.com',
    'newsletter@service.com',
    'do-not-reply@auto.com'
  ];
  
  spamTests.forEach(email => {
    const shouldIgnore = classifier._shouldIgnoreEmail({
      senderEmail: email,
      subject: 'Test',
      body: 'Test message'
    });
    
    const status = shouldIgnore ? '✓ FILTERED' : '❌ PASSES';
    console.log(`${status}: ${email}`);
  });
}
```

**Solutions:**

```javascript
// In gas_config.js, add domains to blacklist:

CONFIG.IGNORE_DOMAINS = [
  'noreply', 'no-reply', 'newsletter', 'marketing',
  'promo', 'ads', 'notifications',
  // Add specific domains you see passing:
  'mailchimp', 'sendgrid', 'constantcontact'
];

// Add keywords:
CONFIG.IGNORE_KEYWORDS = [
  'unsubscribe', 'opt-out', 'newsletter',
  'marketing', 'promotional'
];
```

---

### 7. Hallucinations (Invented Data)

**Symptom:**
- System invents times not in KB
- Provides non-existent email/phones

**Example:**
```
User Email: "What time is mass?"
AI Answer: "Mass is at 17:30"  ← INVENTED (KB says 18:00)
```

**Diagnosis:**

```javascript
function checkHallucinations(response, knowledgeBase) {
  const validator = new ResponseValidator();
  
  // Manual test
  const validation = validator.validateResponse(
    response,
    'it',
    knowledgeBase,
    '',  // emailBody
    '',  // emailSubject
    'full'  // salutationMode
  );
  
  if (validation.details.hallucinations) {
    console.error('❌ HALLUCINATIONS DETECTED:');
    console.log(validation.details.hallucinations);
  } else {
    console.log('✓ No hallucinations');
  }
}
```

**Solutions:**

1. **Enrich Knowledge Base:**
   - If time is not in KB, add it
   - Be specific: "Winter Weekday Mass: 18:00" (not just "18:00")

2. **Verify validation works:**
   ```javascript
   // In gas_response_validator.js, search:
   _checkHallucinations(response, knowledgeBase) {
     // Must extract times from response
     // and compare with KB
   }
   ```

3. **Increase validation severity:**
   ```javascript
   CONFIG.VALIDATION_STRICT_MODE = true;  // Blocks even doubts
   ```

---

### 8. Memory Not Working

**Symptom:**
- System repeats info already provided
- Does not remember previous conversations

**Diagnosis:**

```javascript
function testMemory() {
  const memory = new MemoryService();
  
  if (!memory.isHealthy()) {
    console.error('❌ MemoryService NOT initialized');
    return;
  }
  
  // Create test
  const testThreadId = 'test_' + Date.now();
  
  memory.updateMemoryAtomic(testThreadId, {
    language: 'it',
    category: 'test'
  }, ['mass_times']);
  
  // Retrieve
  const retrieved = memory.getMemory(testThreadId);
  
  if (retrieved.language === 'it') {
    console.log('✓ Memory works');
    console.log('Data:', retrieved);
  } else {
    console.error('❌ Memory DOES NOT work');
  }
}
```

**Solutions:**

1. **Verify Memory sheet exists:**
   - Must exist "ConversationMemory" sheet
   - With columns: threadId, language, category, tone, providedInfo, lastUpdated, messageCount, version

2. **Verify permissions:**
   - Script must have access to sheet

3. **Force cache cleanup:**
   ```javascript
   const memory = new MemoryService();
   memory.clearCache();
   ```

---

## 🐛 Specific Parish Problems

### 9. Inappropriate Tone for Pastoral Situations

**Symptom:**
- Cold response to request for spiritual support
- Bureaucratic tone for bereavement/illness

**Example:**
```
Email: "My father died yesterday, I would like info on the funeral"
AI Answer: "For funerals these documents are needed: ..." ← COLD
```

**Solution:**

Enrich **AI_CORE** sheet:

```
| Principle | Instruction |
|-----------|-----------|
| Bereavement | For bereavements: express closeness immediately ("We are close to you in this moment"), THEN provide practical info |
| Serious illness | Respond with empathy, offer spiritual support (chaplain, priest visit) |
| Delicate situations | DO NOT give just technical info, show humanity |
```

And in **Instructions** sheet, add:

```
| Category | Information | Details |
|-----------|--------------|----------|
| Funerals | What to do | In case of bereavement, call office IMMEDIATELY 06-XXX. We are available for support |
| Chaplain | Contact | Fr. Marco 333-XXX for visits to sick |
```

---

### 10. Does Not Recognize Territory Addresses

**Symptom:**
- "I live at Via Roma 10" → System does not verify
- Generic response without territory confirmation

**Diagnosis:**

```javascript
function testTerritoryValidation() {
  const validator = new TerritoryValidator();
  
  const tests = [
    'I live at Via Flaminia 150',
    'I am from Piazza Marina 30',
    'Invented street 999'
  ];
  
  tests.forEach(text => {
    const result = validator.analyzeEmailForAddress(text, '');
    console.log(`\n📍 "${text}"`);
    if (result.addressFound) {
      console.log(`  Address: ${result.street} ${result.civic}`);
      console.log(`  Territory: ${result.verification.inParish ? 'YES' : 'NO'}`);
    } else {
      console.log('  ❌ Address not extracted');
    }
  });
}
```

**Solutions:**

1. **Add missing street:**
   ```javascript
   // In gas_territory_validator.js
   this.territory = {
     'via roma': { tutti: true },  // ← ADD
     'via flaminia': { dispari: [109, 217] },
     // ...
   };
   ```

2. **Verify address format:**
   - System searches: "via [name] [number]"
   - Add aliases if necessary

---

### 11. System Does Not Handle Holidays

**Symptom:**
- Responds during Christmas/Easter when it should suspend
- Weekday mass times provided on holiday

**Solution:**

Verify in **gas_main.js**:

```javascript
// Fixed holidays must be present
const ALWAYS_OPERATING_DAYS = [
  [MONTH.DEC, 25],  // Christmas
  [MONTH.DEC, 26],  // St Stephen
  [MONTH.JAN, 1],   // New Year
  [MONTH.JAN, 6],   // Epiphany
  // ... ADD MISSING
];
```

For **special mass times** on weekday holidays:

```javascript
// In gas_main.js, in getSpecialMassTimeRule()
const fixedSpecialDays = [
  [4, 25],   // April 25
  [5, 1],    // May 1
  [12, 26]   // December 26
];
```

---

## 🔍 Diagnostic Tools

### Full Dashboard

```javascript
function fullDiagnostic() {
  console.log('═══════════════════════════════════════════');
  console.log('🔍 FULL SYSTEM DIAGNOSTIC');
  console.log('═══════════════════════════════════════════\n');
  
  // 1. Configuration
  console.log('📋 CONFIGURATION:');
  console.log(`  API Key: ${CONFIG.GEMINI_API_KEY ? '✓ Present' : '❌ Missing'}`);
  console.log(`  Spreadsheet ID: ${CONFIG.SPREADSHEET_ID ? '✓ Present' : '❌ Missing'}`);
  console.log(`  Validation: ${CONFIG.VALIDATION_ENABLED ? '✓ Enabled' : '⚠️ Disabled'}`);
  console.log(`  DRY RUN: ${CONFIG.DRY_RUN ? '⚠️ ACTIVE (email not sent)' : '✓ Inactive'}`);
  
  // 2. Triggers
  console.log('\n🔄 TRIGGERS:');
  const triggers = ScriptApp.getProjectTriggers();
  console.log(`  Total triggers: ${triggers.length}`);
  triggers.forEach(t => {
    console.log(`    - ${t.getHandlerFunction()} (${t.getEventType()})`);
  });
  
  // 3. Health Check
  console.log('\n🏥 HEALTH CHECK:');
  const health = healthCheck();
  console.log(`  Status: ${health.status}`);
  for (const [component, status] of Object.entries(health.components)) {
    const icon = status.status === 'OK' ? '✓' : '❌';
    console.log(`    ${icon} ${component}`);
  }
  
  // 4. Rate Limits
  console.log('\n📊 RATE LIMITS:');
  if (CONFIG.USE_RATE_LIMITER) {
    const limiter = new GeminiRateLimiter();
    const stats = limiter.getUsageStats();
    console.log(`  Date: ${stats.date}`);
    for (const [model, data] of Object.entries(stats.models)) {
      console.log(`  ${model}: RPD ${data.rpd.used}/${data.rpd.limit} (${data.rpd.percent}%)`);
    }
  } else {
    console.log('  ⚠️ Rate Limiter DISABLED');
  }
  
  // 5. Recent Emails
  console.log('\n📬 EMAILS (last 24h):');
  const labels = ['IA', 'Verifica', 'Errore'];
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  labels.forEach(labelName => {
    const label = GmailApp.getUserLabelByName(labelName);
    if (label) {
      const threads = label.getThreads().filter(t => 
        t.getLastMessageDate() >= yesterday
      );
      console.log(`  ${labelName}: ${threads.length}`);
    }
  });
  
  console.log('\n═══════════════════════════════════════════');
}
```

### Specific Email Test

```javascript
function testSpecificEmail(subject, body) {
  console.log('🧪 SPECIFIC EMAIL TEST\n');
  console.log(`Subject: ${subject}`);
  console.log(`Body: ${body.substring(0, 100)}...\n`);
  
  // 1. Classification
  const classifier = new Classifier();
  const classification = classifier.classifyEmail(subject, body);
  console.log('📊 Classification:');
  console.log(`  Reply: ${classification.shouldReply}`);
  console.log(`  Category: ${classification.category}`);
  console.log(`  Confidence: ${classification.confidence}\n`);
  
  // 2. Language
  const gemini = new GeminiService();
  const detection = gemini.detectEmailLanguage(body, subject);
  console.log('🌍 Language:');
  console.log(`  Detected: ${detection.lang}`);
  console.log(`  Confidence: ${detection.confidence}\n`);
  
  // 3. Request Type
  const rtc = new RequestTypeClassifier();
  const requestType = rtc.classify(subject, body);
  console.log('🎯 Request Type:');
  console.log(`  Type: ${requestType.type}`);
  console.log(`  Needs Discernment: ${requestType.needsDiscernment}`);
  console.log(`  Needs Doctrine: ${requestType.needsDoctrine}\n`);
}

// Example usage:
testSpecificEmail(
  'Mass times',
  'Good morning, I would like to know Sunday mass times. Thanks'
);
```

---

## 🐛 Known Issues

### Issue #1: Race Condition on Long Threads ✅ FIXED v2.3.9

**Symptom:** Same thread answered 2 times  
**Cause:** Lock not acquired correctly  
**Fix:** Implemented double-check locking in `gas_email_processor.js` function `_processThread`  
**Temporary Workaround:** Increase `CACHE_LOCK_TTL` to 60s

---

### Issue #2: Gemini 2.5 Thinking Leak ⚠️ MITIGATED v2.4.0

**Symptom:** Responses contain "Reviewing the KB...", "Verifying the information..."  
**Cause:** Gemini 2.5 exposes reasoning if prompt is ambiguous  
**Fix:** Validator detects and blocks (score=0.0) in `gas_response_validator.js`  
**Workaround:** More specific prompts with "DO NOT expose reasoning"

```javascript
// Detected and blocked patterns:
const thinkingPatterns = [
  'reviewing the knowledge base',
  'verifying the information',
  'I need to correct',
  'note:',
  'the 2025 dates have passed'
];
```

---

### Issue #3: PropertiesService 9KB Limit 🏗️ ARCHITECTURAL

**Symptom:** Error "Property too large" in Rate Limiter  
**Cause:** Google limits single property to 9KB  
**Fix:** Automatic cache trimming to 100 entries in `gas_rate_limiter.js`  
**No Workaround:** Hard Google limit, handled internally

```javascript
// Safety cap implemented:
if (window.length > 100) {
  window = window.slice(-100);
}
```

---

### Issue #4: Sheet API Timeout on Large KB 📋 KNOWN

**Symptom:** Timeout loading KB >1000 rows  
**Cause:** Google Sheets API has timeout on massive reads  
**Planned Fix:** KB loading pagination (v2.5.0)  
**Current Workaround:** 
- Reduce KB to <800 rows
- Use more aggressive cache: `CONFIG.KB_CACHE_TTL = 7200000` (2 hours)
- Prefer `lite` profile for simple emails

---

## 📞 When to Contact Support

**Contact support IF:**
- ✅ You followed all solutions in this guide
- ✅ You ran `fullDiagnostic()` and collected logs
- ✅ Problem persists for >24 hours
- ✅ Impacts >50% of emails

**DO NOT contact support for:**
- ❌ Problems solved in this guide
- ❌ Initial configuration (use SETUP_GUIDE)
- ❌ Questions on how it works (use documentation)

**Information to provide:**
1. Detailed problem description
2. Output of `fullDiagnostic()`
3. Logs of last 3 errors from "Executions"
4. Examples of problematic emails (anonymized)

**Contacts:**
- 📧 info@parrocchiasanteugenio.it

---

**[Versione Italiana](TROUBLESHOOTING_IT.md)** | **[Quick Decision Tree](QUICK_DECISION_TREE.md)** | **[Runbooks](runbooks/)**
