# Esempi operativi GAS

Aggiornati al 3 ottobre 2026. Eseguire nell'editor GAS, selezionando la funzione prevista; non aggiungere chiamate globali che si attivino al caricamento degli script.

| Operazione | Funzione disponibile | Effetto |
|---|---|---|
| Verifica configurazione | `healthCheck()` | Diagnostica configurazione; non prova una consegna. |
| Trigger completi | `setupAllTriggers()` | Crea main, pulizia memoria e metriche. |
| Solo trigger principale | `setupProductionTrigger()` | Imposta main ogni 5 minuti. |
| Invalidazione risorse | `clearKnowledgeCache()` | Invalida cache risorse per ricaricamento. |
| Caricamento risorse | `primeCache()` | Carica risorse usando i servizi Google. |
| Vincoli foglio | `applyValidationOnly()` | Applica validazioni al foglio attivo. |
| Pulizia memoria | `cleanupOldMemory()` | Rimuove contenuti memoria secondo retention; non email Gmail. |
| Elaborazione | `main()` | Esecuzione operativa: può inviare risposte. |

Per test senza invio della risposta impostare `CONFIG.DRY_RUN=true` nell'ambiente di collaudo. Può comunque accedere ai servizi, chiamare Gemini e scrivere stato/log. Per test offline usare Node:

```powershell
pwsh.exe -NoLogo -NoProfile -Command "node scripts/run_ci_test_suite.js"
```

Per cambiare lingua agire su **Controllo!F2**, non riscrivere il trigger: [Tutte le lingue / Solo straniere](../LANGUAGE_MODES_IT.md). Per gli invii incerti seguire [la procedura](../TROUBLESHOOTING_IT.md).
