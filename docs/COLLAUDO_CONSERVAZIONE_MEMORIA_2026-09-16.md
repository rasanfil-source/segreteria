# Cleanup e conservazione della memoria: rilievi 3–4

## Decisione e conseguenze

Una data mancante non dimostra che la conversazione sia vecchia. La cancellazione immediata potrebbe perdere vincoli di mobilità, continuità pastorale e argomenti già trattati. Sostituire `lastUpdated` con oggi altererebbe invece recenza, saluto e rilevamento della memoria esistente.

La modifica usa un periodo di osservazione pari alla soglia di cleanup (30 giorni nel trigger), registrato in una nota tecnica della cella F: `AG_MEMORY_RETENTION_V1:<epoch-ms>`. Non aggiunge colonne né cambia sintesi, flag, versioni o timestamp di interazione. Le note non sono lette dai renderer del prompt. Anche le date future sono trattate come anomalie.

| Caso | Comportamento |
| --- | --- |
| Data valida, più vecchia della soglia | Svuota A:J e invalida la cache del thread. |
| Data valida, recente o esattamente sulla soglia | Conserva la riga. |
| Data anomala senza osservazione valida | Registra oggi nella nota, conserva tutti i valori. |
| Anomalia osservata da oltre la soglia | Svuota la riga alla successiva esecuzione utile. |
| Aggiornamento reale dopo l'anomalia | La data valida governa la scadenza; rimuove il marcatore tecnico. |
| Nota tecnica cancellata, corrotta o futura | Riparte l'osservazione; non cancella immediatamente. |
| Errore di scrittura | Non conta la scrittura fallita come eliminazione; invalida la cache coinvolta anche se l'esito è incerto. |

## Dimensioni preservate

- Nessun nuovo prompt o chiamata AI; nessuna variazione a classificazione, modelli, budget, strategia e validazione.
- Prima della scadenza, flag sensibili, stato di presenza e argomenti già trattati restano identici. Dopo la cancellazione si perde l'intera memoria del thread: non è una dichiarazione che una difficoltà sia risolta.
- Non riscrive né sposta le righe conservate. Mantiene note manuali, formattazione e dati oltre J. Le cancellazioni contigue sono raggruppate; non viene compattato il foglio e possono restare righe vuote. I conteggi di memoria considerano i thread presenti, non l'ultima riga fisica.
- Le note tecniche richiedono scritture aggiuntive solo quando nasce o si risolve un'anomalia. Errori e interruzioni possono posticipare la pulizia: i 30 giorni non costituiscono una cancellazione puntuale garantita.
- CacheService viene invalidato per gli identificativi eliminati, inclusi i chunk tramite il metodo già esistente. L'invalidazione resta best effort; non elimina copie già lette da esecuzioni concorrenti.

L'uso delle note e la cancellazione del solo contenuto seguono l'API ufficiale [Apps Script Range](https://developers.google.com/apps-script/reference/spreadsheet/range). Il test simula il foglio; non sostituisce una verifica dell'installazione GAS.

## Documentazione

Aggiornati `SECURITY_IT.md` e `SECURITY.md` sul comportamento effettivo: sintesi e flag possono permanere nelle conversazioni attive, non hanno una scadenza propria e non sono eliminati da Gmail, revisioni, backup o note manuali tramite questo cleanup. Il trigger previsto dal codice è settimanale; la sua presenza in produzione non è stata verificata. La revisione è tecnica e limitata alla conservazione locale; le altre affermazioni dei documenti su basi giuridiche e condizioni del fornitore non sono state rivalutate.

## Collaudo e stato

- Suite CI completa superata: smoke, unit e **34 file di test modulari**.
- Controllo sintattico superato su **66 file JavaScript**; `git diff --check` superato.
- Nuovo `tests/test_memory_retention.js`: soglia esatta, dati recenti, date mancanti/invalide/future, osservazione non rinnovata, aggiornamento reale, nota corrotta, note umane, colonne esterne, errore di scrittura, invalidazione cache e conteggi con righe vuote.
- I test precedenti su sensibilità residua, presenza e qualità dei prompt continuano a passare.

Modifiche soltanto locali. Nessuna memoria reale cancellata, nessuna email inviata e nessun rilascio GAS eseguito. La scadenza autonoma dei singoli flag rimane fuori da questo blocco.
