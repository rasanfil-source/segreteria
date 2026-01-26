# Contribuire a exnovoGAS

[![Language: EN](https://img.shields.io/badge/Language-English-blue?style=flat-square)](CONTRIBUTING.md)

Grazie per il tuo interesse nel contribuire a exnovoGAS! Accogliamo contributi da sviluppatori, operatori pastorali e chiunque sia interessato all'intersezione tra fede e tecnologia.

## Come Contribuire

1.  **Forka il Repository**
2.  **Crea un Branch Feature** (`git checkout -b feature/NuovaFunzionalita`)
3.  **Committa le Modifiche** (`git commit -m 'Aggiunta NuovaFunzionalita'`)
4.  **Pusha sul Branch** (`git push origin feature/NuovaFunzionalita`)
5.  **Apri una Pull Request**

## Standard di Sviluppo

### Stile Codice
*   Usiamo JavaScript standard (ES6+ supportato da GAS V8 runtime).
*   **JSDoc** è obbligatorio per tutte le funzioni pubbliche e classi.
*   I nomi variabili devono essere descrittivi (camelCase).

### Testing
*   **Unit Tests**: Esegui `node gas_unit_tests.js` localmente o `runAllTests()` nell'editor GAS.
*   **Sicurezza**: Assicurati che le tue modifiche non compromettano la "Safety Valve" o la logica di Rate Limiting.
*   **Sensibilità Pastorale**: Ogni modifica che influenza la generazione delle risposte deve essere testata contro scenari pastorali (es. lutto, disagio spirituale) per garantire che il tono rimanga appropriato.

## Segnalare Bug

Per favore apri una issue su GitHub con:
1.  Descrizione del bug.
2.  Step per riprodurre.
3.  Log rilevanti (sanitizzati).
4.  Comportamento Atteso vs Reale.

## Licenza

Contribuendo, accetti che i tuoi contributi siano rilasciati sotto licenza MIT.
