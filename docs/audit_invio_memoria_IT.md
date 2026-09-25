# Audit invio incerto, classificazione errori e topic memoria

## 3.1 — Confermato e corretto

Un invio ambiguo non riconciliato applicava Verifica, ma restituiva `error` senza `validationFailed`. Ora restituisce `validation_failed` e `validationFailed: true`, mantenendo motivo `gmail_send_uncertain`, dettaglio dell'errore e classe `NETWORK`. Rimangono il marcatore persistente di incertezza e il blocco del reinvio.

Il fix proposto non era sufficiente da solo: il batch interrompe su NETWORK prima del conteggio finale delle revisioni. Il conteggio `validationFailed` ora avviene prima delle uscite anticipate, una sola volta. Il batch conserva lo stop infrastrutturale e il checkpoint a 60 secondi; quel checkpoint non autorizza un nuovo invio del messaggio incerto.

I test verificano stato, flag, etichetta Verifica, assenza di commit e rollback, nessun marcatore di duplicato confermato e contatori `validationFailed=1`, `errors=0` anche quando il batch si interrompe.

## 3.2 — Confermato e corretto

`_beginSendTransaction` ora verifica prima la conferma in cache e il backup persistente valido, poi il marcatore incerto. Un commit con scrittura del backup fallita mantiene il marcatore incerto, ma finché esiste una prova valida di consegna restituisce `already_sent`.

Non viene cancellata l'incertezza durante la lettura: se la cache evapora e manca una conferma persistente valida, il messaggio torna correttamente a richiedere revisione anziché essere reinviato.

`tests/test_send_evidence.js` esercita il commit reale con persistenza simulata fallita, la precedenza della cache, la precedenza del backup reale, la scadenza del backup e il rilascio di ogni lock acquisito. Il test falliva prima della modifica con `gmail_send_uncertain` al posto di `already_sent`.

## 3.3 — Confermato come ridondanza, nessuna regressione del refactoring rilevata

Il confronto con il commit precedente al refactoring `b5a6a75` mostra già sia i confronti con TIMEOUT/RETRYABLE sia la normalizzazione dei timeout a NETWORK. Il classificatore centralizzato distingue TIMEOUT, ma l'adattatore di EmailProcessor lo normalizza intenzionalmente insieme a NETWORK e CACHE_EXPIRED.

Test aggiunti verificano timeout, request timed out, ECONNRESET e HTTP 503 nel fallback, e TIMEOUT/NETWORK/CACHE_EXPIRED nel percorso centralizzato. Tutti producono NETWORK. Nei percorsi esaminati non emerge una semantica separata di retry persa con il refactoring.

I confronti aggiuntivi restano come compatibilità difensiva per classificatori sostituiti o risultati esterni: non è necessario modificarli per correggere 3.1 e 3.2. RETRYABLE non è prodotto dall'adattatore attuale.

## 3.4 — Differenza concreta riprodotta, comportamento non modificato

`profileDefaults` usa la memoria già caricata, estrae etichette testuali con fallback topic/title/category/summary/detail, poi prende i primi 12 elementi. `getRecentMemoryTopics` delega invece a `getRecentProvidedInfo`, rilegge la memoria, ordina per recenza e restituisce gli ultimi elementi come oggetti. Non sono API intercambiabili senza un adattamento.

Prova offline `scratch/check_memory_topic_paths.js`, 14 topic ordinati cronologicamente:

- contesto: topic 1–12;
- servizio con limite 12: topic 3–14.

Anche la selezione iniziale dei 12 topic precede il refactoring. La differenza può incidere sul contesto quando si supera il limite, quindi è più di un rischio astratto. Non è stata unificata in questo intervento sui percorsi di invio: scegliere gli ultimi topic cambierebbe il contenuto fornito all'AI. Un eventuale intervento dovrebbe condividere la selezione per recenza sulla memoria già disponibile, senza aggiungere una seconda lettura del servizio, mantenendo separata la conversione in etichette.

## Verifiche finali

- CI completa: 114/114 smoke, 152/152 unitari, 49/49 suite modulari. Log `outputs/send-audit-ci.log`.
- Copertura: validator 99,10% funzioni / 81,76% blocchi; territorio 100% / 87,61%. Soglie invariate e rispettate.
- 63 scenari di caratterizzazione e 41 metodi di fase verificati. La sola nuova variazione attesa è stato/flag dello scenario `send_uncertain`; fixture originale preservata.
- Replay del workspace precedente e 163 hash verificati; `git diff --check` superato.
- Le modifiche già presenti sul routing di sola ricezione sono state preservate. Nessun invio reale, deploy, push o merge.
