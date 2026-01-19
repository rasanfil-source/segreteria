# 🚨 Runbook: All Emails in "Verifica"

> **Procedure when over 30% of emails end up in the "Verifica" label**

---

## 📋 Incident Information

| Field | Value |
|-------|-------|
| **Severity** | 🟡 MEDIUM |
| **Target Resolution Time** | < 1 hour |
| **Impact** | Partial - emails require manual review |
| **Escalation** | If >50% emails in Verifica for >24h |

---

## 🔍 Quick Diagnosis

### Step 1: Calculate Percentage (5 min)

```javascript
function calculateVerificaRate() {
  const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const labels = {
    'IA': 0,
    'Verifica': 0,
    'Errore': 0
  };
  
  for (const labelName of Object.keys(labels)) {
    const label = GmailApp.getUserLabelByName(labelName);
    if (label) {
      labels[labelName] = label.getThreads()
        .filter(t => t.getLastMessageDate() >= last24h).length;
    }
  }
  
  const total = Object.values(labels).reduce((a, b) => a + b, 0);
  const verificaRate = (labels['Verifica'] / total * 100).toFixed(1);
  
  console.log('═══════════════════════════════════');
  console.log('📊 LAST 24H STATISTICS');
  console.log('═══════════════════════════════════');
  console.log(`Automated emails (IA): ${labels['IA']}`);
  console.log(`Emails in Verifica: ${labels['Verifica']} (${verificaRate}%)`);
  console.log(`Emails with Error: ${labels['Errore']}`);
  console.log(`Total: ${total}`);
  
  if (verificaRate > 30) {
    console.warn('⚠️ HIGH VERIFICA RATE');
  }
}
```

### Step 2: Identify Error Patterns (10 min)

Check logs in **Apps Script → Executions** for common patterns:

| Log Pattern | Probable Cause |
|-------------|----------------|
| "Insufficient length" | KB too sparse |
| "Language mismatch" | Detection failed |
| "Missing signature" | Wrong signature pattern |
| "Forbidden content detected" | Prohibited phrases |
| "Hallucination detected" | Data not in KB |
| "Thinking leak" | Gemini 2.5 bug |

### Step 3: Detailed Analysis

```javascript
function analyzeVerificaEmails() {
  const verifyLabel = GmailApp.getUserLabelByName('Verifica');
  if (!verifyLabel) return;
  
  const threads = verifyLabel.getThreads(0, 10);
  
  console.log('═══════════════════════════════════');
  console.log('🔍 ANALYSIS OF LAST 10 VERIFICA EMAILS');
  console.log('═══════════════════════════════════');
  
  threads.forEach((thread, i) => {
    const msg = thread.getMessages()[0];
    console.log(`\n${i+1}. ${thread.getFirstMessageSubject()}`);
    console.log(`   From: ${msg.getFrom()}`);
    console.log(`   Check execution log for validation details`);
  });
}
```

---

## 🔧 Resolution by Cause

### Cause A: Threshold Too High

**Immediate Fix:**
```javascript
// In gas_config.js:
CONFIG.VALIDATION_MIN_SCORE = 0.5;  // Was 0.6
```

**Note:** This reduces sensitivity but increases risk of imprecise responses.

### Cause B: Responses Too Short

**Fix:**
1. Enrich Knowledge Base with more details
2. Add examples of complete responses

```javascript
// Verify average length
function checkAverageResponseLength() {
  // Check logs for generated response lengths
  // Target: 150-500 characters for simple response
}
```

### Cause C: Language Detection Failed

**Fix:**
```javascript
// If multilingual email, system uses prevalence
// Improve prompt in PromptEngine:

// In gas_prompt_engine.js, LanguageInstruction section
// Add reinforcement:
"If the email contains words in multiple languages, ALWAYS respond
in the language of the MAIN question, not the greetings."
```

### Cause D: Signature Not Recognized

**Fix:**
```javascript
// In gas_response_validator.js, add patterns:
const signaturePatterns = [
  /segreteria\s+parrocchia/i,
  /parish\s+secretariat/i,
  /cordiali\s+saluti/i,
  // ADD NEW PATTERNS:
  /kind\s+regards/i,
  /best\s+regards/i,
  /sincerely/i
];
```

### Cause E: Frequent Hallucinations

**Fix:**
1. Identify which data is being invented
2. Add this data to the Knowledge Base
3. For times/phones, verify format in KB

```javascript
// Verify KB contains all essential data:
// - Mass times (all types)
// - Contacts (email, phone)
// - Complete addresses
// - Recurring event dates
```

### Cause F: Thinking Leak (Gemini 2.5)

**Fix:**
```javascript
// Already mitigated in validator, but if persists:

// 1. Add to prompt in PromptEngine:
"NEVER expose your reasoning process.
NEVER start responses with 'Reviewing...', 'Checking...', etc."

// 2. Consider fallback to previous model:
CONFIG.MODEL_STRATEGY = {
  'generation': ['flash-lite', 'flash-2.0']  // Avoid 2.5
};
```

---

## ✅ Verify Resolution

```javascript
function verifyVerificaResolved() {
  // Wait 1-2 hours after the fix
  
  calculateVerificaRate();
  
  // Target:
  // - Verifica rate < 20% = Excellent
  // - Verifica rate 20-30% = Acceptable
  // - Verifica rate > 30% = Persistent problem
}
```

---

## 🔄 Process Emails in Verifica

For emails already in "Verifica":

1. **Open email in Gmail**
2. **Check draft response** (if present)
3. **Decide:**
   - ✅ Response OK → Send manually + remove "Verifica" label
   - ✏️ Response needs editing → Edit and send
   - ❌ Wrong response → Rewrite completely

---

## 🛡️ Prevention

1. **Daily monitoring** of Verifica rate
2. **Weekly review** of Verifica emails for patterns
3. **Continuous enrichment** of Knowledge Base
4. **A/B testing** of validation thresholds

---

## 📞 Escalation

If problem persists after all fixes:

1. Document most frequent error patterns
2. Export 5 example problematic emails (anonymized)
3. Contact support@exnovobots.com

---

**[Back to Runbooks](./README.md)** | **[Complete Troubleshooting](../TROUBLESHOOTING.md)**
