# Ricezione dati e intento del quick-check

Il caso di una richiesta di attestazione dopo una telefonata veniva trattato come sola consegna di dati. Riproduzione offline su testo anonimizzato: anche con `request_purpose: operational_request` e confidenza `0.99`, il percorso inviava il template di ricezione, senza generazione né validazione. Lo stesso accadeva con intento `mixed`. Non è stata interrogata l'AI live né recuperato il log della mail reale.

Il prompt del quick-check contiene già la distinzione fra richiesta operativa e aggiornamento. La correzione è nella decisione finale `ThreadDocuments.consistency`: la ricevuta fissa è consentita soltanto se lo scopo risolto proviene dal quick-check AI (`quick_check_model`), è `status_update` oppure `acknowledgment`, e raggiunge la soglia già esistente di 0,65. Restano necessari tutti gli altri requisiti di consegna e assenza di problemi documentali. Scopi operativi, informativi, misti, assenti, incerti o ricavati solo dal fallback locale passano alla generazione e alla validazione normali.

Non sono state aggiunte regex, nuove chiamate di classificazione o modifiche al prompt AI. I casi che prima saltavano erroneamente la generazione ora consumano la normale chiamata di risposta e relativa validazione. Restano invariati transazioni e marcatori di idempotenza.

## Verifiche

- `tests/test_receipt_purpose.js`: 24 combinazioni con dati nel corpo o allegato, sei intenti e due livelli di confidenza. Verificati generazione, validazione, assenza/presenza del template fisso e un solo invio simulato anche riprocessando il messaggio. Il test della richiesta operativa falliva prima della correzione.
- Suite batch aggiornata: la consegna pura testa ora un intento AI esplicito; senza intento, anche documenti coerenti richiedono generazione e validazione.
- 63 scenari storici e tutti i 41 metodi di fase verificati. La fixture originale resta intatta. `thread_receipt_intent.json` registra soltanto le nuove aspettative per `attachment` e `receipt_only`, i cui quick-check simulati non specificavano l'intento. Fino al prompt gli effetti sono identici; dopo cambiano generazione/validazione, testo inviato e testo conservato in memoria, mentre esiti e marcatori restano identici.
- Replay della baseline originale con verifica dei 163 hash superato.
- CI completa: 114/114 smoke, 152/152 unitari, 48/48 suite modulari; soglie di copertura invariate e rispettate. Log: `outputs/receipt-purpose-ci.log`.
- `git diff --check` superato. Nessun invio reale, deploy, push o merge.

La prova garantisce il corretto instradamento a partire dall'intento restituito; non garantisce la classificazione o la formulazione di ogni futura risposta AI.
