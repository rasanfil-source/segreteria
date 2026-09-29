# Segreteria Email Parrocchiale AI

[English](README.md) · Documentazione allineata al codice locale il 29 settembre 2026.

Il sistema esegue un autoresponditore su Google Apps Script V8: seleziona i messaggi Gmail non letti ancora lavorabili, applica filtri e controlli, consulta la base di conoscenza su Google Sheets e prepara una risposta con Gemini o con un modello locale di ricevuta. La risposta viene validata prima dell'invio. I casi critici, gli errori e gli invii incerti seguono percorsi distinti di revisione o rinvio.

## Modalità lingua

La cella **`Controllo!F2`** seleziona il comportamento:

| Valore nel foglio | Comportamento |
|---|---|
| **Tutte le lingue** | Sono ammissibili sia italiano sia altre lingue; restano attivi filtri, quote e validazione. |
| **Solo straniere** | I messaggi riconosciuti come italiani vengono rinviati con etichetta **`·`**, senza risposta automatica. Gli altri proseguono nella pipeline. |

“Straniere” significa rispetto all'italiano, non rispetto al paese del mittente. La modalità non traduce tutti i messaggi in una lingua fissa: la generazione usa la lingua rilevata. Tornando a “Tutte le lingue”, i messaggi con `·` ancora non letti e senza altre cause di esclusione tornano candidati. Non è una garanzia che ricevano tutti una risposta.

Vedi [modalità lingua e cambio modalità](docs/LANGUAGE_MODES_IT.md) per rilevamento, lingua incerta, cache e recupero dei messaggi.

## Quando elabora

`setupAllTriggers()` installa il trigger di `main` ogni 5 minuti, la pulizia settimanale della memoria e l'export giornaliero delle metriche. I trigger vanno installati nell'ambiente GAS: la loro presenza non è verificabile dai soli file locali.

- `Controllo!B2 = Spento` disattiva l'elaborazione.
- Le fasce in `Controllo!A10:D16` sono **fasce di sospensione durante la presenza della segreteria**. Ferie e festività previste dal codice mantengono attivo l'automatismo, salvo interruttore spento.
- La scansione può consentire l'elaborazione di richieste non lette da oltre 12 ore anche durante una sospensione.
- Il limite locale è 2 elementi del batch per esecuzione; budget, quote e filtri possono ridurre il lavoro effettivo.

## Etichette e risultati

| Etichetta | Significato |
|---|---|
| `IA` | Messaggio trattato: può essere una risposta inviata oppure una chiusura senza risposta secondo i filtri. |
| `Verifica` | Serve controllo umano: blocco prima dell'invio, warning dopo un invio, oppure esito di invio incerto. |
| `Errore` | Errore marcato come terminale dal percorso interessato. |
| `·` | Italiano rinviato dalla modalità “Solo straniere”; non equivale a `IA`. |

Le marcature operative sono a livello di messaggio dove previsto; la vista Gmail del thread può mostrare etichette di messaggi diversi. Il sistema conserva lo stato non letto nelle normali marcature. Prima di rispondere manualmente a un caso in `Verifica`, controllare la posta inviata. Non viene creata automaticamente una bozza da approvare.

## Documentazione

- [Avvio e configurazione per la segreteria](docs/Guida_Setup_Completa_Per_non_tecnici.md)
- [Configurazione e valori attuali](docs/CONFIGURATION_IT.md)
- [Architettura e componenti del thread](docs/ARCHITECTURE_IT.md)
- [Diagrammi](docs/ARCHITECTURE_DIAGRAMS_IT.md)
- [Deploy](docs/DEPLOYMENT_IT.md)
- [Problemi operativi](docs/TROUBLESHOOTING_IT.md) e [runbook](docs/runbooks/README.md)
- [Base di conoscenza](docs/KNOWLEDGE_BASE_GUIDE_IT.md)
- [Dati, memoria e sicurezza](docs/SECURITY_IT.md)
- [Progetto realizzato](docs/DOCUMENTO_DI_PROGETTO_AS_BUILT_IT.md)
- [Test e copertura](docs/validator_testing.md)

## Sviluppo e verifica

I file `gas_*.js` nella radice contengono il runtime e la suite unitaria; gli undici `gas_thread_*.js` sono dipendenze dell'orchestratore. `gas_config.js` è tracciato, mentre segreti e impostazioni per ambiente risiedono nelle Script Properties. `.claspignore` esclude documenti, test modulari, script locali e artefatti temporanei dal caricamento GAS.

Su Windows usare PowerShell 7:

```powershell
pwsh.exe -NoLogo -NoProfile -Command "node scripts/run_ci_test_suite.js"
```

La suite usa servizi simulati e produce risultati in `outputs/coverage/`. Il collaudo del 29 settembre 2026 ha completato 52 suite modulari senza fallimenti. `DRY_RUN` su GAS impedisce la risposta email ma può ancora leggere servizi, chiamare Gemini e produrre log: non sostituisce i test offline.

Modelli e quote in configurazione sono scelte locali; non certificano disponibilità del fornitore, costi nulli o capacità giornaliera. Questa documentazione descrive il workspace, non attesta il codice effettivamente distribuito nei due progetti GAS.
