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

- `node scripts/run_ci_test_suite.js`: regressioni locali, compresi parser,
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

Il campione originale di 19 casi è conservato in
`tests/fixtures/coverage_cases_original.json`. Il campione revisionato esplicita
le correzioni in `reviewNotes`, uniforma i codici e aggiunge quattro casi con KB
opposte o silenziose per il medesimo limite. C06c è non determinabile; i casi C04
non inventano requisiti o garanzie sulla scadenza.

Le risposte simulate dei test locali verificano il software, non l'accuratezza
del modello. Solo il report di un'esecuzione `--live` può attestare gli esiti
effettivi di questo campione; occorre leggerne anche motivazioni e citazioni.
Il runner usa HTTP diretto, quindi non misura le latenze del limitatore GAS.

Il log `SEMANTIC_COVERAGE` registra esito, modalità, cache, latenza, completezza
delle fonti e chiamate logiche aggiuntive. `inputTokensEstimate` è una stima
da caratteri, non un costo fatturato; i retry interni del servizio possono
produrre più richieste HTTP per una chiamata logica.

## Stato della consegna

Le modifiche sono nel workspace e predisposte per la modalità operativa.
Non è stata eseguita una pubblicazione su Google Apps Script. La verifica reale
eseguita il 20 ottobre 2026 ha ottenuto 9 successi completi, 2 differenze di
status, 3 errori di contratto, 3 errori di giudizio e 6 HTTP 429. Questi esiti
non giustificano ancora l'attivazione online. Le revisioni del prompt e del
runner richiedono una nuova prova reale; la suite locale non la sostituisce.

La prova live più recente della v13 ha completato 23 valutazioni: 19 conformi
integralmente e 21 decisioni corrette, senza errori di contratto o API. C04b e
C04c ora passano. C02b ha trattato la firma generica come dettaglio irrilevante;
C03c ha usato explicit_limit_info, coerente con la risposta ma non con l'aspettativa
addressed; C04a non isolava la condizione del ripiego dalla scadenza; C05d ha
duplicato una frase composta supportata in unsupportedClaims e irrelevantDetails.
La v14 chiarisce questi criteri e rende C04a un contrasto netto senza scadenza.
La prova live v15 ha completato tutti i 23 casi, senza errori di contratto o API.
La v16 ha prodotto 22 decisioni corrette e 20 casi pienamente conformi. La v17
ha prodotto 22 decisioni corrette e 21 casi pienamente conformi. C03a è stato
respinto perché prometteva che la segreteria avrebbe saputo precisare documenti
non descritti nella KB; il fixture ora non include quella promessa. In C05d la
motivazione identifica correttamente un problema di pertinenza, mentre l'elenco
`unsupportedClaims` lo contraddice. La v18 allinea il codice diagnostico alla
motivazione quando questa classifica esplicitamente i dettagli come irrilevanti,
senza modificare il blocco della risposta. La sua prova live ha ottenuto 21/23
decisioni conformi: C04a ha classificato come missing un ripiego la cui condizione
risultava falsa; C05c è stato falsamente respinto perché il runner non passava il
testo della risposta al normalizzatore della firma. La v19 chiarisce il trattamento
delle condizionali inattive e corregge il passaggio nel runner. C02b ha superato un
retry HTTP 503 dopo circa 28 secondi. La prova live v20 ha ottenuto 22/23 decisioni
conformi: C04a e C05c sono rientrati; C04c ha classificato come infondata una
dichiarazione trasparente sull'assenza di tempi in KB, pur assegnando gli stati di
copertura corretti. La v21 esplicita questo caso per `explicit_limit_info` e
invalida la cache semantica. La prova live v21 ha ottenuto 23/23 giudizi conformi,
senza errori di contratto o API; il report è stato verificato anche per stati,
motivazioni e fonti. C04c ora riconosce il limite informativo sui tempi senza
richiedere una formula nella KB. Il campione finito non dimostra fedeltà
universale alle fonti e non giustifica da solo la pubblicazione su Google Apps
Script.
