# Componenti di elaborazione del thread

`EmailProcessor.processThread` coordina undici componenti globali sincroni. Le dipendenze sono risolte a ogni chiamata dai metodi `_thread*Services_`; ciascun componente riceve soltanto i servizi previsti dal proprio contratto. Tutti i file `gas_thread_*.js` devono essere caricati su Apps Script insieme all'orchestratore.

| Componente | Ingressi e responsabilità |
| --- | --- |
| `ThreadLifecycle` | Logger del thread, ripristino dei logger dei servizi e classificazione delle eccezioni prima e dopo la conferma di invio. |
| `ThreadSelection` | Messaggi, identità e alias del bot, metadati delle etichette, candidato esterno e messaggi accorpati. |
| `ThreadMessageState` | Stato della selezione e marcature uniche dei messaggi del gruppo corrente. |
| `ThreadPolicy` | Filtri locali, newsletter, lingua, frequenza, duplicati e controllo rapido AI. |
| `ThreadContext` | Fonti, memoria, storico, territorio, saluto e parametri del prompt. |
| `ThreadAttachments` | Dimensioni, raccolta, lettura e recupero degli allegati contestuali. |
| `ThreadDocuments` | Scopo, ruoli documentali, coerenza, direttive e contesto di validazione. |
| `ThreadGeneration` | Cascata dei modelli, cursore di generazione, ricevuta locale e preparazione del testo. |
| `ThreadValidation` | Controlli deterministici e semantici, piani di rigenerazione e scelta della risposta utilizzabile. |
| `ThreadDelivery` | Simulazione, prenotazione idempotente, invio e riconciliazione degli esiti. |
| `ThreadCompletion` | Etichette e memoria dopo conferma di consegna. |

Le fasi ricevono record specifici e restituiscono i dati necessari alla fase successiva. Un risultato interno `{terminal: true}` conclude l'elaborazione con il risultato pubblico già aggiornato. Il record `result` comunica stato, motivazione, classe di errore e informazioni per il rinvio.

`messageState` gestisce il candidato e i messaggi coinvolti. Gli aggiornamenti restano disponibili alla gestione degli errori anche se una fase genera un'eccezione. `delivery.confirmed` viene impostato appena Gmail conferma la consegna; le attività successive conservano quell'esito.

L'ordine delle operazioni sui servizi è parte del contratto. Il contenuto documentale viene analizzato prima del routing; il contesto delle etichette resta limitato al gruppo pertinente, incluso il recupero di documenti contestuali. La memoria viene aggiornata dopo l'invio confermato.

I test di caricamento verificano anche l'ordine inverso dei file. I test di caratterizzazione confrontano risultati, prompt ed effetti ordinati su fixture; le suite documentali, transazionali e di checkpoint verificano i contratti specifici.

Vedi [architettura](ARCHITECTURE_IT.md), [contratti funzionali](CONTRATTI_FUNZIONALI_IT.md) e [verifica automatica](validator_testing.md).
