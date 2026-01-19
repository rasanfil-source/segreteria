# exnovoGAS: Segreteria Parrocchiale AI

[![Language: EN](https://img.shields.io/badge/Language-English-blue?style=flat-square)](README.md) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

Un sistema di autorisponditore intelligente per Gmail, progettato specificamente per le Segreterie Parrocchiali. Basato su Google Apps Script e Google Gemini AI, gestisce le email in arrivo con sensibilità pastorale, accuratezza dottrinale ed efficienza operativa.

## Panoramica

**exnovoGAS** è più di un semplice autorisponditore. È un assistente guidato dall'AI che:
*   **Filtra** le email in arrivo per identificare cosa richiede risposta.
*   **Classifica** le richieste (Sacramenti, Appuntamenti, Supporto pastorale, ecc.).
*   **Consulta** una Knowledge Base dinamica (Google Sheets).
*   **Genera** risposte contestualmente appropriate usando Gemini 2.5 Flash.
*   **Valida** le risposte per tono, sicurezza e allucinazioni.
*   **Impara** dallo storico della conversazione per evitare domande ripetitive ("ascolto attivo").

## Funzionalità Chiave

*   **🧠 RAG Avanzato (Retrieval-Augmented Generation):** Recupera dati in tempo reale da Google Sheets (orari Messe, eventi, dottrina).
*   **🛡️ Validazione Multi-Livello:** Ogni risposta AI riceve un punteggio di qualità. Se la confidenza è bassa, l'email viene etichettata per revisione umana.
*   **✝️ Core Pastorale:** Logica speciale per distinguere tra richieste burocratiche (certificati) e bisogni pastorali (supporto spirituale), adattando il tono di conseguenza.
*   **📍 Validazione Territoriale:** Controlla automaticamente se un indirizzo appartiene al territorio parrocchiale tramite pattern matching.
*   **🗓️ Consapevolezza Liturgica:** Adatta saluti e contenuti in base al Tempo Liturgico (Avvento, Quaresima, Pasqua, Tempo Ordinario).
*   **🚀 Rate Limiting:** Gestione intelligente delle quote API Gemini (RPM, RPD, TPM) con strategie di fallback automatico.

## Installazione

1.  **Clona il Repository:**
    ```bash
    git clone https://github.com/tuousername/exnovoGAS.git
    ```
2.  **Push su Google Apps Script:**
    Usando [clasp](https://github.com/google/clasp):
    ```bash
    clasp login
    clasp create --type standalone --title "exnovoGAS"
    clasp push
    ```
3.  **Configura Proprietà dello Script:**
    Nell'Editor GAS -> Impostazioni Progetto -> Proprietà Script:
    *   `GEMINI_API_KEY`: La tua API Key Google Gemini.
    *   `SPREADSHEET_ID`: ID del Google Sheet che funge da Knowledge Base.
4.  **Imposta Trigger:**
    Esegui la funzione `setupTrigger()` una volta per inizializzare il trigger temporale (ogni 10 min).

## Documentazione

*   [**Architettura**](ARCHITECTURE_IT.md): Analisi approfondita del design del sistema, moduli e flussi dati.
*   [**Changelog**](CHANGELOG_IT.md): Storico degli aggiornamenti e miglioramenti.
*   [**Contribuire**](CONTRIBUTING_IT.md): Linee guida per inviare PR e segnalare bug.

## Licenza

Questo progetto è rilasciato sotto licenza MIT - vedi il file [LICENSE](LICENSE) per i dettagli.
