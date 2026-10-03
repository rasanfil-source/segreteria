# Valutazione delle segnalazioni del 3 ottobre 2026

Le quattro analisi dell'allegato sono state confrontate con il codice corrente. I diff ripetuti non sono stati contati come nuove segnalazioni. Le correzioni sono locali; nessun deploy o invio email è stato eseguito.

## Primo gruppo

| Segnalazione | Valutazione e intervento |
| --- | --- |
| Email vuote con oggetto segnaposto | Confermata. Il filtro considera anche zero righe e distingue vuoto e saluto. |
| Domande brevi `Re: quando?` | Confermata. Il punto interrogativo impedisce la classificazione come corpo banale, anche nella variante Unicode. |
| Articoli nei ruoli di contatto | Confermata. Conservati `il parroco` e `la segretaria`; vedi anche quarto gruppo. |
| Script Properties nullo | Guardia difensiva aggiunta in configurazione e esempio. Riproducibile con servizio simulato nullo; non è un normale risultato del servizio GAS. |
| Chiave primaria del fallback Gemini | Confermata. Conservata la chiave risolta dalla configurazione. |
| Lock di compatibilità senza `tryLock` | Confermata l'incoerenza. Il ramo ora rispetta la modalità di compatibilità già prevista. |
| 29 febbraio senza anno | Confermata. Anno inferito esplicito nei metadati e confronto con l'anno corrente per il passato. Nessun 28 febbraio artificiale: la data menzionata nell'anno corrente rimane assente quando non esiste. |
| Allucinazioni insieme a riferimento papale | Confermata. Il prompt di correzione include entrambi i problemi. |
| Riconciliazione presenza: dipendenza, oggetto, match successivi | Corretti fallback senza MemoryService, risoluzioni nell'oggetto e scansione dei match successivi. L'esempio con `ieri` era già parzialmente protetto dalla rimozione delle clausole storiche; resta valido il difetto della prima occorrenza negata. |

## Secondo gruppo

| Segnalazione | Valutazione e intervento |
| --- | --- |
| Risposta umana a un autoresponder | Confermata. Una richiesta nel corpo di una risposta può superare l'oggetto ereditato; aggiornato anche il filtro preliminare. |
| Saluti dopo `--` | Confermata. Conservati con `preserveGreetings`, escludendo il delimitatore tecnico. |
| Vincoli personali negati e policy residua | Confermata. Verifica personale anche nel percorso singolo; escluse negazioni geografiche e di assistenza; nessuna policy restrittiva residua senza vincolo attivo. |
| Coda checkpoint e ritardo | Confermata. Thread non tentati prima dei rinviati, ritardo breve per la coda non tentata, ID deduplicati. Il throttle viene comunque rivalutato alla ripresa. |
| Intervallo invernale scambiato per estivo | Confermata. Scansione di tutti gli intervalli e selezione compatibile con i mesi estivi. Non adottato il fallback proposto che poteva restituire ancora il primo intervallo invernale. |
| Stato cooldown JSON non-oggetto | Confermata. `null`, array e primitivi sono normalizzati prima di leggere o persistere il cooldown. |
| Errore transitorio safety valve | Confermata. Lettura protetta con ritorno al limite configurato. |

## Terzo gruppo

| Segnalazione | Valutazione e intervento |
| --- | --- |
| Lock e logger prima del `try` | Confermata. Preparazione e creazione dello stato ora ricadono nel blocco protetto; test con eccezione durante l'inizializzazione. |
| Riordinamento della ripresa e date invalide | Confermata. Ordine del checkpoint preservato e date validate. Corretto anche il refuso della patch proposta che leggeva `a.getLastMessageDate()` per entrambi i thread. |
| Race sul checkpoint | Confermata. Salvataggio sotto lock; rilascio in `finally`, anche se il salvataggio lancia. |
| Eccezione dopo invio confermato | Confermata. Errori di persistenza/pulizia non trasformano l'invio in fallimento; il marker durevole resta se non è confermata la persistenza del backup. |
| Configurazione parziale | Confermata. Default espliciti per validazione, dry run, limite e nomi delle etichette. |
| Knowledge base `[]` o `{}` | Confermata. Normalizzazione a stringa vuota, così si attiva la protezione KB mancante. |
| Anni a tre cifre e date di nascita | Confermata. Anni numerici a due o quattro cifre; esclusione dei prefissi di nascita. |
| `Si, ...` e riflessivi italiani | Confermata. Gestite affermazione senza accento e forme di cortesia, conservando i filtri condizionali francese/spagnolo. |
| Reazioni contaminate dallo storico | Confermata. Analisi del corpo estratto senza ripristinare lo storico quando l'estrazione è vuota; esclusione delle formule di dubbio risolto. |
| Limite e deduplicazione del riepilogo | Confermata. Usato `MEMORY_MAX_SUMMARY_BULLETS` se finito e almeno 1; deduplicazione anche col prefisso `...`. |
| Contenuto operativo dopo saluti | Confermata. Ampliate le espressioni operative per evitare di tagliare annunci di passaggio, ritiro e consegna. |
| Soglie di validazione | Accolta la verifica dell'ordine dopo normalizzazione. Non vietati i valori `(1,10)`: il runtime li interpreta già come percentuali, quindi il divieto sarebbe una nuova restrizione di configurazione, non una correzione necessaria. |

## Quarto gruppo

| Segnalazione | Valutazione e intervento |
| --- | --- |
| Risposte inline `¿` e `¡` | Confermata. Ammessi questi prefissi; non estesa indiscriminatamente la riapertura delle citazioni a parentesi e virgolette. |
| Footer mobile italiano | Confermata. Riconosciuti `Inviato dal mio iPhone` e Outlook Android/iOS. |
| Inferenza `isReply` | Accolta per chiamate con due argomenti. Un booleano esplicito del chiamante resta autorevole. |
| Falsi contatti generici | Confermata. Richiesti ruolo/titolo oppure nome e cognome con iniziali maiuscole. Conservato il caso preesistente `Maria Rossi`, esclusi `email o telefono` e `nessuno`. |
| Budget temporale configurato | Confermata. Controllati tipo, finitezza, intervalli e ordine dei due budget in entrambi i file di configurazione. |
| `startIndex` del checkpoint | Incoerenza confermata; salvato zero dopo lo slice. Il lettore attuale non applicava un secondo slice, quindi il salto descritto era un rischio per altri chiamanti. |
| Ancora conversazione e indirizzi | Aggiunta normalizzazione di array/Set; esclusi messaggi successivi senza data valida usando l'ordine della conversazione. |
| Indirizzo dentro `<...>` | Confermata. Il gruppo deve contenere un indirizzo, non una parte del nome visualizzato. |
| `fuori sede` e footer citati | Confermata. Eliminato il generico match dell'oggetto e analizzato il corpo privo di citazioni. |
| Data esplicita contro `oggi` introduttivo | Confermata. La data esplicita precede il riferimento relativo. L'euristica continua a non risolvere semanticamente ogni messaggio con molte date. |
| Aspettative, importi e durate | Corretti `mi risulta`, storico citato, importi monetari e durate contestuali. `24h` era già escluso dal controllo dell'ora massima. Conservato `15h`, orario valido in francese/portoghese che la patch proposta avrebbe perso. |

## Verifica

- Nuovo test offline `tests/test_report_october_03.js` con casi positivi e negativi, errori simulati dei servizi, rilascio del lock, metadati temporali e correzione con più errori contemporanei.
- Aggiornati i test preesistenti che richiedevano il comportamento errato su invio e checkpoint. Nei test batch con validatore vuoto, la disattivazione della validazione è ora esplicita.
- Suite completa: `node scripts/run_ci_test_suite.js`; log locale in `outputs/report_audit_ci.log` e copertura in `outputs/coverage/summary.json`.
- I test usano servizi simulati: nessuna verifica diretta sul runtime Google Apps Script o su email reali.
