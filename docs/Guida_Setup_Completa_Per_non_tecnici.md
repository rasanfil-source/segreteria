# 📖 Guida Setup Completa - Segreteria Email AI

[![English Version](https://img.shields.io/badge/English-Version-blue?style=flat-square)](Setup_Guide_Non_Technical.md)

> **Tempo necessario:** 20-30 minuti  
> **Competenze richieste:** Nessuna (seguire i passaggi)  
> **Costo:** Gratuito (entro i limiti del piano gratuito)

---

## 🎯 Cosa Otterrai

Al termine di questa guida avrai un sistema che:
- ✅ Risponde automaticamente alle email semplici 24/7
- ✅ Gestisce richieste in italiano, inglese, spagnolo
- ✅ Verifica automaticamente se un indirizzo è nel territorio parrocchiale
- ✅ Marca le email che necessitano attenzione umana
- ✅ Mantiene memoria delle conversazioni

---

## 📋 Checklist Prerequisiti

Prima di iniziare, assicurati di avere:

- [ ] **Account Gmail della parrocchia** (es. `info@santagata.org`)
  - Deve essere Gmail o Google Workspace
  - Devi avere accesso completo (username + password)
  
- [ ] **30 minuti di tempo** senza interruzioni

- [ ] **Computer** (Windows, Mac o Linux)

- [ ] **Carta di credito** per API Gemini (anche prepagata va bene)
  - Necessaria per attivare API, anche se c'è quota gratuita
  - Addebito solo dopo aver superato €0 (primi 60 usi gratis)

**✋ IMPORTANTE:** Non serve saper programmare!

---

## Fase 1: Ottenere l'API Key di Google Gemini

### Passo 1.1: Accedi a Google AI Studio

1. Vai su: https://aistudio.google.com/
2. Clicca **"Accedi"** (in alto a destra)
3. Usa l'account Gmail della **parrocchia** (NON il tuo personale)

### Passo 1.2: Crea il progetto

1. Nella homepage, cerca il menu a sinistra
2. Clicca su **"Get API Key"**
3. Si aprirà una finestra → Clicca **"Create API Key in new project"**
4. Google creerà automaticamente un progetto (nome: "Generative Language Client")

### Passo 1.3: Copia l'API Key

1. Apparirà una stringa tipo: `AIzaSyD...XYZ123`
2. **COPIA** questa chiave (pulsante copia a fianco)
3. **INCOLLA** in un file di testo sul desktop (lo userai dopo)

**⚠️ SICUREZZA:** 
- Questa chiave è come una password
- NON condividerla
- NON pubblicarla online
- Se la perdi, puoi generarne una nuova

**💰 Costi API Gemini:**
- Primi **60 richieste/minuto** → GRATIS
- Oltre 60/minuto → ~€0.001 per richiesta
- Una parrocchia media (100 email/settimana) = **~€5-10/mese**

---

## Fase 2: Preparare i Fogli Google (Knowledge Base)

### Passo 2.1: Crea il foglio principale

1. Vai su https://docs.google.com/spreadsheets
2. Clicca **"Vuoto"** (nuovo foglio)
3. Rinomina il foglio in: **"ParrocchiaAI - Knowledge Base"**

### Passo 2.2: Crea i 4 fogli necessari

**Nel foglio che hai appena creato:**

1. In basso vedi tab "Foglio1" → **Rinominalo in:** `Istruzioni`
2. Clicca **+** (in basso a sinistra) per aggiungere un nuovo foglio
3. Rinominalo in: `AI_CORE_LITE`
4. Aggiungi ancora 2 fogli:
   - `AI_CORE`
   - `Dottrina`

**Risultato finale (4 tab in basso):**
```
Istruzioni | AI_CORE_LITE | AI_CORE | Dottrina
```

### Passo 2.3: Popola il foglio "Istruzioni"

**Nel foglio `Istruzioni`, inserisci nella prima riga:**

| A | B | C |
|---|---|---|
| Categoria | Informazione | Dettagli |

**Nelle righe successive, aggiungi le informazioni della tua parrocchia:**

Esempio:

| Categoria | Informazione | Dettagli |
|-----------|--------------|----------|
| Orari Messe Feriali | Inverno | Lunedì-Sabato ore 18:00 |
| Orari Messe Feriali | Estate | Lunedì-Sabato ore 19:00 |
| Orari Messe Festive | Inverno | Sabato 18:00, Domenica 8:30, 10:00, 11:30, 18:00 |
| Orari Messe Festive | Estate | Sabato 19:00, Domenica 8:30, 10:00, 11:30, 19:00 |
| Contatti | Telefono | 06-12345678 |
| Contatti | Email | info@parrocchiaexample.it |
| Contatti | Indirizzo | Via Roma 10, 00100 Roma |
| Orari Segreteria | Lun-Ven | 9:00-12:00, 16:00-18:00 |
| Battesimo | Documenti | Certificato nascita, stato famiglia, modulo richiesta |
| Battesimo | Corso | Primo sabato del mese ore 16:00 |

**💡 SUGGERIMENTO:** Puoi aggiungere tutte le info che vuoi! Più informazioni = risposte più precise.

### Passo 2.4: Popola i fogli AI_CORE

**Questi fogli contengono le "istruzioni pastorali" per l'AI.**

> **💡 Quando il sistema usa ogni foglio?**
> - **AI_CORE_LITE** → Usato per tutte le richieste con aspetti pastorali/dottrinali (la maggior parte delle email)
> - **AI_CORE** → Usato SOLO per situazioni complesse: lutti, questioni canoniche, divorziati risposati, malattie gravi
> 
> Il sistema seleziona automaticamente il livello giusto in base all'analisi del contenuto dell'email.

Nel foglio **`AI_CORE_LITE`** inserisci:

| Principio | Istruzione |
|-----------|-----------|
| Tono | Usa sempre un tono professionale ma caloroso |
| Firma | Firma sempre con "Segreteria Parrocchia [Nome Parrocchia]" |
| Riferimenti | Se qualcuno chiede un colloquio personale, suggerisci di chiamare o venire in segreteria |

Nel foglio **`AI_CORE`** (per situazioni più complesse):

| Principio | Istruzione |
|-----------|-----------|
| Situazioni delicate | Per divorziati risposati, conviventi, situazioni pastorali complesse: NON dare giudizi, invita a parlare con il parroco |
| Urgenze | Per lutti, malattie gravi: rispondi con empatia e fornisci subito contatti diretti |
| Dubbi dottrinali | Puoi spiegare la dottrina in modo semplice, citando il Catechismo quando possibile |

**📝 NOTA:** Puoi personalizzare queste istruzioni secondo lo stile della tua parrocchia!

### Passo 2.5: Salva l'ID del foglio

1. Guarda l'URL del foglio (barra indirizzi)
2. Sarà tipo: `https://docs.google.com/spreadsheets/d/`**`1ABC...XYZ789`**`/edit`
3. La parte **`1ABC...XYZ789`** è l'**ID del foglio**
4. **COPIALO** e salvalo nel file di testo (insieme all'API Key)

---

## Fase 3: Creare il Progetto Google Apps Script

### Passo 3.1: Apri Apps Script

1. Vai su: https://script.google.com
2. Accedi con l'account Gmail della parrocchia
3. Clicca **"Nuovo progetto"**

### Passo 3.2: Scarica i file del sistema

1. Richiedi i file del sistema all'amministratore (info@parrocchiasanteugenio.it)
2. Estrai lo ZIP sul desktop

### Passo 3.3: Carica i file nel progetto

**Ora devi copiare i file uno per uno:**

1. Nel progetto Apps Script, vedi `Codice.gs` → **Eliminalo** (icona cestino)
2. Clicca **+** (accanto a "File") → **Script**
3. Rinominalo in: `gas_config.js`
4. Apri il file `gas_config.js` (dalla cartella ZIP)
5. **Copia tutto** il contenuto
6. **Incolla** nel nuovo file `gas_config.js` in Apps Script

**Ripeti per TUTTI i file `.js`:**
- gas_main.js
- gas_classifier.js
- gas_email_processor.js
- gas_gemini_service.js
- gas_gmail_service.js
- gas_memory_service.js
- gas_prompt_engine.js
- gas_rate_limiter.js
- gas_response_validator.js
- gas_territory_validator.js
- gas_request_classifier.js
- gas_prompt_context.js
- gas_logger.js

**⏱️ Tempo:** 5-10 minuti per caricare tutti i file

### Passo 3.4: Configura le chiavi

Nel file **`gas_config.js`**, trova queste righe:

```javascript
GEMINI_API_KEY: 'YOUR_GEMINI_API_KEY_HERE',
SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID_HERE',
```

**Sostituisci:**
- `YOUR_GEMINI_API_KEY_HERE` → con l'API Key che hai copiato prima
- `YOUR_SPREADSHEET_ID_HERE` → con l'ID del foglio Google

**⚠️ IMPORTANTE:** Lascia gli apici `'` prima e dopo!

Esempio corretto:
```javascript
GEMINI_API_KEY: 'AIzaSyD...XYZ123',
SPREADSHEET_ID: '1ABC...XYZ789',
```

### Passo 3.5: Salva il progetto

1. Clicca sull'icona **disco** (in alto)
2. Rinomina il progetto in: **"ParrocchiaAI Sistema"**
3. Clicca **"Salva"**

---

## Fase 4: Configurare i Permessi

### Passo 4.1: Autorizza lo script

1. Nel menu in alto, trova la funzione (dropdown)
2. Seleziona: **`setupTrigger`**
3. Clicca **"Esegui"** (pulsante play ▶️)
4. Apparirà popup "Autorizzazione richiesta"
5. Clicca **"Esamina autorizzazioni"**
6. Scegli l'account Gmail parrocchia
7. Clicca **"Avanzate"** (in basso)
8. Clicca **"Vai a ParrocchiaAI Sistema (non sicuro)"**
9. Clicca **"Consenti"**

**❓ Perché "non sicuro"?**
Google mostra sempre questo per script personali. È normale! Il codice è sicuro (puoi leggerlo).

### Passo 4.2: Verifica funzionamento

1. Cambia funzione in: **`healthCheck`**
2. Clicca **"Esegui"** ▶️
3. Guarda "Registro esecuzioni" (in basso)
4. Devi vedere: `status: "OK"` per tutti i componenti

**Se vedi errori:**
- Controlla che API Key e Spreadsheet ID siano corretti
- Verifica che il foglio Google sia condiviso con l'account Gmail

---

## Fase 5: Configurazione Territorio (Opzionale ma Consigliato)

Se vuoi che il sistema verifichi automaticamente gli indirizzi:

### Passo 5.1: Trova il file territorio

1. Apri il file **`gas_territory_validator.js`**
2. Cerca `this.territory = {`

### Passo 5.2: Inserisci le vie della tua parrocchia

Esempio:
```javascript
this.territory = {
    'via roma': { tutti: true },  // Tutta Via Roma
    'via garibaldi': { dispari: [1, 99] },  // Solo numeri dispari da 1 a 99
    'piazza duomo': { pari: [2, 50] },  // Solo numeri pari da 2 a 50
}
```

**Sintassi:**
- `tutti: true` = Tutti i numeri civici
- `tutti: [10, 50]` = Solo numeri da 10 a 50 (pari e dispari)
- `dispari: [1, null]` = Numeri dispari da 1 a infinito
- `pari: [2, 100]` = Numeri pari da 2 a 100

### Passo 5.3: Salva

Clicca il pulsante **"Salva"** (icona disco)

---

## Fase 6: Test Funzionamento

### Passo 6.1: Invia email di test

1. Da un'altra email (NON quella della parrocchia)
2. Invia a: `info@tuaparrocchia.it`
3. Oggetto: `Test sistema AI`
4. Corpo: `Buongiorno, vorrei sapere gli orari delle messe festive. Grazie`

### Passo 6.2: Controlla risposta

3. Oltre 5-10 minuti (tempo del trigger):

1. Controlla inbox parrocchia
2. Dovresti vedere la risposta automatica
3. Email avrà etichetta "IA"

### Passo 6.3: Verifica in Apps Script

1. Vai in Apps Script
2. Menu sinistra → **"Esecuzioni"**
3. Dovresti vedere la funzione `main` eseguita
4. Status: **Completata** (se tutto ok)

**Se non funziona:**
- Controlla "Registro esecuzioni" per errori
- Verifica che l'email non sia stata filtrata come spam
- Assicurati che il trigger sia attivo (Menu → Trigger)

---

## Fase 7: Personalizzazioni Finali

### Passo 7.1: Configura orari di lavoro

Nel file **`gas_config.js`**, trova:

```javascript
WORKING_HOURS_START: 9,  // Ora inizio (24h)
WORKING_HOURS_END: 18,   // Ora fine (24h)
```

**Modifica** con gli orari della tua segreteria.

**💡 Cosa fa:** Il sistema può essere configurato per sospendersi durante questi orari (quando lo staff umano è disponibile a rispondere). Fuori da questi orari e nelle festività, l'AI risponde sempre.

### Passo 7.2: Configura lingue supportate

Nel file **`gas_config.js`**:

```javascript
LANGUAGES_SUPPORTED: ['it', 'en', 'es'],
DEFAULT_LOCALE: 'it'
```

**Aggiungi/rimuovi** lingue secondo necessità:
- `it` = Italiano
- `en` = Inglese
- `es` = Spagnolo
- `fr` = Francese
- `de` = Tedesco

### Passo 7.3: Personalizza firma

Nel file **`gas_gmail_service.js`**, cerca:

```javascript
const signature = `
Cordiali saluti,
Segreteria Parrocchia Sant'Eugenio
`;
```

**Sostituisci** con il nome della tua parrocchia.

---

## 🎉 Congratulazioni!

Il sistema è attivo! 

### Cosa Succede Ora

**Ogni 5 minuti**, il sistema:
1. ✅ Controlla email non lette
2. ✅ Filtra spam e email automatiche
3. ✅ Classifica le richieste
4. ✅ Consulta la Knowledge Base
5. ✅ Genera e invia risposte

### Etichette Gmail

Verifica che nel tuo Gmail siano apparse queste etichette:
- 🟢 **IA** → Email con risposta automatica inviata
- 🟡 **Verifica** → Email elaborate ma da controllare
- 🔴 **Errore** → Email con problemi tecnici

---

## 📊 Monitoraggio

### Controlla statistiche

**Ogni settimana**, esegui:

1. Vai in Apps Script
2. Seleziona funzione: `showQuotaDashboard`
3. Clicca **"Esegui"**
4. Guarda "Registro esecuzioni"

Vedrai:
- Numero email processate
- Token API usati
- Email filtrate vs inviate

### Esempi email elaborate

Per vedere esempi di email a cui il sistema ha risposto:

1. In Gmail, clicca etichetta **"IA"**
2. Apri qualche conversazione
3. Verifica qualità risposte

**Se vedi risposte non appropriate:**
- Aggiungi info mancanti in Knowledge Base
- Personalizza istruzioni in AI_CORE
- Segnala il caso per migliorare il sistema

---

## 🆘 Problemi Comuni

### "Email non elaborate"

**Causa:** Trigger non attivo

**Soluzione:**
1. Apps Script → Menu → **Trigger**
2. Verifica che ci sia `main` ogni 5 minuti
3. Se manca, esegui di nuovo `setupTrigger`

### "Risposta in lingua sbagliata"

**Causa:** Email con parole di più lingue

**Soluzione:**
Nel file **`gas_config.js`**, trova:
```javascript
LANGUAGE_CONFIDENCE_THRESHOLD: 0.7
```
Abbassalo a `0.6` se necessario.

### "Troppe email 'Verifica'"

**Causa:** Soglia validazione troppo alta

**Soluzione:**
Nel file **`gas_config.js`**:
```javascript
VALIDATION_MIN_SCORE: 0.5  // Era 0.6
```

### "API Quota Superata"

**Causa:** Troppo traffico email

**Soluzione:**
1. Controlla costi in: https://console.cloud.google.com/billing
2. Se necessario, riduci `MAX_EMAILS_PER_RUN` in Config
3. Oppure aumenta budget API

---

## 📞 Supporto

**Hai bisogno di aiuto?**

- 📧 Email: info@parrocchiasanteugenio.it

**Prima di scrivere:**
- Controlla questa guida
- Guarda "Problemi Comuni" (sopra)
- Esegui `healthCheck` e copia il risultato

---

## 🚀 Prossimi Passi

Ora che il sistema è attivo:

1. **Popola Knowledge Base** con tutte le info della parrocchia
2. **Monitora risposte** (etichetta "IA") per i primi giorni
3. **Affina istruzioni** in AI_CORE per migliorare tono
4. **Condividi feedback** con la community

**Buon lavoro! 🙏**