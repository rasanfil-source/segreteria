# Checklist di verifica

Riferimento: 3 ottobre 2026.

- [ ] Eseguire `node scripts/run_ci_test_suite.js`: smoke, unitari, suite modulari e soglie di copertura.
- [ ] Verificare caricamento di tutti gli undici `gas_thread_*.js`.
- [ ] Controllare Tutte le lingue / Solo straniere, italiano/lingua estera/unknown, oggetto italiano con corpo estero e rientro dei messaggi con `·`.
- [ ] Verificare label per messaggio, nuovo follow-up su thread già etichettato e burst.
- [ ] Coprire allegati presenti/assenti/non verificati e look-back contestuale.
- [ ] Verificare blocco validazione, retry transitorio, warning post-invio e invio incerto.
- [ ] Verificare memoria, vincoli di presenza, timestamp sconosciuti e retention.
- [ ] Distinguere test offline dai controlli GAS: dry-run impedisce la risposta ma può chiamare servizi.
- [ ] Per un rilascio, verificare separatamente proprietà, trigger e revisione di ogni progetto remoto.

Non usare soglie arbitrarie di “email automatizzate” come prova funzionale. Consultare [copertura](../validator_testing.md), [modalità lingua](../LANGUAGE_MODES_IT.md) e [deploy](../DEPLOYMENT_IT.md).
