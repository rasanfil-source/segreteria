# Ripresa della cascata di generazione

La generazione conserva in Script Properties un cursore `generation_progress_<threadId>`, associato all'ID del messaggio candidato. Non aggiunge etichette Gmail o modifiche visibili all'email. Non conserva prompt, risposta o chiavi API.

Dopo un errore che consente il passaggio alla strategia successiva, il cursore registra il completamento del tentativo modello/chiave. Se il tempo residuo impedisce il prossimo tentativo, la ripresa batch usa il cursore per saltare le strategie esaurite. Un'interruzione durante una chiamata non conclusa può far ripetere quella strategia.

Il cursore viene invalidato da un nuovo messaggio candidato, da una diversa sequenza di strategie/modelli o dopo sei ore dalla creazione (scadenza non prolungata dalle riprese). Viene cancellato appena la generazione riesce oppure quando la cascata termina senza risposta: il ciclo successivo può ripartire dal primario. La validazione e la consegna hanno stati separati, descritti nei [contratti funzionali](CONTRATTI_FUNZIONALI_IT.md).

La pulizia elimina fino a 50 cursori scaduti per accesso alla fase di generazione, inclusi quelli di thread gestiti manualmente. Se Script Properties non è disponibile, viene segnalato un avviso e la cascata opera senza cursore persistente. Questo stato è distinto dal checkpoint batch e resta utilizzabile quando il thread viene riscoperto dal trigger periodico.

`tests/test_generation_checkpoint.js` verifica riprese successive, successo, nuovo messaggio, cambio configurazione, scadenza, stato corrotto, fine cascata, tempo insufficiente prima di una chiamata, salto della chiave alternativa per modello 404, pulizia e assenza di chiavi API nello stato.
