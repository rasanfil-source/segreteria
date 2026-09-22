# 🚨 Runbook: Quota API Esaurita

> Configurazione locale, non garanzia di quote o disponibilità del fornitore. Consultare il [resoconto aggiornato](../RELIABILITY_AUDIT_2026-09-22.md) per limiti, migrazioni e gestione degli invii incerti.

> **Procedura quando si riceve errore 429 "Quota Exceeded"**

---

## 📋 Informazioni Incidente

| Campo | Valore |
|-------|--------|
| **Severità** | 🟠 ALTA |
| **Tempo Risoluzione Target** | Immediato (workaround) / Reset 00:00 America/Los_Angeles |
| **Impatto** | Parziale - email non processate |
| **Escalation** | Se problema persiste dopo reset quota |

---

## 🔍 Diagnosi Rapida

### Step 1: Verifica Stato Quota (2 min)

```javascript
function checkQuotaStatus() {
  if (typeof GeminiRateLimiter !== 'undefined') {
    const limiter = new GeminiRateLimiter();
    limiter.logUsageStats();
  }
  
  // Verifica errori recenti
  console.log('Controlla in "Esecuzioni" per errori 429');
}
```

### Step 2: Identifica Modello Esaurito

| Modello | Limite RPD | Reset |
|---------|------------|-------|
| Gemini 3.5 Flash-Lite | 1.000/giorno (locale) | 00:00 America/Los_Angeles |
| Google Search Grounding | Disabilitato di default; verificare AI Studio se abilitato | 00:00 America/Los_Angeles |
| Creazione context cache | Disabilitata di default in Free Tier; conta come richiesta API se abilitata | 00:00 America/Los_Angeles |

---

## 🔧 Workaround Immediato

### Opzione A: Usa Catena Minima Qualità + Fallback Lite

```javascript
// In gas_config.js, modifica temporaneamente:
CONFIG.MODEL_STRATEGY = {
  'quick_check': ['flash-lite'],
  'generation': ['flash-3.7', 'flash-lite']  // Qualità prima, fallback conservativo
};
```

### Opzione B: Riduci Carico

```javascript
// In gas_config.js:
CONFIG.MAX_EMAILS_PER_RUN = 2;  // Default operativo prudente
// Usa 1 per mitigazione severa, 0 per sospendere temporaneamente
```

### Opzione C: Sospendi Temporaneamente

```javascript
// In gas_config.js:
CONFIG.MAX_EMAILS_PER_RUN = 0;  // Sospende elaborazione

// Oppure
CONFIG.DRY_RUN = true;  // Simula senza chiamate API
```

---

## ⏰ Reset Quota

**La quota si resetta al00:00 America/Los_Angeles italiane** (mezzanotte Pacific Time).

### Calcolo Tempo Residuo

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
  
  console.log(`Tempo al reset: ${hours}h ${minutes}m`);
}
```

---

## 🔄 Post-Reset: Ripristino Configurazione

```javascript
// Dopo 00:00 America/Los_Angeles, ripristina configurazione normale:

CONFIG.MODEL_STRATEGY = {
  'quick_check': ['flash-lite'],
  'generation': ['flash-3.7', 'flash-3.7-backup', 'flash-lite', 'flash-lite-backup'],
  'fallback': ['flash-lite', 'flash-lite-backup']
};

CONFIG.MAX_EMAILS_PER_RUN = 2;
CONFIG.DRY_RUN = false;
```

---

## 🛡️ Prevenzione

### 1. Abilita Safety Valve

```javascript
// In gas_config.js - già attivo di default
CONFIG.SAFETY_VALVE_THRESHOLD = 0.8;  // Attiva a 80%
```

### 2. Monitora Utilizzo Quotidiano

```javascript
// Aggiungi a dailyHealthCheck()
function checkDailyUsage() {
  const limiter = new GeminiRateLimiter();
  const stats = limiter.getUsageStats();
  
  for (const [model, data] of Object.entries(stats.models)) {
    if (data.rpd.percent > 70) {
      console.warn(`⚠️ ${model}: ${data.rpd.percent}% quota usata`);
    }
  }
}
```

### 3. Considera Upgrade Piano

Se quota esaurita frequentemente, valuta:
- Passaggio a Google Workspace (più quote)
- Piano API a pagamento
- Ottimizzazione prompts (meno token)

---

## 📊 Metriche da Monitorare

| Metrica | Soglia Warning | Soglia Critica |
|---------|---------------|----------------|
| RPD Gemini 3.5 Flash-Lite | > 80% della quota effettiva del progetto | > 95% della quota effettiva del progetto |
| Google Search Grounding | Monitorare solo se abilitato in AI Studio | Monitorare solo se abilitato in AI Studio |
| Token/risposta medio | > 20.000 | > 80.000 |
| Email/ora | > 15 | > 25 |

---

## ✅ Verifica Risoluzione

```javascript
function verifyQuotaResolved() {
  const gemini = new GeminiService();
  
  try {
    // Test chiamata semplice
    const result = gemini.testConnection();
    
    if (result.connectionOk) {
      console.log('✓ API Gemini operativa');
      return true;
    }
  } catch (e) {
    if (e.message.includes('429')) {
      console.error('❌ Quota ancora esaurita');
      return false;
    }
    throw e;
  }
}
```

---

## 📞 Escalation

Se dopo reset quota (00:00 America/Los_Angeles) il problema persiste:

1. Verifica credenziali API su [Google Cloud Console](https://console.cloud.google.com)
2. Controlla eventuali restrizioni sull'API key
3. Contatta info@parrocchiasanteugenio.it con screenshot quota

---

**[Torna a Runbooks](./README.md)** | **[Troubleshooting Completo](../TROUBLESHOOTING_IT.md)**
