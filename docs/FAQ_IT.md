# ❓ Domande Frequenti (FAQ)

[![English Version](https://img.shields.io/badge/English-Version-blue?style=flat-square)](FAQ.md)

> **Risposte alle domande più comuni per utenti non tecnici e amministratori**

---

## 👥 Sezione per Non Tecnici (Parroci, Segretarie)

### 1. Il sistema sostituisce la segretaria umana?
**No.** Il sistema è un *assistente*. Si occupa delle domande ripetitive (orari, certificati, indirizzi) per liberare tempo prezioso alla segreteria umana, che potrà dedicarsi all'ascolto e alle situazioni complesse.

### 2. E se l'IA sbaglia risposta?
Il sistema ha un controllo interno ("autovalutazione"). Se non è sicuro della risposta, non la invia ma la salva nella cartella **"Verifica"** di Gmail. Un umano dovrà controllare quella cartella e rispondere manualmente.

### 3. Come faccio a insegnargli cose nuove?
Basta scrivere l'informazione nel Foglio Google (Knowledge Base). Ad esempio, se cambiano gli orari delle messe, basta aggiornare il foglio "Istruzioni" e il sistema userà subito i nuovi orari. Non serve toccare il codice.

### 4. Può gestire gli allegati?
**Sì e No.** Il sistema **LEGGE** il contenuto di allegati PDF e immagini (scontrini, documenti, IBAN) grazie all'OCR integrato, usandoli per capire meglio la richiesta. Tuttavia, risponde sempre e solo con **testo**. Se deve inviare un modulo, manda il link per scaricarlo.

### 5. Risponde a tutti? Anche allo spam?
No. Il sistema ha filtri intelligenti. Ignora newsletter, pubblicità e spam. Risponde solo a email che sembrano scritte da persone reali con richieste legittime.

### 6. Cosa succede se qualcuno scrive cose offensive o strane?
Il sistema cerca di rispondere con cortesia se possibile, ma se la richiesta è inappropriata o fuori contesto, la classifica come tale e la lascia alla gestione umana.

### 7. Risponde di notte?
Dipende da come è configurato. Di default, per sembrare più "umano", può essere impostato per non rispondere di notte o mettere in pausa le risposte fino alla mattina dopo. Tuttavia, tecnicamente può rispondere 24/7 se desiderato.

---

## 💻 Sezione Tecnica (Amministratori System)

### 1. Come aggiorno lo script?
Se usi l'integrazione GitHub, fai un `git pull` e poi `clasp push`. Altrimenti, copia il codice aggiornato nell'editor di Apps Script. **Attenzione**: non sovrascrivere `gas_config.js` se contiene le tue personalizzazioni.

### 2. Cosa succede se finisce la quota API Gemini?
Il sistema smetterà di rispondere e loggerà l'errore. Puoi monitorare la quota su Google Cloud Console. Consigliamo di impostare un alert. Se succede, il sistema riprenderà il giorno dopo al reset della quota.

### 3. Come funziona la cache della Knowledge Base?
Per risparmiare letture su Sheet e velocizzare, la KB viene salvata in `CacheService` per 6 ore. In più, ad ogni caricamento viene confrontato il `modifiedTime` del file Spreadsheet: se il foglio è stato aggiornato dopo l'ultimo caricamento (`lastLoadedAt`), la cache viene invalidata selettivamente e le risorse vengono rilette subito.

### 4. Posso usare un modello diverso da Gemini?
Il sistema è costruito modularmente attorno all'SDK di Google Vertex AI / Gemini. Cambiare provider (es. OpenAI) richiederebbe di riscrivere la classe `GeminiService`. Cambiare *versione* di Gemini (es. da `flash` a `pro`) è facilissimo: basta cambiare una costante in `gas_config.js`.

### 5. Dove vedo i log di errore?
Nella dashboard di Apps Script sotto "Esecuzioni". Il sistema usa anche `console.error` che viene catturato da StackDriver (Google Cloud Logging) se associato a un progetto GCP standard.

### 6. Come gestisce la concorrenza?
Usa `LockService` per evitare che due esecuzioni simultanee rispondano alla stessa email. Inoltre, usa un meccanismo di "Optmistic Locking" per la memoria conversazionale su Sheet per evitare sovrascritture.

### 7. È possibile testare le modifiche senza inviare email reali?
Sì. Imposta `DRY_RUN: true` in `gas_config.js`. Il sistema farà tutto (lettura, ragionamento, generazione bozza risposta) ma **non invierà** l'email finale, scrivendo invece nei log cosa avrebbe fatto.
