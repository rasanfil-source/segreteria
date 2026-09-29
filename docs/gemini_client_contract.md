# Contratto Gemini attuale e proposta evolutiva

Allineamento al 29 settembre 2026.

## Implementazione presente

`gas_gemini_service.js` contiene `GeminiService`, `GeminiContentClient`, `EmailQuickCheckPolicy` e i profili `GEMINI_TASK_PROFILES`.

- `GeminiService` è l'interfaccia usata dalla pipeline per quick-check, rilevamento lingua e generazione.
- `GeminiContentClient` normalizza prompt e system instruction, prepara payload/configurazione e gestisce aspetti del trasporto e del fallback chiave.
- `EmailQuickCheckPolicy` gestisce costruzione e interpretazione del quick-check.
- Le strategie applicative di generazione, il budgeting della pipeline e la decisione finale restano nell'orchestratore e in `ThreadGeneration`/`ThreadValidation`.
- I modelli configurati sono descritti in [CONFIGURATION_IT.md](CONFIGURATION_IT.md). Il client usa `generateContent`; la stima dei token è locale.

Il rilevamento locale della lingua può rinviare l'italiano prima del quick-check in modalità Solo straniere; il quick-check può aggiornare la lingua e il filtro viene applicato nuovamente. Vedi [modalità lingua](LANGUAGE_MODES_IT.md).

## Proposta, non API disponibile

Una futura API unificata `GeminiClient.runTask({task, context, attachments, options})` potrebbe centralizzare profili, selezione modello, backoff e risultato tecnico. **Non è un'API implementata oggi** e non deve essere usata negli esempi operativi come se esistesse.

Il confine da mantenere è tra trasporto AI e decisioni della pipeline: idempotenza Gmail, label, crisi, ricezione documenti, OCR e memoria rimangono responsabilità applicative. Il successo tecnico della generazione non autorizza da solo l'invio.
