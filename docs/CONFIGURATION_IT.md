# Configurazione

Codice locale verificato il 29 settembre 2026. [English](CONFIGURATION.md)

## Dove configurare

`gas_config.js` è tracciato e contiene i parametri runtime. `gas_config.example.js` è il modello di riferimento, escluso da clasp: non sovrascrivere una configurazione esistente per applicare una modifica puntuale. Credenziali e impostazioni per ambiente vanno nelle Script Properties.

| Proprietà | Uso |
|---|---|
| `GEMINI_API_KEY` | Chiave primaria, richiesta. |
| `SPREADSHEET_ID` | Spreadsheet delle risorse e memoria, richiesto. |
| `GEMINI_API_KEY_BACKUP` | Chiave di riserva opzionale. |
| `BOT_EMAIL`, `KNOWN_ALIASES` | Identità e alias del bot; verificare quelli dell'ambiente. |
| `PERSONAL_IGNORE_SENDERS` | Caselle personali escluse; array JSON o elenco separato supportato dal parser. |
| `ADMIN_EMAIL` | Destinatario delle notifiche amministrative configurate. |
| `VALIDATION_REVIEW_EMAIL` | Destinatario delle notifiche di revisione. |
| `METRICS_SHEET_ID` | Spreadsheet opzionale per `DailyMetrics`. |

La migrazione degli indirizzi personali dai vecchi sorgenti è descritta nel [rapporto affidabilità](RELIABILITY_AUDIT_2026-09-22.md). Una proprietà assente non ricostruisce la vecchia blacklist.

## Foglio Controllo

| Celle | Significato |
|---|---|
| `B2` | Interruttore; un valore contenente `Spento` disabilita il sistema. |
| `F2` | `Tutte le lingue` → `all`; `Solo straniere` → `foreign_only`. |
| `B5:E7` | Assenze; inizio B, fine D nel layout corrente, con varianti legacy gestite dal parser. |
| `A10:D16` | Sospensione settimanale: giorno A, inizio B, fine D; compatibile con giorno in B e inizio in C del layout legacy. |
| `E13:F` | Domini/mittenti e parole da escludere, uniti ai filtri statici. |
| `A19` | Email per la revisione letta nella configurazione avanzata. |

Le fasce sospendono l'automatismo durante la presenza della segreteria. Le assenze e le festività gestite dal codice lo mantengono attivo, salvo `B2` spento. Se `Controllo` manca si usa il fallback statico `SUSPENSION_HOURS`; se esiste senza fasce valide, con `STRICT_SUSPENSION_CONFIG=false` non ci sono fasce di sospensione. Una riga oraria non vuota e malformata causa errore di configurazione. Con modalità rigorosa attiva anche l'assenza di fasce valide è errore.

In **Tutte le lingue** italiano e altre lingue sono ammissibili. In **Solo straniere** l'italiano riconosciuto viene rinviato con `·`, senza risposta e mantenendo lo stato non letto. Tornando a tutte le lingue può rientrare tra i candidati, se ancora lavorabile. F2 vuota/non riconosciuta ripiega su tutte le lingue. Vedi [rilevamento e cambio modalità](LANGUAGE_MODES_IT.md).

`setupConfigurationSheets()` prepara il layout usando lo spreadsheet attivo e può cancellare il contenuto di `Controllo!A1:Z300`: usarlo per il setup, dopo aver salvato i dati necessari. `applyValidationOnly()` applica i vincoli senza ricreare l'intero layout. Un cambio F2 non richiede di ripetere il setup.

## Parametri effettivi

| Parametro | Valore nel codice |
|---|---:|
| `MAX_EMAILS_PER_RUN` | 2; 0 sospende prima della discovery nel processor |
| `MAX_EXECUTION_TIME_MS` | 280000 |
| `MIN_REMAINING_TIME_MS` | 90000 |
| `MAX_HISTORY_MESSAGES` | 8 |
| `CACHE_LOCK_TTL` | 310 secondi |
| `SUSPENSION_STALE_UNREAD_HOURS` | 12 ore |
| `MESSAGE_DISCOVERY_MODE` | `metadata` |
| `BATCH_CHECKPOINT_TTL_MS` | 600000 |
| `BATCH_CHECKPOINT_MAX_RETRIES` | 3 |
| `VALIDATION_MIN_SCORE` | 0.6 |
| `VALIDATION_WARNING_THRESHOLD` | 0.9 |
| `CRISIS_HUMAN_REVIEW` | true |
| `INTELLIGENT_RETRY.maxRetries` | 1 |
| `MAX_SAFE_TOKENS` / `MAX_SAFE_PROMPT_CHARS` | 100000 / 100000 |
| `MAX_OUTPUT_TOKENS` | 6000 |
| `MAX_PROVIDED_TOPICS` | 50 |
| `MEMORY_MAX_SUMMARY_BULLETS` | 5 |
| `SENSITIVE_FLAGS_TTL_DAYS` | 180 |
| `DRY_RUN` / `USE_RATE_LIMITER` | false / true |

Le soglie non sono una garanzia di qualità: alcuni errori bloccano a prescindere dallo score. Diagnosticare la causa di `Verifica` prima di modificare la validazione. Il dry-run blocca l'invio della risposta ma può accedere ai servizi, consumare chiamate Gemini, modificare stato tecnico e produrre log.

## Modelli

La generazione usa nell'ordine `flash-3.7`, `flash-3.7-backup`, `flash-lite`, `flash-lite-backup`. I primi due risolvono a `gemini-3.7-flash`; gli altri a `gemini-3.5-flash-lite`. Quick-check, classificazione, lingua, semantica e riassunto newsletter hanno strategie Lite. `MODEL_NAME` è `gemini-3.7-flash`.

Questi sono identificativi e budget configurati localmente: disponibilità, quote e condizioni effettive vanno verificate nell'ambiente del fornitore. Alias e chiavi backup non dimostrano quote indipendenti. Il conteggio token resta locale; `GEMINI_CONTEXT_CACHE` non è una configurazione implementata nel codice attuale.

## Allegati

`ATTACHMENT_CONTEXT` è abilitato: massimo 3 file, 3 MiB per file, precontrollo messaggio 25 MiB, 3000 caratteri per file e 9000 totali. L'elaborazione supporta PDF, immagini e formati Office tramite percorsi di estrazione/conversione; dipende da tipo, intento, tempo e servizi disponibili. La stima PDF usa 2 pagine e 1800 caratteri per pagina, non un parser che garantisce un taglio fisico esatto.

Il codice può recuperare allegati precedenti pertinenti nel thread: la presenza di un allegato storico non prova una nuova consegna. Nel percorso principale PDF e immagini vengono letti direttamente dal modello; il nome del file non prova il contenuto. I documenti presenti vengono esaminati entro i budget configurati anche senza parole chiave nel corpo. `ocrTriggerKeywords`, lingua, confidenza e limiti di pagine OCR riguardano gli helper testuali precedenti, non limitano la lettura visiva. Una sola analisi strutturata precede il routing e sostituisce il successivo controllo semantico separato: per alcune semplici consegne ciò comporta una chiamata prima non necessaria. In caso di lettura incompleta/non disponibile non si deve documentare l'allegato come certamente verificato né usare la ricevuta automatica.

Vedi [architettura](ARCHITECTURE_IT.md), [deploy](DEPLOYMENT_IT.md) e [test](validator_testing.md).
