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
| **Dati Sensibili** | Il sistema è istruito a rimandare al parroco situazioni sensibili (salute, situazioni familiari) senza memorizzarle permanentemente. | Protezione speciale (Art. 9 GDPR) |

### 2. Nessun Addestramento su Dati Utente

Google garantisce che i dati inviati tramite l'API Gemini (Vertex AI / Google AI Studio) nelle versioni a pagamento/enterprise (e con le dovute impostazioni di privacy attive):
-   **NON** vengono utilizzati per addestrare i modelli fondazionali.
-   **NON** vengono accessibili a revisori umani.
-   Vengono conservati solo per il tempo necessario all'elaborazione.

### 3. Diritto all'Oblio (Cancellazione)

Per garantire il diritto alla cancellazione:
1.  **Memoria Conversazionale**: Il sistema include una funzione di pulizia automatica (`cleanupOldMemory`) che elimina i dati delle conversazioni vecchie (default: 30 giorni).
2.  **Cancellazione Manuale**: È possibile cancellare manualmente righe dal foglio `ConversationMemory` se un utente ne fa richiesta.

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
-   **Nessun dato sensibile nella KB**: Non inserire mai nomi, cognomi, numeri di telefono privati o indirizzi di parrocchiani nel foglio `Istruzioni` o `ConversationMemory`.
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
