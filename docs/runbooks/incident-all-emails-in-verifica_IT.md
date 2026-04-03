# 🚨 Runbook: Tutte Email in "Verifica"

> **Procedura quando oltre 30% delle email finisce nella label "Verifica"**

---

## 📋 Informazioni Incidente

| Campo | Valore |
|-------|--------|
| **Severità** | 🟡 MEDIA |
| **Tempo Risoluzione Target** | < 1 ora |
| **Impatto** | Parziale - email richiedono revisione manuale |
| **Escalation** | Se >50% email in Verifica per >24h |

---

## 🔍 Diagnosi Rapida

### Step 1: Calcola Percentuale (5 min)

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
  console.log('📊 STATISTICHE ULTIME 24H');
  console.log('═══════════════════════════════════');
  console.log(`Email automatizzate (IA): ${labels['IA']}`);
  console.log(`Email in Verifica: ${labels['Verifica']} (${verificaRate}%)`);
  console.log(`Email con Errore: ${labels['Errore']}`);
  console.log(`Totale: ${total}`);
  
  if (verificaRate > 30) {
    console.warn('⚠️ TASSO VERIFICA ELEVATO');
  }
}
```

### Step 2: Identifica Pattern Errori (10 min)

Controlla i log in **Apps Script → Esecuzioni** per pattern comuni:

| Pattern Log | Causa Probabile |
|-------------|-----------------|
| "Lunghezza insufficiente" | KB troppo scarsa |
| "Lingua non corrispondente" | Detection fallita |
| "Firma mancante" | Pattern firma errato |
| "Contenuto vietato rilevato" | Frasi proibite |
| "Allucinazione rilevata" | Dati non in KB |
| "Thinking leak" | Caratteristica Gemini |

### Step 3: Analisi Dettagliata

```javascript
function analyzeVerificaEmails() {
  const verifyLabel = GmailApp.getUserLabelByName('Verifica');
  if (!verifyLabel) return;
  
  const threads = verifyLabel.getThreads(0, 10);
  
  console.log('═══════════════════════════════════');
  console.log('🔍 ANALISI ULTIME 10 EMAIL VERIFICA');
  console.log('═══════════════════════════════════');
  
  threads.forEach((thread, i) => {
    const msg = thread.getMessages()[0];
    console.log(`\n${i+1}. ${thread.getFirstMessageSubject()}`);
    console.log(`   Da: ${msg.getFrom()}`);
    console.log(`   Controlla log esecuzione per dettagli validazione`);
  });
}
```

---

## 🔧 Risoluzione per Causa

### Causa A: Soglia Troppo Alta

**Fix Immediato:**
```javascript
// In gas_config.js:
CONFIG.VALIDATION_MIN_SCORE = 0.5;  // Era 0.6
```

**Nota:** Questo riduce la sensibilità ma aumenta il rischio di risposte imprecise.

### Causa B: Risposte Troppo Corte

**Fix:**
1. Arricchisci Knowledge Base con più dettagli
2. Aggiungi esempi di risposte complete

```javascript
// Verifica lunghezza media
function checkAverageResponseLength() {
  // Controlla nei log la lunghezza delle risposte generate
  // Target: 150-500 caratteri per risposta semplice
}
```

### Causa C: Detection Lingua Fallita

**Fix:**
```javascript
// Se email multilingua, sistema usa prevalenza
// Migliora prompt in PromptEngine:

// In gas_prompt_engine.js, sezione LanguageInstruction
// Aggiungi rinforzo:
"Se l'email contiene parole in più lingue, rispondi SEMPRE 
nella lingua della DOMANDA principale, non dei saluti."
```

### Causa D: Firma Non Riconosciuta

**Fix:**
```javascript
// In gas_response_validator.js, aggiungi pattern:
const signaturePatterns = [
  /segreteria\s+parrocchia/i,
  /parish\s+secretariat/i,
  /cordiali\s+saluti/i,
  // AGGIUNGI NUOVI PATTERN:
  /la\s+segreteria/i,
  /distinti\s+saluti/i
];
```

### Causa E: Allucinazioni Frequenti

**Fix:**
1. Identifica quali dati vengono inventati
2. Aggiungi questi dati alla Knowledge Base
3. Se orari/telefoni, verifica formato in KB

```javascript
// Verifica che KB contenga tutti i dati essenziali:
// - Orari messe (tutti i tipi)
// - Contatti (email, telefono)
// - Indirizzi completi
// - Date eventi ricorrenti
```

### Causa F: Thinking Leak (Gemini 2.5)

**Fix:**
```javascript
// Già mitigato nel validator, ma se persiste:

// 1. Aggiungi al prompt in PromptEngine:
"NON esporre MAI il tuo processo di ragionamento.
NON iniziare risposte con 'Rivedendo...', 'Verificando...', etc."

// 2. Considera fallback a modello precedente:
CONFIG.MODEL_STRATEGY = {
  'generation': ['flash-lite', 'flash-2.0']  // Evita 2.5
};
```

---

## ✅ Verifica Risoluzione

```javascript
function verifyVerificaResolved() {
  // Attendi 1-2 ore dopo la soluzione
  
  calculateVerificaRate();
  
  // Target:
  // - Verifica rate < 20% = Ottimo
  // - Verifica rate 20-30% = Accettabile
  // - Verifica rate > 30% = Problema persistente
}
```

---

## 🔄 Processo Email in Verifica

Per le email già in "Verifica":

1. **Apri email in Gmail**
2. **Verifica risposta bozza** (se presente)
3. **Decidi:**
   - ✅ Risposta OK → Invia manualmente + rimuovi label "Verifica"
   - ✏️ Risposta da modificare → Edita e invia
   - ❌ Risposta sbagliata → Riscrivi completamente

---

## 🛡️ Prevenzione

1. **Monitoraggio quotidiano** del tasso Verifica
2. **Review settimanale** delle email in Verifica per pattern
3. **Arricchimento continuo** della Knowledge Base
4. **A/B testing** di soglie validazione

---

## 📞 Escalation

Se il problema persiste dopo tutte le soluzioni:

1. Documenta pattern errori più frequenti
2. Esporta 5 esempi email problematiche (anonimizzate)
3. Contatta info@parrocchiasanteugenio.it

---

**[Torna a Runbooks](./README.md)** | **[Troubleshooting Completo](../TROUBLESHOOTING_IT.md)**
