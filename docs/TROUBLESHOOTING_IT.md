# Diagnosi operativa

Riferimento al codice locale: 3 ottobre 2026. [English](TROUBLESHOOTING.md)

## Nessuna risposta

Controllare le Esecuzioni Apps Script e il singolo messaggio Gmail:

1. Trigger `main` presente, autorizzato e senza errori di inizializzazione.
2. `Controllo!B2` acceso e `MAX_EMAILS_PER_RUN` diverso da 0.
3. Fasce di sospensione: durante la presenza della segreteria il sistema può fermarsi. Solo un arretrato confermato dal controllo bounded consente il bypass; un errore di scansione non prova assenza né presenza di richieste.
4. **F2:** in **Solo straniere**, italiano riconosciuto viene rinviato con `·`. In **Tutte le lingue**, `·` non esclude più, ma il messaggio deve essere ancora non letto e lavorabile. Vedi [modalità lingua](LANGUAGE_MODES_IT.md).
5. Label terminali del messaggio, filtri mittenti/newsletter/risposte automatiche, ultimo intervento interno, lock, duplicati e checkpoint.
6. Accesso a KB e proprietà, quote e tempo residuo. Se F2 o KB non si aggiornano, invalidare con `clearKnowledgeCache()`.

`setupAllTriggers()` reinstalla le pianificazioni previste; non è una cura per credenziali, quote o contenuti errati. `main()` è un'esecuzione operativa e può inviare.

## Verifica non equivale a risposta non inviata

La label comprende: blocco di validazione, crisi da affidare a una persona, incoerenza documentale, warning dopo un invio ed esito di invio incerto. Il punteggio non è l'unico criterio. Non abbassare automaticamente la soglia perché ci sono molti casi: identificare il motivo, correggere dati o comportamento e riprodurre il caso nei test.

Il sistema non crea automaticamente una bozza. Le notifiche sono soggette a configurazione, cooldown e disponibilità del servizio; verificare comunque la coda Gmail.

## Invio incerto

Per `gmail_send_uncertain`, controllare thread e posta inviata. Nel percorso RAW il codice usa `rfc822msgid:reply_<ID_MESSAGGIO>@parish-reply.invalid`. Una ricerca immediata senza risultati non dimostra mancata consegna.

- Risposta trovata: non forzare un reinvio; chiudere la revisione dopo riscontro umano.
- Esito ancora dubbio: conservare `Verifica` e `send_uncertain_<ID>`.
- Mancato invio accertato: un amministratore può rimuovere il marker incerto e la label del messaggio da riprocessare, verificando tutti gli ID del burst. Attendere almeno 15 minuti dal tentativo per i marker temporanei `sending_`/`sendstarted_`.

Il marcatore incerto viene conservato per almeno sette giorni e può essere eliminato dalla pulizia al termine della durata prevista. Durante la revisione controllare sempre la posta inviata. Non cancellare tutte le Script Properties o tutte le etichette: contengono anche configurazione, contatori e protezioni dai duplicati. Un errore di memoria dopo consegna confermata non giustifica una nuova risposta.

## Quote e checkpoint

Gli errori transitori possono lasciare il messaggio senza marcatura terminale e salvarlo nel checkpoint. Il checkpoint rispetta `notBefore`, TTL di 10 minuti e limite di riprese rapide; poi il lavoro torna alla discovery periodica secondo il percorso previsto.

Il reset giornaliero del contatore locale Gemini è calcolato in `America/Los_Angeles`, non a un'ora italiana fissa. Un errore 429 può riguardare finestre diverse. I valori locali non provano la quota effettiva del progetto. Non eliminare i contatori per aggirare il limite.

## Allegati, lingua e memoria

Un allegato non analizzato per dimensioni, formato o deadline non è un documento verificato. Il look-back può recuperare file precedenti pertinenti; non autorizza ad affermare che sia stato consegnato un nuovo file.

Lingua mista, oggetto e testo breve richiedono controllo: il precheck italiano sul solo oggetto si applica soltanto con corpo semplice vuoto. Non cambiare la lingua della risposta modificando modelli: usare F2 per l'ammissibilità e verificare il rilevamento.

`cleanupOldMemory()` riguarda la memoria Sheets, non cancella la posta Gmail. Il suo criterio è 30 giorni dall'ultimo aggiornamento, con gestione prudente delle date mancanti/anomale. I flag sensibili hanno un TTL distinto di 180 giorni.

## Riproduzione locale

```powershell
pwsh.exe -NoLogo -NoProfile -Command "node scripts/run_ci_test_suite.js"
```

I test simulano i servizi. Conservare esempi anonimizzati; il dry-run GAS può ancora inviare dati a Gemini e scrivere log. Vedi [copertura](validator_testing.md), [configurazione](CONFIGURATION_IT.md) e [deploy](DEPLOYMENT_IT.md).
