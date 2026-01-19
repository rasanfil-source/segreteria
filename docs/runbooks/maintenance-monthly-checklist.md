# 📅 Monthly Maintenance Checklist

> **Maintenance activities to perform every month to ensure proper system operation**

---

## 📋 Procedure Information

| Field | Value |
|-------|-------|
| **Frequency** | Monthly (first Monday of the month) |
| **Estimated Duration** | 30-60 minutes |
| **Responsible** | System Administrator |
| **Prerequisites** | Access to GAS Editor, Gmail, Spreadsheet |

---

## 📊 Section 1: Statistics Analysis

### 1.1 Monthly Report

```javascript
function monthlyReport() {
  const now = new Date();
  const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
  
  console.log('═══════════════════════════════════');
  console.log('📊 MONTHLY REPORT');
  console.log(`Period: ${oneMonthAgo.toLocaleDateString()} - ${now.toLocaleDateString()}`);
  console.log('═══════════════════════════════════');
  
  const labels = ['IA', 'Verifica', 'Errore', 'Skipped'];
  const stats = {};
  
  labels.forEach(labelName => {
    const label = GmailApp.getUserLabelByName(labelName);
    if (label) {
      stats[labelName] = label.getThreads()
        .filter(t => t.getLastMessageDate() >= oneMonthAgo).length;
    } else {
      stats[labelName] = 0;
    }
  });
  
  const total = stats['IA'] + stats['Verifica'] + stats['Errore'];
  const automationRate = total > 0 ? (stats['IA'] / total * 100).toFixed(1) : 0;
  
  console.log(`\nTotal Emails Processed: ${total}`);
  console.log(`  ✅ Automated (IA): ${stats['IA']} (${automationRate}%)`);
  console.log(`  ⚠️ Verifica: ${stats['Verifica']}`);
  console.log(`  ❌ Error: ${stats['Errore']}`);
  console.log(`  🚫 Skipped: ${stats['Skipped']}`);
  
  // Benchmark
  if (automationRate >= 80) console.log('\n🏆 EXCELLENT: Automation rate > 80%');
  else if (automationRate >= 70) console.log('\n✓ GOOD: Automation rate > 70%');
  else console.log('\n⚠️ ATTENTION: Automation rate < 70%');
}
```

**Checklist:**
- [ ] Executed `monthlyReport()`
- [ ] Automation rate > 70%
- [ ] Error rate < 5%
- [ ] Noted trend vs previous month

### 1.2 API Quota Analysis

```javascript
function analyzeMonthlyQuota() {
  console.log('\n📈 QUOTA USAGE ANALYSIS');
  
  if (typeof GeminiRateLimiter !== 'undefined') {
    const limiter = new GeminiRateLimiter();
    limiter.logUsageStats();
  }
  
  // Check for days with exhausted quota
  console.log('Check logs for 429 errors in the month');
}
```

**Checklist:**
- [ ] No days with exhausted quota
- [ ] Average usage < 60% daily quota
- [ ] Safety Valve activated < 5 times

---

## 🧹 Section 2: Cleanup and Maintenance

### 2.1 Conversation Memory Cleanup

```javascript
function cleanupOldMemory() {
  const memory = new MemoryService();
  const result = memory.cleanupOldEntries(90); // Removes > 90 days
  
  console.log(`Memory: ${result.removed} entries removed, ${result.remaining} kept`);
}
```

**Checklist:**
- [ ] Executed `cleanupOldMemory()`
- [ ] Verified automatic cleanup trigger is active
- [ ] Sheet "ConversationMemory" < 5000 rows

### 2.2 Verify Spreadsheet Integrity

```javascript
function verifySpreadsheetIntegrity() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  
  const requiredSheets = [
    'Istruzioni',
    'AI_CORE_LITE', 
    'AI_CORE',
    'Dottrina',
    'ConversationMemory'
  ];
  
  console.log('\n🔍 VERIFY SHEETS');
  requiredSheets.forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (sheet) {
      const rows = sheet.getLastRow();
      console.log(`✓ ${name}: ${rows} rows`);
    } else {
      console.error(`❌ ${name}: MISSING`);
    }
  });
}
```

**Checklist:**
- [ ] All required sheets present
- [ ] No empty or corrupted rows
- [ ] Sheet backup performed (manual copy)

### 2.3 Gmail Label Cleanup

**Manual Actions:**
- [ ] Archive emails > 6 months with "IA" label
- [ ] Delete resolved emails from "Verifica"
- [ ] Check emails in "Errore" and reprocess if necessary

---

## 🔧 Section 3: Updates

### 3.1 Verify Knowledge Base

**Checklist:**
- [ ] Mass times updated (summer/winter?)
- [ ] Secretariat contacts correct
- [ ] Current year event dates present
- [ ] Sacrament information updated
- [ ] Removed references to past events

### 3.2 Verify Configuration

```javascript
function reviewConfiguration() {
  console.log('\n⚙️ CURRENT CONFIGURATION');
  console.log(`MAX_EMAILS_PER_RUN: ${CONFIG.MAX_EMAILS_PER_RUN}`);
  console.log(`VALIDATION_MIN_SCORE: ${CONFIG.VALIDATION_MIN_SCORE}`);
  console.log(`DRY_RUN: ${CONFIG.DRY_RUN}`);
  console.log(`USE_RATE_LIMITER: ${CONFIG.USE_RATE_LIMITER}`);
  
  // Warning if non-optimal configuration
  if (CONFIG.DRY_RUN) {
    console.warn('⚠️ DRY_RUN active - emails NOT sent!');
  }
}
```

**Checklist:**
- [ ] `DRY_RUN = false` in production
- [ ] `USE_RATE_LIMITER = true`
- [ ] Appropriate validation thresholds

### 3.3 Verify Triggers

**Checklist:**
- [ ] `main` trigger active (every 10 min)
- [ ] `cleanupOldMemory` trigger active (weekly)
- [ ] `dailyHealthCheck` trigger active (every morning)

---

## 🔐 Section 4: Security

### 4.1 API Key Rotation (Quarterly)

**If 3 months have passed since last rotation:**
- [ ] Generate new API Key on [AI Studio](https://aistudio.google.com/apikey)
- [ ] Update in Script Properties
- [ ] Disable old key
- [ ] Test connection with `testGeminiConnection()`

### 4.2 Verify Access

**Checklist:**
- [ ] Only authorized accounts have script access
- [ ] Only authorized accounts have Spreadsheet access
- [ ] No unrecognized new editors

### 4.3 Log Review

**Check in Apps Script → Executions:**
- [ ] No unhandled critical errors
- [ ] No attack patterns (anomalous requests)
- [ ] No unauthorized access

---

## 📝 Section 5: Documentation

**Checklist:**
- [ ] Updated CHANGELOG if changes during the month
- [ ] Documented significant incidents
- [ ] Updated KB with new recurring FAQs
- [ ] Notes for next month annotated

---

## 📊 Final Report

At the end of maintenance, complete:

```
═══════════════════════════════════════════════
📋 MONTHLY MAINTENANCE REPORT
Date: _____________
Performed by: _____________
═══════════════════════════════════════════════

📊 MONTH STATISTICS
- Emails processed: ____
- Automation rate: ____%
- Errors: ____

🧹 CLEANUP
- Memory entries removed: ____
- Emails archived: ____

🔧 UPDATES
- KB updated: ☐ Yes ☐ No
- Config modified: ☐ Yes ☐ No

🔐 SECURITY
- API Key rotated: ☐ Yes ☐ No ☐ Not needed
- Access verified: ☐ Yes

📝 NOTES
_______________________________________
_______________________________________

⏰ NEXT MAINTENANCE: _____________
═══════════════════════════════════════════════
```

---

## 📅 Annual Maintenance Calendar

| Month | Extra Activities |
|-------|------------------|
| January | Complete annual review |
| April | API Key Rotation Q1 |
| July | API Key Rotation Q2 + Summer schedule update |
| October | API Key Rotation Q3 + Winter schedule update |

---

**[Back to Runbooks](./README.md)** | **[Deployment Guide](../DEPLOYMENT.md)**
