# 📅 Checklist Manutenzione Mensile

> **Attività di manutenzione da eseguire ogni mese per garantire il corretto funzionamento del sistema**

---

## 📋 Informazioni Procedura

| Campo | Valore |
|-------|--------|
| **Frequenza** | Mensile (primo lunedì del mese) |
| **Durata Stimata** | 30-60 minuti |
| **Responsabile** | Amministratore sistema |
| **Prerequisiti** | Accesso a GAS Editor, Gmail, Spreadsheet |

---

## 📊 Sezione 1: Analisi Statistiche

### 1.1 Report Mensile

```javascript
function monthlyReport() {
  const now = new Date();
  const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
  
  console.log('═══════════════════════════════════');
  console.log('📊 REPORT MENSILE');
  console.log(`Periodo: ${oneMonthAgo.toLocaleDateString()} - ${now.toLocaleDateString()}`);
  console.log('═══════════════════════════════════');
  
  const labels = [CONFIG.LABEL_NAME, CONFIG.VALIDATION_ERROR_LABEL, CONFIG.ERROR_LABEL_NAME, CONFIG.SKIP_LABEL_NAME].filter(Boolean);
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
  
  const processed = stats[CONFIG.LABEL_NAME] || 0;
  const needsReview = stats[CONFIG.VALIDATION_ERROR_LABEL] || 0;
  const errors = stats[CONFIG.ERROR_LABEL_NAME] || 0;
  const total = processed + needsReview + errors;
  const automationRate = total > 0 ? (processed / total * 100).toFixed(1) : 0;
  
  console.log(`\nEmail Totali Processate: ${total}`);
  console.log(`  ✅ Automatizzate (${CONFIG.LABEL_NAME}): ${processed} (${automationRate}%)`);
  console.log(`  ⚠️ ${CONFIG.VALIDATION_ERROR_LABEL}: ${needsReview}`);
  console.log(`  ❌ ${CONFIG.ERROR_LABEL_NAME}: ${errors}`);
  console.log(`  🚫 ${CONFIG.SKIP_LABEL_NAME || 'Skip'}: ${CONFIG.SKIP_LABEL_NAME ? (stats[CONFIG.SKIP_LABEL_NAME] || 0) : 0}`);
  
  // Benchmark
  if (automationRate >= 80) console.log('\n🏆 ECCELLENTE: Tasso automazione > 80%');
  else if (automationRate >= 70) console.log('\n✓ BUONO: Tasso automazione > 70%');
  else console.log('\n⚠️ ATTENZIONE: Tasso automazione < 70%');
}
```

**Checklist:**
- [ ] Eseguito `monthlyReport()`
- [ ] Tasso automazione > 70%
- [ ] Tasso errori < 5%
- [ ] Annotato trend rispetto mese precedente

### 1.2 Analisi Quota API

```javascript
function analyzeMonthlyQuota() {
  console.log('\n📈 ANALISI UTILIZZO QUOTA');
  
  if (typeof GeminiRateLimiter !== 'undefined') {
    const limiter = new GeminiRateLimiter();
    limiter.logUsageStats();
  }
  
  // Verifica giorni con quota esaurita
  console.log('Controlla log per errori 429 nel mese');
}
```

**Checklist:**
- [ ] Nessun giorno con quota esaurita
- [ ] Media utilizzo < 60% quota giornaliera
- [ ] Safety Valve attivato < 5 volte

---

## 🧹 Sezione 2: Pulizia e Manutenzione

### 2.1 Pulizia Memoria Conversazionale

```javascript
function cleanupOldMemory() {
  const memory = new MemoryService();
  const result = memory.cleanupOldEntries(90); // Rimuove > 90 giorni
  
  console.log(`Memoria: ${result.removed} entry rimosse, ${result.remaining} mantenute`);
}
```

**Checklist:**
- [ ] Eseguito `cleanupOldMemory()`
- [ ] Verificato che cleanup trigger automatico sia attivo
- [ ] Sheet "ConversationMemory" < 5000 righe

### 2.2 Verifica Integrità Spreadsheet

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
  
  console.log('\n🔍 VERIFICA FOGLI');
  requiredSheets.forEach(name => {
    const sheet = ss.getSheetByName(name);
    if (sheet) {
      const rows = sheet.getLastRow();
      console.log(`✓ ${name}: ${rows} righe`);
    } else {
      console.error(`❌ ${name}: MANCANTE`);
    }
  });
}
```

**Checklist:**
- [ ] Tutti i fogli richiesti presenti
- [ ] Nessuna riga vuota o corrotta
- [ ] Backup foglio eseguito (copia manuale)

### 2.3 Pulizia Label Gmail

**Azioni Manuali:**
- [ ] Archiviare email > 6 mesi con label "IA"
- [ ] Eliminare email risolte da "Verifica"
- [ ] Verificare email in "Errore" e riprocessare se necessario

---

## 🔧 Sezione 3: Aggiornamenti

### 3.1 Verifica Knowledge Base

**Checklist:**
- [ ] Orari messe aggiornati (estivo/invernale?)
- [ ] Contatti segreteria corretti
- [ ] Date eventi anno corrente presenti
- [ ] Informazioni sacramenti aggiornate
- [ ] Rimossi riferimenti a eventi passati

### 3.2 Verifica Configurazione

```javascript
function reviewConfiguration() {
  console.log('\n⚙️ CONFIGURAZIONE CORRENTE');
  console.log(`MAX_EMAILS_PER_RUN: ${CONFIG.MAX_EMAILS_PER_RUN}`);
  console.log(`VALIDATION_MIN_SCORE: ${CONFIG.VALIDATION_MIN_SCORE}`);
  console.log(`DRY_RUN: ${CONFIG.DRY_RUN}`);
  console.log(`USE_RATE_LIMITER: ${CONFIG.USE_RATE_LIMITER}`);
  
  // Warning se configurazione non ottimale
  if (CONFIG.DRY_RUN) {
    console.warn('⚠️ DRY_RUN attivo - email NON inviate!');
  }
}
```

**Checklist:**
- [ ] `DRY_RUN = false` in produzione
- [ ] `USE_RATE_LIMITER = true`
- [ ] Soglie validazione appropriate

### 3.3 Verifica Trigger

**Checklist:**
- [ ] Trigger `processEmailsMain` attivo (ogni 10 min)
- [ ] Trigger `cleanupOldMemory` attivo (settimanale)
- [ ] Trigger `dailyHealthCheck` attivo (ogni mattina)

---

## 🔐 Sezione 4: Sicurezza

### 4.1 Rotazione API Key (Trimestrale)

**Se passati 3 mesi dall'ultima rotazione:**
- [ ] Genera nuova API Key su [AI Studio](https://aistudio.google.com/apikey)
- [ ] Aggiorna in Script Properties
- [ ] Disabilita chiave vecchia
- [ ] Testa connessione con `testGeminiConnection()`

### 4.2 Verifica Accessi

**Checklist:**
- [ ] Solo account autorizzati hanno accesso allo script
- [ ] Solo account autorizzati hanno accesso allo Spreadsheet
- [ ] Nessun nuovo editor non riconosciuto

### 4.3 Revisione Log

**Controlla in Apps Script → Esecuzioni:**
- [ ] Nessun errore critico non gestito
- [ ] Nessun pattern di attacco (richieste anomale)
- [ ] Nessun accesso non autorizzato

---

## 📝 Sezione 5: Documentazione

**Checklist:**
- [ ] Aggiornato CHANGELOG se modifiche nel mese
- [ ] Documentati incident significativi
- [ ] Aggiornata KB con nuove FAQ ricorrenti
- [ ] Note per prossimo mese annotate

---

## 📊 Report Finale

Al termine della manutenzione, compila:

```
═══════════════════════════════════════════════
📋 REPORT MANUTENZIONE MENSILE
Data: _____________
Eseguito da: _____________
═══════════════════════════════════════════════

📊 STATISTICHE MESE
- Email processate: ____
- Tasso automazione: ____%
- Errori: ____

🧹 PULIZIA
- Memory entries rimosse: ____
- Email archiviate: ____

🔧 AGGIORNAMENTI
- KB aggiornata: ☐ Sì ☐ No
- Config modificata: ☐ Sì ☐ No

🔐 SICUREZZA
- API Key ruotata: ☐ Sì ☐ No ☐ Non necessario
- Accessi verificati: ☐ Sì

📝 NOTE
_______________________________________
_______________________________________

⏰ PROSSIMA MANUTENZIONE: _____________
═══════════════════════════════════════════════
```

---

## 📅 Calendario Manutenzione Annuale

| Mese | Attività Extra |
|------|----------------|
| Gennaio | Review annuale completa |
| Aprile | Rotazione API Key Q1 |
| Luglio | Rotazione API Key Q2 + Aggiornamento orari estivi |
| Ottobre | Rotazione API Key Q3 + Aggiornamento orari invernali |

---

**[Torna a Runbooks](./README.md)** | **[Deployment Guide](../DEPLOYMENT_IT.md)**
