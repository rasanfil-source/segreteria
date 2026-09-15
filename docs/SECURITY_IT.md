# 🔐 Sicurezza e Conformità GDPR

[![English Version](https://img.shields.io/badge/English-Version-blue?style=flat-square)](SECURITY.md)

> **Guida alle best practices di sicurezza e alla protezione dei dati personali per la Segreteria Email Parrocchiale**

---

## 🛡️ Principi Fondamentali

La sicurezza dei dati e la protezione della privacy sono priorità assolute, specialmente in un contesto pastorale che gestisce informazioni sensibili.

### I 3 Pilastri della Sicurezza

1.  **Minimizzazione dei Dati**: Raccogliere ed elaborare solo ciò che è strettamente necessario.
2.  **Privacy by Design**: La protezione dei dati è integrata nell'architettura del sistema.
3.  **Trasparenza**: Chiarezza su come l'IA elabora le informazioni.

---

## 🇪🇺 Conformità GDPR

Il sistema è stato progettato per aiutare la parrocchia a rispettare il Regolamento Generale sulla Protezione dei Dati (GDPR).

### 1. Trattamento dei Dati Personali

| Tipo di Dato | Come viene trattato | Base Giuridica |
|--------------|---------------------|----------------|
| **Email Mittente** | Usata solo per inviare la risposta e verificare la cronologia. | Legittimo Interesse (rispondere alla richiesta) |
| **Contenuto Email** | Analizzato da Gemini AI per generare la risposta. **Non** usato per addestramento modelli. | Legittimo Interesse / Consenso Implicito |
| **Dati Sensibili** | Le istruzioni indirizzano le situazioni delicate al parroco quando appropriato. La memoria conversazionale può conservare sintesi e flag contestuali, anche relativi a lutto, situazioni canoniche o impedimenti personali. La durata effettiva è descritta sotto; i flag non hanno una scadenza autonoma. | Protezione speciale (Art. 9 GDPR) |

### 2. Nessun Addestramento su Dati Utente

Google garantisce che i dati inviati tramite l'API Gemini (Vertex AI / Google AI Studio) nelle versioni a pagamento/enterprise (e con le dovute impostazioni di privacy attive):
-   **NON** vengono utilizzati per addestrare i modelli fondazionali.
-   **NON** vengono accessibili a revisori umani.
-   Vengono conservati solo per il tempo necessario all'elaborazione.

### 3. Diritto all'Oblio (Cancellazione)

Il software offre questi strumenti di cancellazione della memoria:
1.  **Memoria conversazionale**: `cleanupOldMemory` elimina il contenuto delle righe con `lastUpdated` più vecchio di 30 giorni. Gli aggiornamenti della memoria rinnovano questa data: una conversazione attiva può conservare sintesi e flag per più di 30 giorni. Non è una scadenza calcolata dall'origine di ogni informazione. L'eliminazione avviene quando il cleanup viene eseguito con successo, non esattamente al trentesimo giorno; occorre verificare che il trigger previsto sia installato e funzionante.
2.  **Date anomale**: per `lastUpdated` mancante, illeggibile o futuro, il cleanup registra la prima osservazione in una nota tecnica della cella F (`AG_MEMORY_RETENTION_V1`). Conserva la riga per un ulteriore periodo di 30 giorni dalla rilevazione, poi la elimina alla prima esecuzione utile. Non modifica la data dell'interazione. Un aggiornamento valido torna a governare la scadenza; se la nota tecnica manca o è corrotta, l'osservazione riparte. Non cancellare queste note durante la manutenzione ordinaria.
3.  **Portata del cleanup**: svuota le colonne A:J delle righe scadute e invalida le relative cache conosciute. Non sposta le righe conservate e non elimina email Gmail, revisioni del foglio, backup, note manuali o dati esterni alla tabella. La nota tecnica non contiene il messaggio né entra nel prompt. Eventuali note manuali con dati personali richiedono gestione separata.
4.  **Cancellazione manuale**: è possibile cancellare le righe di `ConversationMemory`; intervenire anche sulle eventuali copie e cache pertinenti. Una modifica manuale del foglio non richiama automaticamente l'invalidazione della cache del software.

La perdita di una riga elimina insieme sintesi, argomenti già trattati, flag e stato dei vincoli di presenza. I successivi turni possono quindi perdere continuità o ripetere indicazioni; la cancellazione non prova che una difficoltà personale sia risolta. Il cleanup non modifica istruzioni, modelli o budget AI. Queste sono caratteristiche tecniche del software, non una certificazione della conformità dell'installazione.

---

## 🔒 Best Practices di Sicurezza

### 1. Gestione delle API Key

L'API Key di Gemini è la chiave di volta del sistema.

-   ✅ **USARE** `ScriptProperties` per memorizzarla.
-   ❌ **NON** scrivere mai la chiave direttamente nel codice (`.gs` files).
-   ❌ **NON** committare mai file contenenti API key su GitHub.

**Come configurare in sicurezza:**
Vedi la guida `DEPLOYMENT_IT.md` sezione "Sicurezza Produzione".

### 2. Accesso ai Fogli Google

Il foglio di calcolo funge da database e Knowledge Base.

-   **Accesso Limitato**: Condividi il foglio **solo** con l'account che esegue lo script e gli amministratori strettamente necessari (es. Parroco, Segretaria).
-   **Separare KB e memoria**: non inserire dati personali dei parrocchiani nella KB condivisa (`Istruzioni`). `ConversationMemory` contiene dati delle conversazioni, anche sensibili: limitarne accesso, contenuto e conservazione; non aggiungere dettagli personali superflui o note manuali sensibili.
-   **Log**: Google Sheets mantiene una cronologia delle modifiche che funge da audit log.

### 3. Log e Monitoraggio

-   **Log Mascherati**: Il sistema è configurato per non loggare contenuti sensibili delle email nei log di Apps Script, ma solo metadati (ID messaggio, categoria, status).
-   **Audit Trail**: Mantenere traccia di chi ha accesso allo script e al foglio di calcolo.

---

## 🚨 Incident Response (Cosa fare se...)

### Compromissione API Key
Se sospetti che la tua API Key sia stata esposta:
1.  Vai su Google AI Studio / Google Cloud Console.
2.  **Revoca/Elimina** immediatamente la vecchia chiave.
3.  Genera una nuova chiave.
4.  Aggiorna le `ScriptProperties` nel progetto Apps Script.

### Accesso Non Autorizzato
Se un account non autorizzato ha avuto accesso al foglio o alla mail:
1.  Cambia immediatamente la password dell'account Google parrocchiale.
2.  Verifica nelle impostazioni di condivisione del Drive chi ha accesso ai file.
3.  Controlla i log di accesso di Google Workspace (se disponibile).

---

## 📝 Disclaimer Legale

*Il presente software "Segreteria Email Parrocchiale" è uno strumento di supporto. L'utilizzo dell'Intelligenza Artificiale non sostituisce la responsabilità umana nella gestione dei dati e delle relazioni pastorali. L'amministratore del sistema (la Parrocchia) rimane il Titolare del Trattamento dei Dati e deve assicurarsi di informare i fedeli tramite l'informativa privacy parrocchiale adeguata.*
