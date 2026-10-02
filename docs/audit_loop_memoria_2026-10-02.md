# Audit anti-loop, memoria e quick check

Correzioni locali applicate all'allegato `4b8e8854-dea2-429f-bcce-c0b8ac9faa32`.

| Segnalazione | Esito |
| --- | --- |
| Ping-pong alternato | Tre coppie consecutive «nostro messaggio → stesso mittente esterno entro 10 minuti», nella finestra recente, portano a Verifica con `possible_email_loop`. Non sono marcate come normalmente gestite. Un dialogo umano molto rapido può richiedere revisione; l'alternanza lenta rimane ammessa. |
| Keyword nel corpo | Filtraggio del corpo consentito solo con `List-Unsubscribe` o `Precedence: bulk/list`. Le parole nell'oggetto e le esclusioni esplicite dei mittenti conservano il comportamento precedente. Le keyword configurate nel foglio seguono la stessa regola. |
| Aggiornamenti parziali memoria | Tutti e tre i metodi preservano `_rawMemorySummary`, incluso il JSON dello stato conversazionale. Il contatore messaggi non viene incrementato. |
| Quick check troncato | Budget iniziale 2048 token, un solo nuovo tentativo a 4096. Il nuovo tentativo attraversa nuovamente il limiter e non ripara/accetta JSON troncato. Un secondo troncamento porta a Verifica, non a Errore permanente. |
| Assenze | Intestazione esplicita «dal: colonna B»; le formule E1:F1, F5 e F6 accettano il precedente inserimento della data iniziale in C quando B non è numerica. B4 e le date esistenti non vengono spostati o cancellati. Le formule sono verificate offline; non è stato eseguito il setup sul foglio reale. |
| Maiuscole | Conservati il pronome formale `Le` e le iniziali seguite da punto. |
| Francese | `Bonjour` accettato fino alle 18; `Bonsoir` dalle 18, coerentemente con la generazione pomeridiana. |
| Corpo MIME | Le righe `From:`, `To:` ecc. restano inalterate nel corpo. La sanitizzazione degli header effettivi resta separata. |
| Sostituzioni | Match letterali con confini Unicode quando la chiave inizia/finisce con lettere o numeri; distinzione tra maiuscole e minuscole. Eventuali varianti devono essere inserite esplicitamente nel foglio. Restano supportati valori contenenti `$` senza interpretazione regex. |
| Marker invio incerto | Pulizia automatica solo quando esiste una conferma persistente ancora valida dello stesso invio. I marker irrisolti non scadono per sola anzianità: eliminarli potrebbe autorizzare un duplicato. Richiedono ancora riconciliazione/revisione. |
| Retry di validazione troncato | Impostato anche `validationFailed = true`, per statistiche coerenti. |

## Policy confermata dall'utente

Free Tier mantenuto, con invio a Gemini anche per richieste formali e crisi. Nessuna modifica alla fatturazione o ai termini del servizio. Memoria mantenuta a 30 giorni di inattività; il TTL dei flag a 180 giorni è soltanto un limite massimo all'interno di conversazioni ancora conservate e non prolunga la ritenzione della riga. La protezione anti-duplicato di 24 ore resta invariata: non è possibile dedurre dal sistema se il destinatario abbia letto la prima risposta o l'abbia trovata nello spam.

## Verifica

Regressioni dedicate in `tests/test_loop_memory_quickcheck_audit.js`: alternanza rapida/lenta, keyword nel corpo, preservazione del JSON nei tre aggiornamenti memoria, budget 2048/4096 con e senza limiter, secondo troncamento in Verifica, sostituzioni, corpo MIME, francese, maiuscole e marker incerti. Aggiornate le aspettative dei test precedenti per la conversazione alternata lenta e il saluto francese. Il test setup conserva i valori utente e controlla i riferimenti delle formule.

Suite completa `node scripts/run_ci_test_suite.js` conclusa con successo: 73/73 file di test modulari, controlli di copertura superati (response validator: funzioni 97,83%, blocchi V8 81,64%; territory validator: funzioni 100%, blocchi V8 87,39%). Log locale: `outputs/residual-loop-audit-final.log`. `git diff --check` senza errori; presenti soltanto avvisi Git sulla conversione LF/CRLF.

Modifiche locali: nessun push o deploy GAS eseguito in questa verifica. Il collaudo offline non certifica lo stato dei due ambienti GAS o del foglio reale.
