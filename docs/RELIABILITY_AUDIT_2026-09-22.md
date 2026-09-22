# Verifica affidabilità — 22 settembre 2026

Lavoro locale sul branch `main`, HEAD iniziale `57ca10edd6e3983bb0118633c6696b211a4cd073`.
Working tree iniziale pulito. Sono state usate le istruzioni AGENTS fornite nella richiesta;
non risultavano altri file AGENTS nel repository. Nessun commit, push, clasp push,
invio reale, chiamata Gemini reale o modifica delle proprietà di produzione.

## Stato dei 14 casi

| Caso | Stato | Prima, dopo ed evidenza |
|---|---|---|
| 1. Falsi segnali pastorali | Corretto | “Sono in crisi con il modulo” poteva attivare un segnale acuto; appreciative/open potevano scegliere il registro pastorale. Il contesto operativo esplicito è escluso dal rilevatore, la cordialità resta istituzionale calda. Conservati i segnali critici personali. Regressioni in `test_reliability_audit.js`, `test_prompt_context.js`, `test_posture_contract.js`. |
| 2. Saluto e ritardo | Corretto | Il saluto confrontava la precedente risposta con la data di arrivo, mentre le scuse usavano la data di elaborazione. Ora il saluto tiene conto del tempo trascorso al momento della risposta; il ritardo resta misurato dalla ricezione. Test completo: risposta dell'utente dopo un minuto, elaborazione cinque giorni dopo → saluto completo e scuse coerenti; sessione recente conservata. |
| 3. Invio ambiguo | Corretto | Il fallback dopo timeout era già bloccato, ma il processore promuoveva l'incertezza a `sent` e `IA`. Ora registra uno stato durevole prima dell'invio, aggiunge un Message-ID deterministico al RAW e cerca una sola conferma nella posta inviata. Senza evidenza resta `send_uncertain_*`, riceve `Verifica` e segue il canale di notifica configurato; nessun reinvio automatico. Mock del flusso completo: successo, riconciliazione, mancata conferma, perdita cache, notifica con cooldown. |
| 4. Nuovo contenuto | Corretto | Il taglio al primo header/firma eliminava P.S. e risposte sotto blocchi HTML. Ora rimuove contenitori bilanciati e righe esplicitamente citate, conserva P.S. e testo successivo; gli header inglesi/italiani richiedono indizi strutturali. Nessuna deduplica basata solo sull'oggetto quando il corpo estratto è vuoto. Test parser, classifier e duplicate guard. Rimane l'ambiguità intrinseca del testo citato senza delimitatori, descritta sotto. |
| 5. Memoria sensibile | Corretto | Flag booleani senza data autonoma potevano durare quanto un thread attivo; `formal` bastava per la complessità canonica. Ora `_evidence` conserva date per flag e risoluzioni esplicite, TTL predefinito 180 giorni; rinnovo solo su evidenza pertinente. `formal` da solo non basta. Vecchi booleani e sintesi restano leggibili; legacy usa `lastUpdated` valido come ancora dichiaratamente approssimativa. Test scadenza, persistenza del tombstone, conservazione di evidenza recente e risoluzione. |
| 6. Timestamp sconosciuti | Corretto | La normalizzazione sostituiva date mancanti/illeggibili con adesso. Restituisce ora `null`; la memoria sconosciuta non crea una sessione recente. Un messaggio Gmail proprio con data valida resta un'ancora utilizzabile. Test normalizzazione, saluto e ancora Gmail. |
| 7. Scansione in sospensione | Corretto | Il limite sui thread esisteva già, ma le scansioni ripartivano dal backlog e alcuni errori equivalevano a “nessuna richiesta”. Ora massimo 100 thread e 200 messaggi esaminati per scansione, cursore, cache di 5 minuti, stato `true`/`false`/`null`. Budget esaurito o errore non provano assenza. Solo `true` bypassa la sospensione; `null` viene segnalato nei log e rinviato. Test backlog già gestito, richiesta successiva e guasto. |
| 8. Anti-loop | Corretto | Cinque messaggi esterni potevano essere marcati gestiti senza risposta. Il numero di messaggi esterni da solo non blocca più; densità anomala di risposte del bot produce `Verifica`, senza `IA`. Test completi con cinque/dodici messaggi esterni e thread con densità bot anomala. |
| 9. Documentazione | Corretto | Rimossi modelli obsoleti dalle guide principali, garanzia di 50 email/giorno gratuite e promesse assolute sui log/uso dei dati. Le configurazioni locali sono distinte da disponibilità, quote e condizioni Google. Nessuna modifica a fatturazione o servizi. Fonti ufficiali sotto. |
| 10. Igiene | Corretto | Trovati 15 file scratch tracciati, conservati e inventariati in `maintenance/README.md`; nessuna cancellazione indiscriminata. `scripts/update_tests.py` usa ora la radice derivata dal proprio percorso. Export di migrazione relativo al repository, escluso da clasp. |
| 11. Validazione semantica | Corretto | La revisione per pertinenza KB esisteva già, ma un guasto poteva promuoverla con punteggio lessicale alto. I controlli necessari falliscono chiusi; aggiunti segnali mirati su dispense, validità e deroghe documentali/sacramentali. I controlli facoltativi mantengono il fallback precedente. Test con score alto, servizio assente e guasto. Nessuna chiamata aggiuntiva per ogni risposta indistintamente. |
| 12. Contatore RPM | Corretto | JSON/chunk corrotti potevano diventare consumo zero. Quarantena prudenziale persistita per 60 secondi, saturazione dei modelli configurati, poi reset della finestra illeggibile. Chunk mancanti e payload non-array sono inclusi. Test saturazione ripetuta, ripresa temporizzata e finestra valida. |
| 13. Discrepanza oraria | Corretto | “Ho letto” da solo era un presupposto orario; lingua non gestita ripiegava sull'italiano. Ora quella frase richiede un riferimento alle ore, una nota richiede orari effettivi diversi e per lingue non gestite non viene aggiunta. Test nota italiana, stessa ora, testo senza aspettativa e polacco. |
| 14. Blacklist e fixture | Corretto nel codice; migrazione produzione da eseguire | Rimossi indirizzi personali da `IGNORE_DOMAINS`; nuova proprietà `PERSONAL_IGNORE_SENDERS`, parsing JSON o separatori, normalizzazione, deduplica e errore esplicito per configurazione malformata. Fixture personali anonimizzate, preservando le equivalenze Gmail necessarie ai test. Nessun valore personale riportato qui. La history non è stata riscritta. |

## Migrazione manuale della blacklist, prima del deploy

1. Dalla radice del repository eseguire `node maintenance/export_legacy_blacklist.js 57ca10edd6e3983bb0118633c6696b211a4cd073`.
   Il comando è offline e crea `outputs/personal-ignore-senders.local.json`, ignorato da Git.
   Non stampa gli indirizzi. Se il file esiste già, verificare il contenuto localmente:
   lo strumento non lo sovrascrive.
2. Nell'editor Apps Script di **ciascun progetto interessato**, aprire Impostazioni progetto →
   Proprietà script. Aggiungere `PERSONAL_IGNORE_SENDERS` con l'array JSON esportato.
   Se la proprietà esiste, unire le liste senza perdere le voci preesistenti.
3. Sono accettati anche indirizzi separati da virgola, punto e virgola o nuova riga.
   Formato consigliato: `["blocked@example.org","second@example.org"]` (esempi fittizi).
   Sono ammesse caselle complete, non display name né domini. I domini generici restano
   in `IGNORE_DOMAINS` e nelle configurazioni già previste dal foglio.
4. Spazi e maiuscole vengono normalizzati; duplicati rimossi. JSON malformato o voci non
   valide interrompono l'elaborazione con errore di configurazione senza stampare i valori.
   Proprietà vuota/assente significa nessuna esclusione personale: **non pubblicare prima
   di aver completato il trasferimento**, altrimenti si perde il blocco precedente.
5. Verificare nell'ambiente di collaudo un mittente escluso e uno consentito, con mock/dry run
   appropriati. Eliminare poi il file locale di export. Questo audit non ha eseguito i passi
   di produzione. I valori rimangono eventualmente nei commit storici, che non sono stati modificati.

## Gestione manuale degli invii incerti

`Verifica` non significa invio riuscito. Cercare nel thread e nella posta inviata, anche con
`rfc822msgid:reply_<ID_MESSAGGIO>@parish-reply.invalid` per il percorso RAW. Una ricerca
senza risultato immediato non prova che Gmail non abbia accettato l'invio.

- Se la risposta è presente, mantenere il messaggio escluso dall'automatismo e chiudere la
  revisione dopo riscontro umano; non rimuovere semplicemente i marker per forzare un reinvio.
- Se non si riesce a stabilire l'esito, mantenere `Verifica` e `send_uncertain_<ID>`.
- Solo dopo aver accertato il mancato invio, un amministratore può rimuovere la proprietà
  `send_uncertain_<ID>` e l'etichetta `Verifica` dal messaggio da riprocessare. Per un burst,
  verificare gli ID coinvolti singolarmente. Attendere almeno 15 minuti dal tentativo prima
  di riprocessare, per rispettare i marker temporanei `sending_`/`sendstarted_`.
- Le notifiche dipendono da destinatario configurato (cella di controllo/proprietà
  `VALIDATION_REVIEW_EMAIL`/configurazione), abilitazione, cooldown e disponibilità Gmail/MailApp.
  La notifica non è garanzia di consegna; la label resta il riferimento operativo.

Il marker incerto non scade automaticamente: impedire duplicati richiede una decisione umana
quando manca evidenza. Contiene ID e timestamp, non corpo o destinatario. Monitorare la coda
di revisione e lo spazio PropertiesService. Un processo interrotto dopo la prenotazione
può essere prudenzialmente trattenuto anche se non era ancora arrivato all'invio.

## Memoria, sospensione e dati

`SENSITIVE_FLAGS_TTL_DAYS` è una configurazione locale, predefinita a 180. `_evidence` si
salva nello stesso JSON `contextualFlags` della colonna J, senza nuove colonne. Le date dei
flag non si rinnovano per un semplice follow-up operativo. Un `false` esplicito conserva
una risoluzione che impedisce alla vecchia sintesi di riattivare il flag. Il TTL disattiva
un vincolo operativo: non afferma che una persona abbia superato il lutto, né cancella
automaticamente la sintesi. La pulizia delle righe di memoria resta distinta.

Le righe precedenti prive di data per flag usano il `lastUpdated` valido come ancora di
compatibilità, non come prova della data originaria del fatto. Con data sconosciuta non si
presume attualità. Nessun aggiornamento manuale del foglio è richiesto per la lettura.

In sospensione le scansioni sono limitate e distanziate, ma cache/cursore sono best effort:
evizione e cambiamenti della inbox possono fare ripetere parte della scansione. Il limite
per invocazione resta. Il cursore riguarda una ricerca mobile, non uno snapshot atomico.
Le richieste oltre la finestra di lookback preesistente di 7 giorni non rientrano in questo
detector; la discovery ordinaria ha un percorso separato.

Il sistema legge contenuto, header e allegati secondo configurazione, usa estratti nei prompt,
aggiunge etichette e invia risposte. I messaggi gestiti possono restare non letti; ciò non li
rende nuovamente pendenti. Non è prevista cancellazione automatica delle email in questa
pipeline. Log e notifiche possono includere oggetti, indirizzi, motivi di errore, estratti
documentali e anteprime: non promettere log anonimi né assenza assoluta di dati sensibili.

## Configurazione locale e fonti esterne

Il codice configura `gemini-3.7-flash` per generazione e `gemini-3.5-flash-lite` per ausiliari,
con chiavi logiche di backup. I limiti locali sono rispettivamente RPM 10/15, TPM 250000 e
RPD 1500/1000. Sono budget impostati nel progetto: non provano che questi modelli siano
disponibili nel singolo account, né attribuiscono nuove quote a chiavi dello stesso progetto.
Non sono stati cambiati modelli, piani, chiavi di produzione o fatturazione.

Fonti ufficiali consultate il 22/09/2026:

- [Quote Gemini](https://ai.google.dev/gemini-api/docs/rate-limits): limiti dipendenti da
  progetto/tier; verificare i valori effettivi in AI Studio.
- [Prezzi Gemini](https://ai.google.dev/gemini-api/docs/pricing): disponibilità gratuita e
  funzionalità tariffate dipendono dal modello. Nessuna garanzia di 50 email/giorno.
- [Termini Gemini](https://ai.google.dev/gemini-api/terms): distinguono servizi gratuiti e
  a pagamento, uso dei dati e disposizioni regionali. L'ammissibilità dell'installazione
  e l'eventuale necessità di un progetto con fatturazione attiva richiedono verifica del
  responsabile; questo audit non abilita servizi a pagamento e non certifica conformità.
- [Quote Apps Script](https://developers.google.com/apps-script/guides/services/quotas):
  dipendono dal tipo di account e possono cambiare; limiti del runtime non sono difetti del codice.
- [Ricerca Gmail API](https://developers.google.com/workspace/gmail/api/guides/filtering):
  supporto di query per messaggi, incluso `rfc822msgid`; nessuna prova di indicizzazione immediata.

## Verifiche e limiti

- `bash scripts/run_ci_test_suite.sh`: superato, 114/114 smoke test e 37/37 moduli di test, inclusa la regressione di questo audit.
- `bash scripts/check_js_syntax.sh`: superato; controllo `node --check` anche sui nuovi file JavaScript non ancora tracciati.
- `git diff --check`: superato.
- Guide di configurazione, sicurezza, architettura, deployment e runbook quote allineate alla configurazione locale e ai limiti documentati.

Le prove sono esclusivamente Node con servizi Google simulati. Non sono verificati in
produzione: indicizzazione Gmail dopo timeout, header effettivamente conservati da Gmail,
consegna delle notifiche, quote/modelli dell'account, concorrenza reale GAS e conservazione
effettiva dei dati Google. Il fallback nativo non permette di impostare lo stesso Message-ID:
in caso di dubbio richiede revisione umana.

Citazioni in testo semplice senza prefisso o confine riconoscibile restano ambigue; un
header Outlook introduce un blocco storico senza chiusura affidabile. I test coprono risposte
sotto citazioni esplicite, contenitori HTML bilanciati e P.S.; non promettono comprensione
perfetta di ogni impaginazione email. La validazione semantica mirata riduce rischi specifici,
non dimostra correttezza universale delle risposte.
