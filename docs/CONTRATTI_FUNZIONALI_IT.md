# Contratti funzionali della segreteria automatica

Il sistema opera su Google Apps Script V8. Questi contratti descrivono il codice locale e sono verificati tramite servizi simulati. Configurazione dell'ambiente, quote del fornitore e revisione distribuita vengono controllate separatamente durante il rilascio.

## Selezione e classificazione dei messaggi

La selezione considera i messaggi esterni non letti e le etichette del singolo messaggio. Un messaggio trattato nello stesso thread non esclude una nuova richiesta. I messaggi ravvicinati vengono accorpati nel gruppo corrente; le marcature riguardano quel gruppo.

Il corpo corrente viene separato dalle citazioni e dalle firme. Le intestazioni di citazione in italiano, inglese e francese sono riconosciute senza distinzione tra maiuscole e minuscole, anche quando occupano più righe. Le citazioni con prefisso consentono risposte intercalate; il testo senza delimitatori resta soggetto all'ambiguità intrinseca delle email in testo semplice.

L'inferenza di risposta dall'oggetto usa i prefissi `re`, `rif`, `r`, `ris`, `risp`, `aw`, `sv`. I prefissi di inoltro sono distinti. Un booleano esplicito in `classifyEmail` prevale sull'inferenza; un valore omesso, `undefined` o `null` lascia dedurre il contesto dall'oggetto. È supportata anche la firma con indirizzo mittente come terzo argomento.

Le esclusioni accettano indirizzi completi, domini e sottodomini. I token senza dominio possono corrispondere a username soltanto per i nomi di bot previsti dal classificatore. `marketing` e `info` sono username ordinari: l'esclusione di una casella concreta richiede il suo indirizzo o dominio. `PERSONAL_IGNORE_SENDERS` contiene la lista personale per ambiente.

L'analisi dei contatti conserva i ritorni a capo. Un titolo e il nome devono appartenere alla stessa riga; nomi e cognomi espliciti usano separatori orizzontali. Complementi narrativi e aperture come «vorrei», «chiedo» e «grazie» delimitano il contatto. Gli header `Reply-To` su un dominio diverso richiedono un mittente di modulo presente in `TRUSTED_FORM_SENDERS`.

## Calendario, orari e riscontro nelle fonti

Le date vengono validate rispetto al calendario gregoriano e al fuso applicativo. Le date esplicite hanno precedenza sui riferimenti relativi introduttivi. Date di nascita e anni con formato non ammesso sono esclusi dall'inferenza operativa. Il 29 febbraio viene associato a un anno bisestile coerente con l'intento temporale.

L'orario estivo richiede un contesto esplicito riferito a periodo, orario o Messe estive. Il parser esamina il titolo e le due righe successive. L'intervallo deve iniziare da maggio ad agosto, terminare entro settembre e rispettare l'ordine dei mesi. Gli intervalli di Grest, campi o chiusura della segreteria privi di questo contesto non definiscono gli orari delle Messe. Il parser generale può riconoscere anche intervalli annuali o autunnali.

L'estrazione degli orari distingue ore, date, durate, versetti e importi. Le valute anteposte o posposte escludono i valori monetari; `€ 15.30` non rappresenta un orario. Una coppia numerica con punto richiede contesto per essere riconosciuta come data. Le citazioni bibliche vengono delimitate per parola, preservando espressioni come «Ore 10:00».

Orari, telefoni, email, indirizzi e scadenze della risposta devono trovare riscontro nelle fonti ammesse. Il confronto distingue normalizzazioni di formato, informazioni esplicite e affermazioni non supportate.

## Allegati, scopo e ricevute

La lettura documentale precede il routing. L'analisi strutturata distingue richiesta personale, consegna e documento di supporto; restituisce scopo, categoria e coerenza utilizzabili dalle fasi successive. I file visivi vengono letti tramite il modello e i documenti Office seguono i percorsi di estrazione previsti. Il nome di un file prova la sua presenza, non il suo contenuto.

Gli allegati presenti vengono esaminati entro i limiti di numero, dimensione, tempo e contesto. I metadati di dimensione sono verificati per tutte le sorgenti. Il recupero di documenti pertinenti nel thread non equivale a una nuova consegna. Le domande prestampate e le richieste citate sono distinte dall'istanza corrente dell'utente.

La ricevuta locale richiede un intento AI esplicito di aggiornamento o conferma, confidenza sufficiente, lettura completa e consegna semplice coerente. Richieste operative, informative, miste, formali complesse o incerte seguono generazione e validazione. Un documento ricevuto ma non classificabile non dimostra un errore dell'utente; verifiche o reinvii vengono richiesti soltanto quando manca un dato indispensabile.

## Presenza fisica e memoria

I vincoli di salute, mobilità, assistenza, restrizione legale, distanza e indisponibilità hanno stati separati. Una risoluzione esplicita riguarda il suo tipo; la possibilità di venire non prova automaticamente la guarigione. Le risoluzioni francesi accettano apostrofi dritti e tipografici.

Solo affermazioni attuali possono risolvere un vincolo. Citazioni, ipotesi e negazioni mantengono il loro significato. Lo stesso controllo di affermatività governa sia le risoluzioni sia la selezione delle clausole ancora attive. Nelle affermazioni personali italiane separate da virgola o «e», una nuova proposizione esplicita ha una negazione indipendente: «Non sono guarito, sono ancora ricoverato» conserva il vincolo di salute.

L'ancora della conversazione usa indirizzi normalizzati, date valide e ordine dei messaggi. Il candidato è escluso sia per identità dell'oggetto sia per ID, anche quando l'oggetto parziale non espone `getId()`.

La memoria conserva gli argomenti per recenza, con limite configurato, e distingue informazioni fornite dalle dichiarazioni dell'utente. Il riepilogo protegge abbreviazioni come «S.», «Don G.», «Mons.», «Sig.ra» e «tel.», oltre ai punti tra cifre. Le voci vengono deduplicate senza usare la data come contenuto semantico e conservate entro i limiti di righe e caratteri.

Le evidenze sensibili hanno date autonome e durata configurata; l'attività amministrativa del thread non rinnova automaticamente un bisogno pastorale. La conservazione della riga di conversazione e quella delle evidenze sono indipendenti. La pulizia della memoria riguarda il foglio e non cancella messaggi Gmail.

## Concorrenza e transazioni di invio

Il mutex fisico protegge le operazioni concorrenti quando `LockService` è disponibile. Se il mutex è conteso, il thread o l'invio vengono rinviati. Quando il servizio manca, la modalità compatibilità usa lock logici e marcatori persistenti, con avviso sulla mancanza di atomicità fisica. `CacheService` resta necessario per il lock logico e la transazione richiede anche uno stato persistente scrivibile.

Il rilascio del lock logico verifica che il token appartenga al chiamante. Senza `LockService`, il token può essere rimosso in modalità compatibilità; con mutex conteso resta affidato al TTL. La modalità compatibilità non offre una garanzia di esclusione atomica tra esecuzioni concorrenti.

Prima dell'invio viene registrato `send_uncertain_<messageId>`. Il percorso RAW usa un `Message-ID` deterministico. Una conferma in cache o nel backup persistente prevale sull'incertezza. Errori di rete o timeout richiedono riconciliazione; in assenza di conferma il messaggio resta in revisione durante la conservazione del marcatore.

Un invio confermato resta consegnato anche se la persistenza, le etichette o la memoria falliscono. Il rollback è riservato ai percorsi in cui l'invio non è iniziato o il fallimento è certo.

La pulizia dei marcatori cancella al massimo 20 proprietà per esecuzione. I backup confermati hanno una durata effettiva compresa tra il TTL della cache e sette giorni, con impostazione predefinita di 36 ore. I marcatori incerti senza conferma vengono conservati per almeno sette giorni; quelli invalidi o oltre la durata ammessa possono essere eliminati. Dopo la scadenza, il solo marcatore non protegge più dall'invio: la revisione umana deve controllare la posta inviata.

## Checkpoint e budget

Il checkpoint batch contiene gli ID pendenti deduplicati, fino al limite configurato, e `startIndex = 0` relativo alla lista salvata. I thread non tentati hanno precedenza sui thread rinviati. `pendingCount` descrive la coda completa anche quando la lista salvata è limitata.

`retryCount = 1` rappresenta la prima ripresa pianificata. La soglia `BATCH_CHECKPOINT_MAX_RETRIES` è inclusiva: con valore 1 è consentita una ripresa, con valore 3 ne sono consentite tre sullo stesso insieme. Scrittura e lettura abbandonano soltanto oltre la soglia. Un insieme pendente diverso reimposta il conteggio. `depth` è diagnostico.

`notBefore` impedisce la ripresa anticipata e `expiresAt` tiene conto del ritardo pianificato. Gli errori nella creazione del trigger conservano quelli esistenti; un checkpoint esaurito viene cancellato insieme ai trigger di ripresa pertinenti. L'abbandono del checkpoint non applica da solo l'etichetta `Errore`: il trigger periodico può riscoprire i messaggi.

Il cursore della cascata di generazione è distinto dal checkpoint batch. Registra le strategie concluse per il candidato senza conservare prompt, risposta o chiavi API. È invalidato da nuovo candidato, catena diversa, successo, esaurimento o scadenza. Vedi [cascata di generazione](generation_checkpoint.md).

## Validazione e verifiche

Gli errori bloccanti prevalgono sul punteggio aggregato. Una verifica semantica obbligatoria deve riuscire; un errore tecnico viene trattato come tale, senza diventare un giudizio di contenuto. La confidenza misura la certezza del verdetto. Le fonti non attendibili sono serializzate e ogni variazione del contesto semantico invalida la relativa cache.

I controlli coprono lingua, saluto, tono, territorio, dati numerici, date, allegati e coerenza semantica. I tentativi di rigenerazione seguono i piani configurati, le quote e il tempo residuo. Disponibilità dei modelli, errori di configurazione e chiavi non valide hanno percorsi distinti.

La suite `node scripts/run_ci_test_suite.js` esegue smoke test, test unitari e tutti i test modulari, con servizi esterni simulati e copertura V8. La copertura numerica non dimostra l'assenza di ogni possibile errore. Vedi [test e copertura](validator_testing.md), [architettura](ARCHITECTURE_IT.md) e [configurazione](CONFIGURATION_IT.md).
