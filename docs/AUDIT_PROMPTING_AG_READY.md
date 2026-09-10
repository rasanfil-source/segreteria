# Audit prompting — Segreteria Email Parrocchiale AI (progetto AG)

**Data:** 2026-09-09  
**Ambito:** revisione del *prompting* e della governance della risposta automatica  
**Metodo:** sola lettura del codice e della documentazione in  
`...\SCRIPT\GMAIL AUTOMATICA\GMAIL PARROCCHIA\Google Script\AG`  
**Vincolo operativo:** nessuna modifica al codice («si guarda ma non si tocca»)

---

## 1. Sintesi esecutiva

Il sistema è un **autorisponditore pastorale-amministrativo** sulla casella Gmail parrocchiale.  
Classifica le richieste, genera risposte con Gemini ancorate a una **Knowledge Base** (Google Sheets), mantiene una **memoria di conversazione**, valida la bozza e decide se inviare o etichettare per verifica umana (`IA` / `Verifica` / `Errore`).

**Filosofia dichiarata:** *Fail Pastoral, Not Technical* — meglio rinviare a un operatore umano che inventare contenuti.

**Valutazione complessiva del servizio** (prodotto gratuito / zero costo operativo di licenza per la parrocchia), **escludendo** i limiti strutturali della piattaforma Apps Script:

### **8,5 / 10**

Giustificazione breve: supera nettamente una tipica autoresponder parrochiale. Combina routing intelligente, KB vincolante, memoria tipizzata, validazione multipla e suite di regressione. I punti aperti (P0) riguardano soprattutto **coerenza interna del prompt** e **completezza del QuickCheck su email lunghe**, non l’assenza di architettura.

---

## 2. Cosa fa il sistema (per il revisore)

1. Legge e filtra le email (spam, newsletter, loop, ack).  
2. Classifica localmente e con un **QuickCheck** Gemini (JSON strutturato).  
3. Determina il tipo di richiesta (tecnica / pastorale / mista / dottrinale).  
4. Costruisce un **PromptContext** (profilo lite / standard / heavy, registro di risposta).  
5. Compone il prompt in `PromptEngine` (sezioni system vs user, KB, memoria, few-shot, checklist).  
6. Genera la risposta (temperature moderata, safety elevata).  
7. **Valida** (lingua, firma, allucinazioni, territorio, presenza fisica, contenuto vietato, score minimo).  
8. Invia oppure mette in coda `Verifica`; aggiorna la memoria.

Componenti rilevanti (solo nomi, nessuna patch):  
`gas_prompt_engine.js`, `gas_prompt_context.js`, `gas_gemini_service.js`, `gas_response_validator.js`, `gas_classifier.js`, `gas_request_classifier.js`, `gas_memory_service.js`, `gas_response_strategy.js`, `gas_email_processor.js`.

Documentazione di supporto già presente nel repo:  
`README_IT.md`, `docs/ARCHITECTURE_IT.md`, `docs/rule_policy_layer.md`, `docs/AUDIT_PROMPT_MEMORY_*`, `docs/COLLAUDO_PROMPT_MEMORIA_*`, `docs/PROGETTO_AFFINAMENTO_*`, `docs/SECURITY_IT.md`, golden `tests/golden_cases.json` (~34 casi).

---

## 3. Punti di forza del prompting

| Area | Perché conta |
|------|----------------|
| Separazione system / user | Riduce l’influenza di istruzioni nascoste nell’email |
| Input esplicitamente «non fidato» | Mitigazione prompt injection |
| Profili lite / standard / heavy | Contiene costi e rumore; carica Dottrina solo se serve |
| Distinzione *topic* vs *request_purpose* | Evita risposte «da manuale» su richieste operative |
| Contratto KB | «Solo fatti della KB»; assenza ≠ divieto inventato |
| Memoria + posture + strategia | Continuità conversazionale pastorale |
| Validazione ampia + golden tests | Governance prima dell’invio |
| Casi sensibili trattati | Es. sbattezzo formale, crisi, lutto |

---

## 4. Miglioramenti consigliati (priorità audit)

> Elenco **osservativo**: non è un piano di intervento già eseguito.

### P0 — coerenza / rischio risposta errata

1. **Conflitto saluto «Caro/Cara»**  
   In `gas_prompt_engine.js` una direttiva di ruolo lo vieta; il registro `full_warm` lo preferisce.  
   **Azione consigliata:** unificare la policy per registro di risposta.

2. **Few-shot con dati inventabili**  
   Esempi con telefono/date di fantasia (es. formato `06.…`, date Santiago) possono essere **copiati** dal modello, aggirando la KB.  
   **Azione consigliata:** esempi solo strutturali («formato»), senza contatti/orari reali o realistici.

3. **QuickCheck con corpo email ≤ 800 caratteri**  
   Nelle email lunghe si possono perdere vincoli, purpose e presenza.  
   **Azione consigliata:** head+tail o estratti strutturati (senza necessariamente una seconda chiamata).

### P1 — qualità / governance del prompt

4. **Sovrapposizione istruzioni system** (strategy + register + DecisionFrame + checklist + reminder): rischio di contraddizione e diluizione dell’attenzione. Misurare footprint (`scripts/measure_prompt_footprint.js`) e fondere equivalenti.  
5. **Allineare `SECURITY_IT.md` e pratica memoria**: la doc invita a non memorizzare dati sensibili in modo permanente; in pratica la memoria può tenere flag di presenza/salute/mobilità/lutto. Allineare retention e testo di policy.  
6. **Few-shot solo in italiano**: corretto anti-leak linguistico; valutare 1–2 esempi *strutturali* EN/ES senza fatti KB.

### P2 — raffinamento

7. Temperature del QuickCheck (JSON) eventualmente più bassa di quella di generazione.  
8. Separare nei golden assert «forma del prompt» da «qualità send-ready» (alcuni `minValidatorScore` molto bassi sono utili in regressione ma deboli come barriera prodotto).

---

## 5. Valutazione complessiva (criteri da servizio parrochiale gratuito)

**Non** si valutano qui i limiti intrinseci di Apps Script / quote Gemini free.  
Si valuta il **valore del servizio** rispetto a: affidabilità pastorale, sicurezza delle informazioni, manutenibilità del prompting, costo zero per la comunità.

| Criterio | Giudizio |
|----------|----------|
| Utilità quotidiana (orari, sacramenti, FAQ, territorio) | Alto |
| Protezione da allucinazioni (KB + validator) | Buono / molto buono |
| Gestione casi umani / rinvio | Buona |
| Test e collaudo del prompting | Sopra la media del settore «automazioni parrochiali» |
| Coerenza interna delle istruzioni di prompt | Da chiudere (P0.1–P0.2) |
| Privacy / memoria sensibile | Da allineare doc ↔ pratica (P1.5) |

**Voto: 8,5 / 10** — prodotto già produttivo e serio; con i P0 si può ragionevolmente puntare a 9+.

---

## 6. Rischi operativi e governance (prompt / memoria)

1. **Memoria sensibile su Sheet** — chi ha accesso al foglio vede segnali pastorali; servono retention e accesso minimi.  
2. **Auto-invio sopra soglia validator** — residuo rischio tono/edge case; monitorare coda `Verifica`.  
3. **Qualità e aggiornamento KB** — il prompt impone «solo KB»: KB incompleta ⇒ risposte incomplete o rinvii frequenti.  
4. **Prompt injection** (email/allegati) — mitigata a livello istruzioni, non azzerata.  
5. **Overclaim GDPR** se la documentazione privacy è più restrittiva della pratica di memoria.

---

## 7. Dichiarazione di metodo

- Nessuna modifica, deploy, `clasp push`, cancellazione o editing del codice AG.  
- Nessuna citazione di segreti da `gas_config.js` (solo riferimenti a knobs pubblici / example).  
- Nessuna email reale inviata e nessuna chiamata Gemini di collaudo in questa revisione.  
- Fonte: lettura repository locale AG + report di audit prompting del 2026-09-08/09.

---

## 8. Allegati utili per il revisore (nel repo, non allegati qui)

- `README_IT.md`  
- `docs/ARCHITECTURE_IT.md`  
- `docs/rule_policy_layer.md`  
- `docs/SECURITY_IT.md`  
- `tests/golden_cases.json`  
- Suite: `test_golden_prompt_validator.js`, `test_prompt_*.js`, `test_presence_memory_reconciliation.js`

---

*Documento preparato per revisione esterna. Non costituisce parere legale GDPR; per la privacy si rimanda a valutazione giuridica dedicata.*
