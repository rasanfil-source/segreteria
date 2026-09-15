# Sensibilità residua: intervento sui rilievi 1–2

## Perimetro

La memoria delicata conserva valore storico, ma non prova un bisogno personale attuale. Questo intervento limita gli effetti sul prompt e la propagazione dei flag. Non introduce scadenze autonome, non cancella flag o sintesi esistenti e non risolve il problema della loro durata nelle conversazioni attive. La politica di conservazione resta aperta.

## Conseguenze considerate e modifiche

- Lunghezza, più domande, sovraccarico, discernimento territoriale e impedimenti di presenza non bastano a trasformare un seguito operativo in accompagnamento pastorale. Rimangono attive le rispettive istruzioni operative.
- La promozione da `direct` a `personal` richiede anche sensibilità emotiva corrente. I chiamanti legacy non possono promuovere la postura con la sola memoria.
- Registro e saluto seguono la modalità operativa; restano le protezioni per lutto ripreso, crisi e richieste formali, oltre alle posture personali esplicite.
- Il QuickCheck distingue i flag storici dai segnali attuali. È un vincolo del prompt, non una garanzia assoluta sulla classificazione del modello.
- Il salvataggio non deduce più `ongoing_pastoral_process` dalla sola sensibilità longitudinale. Un flag già presente resta conservato; una richiesta pastorale corrente può ancora attivarlo.
- `LONGITUDINAL_TONE_ONLY_MAX_CHARS` resta compatibile ma non decide più il registro. Nessuna nuova chiamata AI, modifica ai modelli o allo schema del foglio.

## Verifiche locali

Suite CI: smoke, unit test e **33 file di test modulari superati**. Controllo sintattico: **65 file JavaScript validi**. `git diff --check` superato.

Il nuovo test `tests/test_residual_sensitivity.js` verifica prompt, contesto, conservazione dei vincoli di presenza, persistenza dei flag su tre turni simulati e controllo del validator contro la riapertura impropria del lutto. Include richieste operative italiane, inglesi e francesi e casi correnti di lutto, postura personale, richiesta pastorale, crisi e formalità. Il test della persistenza usa merge e serializzazione reali, senza scrivere su Google Sheets.

Con `--baseline` confronta gli stessi scenari con HEAD, senza cambiare il checkout. Sei casi operativi su sette passavano a `personal` prima della modifica; nessuno dopo. Il caso breve era già corretto.

| Scenario | Caratteri prima | Caratteri dopo | Differenza |
| --- | ---: | ---: | ---: |
| Breve | 28866 | 28866 | 0 |
| Lungo | 29662 | 30226 | +564 |
| Più domande | 28336 | 28911 | +575 |
| Impedimento di presenza | 32444 | 33068 | +624 |
| Territorio | 29688 | 30252 | +564 |
| Inglese | 28367 | 27968 | -399 |
| Francese | 28474 | 28105 | -369 |

Sono misure dei prompt di generazione sintetici, non token misurati dal servizio. La crescita massima osservata è 624 caratteri, circa 156 token con la stima locale caratteri/4, dovuta alle istruzioni della modalità solo-tono. Il QuickCheck aggiunge inoltre una breve precisazione sulla natura storica dei flag. Non sono stati aumentati i limiti configurati né eliminati blocchi pastorali per ridurre le dimensioni.

## Limiti e stato

Verifica deterministica locale: nessuna email inviata, nessuna generazione AI e nessun rilascio GAS eseguito. La qualità delle risposte reali dipende anche dalla classificazione dei segnali attuali. Rimangono fuori perimetro scadenza dei flag, cleanup, documentazione generale della conservazione e rilievi 3–7.
