# Email policy rules

Questo progetto usa un piccolo layer dichiarativo per alcune decisioni di
`EmailProcessor.processThread`. Lo scopo e separare le policy leggibili
(`match -> action`) dalla meccanica operativa.

## Cosa puo stare nelle regole

- Early exit pre-AI: ultimo speaker interno, newsletter, out-of-office,
  no-reply, ignore rules, classifier locale senza risposta.
- Policy documentali post-OCR: forzare la sola ricevuta quando una submission
  documentale non contiene domande esplicite.
- Routing del contesto prompt: omettere moduli pesanti quando la richiesta e
  tecnica e non emergono concern pastorali, dottrinali o formali.

## Cosa non deve stare nelle regole

- Lock thread e batch.
- Lettura Gmail, discovery unread, metadata e label lookup.
- Idempotenza di invio.
- Quick-check Gemini, generazione, OCR, validazione e retry.
- Classificazione degli errori e scelta tra label permanente o retry.
- Aggiornamento memoria.

Le regole devono restituire decisioni o flag; l'esecuzione resta affidata alle
funzioni imperative gia testate.

## Contratto minimo

Il chiamante costruisce un context con i segnali gia calcolati:

```js
{
  phase: 'post_ocr_policy',
  languageMode: 'foreign_only',
  detectedLanguage: 'it',
  isDocumentSubmission: true,
  hasSubmissionQuestions: false,
  isTechnicalOnly: true,
  state: {}
}
```

La regola puo produrre:

```js
{
  ruleId: 'document-submission-response-policy',
  stop: false,
  state: { forceReceiptOnlyForSubmission: true },
  gmailActions: []
}
```

Per aggiungere una nuova regola, preferire una fase esistente e una action gia
supportata. Se serve introdurre una nuova action, prima verificare se appartiene
davvero alla policy o se sta sconfinando nella meccanica.
