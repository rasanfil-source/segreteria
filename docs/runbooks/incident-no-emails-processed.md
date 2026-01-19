# 🚨 Runbook: No Emails Processed

> **Emergency procedure when the system is not processing emails**

---

## 📋 Incident Information

| Field | Value |
|-------|-------|
| **Severity** | 🔴 CRITICAL |
| **Target Resolution Time** | < 30 minutes |
| **Impact** | Total - no automated emails |
| **Escalation** | After 1 hour without resolution |

---

## 🔍 Quick Diagnosis

### Step 1: Verify Trigger (2 min)

```javascript
function checkTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  const mainTrigger = triggers.find(t => t.getHandlerFunction() === 'main');
  
  if (!mainTrigger) {
    console.error('❌ TRIGGER MISSING');
    return false;
  }
  
  console.log('✓ Trigger present');
  console.log('Interval:', mainTrigger.getTriggerSource());
  return true;
}
```

**Action:**
1. Open [Apps Script](https://script.google.com)
2. Menu: ⏰ Triggers
3. Verify "main" trigger presence

### Step 2: Verify API Key (2 min)

```javascript
function checkApiKey() {
  const apiKey = PropertiesService.getScriptProperties()
    .getProperty('GEMINI_API_KEY');
  
  if (!apiKey) {
    console.error('❌ API KEY MISSING');
    return false;
  }
  
  console.log('✓ API Key present:', apiKey.substring(0, 10) + '...');
  return true;
}
```

### Step 3: Verify Spreadsheet (2 min)

```javascript
function checkSpreadsheet() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    console.log('✓ Spreadsheet accessible:', ss.getName());
    return true;
  } catch (e) {
    console.error('❌ SPREADSHEET NOT ACCESSIBLE:', e.message);
    return false;
  }
}
```

### Step 4: Verify Hours (1 min)

```javascript
function checkSuspension() {
  if (typeof isInSuspensionTime === 'function' && isInSuspensionTime()) {
    console.warn('⚠️ SYSTEM IN SUSPENSION (office hours)');
    return false;
  }
  console.log('✓ Not in suspension');
  return true;
}
```

---

## 🔧 Resolution by Cause

### Cause A: Missing Trigger

**Fix:**
```javascript
function fixTrigger() {
  // Remove existing triggers
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'main') {
      ScriptApp.deleteTrigger(t);
    }
  });
  
  // Recreate trigger
  ScriptApp.newTrigger('main')
    .timeBased()
    .everyMinutes(10)
    .create();
  
  console.log('✓ Trigger recreated');
}
```

### Cause B: Expired Authorizations

**Fix:**
1. Manually run `main()` from the editor
2. Accept the requested permissions
3. Verify correct execution

### Cause C: Missing API Key

**Fix:**
1. Go to [AI Studio](https://aistudio.google.com/apikey)
2. Generate new API key
3. In Apps Script: ⚙️ Project Settings → Script Properties
4. Add property `GEMINI_API_KEY` with the new key

### Cause D: Spreadsheet Not Accessible

**Fix:**
1. Verify correct ID in `gas_config.js`
2. Open the spreadsheet and verify sharing
3. Script must have "Editor" access

### Cause E: DRY_RUN Active

**Fix:**
```javascript
// In gas_config.js:
CONFIG.DRY_RUN = false;  // Was true
```

---

## ✅ Verify Resolution

```javascript
function verifyResolution() {
  console.log('═══════════════════════════════════');
  console.log('🔍 VERIFY RESOLUTION');
  console.log('═══════════════════════════════════');
  
  // Run main manually
  main();
  
  // Check recent emails
  const label = GmailApp.getUserLabelByName('IA');
  if (label) {
    const recent = label.getThreads(0, 5);
    console.log(`Emails processed today: ${recent.length}`);
  }
  
  console.log('✓ System operational');
}
```

---

## 📊 Post-Incident Monitoring

- [ ] Verify email processing in next 30 minutes
- [ ] Check that no emails were lost
- [ ] Document root cause in incident log
- [ ] Update runbook if necessary

---

## 📞 Escalation

If after 1 hour the problem persists:

1. **Contact technical support:** support@exnovobots.com
2. **Attach:**
   - Output of `emergencyDiagnostic()`
   - Last 5 error logs from Executions
   - Screenshot of trigger configuration

---

**[Back to Runbooks](./README.md)** | **[Complete Troubleshooting](../TROUBLESHOOTING.md)**
