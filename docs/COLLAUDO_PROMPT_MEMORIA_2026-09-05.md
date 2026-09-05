# Collaudo dell'affinamento di prompt e memoria

Base: `65640f1`. Data: 5 settembre 2026.

## Risultato

La presenza attuale a Roma risolve la sola distanza geografica conosciuta. Ogni altro impedimento resta indipendente: salute, mobilità, assistenza familiare, restrizioni legali, indisponibilità temporanea e preferenza remota. Il silenzio non equivale a risoluzione. Negazioni, ipotesi, domande, citazioni e disponibilità future non cancellano lo stato tramite le regole locali.

Il vecchio `remote_user` senza causa identificabile diventa un impedimento generico prudenziale: non viene reinterpretato come distanza. Il nuovo stato conserva solo tipo, stato, data, origine e politica operativa, senza estratti personali. Usa il JSON già presente nella colonna I; nessuna nuova colonna o cancellazione della memoria. Un vecchio impedimento generico può quindi restare prudenzialmente attivo: non è possibile dedurne la causa mancante con certezza. Le regole locali sono conservative e non coprono ogni parafrasi; QuickCheck mantiene la classificazione semantica già esistente.

La decisione riconciliata guida processor e contesto del prompt. Il flag geografico non può riattivare una distanza già risolta. Lutto, complessità canonica, percorso pastorale e postura restano separati e vengono preservati nei test di persistenza.

Il difetto della strategia riguardava la scelta delle istruzioni, non un blocco dell'invio: un oggetto con `has_constraint:false` veniva trattato come vincolo attivo. Ora il fallback dalla postura funziona quando mancano segnali prioritari. Focus valido, continuità e procedure formali mantengono la precedenza. Processor e renderer condividono controllo di data, confidenza e argomento del focus.

I topic sono ordinati per il massimo tra data del contenuto e ultima interazione valida. Aggiornamenti e reazioni avvengono prima del limite di conservazione. A 51 topic viene eliminato il meno recente; quello appena aggiornato resta. Le date mancanti o invalide non diventano artificialmente attuali alla lettura.

## Consumi

Nessuna nuova chiamata Gemini, `countTokens`, grounding o validazione AI. Modelli, chiavi, fatturazione, retry, quote e massimali non sono modificati. I test usano servizi simulati e non inviano email.

- 12 payload QuickCheck: **−322 caratteri**, circa **−101 token stimati**, ciascuno.
- 99 payload di generazione dei test esistenti: **da −187 a 0 caratteri**, circa **da −59 a 0 token stimati**.
- Flusso completo simulato: quattro posture per due turni; **una classificazione e una generazione per messaggio**, con salvataggio e rilettura della memoria.

Il ripristino della strategia prima erroneamente assente aggiunge istruzioni pertinenti. Le istruzioni esistenti sono state accorpate, senza aggiungere sezioni nuove. Nel campione di richiesta orari, il confronto del solo routing è:

| Postura | Generazione: delta caratteri | QuickCheck + generazione: delta caratteri | Delta token stimati complessivo |
| --- | ---: | ---: | ---: |
| Urgente | +505 | +183 | circa +57 |
| Esitante | +398 | +76 | circa +23 |
| Apprezzamento | +330 | +8 | circa +2 |
| Diretta | +270 | −52 | circa −16 |

Questa piccola crescita residua è esplicita: non promettiamo consumo identico per ogni email. I dati sono stime locali con il fallback conservativo del progetto (3,2 caratteri/token), non conteggi del tokenizer Gemini né misure della risposta generata. La dimensione delle risposte future dipende dal modello e dal contenuto. L'effettiva disponibilità del tier gratuito dipende dalle quote del progetto e dal traffico; questo collaudo non verifica fatturazione o quota residua dell'account Google e non abilita servizi a pagamento.

Riproduzione della misura corrente: `node scripts/measure_prompt_footprint.js --routing`. Il confronto routing simula i parametri che il processor passava prima e passa dopo la correzione; non misura traffico reale. I casi che testano soltanto renderer parziali restituiscono zero payload completi e non rientrano nei 99/12 conteggi.

## Verifiche

- Suite CI completa: smoke test, unit test e **30 file modulari passati, zero falliti**.
- Regressioni nuove: sei lingue, impedimenti multipli, risoluzioni esplicite, contraddizioni, memoria legacy/malformata, conservazione dei flag sensibili, persistenza tra turni, scadenza e argomento del focus, cap di 50 topic, reazioni e date mancanti.
- Le riproduzioni in `scratch/audit_prompt_memory_repros.js` richiamano ora le regressioni permanenti.
- Il controllo degli snapshot prova le istruzioni costruite, non garantisce una specifica risposta futura del modello.

## Rilascio

I sei file GAS interessati sono verificati contro la base prima della scrittura, con backup integrale locale di ciascun progetto. L'aggiornamento preserva gli altri file remoti e le configurazioni specifiche dei due account. La verifica finale rilegge via Apps Script API il contenuto salvato e lo confronta con i file locali. Non vengono eseguiti trigger o invii di prova.
