# Collaudo saluti e richieste operative

Le modifiche locali preservano il saluto domenicale durante la rifinitura e subordinano la presa in carico alla procedura applicabile. La qualità delle risposte generate si valuta nel progetto GAS di prova prima della distribuzione alla parrocchia.

## Verifiche locali

Eseguire dalla cartella del progetto:

```powershell
pwsh.exe -NoLogo -NoProfile -Command "node tests/test_special_greeting_preservation.js"
pwsh.exe -NoLogo -NoProfile -Command "node tests/test_operational_procedure_refinement.js"
pwsh.exe -NoLogo -NoProfile -Command "node scripts/prepare_operational_procedure_eval.js"
```

La matrice dei saluti copre 2026 e 2027, sei lingue e nove orari: Capodanno, Epifania, Assunzione, Ognissanti, Immacolata, Natale, ottava di Pasqua, Pentecoste, Corpus Domini e Sacra Famiglia. Controlla anche i saluti domenicali diurni, le correzioni dei normali saluti orari e il passaggio completo di validazione in italiano.

I confronti locali delle richieste operative verificano che cambi soltanto la direttiva prevista, che la dimensione del prompt non aumenti e che gli esiti attesi non entrino nei prompt. Sono verifiche del programma; le risposte fittizie usate per controllare il collaudo GAS non misurano la qualità di Gemini.

## Confronto reale nell'account di prova

1. Aprire il progetto Google Apps Script **donRaimondo**, identificato nel file locale `ID dei due progetti.txt`. Usare l'account di prova abituale. Il progetto deve già contenere l'autoresponder, `PromptEngine`, `GeminiService` e la configurazione Gemini funzionante.
2. Aggiungere nell'editor un file di script chiamato `CollaudoOperativo`. Copiarvi il contenuto di `outputs/operational-procedure-eval/collaudo_operativo.gs`, prodotto dal comando precedente. Le credenziali restano nelle proprietà del progetto; il file di collaudo non contiene chiavi.
3. Lasciare inizialmente `COLLAUDO_OPERATIVO_CASO = 'guadalupe_una'` e selezionare la funzione `collaudoProcedureOperative`. Eseguirla dall'editor. Il controllo dell'ID ammette soltanto il progetto donRaimondo.
4. Nel registro di esecuzione leggere le risposte `prima` e `dopo` e i criteri riportati alla fine. Il confronto usa lo stesso modello e gli stessi input; sostituisce la policy sulla singola istanza del motore. Genera soltanto testi, senza leggere la casella, inviare email o modificare la base di conoscenza. Ogni esecuzione richiede due generazioni Gemini, oltre agli eventuali tentativi gestiti dal servizio.
5. Ripetere cambiando `COLLAUDO_OPERATIVO_CASO` con gli identificativi della tabella. Fare almeno tre prove per caso, alternando `COLLAUDO_OPERATIVO_ORDINE` tra `prima_dopo` e `dopo_prima`. Conservare entrambe le risposte, il modello e i criteri. Il risultato resta `da_valutare`: l'esecuzione tecnica riuscita non implica risposta corretta.

| Caso | Comportamento da verificare |
| --- | --- |
| `guadalupe_una` | Collegamento online e nessuna presa in carico via email. |
| `guadalupe_due` | Stessa procedura per due persone, senza garanzia di posti. |
| `guadalupe_mista` | Collegamento online, ore 16:00 e posti non numerati. |
| `evento_email_consentita` | Presa in carico consentita, distinta dalla conferma dei posti. |
| `certificato_autorizzato` | Presa in carico e invio email previsti; data di rilascio da confermare. |
| `certificato_dati_mancanti` | Solo i dati necessari mancanti; nessun rilascio già attestato. |
| `idoneita_padrino` | Impegno personale non delegabile e contatto con un sacerdote. |
| `azione_non_documentata` | Nessuna promessa di stampa, pubblicazione o seguito privo di procedura. |
| `online_raccomandato` | Indicazione online senza inventare un divieto esplicito di email. |
| `solo_informazioni` | Risposta agli orari senza presa in carico aggiunta. |
| `solo_ringraziamento` | Riscontro breve senza riaprire procedure. |
| `aggiornamento` | Presa d'atto senza attestare modifiche già effettuate su archivi. |

Gli scopi del messaggio sono fissati per isolare il prompting. La prova riguarda la generazione sul motore già presente nel progetto remoto; l'allineamento dell'intero progetto remoto al codice locale e il flusso Gmail richiedono un collaudo di integrazione separato. Nessuno dei comandi locali pubblica modifiche. Lo script generale `deploy_gas.ps1` distribuisce a entrambi gli ambienti e va riservato alla successiva distribuzione deliberata.
