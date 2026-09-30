# Correzioni dei sette rilievi confermati — 30 settembre 2026

Le modifiche riguardano il codice locale. Nessun deploy, invio email o accesso Google/Gemini è stato eseguito durante questa verifica.

## Comportamento corretto

1. **Errori di invio riprovabili:** il trasporto Gmail rilancia gli errori senza applicare `Errore` all'intero thread. ThreadDelivery decide la marcatura dopo la classificazione: quota temporanea lascia il messaggio eleggibile; errore permanente marca soltanto il burst interessato. La gestione degli esiti ambigui rimane distinta.
2. **Certificati e sbattezzo:** il solo riferimento al «registro del battesimo» nel topic non attiva più lo sbattezzo. Restano riconosciuti i segnali espliciti di cancellazione, uscita e sbattezzo.
3. **Indirizzi SNC:** un esito territoriale sconosciuto rimane da verificare manualmente e non diventa `NON RIENTRA`. Il contesto conserva anche l'indicazione SNC; il validatore blocca conclusioni definitive su tale esito.
4. **Più indirizzi:** il contesto passa al validatore gli esiti strutturati dei singoli indirizzi. Le affermazioni vengono confrontate con l'indirizzo pertinente, distinguendo anche civici diversi della stessa via. I contesti testuali precedenti restano supportati. Le frasi definitive prive di attribuzione sono confrontate conservativamente con tutti gli esiti.
5. **Budget Gmail:** il limite giornaliero locale e il mancato lock del contatore non attivano il fallback nativo. Sono errori avvenuti prima dell'invio: la transazione viene annullata e il messaggio rimane riprovabile, senza marcatura di consegna incerta.
6. **FORCE_RELOAD:** la richiesta di ricaricamento salta sia la cache in memoria sia quella persistente, legge Sheets e aggiorna la cache mantenendo il lock esistente. Il riuso ordinario della cache resta attivo quando l'opzione è falsa.
7. **Checkpoint:** rimosso il tetto indipendente a depth=5. L'unica guardia è il lettore, che usa `retryCount >= BATCH_CHECKPOINT_MAX_RETRIES`. Il primo salvataggio continua a valere 1; la semantica corrente della soglia 3 è conservata. Il contatore riparte quando cambia il gruppo pendente; depth resta diagnostico.

Non sono state applicate le aggiunte di parentesi suggerite dall'audit esterno: i due difetti sintattici segnalati non erano presenti.

## Test

**Esito finale:** 114/114 smoke, suite unitaria senza fallimenti, 53/53 suite modulari; 63 scenari di caratterizzazione superati. Sintassi valida su 179 file JavaScript e diff privo di errori di whitespace. Copertura: ResponseValidator 98,67% funzioni / 81,41% blocchi V8; TerritoryValidator 100% / 87,61%. Soglie della policy rispettate. Log locale: `audit-fixes-tests-final.log` nella radice del progetto.

La nuova suite `tests/test_september_audit_fixes.js` copre i sette rilievi con componenti reali e servizi simulati. Include invio rifiutato per quota e successiva selezione, errore permanente, invio riuscito, blocco budget/lock prima del trasporto, certificati e sbattezzo esplicito, territorio SNC, risposte corrette e invertite su più indirizzi, stessa via con civici diversi, predicato prima dell'indirizzo, affermazioni collettive e generiche, ricaricamento e riuso cache, soglie checkpoint 1/3/6/10/20 e reset dopo avanzamento.

Due aspettative dei test esistenti sono state aggiornate per riflettere le correzioni: il trasporto non applica più etichette all'intero thread e depth=5 non impone più un limite separato. Le fixture storiche dei 63 scenari di caratterizzazione non sono state riscritte.

Gli script in `outputs/audit-2026-09-30/repro-*.js` sono prove storiche del comportamento precedente: le loro asserzioni non sono la suite di regressione successiva alle correzioni.

Comandi di verifica:

```powershell
pwsh.exe -NoLogo -NoProfile -Command "node tests/test_september_audit_fixes.js"
pwsh.exe -NoLogo -NoProfile -Command "node scripts/run_ci_test_suite.js"
pwsh.exe -NoLogo -NoProfile -Command "node maintenance/check_syntax.js"
```

Il controllo territoriale è deterministico e basato sul testo: non costituisce una comprensione semantica completa di ogni formulazione naturale. I test locali non attestano il comportamento delle API reali o il codice attualmente distribuito su GAS.
