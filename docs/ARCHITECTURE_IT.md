# Architettura del sistema

Riferimento: codice locale al 3 ottobre 2026. [English](ARCHITECTURE.md)

## Runtime e risorse

Il runtime è Google Apps Script V8, con servizi avanzati Gmail v1 e Drive v3 dichiarati in `appsscript.json`, fuso `Europe/Rome`. I moduli sono script globali: non usano un caricatore npm nel runtime. Node serve ai test locali.

`main()` carica e valida risorse, accensione, modalità lingua e sospensione; coordina il lock di batch e richiama `EmailProcessor.processUnreadEmails`. Il gate globale viene rilasciato prima di costruire i servizi che acquisiscono propri lock. `processEmailsMain()` è un alias.

`loadResources` legge `Istruzioni`, `AI_CORE_LITE`, `AI_CORE`, `Dottrina`, `Sostituzioni` e `Controllo`. La cache usa TTL nominale di 6 ore, controllo delle modifiche, serializzazione e suddivisione/compressione quando necessarie. Caricare un modulo non significa inserirlo sempre nel prompt: il routing seleziona i contenuti pertinenti.

## Orchestrazione del thread

`gas_email_processor.js` conserva batch, coordinamento, helper, regole dichiarative e transazioni. `processThread` delega le fasi a undici componenti con dipendenze esplicite:

| File | Responsabilità |
|---|---|
| `gas_thread_selection.js` | Identità/alias, label del singolo messaggio, ordinamento, candidato e burst. |
| `gas_thread_message_state.js` | Stato dei messaggi coinvolti e marcature del burst. |
| `gas_thread_policy.js` | Filtri locali, lingua, newsletter, throttle, anti-loop e quick-check. |
| `gas_thread_context.js` | KB, storia, memoria, saluto, territorio e opzioni del prompt. |
| `gas_thread_attachments.js` | Precontrollo, raccolta/OCR e recupero contestuale degli allegati precedenti. |
| `gas_thread_documents.js` | Intento documentale, evidenze, coerenza e direttive. |
| `gas_thread_generation.js` | Strategie AI, fallback e ricevuta locale dove applicabile. |
| `gas_thread_validation.js` | Validazione, piani di correzione, retry e scelta della risposta. |
| `gas_thread_delivery.js` | Dry-run, transazione, invio e riconciliazione. |
| `gas_thread_completion.js` | Etichette e memoria dopo consegna confermata. |
| `gas_thread_lifecycle.js` | Logger e gestione degli errori, distinguendo prima/dopo invio. |

Tutti questi file devono essere caricati su GAS insieme all'orchestratore. I test verificano anche il caricamento in ordine inverso.

## Pipeline e decisioni

1. Discovery dei messaggi non letti tramite metadata Gmail; il percorso query resta disponibile. Le etichette terminali di vecchi messaggi non devono nascondere nuovi follow-up nello stesso thread.
2. Selezione del candidato esterno e accorpamento dei messaggi ravvicinati. Verifica identità, precedente intervento interno e duplicati.
3. Filtri locali e [modalità lingua](LANGUAGE_MODES_IT.md). In “Solo straniere”, italiano riconosciuto diventa `·`; in “Tutte le lingue” questa etichetta non esclude il messaggio.
4. Memoria e quick-check Gemini per necessità della risposta, lingua e segnali conversazionali. Un errore tecnico non equivale a una decisione valida di non rispondere.
5. Costruzione del contesto, territorio e allegati. Prima del routing, una sola analisi strutturata legge testo e file visivi e distingue richiesta, consegna e documenti di supporto; restituisce anche la coerenza, riutilizzata senza una seconda chiamata. Una richiesta personale nell'allegato contribuisce allo scopo, al profilo e alla validazione; domande prestampate e richieste storiche non diventano nuove istanze. La ricevuta locale richiede consegna semplice confermata sia dal quick check sia dall'analisi completa. Errori, letture parziali e incertezza mantengono generazione e validazione. Le crisi critiche possono fermarsi in revisione prima della generazione.
6. Generazione con strategie configurate e limiti di tempo/quota; validazione deterministica e, quando richiesta, semantica. Il punteggio da solo non supera un controllo bloccante; un controllo semantico obbligatorio non riuscito impedisce la promozione automatica.
7. Invio protetto da transazione; conferma prima del post-processing. Errori successivi a una consegna confermata non autorizzano un nuovo invio.

## Invio, stato e memoria

Il percorso RAW usa un identificativo deterministico `reply_<ID_MESSAGGIO>@parish-reply.invalid` (il segnaposto rappresenta l'ID Gmail del messaggio). Prima dell'invio viene registrato uno stato persistente. Dopo timeout/rete, una ricerca di riconciliazione può confermare l'invio; senza evidenza resta `send_uncertain_<ID>` e viene richiesta revisione, senza reinvio automatico. Vedi [procedura operativa](TROUBLESHOOTING_IT.md).

`IA` significa messaggio trattato, anche nei percorsi filtrati senza risposta. `Verifica` comprende blocchi, warning post-invio e invii incerti. La marcatura ordinaria non segna letta l'email.

`ConversationMemory` usa colonne A–J: threadId, language, category, tone, providedInfo, lastUpdated, messageCount, version, memorySummary, contextualFlags. Gli argomenti sono ordinati per recenza e limitati a 50; la sintesi conserva fino a 5 righe configurate. Stato conversazionale e date delle evidenze sensibili sono serializzati nei dati esistenti. Il TTL dei flag sensibili è 180 giorni; la pulizia settimanale delle righe inattive usa 30 giorni dall'ultimo aggiornamento, con trattamento separato delle date anomale. Non è cancellazione dell'email Gmail.

## Budget, retry e verifiche

Valori locali: batch 2, esecuzione 280 secondi, margine 90 secondi, storia 8 messaggi, lock thread 310 secondi, checkpoint 10 minuti e fino a 3 riprese rapide dello stesso insieme. `notBefore` impedisce riprese anticipate; la pipeline salva o cancella il checkpoint secondo l'esito.

`GeminiService` usa `GeminiContentClient` e `EmailQuickCheckPolicy` nello stesso file. Le strategie di generazione e i controlli applicativi appartengono alla pipeline. Il client usa `generateContent` e stime locali dei token.

Il limite delle riprese è inclusivo e conta la ripresa pianificata: scrittura e lettura abbandonano il checkpoint soltanto oltre la soglia. In assenza di LockService il sistema usa la modalità compatibilità, priva di atomicità fisica, con rilascio dei token logici appartenenti al chiamante. I marcatori di invio incerto hanno conservazione limitata ad almeno sette giorni. Vedi i [contratti funzionali](CONTRATTI_FUNZIONALI_IT.md) e i [componenti del thread](COMPONENTI_THREAD_IT.md).

Vedi [configurazione](CONFIGURATION_IT.md), [diagrammi](ARCHITECTURE_DIAGRAMS_IT.md) e [copertura dei test](validator_testing.md). Le suite offline non attestano disponibilità Gemini, quote reali o stato del deploy.
