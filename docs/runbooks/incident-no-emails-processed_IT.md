# 🚨 Runbook: Nessuna Email Processata

> **Procedura di emergenza quando il sistema non elabora email**

---

## 📋 Informazioni Incidente

| Campo | Valore |
|-------|--------|
| **Severità** | 🔴 CRITICA |
| **Tempo Risoluzione Target** | < 30 minuti |
| **Impatto** | Totale - nessuna email automatizzata |
| **Escalation** | Dopo 1 ora senza risoluzione |

---

## 🔍 Diagnosi Rapida

### Step 1: Verifica Trigger (2 min)

```javascript
function checkTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  const mainTrigger = triggers.find(t => t.getHandlerFunction() === 'main');
  
  if (!mainTrigger) {
    console.error('❌ TRIGGER MANCANTE');
    return false;
  }
  
  console.log('✓ Trigger presente');
  console.log('Intervallo:', mainTrigger.getTriggerSource());
  return true;
}
```

**Azione:**
1. Apri [Apps Script](https://script.google.com)
2. Menu: ⏰ Trigger
3. Verifica presenza trigger "main"

### Step 2: Verifica API Key (2 min)

```javascript
function checkApiKey() {
  const apiKey = PropertiesService.getScriptProperties()
    .getProperty('GEMINI_API_KEY');
  
  if (!apiKey) {
    console.error('❌ API KEY MANCANTE');
    return false;
  }
  
  console.log('✓ API Key presente:', apiKey.substring(0, 10) + '...');
  return true;
}
```

### Step 3: Verifica Spreadsheet (2 min)

```javascript
function checkSpreadsheet() {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    console.log('✓ Spreadsheet accessibile:', ss.getName());
    return true;
  } catch (e) {
    console.error('❌ SPREADSHEET NON ACCESSIBILE:', e.message);
    return false;
  }
}
```

### Step 4: Verifica Orari (1 min)

```javascript
function checkSuspension() {
  if (typeof isInSuspensionTime === 'function' && isInSuspensionTime()) {
    console.warn('⚠️ SISTEMA IN SOSPENSIONE (orario ufficio)');
    return false;
  }
  console.log('✓ Non in sospensione');
  return true;
}
```

---

## 🔧 Risoluzione per Causa

### Causa A: Trigger Mancante

**Fix:**
```javascript
function fixTrigger() {
  // Rimuovi trigger esistenti
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'main') {
      ScriptApp.deleteTrigger(t);
    }
  });
  
  // Ricrea trigger
  ScriptApp.newTrigger('main')
    .timeBased()
    .everyMinutes(10)
    .create();
  
  console.log('✓ Trigger ricreato');
}
```

### Causa B: Autorizzazioni Scadute

**Fix:**
1. Esegui manualmente `main()` dall'editor
2. Accetta i permessi richiesti
3. Verifica esecuzione corretta

### Causa C: API Key Mancante

**Fix:**
1. Vai su [AI Studio](https://aistudio.google.com/apikey)
2. Genera nuova chiave API
3. In Apps Script: ⚙️ Impostazioni Progetto → Script Properties
4. Aggiungi proprietà `GEMINI_API_KEY` con la nuova chiave

### Causa D: Spreadsheet Non Accessibile

**Fix:**
1. Verifica ID corretto in `gas_config.js`
2. Apri lo spreadsheet e verifica condivisione
3. Lo script deve avere accesso "Editor"

### Causa E: DRY_RUN Attivo

**Fix:**
```javascript
// In gas_config.js:
CONFIG.DRY_RUN = false;  // Era true
```

---

## ✅ Verifica Risoluzione

```javascript
function verifyResolution() {
  console.log('═══════════════════════════════════');
  console.log('🔍 VERIFICA RISOLUZIONE');
  console.log('═══════════════════════════════════');
  
  // Esegui main manualmente
  main();
  
  // Controlla ultime email
  const label = GmailApp.getUserLabelByName('IA');
  if (label) {
    const recent = label.getThreads(0, 5);
    console.log(`Email elaborate oggi: ${recent.length}`);
  }
  
  console.log('✓ Sistema operativo');
}
```

---

## 📊 Monitoraggio Post-Incidente

- [ ] Verificare elaborazione email nelle prossime 30 minuti
- [ ] Controllare che nessuna email sia stata persa
- [ ] Documentare causa root nel log incidenti
- [ ] Aggiornare runbook se necessario

---

## 📞 Escalation

Se dopo 1 ora il problema persiste:

1. **Contatta supporto tecnico:** support@exnovobots.com
2. **Allega:**
   - Output di `emergencyDiagnostic()`
   - Log ultimi 5 errori da Esecuzioni
   - Screenshot configurazione trigger

---

**[Torna a Runbooks](./README.md)** | **[Troubleshooting Completo](../TROUBLESHOOTING_IT.md)**
