# Verifica delle 13 incongruenze — 8 settembre 2026

Verifica sul codice locale e correzioni accompagnate da regressioni Node. Nessun invio email, chiamata Gemini o deploy Google Apps Script.

| Punto | Esito | Intervento / motivazione |
| --- | --- | --- |
| 1. Due istanti per il saluto | Confermato nel percorso ordinario | `getAdaptiveGreeting` accetta una data di riferimento e `processThread` passa `processingTimestamp`. Anche i saluti speciali ricevono la stessa data. Il parametro resta facoltativo per i chiamanti autonomi. |
| 2. Relativi ancorati al messaggio | Comportamento corretto; manca una verifica deterministica completa degli orari stagionali | “Domani” indica il giorno successivo alla scrittura. Spostarlo alla risposta cambierebbe la richiesta. `targetDateIsPast` e il prompt segnalano già la data trascorsa. Test aggiunto su richiesta arretrata; nessuno spostamento automatico della data. Il controllo degli orari presenti in KB non equivale a verificare integralmente la stagione di ogni orario citato. |
| 3. Scuse per ritardo e data originale | Non è una contraddizione di calcolo | Il ritardo usa la data della risposta, la richiesta mantiene la propria data. Esiste già il controllo di qualificazione temporale; questo non garantisce ogni possibile formulazione prodotta dal modello. |
| 4. Scadenze sacramentali grezze | Confermato | Aggiunto contesto deterministico condiviso da prompt e validator: giorno esatto, limiti del mese, anno ambiguo, data non risolta e scadenza trascorsa. Per una scadenza sicuramente trascorsa il prompt richiede di riconoscerla; il validator rileva l'omissione di tale riconoscimento. |
| 5. Postura incerta persa in memoria | Confermato | `uncertain` viene salvato come `hesitant`; aggiunti anche gli alias già usati dal renderer. Non serve migrare i valori canonici esistenti. |
| 6. Base riassunto nei retry OCC | Segnalazione non confermata | La base deve rimanere lo snapshot che ha generato il nuovo riassunto. Il delta viene applicato alla riga fresca, con deduplicazione. Sostituire la base con la riga fresca farebbe scattare la sostituzione del testo e potrebbe perdere dati concorrenti. Aggiunti commenti e test con due cambi di versione per entrambi i metodi. |
| 7. Vincolo solo nell'oggetto | Confermato | La riconciliazione include le affermazioni dell'oggetto nel testo verificato dal rilevatore multiplo, conservando i filtri per negazioni, citazioni e frasi non personali. |
| 8. Scrittura legacy della reazione | Confermato come rischio latente | L'alias `_inferUserReaction` delega a `updateMemoryAtomic`; quest'ultimo ora accetta operazioni contenenti soltanto una reazione. Test sul percorso reale: reazione aggiornata, contatori messaggi e topic invariati. Gli altri metodi pubblici legacy della memoria restano disponibili per compatibilità. |
| 9. Saluto `soft` contraddittorio | Confermato | Template dedicato con saluto breve facoltativo o raccordo diretto. Test per tutte le lingue previste e una lingua di fallback. |
| 10. Chiusura e domande implicite | Confermato | La checklist riceve lo shift normalizzato e, su `closure`, richiede soltanto le eventuali domande esplicite. |
| 11. Brevità ed esaustività | Non è una contraddizione necessaria | Il contratto già specifica di risolvere i dubbi effettivi con il minimo testo e limitare i dettagli accessori. Conservati entrambi gli obiettivi; nessuna rimozione della completezza. |
| 12. Routing duplicato | Duplicazione confermata, fallback non morto in assoluto | Estratta la funzione condivisa `hasStrongerResponseRoutingSignal_`. Il booleano del processore mantiene precedenza; il renderer autonomo usa la stessa regola quando il booleano manca. |
| 13. Etichette e thinking leak | Accoppiamento confermato | Aggiunto test di contratto che ricava le etichette dal renderer effettivo e verifica che il validator le intercetti. Una modifica incompatibile ora fa fallire la suite. |

## Limiti delle scadenze

L'estrattore esistente riconosce formulazioni italiane e inglesi. Per “metà ottobre” si conservano prudentemente i limiti dell'intero mese: non si inventa il 15 ottobre. Una scadenza senza anno già trascorsa al momento della scrittura è marcata ambigua, senza scegliere arbitrariamente l'anno successivo. Date malformate o prive di contesto restano non risolte.

Il nuovo validator è lessicale e controlla il riconoscimento della scadenza trascorsa, anche nelle sei lingue principali. Non è una prova generale di fattibilità dei percorsi sacramentali e non confronta automaticamente ogni percorso della KB con la deadline. Restano possibili formulazioni corrette non riconosciute o contraddizioni complesse non rilevate.

## Verifica

- `node scripts/run_ci_test_suite.js`: 114 smoke test, 152 unit test e 31 suite modulari superati.
- La nuova suite copre istante del saluto, postura incerta, merge OCC, sola reazione atomica, oggetto, saluto soft, closure, scadenze e contratto delle etichette interne.
- `git diff --check`: nessun errore di whitespace.

Modifiche locali; non pubblicate su Google Apps Script.
