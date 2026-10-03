# Installazione e deploy

Allineato al codice locale il 3 ottobre 2026. [English](DEPLOYMENT.md)

## Preparazione

1. Usare un progetto Google Apps Script V8 con accesso alla casella e allo spreadsheet previsti.
2. Caricare `appsscript.json` e i moduli runtime della radice, compresi **tutti gli undici `gas_thread_*.js`**. Non caricare `gas_config.example.js` al posto di `gas_config.js`.
3. Verificare i servizi avanzati dichiarati nel manifest: Gmail v1 e Drive v3, fuso `Europe/Rome`, autorizzazioni richieste. Il manifest comprende accesso a Gmail, Drive, Docs, Slides, Sheets, richieste esterne, trigger e invio.
4. Configurare almeno `GEMINI_API_KEY` e `SPREADSHEET_ID` nelle Script Properties; controllare identità, alias, destinatari alert ed eventuale chiave backup. Le impostazioni sono distinte per progetto.
5. Preparare i fogli indicati nella [configurazione](CONFIGURATION_IT.md). Per il setup UI serve lo spreadsheet attivo: `setupConfigurationSheets()` ricrea il layout di Controllo conservando i valori esistenti. Per soli vincoli usare `applyValidationOnly()`.
6. Impostare B2 e F2 consapevolmente: **Tutte le lingue** o **Solo straniere**. Il cambio lingua non richiede un deploy; leggere [semantica di F2 e `·`](LANGUAGE_MODES_IT.md).

## Verifica locale

```powershell
pwsh.exe -NoLogo -NoProfile -Command "node scripts/run_ci_test_suite.js"
pwsh.exe -NoLogo -NoProfile -Command "git diff --check"
```

Il runner esegue smoke, unitari e tutti i test modulari, con copertura obbligatoria dei validatori. Non chiama Google/Gemini. `DRY_RUN=true` in GAS impedisce l'invio della risposta ma non rende l'esecuzione offline: può consumare quote e produrre log o stato tecnico.

## Caricamento con clasp

`.clasp.json` seleziona il progetto locale; `rootDir` è `./`. `.claspignore` esclude documentazione, test modulari, script locali, maintenance, scratch e outputs. Il file `gas_unit_tests.js` e lo script una tantum presente nella radice non sono esclusi automaticamente: controllare l'elenco prima del push.

`scripts/deploy_gas.ps1` carica in sequenza due ambienti tramite `clasp.cmd push -f`. Gli ID provengono dalle variabili `GAS_PARROCCHIA_SCRIPT_ID` e `GAS_DON_RAIMONDO_SCRIPT_ID`, oppure dalle omonime chiavi di `scripts/deploy_gas.local.json` (ignorato da Git). Le variabili d'ambiente hanno precedenza.

```powershell
pwsh.exe -NoLogo -NoProfile -Command "& ./scripts/deploy_gas.ps1"
```

Questo comando **modifica entrambi i progetti remoti**. Lo script conserva e ripristina la configurazione clasp locale nel blocco di chiusura; un fallimento del secondo ambiente non annulla il caricamento del primo. Non esegue automaticamente test, commit, push Git o installazione dei trigger.

## Attivazione sul progetto GAS

Dopo autorizzazione e verifica della configurazione, eseguire `setupAllTriggers()`:

| Handler | Pianificazione configurata |
|---|---|
| `main` | Ogni 5 minuti |
| `weeklyMemoryCleanup` | Domenica, ora 3 |
| `exportMetricsToSheet` | Ogni giorno, ora 23 |

`setupTrigger()` è alias di setup completo; `setupProductionTrigger()` installa soltanto il trigger principale. `setupMainTrigger(minutes)` sceglie un intervallo supportato tra 1, 5, 10, 15 e 30 minuti. La vecchia `setupWeeklyMemoryCleanupTrigger()` è un no-op deprecato.

`healthCheck()`, `testConfiguration()` e le Esecuzioni aiutano a controllare l'ambiente; non dimostrano da soli una consegna email. `main()` può inviare quando il sistema è attivo e dry-run è falso.

## Dopo il rilascio

Verificare revisione distribuita, trigger, proprietà, accesso ai fogli, F2, etichette del singolo messaggio e coda Verifica. Per gli esiti incerti seguire il [runbook operativo](TROUBLESHOOTING_IT.md), senza rimuovere marker per tentare indiscriminatamente un nuovo invio.

Questa revisione documentale non esegue né attesta un deploy. I report datati descrivono verifiche locali al momento indicato.
