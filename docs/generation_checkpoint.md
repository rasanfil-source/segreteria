# Ripresa della cascata di generazione

La generazione conserva in Script Properties un cursore `generation_progress_<threadId>`, associato all'ID del messaggio candidato. Non aggiunge etichette Gmail o modifiche visibili all'email. Non conserva prompt, risposta o chiavi API.

Dopo che una strategia modello/chiave ha restituito un errore per cui era gia previsto un fallback, ne registra il completamento. Se il tempo residuo impedisce il prossimo tentativo, la normale ripresa batch ritrova il cursore e salta le strategie gia esaurite. Prompt, ordine della cascata e retry interni restano invariati. Un'interruzione durante una chiamata non conclusa puo invece far ripetere quella strategia.

Il cursore viene invalidato da un nuovo messaggio candidato, da una diversa sequenza di strategie/modelli o dopo sei ore dalla creazione (scadenza non prolungata dalle riprese). Viene cancellato appena la generazione riesce oppure quando la cascata termina senza risposta: il ciclo successivo puo ripartire dal primario. Non viene salvata la risposta generata: un successivo problema di validazione o consegna conserva le procedure preesistenti. Le protezioni contro invii duplicati non vengono modificate.

La pulizia elimina fino a 50 cursori scaduti per accesso alla fase di generazione, inclusi quelli di thread gestiti manualmente. Se Script Properties non e disponibile, viene segnalato un avviso e rimane il comportamento precedente, senza nuovi blocchi o etichette. Questo stato e distinto dal checkpoint batch: resta utilizzabile anche quando il thread viene riscoperto dal trigger periodico.

Regressioni in `tests/test_generation_checkpoint.js`: riprese successive, successo, nuovo messaggio, cambio configurazione, scadenza, stato corrotto, fine cascata, deadline prima di una chiamata, salto chiave alternativa per modello 404, pulizia e assenza di chiavi API nello stato. Il confronto di caratterizzazione mantiene invariati tutti gli effetti precedenti, eccetto le nuove scritture del cursore coperte dai test dedicati.
