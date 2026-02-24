# 📧 Segreteria Email Parrocchiale AI

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) 
[![Language: IT](https://img.shields.io/badge/Language-Italian-green?style=flat-square)](README_IT.md)
[![English Version](https://img.shields.io/badge/English-Version-blue?style=flat-square)](README.md)
[![Status: Production Ready](https://img.shields.io/badge/Status-Production%20Ready-brightgreen)]

> **Un assistente AI intelligente che gestisce le email della tua parrocchia con sensibilità pastorale, accuratezza dottrinale ed efficienza operativa.**

---

## 🎯 Cosa fa questo sistema

**In parole semplici:** Quando qualcuno scrive alla parrocchia, il sistema legge l'email, capisce cosa serve, consulta le informazioni disponibili (orari messe, attività, documenti per sacramenti) e risponde automaticamente in modo professionale e pastorale.

### Casi d'uso reali

✅ **"A che ora è la messa domenicale?"** → Risposta immediata con orari correnti  
✅ **"Vorrei far battezzare mio figlio"** → Info complete su documenti, date, corso  
✅ **"Abito in Via Roma 10, rientro nella vostra parrocchia?"** → Verifica automatica del territorio  
✅ **"Ho un problema personale e vorrei parlare con un sacerdote"** → Tono empatico + contatti diretti  
✅ **Email in inglese/spagnolo** → Risposta nella stessa lingua  

### ✨ Versione 2.0: Solidità & Affidabilità
*   **Gestione Lock Avanzata**: Ottimizzazione dei lock atomici per una coordinazione perfetta dei processi.
*   **Gestione Semantica KB**: Troncamento intelligente della Knowledge Base per garantire risposte sempre complete e coerenti.
*   **Resilienza Operativa**: Sistema di monitoraggio delle quote integrato per una continuità di servizio costante.
*   **Raffinamento Validazione**: Controlli qualitativi estesi per una precisione millimetrica nell'interazione.
*   **Prompt Engine Modulare**: Assemblaggio dinamico del contesto per massimizzare la pertinenza di ogni risposta.
*   **Smart RAG (Dottrina)**: Integrazione profonda con il magistero e le direttive parrocchiali.
> ℹ️ **Nota operativa**: il blocco Dottrina è caricato in cache ma viene incluso nel prompt solo quando il classifier rileva una necessità dottrinale (`needsDoctrine`) o un topic pertinente. È normale che, in casistiche reali, le email dottrinali siano una minoranza.
*   **Eccellenza Linguistica**: Gestione raffinata di grammatica e stili formali (es. nomi sacri).
*   **Analisi Multi-Dimensionale**: Comprensione del carico emotivo e della complessità delle richieste.
*   **Supporto OCR Integrato**: Elaborazione automatica di allegati e immagini per un contesto arricchito.
*   **Resilienza v2.2.x (Hardening)**:
    *   **Cache Persistente Label**: Riduzione drastica delle chiamate API Gmail tramite caching intelligente degli stati delle etichette.
    *   **JSON Parsing Robusto**: Algoritmi di recupero per risposte LLM malformate (Safe Key Quoting).
    *   **Gestione Lock Avanzata**: Lock sharded e retry con backoff per una concorrenza sicura su grandi volumi.
    *   **Resource Budgeting (v2.2.4)**: Controllo granulare del tempo di esecuzione (`MAX_EXECUTION_TIME_MS`) e del budget dei token Knowledge Base.
    *   **Alias-Aware Loop Prevention (v2.2.4)**: Rilevamento intelligente dei loop email considerando anche gli alias configurati della segreteria.
    *   **Hardening Normalizzazione (v2.2.6)**: Normalizzazione dei numeri civici resa sicura contro valori `null` o `undefined`.
    *   **Compatibilità Drive API**: Supporto trasparente per diverse versioni del servizio OCR di Google Drive.
    *   **Timezone-Awareness**: Sincronizzazione perfetta degli orari di sospensione con il fuso orario dello script.
*   **Cycle v2.3.1 (Security Hardening)**:
    *   **SSRF Protection v2**: Protezione avanzata contro bypass IPv6 (forme estese ed IPv4-mapped).
    *   **JSON Resilience**: Migliorata estrazione da blocchi markdown e autocorrezione virgole pendenti.
    *   **Keyword Scan Esteso**: Il filtro newsletter ora scansiona anche il corpo del messaggio per una maggiore efficacia.
    *   **RateLimiter Safe-Mode**: Protezione contro crash in fase di inizializzazione per una maggiore stabilità del bundle.
    *   **Anti-Hallucination v2**: Sistema di filtro per falsi positivi (es. date YYYYMMDD scambiate per telefoni).
*   **Cycle v2.5.4 (Sheets Resilience & Error Handling Documented)**:
    *   **Main Logic**: Esteso l'uso di `withSheetsRetry` a tutte le chiamate critiche di recupero fogli (`getSheetByName`) e alla configurazione avanzata, migliorando la resilienza verso glitch temporanei delle API Spreadsheet.
    *   **Gemini Service**: Migliorata la documentazione interna sulla classificazione degli errori e la policy di retry per prevenire drift logici.
*   **Cycle v2.5.3 (Drive API Upgrade & OCR Persistence)**:
    *   **Project Config**: Aggiornato il Servizio Avanzato Drive dalla versione `v2` alla `v3` in `appsscript.json`.
    *   **Gmail Service**: Adeguata la logica OCR per utilizzare i metodi Drive API v3 (`create` con `mimeType` specifico) garantendo la conversione corretta in Google Doc per l'estrazione del testo.
*   **Cycle v2.5.2 (Hardening Gmail & Runtime Initialization)**:
    *   **Gmail Service**: Migliorata l'estrazione del destinatario (`recipientEmail`) con fallback multipli su `EffectiveUser` e `ActiveUser` in caso di fallimento delle API avanzate.
    *   **Main Logic**: Rafforzato il caricamento risorse con documentazione esplicita sulla garanzia di inizializzazione della cache globale.
*   **Cycle v2.5.1 (Reliability & Resource Adaptation)**:
    *   **Memory Service**: Affinata la pulizia della cache per le chiavi `MEM_*` (transazionali) e migliorata la documentazione interna sulla precedenza dei blocchi lock-retry.
    *   **Territory Validator**: Introdotto flag esplicito `needsCivic: false` per indirizzi completi, garantendo la coerenza del contratto con l'EmailProcessor e riducendo richieste ridondanti all'utente.
    *   **Response Validator**: Regex migliorata per il controllo della maiuscola dopo virgola, riducendo i falsi positivi su forme elise.
*   **Cycle v2.5.0 (KB Structure & Multi-line Support)**:
    *   **Main Logic**: Implementata la normalizzazione delle celle multilinea nei Fogli Google per preservare la struttura logica "una riga = un'istruzione" nel prompt dell'IA.
    *   **Smoke Tests**: Aggiunti test di regressione per la normalizzazione del testo KB e la stabilità delle celle complesse.
*   **Cycle v2.4.9 (Logging & Date Stability Refinement)**:
    *   **Logger**: Rinominato in `AppLogger` per evitare conflitti con l'oggetto globale di sistema di Google Apps Script.
    *   **Gemini Service**: Stabilizzata la logica `_isBetweenInclusive` per il calendario liturgico (confronto azzerato sull'ora) e migliorata la leggibilità della generazione diretta.
    *   **Main Logic**: Pulizia e raffinamento del probe iniziale per la verifica dei Servizi Avanzati di Gmail.
*   **Cycle v2.4.8 (State Management & OCR Refinement)**:
    *   **Memory Service**: Allineamento automatico della versione attesa (`expectedVersion`) durante i retry di aggiornamento memoria per una gestione più robusta dei conflitti OCC.
    *   **Gmail Service**: Migliorato il parsing dei nomi nei documenti estratti (rimossa esclusione virgola) per una maggiore precisione OCR.
    *   **Rate Limiter**: Ottimizzata la selezione dei candidati per task di generazione con fallback prioritario sulla famiglia 2.5-flash.
*   **Cycle v2.4.7 (Robustness & Concurrency Hardening)**:
    *   **Rate Limiter**: Implementato retry loop con backoff esponenziale per l'acquisizione del lock nella selezione modello.
    *   **Memory Service**: Preservazione delle reazioni utente durante il merge dei topic e allineamento dinamico dei TTL dei lock con i timeout di scrittura sugli Sheet.
    *   **Prompt Engine**: Ridotto il limite di sicurezza `MAX_SAFE_TOKENS` a 50k per una maggiore stabilità contro i timeout GAS.
*   **Cycle v2.4.6 (Holiday & Architecture Refinement)**:
    *   **Main Logic**: Aggiunte Pentecoste e Corpus Domini al sistema di sospensione oraria (gestite come festivi).
    *   **Response Validator**: Introdotto alias di compatibilità `validate(response, opts)` per integrazioni legacy.
    *   **Prompt Engine**: Migliorata la robustezza della checklist contestuale con cast di sicurezza sui contesti territoriali.
*   **Cycle v2.4.5 (Test Environment Hardening)**:
    *   **Unit Tests**: Aggiunto mock per `SpreadsheetApp.flush()` per una migliore compatibilità con l'ambiente GAS durante i test locali.
*   **Cycle v2.4.4 (Cross-Service Hardening)**:
    *   **Gemini Service**: Migliorato il parsing JSON nel controllo rapido e raffinata la classificazione degli errori (distinzione netta tra errori FATAL come 401/403 e RETRYABLE).
    *   **Config Advanced**: Corretti gli indici di colonna per le fasce orarie e ottimizzato il caricamento filtri anti-spam.
*   **Cycle v2.4.3 (Strict Config & Validation)**:
    *   **Config Advanced**: Implementata validazione rigorosa per le fasce orarie di sospensione (scarto di valori non numerici, ore fuori range 0-23 e fasce invertite).
    *   **Smoke Tests**: Aggiunta copertura per il parsing delle configurazioni avanzate dello Sheet Controllo.
*   **Cycle v2.4.2 (Maintenance & Edge-Cases)**:
    *   **Response Validator**: Migliorato il rilevamento delle frasi di incertezza (word boundaries) e corretto il calcolo dello score per risposte troppo lunghe.
    *   **Gmail Service & Main**: Ottimizzato il parsing HTML, migliorata la resilienza nel caricamento risorse e raffinata la persistenza della memoria (best-effort).
    *   **Classifier**: Raffinata la rimozione delle firme per evitare falsi positivi a metà frase.
*   **Cycle v2.4.1 (No-Object Hardening)**:
    *   **Prompt Engine**: Implementata normalizzazione automatica degli input (`knowledgeBase`, `attachmentsContext`) per prevenire output "[object Object]" nel prompt in caso di dati strutturati.
    *   **Smoke Tests**: Aggiunta copertura per la normalizzazione degli oggetti nella Knowledge Base.
*   **Cycle v2.4.0 (Resilience Hardening)**:
    *   **Resource Loading**: Caricamento risorse (`gas_main.js`) reso robusto con sistema di retry automatico per gestire errori transitori delle Sheets API.
    *   **Lock management**: Refactoring e precisione nei log di rilascio lock in `gas_email_processor.js`.
    *   **Salutation Mode**: Ottimizzazione della logica di saluto per eliminare ridondanze nei thread con memoria.
    *   **Maintenance Tools**: Potenziamento degli script di ripristino codifica (restore_all) e sanitizzazione (sanitize_files) per gestire artefatti di codifica CP1252.
*   **Cycle v2.3.8 (Maintenance)**:
    *   **Calcolo Pasqua**: Restituisce mezzogiorno (12:00:00) per prevenire slittamenti di data tra timezone/DST.
*   **Cycle v2.3.7 (Resilience & Compliance)**:
    *   **Rate Limiter**: Risolto shadowing variabile `window` e ottimizzata persistenza WAL.
    *   **Gmail Service**: Supporto liste markdown e wrapper HTML RFC-compliant.
    *   **Drive OCR**: Limite immagini a 2MB per stabilità API Drive.
    *   **Email Processor**: Refactoring scope lock e troncamento memoria intelligente.
    *   **Memory Service**: Fix GC cache per chiavi falsy/corrotte.
    *   **Response Validator**: Pattern telefonico selettivo (anti-falsi positivi date).
*   **Cycle v2.3.6 (Strict Mode & Hardening)**:
    *   **Dichiarazioni Variabili**: Corretta la dichiarazione di `enrichedKnowledgeBase` con `const`.
    *   **Allineamento Fallback (v2.3.5)**: Garantita coerenza oggetto `classification`.
    *   **KB Semantic Hard-Cap (v2.3.5)**: Rispetto budget token KB.
    *   **Lock Management (v2.3.5)**: Rimozione lock ridondanti.


---

## ⚡ Vantaggi Immediati

| Per la Segreteria | Per i Fedeli | Per i Parroci |
|-------------------|--------------|---------------|
| ⏰ Riduce il carico di email ripetitive | 📱 Risposte immediate 24/7 | 🎯 Più tempo per la pastorale |
| 📊 Gestisce 70-80% delle richieste semplici | 🌍 Supporto multilingua | 📈 Statistiche sulle richieste |
| 🔄 Niente più "scusa il ritardo" | ✅ Informazioni sempre aggiornate | 🛡️ Filtro anti-spam automatico |
| 📚 Coerenza nelle risposte | 💬 Tono professionale e accogliente | 🔍 Evidenzia casi che necessitano attenzione umana |

---

## 🚀 Come Funziona (per non tecnici)

```mermaid
graph LR
    A[📨 Email arriva] --> B{È spam?}
    B -->|Sì| C[🗑️ Ignora]
    B -->|No| D{Tipo richiesta?}
    D --> E[📖 Consulta informazioni parrocchia]
    E --> F[🤖 AI scrive risposta]
    F --> G{Qualità OK?}
    G -->|Sì| H[✉️ Invia risposta]
    G -->|No| I[⚠️ Segna per revisione]
```

**Nessuna email viene cancellata.** Il sistema aggiunge solo delle etichette:
- 🟢 **"IA"** = Risposta inviata con successo
- 🟡 **"Verifica"** = Risposta generata ma da controllare prima dell'invio
- 🔴 **"Errore"** = Richiesta di intervento manuale

---

## 📋 Requisiti Minimi

- ✅ **Account Gmail della parrocchia** (es. `info@parrocchiaexample.it` su Gmail)
- ✅ **Google Drive** (gratis, per memorizzare le informazioni)
- ✅ **5 minuti** per la configurazione iniziale
- ✅ **Nessuna competenza tecnica** (abbiamo guide passo-passo)

### Costi

| Componente | Costo | Note |
|------------|-------|------|
| Gmail | Gratis | Account esistente |
| Google Drive | Gratis | Quota standard sufficiente |
| Google Apps Script | Gratis | Hosting incluso |
| API Gemini AI | **Gratis** | Fino a 50 email/giorno con la free tier |

💡 **Nota:** Entro i limiti della free tier (50 email/giorno), il sistema è **completamente gratuito**.

---

## 👀 Sistema a Colpo d'Occhio

```
┌─────────────────────────────────────────────────────────┐
│  📧 EMAIL ARRIVA                                        │
│  └─► 🤖 Sistema legge ogni 5 minuti                     │
└─────────────────────────────────────────────────────────┘
                        │
                        ▼
        ┌───────────────────────────────┐
        │ 🧹 FILTRI INTELLIGENTI        │
        │ • Spam/Newsletter → Ignora    │
        │ • Acknowledgment → Ignora     │
        │ • Domanda vera → Processa     │
        └───────────────┬───────────────┘
                        │
                        ▼
        ┌───────────────────────────────┐
        │ 🧠 CLASSIFICA RICHIESTA       │
        │ • Tecnica → KB Lite           │
        │ • Pastorale → KB Heavy        │
        │ • Dottrinale → KB + Dottrina  │
        │ • Territorio → Verifica Ind.  │
        └───────────────┬───────────────┘
                        │
                        ▼
        ┌───────────────────────────────┐
        │ 🤖 GENERA RISPOSTA (Gemini)   │
        │ • Usa Knowledge Base          │
        │ • Rispetta lingua email       │
        │ • Gestisce ritardi (>3gg)     │
        │ • Tono professionale/caloroso │
        └───────────────┬───────────────┘
                        │
                        ▼
        ┌───────────────────────────────┐
        │ ✅ VALIDA QUALITÀ             │
        │ • Lunghezza OK?               │
        │ • Lingua corretta?            │
        │ • Nessuna allucinazione?      │
        └───────────────┬───────────────┘
                        │
                ┌───────┴───────┐
                │               │
             ✅ OK          ❌ FAIL
                │               │
                ▼               ▼
        ┌──────────────┐  ┌──────────────┐
        │ 📤 INVIA     │  │ ⚠️ VERIFICA  │
        │ + Label "IA" │  │ Umana Needed │
        └──────────────┘  └──────────────┘
```

---

## 🔄 Compatibilità e Dipendenze

| Componente | Versione Minima | Versione Testata | Note |
|------------|-----------------|------------------|------|
| Google Apps Script Runtime | V8 | V8 | **Obbligatorio** |
| Gemini API | 1.5 Flash | 2.5 Flash | 2.5 raccomandato |
| Google Sheets API | v4 | v4 | - |
| Gmail API | v1 | v1 | Advanced Service |
| Node.js (per clasp) | 14+ | 20 LTS | Solo sviluppo |

### Breaking Changes tra Versioni

**2.3.x → 2.4.x**
- ⚠️ `CONFIG.GEMINI_MODELS` ora obbligatorio
- ⚠️ `VALIDATION_STRICT_MODE` rimosso (usa invece `VALIDATION_MIN_SCORE`)

---

## 🎓 Guide Complete

### Per Iniziare

1. 📖 **[Guida Setup Completa](docs/Guida_Setup_Completa_Per_non_tecnici.md)** ← **Parti da qui!**
   - Installazione passo-passo con screenshot
   - Nessuna competenza tecnica richiesta
   - Tempo: ~15 minuti

2. 🔧 **[Configurazione Avanzata](docs/CONFIGURATION_IT.md)**
   - Personalizza orari, lingue, tono risposte
   - Configura territorio parrocchiale
   - Gestione festività

3. 📚 **[Popolamento Knowledge Base](docs/KNOWLEDGE_BASE_GUIDE_IT.md)**
   - Come inserire orari messe, eventi, documenti
   - Template già pronti
   - Best practices

### ⚠️ Note Importanti sulla Configurazione

   > **PRIORITÀ CONFIGURAZIONE:**
   > In ambiente di produzione, le **Script Properties** hanno la priorità assoluta su `gas_config.js`.
   >
   > Se imposti `GEMINI_API_KEY` o `SPREADSHEET_ID` nelle **Impostazioni Progetto > Proprietà dello script**, questi valori sovrascriveranno quanto scritto nel codice `CONFIG`.
   > Questo è fondamentale per la sicurezza (non salvare mai chiavi reali nel file `gas_config.js`).

### Per Utenti Tecnici

4. 🏗️ **[Architettura Sistema](docs/ARCHITECTURE_IT.md)**
   - Design pattern e decisioni tecniche
   - Flusso elaborazione
   - API e integrazioni

5. 🧪 **[Testing e Debug](docs/TROUBLESHOOTING_IT.md)**
   - Test unitari e integrazione
   - Troubleshooting scenari comuni
   - Performance monitoring

6. 🔒 **[Sicurezza e Privacy](docs/SECURITY_IT.md)**
   - Gestione dati sensibili
   - Conformità GDPR
   - Backup e disaster recovery

---

## 🎯 Quick Start (5 Minuti)

**Solo per avere un'idea del sistema in azione:**

```javascript
// 1. Apri Google Apps Script (script.google.com)
// 2. Crea nuovo progetto
// 3. Copia questo codice di test

function testQuickDemo() {
  // Simula una richiesta
  const emailTest = {
    subject: "Orari messe",
    body: "Buongiorno, vorrei sapere gli orari delle messe domenicali. Grazie",
    from: "mario.rossi@example.com"
  };
  
  // Classifica la richiesta
  const classifier = new Classifier();
  const result = classifier.classifyEmail(emailTest.subject, emailTest.body);
  
  console.log("Tipo richiesta:", result.category);
  console.log("Richiede risposta?", result.shouldReply);
  console.log("Lingua rilevata:", result.language);
}

// Esegui questa funzione per vedere la classificazione in azione
```

---

## 🌟 Caratteristiche Uniche

### 🧠 Intelligenza Pastorale

Il sistema **non è un semplice chatbot**. Distingue tra:

- **Richieste burocratiche** → Tono efficiente e chiaro
- **Situazioni pastorali** → Tono empatico, suggerisce colloquio con sacerdote
- **Dubbi dottrinali** → Risponde con riferimenti al Catechismo, Magistero

**Esempio reale:**
```
Email: "Sono divorziato e risposato civilmente, posso fare da padrino di cresima?"

Risposta AI: "La ringrazio per la fiducia. La situazione di chi è divorziato 
e risposato civilmente necessita di un discernimento pastorale personalizzato.
Le consiglio di parlarne direttamente con don Marco chiamando al 06-1234567 
o passando in segreteria. Saremo lieti di accompagnarla."
```

### 🌍 Multilingua Nativo

- **Rilevamento automatico** della lingua (IT/EN/ES/FR/DE)
- **Risposta nella stessa lingua** dell'email ricevuta
- **Nessuna configurazione manuale** necessaria

### 🗺️ Verifica Territorio Automatica

```
Email: "Abito in Via Flaminia 150, rientro nella vostra parrocchia?"

Sistema: 
1. Estrae "Via Flaminia 150"
2. Verifica nel database territorio
3. Risponde: "Sì, Via Flaminia dal 109 al 217 (dispari) rientra nel 
   nostro territorio. Saremo lieti di accoglierla!"
```

### 🔄 Memoria Conversazionale

Il sistema **ricorda** le conversazioni precedenti:
- Non ripete informazioni già fornite
- Adatta il saluto (primo contatto vs follow-up)
- Mantiene il contesto della discussione

### 🛡️ Logiche di Sicurezza e Anti-Loop

Il sistema implementa protocolli rigorosi per garantire risposte pertinenti ed evitare ripetizioni:
- **Filosofia Fail-Closed**: In caso di incertezza sulla necessità di rispondere, il sistema privilegia il silenzio per evitare di disturbare l'utente con messaggi non necessari o ripetitivi.
- **Controllo "Last Speaker"**: Prima di ogni elaborazione, il bot verifica chi ha inviato l'ultimo messaggio nel thread. Se l'ultimo messaggio è già della segreteria (o del bot), l'elaborazione si ferma, evitando loop infiniti.
- **Rilevamento No-Reply avanzato**: Filtra automaticamente le email provenienti da sistemi automatizzati analizzando sia l'indirizzo che il nome del mittente.

### ⚙️ Safety Valve Automatica

Se l'API usage supera l'80%, il sistema:
- ⚡ Riduce automaticamente il numero di email processate
- 📊 Invia alert al gestore
- 🔄 Si adatta senza interrompere il servizio

---

## 🛡️ Sicurezza e Privacy

### Conformità GDPR

- ✅ **Nessun dato salvato su server esterni** (tutto su Google Workspace)
- ✅ **Nessuna email inviata a terzi** per training AI
- ✅ **Memoria conversazionale cancellabile** in qualsiasi momento
- ✅ **Audit log completo** di tutte le operazioni

### Controllo Qualità Multi-Livello

Ogni risposta viene **validata automaticamente** prima dell'invio:

1. ✅ Lunghezza appropriata (né troppo corta né prolissa)
2. ✅ Lingua corretta (IT/EN/ES/FR/DE)
3. ✅ Assenza di "allucinazioni" (dati inventati)
4. ✅ Tono professionale ma caloroso
5. ✅ Firma presente
6. ✅ Nessuna informazione sensibile esposta

**Se una sola validazione fallisce:** Email etichettata "Verifica" per controllo umano.

---

## 🆘 Supporto

### Problemi Comuni

**Q: Il sistema non risponde alle email**
```
Verifica:
1. Il trigger è attivo? (Trigger → deve esserci "processEmailsMain" ogni 5 min)
2. Orario di lavoro configurato? (Sistema si sospende fuori orari ufficio)
3. Controlla Esecuzioni → cerca errori
```

**Q: Risposte in lingua sbagliata**
```
Causa: Email con parole miste
Soluzione: Sistema usa "prevalenza linguistica". Se email ha 
          "Grazie" e "Thank you", conta quale lingua è più presente.
```

**Q: Troppe email marcate "Verifica"**
```
Causa: Soglia validazione troppo alta
Soluzione: In gas_config.js, cambia VALIDATION_MIN_SCORE da 0.6 a 0.5
```

### Contatti

- 📧 **Email:** info@parrocchiasanteugenio.it
- 📚 **Wiki:** [Documentazione Completa](docs/)

---

## 🤝 Contribuire

Questo progetto è **open source** e accoglie contributi da:
- 👨‍💻 **Developer** → Miglioramenti codice, nuove feature
- ⛪ **Operatori pastorali** → Feedback su tono risposte, casi d'uso
- 🌍 **Traduttori** → Supporto nuove lingue
- 📚 **Documentatori** → Guide, tutorial, esempi
- 🐛 **Tester** → Segnalazione bug

Leggi [CONTRIBUTING_IT.md](docs/CONTRIBUTING_IT.md) per i dettagli.

---

## 📜 Licenza

Questo progetto è rilasciato sotto licenza **MIT** - vedi [LICENSE](LICENSE).

**In pratica:** Puoi usarlo, modificarlo, condividerlo liberamente anche per scopi commerciali. Chiediamo solo di citare il progetto originale.

---

## 🙏 Ringraziamenti

Sviluppato con ❤️ per le comunità parrocchiali da volontari e professionisti.

**Ringraziamenti speciali a:**
- Parrocchia Sant'Eugenio (Roma) - Beta testing e feedback
- Google AI Team - Gemini API
- Tutti i contributori open source

---

## 📈 Roadmap

**Idee future:**
- [x] OCR allegati (PDF e immagini) - **IMPLEMENTATO v2.5**
- [ ] Integrazione calendario Google per prenotazioni
- [ ] SMS notifications per urgenze
- [ ] App mobile per gestione segreteria
- [ ] Dashboard web per statistiche
- [ ] Integrazione WhatsApp Business

---

## ⭐ Stella il Progetto!

Se questo sistema è utile per la tua parrocchia, lascia una ⭐ su GitHub!
Aiuta altre comunità a scoprirlo.

---

## 📖 Glossario Termini Tecnici

| Termine | Definizione | Esempio |
|---------|-------------|---------|
| **RPM** | Requests Per Minute - Richieste API al minuto | 10 RPM = max 10 chiamate/min |
| **TPM** | Tokens Per Minute - Token consumati al minuto | 250k TPM = budget generoso |
| **RPD** | Requests Per Day - Richieste giornaliere | 250 RPD = ~10/ora in 24h |
| **KB** | Knowledge Base - Database informazioni | "Orari messe: 18:00" |
| **DRY_RUN** | Modalità test senza invio email | `CONFIG.DRY_RUN = true` |
| **Salutation Mode** | Tipo saluto (full/soft/none) | `full` = primo contatto |
| **Thinking Leak** | AI espone ragionamento interno | "Rivedendo la KB..." ❌ |
| **ReDoS** | Regex Denial of Service - Attacco regex | `(a+)+b` con `aaaa...c` |
| **Safety Valve** | Riduzione automatica carico se quota >80% | Previene esaurimento quota |
| **Label** | Etichetta Gmail per categorizzare email | "IA", "Verifica", "Errore" |

---

**[English Version](README.md)** | **[Troubleshooting](docs/TROUBLESHOOTING_IT.md)** | **[Deployment](docs/DEPLOYMENT_IT.md)** | **[Architettura](docs/ARCHITECTURE_IT.md)**