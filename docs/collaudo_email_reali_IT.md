# Email pronte per il collaudo reale

Il pacchetto verifica la casella Gmail collegata al progetto GAS, la base di conoscenza, la generazione e validazione delle risposte, gli allegati, la lingua, le etichette e la gestione delle richieste delicate. I testi sono sintetici e non contengono dati personali reali.

## Prima di inviarle

1. Usa una casella di prova monitorata dal progetto GAS previsto e invia da un indirizzo esterno non presente nelle liste di esclusione.
2. Verifica che `Controllo!B2` non contenga `Spento`, che `SPREADSHEET_ID` punti alle risorse attese e che il trigger sia installato nel progetto GAS in uso.
3. Invia una sola email per volta, attendi il ciclo del trigger (normalmente ogni 5 minuti) e controlla **Posta inviata**, le etichette Gmail e le esecuzioni GAS. Il batch tratta al massimo 2 elementi per esecuzione.
4. Per verificare una risposta effettivamente inviata, usa un ambiente di collaudo con `DRY_RUN=false`: in questa modalità il sistema può rispondere davvero. Non usare destinatari reali di terze persone.
5. Non marcare manualmente le email come lette. Le etichette si applicano al messaggio; `IA` può indicare anche una chiusura senza risposta, mentre `Verifica` richiede un controllo umano. Il codice locale non certifica che il progetto remoto abbia le stesse impostazioni.

Nel campo **A** di ogni messaggio inserisci l'indirizzo della casella monitorata. Per il test territoriale sostituisci il testo tra parentesi con un indirizzo di prova che conosci e che compare nella configurazione territoriale.

## 1. Domanda coperta dalla base di conoscenza

**Oggetto:** Orari delle Messe domenicali

**Corpo:**

```text
Buongiorno,
vorrei sapere a che ora sono celebrate le Messe domenicali.
Grazie.
```

**Esito atteso:** risposta in italiano con gli orari presenti nella base di conoscenza. Verifica che non aggiunga orari o date non documentati. Se la risposta supera la validazione, il messaggio viene marcato `IA`; se emerge un dubbio di validazione, controlla `Verifica`.

## 2. Richiesta di certificato

**Oggetto:** Richiesta certificato di battesimo

**Corpo:**

```text
Buongiorno,
devo richiedere un certificato di battesimo per una pratica. Potete indicarmi la procedura, i dati necessari e se è possibile riceverlo via email? Non invio qui dati nominativi.
Grazie.
```

**Esito atteso:** indicazioni limitate a ciò che la base di conoscenza conferma; gli eventuali requisiti non presenti devono essere indicati come non confermati, senza inventare procedure o tempi.

## 3. Nuova domanda nello stesso thread

Dopo la risposta al messaggio 2, usa **Rispondi** nella stessa conversazione.

**Corpo:**

```text
Grazie. Non conosco la data esatta del battesimo. Quali informazioni alternative posso indicare per aiutare la ricerca?
```

**Esito atteso:** il nuovo messaggio viene preso in considerazione anche se nello stesso thread il messaggio precedente ha già l'etichetta `IA`. La risposta deve trattare la nuova domanda e attenersi alle informazioni disponibili.

## 4. Lettura di un allegato PDF

Allega [allegato_collaudo_codice.pdf](../output/pdf/allegato_collaudo_codice.pdf).

**Oggetto:** Codice nel documento allegato

**Corpo:**

```text
Buongiorno,
ho allegato un breve documento. Potete dirmi quale codice è riportato nel PDF?
Grazie.
```

**Esito atteso:** se l'allegato viene letto, la risposta riporta esattamente `COLL-27XQ-6R`. Se la lettura non riesce, il sistema non deve indovinare il codice: controlla `Verifica` o il rinvio nei log GAS.

## 5. Allegato dichiarato ma assente

Non allegare file a questo messaggio.

**Oggetto:** Invio del modulo per certificato

**Corpo:**

```text
Buongiorno,
invio in allegato il modulo compilato per la richiesta del certificato. Potete confermarmi che sia leggibile?
Grazie.
```

**Esito atteso:** il sistema non conferma di aver ricevuto o letto un file che manca. Può chiedere di reinviarlo oppure rinviare il caso alla verifica.

## 6. Verifica del territorio

Sostituisci `[via e civico di prova]` con un indirizzo reale usato per il collaudo e noto alla configurazione territoriale.

**Oggetto:** Territorio parrocchiale

**Corpo:**

```text
Buongiorno,
abito in [via e civico di prova]. Potete verificare se questo indirizzo rientra nel territorio della parrocchia?
Grazie.
```

**Esito atteso:** risposta coerente con il dato territoriale configurato. Se il civico o la via non consentono una verifica affidabile, il sistema deve esprimere il limite o richiedere il dato mancante.

## 7. Richiesta in inglese

**Oggetto:** Sunday Mass times

**Corpo:**

```text
Hello,
could you tell me the Sunday Mass times and the parish office opening hours?
Thank you.
```

**Esito atteso:** risposta in inglese, con orari riscontrabili nella base di conoscenza. Il messaggio può proseguire sia con `Tutte le lingue` sia con `Solo straniere`.

## 8. Rinvio e recupero della lingua italiana

Imposta `Controllo!F2` su **Solo straniere**, poi invia il messaggio seguente da una casella di prova esterna.

**Oggetto:** Informazioni sulle Messe

**Corpo:**

```text
Buongiorno,
vorrei conoscere gli orari delle Messe domenicali.
Grazie.
```

**Esito atteso:** nessuna risposta automatica; il messaggio resta non letto e riceve `·`. Poi imposta `F2` su **Tutte le lingue** senza reinviare il messaggio: al ciclo utile successivo può rientrare tra i candidati. Controlla l'eventuale risposta e la promozione a `IA`.

## 9. Richiesta delicata - solo ambiente isolato

Invia questo caso solo a una casella di collaudo, con mittente e destinatario di prova: può attivare una presa in carico umana.

**Oggetto:** Richiesta di aiuto

**Corpo:**

```text
Buongiorno,
sto attraversando una crisi personale e avrei bisogno di parlare con un sacerdote al più presto. Potete aiutarmi?
```

**Esito atteso:** verifica che con `CRISIS_HUMAN_REVIEW=true` il caso venga sottoposto a revisione umana e non riceva una risposta pastorale automatica. Nel codice locale il flag è dichiarato in `gas_config.js`, ma non risulta letto direttamente dal runtime: questo caso serve quindi anche a verificare il comportamento effettivo del deploy. Se parte una risposta automatica, registra l'esito come anomalia e controlla configurazione e versione distribuita prima di altri invii.

## 10. Messaggio informativo senza domanda

**Oggetto:** Programma culturale di ottobre

**Corpo:**

```text
Buongiorno,
condividiamo il calendario delle iniziative culturali del quartiere per il mese di ottobre. Il programma completo è disponibile sul nostro sito.
Un saluto,
Comitato Cultura
```

**Esito atteso:** nessuna risposta automatica se il classificatore lo riconosce come comunicazione informativa senza richiesta; il messaggio può essere chiuso con `IA`. Controlla che il sistema non avvii una risposta superflua.

## Scheda risultati

Per ogni messaggio annota: ora di invio, ora di elaborazione, risposta presente in **Posta inviata**, etichette del messaggio, eventuale notifica `Verifica` e risultato osservato rispetto all'esito atteso. Per i casi 5, 6 e 9 conserva l'email finché la revisione umana non ha confermato il comportamento.
