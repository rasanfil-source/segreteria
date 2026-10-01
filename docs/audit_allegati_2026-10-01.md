# Correzioni dei due audit allegati — 1 ottobre 2026

Modifiche locali, con servizi Gmail/Gemini simulati nei test. Nessun invio di email o pubblicazione su Apps Script eseguito.

## Primo allegato

| Punto | Intervento |
| --- | --- |
| 1 | La gestione delle citazioni precede la rimozione dei saluti; la riga vuota termina gli header citati. |
| 2 | La ricerca della firma valuta tutti i marker nella coda, inclusi i footer mobili, preservando le domande successive. |
| 3 | Normalizzazione degli spazi dopo la rimozione della punteggiatura nei saluti. |
| 4 | La categoria `formal` attiva il flag persistente `canonical_complexity`. |
| 5 | Il riepilogo conserva separatori di riga e orari con punto, eliminando saluti iniziali anche sulla stessa riga. |
| 6 | Configurazione mittenti malformata classificata `CONFIG_ERROR`; indirizzi Gmail/Googlemail normalizzati anche nella blacklist generale. Il riconoscimento di `CONFIG_ERROR` era già presente nei classificatori degli errori. |
| 7 | Ogni destinatario di revisione viene validato prima di passare al candidato successivo. |
| 8 | Fallimenti della cache prima dell'invio rimuovono i marker appena creati; il commit elimina `sending`. |
| 9 | Le formule che negano il dubbio non producono `questioned`; un diverso dubbio reale nella stessa frase resta rilevabile. |

## Secondo allegato

| Punto | Intervento / riscontro |
| --- | --- |
| 1 | Il classificatore e il filtro della chiusura recente verificano il segnale di crisi prima di scartare il messaggio. |
| 2 | Confine iniziale del tipo strada e verifica del contesto/DB. Le vie sconosciute esplicitamente dichiarate restano ammesse come incerte: il codice già restituiva `inParish: null`, non `false`. Una whitelist assoluta avrebbe perso indirizzi reali non presenti nel DB. |
| 3 | Il risultato italiano con sicurezza minima non interrompe `foreign_only`: il quick check può correggere la lingua. |
| 4 | Rimossi DOCTYPE e commenti dal testo semplice; ogni elemento di lista mantiene il separatore di riga. |
| 5 | Le lingue senza ricevuta statica passano alla generazione e validazione normale. |
| 6 | Il validatore semantico riceve tutta la KB fornita dal chiamante, senza il taglio arbitrario a 30.000 caratteri. |
| 7 | Ridotti i pattern operativi deboli; desideri generici di partecipazione hanno confidenza inferiore e non sovrascrivono un verdetto AI valido. |
| 8 | Una consegna documentale non annulla più `reply_needed: false`. |
| 9 | L'estrazione Gmail conserva domande e richieste dopo i saluti finali. |
| 10 | La correzione delle maiuscole dopo la virgola attraversa soltanto spazi orizzontali. |
| 11 | Il troncamento non attiva retry identici. Un solo nuovo tentativo con budget raddoppiato per strategia attraversa nuovamente il limiter; anche la chiamata troncata consuma la prenotazione. |
| 12 | `MAX_TOKENS` nel quick check genera un errore esplicito prima della riparazione JSON. |
| 13 | Il fallimento del recupero degli header interrompe il percorso, preservando la classificazione degli errori di quota/configurazione. |
| 14 | Un controllo semantico positivo risolve l'incertezza della tassonomia locale; negativo o indeterminato mantengono le rispettive protezioni. |
| 15 | Aggiunti confini iniziali ai pattern di topic per messe e indirizzi. |
| 16 | Con cursore nel backlog viene controllata anche la prima pagina. Un'ancora evita di ricontrollare ogni volta tutti i vecchi messaggi; parte del budget metadata resta riservata al backlog. |
| 17 | La riconciliazione cerca anche un header applicativo esatto nei messaggi `SENT` del thread originale. Il fallimento della verifica mantiene il blocco prudenziale. |
| Firma ES | Accettate sia “Secretaría Parroquial” sia “Secretaría Parroquia …”. |
| Fallback chiave | Un generico `disabled` o `not enabled` in un HTTP 400 non esaurisce più la chiave primaria. |
| Errori invio | Gli errori deterministici `Invalid To/From/Reply-To header` non sono classificati come esito ambiguo. |
| Throttle | Il batch continua sugli altri thread e conserva nel checkpoint quelli rinviati. Il limite massimo di thread per run resta applicato. |
| IGNORE_DOMAINS | Una voce configurata senza `@` e senza punto può corrispondere esattamente al nome utente, per esempio `marketing`. |

## Verifica

La suite completa è `node scripts/run_ci_test_suite.js`. Le regressioni specifiche sono in `tests/test_pasted_audit_fixes.js`; i test di discovery e batch coprono anche l'arrivo di posta nuova e la prosecuzione dopo il throttle. Le aspettative storiche modificate sono esplicite; le fixture originali di caratterizzazione restano intatte.

Esito della prima verifica: smoke test superati, 152/152 unit test, 69/69 file di test modulari e soglie di copertura superate. La verifica successiva all'evoluzione dei modelli è descritta sotto.

La [documentazione Gmail di `users.threads.get`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/get) conferma il recupero di label e header selezionati tramite `format: metadata` e `metadataHeaders`. Non dimostra che Gmail conservi sempre un Message-ID scelto dal chiamante. La conservazione del nuovo header applicativo e i tempi di visibilità della posta inviata richiedono un collaudo reale; in assenza di prova l'invio resta incerto e non viene ripetuto automaticamente.

## Integrazione degli allegati successivi: modelli e configurazione

La configurazione di produzione e quella di esempio ora condividono queste catene:

- Generazione: primario configurabile (default `gemini-3.8-flash`), `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-flash-latest`, Lite configurabile (default `gemini-3.5-flash-lite`). Le chiavi di backup configurate sono tentate per i rispettivi modelli.
- Task ausiliari: Lite configurabile, `gemini-flash-lite-latest`, primario configurabile e `gemini-flash-latest`, con le rispettive chiavi di backup dove previste.
- Script Properties: `GEMINI_MODEL_PRIMARY` e `GEMINI_MODEL_LITE`; valori e chiavi vengono ripuliti dagli spazi. Gli override seguono il TTL della cache esistente (60 secondi); il limiter mantiene una fotografia dei modelli per la propria istanza.

`validateConfig()` controlla i riferimenti delle strategie senza imporre chiavi storiche. Il 404 del modello attraversa la catena senza riprovare lo stesso endpoint con la chiave di backup; un errore relativo a `cachedContent` non viene interpretato come ritiro del modello. Il percorso vale per generazione, quick check, lingua e semantica, anche senza limiter. Le chiamate ausiliarie con limiter conservano allegati, chiave selezionata e token reali restituiti dall'API.

Gli errori di autenticazione (incluso HTTP 400 con API key invalida) diventano `INVALID_API_KEY`; il batch si interrompe anche per `FATAL`. Un generico `INVALID_ARGUMENT` resta distinto dagli errori di autenticazione. Il classificatore scarta i messaggi con oggetto vuoto/`Re:` e solo citazioni o firma; conserva le richieste nell'oggetto. La cache che dispone solo di `getProperty` non perde più gli altri valori freschi e gestisce correttamente il refresh forzato.

Parametri aggiornati come richiesto: soglia semantica `0.82`, moltiplicatore prudenziale output `1.25`, budget token/caratteri `120000`. Non è stata misurata una riduzione percentuale delle chiamate; la nuova soglia richiede osservazione sui messaggi reali.

Le schede ufficiali confermano i modelli [Gemini 3.8 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash) e [Gemini 3.6 Flash](https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash). Gli [alias latest](https://ai.google.dev/gemini-api/docs/models) possono cambiare versione e includere modelli preview: non costituiscono una garanzia di gratuità perpetua. I valori RPM/TPM/RPD nel file sono limiti operativi locali, da confrontare con quelli effettivi del progetto. Google applica le [quote per progetto, non per chiave API](https://ai.google.dev/gemini-api/docs/rate-limits): una seconda chiave nello stesso progetto non aggiunge quota. Il moltiplicatore output è una stima prudenziale locale, non una descrizione della formula di quota Google, che documenta TPM in input.

Regressioni aggiunte in `tests/test_model_resilience.js`: override e parità delle configurazioni, cache a lettura singola, assenza di modelli storici, catene con 404 consecutivi, arresto quando tutti i modelli mancano, esclusione dei 404 di cache, selezione della chiave, token e allegati. Il test batch copre separatamente `CONFIG_ERROR`, `INVALID_API_KEY` e `FATAL`. Tutte le prove sono offline: nessun invio Gmail, chiamata Gemini o deployment eseguito.

Verifica finale dell'integrazione: smoke test superati, 152/152 unit test e 70/70 file di test modulari superati. Copertura: validatore risposte 97,83% funzioni / 81,64% blocchi V8; validatore territorio 100% / 87,39%. Soglie di copertura e `git diff --check` superati.

## Ulteriore audit: cinque punti residui

- `INVALID_ARGUMENT` ora diventa `FATAL` nel classificatore globale e nel fallback locale. Le chiavi non valide mantengono precedenza e categoria `INVALID_API_KEY`; `malformed` resta `INVALID_RESPONSE`. Il processor conserva anche `FATAL` e `SYSTEM_ERROR` restituiti dal classificatore globale. Il batch dispone già dello stop e del checkpoint per questi errori.
- Le quote con `per day`, `PerDay`, `daily` o `RPD` attendono il reset restituito dal limiter, quando disponibile; altrimenti mantengono la sospensione giornaliera. `QUOTA_EXHAUSTED` da solo non prova un esaurimento giornaliero: il percorso RPM/TPM mantiene il ritardo breve. Applicare letteralmente quella parte del diff avrebbe sospeso per ore anche gli esaurimenti al minuto.
- Le evidenze personali dei vincoli di presenza vengono valutate per frase, così una negazione nella frase precedente non nasconde il ricovero. La deduplicazione dei ricordi accetta anche `-` e `*` oltre al prefisso `•` già gestito.
- Il controllo rapido della crisi considera anche l'oggetto. Le reply vuote con oggetto troppo breve/lungo vengono filtrate; una domanda nuova esplicita nell'oggetto conserva il percorso di analisi, così come il caso storico `Re: Orari messe`.
- In entrambe le configurazioni, refresh diretto e invalidazione della cache normalizzano le chiavi con `trim()`, anche su backend senza lettura multipla.

I casi sono coperti da `tests/test_followup_audit.js`, con classificatore globale presente e assente, PromptContext presente e assente, entrambi i file di configurazione e i due tipi di backend delle proprietà. I voti numerici e la garanzia “100% Free Tier” espressi nell'allegato non sono conclusioni dimostrate dai test: restano valide le limitazioni operative descritte sopra.

Esito dopo quest'ultimo audit: smoke superati, 152/152 unit test e 71/71 suite modulari superati; soglie di copertura e `git diff --check` superati. Log locale in `outputs/followup-audit.log`. Nessun deployment effettuato.
