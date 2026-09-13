# Collegamenti email e moduli di iscrizione

Modifiche locali del 13 settembre 2026. Nessun push o aggiornamento GAS eseguito.

## Script

- `gas_prompt_engine.js`: collegamenti Markdown descrittivi, URL fedeli alla KB comprese ancore e parametri; terminologia italiana «modulo»; distinzione tra compilazione online e PDF.
- `gas_gmail_service.js`: sottolineatura esplicita dei collegamenti HTML, oltre al colore esistente. Conservati conversione sicura e alternativa solo testo con URL tra parentesi.
- `tests/test_gmail_service.js`: verifica ancora, etichetta, sottolineatura, alternativa testuale e rifiuto di URL pericolosi.

## KB locale

File aggiornato: `outputs/link-email-2026-09-13/Base di Conoscenza AI.xlsx`. Originale in Downloads conservato.

25 celle aggiornate tra valori e collegamenti nativi. Conservati nove fogli, 39 formule e contenuti estranei alla modifica. Le cinque righe dei moduli hanno testo su due righe per distinguere le destinazioni.

| Percorso | Collegamento al modulo online |
| --- | --- |
| Prima Comunione | https://www.parrocchiasanteugenio.it/prima-comunione/#modulo-catechesi |
| Cresima ragazzi | https://www.parrocchiasanteugenio.it/cresima-ragazzi/#modulo-catechesi |
| Buon Pastore | https://www.parrocchiasanteugenio.it/catechesi-del-buon-pastore/#modulo-buon-pastore |
| Cresima adulti | https://www.parrocchiasanteugenio.it/cresima-per-adulti/#modulo-cresima |
| Corso prematrimoniale | https://www.parrocchiasanteugenio.it/corsi-prematrimoniali/#modulo-matrimonio |

Ancore rilevate nel codice pubblico delle pagine. In `Istruzioni!C106,C113,C120,C124,C135` sono riportati sia il modulo online sia il relativo PDF, ricavato dalla pagina. La pagina generale di catechesi non contiene un proprio modulo.

Risolti nove TinyURL: cateche, buonpastore, cresimapr, prematri, terrasanta26, 2026PTS, septs2026, cammino26 e santiago26. Sostituiti nel testo e negli hyperlink, anche nel foglio DEPOSITO. I primi quattro puntavano ai PDF: i collegamenti ai moduli online sono aggiunte distinte, non destinazioni attribuite ai vecchi TinyURL.

Rimosso da `Istruzioni!C133` il collegamento errato al PDF prematrimoniale nella voce sulle Cresime a San Giovanni Laterano; conservato il testo con il contatto della sagrestia.

In `ConversationMemory!I18` resta una citazione storica troncata a `https://tinyurl.`: non è un indirizzo risolvibile e non è stata ricostruita arbitrariamente. I link bit.ly e gli altri servizi non TinyURL sono stati censiti ma non modificati.

## Verifiche e pubblicazione

Superata la suite `scripts/run_ci_test_suite.js`: smoke test, unit test e 31 suite modulari. Controllate tutte le celle del file finale rispetto all'originale per valori, formule, hyperlink e formati, ammettendo solo le modifiche previste. Anteprime dei cinque moduli controllate localmente. Non eseguito invio di email reali.

Per attivare il comportamento occorrono sia il codice aggiornato nei due GAS sia l'aggiornamento della KB Google Sheets con le celle modificate del file locale. Pubblicare solo il codice non aggiorna la KB. Il file conserva anche i fogli di memoria e controllo originali: per una KB in uso, trasferire le celle interessate senza sostituire la memoria e i dati operativi più recenti.
