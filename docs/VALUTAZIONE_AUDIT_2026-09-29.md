# Valutazione dei quattro rilievi dell'audit

Verifica del 29 settembre 2026 sul codice locale, con lettura dei chiamanti e riproduzioni Node in memoria. La valutazione iniziale era in sola lettura; le correzioni successivamente autorizzate sono descritte in fondo. Nessun invio, deploy o chiamata Google/Gemini.

## Esito della verifica iniziale

| Rilievo | Valutazione | Impatto dimostrato |
|---|---|---|
| 1. `attachmentSkipped = []` non copre null | Confermato nell'helper; origine OCR ipotizzata non dimostrata nel flusso corrente | Chiamata diretta con null causa TypeError. |
| 2. Regex su clausole non normalizzate | Confermato nell'helper; chiamante corrente già normalizza | Maiuscole falliscono in `collectAll` diretto, ma la riconciliazione corrente rileva correttamente il vincolo. |
| 3. Prefissi dell'oggetto puliti in modo diverso | Confermato | Catene di prefissi alterano il ramo, categoria/confidenza; negli esempi provati la decisione finale resta rispondere. |
| 4. Riga vuota eliminata da filter(Boolean) | Confermato | Manca l'interlinea prevista nell'alert, non le informazioni. |

## 1. Null nel modello documentale

`gas_email_processor.js::_buildDocumentDeliveryModel_` usa `attachmentSkipped.some(...)` senza normalizzare. La riproduzione:

```javascript
processor._buildDocumentDeliveryModel_({
  body: 'Allego il documento.',
  attachmentSkipped: null
});
// TypeError: Cannot read properties of null (reading 'some')
```

Il default del parametro si applica solo a undefined. Tuttavia `ThreadAttachments.prepare` inizializza un array e lo mantiene tale; l'unione dei risultati usa `attachmentData.skipped || []`. `ThreadDocuments` inoltra quel valore. Non è stata trovata una normale uscita OCR che passi null al metodo: il blocco della pipeline descritto dall'audit è una possibilità con input fuori contratto, non un guasto end-to-end riprodotto.

La patch proposta copre null/undefined e altri falsy, ma non oggetti truthy non-array né elementi null. Se si decide di rendere il confine tollerante, usare una normalizzazione esplicita con `Array.isArray` e controllare gli elementi; stabilire anche come trattare dati malformati senza farli sembrare un'ispezione riuscita.

## 2. Maiuscole nei vincoli di presenza

Il primo test usa `compact` minuscolo, ma `collectAll` verifica le clausole del body originale con regex case-sensitive. Sono sensibili alle maiuscole sia il pattern del vincolo sia quello personale (`sono|siamo|ho|...`).

| Corpo | Helper diretto collectAll | Dopo _presenceAssertionText_ | _reconcilePhysicalPresenceConstraint_ |
|---|---|---|---|
| sono in ospedale | health | health | health |
| Sono in Ospedale | nessun match | health | health |
| SONO IN OSPEDALE | nessun match | health | health |

Il chiamante corrente in `_reconcilePhysicalPresenceConstraint_` costruisce `currentAssertions` mediante `_presenceAssertionText_`, che converte in minuscolo e normalizza gli accenti. Perciò il difetto dell'helper non dimostra che oggi “Sono in Ospedale” perda il vincolo nella pipeline.

La patch `text.split('\n')` risolve il caso di maiuscole, ma `text` comprende **oggetto e corpo**, mentre il controllo originale usa solo il corpo. Cambia quindi anche il perimetro delle evidenze. Una correzione circoscritta dovrebbe normalizzare il corpo conservando la separazione delle clausole; eventuale uso dell'oggetto va deciso e verificato esplicitamente. Conservare test per negazioni, citazioni, ipotesi e condizioni di terzi.

## 3. Prefissi Re/Fwd concatenati

`gas_classifier.js::classifyEmail` calcola `subjectForChecks` eliminando l'intera catena iniziale, mentre `subjectClean` ne elimina solo un prefisso. Usare la lunghezza di `subjectForChecks` evita l'incoerenza.

Riproduzioni con corpo vuoto e `isReply=true`:

- `Re: Orari messe` → `shouldReply=true`, categoria null, confidenza 0.8.
- Quattordici `Re:` prima di `Orari messe` → `shouldReply=true`, categoria information, confidenza 0.85: i prefissi residui impediscono l'accesso al ramo breve.
- `Re: Ab` → confidenza 0.75; `Re: Fwd: Ab` → 0.8: il testo utile breve supera la soglia solo grazie al prefisso residuo.

La patch proposta è coerente con la normalizzazione già esistente. Non è stato dimostrato che questi casi impediscano una risposta: cambiano il percorso e i metadati. La priorità è inferiore a un guasto di invio o a un controllo di sicurezza perso.

## 4. Interlinea dell'avviso

In `_notifyValidationReview_`, la stringa vuota dopo l'introduzione viene eliminata da `.filter(Boolean)`. Il corpo resta leggibile e i campi successivi sono separati da newline, ma manca la riga bianca prevista.

Inserire `\n` nella prima stringa, come proposto, mantiene l'interlinea con il join successivo. È una correzione cosmetica circoscritta. In alternativa si può separare il paragrafo introduttivo dai campi facoltativi.

## Stato delle verifiche

La suite completa eseguita nella stessa sessione ha superato 114 smoke test, la suite unitaria senza fallimenti e 51 suite modulari. Copertura: response validator 99.11% funzioni / 81.93% blocchi V8; territory validator 100% / 87.61%. Questi risultati descrivono il codice **prima di eventuali correzioni** ai quattro rilievi.

## Correzioni applicate dopo autorizzazione

- Lista allegati: null e undefined sono trattati come lista assente. Un valore non-array genera un errore di contratto esplicito; non viene convertito silenziosamente in un'ispezione riuscita. Documento annunciato ma assente resta missing; esclusione per dimensioni resta unverified_attachment.
- Presenza fisica: in collectAll le clausole del solo corpo sono convertite in minuscolo e normalizzate come il testo di ricerca. L'oggetto non è concatenato alle clausole personali; negazioni e separazione delle righe sono preservate.
- Classifier: il controllo di lunghezza usa subjectForChecks, già privo dell'intera catena di prefissi.
- Alert: il newline nella frase introduttiva conserva l'interlinea anche dopo il filtro dei campi facoltativi.

La nuova suite [test_audit_helper_contracts.js](../tests/test_audit_helper_contracts.js) falliva sui quattro difetti prima delle patch e passa dopo. Controlla anche i casi senza documento, dimensioni eccessive, tipi non validi, negazioni, condizioni di terzi, citazioni/ipotesi nella riconciliazione e soglie di lunghezza dell'oggetto.

**Verifica finale:** 114/114 smoke, suite unitaria senza fallimenti e **52/52 suite modulari**; soglie di copertura rispettate, con percentuali dei due validatori invariate rispetto al controllo iniziale. Diff privo di errori di whitespace. Le modifiche restano locali, senza deploy.
