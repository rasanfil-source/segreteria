# Changelog

Modifiche significative a questo progetto saranno documentate in questo file.

## [2.3.9] - 2026-01-19

### Modificato
- Rifattorizzata la logica di `EmailProcessor.gs` per maggiore modularità e sicurezza thread.
- Potenziato `PromptEngine.gs` con supporto test migliorato.
- Configurate impostazioni predefinite sanitizzate per il rilascio pubblico.
- Espansa la copertura dei test unitari (`gas_unit_tests.js`).

### Corretto
- Risolto bug critico in `gas_rate_limiter.js` riguardante i cicli di refresh della cache.
- Corretta logica booleana in `gas_gemini_service.js` per i controlli rapidi.

## [2.3.8] - 2026-01-17

### Sicurezza
- Rafforzati i pattern regex in `ResponseValidator` contro attacchi ReDoS.
- Aggiunto controllo tipi rigoroso per input API.

### Modificato
- Implementato meccanismo "Safety Valve" per limitare richieste se quota API > 80%.
- Aggiornato logging al formato strutturato JSON per migliore osservabilità.

## [2.3.6] - 2026-01-15

### Aggiunto
- Supporto nativo per modello Gemini 2.5 Flash.
- Gestione dinamica ferie tramite integrazione Google Sheets.
- Ascolto Attivo 2.0: Previene che l'AI faccia domande già risposte nel thread email.

### Corretto
- Risolto problema con la regola "virgola seguita da maiuscola" nella grammatica italiana.
