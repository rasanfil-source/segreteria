# 🚨 Runbook: API Quota Exceeded

> Local configuration, not a guarantee of provider quotas or availability. See the [current audit](../RELIABILITY_AUDIT_2026-09-22.md) for limitations, migrations and uncertain-send handling.

> **Procedure when receiving error 429 "Quota Exceeded"**

---

## 📋 Incident Information

| Field | Value |
|-------|-------|
| **Severity** | 🟠 HIGH |
| **Target Resolution Time** | Immediate (workaround) / Reset at 00:00 America/Los_Angeles |
| **Impact** | Partial - unprocessed emails |
| **Escalation** | If problem persists after quota reset |

---

## 🔍 Quick Diagnosis

### Step 1: Verify Quota Status (2 min)

```javascript
function checkQuotaStatus() {
  if (typeof GeminiRateLimiter !== 'undefined') {
    const limiter = new GeminiRateLimiter();
    limiter.logUsageStats();
  }
  
  // Check for recent errors
  console.log('Check "Executions" for 429 errors');
}
```

### Step 2: Identify Exhausted Model

| Model | RPD Limit | Reset |
|-------|-----------|-------|
| Gemini 3.5 Flash-Lite | 1,000/day (local) | 00:00 America/Los_Angeles |
| Google Search Grounding | Disabled by default; check AI Studio if enabled | 00:00 America/Los_Angeles |
| Context cache create | Disabled by default in Free Tier; counts as API request if enabled | 00:00 America/Los_Angeles |

---

## 🔧 Immediate Workaround

### Option A: Use Minimal Quality + Lite Fallback Chain

```javascript
// In gas_config.js, temporarily modify:
CONFIG.MODEL_STRATEGY = {
  'quick_check': ['flash-lite'],
  'generation': ['flash-3.7', 'flash-lite']  // Quality first, conservative fallback
};
```

### Option B: Reduce Load

```javascript
// In gas_config.js:
CONFIG.MAX_EMAILS_PER_RUN = 2;  // Conservative operational default
// Use 1 for severe mitigation, 0 to temporarily suspend
```

### Option C: Temporarily Suspend

```javascript
// In gas_config.js:
CONFIG.MAX_EMAILS_PER_RUN = 0;  // Suspends processing

// Or
CONFIG.DRY_RUN = true;  // Simulates without API calls
```

---

## ⏰ Quota Reset

**Quota resets at 00:00 America/Los_Angeles** (midnight Pacific Time).

### Calculate Remaining Time

```javascript
function timeToQuotaReset() {
  const now = new Date();
  const italy = new Date(now.toLocaleString('en-US', {timeZone: 'Europe/Rome'}));
  
  let reset = new Date(italy);
  reset.setHours(9, 0, 0, 0);
  
  if (italy.getHours() >= 9) {
    reset.setDate(reset.getDate() + 1);
  }
  
  const diff = reset - italy;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  
  console.log(`Time to reset: ${hours}h ${minutes}m`);
}
```

---

## 🔄 Post-Reset: Restore Configuration

```javascript
// After 00:00 America/Los_Angeles, restore normal configuration:

CONFIG.MODEL_STRATEGY = {
  'quick_check': ['flash-lite'],
  'generation': ['flash-3.7', 'flash-3.7-backup', 'flash-lite', 'flash-lite-backup'],
  'fallback': ['flash-lite', 'flash-lite-backup']
};

CONFIG.MAX_EMAILS_PER_RUN = 2;
CONFIG.DRY_RUN = false;
```

---

## 🛡️ Prevention

### 1. Enable Safety Valve

```javascript
// In gas_config.js - already active by default
CONFIG.SAFETY_VALVE_THRESHOLD = 0.8;  // Activates at 80%
```

### 2. Monitor Daily Usage

```javascript
// Add to dailyHealthCheck()
function checkDailyUsage() {
  const limiter = new GeminiRateLimiter();
  const stats = limiter.getUsageStats();
  
  for (const [model, data] of Object.entries(stats.models)) {
    if (data.rpd.percent > 70) {
      console.warn(`⚠️ ${model}: ${data.rpd.percent}% quota used`);
    }
  }
}
```

### 3. Consider Plan Upgrade

If quota is frequently exhausted, consider:
- Upgrading to Google Workspace (more quota)
- Paid API plan
- Prompt optimization (fewer tokens)

---

## 📊 Metrics to Monitor

| Metric | Warning Threshold | Critical Threshold |
|--------|-------------------|-------------------|
| RPD Gemini 3.5 Flash-Lite | > 80% of effective project quota | > 95% of effective project quota |
| Google Search Grounding | Monitor only if enabled in AI Studio | Monitor only if enabled in AI Studio |
| Avg tokens/response | > 20,000 | > 80,000 |
| Emails/hour | > 15 | > 25 |

---

## ✅ Verify Resolution

```javascript
function verifyQuotaResolved() {
  const gemini = new GeminiService();
  
  try {
    // Test simple call
    const result = gemini.testConnection();
    
    if (result.connectionOk) {
      console.log('✓ Gemini API operational');
      return true;
    }
  } catch (e) {
    if (e.message.includes('429')) {
      console.error('❌ Quota still exhausted');
      return false;
    }
    throw e;
  }
}
```

---

## 📞 Escalation

If after quota reset (00:00 America/Los_Angeles) the problem persists:

1. Verify API credentials on [Google Cloud Console](https://console.cloud.google.com)
2. Check for any API key restrictions
3. Contact info@parrocchiasanteugenio.it with quota screenshot

---

**[Back to Runbooks](./README.md)** | **[Complete Troubleshooting](../TROUBLESHOOTING.md)**
