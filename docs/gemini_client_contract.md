# Contratto Concettuale GeminiClient

Questa nota descrive il contratto ideale verso Gemini dopo i primi refactoring:

- `GeminiContentClient` incapsula gia payload, profili task, safety settings e parsing base.
- `EmailQuickCheckPolicy` contiene la policy dominio del quick-check email.
- `GeminiService` e ancora la facade pubblica usata da `EmailProcessor`.

L'obiettivo futuro non e introdurre un framework generico, ma rendere esplicito il confine fra:

- esecuzione tecnica di task AI;
- policy email/parrocchia che decide quando chiamare o non chiamare l'AI.

## Interfaccia Ideale

```js
const result = geminiClient.runTask({
  task: 'quickcheck', // 'quickcheck' | 'reply' | 'langdetect' | 'semantic' | 'ocr_summary'
  context: {
    threadId: '...',
    messageId: '...',
    subject: '...',
    body: '...',
    language: 'it',
    prompt: {
      systemInstruction: '...',
      userPrompt: '...'
    },
    policyHints: {
      documentSubmission: false,
      sponsorGuidanceCheck: false,
      sensitivePastoral: false
    }
  },
  attachments: [],
  options: {
    forceModel: null,
    apiKey: null,
    skipRateLimit: false,
    maxRetries: null,
    idempotencyKey: null
  }
});

// Output uniforme
{
  success: true,
  task: 'reply',
  data: {
    text: '...',
    json: null,
    classification: null
  },
  error: null,
  modelUsed: 'gemini-3.5-flash',
  keyUsed: 'primary',
  attempts: [
    {
      model: 'gemini-3.5-flash',
      key: 'primary',
      status: 'success',
      errorType: null
    }
  ],
  usage: {
    estimatedTokens: 1234
  }
}
```

Per errori:

```js
{
  success: false,
  task: 'reply',
  data: null,
  error: {
    type: 'QUOTA_EXCEEDED',
    message: 'QUOTA_EXHAUSTED...',
    retryable: true,
    source: 'gemini'
  },
  modelUsed: null,
  keyUsed: null,
  attempts: [...],
  usage: {
    estimatedTokens: 1234
  }
}
```

## Responsabilita del Client

Il client dovrebbe occuparsi di:

- scegliere il modello tramite `getModelNameForTask(task, fallback)`;
- leggere la strategia da `CONFIG.MODEL_STRATEGY`;
- stimare i token tramite `_estimateTokens` / `estimateTokenCount`;
- costruire payload Gemini text/json/multimodal;
- applicare i profili task: `temperature`, `maxOutputTokens`, `responseMimeType`;
- applicare safety settings comuni;
- gestire retry con exponential backoff;
- classificare errori tecnici in forma uniforme;
- gestire failover primary/backup key quando l'errore riguarda quota, permessi o API key;
- preservare il risultato normalizzato `{ success, data, error, modelUsed }`;
- mantenere log tecnico di tentativi, modello e chiave usati.

In pratica, `GeminiClient.runTask` sarebbe il posto in cui vive la meccanica Gemini.

## Responsabilita dei Task

Ogni task dovrebbe avere un profilo e un adapter.

```js
const GEMINI_TASKS = {
  quickcheck: {
    strategyKey: 'quick_check',
    defaultModel: 'gemini-3.1-flash-lite',
    output: 'json',
    profile: 'quick_check',
    buildInput: EmailQuickCheckPolicy.buildPrompt,
    normalizeOutput: EmailQuickCheckPolicy.normalizeApiResponse
  },
  reply: {
    strategyKey: 'generation',
    defaultModel: 'gemini-3.5-flash',
    output: 'text',
    profile: 'generation'
  },
  langdetect: {
    strategyKey: 'language',
    defaultModel: 'gemini-3.1-flash-lite',
    output: 'json',
    profile: 'language'
  }
};
```

Questo mantiene il client generico, ma lascia ai task il modo di costruire e interpretare il contenuto.

## Cosa Spostare da EmailProcessor

Queste parti oggi in `EmailProcessor` potrebbero scendere verso `GeminiClient` o una facade `GeminiTaskRunner`.

### Catena model strategy per la risposta finale

Oggi `EmailProcessor` costruisce e itera la catena `CONFIG.MODEL_STRATEGY.generation`, provando modelli e chiavi in sequenza. Questo e candidato forte da spostare.

Contratto futuro:

```js
geminiClient.runTask({
  task: 'reply',
  context: {
    prompt: fullPrompt,
    threadId,
    messageId,
    language,
    classification
  },
  attachments,
  options: {
    qualityFirst: true
  }
});
```

Il client potrebbe restituire `attempts` con tutta la storia dei fallback, lasciando a `EmailProcessor` solo la decisione finale su cosa fare del risultato.

### Fallback primary/backup key

La decisione tecnica "primary esaurita, prova backup" e infrastrutturale. Puo stare nel client, non nella pipeline email.

Il chiamante dovrebbe ricevere solo:

```js
{
  success: true,
  modelUsed: 'gemini-3.5-flash',
  keyUsed: 'backup'
}
```

oppure:

```js
{
  success: false,
  error: { type: 'QUOTA_EXCEEDED', retryable: true }
}
```

### Stima token e scelta profilo

`EmailProcessor` non dovrebbe sapere quanto costa un prompt o se usare un profilo `generation` o `quick_check`. Dovrebbe passare `task` e `context`; il client misura e sceglie.

### Retry tecnico della generazione

Retry/backoff su errori Gemini, 5xx, transient network e quota retryable sono responsabilita del client.

`EmailProcessor` dovrebbe reagire all'esito:

- successo: valida/invia;
- quota: skip temporaneo o checkpoint;
- errore non recuperabile: label di revisione;
- risposta vuota/invalida: eventuale retry intelligente sopra, se il problema e semantico.

## Cosa Lasciare Sopra il Client

Queste parti non dovrebbero scendere nel client, perche sono policy di pipeline o sicurezza applicativa.

### Guardrail che evitano proprio la chiamata AI

Esempi:

- submission documentale senza domanda: genera ricevuta cortese locale;
- thread con ultimo messaggio nostro: skip;
- no external unread: skip;
- out-of-office/newsletter/no-reply: skip;
- `foreign_only` con pre-check italiano affidabile: skip;
- near deadline: dilata invece di chiamare Gemini.

Il client non dovrebbe decidere se una mail merita AI: dovrebbe eseguire task AI quando la pipeline ha gia deciso di chiamarlo.

### OCR e attachment policy

Il client puo inviare allegati gia preparati, ma non dovrebbe decidere:

- se scaricare o no un allegato;
- se l'OCR e consentito dal budget;
- se l'allegato crea un guardrail documentale;
- se bisogna produrre solo ricevuta.

Queste decisioni dipendono da Gmail, sicurezza, quota e policy pastorale.

### Idempotenza invio e label Gmail

Il client non deve sapere nulla di:

- lock thread;
- send transaction;
- label `IA`, skip, verifica, errore;
- marcatura messaggi;
- deduplica invio.

Sono meccanica Gmail e idempotenza della pipeline, non AI.

### Validazione risposta e retry semantico

Il client puo dire "Gemini ha prodotto testo". Non dovrebbe decidere se quel testo e pastoralmente sicuro, contiene thinking leak, inventa orari o va inviato.

La validazione resta sopra, perche riguarda il contratto operativo della risposta.

### Policy pastorali sensibili

Meglio non delegare al client decisioni come:

- risposta prudente su mismatch documentale;
- trattamento di casi pastorali delicati;
- scelte di tono finale;
- quando mantenere contesto dottrinale completo;
- quando oscurare o sanificare guidance padrino/madrina.

Il client puo supportare questi task, ma non possederne la responsabilita.

## Confine Raccomandato

Schema ideale:

```text
EmailProcessor
  decide se chiamare AI
  prepara context business
  applica guardrail no-AI
  valida/invia/label/memoria

Email AI Policy
  costruisce prompt task-specific
  normalizza JSON task-specific
  applica regole di dominio AI

GeminiClient
  seleziona modello/chiave
  stima token
  costruisce payload
  chiama Gemini
  retry/backoff/failover
  normalizza esito tecnico
```

Il prossimo passo incrementale piu sicuro sarebbe spostare nel client la catena `generation` quality-first/fallback-lite, lasciando invariata l'API esterna `geminiService.generateResponse(...)` finche `EmailProcessor` non e pronto a usare `runTask({ task: 'reply' })`.
