# Modalità “Tutte le lingue” e “Solo straniere”

Verificato sul codice locale il 3 ottobre 2026. [English](LANGUAGE_MODES.md)

## Impostazione

Usare il menu in **`Controllo!F2`**. `gas_main.js::_loadAdvancedConfig` converte un valore che contiene “solo” e “straniere”, senza distinzione tra maiuscole e minuscole, in `foreign_only`. Gli altri valori, la cella vuota e il foglio assente corrispondono a `all`. Usare i valori previsti dal menu, senza tradurli o inserire i codici interni nella cella.

| Menu | Codice interno | Italiano | Altre lingue |
|---|---|---|---|
| Tutte le lingue | `all` | Ammissibile | Ammissibili |
| Solo straniere | `foreign_only` | Rinviato con `·` se riconosciuto | Ammissibili |

“Ammissibile” significa che il messaggio passa il filtro lingua: newsletter, risposte automatiche, messaggi già trattati, richieste senza necessità di risposta, crisi e limiti operativi possono ancora impedirne l'invio. “Solo straniere” non è una lista di nazionalità, domini email o paesi.

## Rilevamento effettivo

`ThreadPolicy` applica i controlli in sequenza:

1. In `foreign_only`, se l'oggetto non è vuoto e il corpo semplice risulta vuoto, un precontrollo cerca termini italiani selezionati nell'oggetto. Se li trova rinvia prima del quick-check. Con un corpo presente l'oggetto italiano, da solo, non attiva questo precontrollo.
2. Il rilevamento locale usa il contenuto principale, cercando di escludere firme e citazioni. Il codice lingua viene normalizzato, per esempio `it-IT` in `it`.
3. Se la lingua locale è italiana e la modalità è `foreign_only`, viene applicata `·` e il percorso termina senza generazione della risposta.
4. Per i messaggi che raggiungono il quick-check, Gemini può aggiornare la lingua. Se conferma italiano, viene applicato di nuovo il filtro prima della generazione.

Il filtro `shouldSkipByLanguageMode_` esclude soltanto `it` in `foreign_only`. Una lingua sconosciuta non viene automaticamente trattata come italiana: prosegue verso i controlli successivi, se le altre policy lo consentono. I messaggi misti, molto brevi o privi di testo possono essere ambigui; il rilevamento non è una certificazione linguistica.

La modalità sceglie **quali messaggi elaborare**, non una lingua fissa di uscita. Il contesto di generazione usa la lingua rilevata; i template locali e i singoli controlli hanno un supporto linguistico finito e possono usare fallback.

## Etichetta `·` e cambio modalità

- Il rinvio linguistico usa `·` a livello dei messaggi interessati, senza trasformarli in `IA` e senza segnarli letti.
- Finché resta “Solo straniere”, discovery e selezione escludono i messaggi già rinviati. La promozione a `IA` viene bloccata per quei messaggi.
- Tornando a “Tutte le lingue”, `·` smette di essere un'esclusione. I messaggi ancora non letti possono essere ripresi senza rimuoverla manualmente.
- Quando un messaggio viene effettivamente marcato trattato, il codice aggiunge `IA` e tenta di rimuovere `·`. Anche un filtro definitivo può concludere il trattamento senza inviare.
- Un messaggio letto manualmente, già `IA`, in `Errore`/`Verifica`, oppure fermato da altre condizioni non diventa automaticamente lavorabile cambiando F2.
- La lingua è valutata nel contesto del candidato e dell'eventuale gruppo di messaggi ravvicinati; non va dedotta dalla sola etichetta visualizzata sull'intero thread.

Esempio: una richiesta italiana rinviata con `·` rimane non letta. Impostando “Tutte le lingue”, torna candidata al prossimo ciclo utile; un messaggio inglese rimane ammissibile in entrambe le modalità.

## Applicazione dell'impostazione

La modalità è caricata nelle risorse (`GLOBAL_CACHE.languageMode`). L'handler `onEdit` riconosce F2 tra le celle da invalidare quando riceve l'evento; il caricamento include inoltre il controllo delle modifiche delle risorse. Dopo una modifica esterna o in caso di cache non aggiornata, eseguire `clearKnowledgeCache()` e lasciare ricaricare le risorse al ciclo successivo. Non serve modificare modelli o ridistribuire il codice per cambiare F2.

`Spento`, sospensione, quota e limite batch restano indipendenti dalla modalità. Nei due progetti GAS, controllare il foglio indicato dalla rispettiva `SPREADSHEET_ID`: se condividono lo stesso foglio, condividono anche F2.

## Verifica

Le regressioni sono nelle suite `tests/test_advanced_config.js`, `tests/test_email_processor.js`, `tests/test_gmail_service.js`, `tests/test_thread_characterization.js` e `gas_unit_tests.js`. Eseguire il [runner completo](validator_testing.md) per coprire configurazione, selezione e marcature insieme.
