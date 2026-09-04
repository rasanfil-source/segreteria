# Audit di prompting e memoria conversazionale — 5 settembre 2026

Analisi locale successiva alle correzioni Gmail del commit `f32d156`.
Le correzioni Gmail sono state pubblicate su `main` e applicate ai progetti GAS Parrocchia e donRaimondo. Una lettura via Apps Script API ha verificato che entrambi i file modificati coincidono con il codice locale. Per donRaimondo la scrittura è stata effettuata dall'editor con l'account autorizzato, perché le credenziali CLI avevano accesso in sola lettura.

Validazione delle correzioni: suite CI completa superata, 29 moduli Node, controllo sintattico superato. Nessuna email reale inviata per i test.

## Problemi confermati e ancora aperti

### 1. P1 — La memoria può riattivare un vincolo di distanza smentito dal messaggio corrente

Riferimenti: `gas_email_processor.js:1795`, `gas_email_processor.js:7398`, `gas_prompt_context.js:392`.

Caso: nella memoria esiste `remote_user: true`; l'utente scrive «Ora sono a Roma. Posso venire domani?». QuickCheck restituisce correttamente `has_constraint: false` e `visit_policy: visit_ok`. Il merge in `processThread` sostituisce però questo risultato con un nuovo vincolo geografico derivato dalla memoria.

La deroga locale funziona soltanto quando la sorgente è esattamente `current_local_presence_override`; tale sorgente viene prodotta in un ramo in cui QuickCheck aveva segnalato una distanza, quindi non copre il caso in cui QuickCheck riconosca già l'assenza del vincolo. Inoltre `_deriveContextualFlagsUpdate_` conserva il vecchio flag anche dopo la deroga. `PromptContext` usa a sua volta il flag con un OR e può generare «Non proporre presenza fisica salvo necessità esplicita» anche insieme a un vincolo corrente negativo.

Effetto: istruzioni operative contraddittorie e possibile proposta di modalità remote a una persona che è disponibile a venire; il problema può ricomparire nei messaggi successivi.

Correzione proposta: distinguere assenza di nuove informazioni da una smentita esplicita e affidabile; dare precedenza alla seconda, cancellare il flag persistente tramite un aggiornamento `false` e condividere il vincolo risolto tra processor e PromptContext.

### 2. P2 — Il fallback della strategia di risposta è bloccato anche senza vincoli

Riferimenti: `gas_email_processor.js:2686`, `gas_email_processor.js:2751`, `gas_prompt_engine.js:1063`.

`_resolvePhysicalPresenceConstraint_` restituisce un oggetto anche quando non esiste alcun vincolo (`has_constraint: false`). La selezione della strategia verifica la veridicità dell'intero oggetto invece del suo campo `has_constraint`. Perciò `hasStrongerResponseRoutingSignal` diventa vero anche per una normale domanda informativa.

Caso riprodotto: postura `urgent`, strategia esplicita `none`, nessuna memoria e nessun vincolo. Il risultato è `none`, benché la mappatura della postura preveda `reduce_user_effort`. Il processor passa anche `responseStrategyInferenceBlocked: true` al PromptEngine, che rispetta il blocco e non recupera il fallback.

Effetto: le strategie ricavate dalla postura non vengono applicate nel percorso normale quando QuickCheck non fornisce una strategia esplicita valida. Non significa che il modello non possa comunque rispondere correttamente, ma manca l'istruzione prevista dal progetto.

Correzione proposta: verificare `physicalPresenceConstraint.has_constraint` e applicare a eventuali focus memorizzati gli stessi controlli di argomento e scadenza usati dal PromptEngine.

### 3. P2 — Un argomento appena aggiornato può essere eliminato dalla memoria

Riferimenti: `gas_memory_service.js:1598`, `gas_memory_service.js:1622`, `gas_memory_service.js:616`, `gas_memory_service.js:216`.

`_mergeProvidedTopics` utilizza una Map. Aggiornare una chiave esistente ne sostituisce i dati ma non la sposta alla fine. Il limite di memoria e `getRecentProvidedInfo` considerano invece recenti gli ultimi elementi dell'array, indipendentemente dal timestamp.

Caso riprodotto con il limite predefinito: 50 argomenti memorizzati, aggiornamento odierno del primo e aggiunta di un nuovo argomento. Dopo il taglio a 50 elementi, l'argomento appena aggiornato scompare; rimangono altri argomenti più vecchi.

Effetto: perdita di informazioni appena fornite e indicazioni anti-ripetizione incomplete nei messaggi successivi. Anche prima del raggiungimento del limite, la lettura degli ultimi argomenti può escludere quello appena aggiornato.

Correzione proposta: stabilire un ordinamento coerente per ultima interazione, spostando in coda i topic aggiornati o ordinando per timestamp prima dei tagli e delle letture recenti.

## Riproduzione e limiti

Eseguire `node scratch/audit_prompt_memory_repros.js` dalla radice del repository.
Lo script esegue i metodi reali e, per i due passaggi di orchestrazione, i blocchi estratti direttamente da `processThread`. Gli assert confermano i difetti attuali: è diagnostica, non una suite che ne dichiara la risoluzione.

I tre problemi di questo rapporto non sono stati corretti o distribuiti: questa fase della richiesta era un'analisi. Non sono state lette conversazioni personali o modificate le righe della memoria reale. Gli effetti sulle risposte del modello sono dedotti dalle istruzioni prodotte; le contraddizioni e la perdita dei topic sono riprodotte deterministicamente.

## Vincolo di esercizio: tutto gratis

Il proprietario richiede costo Gemini pari a zero come vincolo assoluto, con traffico ridotto e senza sprechi di quota. Non attivare fatturazione, passaggi a tier a pagamento o funzionalità a pagamento. Le eventuali correzioni ai tre problemi sopra devono essere deterministiche, senza aggiungere chiamate LLM o ampliare indiscriminatamente i prompt.

Le correzioni Gmail pubblicate non introducono chiamate Gemini, non cambiano modelli, prompt, limiti o retry Gemini. La scansione conserva i limiti per esecuzione; il recupero di richieste prima invisibili può aumentare il numero totale di email effettivamente elaborate e quindi il consumo necessario per rispondere a esse. Il limite configurato di due thread per esecuzione non equivale a due chiamate Gemini al giorno: possono esserci più esecuzioni e più fasi AI per email.

Le quote locali (1.500 richieste/giorno per Flash e 1.000 per Lite nella configurazione corrente) non sono una prova delle quote reali disponibili. Secondo la documentazione ufficiale Google, i limiti effettivi sono visibili in AI Studio e si applicano al progetto, non alla singola API key. Se chiavi di riserva o due GAS condividono un progetto Gemini, occorre tener conto del consumo aggregato: i contatori locali per modello logico non dimostrano da soli quel totale.

Fonti verificate: https://ai.google.dev/gemini-api/docs/rate-limits e https://ai.google.dev/gemini-api/docs/billing. Non è stato verificato in questo audit il tier di fatturazione effettivo dei progetti Gemini, né sono state cambiate le relative impostazioni.
