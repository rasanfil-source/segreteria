# Riferimento tecnico GAS

Aggiornato al 3 ottobre 2026.

Il codice usa file `gas_*.js` globali GAS V8. Non esiste un modulo runtime `KnowledgeBaseService.gs`: il caricamento KB avviene in `gas_main.js`. L'orchestratore dipende dagli undici componenti `gas_thread_*.js`.

- [Architettura e responsabilità](../ARCHITECTURE_IT.md)
- [Configurazione, Script Properties e Controllo](../CONFIGURATION_IT.md)
- [Tutte le lingue / Solo straniere](../LANGUAGE_MODES_IT.md)
- [Deploy e trigger](../DEPLOYMENT_IT.md)
- [Esempi operativi](gas_usage_examples.md)
- [Checklist](gas_test_checklist.md)

Le vecchie API schematiche come `KnowledgeBaseService.loadKB()` o `MemoryService.getHistory()` non devono essere usate come chiamate disponibili. Per la memoria l'orchestratore usa `getMemory(threadId)`; consultare i metodi effettivi nei sorgenti prima di integrare strumenti locali.
