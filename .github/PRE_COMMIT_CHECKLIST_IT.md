# ✅ Pre-Commit Checklist Sviluppatori

> **Verifica obbligatoria prima di ogni commit al repository**

---

## 🧪 Testing

- [ ] `runAllTests()` eseguito (100% pass)
- [ ] Nessun `console.log()` di debug dimenticato in produzione
- [ ] Testato manualmente su GAS Editor con email reale
- [ ] Verificato funzionamento in modalità `DRY_RUN = true`
- [ ] Test con email in almeno 2 lingue (IT + EN)

### Comandi di Test

```javascript
// Esegui tutti i test unitari
runAllTests();

// Test specifico email
testSpecificEmail('Oggetto test', 'Corpo email di test');

// Verifica connessione API
testGeminiConnection();
```

---

## 🔒 Sicurezza

- [ ] **Nessuna API key hardcoded** nel codice
  ```javascript
  // ❌ SBAGLIATO
  const API_KEY = 'AIzaSy...';
  
  // ✅ CORRETTO
  const API_KEY = PropertiesService.getScriptProperties()
    .getProperty('GEMINI_API_KEY');
  ```

- [ ] **Nessun dato sensibile nei log**
  ```javascript
  // ❌ SBAGLIATO
  console.log('Email body:', emailBody);
  
  // ✅ CORRETTO
  console.log('Processing email from:', senderEmail.substring(0, 3) + '***');
  ```

- [ ] **Regex validate contro ReDoS** - Testare su [regex101.com](https://regex101.com)
  ```javascript
  // ❌ PERICOLOSO (backtracking esponenziale)
  const regex = /(a+)+b/;
  
  // ✅ SICURO
  const regex = /a+b/;
  ```

- [ ] **Input sanitizzato** prima di elaborazione
- [ ] **Nessun eval()** o costruttori dinamici con input utente

---

## 📝 Documentazione

- [ ] **JSDoc aggiornato** per tutte le funzioni pubbliche
  ```javascript
  /**
   * Processa un thread email e genera risposta.
   * @param {string} threadId - ID univoco del thread Gmail
   * @param {Object} resources - Risorse caricate (KB, doctrine, etc.)
   * @returns {Object} Risultato elaborazione con status e dettagli
   */
  function processThread(threadId, resources) { ... }
  ```

- [ ] **CHANGELOG.md aggiornato** (sezione UNRELEASED)
  - Added: nuove funzionalità
  - Changed: modifiche a funzionalità esistenti
  - Fixed: bug corretti
  - Security: fix di sicurezza

- [ ] **README aggiornato** se cambiata API pubblica o configurazione

- [ ] **Versione aggiornata** se release (package.json, README badge)

---

## 🏗️ Architettura

- [ ] **Modifiche retrocompatibili**
  - Nuovi parametri opzionali con valori default
  - Deprecation warnings per funzioni rimosse
  
- [ ] **Nessuna dipendenza esterna aggiunta** senza discussione
  - GAS ha limitazioni su librerie esterne
  - Preferire implementazioni native

- [ ] **Configurazione centralizzata** (no magic numbers)
  ```javascript
  // ❌ SBAGLIATO
  if (score > 0.6) { ... }
  
  // ✅ CORRETTO
  if (score > CONFIG.VALIDATION_MIN_SCORE) { ... }
  ```

- [ ] **Pattern esistenti rispettati**
  - Factory pattern per servizi
  - Singleton per config
  - Funzioni pure dove possibile

---

## 📊 Performance

- [ ] **Nessun loop O(n²) introdotto** senza giustificazione
  ```javascript
  // ❌ O(n²) - evitare
  for (const a of array1) {
    for (const b of array2) { ... }
  }
  
  // ✅ O(n) - preferire
  const set = new Set(array2);
  for (const a of array1) {
    if (set.has(a)) { ... }
  }
  ```

- [ ] **Cache utilizzata appropriatamente**
  - Letture Sheet cachate (costose)
  - API responses cachate se applicabile

- [ ] **Rate limiter considerato**
  - Nuove chiamate API registrate
  - Token consumption stimato

- [ ] **Batch operations preferite**
  ```javascript
  // ❌ N chiamate Sheet
  for (const row of data) {
    sheet.appendRow(row);
  }
  
  // ✅ 1 chiamata Sheet
  sheet.getRange(...).setValues(data);
  ```

---

## 🔄 Pre-Push Finale

- [ ] `git diff` revisionato per modifiche non intenzionali
- [ ] File temporanei/debug rimossi (`.log`, `.tmp`, `.bak`)
- [ ] Commit message descrittivo (tipo: feat/fix/docs/refactor)
- [ ] Branch corretto selezionato

### Formato Commit Message

```
<tipo>(<scope>): <descrizione breve>

<descrizione estesa opzionale>

<riferimenti issue opzionali>
```

**Tipi:**
- `feat`: nuova funzionalità
- `fix`: bug fix
- `docs`: documentazione
- `refactor`: refactoring senza cambio funzionale
- `test`: aggiunta/modifica test
- `perf`: miglioramenti performance
- `security`: fix sicurezza

**Esempio:**
```
feat(validator): aggiunto controllo thinking leak

Rileva quando Gemini 2.5 espone ragionamento interno
nella risposta e blocca con score=0.0

Closes #42
```

---

## 📋 Template Rapido

```markdown
## Pre-Commit Checklist

### Testing
- [x] runAllTests() pass
- [x] No console.log debug
- [x] Manual GAS test

### Security
- [x] No hardcoded keys
- [x] No sensitive data in logs
- [x] Regex ReDoS-safe

### Documentation
- [x] JSDoc updated
- [x] CHANGELOG updated
- [ ] README updated (N/A)

### Architecture
- [x] Backward compatible
- [x] No new dependencies
- [x] Config centralized

### Performance
- [x] No O(n²) loops
- [x] Cache used
- [x] Rate limiter considered
```

---

**[English Version](PRE_COMMIT_CHECKLIST.md)** | **[Contributing Guide](../CONTRIBUTING_IT.md)**
