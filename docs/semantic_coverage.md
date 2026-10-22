# Copertura semantica del turno

La configurazione locale usa `SEMANTIC_VALIDATION.completenessAlways: true` e
`completenessMode: 'enforce'`. Dopo la pubblicazione, le risposte che superano i
controlli deterministici ricevono una verifica unica di radicamento, pertinenza e
copertura. Le ricevute costruite localmente dal codice conservano il percorso
dedicato. Il controllo del ragionamento esposto conserva la propria attivazione.

Il classificatore esistente estrae `goal` e `openRequests` dal turno attuale,
interpretato con lo storico. L'analisi documentale esistente integra le richieste
negli allegati. Le citazioni orientano generazione e verifica, ma non sostituiscono
le fonti originali. La verifica può individuare richieste sfuggite all'estrazione.

## Decisioni prima dell'invio

| Esito della copertura | Comportamento in enforce |
| --- | --- |
| Completa, nessun altro errore | Invio consentito |
| Omissione sostanziale | Una rigenerazione concisa e rivalidazione; se persiste, Verifica |
| Contesto indispensabile assente | Verifica, senza giudizio di risposta errata |
| Contratto del controllo incompleto | Verifica, senza assumere assenza di omissioni |
| Indisponibilità tecnica | Attesa e nuovo tentativo secondo il checkpoint del batch |

Un limite informativo può essere legittimo anche senza una frase nella KB. Un
limite del servizio richiede invece una citazione della KB che lo sostenga. Il
parser controlla la presenza della citazione; il giudizio sul suo significato
resta semantico. Le conoscenze generali del modello non autorizzano limiti,
requisiti o capacità del servizio.

Un corpo corrente tagliato impedisce l'approvazione della copertura globale,
anche se una richiesta visibile è trattata. Uno storico o un allegato incompleto
impedisce il giudizio solo quando manca materiale indispensabile per il turno.
Il corpo ha budget configurabile di 16000 caratteri, lo storico di 4000.

`observe` resta disponibile come modalità diagnostica: i rilievi nuovi vengono
registrati senza introdurre correzioni o blocchi; i controlli già esistenti
mantengono la loro efficacia. In `enforce` i giudizi in sospeso restituiscono
`isValid: false` con `pendingSemanticReview`, senza inventare errori di contenuto.

## Verifiche riproducibili

- `node scripts/run_ci_test_suite.js`: verifiche locali, compresi parser,
  cache, attivazione a punteggio 1, un solo retry e mancato invio in attesa.
- `node scripts/run_coverage_model_eval.js`: esporta i prompt dei 23 casi
  sintetici in `outputs/coverage-model-eval/prompts.json`, senza chiamate API.
- `node scripts/run_coverage_model_eval.js --live`: richiede `GEMINI_API_KEY` e
  `GEMINI_EVAL_MODEL` nell'ambiente. Chiama il modello con i prompt del validatore
  di produzione; gli esiti attesi sono esclusi dai prompt. Non accede a Gmail,
  non pubblica il codice e non invia email. Consuma le quote API della chiave.

Il runner distanzia le chiamate di almeno 5 secondi, riprova HTTP 429/5xx fino
a tre tentativi e rispetta il tempo suggerito dal server entro un minuto.
Un 429 persistente sospende i casi residui invece di moltiplicare le chiamate.
Per selezionare casi specifici si può aggiungere `--only C08a,C08b,C08c,C08d`.
Ogni esecuzione archivia il report precedente e salva risposta originale,
diagnostica di contratto, modello effettivo e hash del prompt. Il riepilogo
separa giudizi, errori di contratto e indisponibilità API.

Il campione contiene 23 casi sintetici. `reviewNotes` documenta per ciascun caso
le evidenze e il criterio di valutazione. I casi C04 distinguono i limiti
informativi dai requisiti e dalle garanzie sulla scadenza; C06c verifica un
contesto non determinabile.

Le risposte simulate dei test locali verificano il software, non l'accuratezza
del modello. Una valutazione `--live` misura il modello sul campione configurato;
occorre leggere motivazioni e citazioni insieme agli esiti. Il runner usa HTTP
diretto, quindi non misura le latenze del limitatore GAS.

Il log `SEMANTIC_COVERAGE` registra esito, modalità, cache, latenza, completezza
delle fonti e chiamate logiche aggiuntive. `inputTokensEstimate` è una stima
da caratteri, non un costo fatturato; i retry interni del servizio possono
produrre più richieste HTTP per una chiamata logica.

## Limiti della verifica

Le verifiche locali controllano i contratti del software con risposte simulate;
non attestano l'accuratezza del modello né la disponibilità delle API. La
valutazione `--live` consente di osservare gli esiti del modello sul campione e
consuma la quota della chiave configurata. Un campione finito non dimostra la
fedeltà universale alle fonti e non sostituisce la valutazione nell'ambiente
operativo.
