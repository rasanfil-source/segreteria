# Rilievi 5–7: decisioni, conseguenze e verifiche

## 5. Rischio temporale: protezione conservata

Decisione esplicitamente approvata dall'utente: mantenere `temporal_risk` anche quando le date sono presenti soltanto nella KB. Una richiesta senza date può richiedere una risposta con scadenze; disattivare il controllo sulla base della sola email indebolirebbe la verifica della risposta. La scarsa selettività rimane un possibile miglioramento, senza un difetto dimostrato che giustifichi questa modifica. Aggiunta una regressione per le quattro combinazioni di presenza/assenza di date in email e KB. Nessuna modifica al comportamento temporale.

## 6. Postura: conservare `open`

Il processor convertiva `open` in `appreciative`, mentre renderer e memoria distinguono collaborazione/disponibilità da gratitudine. Ora conserva `open`. La strategia resta `offer_reassurance` in entrambi i casi: cambia il testo delle istruzioni sulla postura, non il criterio di selezione della strategia. I dati già salvati come `appreciative` non vengono reinterpretati o migrati.

Non è stata introdotta una riscrittura generale dei vocabolari: i diversi fallback hanno ragioni diverse (postura sconosciuta ignorata in memoria, fallback diretto nel renderer). Il nuovo test verifica il passaggio processor → renderer/memoria e la strategia per 14 forme canoniche o alias, oltre al testo che distingue `open` da gratitudine.

## 7. Configurazione locale e Git

Per requisito esplicito dell'utente, `gas_config.js` resta tracciato e disponibile nel flusso GitHub → due progetti GAS. La precedente rimozione dall'indice è stata annullata con `git restore --staged -- gas_config.js`, prima di qualsiasi commit o distribuzione. Verificati hash SHA-256 identico e assenza di differenze rispetto a HEAD. Rimossa da `.gitignore` la regola contraddittoria che lo escludeva. Il contenuto della configurazione non è stato modificato.

I test che richiedevano obbligatoriamente il file locale ora usano `gas_config.example.js` quando manca. Con il file presente continuano a verificarlo. `.claspignore` mantiene il file operativo ed esclude l'esempio. Lo script `scripts/deploy_gas.ps1` ora si arresta prima di operazioni esterne se il file operativo manca; non genera né sovrascrive configurazioni. Chi usa clasp direttamente deve comunque seguire la guida di configurazione.

Le guide IT/EN indicano esplicitamente di mantenere il file nel repository e non sostituirlo con l'esempio. Non è prevista alcuna migrazione delle configurazioni degli altri checkout. Le credenziali reali devono restare nelle Script Properties; questo intervento non costituisce un audit completo dei segreti nella cronologia Git.

## Verifiche e limiti

- Suite completa superata nel workspace con configurazione locale: smoke, unit e **35 file di test modulari**.
- Stessa suite superata in una copia temporanea senza `gas_config.js`: **35/35**. Il file operativo originale non è stato spostato né rinominato.
- Sintassi JavaScript valida su **67 file**; `git diff --check` superato.
- Verifica separata del blocco deploy senza configurazione e della sintassi PowerShell.
- Nessun commit, push, deploy, invio email o intervento sui dati reali.

I blocchi precedenti restano inclusi nei test. La scadenza autonoma dei singoli flag non è stata introdotta: il punto 2 è mitigato sul prompting e sulla propagazione, mentre la politica di durata dei flag nelle conversazioni attive rimane aperta.
