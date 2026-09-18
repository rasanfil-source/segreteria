# Allegato corretto e avviso improprio: diagnosi rettificata dai log

## Causa accertata

L'utente ha rettificato la segnalazione: la risposta non ripeteva il calendario. Rispondeva alla domanda sul luogo, ma chiedeva inutilmente di verificare e reinviare il modulo ordinario, corretto secondo l'utente.

Il log mostra categoria TECHNICAL e domanda riconosciuta. Il PDF `Corso-di-preparazione-al-Matrimonio.pdf` viene passato come blob visivo. Il ramo PDF di `getProcessableAttachments` produce soltanto metadati testuali, non OCR delle pagine. La tassonomia locale non riconosce il nome e restituisce `unknown_received`.

Il controllo semantico testuale restituisce `consistent:true`, ma non vede il blob: non è una verifica del contenuto. Il processor impone comunque il template di verifica/reinvio per `unverified_attachment`; il validator pretende la stessa formula. La generazione riceve quel vincolo oltre al PDF. Questa è la causa dimostrata dell'avviso, indipendente dai successivi timeout/503 e dal fallback del modello.

## Correzione finale e conseguenze

- L'incertezza di classificazione non impone più un avviso o un reinvio. Si conferma la ricezione e si risponde alla domanda, senza certificare completezza, validità o iscrizione avvenuta.
- Il validator ammette la risposta ordinaria e continua a rilevare il falso mismatch nel ramo di incertezza. Revisione del 18 settembre: rifiuta anche la vecchia formula di verifica/reinvio basata sulla sola incertezza, verificata con il testo effettivamente segnalato. La direttiva è etichettata come contesto interno, non come avviso da riportare al mittente.
- Il controllo semantico si astiene se ha soltanto il nome o i metadati «File visivo inviato»: non sono testo letto nel documento.
- Quando dispone di testo, il prompt richiede pertinenza sostanziale: «corso di preparazione al matrimonio» e «corso prematrimoniale» sono equivalenti. Titoli diversi non giustificano un allarme; l'esito negativo richiede contenuto chiaramente estraneo. L'incertezza è ammessa.

Annullate le modifiche alla categoria dei moduli, al renderer generale e alla tassonomia introdotte nella prima analisi. La presunta ripetizione della risposta non era avvenuta e non giustifica modifiche di routing.

Nessuna nuova chiamata AI; il controllo testuale viene evitato senza testo utile. Configurazione, modelli, memoria e distribuzione invariati. Restano i controlli preesistenti per documenti mancanti e incongruenze; la tassonomia locale non è stata riscritta.

## Limiti

Un PDF solo visivo non è verificabile dal controllo ausiliario testuale: questo deve astenersi. Non è stato aggiunto un secondo controllo multimodale. Non è stato ispezionato il PDF originale. Il giudizio semantico è fallibile e le istruzioni non garantiscono un esito perfetto.

Il log mostra anche memoria assente per quel thread: dato separato dall'avviso documentale. Il log contiene inoltre una chiave API nell'URL di un timeout: non viene copiato nel repository; la chiave esposta va sostituita nelle Script Properties.

## Verifiche

Suite CI completa superata: smoke, unit e **36/36 file modulari**. Regressione sul nome effettivo, metadati visivi, `unknown_received`, domanda sul luogo preservata e assenza del template obbligatorio di reinvio. I servizi AI sono simulati: i test verificano flusso e istruzioni, non la risposta futura del modello.

Aggiornamento su GitHub e deploy completato su entrambi gli ambienti GAS (PARROCCHIA e donRaimondo). `gas_config.js` intatto e tracciato.
