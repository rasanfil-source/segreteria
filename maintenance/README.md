# Manutenzione locale

Eseguire dalla radice del repository. Questi strumenti non fanno parte del runtime GAS;
`maintenance/`, `scripts/`, `tests/` e `scratch/` sono esclusi da clasp.

- `check_syntax.js`: verifica ricorsiva locale di sintassi e BOM, comprese eventuali copie in outputs. Il runner di test corrente è `node scripts/run_ci_test_suite.js`.
- `scripts/check_js_syntax.sh` controlla i file elencati da Git: finché le cancellazioni di scratch non sono registrate nel relativo indice/commit, può cercare file già rimossi dal disco. Non ricreare gli script temporanei solo per quel controllo.
- `remove_bom.js`: modifica i file per rimuovere BOM; controllare il diff prima di usarlo.
- `export_legacy_blacklist.js [git-ref]`: esporta offline gli indirizzi personali presenti
  nella vecchia configurazione in `outputs/personal-ignore-senders.local.json`, ignorato
  da Git. Non stampa indirizzi e non modifica Script Properties. Si rifiuta di sovrascrivere
  un export esistente. Procedura completa nel [resoconto](../docs/RELIABILITY_AUDIT_2026-09-22.md).

## Pulizia dei materiali temporanei

Il 29 settembre 2026 sono stati rimossi gli script provvisori e gli inventari di
`scratch/`, i log e i risultati intermedi di test e audit. I riferimenti a questi
materiali nei rapporti precedenti sono storici; i test permanenti restano in `tests/`.

In `outputs/` sono conservati la base di conoscenza Excel aggiornata e
`process-thread-baseline/`, usata dal confronto opzionale dei test di caratterizzazione.

I nuovi artefatti temporanei devono restare in `outputs/` o `scratch/`, già ignorati.
Il percorso assoluto dell'autore in `scripts/update_tests.py` è stato sostituito con
un percorso relativo al file dello script. Non è stata modificata la history Git.

La suite ricrea `outputs/coverage/`; i profili sono temporanei e possono essere eliminati dopo aver registrato gli esiti. Su Windows eseguire i comandi PowerShell con `pwsh.exe -NoLogo -NoProfile -Command "<comando>"`.
