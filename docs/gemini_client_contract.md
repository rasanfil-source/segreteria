# Contratto del client Gemini

Allineamento al 3 ottobre 2026.

## Implementazione presente

`gas_gemini_service.js` contiene `GeminiService`, `GeminiContentClient`, `EmailQuickCheckPolicy` e i profili `GEMINI_TASK_PROFILES`.

- `GeminiService` è l'interfaccia usata dalla pipeline per quick-check, rilevamento lingua e generazione.
- `GeminiContentClient` normalizza prompt e system instruction, prepara payload/configurazione e gestisce aspetti del trasporto e del fallback chiave.
- `EmailQuickCheckPolicy` gestisce costruzione e interpretazione del quick-check.
- Le strategie applicative di generazione, il budgeting della pipeline e la decisione finale restano nell'orchestratore e in `ThreadGeneration`/`ThreadValidation`.
- I modelli configurati sono descritti in [CONFIGURATION_IT.md](CONFIGURATION_IT.md). Il client usa `generateContent`; la stima dei token è locale.

Il rilevamento locale della lingua può rinviare l'italiano prima del quick-check in modalità Solo straniere; il quick-check può aggiornare la lingua e il filtro viene applicato nuovamente. Vedi [modalità lingua](LANGUAGE_MODES_IT.md).

## Responsabilità applicative

Il trasporto AI e le decisioni della pipeline hanno responsabilità distinte: idempotenza Gmail, etichette, crisi, ricezione documenti, lettura degli allegati e memoria appartengono ai componenti applicativi. Il successo tecnico della generazione richiede comunque validazione prima dell'invio. Vedi [componenti del thread](COMPONENTI_THREAD_IT.md).
