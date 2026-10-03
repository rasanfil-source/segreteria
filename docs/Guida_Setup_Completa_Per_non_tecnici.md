# Guida per la segreteria

Aggiornata al 3 ottobre 2026. [English](Setup_Guide_Non_Technical.md)

## Prima attivazione

Un amministratore deve predisporre la casella Gmail, il progetto Apps Script, l'accesso Gemini e il foglio Google. I passaggi tecnici sono nella [guida di installazione](DEPLOYMENT_IT.md). Copiare soltanto alcuni file non basta: l'orchestratore dipende anche dai moduli `gas_thread_*.js`.

Le informazioni usate nelle risposte provengono dai fogli Istruzioni, AI_CORE_LITE, AI_CORE e Dottrina. Contatti, orari e procedure devono essere aggiornati dalla parrocchia. Gli esempi nelle guide non sono dati da usare automaticamente per la propria parrocchia.

## Accensione e lingua

Nel foglio **Controllo**:

1. **B2 — Acceso/Spento:** Spento interrompe l'elaborazione automatica.
2. **F2 — Tutte le lingue/Solo straniere:** scegliere chi deve essere gestito dal sistema.

| Scelta in F2 | Effetto |
|---|---|
| Tutte le lingue | Il sistema può elaborare richieste italiane e in altre lingue. |
| Solo straniere | Le richieste riconosciute come italiane vengono lasciate senza risposta automatica e contrassegnate con `·`. Le altre proseguono. |

La risposta cerca di seguire la lingua rilevata; “Solo straniere” non significa rispondere sempre in inglese. I messaggi molto brevi o misti possono essere interpretati male: controllare i casi dubbi.

Tornando a **Tutte le lingue**, le email con `·` ancora non lette possono essere riprese automaticamente se non hanno altre esclusioni. Se sono state lette manualmente, il cambio modalità da solo non le rimette in coda. Non occorre cancellare tutte le etichette. [Dettagli ed esempi](LANGUAGE_MODES_IT.md).

## Orari e assenze

Le righe 10–16 indicano le **ore in cui sospendere l'automatismo perché la segreteria è presente**. Nel layout corrente: giorno in A, inizio in B, fine in D.

Le assenze nelle righe 5–7 e le festività gestite dal programma mantengono attiva la risposta automatica, salvo interruttore Spento. Durante la sospensione, una richiesta non letta da oltre 12 ore può essere recuperata dal controllo degli arretrati. L'esecuzione dipende anche da trigger, quote e disponibilità dei servizi: non è una risposta istantanea garantita.

Per cambiare un valore usare direttamente le celle di Controllo. Il comando di setup serve a predisporre il layout e conserva i valori esistenti.

## Cosa controllare in Gmail

- **IA:** messaggio trattato, anche quando un filtro ha deciso di non rispondere.
- **Verifica:** serve una persona; può esserci già una risposta inviata o un invio dall'esito incerto.
- **Errore:** problema che richiede diagnosi.
- **·:** italiano rinviato dalla modalità Solo straniere.

Un thread può contenere più messaggi e mostrare etichette diverse. Prima di rispondere a una email in Verifica, controllare la conversazione e la posta inviata. Non è prevista una bozza automatica da approvare. Per gli invii incerti coinvolgere l'amministratore seguendo la [procedura](TROUBLESHOOTING_IT.md).

## Manutenzione ordinaria

Aggiornare la base di conoscenza, controllare la coda Verifica e verificare con l'amministratore eventuali errori persistenti. La modifica della lingua deve applicarsi al foglio effettivamente collegato al progetto. Se non viene rilevata, l'amministratore può invalidare la cache con `clearKnowledgeCache()`.

Le notifiche dipendono da destinatario e servizi configurati: l'assenza di una email di avviso non significa assenza di casi da verificare.
