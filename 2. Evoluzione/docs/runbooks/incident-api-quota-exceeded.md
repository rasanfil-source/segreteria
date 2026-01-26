# 🚨 Runbook: API Quota Exceeded

> **Procedure when receiving error 429 "Quota Exceeded"**

---

## 📋 Incident Information

| Field | Value |
|-------|-------|
| **Severity** | 🟠 HIGH |
| **Target Resolution Time** | Immediate (workaround) / Reset at 9:00 AM |
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
| Flash 2.5 | 250/day | 9:00 AM IT |
| Flash Lite | 1000/day | 9:00 AM IT |
| Flash 2.0 | 100/day | 9:00 AM IT |

---

## 🔧 Immediate Workaround

### Option A: Use Only Economical Model

```javascript
// In gas_config.js, temporarily modify:
CONFIG.MODEL_STRATEGY = {
  'quick_check': ['flash-lite'],
  'generation': ['flash-lite']  // Avoid flash-2.5
};
```

### Option B: Reduce Load

```javascript
// In gas_config.js:
CONFIG.MAX_EMAILS_PER_RUN = 3;  // Was 10
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

**Quota resets at 9:00 AM Italian time** (midnight Pacific Time).

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
// After 9:00 AM, restore normal configuration:

CONFIG.MODEL_STRATEGY = {
  'quick_check': ['flash-lite', 'flash-2.0'],
  'generation': ['flash-2.5', 'flash-lite', 'flash-2.0'],
  'fallback': ['flash-lite', 'flash-2.0']
};

CONFIG.MAX_EMAILS_PER_RUN = 10;
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
| RPD Flash 2.5 | > 200/250 (80%) | > 237/250 (95%) |
| RPD Flash Lite | > 800/1000 (80%) | > 950/1000 (95%) |
| Avg tokens/response | > 2000 | > 3500 |
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

If after quota reset (9:00 AM) the problem persists:

1. Verify API credentials on [Google Cloud Console](https://console.cloud.google.com)
2. Check for any API key restrictions
3. Contact rasanfil@gmail.com with quota screenshot

---

**[Back to Runbooks](./README.md)** | **[Complete Troubleshooting](../TROUBLESHOOTING.md)**
