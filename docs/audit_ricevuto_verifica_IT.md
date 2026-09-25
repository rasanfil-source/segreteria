# Verifica dell'audit ricevuto — 25 settembre 2026

Riferimento della valutazione iniziale: workspace pulito, commit `a16a7d9639564d6b6213dd928e269782afaa7e86`. Le prove iniziali qui sotto precedono le correzioni. Su successiva autorizzazione sono stati implementati i punti 1, 4, 2, 5a e 5b, nell'ordine concordato; risultati nella sezione finale. Nessun invio o chiamata Google/Gemini reale.

## Esito

| Punto | Osservazione | Valutazione della correzione proposta |
| --- | --- | --- |
| 1. Size estimate / documento mancante | Confermata | Correggere, ma distinguere presenza ignota da allegato sicuramente ricevuto. Il diff non è applicabile direttamente. |
| 2. Concordanza femminile | Confermata | Correggere con formulazione/normalizzazione coerente e test grammaticali; la regex proposta copre solo alcuni casi. |
| 3. Check semantico su match | Chiamata confermata; ridondanza non dimostrata | Non escludere indiscriminatamente `match`: è uguaglianza di categoria, non verifica del documento specifico. |
| 4. Duplicati e look-back | Confermata, con problema aggiuntivo prima della lettura allegati | Correggere sia la consultazione sia la registrazione del fingerprint testuale. |
| 5a. Alias light/lite | Confermata | Normalizzare all'ingresso di `buildPrompt`, mantenendo invariato il default corrente `heavy`. |
| 5b. lang=undefined | Confermata | Correzione cosmetica valida: fallback nel log, senza inventare una lingua nei dati di memoria. |

## Prove e correzioni consigliate

### 1. Un allegato non ispezionato viene trattato come mancante

`ThreadAttachments.prepare` salta `getAttachments` quando `sizeEstimate` supera la soglia e registra internamente `message_too_large_for_attachment_download`. Tuttavia `physicalAttachmentsDetected` resta falso; l'array `attachmentSkipped` non viene restituito al chiamante. Inoltre, quando parte la raccolta, l'assegnazione `attachmentSkipped = attachmentData.skipped || []` può perdere motivi del pre-check già registrati.

La riproduzione con messaggio da 52.428.800 byte e soglia di 1.024 byte produce:

```text
downloads = 0
physicalAttachmentsDetected = false
status = missing
hasExpectedDocumentMissing = true
```

Il corpo annuncia un documento allegato. `_buildDocumentDeliveryModel_` non può sapere che la lettura è stata impedita dalla soglia e conclude erroneamente che manca. Il test preesistente in `tests/test_email_processor_batch.js` verifica il mancato download, non questa conclusione documentale.

**Correzione consigliata:** propagare un esito esplicito di ispezione saltata/non verificabile, conservando i motivi sia del pre-check sia della raccolta. Impedire la direttiva “non allegato” quando l'ispezione è incompleta. Bloccare anche la conferma automatica della correttezza del documento.

**Cautela sul diff:** `sizeEstimate` misura il messaggio intero, non dimostra la presenza di un allegato. Riutilizzare semplicemente `unverified_attachment` può attivare la direttiva attuale “Il file è ricevuto”: anch'essa sarebbe ingiustificata se non si è verificata la presenza del file. Occorre un motivo/stato che conservi l'incertezza, oppure adattare la direttiva per questo caso. Preservare il caso in cui il documento sia già disponibile integralmente nel corpo.

### 2. Concordanza della direttiva

`ThreadDocuments.directives` contiene effettivamente le forme fisse `allegata`, `riportata`, `reinviarla`. Con la descrizione “documento pesante”, l'helper produce “il documento pesante” e la direttiva risultante contiene:

```text
Non troviamo allegata né riportata nel testo il documento pesante.
Può cortesemente reinviarla o inserirne i dati nel corpo del messaggio?
```

Il validator ammette già `allegat[ao]` e `riportat[ao]`. Il difetto riguarda le istruzioni fornite al modello; la verifica offline non dimostra che ogni risposta generata ripeta l'errore.

**Correzione consigliata:** costruzione coerente di articolo, genere e numero, oppure formulazione con referente fisso neutro rispetto alla descrizione, adattando il validator se cambia il template. Verificare almeno “il documento”, “la scheda”, “l'attestato”, “un certificato” e descrizioni plurali. La regex suggerita non gestisce, per esempio, “un certificato”, che `_formatExpectedDocumentLabel_` preserva, né i plurali.

### 3. Match tassonomico non significa documento esatto

`ThreadDocuments.assessConsistency` chiama il controllo semantico su `match` quando esiste un'aspettativa documentale esplicita del quick check. Non lo fa indistintamente per ogni `match`.

La prova sul classificatore reale usa:

```text
Annunciato: certificato di battesimo di Mario Rossi
OCR: certificato di battesimo di Lucia Bianchi
Risultato locale: match
expected = received = certificato_battesimo
Chiamate al servizio semantico simulato: 1
```

`_evaluateDocumentConsistency_` confronta soltanto i due tipi restituiti da `_detectDocumentTypeFromText_`. Il `match` non dimostra l'identità, l'intestazione, le date o la completezza del documento. La prova non attribuisce al servizio semantico la capacità garantita di rilevare queste differenze: la sua risposta è simulata e il suo prompt attuale riguarda soprattutto la coerenza tematica.

**Conclusione:** il fatto tecnico segnalato è vero, ma la qualifica “chiamata inutile” non è provata. Il diff riduce una verifica deliberatamente prevista per descrizioni esplicite. Un'ottimizzazione richiede distinguere un'aspettativa generica, interamente coperta dalla tassonomia, da una più specifica; servono test sul comportamento desiderato prima di eliminare chiamate. Non applicare il filtro globale `taxonomyMode !== 'match'` sulla sola base di questo audit.

### 4. Look-back e fingerprint testuale

La guardia in `ThreadSelection.extractAndAggregate` calcola e consulta il fingerprint **prima** dell'elaborazione allegati. `_buildDuplicateReplyFingerprintContext_` controlla gli allegati del messaggio corrente. Il look-back avviene dopo, in `ThreadAttachments.lookBack`; `ThreadDelivery.send` registra poi il fingerprint originario.

Due prove con l'harness esistente:

1. Follow-up “Come da documento già inviato, quali passi devo seguire?”: l'allegato del messaggio `past` viene elaborato e viene salvato un marker `duplicate_reply_v1_*`.
2. Stesso follow-up con un precedente marker confermato: risultato `duplicate_already_replied`, zero elaborazioni allegati. La ricerca del documento precedente non viene raggiunta.

**Correzione consigliata:** escludere conservativamente dalla deduplicazione basata sul solo testo i follow-up che possono dipendere da allegati precedenti, prima di consultare i marker; non registrare il fingerprint quando il contesto effettivo usa allegati recuperati. Riutilizzare il criterio semantico del look-back per evitare due regex divergenti. I marker preesistenti richiedono attenzione: impedire soltanto nuove registrazioni non elimina il blocco anticipato causato da quelli già salvati.

Non cambiare la transazione idempotente per ID messaggio (`sent_*`, `sendstarted_*`, `send_uncertain_*`): è una protezione distinta e deve restare attiva.

### 5. Profilo legacy e log memoria

Due chiamate reali a `PromptEngine.buildPrompt`, con identico input e dipendenze locali simulate, producono:

```text
Profilo: lite  | Saltati: 4 | Sys=17599 caratteri
Profilo: light | Saltati: 0 | Sys=20470 caratteri
```

Il confronto con `lite` si trova sia nella selezione dei template sia nel retrieval della dottrina. Esiste inoltre un chiamante con `promptProfile: 'light'` nei test di qualità del prompt. Non è stato verificato un uso di `light` nel traffico live.

**Correzione consigliata:** canonicalizzare l'alias una volta all'ingresso effettivo di `buildPrompt`, così anche i percorsi successivi vedono `lite`. Il diff dell'audit assume un `promptContext.profile` e un default `standard` che non corrispondono al codice corrente: il valore viene destrutturato da `options`, con default `heavy`, che va mantenuto.

Per la memoria, `ThreadContext.conversation` registra la lingua quando esiste `lastUpdated`, senza richiedere il campo `language`. La prova produce esattamente:

```text
🧠 Memoria trovata: lang=undefined, topics=0
```

Un fallback `n/a` nel solo log è appropriato e di bassa priorità.

## Riproducibilità e priorità

Script locale: `scratch/verify_received_audit.js`.
Risultati completi: `outputs/received-audit-reproductions.json`.

```text
pwsh.exe -NoLogo -NoProfile -Command "node scratch/verify_received_audit.js"
```

Lo script riproduce e asserisce il comportamento difettoso attuale: è materiale di audit, non un test di regressione da aggiungere alla CI senza cambiarne le aspettative. Le chiamate AI e Gmail sono simulate. La suite completa non è stata rieseguita per questa valutazione perché il codice applicativo non è cambiato.

Ordine consigliato per un successivo intervento correttivo: **1 e 4**, poi **2 e 5a**, infine **5b**. Il punto **3** richiede una decisione separata sulla copertura semantica desiderata e non è una correzione automatica giustificata dalle prove disponibili.

## Implementazione autorizzata e verifica finale

Correzioni completate il 25 settembre 2026, dopo la richiesta «procedi nell'ordine da te segnalato».

1. **Dimensioni e consegna non verificata.** `ThreadAttachments` conserva e restituisce i motivi di esclusione anche dopo la raccolta OCR. Controlla i metadati dimensionali di tutti i messaggi aggregati, anche quando un primo allegato è già presente o il budget file verrà esaurito. Il limite vale anche prima del download nel look-back. Una consegna annunciata con ispezione saltata diventa `unverified_attachment`, motivo `attachment_inspection_skipped_for_size`, senza inventare la presenza fisica del file. La conferma automatica è bloccata; una direttiva specifica conferma solo il messaggio e permette di richiedere una copia più leggera solo quando necessaria. La validazione distingue questo caso dall'allegato ricevuto ma non classificabile. I dati compilati nel corpo restano utilizzabili; un documento realmente mancante mantiene `missing`.
2. **Look-back e duplicati.** Un'unica funzione riconosce i riferimenti testuali agli allegati precedenti. La guardia testuale li esclude prima di consultare vecchi marcatori; l'invio evita inoltre di registrare il fingerprint quando è stato usato il look-back. Le transazioni e i marcatori per ID messaggio non sono stati modificati. I test verificano sia un vecchio marcatore già presente sia la ripetizione dello stesso messaggio: un solo invio simulato.
3. **Concordanza.** La richiesta ora usa un referente fisso: «Non troviamo allegata né riportata nel testo la documentazione richiesta («descrizione»). Può cortesemente reinviarla…». La descrizione è una citazione, quindi articoli, apostrofi e plurali non richiedono euristiche grammaticali. Otto casi coprono maschile, femminile, elisioni e plurali; il validatore accetta il template.
4. **Alias e log.** `buildPrompt` normalizza `light` in `lite` prima della selezione dei template e del retrieval; il default resta `heavy`. I prompt risultanti sono confrontati integralmente. La memoria senza lingua produce `lang=n/a` nel solo log.

**Punto 3 dell'audit originale:** nessun cortocircuito generalizzato per `taxonomyMode === 'match'`. Un test con certificati dello stesso tipo ma persone diverse verifica che il controllo semantico venga ancora invocato e che un suo esito negativo simulato impedisca la conferma. Quando l'ispezione è incompleta per dimensioni, il confronto sul solo materiale parziale viene invece sospeso: non può dimostrare l'assenza o l'incongruenza del documento escluso.

### Test e ripristino

- Copia preventiva del workspace: `outputs/audit-fixes-baseline/`, 182 file compreso questo rapporto non ancora tracciato; manifest SHA-256 verificato. La baseline del refactoring precedente resta separata e intatta.
- Nuova suite: `tests/test_audit_corrections.js`. Il primo test ha fallito sul codice originale con `actual: missing`, `expected: unverified_attachment`; il controllo delle false ricevute ha fallito prima dell'aggiornamento del validatore. Tutti i test finali passano.
- Verificati anche messaggi grandi singoli, burst misti in entrambi gli ordini, budget di un solo file e look-back grande. Nessun download/OCR simulato per i messaggi oltre soglia; stato, prompt e contesto di validazione coerenti.
- CI completa: **114/114 smoke**, **152/152 unitari**, **47/47 suite modulari**. Log: `outputs/audit-fixes-ci.log`.
- Copertura V8: `gas_response_validator.js` **99,10% funzioni / 81,76% blocchi**; `gas_territory_validator.js` **100% / 87,61%**. Tutti i vincoli globali e per metodo passano, soglie invariate.
- **63 scenari storici**: la fixture originale non è stata rigenerata. Il test applica soltanto la variazione esplicita per `attachment_lookback`: rimuove la lettura anticipata della guardia testuale e la scrittura/persistenza del relativo marcatore. Ogni altro risultato ed effetto resta confrontato integralmente. Sono ancora esercitati tutti i **41 metodi di fase**, compreso il caricamento in ordine inverso.
- Replay della fixture contro la vecchia copia del workspace e verifica dei suoi **163 hash** superati. `git diff --check` superato.

Comandi di verifica:

```text
pwsh.exe -NoLogo -NoProfile -Command "node tests/test_audit_corrections.js"
pwsh.exe -NoLogo -NoProfile -Command "node tests/test_thread_characterization.js --compare-workspace-baseline"
pwsh.exe -NoLogo -NoProfile -Command "node scripts/run_ci_test_suite.js"
pwsh.exe -NoLogo -NoProfile -Command "git diff --check"
```

Le verifiche sono offline: dimostrano routing, contratti, prompt e controlli deterministici con servizi simulati, non l'efficacia linguistica di ogni futura risposta Gemini. I controlli aggiunti alle false certezze coprono formulazioni italiane e inglesi; non costituiscono un riconoscitore esaustivo di ogni parafrasi. Nessun deploy, push, merge o invio reale è stato eseguito. Lo script `scratch/verify_received_audit.js` resta una riproduzione storica dei difetti e non va usato come suite dopo le correzioni.
