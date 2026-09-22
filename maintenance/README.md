# Manutenzione locale

Eseguire dalla radice del repository. Questi strumenti non fanno parte del runtime GAS;
`maintenance/`, `scripts/`, `tests/` e `scratch/` sono esclusi da clasp.

- `check_syntax.js`: verifica locale; la verifica CI autorevole è `bash scripts/check_js_syntax.sh`.
- `remove_bom.js`: modifica i file per rimuovere BOM; controllare il diff prima di usarlo.
- `export_legacy_blacklist.js [git-ref]`: esporta offline gli indirizzi personali presenti
  nella vecchia configurazione in `outputs/personal-ignore-senders.local.json`, ignorato
  da Git. Non stampa indirizzi e non modifica Script Properties. Si rifiuta di sovrascrivere
  un export esistente. Procedura completa nel [resoconto](../docs/RELIABILITY_AUDIT_2026-09-22.md).

## Inventario scratch tracciato

L'audit ha trovato 15 file già tracciati in `scratch/`: `.gitignore` non rimuove file già
versionati. Sono conservati intenzionalmente per non perdere strumenti e contesto.

- Diagnostica: `find_bom.js`, `find_bom.py`, `find_bom_recursive.js`, `find_errors.js`.
- Riproduzione storica: `audit_prompt_memory_repros.js` richiama la regressione permanente
  `tests/test_presence_memory_reconciliation.js`.
- Trasformazioni storiche, da non eseguire come manutenzione ordinaria:
  `_patch_chunk.js`, `global_fix_encoding.py`, `merge_files.py`,
  `patch_email_processor.py`, `remove_bom.js`, `surgical_fix.py`.
- Inventari generati conservati come riferimenti storici:
  `all_italian_comments.txt`, `extracted_comments.json`, `remaining_targets.json`,
  `specific_comments.json`. Possono riflettere versioni precedenti: non sono fonti di
  verità per il comportamento corrente.

I nuovi artefatti temporanei devono restare in `outputs/` o `scratch/`, già ignorati.
Il percorso assoluto dell'autore in `scripts/update_tests.py` è stato sostituito con
un percorso relativo al file dello script. Non è stata modificata la history Git.
