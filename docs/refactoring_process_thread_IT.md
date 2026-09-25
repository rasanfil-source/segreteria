# Refactoring di EmailProcessor.processThread — verifica del 25 settembre 2026

Implementazione completata localmente, senza invii reali, chiamate ai servizi Google/Gemini, deploy, push o merge. Firma pubblica, valori restituiti, regole, prompt, soglie e numero dei tentativi sono preservati nei confronti eseguiti.

## Baseline e ripristino

- Riferimento funzionale: contenuto effettivo del workspace prima dell'intervento. `git status --porcelain=v1 -uall` era vuoto; HEAD era `b5a6a75860182c56500a830a542962ab86902919`.
- Copia locale: `outputs/process-thread-baseline/`, con **163 file**, includendo i file tracciati e gli eventuali non tracciati non ignorati presenti al momento della copia. `manifest.json` contiene percorso e SHA-256 di ciascun file; ogni copia è stata verificata immediatamente e nuovamente alla fine.
- Configurazioni locali ignorate e credenziali non sono state modificate. `.clasp.json` mantiene `rootDir: ./`.
- Provenienza delle fixture: `tests/fixtures/thread_baseline.meta.json`. SHA-256 originale di `gas_email_processor.js`: `672f51b64984d73c25814f146a03a5e5c69940ed6c380dbfc0fd8329eb036bb8`.
- CI iniziale: **114/114 smoke**, **152/152 unit**, **44/44 suite modulari**; nessun fallimento preesistente rilevato.

La copia è intenzionalmente esclusa da Git e da clasp tramite `outputs/`. Non è necessaria per eseguire la CI ordinaria: le fixture di caratterizzazione e la loro provenienza sono incluse nei file da versionare. Il confronto differenziale diretto richiede invece la copia locale.

Non è stato necessario ripristinare il codice. Per un eventuale ripristino successivo, confrontare i file interessati con il manifest e con il diff dell'intervento: ripristinare soltanto gli intervalli introdotti da questo lavoro ed eliminare soltanto i nuovi file ancora corrispondenti alla versione di questo intervento. Non usare un reset globale né sovrascrivere modifiche successive dell'utente.

## Struttura risultante

`processThread` passa da **2.972 a 211 righe**, contando firma e parentesi finali. Rimane proprietario del lock, dell'ordine delle fasi, delle uscite terminali e del `finally`. Le 11 righe oltre l'obiettivo orientativo di 200 conservano visibili questi confini, senza introdurre un ulteriore livello di orchestrazione artificiale.

I **180 altri metodi preesistenti** di `EmailProcessor` sono identici alla baseline, dopo la sola normalizzazione CRLF/LF. Sono compresi i metodi del filtro degli orari e gli helper di retry/idempotenza. I servizi e i validator esistenti non sono stati modificati.

| File / componente | Responsabilità e contratto |
| --- | --- |
| `gas_thread_selection.js` / `ThreadSelection` | Identità, alias, label terminali, ordinamento data/ID, scelta del candidato, guardia duplicati e aggregazione del burst. |
| `gas_thread_message_state.js` / `ThreadMessageState` | Candidato, messaggi del contesto e marcatura una sola volta; rende visibile al recupero errori lo stato raggiunto prima di un'eccezione. |
| `gas_thread_policy.js` / `ThreadPolicy` | Policy prima dell'estrazione, lingua/newsletter, throttle, risposte automatiche, anti-loop, classificazione locale e quick check. |
| `gas_thread_context.js` / `ThreadContext` | KB, storia, saluto, territorio, profilo, routing definitivo, runtime e opzioni del prompt. |
| `gas_thread_attachments.js` / `ThreadAttachments` | Pre-check, look-back, raccolta con budget, interpretazione post-OCR. Metodi distinti per ciascuna responsabilità. |
| `gas_thread_documents.js` / `ThreadDocuments` | Categoria iniziale, interpretazione documentale, evidenze tassonomiche/semantiche, direttive e contesto di validazione. |
| `gas_thread_generation.js` / `ThreadGeneration` | Strategie, fallback, receipt-only e preparazione del testo da validare. |
| `gas_thread_validation.js` / `ThreadValidation` | Validazione, scelta dei piani di correzione, rigenerazione e conservazione della risposta migliore. |
| `gas_thread_delivery.js` / `ThreadDelivery` | Dry-run, transazione idempotente, invio, rollback solo quando consentito e riconciliazione degli esiti incerti. |
| `gas_thread_completion.js` / `ThreadCompletion` | Cleanup etichette e aggiornamento atomico della memoria dopo invio confermato. |
| `gas_thread_lifecycle.js` / `ThreadLifecycle` | Logger temporanei, ripristino dei logger e gestione degli errori prima/dopo l'invio. |

Sono **41 funzioni di fase**, distribuite in file da 77 a 569 righe; la funzione estratta più lunga è `ThreadValidation.validate` (215 righe), con piani e chiamate di rigenerazione separati. Non è stato trasferito il vecchio metodo in un nuovo monolite.

Le dipendenze sono assemblate nei metodi `_thread*Services_` di `EmailProcessor`: ogni componente riceve solo i servizi/helper elencati dal proprio contratto, mai l'istanza completa del processor. Le funzioni ricevono ingressi destrutturati e restituiscono record specifici della fase. `{ terminal: true }` indica al coordinatore di restituire il `result` pubblico già aggiornato; non viene esposto al chiamante esterno.

Non esiste un contenitore mutabile universale. Le mutazioni condivise mantenute intenzionalmente sono:

- `result`, per il contratto pubblico di stato/reason/errorClass/retry;
- `messageState`, limitato a selezione e marcature;
- `delivery.confirmed`, per rendere irreversibile la conferma di consegna rispetto al recupero errori;
- gli oggetti originali `messageDetails`, classificazione, quick check e requestType, aggiornati come nella baseline;
- l'array delle direttive già referenziato dalle opzioni del prompt e l'array dei messaggi del contesto esteso dal look-back.

L'alias dell'array nel look-back è conservato: copiarlo avrebbe modificato quali messaggi ricevono le etichette nei percorsi successivi. Le dipendenze globali GAS già esistenti (`CONFIG`, `GLOBAL_CACHE`, Session, GmailApp, lock/cache/properties e helper globali) restano invariate e sono simulate nei test.

## Mappa del flusso e invarianti

| Ordine | Operazioni / effetti osservabili | Uscite anticipate preservate |
| --- | --- | --- |
| 1 | Logger temporanei, tempo del batch, normalizzazione KB, lock del thread | Lock non disponibile/già coperto, con ripristino logger. |
| 2 | Refresh, lettura unread, identità/alias, metadata label, ordinamento, candidato e burst | Nessun nuovo messaggio, nessun esterno, stale-only con messaggi recenti. |
| 3 | Ultimo mittente e lingua dal solo soggetto; estrazione, fingerprint duplicati, aggregazione | Ultimo intervento nostro, lingua esclusa, duplicato confermato. |
| 4 | Lingua locale, newsletter, throttle, header automatici, OOO/chiusure, anti-loop, no-reply/ignore, classificatore | Stessa sequenza di skip, filtered, dilata, errore o revisione e relative label. |
| 5 | Memoria, quick check, lingua AI, segnali documentali/presenza, requestType | Quick check fallito/vuoto, NO_REPLY, lingua italiana confermata in foreign-only. |
| 6 | KB, storia senza burst corrente, saluto, territorio, categoria preliminare | Nessuna anticipazione del routing definitivo. |
| 7 | Allegati/OCR, categoria definitiva, modello documentale, profilo e crisi, routing, runtime/prompt | Crisi inviata a revisione prima di generazione; deadline e budget allegati invariati. |
| 8 | Coerenza documentale e direttive, prompt, generazione/fallback, preparazione, validazione/retry | Deadline, errori classificati, output troncato, NO_REPLY e revisione. Nessuna nuova politica di quota. |
| 9 | Dry-run o transazione/invio/riconciliazione | Dry-run non invia; già inviato/in-flight/incerto non inviano di nuovo; riconciliazione confermata restituisce il risultato originale. |
| 10 | Marcatura del burst subito dopo conferma, cleanup, review, memoria | Errori post-invio restituiscono `replied` con warning quando previsto; mai rollback di una consegna confermata. |
| finally | Ripristino logger, poi rilascio lock | Ordine preservato anche sulle uscite anticipate interne al try. |

L'ordine di estrazione è stato: calcoli/contesto; allegati/documenti; generazione/validazione; selezione/policy; infine invio/completamento. Il registro dei messaggi è stato separato prima della selezione per preservare la visibilità del candidato nei catch. Le suddivisioni interne di raccolta allegati, evidenze documentali e chiamate di correzione hanno seguito gli stessi confronti.

## Verifiche

1. **Caratterizzazione prima delle estrazioni:** 40 scenari offline; orologio fisso e casualità deterministica. Successivamente estesi a **63**, sempre ricavati dalla copia originale e confrontati nuovamente eseguendo entrambi i codici.
2. **Confronto esatto:** oggetto restituito completo, sequenza delle chiamate simulate, argomenti completi di prompt/validazione/retry, invio, proprietà persistite, cache delle label e ripristino dei logger. Non vengono normalizzati i prompt o eliminati i campi di risultato. Gli stack di errore non fanno parte del confronto perché cambiano necessariamente con l'estrazione.
3. **Scenari:** burst e parità di timestamp, mittenti diversi/alias, metadata terminali, filtri/stale-only/throttle, dry-run, OCR e categoria formal, budget/look-back/crash allegati, documento mancante/incongruo, receipt-only, storia/memoria, self-healing/retry/fallback, crisi, duplicati, marker incerti, riconciliazione e guasti di commit/label/cleanup/memoria.
4. **Confronti incrementali:** caratterizzazione superata dopo ciascun gruppo di estrazioni; CI completa dopo contesto/allegati/generazione e dopo la separazione finale. Un test statico cercava `conversationStateUpdate` nel vecchio file: ora legge anche `gas_thread_completion.js`, mantenendo tutte le asserzioni originarie. Durante la revisione è stato preservato anche lo spazio letterale del template territoriale, verificato dal nuovo scenario territorio.
5. **Esercizio dei componenti:** contatori runtime verificano **41/41 funzioni di fase chiamate** nei 63 scenari. Questo dato è distinto dalla copertura V8 delle funzioni annidate e dei rami.
6. **Caricamento/deployment:** gli 11 file sono script globali GAS, senza import/require runtime. Test di sintassi, caricamento inverso e replay funzionale inverso superati. `.claspignore` include i nuovi file nella root; `rootDir` resta `./`, runtime GAS V8. Solo i loader dei test Node sono stati adattati, tramite helper comune.
7. **Audit sorgente:** nessuna variazione nei 180 metodi esistenti esterni a `processThread`; nessuna modifica a validator, filtro orari, policy di copertura, configurazione o script di deploy.
8. **CI finale:** **114/114 smoke**, **152/152 unit**, **46/46 suite modulari**, zero fallimenti. Le due nuove suite sono caratterizzazione e caricamento.
9. **Sintassi e diff:** `node --check` superato su **94 file JavaScript**, inclusi i componenti e test non ancora tracciati; `git diff --check` superato e whitespace verificato anche sui **18 nuovi file**. Revisione di componenti, wiring, test e invarianti di invio effettuata.

Copertura obbligatoria invariata rispetto alla baseline:

| File | Funzioni V8 | Blocchi V8 | Soglie mantenute |
| --- | ---: | ---: | --- |
| `gas_response_validator.js` | 99,10% | 81,66% | 96% / 80%, più soglie dei metodi specifici |
| `gas_territory_validator.js` | 100,00% | 87,61% | 100% / 87% |

Anche i nuovi file hanno copertura V8 attribuita al percorso assoluto: sono presenti nel rapporto completo. Non si dichiara copertura totale dei loro rami: i 63 scenari e le suite preesistenti non esauriscono tutte le combinazioni possibili.

Artefatti locali di verifica:

- `outputs/process-thread-baseline-ci.log`: CI prima dell'intervento.
- `outputs/process-thread-stage-abc-ci.log`: CI dopo le prime tre estrazioni.
- `outputs/process-thread-stage-de-ci.log`: controllo intermedio che ha individuato il test statico da adattare.
- `outputs/process-thread-quality.log`: verifica pertinente dopo l'adattamento del test statico.
- `outputs/process-thread-final-ci.log`: CI finale completa.
- `outputs/coverage/summary.json`: copertura V8 completa, compresi i componenti estratti.
- `outputs/process-thread-structure-audit.json`: dimensioni, inventario e verifica dei metodi invariati.
- `outputs/process-thread-differential.log`: replay finale contro la copia di ripristino e verifica SHA-256.
- `outputs/process-thread-syntax.log`: output dei controlli sintattici (vuoto quando tutti passano).

Comandi riproducibili dalla root, con PowerShell 7:

```text
pwsh.exe -NoLogo -NoProfile -Command "node scripts/run_ci_test_suite.js"
pwsh.exe -NoLogo -NoProfile -Command "node tests/test_thread_characterization.js --compare-workspace-baseline"
pwsh.exe -NoLogo -NoProfile -Command "node tests/test_thread_loading.js"
pwsh.exe -NoLogo -NoProfile -Command "git diff --check"
```

## Limiti e comportamenti preesistenti

Nessun difetto funzionale è stato corretto insieme al refactoring e nessun fallimento della CI iniziale è stato rilevato. Dry-run continua a sopprimere l'invio nel punto originario: le policy precedenti possono ancora applicare le marcature previste. La riconciliazione di un invio confermato continua a uscire senza eseguire il normale aggiornamento memoria. Sono contratti della baseline preservati, non nuove scelte introdotte dal refactoring.

Le verifiche sono locali con servizi simulati; caricamento e selezione dei file di deploy sono stati verificati senza eseguire un deployment né una prova live su Gmail/Gemini. Gli helper rimasti in `EmailProcessor` sono riutilizzati tramite dipendenze esplicite: questo intervento separa `processThread`, non riscrive l'intera classe.
