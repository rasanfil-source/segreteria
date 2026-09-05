# Progetto di affinamento del prompt e della memoria conversazionale

Data: 5 settembre 2026. Stato: implementato e verificato; risultati in [rapporto di collaudo](COLLAUDO_PROMPT_MEMORIA_2026-09-05.md).

Riferimento: [audit con tre problemi riproducibili](AUDIT_PROMPT_MEMORY_2026-09-05.md). Base di lavoro: commit `65640f1`. Le correzioni precedenti alla ricerca Gmail e agli invii ambigui sono già distribuite e non fanno parte di questa modifica.

## 1. Obiettivo e vincoli

Correggere la persistenza impropria dei vincoli di presenza, ripristinare la scelta della strategia dalla postura quando prevista e conservare gli argomenti realmente recenti. La risposta deve rispettare il messaggio attuale senza perdere delicatezza pastorale o informazioni ancora valide.

- **TUTTOGRATIS:** zero nuove chiamate Gemini per email, nessuna variazione di modelli, fatturazione, grounding, retry o quote.
- **Prompt contenuto:** affinare o sostituire istruzioni esistenti; evitare nuovi blocchi sovrapposti. Le decisioni verificabili vanno nel codice.
- **Memoria compatibile:** nessuna nuova colonna o riscrittura generale del foglio, nessuna scansione aggiuntiva della casella, nessuna ricostruzione AI dello storico.
- **Sensibilità preservata:** disponibilità fisica, postura e argomento sensibile sono dimensioni distinte. La variazione della prima non cancella le altre.
- **Rilascio misurabile:** test locali deterministici e confronto dei prompt prima della distribuzione. Nessuna email reale di prova.

Il codice può ridurre lo spreco e rispettare soglie operative; il costo monetario zero richiede anche che i progetti Gemini rimangano effettivamente nel Free Tier. Il presente intervento non cambia il loro piano.

## 2. Vincoli di presenza: una sola decisione condivisa

### Problema da eliminare

Oggi il processor, PromptContext e il renderer possono interpretare separatamente `remote_user`. Questo flag significa soltanto «è stato rilevato un impedimento», ma viene talvolta reinterpretato come distanza geografica certa. Inoltre un oggetto con `has_constraint: false` non distingue il silenzio sul tema da una smentita.

### Soluzione proposta

Introdurre una funzione pura di riconciliazione, chiamata una volta prima della costruzione del contesto. Riceve messaggio corrente, risultato QuickCheck e memoria disponibile; restituisce:

1. Il vincolo effettivo del turno, con tipo e politica di presenza.
2. La motivazione sintetica della decisione, espressa come codice per i log locali.
3. L'eventuale aggiornamento della memoria da applicare nel percorso di scrittura già esistente.

Internamente distinguere **vincolo attivo**, **risoluzione esplicita** e **nessuna informazione nuova**. Non introdurre un'altra chiamata AI né un nuovo campo obbligatorio nell'output QuickCheck: usare i campi già presenti (`has_constraint`, `type`, `confidence`, `evidence`, `visit_policy`) e segnali locali verificabili nel messaggio corrente.

`has_constraint: false` da solo non autorizza una cancellazione. Una risoluzione richiede evidenza affermativa, attuale e riferita al vincolo pertinente. La confidenza del modello, da sola, non basta. Citazioni, ipotesi, negazioni e progetti futuri non valgono come cambiamento già avvenuto.

| Memoria e messaggio corrente | Decisione prevista |
| --- | --- |
| Distanza nota; «Sono a Roma e posso passare» | Superare il vincolo geografico; rispettare comunque le procedure della KB. |
| Distanza nota; «Verrò a Roma il mese prossimo» | Conservare la distanza attuale; distinguere l'eventuale appuntamento futuro. |
| Salute o mobilità; «Sono a Roma» | Conservare l'impedimento: la città non dimostra disponibilità fisica. |
| Distanza e mobilità; arrivo a Roma | Risolvere soltanto la distanza. |
| Vincolo precedente; il tema non viene menzionato | Nessuna cancellazione automatica. |
| «Se fossi a Roma passerei» o citazione di una vecchia email | Nessuna risoluzione. |
| Tipo sconosciuto nel vecchio flag; «Sono a Roma» | Non inventare il tipo geografico; mantenere un contesto incerto e prudente. |
| Impedimento specifico esplicitamente superato nel messaggio | Risolvere quel tipo, purché non vi siano altri impedimenti attivi. |

«Può venire» non significa «deve venire»: la proposta di presenza dipende ancora da richiesta, KB e procedura. Un interesse per un argomento delicato non costituisce di per sé un impedimento fisico.

### Stato persistente minimo

Per i nuovi aggiornamenti conservare un piccolo stato tipizzato dentro il contenitore JSON già usato per `conversationState`, senza alterare le colonne del foglio. Proposta: `physicalPresenceState` versionato, con una voce per ciascun tipo conosciuto e soli campi necessari: tipo, stato, data di aggiornamento e sorgente. Conservare più tipi quando coesistono; non sovrascrivere salute con distanza.

Non salvare ulteriori descrizioni sanitarie o copie del messaggio. Usare un insieme chiuso di tipi e un limite di dimensione. Anche una risoluzione va rappresentata: la sola assenza del dato consentirebbe al vecchio flag di riattivarlo.

Aggiornare coerentemente parser, serializzazione, merge e copie difensive di MemoryService: oggi `_mergeConversationState` restituisce una lista fissa di campi e perderebbe un campo aggiunto soltanto dal chiamante. Il cambiamento dello stato di presenza non deve rinnovare la scadenza di un focus conversazionale non aggiornato.

Compatibilità progressiva:

- Se esiste lo stato tipizzato, esso prevale sul flag legacy nella decisione di presenza.
- Se esiste solo `remote_user: true`, trattarlo come impedimento di tipo sconosciuto; non attribuirgli una causa.
- Derivare il flag compatibile dallo stato effettivo; inviare un `false` esplicito quando tutti gli impedimenti noti risultano superati.
- Scrivere gli aggiornamenti insieme alla memoria già prevista dopo la risposta, senza nuove scritture per ogni modulo. Nel turno corrente usare subito la decisione risolta, anche prima della persistenza.
- Non far decadere automaticamente impedimenti sanitari o legali soltanto perché è passato un numero di giorni. Il dato storico può diventare incerto, non automaticamente falso.

PromptContext, PromptEngine e controlli di presenza devono ricevere la stessa decisione. Nessuno deve aggiungere nuovamente un vincolo tramite un OR sul flag grezzo. I chiamanti legacy senza decisione risolta mantengono un fallback esplicito e testato.

## 3. Postura e strategia: correggere le condizioni, riusare le istruzioni

Nel processor sostituire il controllo sulla veridicità dell'oggetto con il controllo del vincolo effettivo. Un oggetto negativo non è un motivo per bloccare l'inferenza della strategia.

Condividere tra processor e PromptEngine una funzione pura che stabilisca se il focus memorizzato è applicabile: soglia configurata, argomento corrente e data di aggiornamento. Non usare la renderizzazione del testo come verifica logica. La validità del focus deve essere la stessa in entrambi i moduli.

Mantenere queste precedenze:

1. Vincoli operativi reali e istruzioni specifiche per il caso.
2. Strategia esplicita valida, soggetta ai vincoli del caso.
3. Se mancano segnali prevalenti, mappatura già esistente dalla postura.

Conservare i blocchi specifici per casi formali, documentali e sensibili. Non trasformare automaticamente una richiesta urgente in una deroga alla procedura, né una postura riconoscente in un colloquio pastorale.

Riutilizzare `gas_response_strategy.js` per gli helper condivisi quando opportuno. La mappatura della postura e i renderer delle strategie esistono già: non serve aggiungere istruzioni che ne duplichino il significato.

## 4. Argomenti recenti: un ordinamento stabile

Unificare l'ordinamento usato dal merge, dal limite di 50 argomenti, dai tagli per dimensione e dalle letture dei topic recenti, compresi i cinque topic inviati al QuickCheck.

Decisione proposta: ordinare per ultima interazione valida, utilizzando il più recente tra `timestamp` e `lastInteraction`; mantenere un ordine stabile a parità di data. Un aggiornamento effettivo rende recente quel topic. Una normalizzazione o lettura non deve assegnare artificialmente la data odierna ai record legacy privi di timestamp.

Per record con date mancanti o invalide preservare l'ordine relativo come fallback, senza fingere che siano più recenti di quelli datati. Gestire esplicitamente i timestamp futuri anomali. Le nuove interazioni ricevono la data del turno, non la data di una vecchia citazione.

Applicare ordinamento e limite nella stessa operazione atomica, dopo la fusione dei topic e delle reazioni. Preservare reazioni, contesti e metadati pertinenti; un aggiornamento con reazione `unknown` non deve cancellare una reazione precedente valida.

Non aumentare il limite di 50 argomenti, il sommario o la cronologia nel prompt. Correggere cosa viene conservato, non la quantità.

## 5. Revisione del prompt a budget controllato

Il punto 11 del QuickCheck già distingue diversi impedimenti, ma include nello stesso FALSE «propone una visita» e «non fornisce alcun vincolo». Riscrivere quel punto per rendere utilizzabili i campi esistenti, eliminando formulazioni sovrapposte.

Bozza concettuale da integrare al posto delle frasi attuali, non da aggiungere come sezione:

> Valuta impedimenti personali attuali. La mancata menzione non ne dimostra la risoluzione: senza nuovi elementi usa `visit_policy: unknown`. Se l'utente dichiara una disponibilità attuale, riportane l'evidenza. Essere a Roma supera la sola distanza; salute, mobilità e altri impedimenti richiedono evidenze pertinenti. Distingui fatti attuali, ipotesi, citazioni e disponibilità futura.

Conservare nello stesso punto i tipi ammessi e la semantica delle politiche; non allargare lo schema JSON per descrivere il ragionamento. La decisione sullo storico rimane nel riconciliatore JavaScript.

Nel prompt finale mantenere un'unica politica di presenza derivata dallo stato risolto. Accorpare eventuali duplicazioni tra vincoli operativi e renderer dedicato, preservando tutti i vincoli necessari. Mantenere separati postura e sensibilità dell'argomento.

Misurare QuickCheck e generazione separatamente, inclusi i prompt realmente inviati e non soltanto i template. Lo stato tecnico persistente non va riversato integralmente nel prompt: fornire soltanto l'informazione operativa necessaria entro i budget correnti.

Obiettivo: nessuna crescita netta delle istruzioni sui casi rappresentativi e nessun aumento dei massimali. Riattivare una strategia prima erroneamente assente può rendere più lungo quel singolo prompt: compensare con accorpamenti equivalenti, oppure documentare esattamente l'eventuale incremento residuo prima del rilascio. Non promettere invariabilità dei token a priori e non eliminare istruzioni pastorali utili soltanto per ottenere un numero inferiore.

## 6. Piano di verifica

| Area | Casi obbligatori | Esito da verificare |
| --- | --- | --- |
| Presenza | Arrivo effettivo, futuro, ipotesi, citazione, negazione | Solo fatti attuali pertinenti possono risolvere un vincolo. |
| Impedimenti multipli | Distanza insieme a salute, mobilità o assistenza familiare | Risolvere un tipo non elimina gli altri. |
| Legacy | Solo `remote_user`, stato tipizzato assente o malformato | Nessuna causa inventata; nessuna perdita dei flag sensibili. |
| Persistenza | Lettura, aggiornamento, rilettura nel turno successivo | Il vincolo superato non riappare; cache e foglio concordano. |
| Sensibilità | Lutto, situazione canonica, apprezzamento, esitazione | Eliminare la distanza lascia intatta la gestione del resto. |
| Strategia | `urgent`, `hesitant`, `appreciative`, `direct`; strategia esplicita assente/presente | Fallback corretto solo nei casi previsti, nessun blocco causato da oggetti negativi. |
| Focus | Valido, scaduto, altro argomento, soglie configurate | Processor e renderer prendono la stessa decisione. |
| Topic | 50 elementi, aggiornamento del primo e aggiunta del 51° | Il topic aggiornato sopravvive; viene eliminato quello realmente meno recente. |
| Topic legacy | Date mancanti, invalide, uguali; reazioni aggiornate | Ordine stabile e nessun aggiornamento temporale artificiale. |
| Lingue | Casi equivalenti nelle lingue già supportate | Le regole locali non funzionano soltanto in italiano. |
| Consumi | Stessi scenari prima/dopo, chiamate simulate e prompt catturati | Zero chiamate Gemini aggiuntive, budget rispettati. |

Trasformare le tre riproduzioni diagnostiche in regressioni che verificano il risultato corretto. Aggiungere casi al livello delle funzioni pure e almeno un passaggio completo con servizi simulati per persistenza e costruzione del prompt. Non limitarsi a test che copiano la condizione implementata.

Usare il conteggio locale già disponibile per le stime token: nessuna chiamata `countTokens`, nessuna generazione AI di collaudo. Confrontare caratteri, token stimati, numero di chiamate e sezioni attivate. Gli snapshot provano il contenuto delle istruzioni, non garantiscono una specifica risposta futura del modello.

Eseguire la suite CI completa, il controllo sintattico e i test di prompt già presenti. Aggiornare gli snapshot solo dopo aver motivato le differenze. Un test di sensibilità non deve essere indebolito per far passare la patch.

## 7. Ordine di realizzazione e rilascio

1. Congelare i casi di riferimento e misurare prompt e chiamate con servizi simulati.
2. Correggere l'ordinamento dei topic e i relativi test, come modifica indipendente.
3. Unificare condizioni di strategia e validità del focus, mantenendo le precedenze esistenti.
4. Implementare stato di presenza, compatibilità legacy e riconciliazione condivisa; verificare un ciclo di memoria completo.
5. Affinare i testi esistenti e accorpare le duplicazioni dimostrate; misurare di nuovo i prompt.
6. Rieseguire tutti i controlli e revisionare il diff, separando logica, testo e compatibilità.
7. Al momento dell'implementazione richiesta, preparare backup dei due GAS, verificare le differenze remote, aggiornare i soli file interessati e verificare il contenuto salvato. Pubblicare commit e risultati dei test su GitHub entro lo scope autorizzato.

Conservare il commit precedente per ripristinare il codice se emergono regressioni. Lo stato aggiuntivo deve restare ignorabile dalla versione precedente; il ritorno al vecchio codice perde la precisione nuova, perciò verificare esplicitamente la compatibilità dei dati. Non cancellare la memoria per effettuare il rollback.

Durante la normale attività controllare i codici di decisione, i retry, le chiamate Gemini e la dimensione dei prompt già registrabili, senza duplicare email personali nei log o introdurre nuove chiamate di monitoraggio.

## 8. Criteri di completamento

Il lavoro è concluso quando le tre regressioni sono risolte, i casi sensibili e legacy sono preservati, il numero di chiamate AI per scenario non aumenta e il confronto dei prompt rispetta i budget concordati. Il progetto non comprende una riscrittura generale del prompt, un nuovo sistema di memoria o ulteriori funzionalità AI.

Il presente documento conserva il progetto approvato. L'implementazione aggiorna il codice; lo stato di memoria viene riconciliato durante i normali turni, senza cancellazioni massive dei dati esistenti.
