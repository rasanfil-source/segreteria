# Manutenzione locale

Eseguire dalla radice del repository. Questi strumenti non fanno parte del runtime GAS;
`maintenance/`, `scripts/`, `tests/` e `scratch/` sono esclusi da clasp.

- `check_syntax.js`: verifica ricorsiva locale di sintassi e BOM, comprese eventuali copie in outputs. Il runner di test corrente è `node scripts/run_ci_test_suite.js`.
- `verify_source_docs.cjs`: verifica commenti JavaScript e collegamenti locali nelle guide. Eseguire con `node --expose-internals maintenance/verify_source_docs.cjs`; il controllo lessicale affianca la revisione umana della lingua.
- `remove_bom.js`: modifica i file per rimuovere BOM; controllare il diff prima di usarlo.
- `export_legacy_blacklist.js [git-ref]`: esporta offline gli indirizzi personali presenti
  nella configurazione del riferimento Git indicato in `outputs/personal-ignore-senders.local.json`, ignorato
  da Git. Non stampa indirizzi e non modifica Script Properties. Si rifiuta di sovrascrivere
  un export esistente. Verificare localmente il JSON e riportare gli indirizzi nella proprietà
  `PERSONAL_IGNORE_SENDERS` di Apps Script, secondo la [configurazione](../docs/CONFIGURATION_IT.md).
  Conservare il file solo per il tempo necessario all'operazione.

## Pulizia dei materiali temporanei

I test permanenti e le fixture restano in `tests/`. Log, inventari e risultati intermedi
sono artefatti locali che possono essere eliminati dopo aver verificato gli esiti.

In `outputs/` sono conservati la base di conoscenza Excel aggiornata e
`process-thread-baseline/`, usata dal confronto opzionale dei test di caratterizzazione.

I nuovi artefatti temporanei devono restare in `outputs/` o `scratch/`, già ignorati.

La suite ricrea `outputs/coverage/`; i profili sono temporanei e possono essere eliminati dopo aver registrato gli esiti. Su Windows eseguire i comandi PowerShell con `pwsh.exe -NoLogo -NoProfile -Command "<comando>"`.
