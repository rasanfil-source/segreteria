# Copertura sistematica dei validatori

Eseguire con Node.js 24 (senza dipendenze npm o credenziali Google):

```text
node scripts/run_ci_test_suite.js
```

Su Windows:

```powershell
pwsh.exe -NoLogo -NoProfile -Command "node scripts/run_ci_test_suite.js"
```

Il wrapper `scripts/run_ci_test_suite.sh` richiama lo stesso runner. Il runner
fissa `TZ=Europe/Rome`, esegue smoke test, suite unitaria e tutti i
`tests/test_*.js` in processi separati. Errori nei test, profili mancanti o
copertura sotto soglia producono un codice di uscita non zero.

## Matrici e oracoli

| Suite | Dimensioni controllate |
| --- | --- |
| `test_validator_decision_matrix.js` | Normalizzazione score; valori prima/sulla/dopo le soglie di lunghezza; firma × modalità × lingua; placeholder × rifiuto × prudenza; 24 ore × 6 lingue × 3 saluti; presenza fisica × policy × invito × condizionale × lingua × alias del contesto; tutti i termini dei template documentali; sensibilità × formalità × calore × linguaggio pastorale; validità semantica × evidenze; disponibilità servizio × obbligatorietà × fallback × score. |
| `test_validator_pipeline_matrix.js` | Ogni coppia di controlli nell'aggregatore, moltiplicazione penalità e precedenza degli errori; raffinamento abilitato/applicabile/riuscito; tutte le 256 combinazioni degli otto prerequisiti dell'eccezione semantica per mobilità; API pubblica con testo semplice e tag XML. |
| `test_validator_temporal_matrix.js` | Calendario gregoriano e secoli bisestili; estremi di ogni mese; spostamenti mensili; 7 giorni di partenza × 7 giorni richiesti × 4 direzioni × 2 policy; quantità numeriche/testuali e unità temporali; scadenze riconosciute/negate in sei lingue; alias API. |
| `test_validator_grounding_matrix.js` | Orari/date/email/telefoni × presenza in KB/messaggio × formato KB; orari tecnici; falsi positivi sulle citazioni bibliche; penalità combinate; esito territorio × risposta × alias; formati dei segnali di sensibilità. |
| `test_validator_semantic_contract.js` | Parser standard/lenient e payload invalidi; cache attiva/disattiva e invalidazione per ogni input di grounding; rate limiter × successo × chiave backup × risoluzione modello; retry e limiti di troncamento. Tutti i servizi esterni sono simulati. |
| `test_territory_decision_matrix.js` | Regole tutti/pari/dispari/intervalli aperti e chiusi × estremi civici × suffisso; civico assente/invalido/SNC; tipi strada, normalizzazione, deduplicazione, form e limiti input; integrazione nell'analisi email. |
| `test_validator_coverage.js` | Unione dei profili V8 con intervalli annidati/elisi; soglie insufficienti; file e metodi mancanti. |

Ogni riga verifica un risultato atteso, non solo l'assenza di eccezioni. Le
matrici della pipeline simulano i risultati dei singoli controlli per isolare
l'orchestrazione; le altre matrici eseguono i controlli reali e la pipeline ha
anche casi end-to-end. Date e input sono fissi; non vengono effettuate chiamate
API, invii di email o modifiche a servizi Google.

## Misurazione e soglie CI

`outputs/coverage/summary.json` contiene metriche per file e per funzione e le
righe di inizio degli intervalli non eseguiti. I profili grezzi sono raccolti in
una directory `outputs/coverage/v8-*` nuova a ogni esecuzione, così una precedente
esecuzione non può migliorare artificialmente il risultato.

La policy versionata `tests/validator_coverage_policy.json` impone soglie globali
per i due validatori e soglie dedicate ai controlli fondamentali. Le altre
componenti `gas_*.js` attribuibili compaiono nel rapporto a scopo diagnostico.
Una modifica alla policy deve essere motivata; aggiungendo condizioni occorre
aggiungere casi che ne cambino l'esito, mantenendo ferme le altre condizioni.

La metrica è **copertura nativa V8 di funzioni e blocchi**, non copertura statica
dei rami Istanbul né dimostrazione MC/DC dell'intero programma. V8 rappresenta
i blocchi come intervalli di byte e può omettere intervalli interni con lo stesso
conteggio del contenitore: il merger tiene conto di questo per ogni profilo.
Gli script VM privi di un nome file assoluto non sono attribuiti. Usare sempre
`vm.runInContext(source, context, { filename: absolutePath })` nei nuovi test.
Una percentuale alta non sostituisce gli oracoli: i rami residui sono visibili nel
rapporto e le matrici esaustive valgono per le dimensioni elencate, non per il
prodotto cartesiano di tutto il validatore.

## Difetto trovato dalla matrice

Il filtro dei versetti biblici riconosceva `re` anche alla fine di `ore`,
scartando `Ore 10:00` dagli orari da verificare. Il confine di parola evita sia
il falso positivo su un orario legittimamente presente nelle fonti sia la mancata
segnalazione di un orario inventato. Restano escluse le vere citazioni `Re`,
`2Re`, `Gv` e `Gen.`; i casi sono verificati nella matrice di grounding.
