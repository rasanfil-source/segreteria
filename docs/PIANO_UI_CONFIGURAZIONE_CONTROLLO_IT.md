# Piano UI di configurazione (Google Sheets) per autoresponder parrocchiale

## Assunzioni dichiarate
- Il foglio principale resta `Controllo` e continua ad essere il punto di accesso per la segreteria.
- Il backend è Google Apps Script (GAS) e leggerà **solo Named Ranges** (mai coordinate hardcoded), così le celle possono essere spostate/accorpate senza rompere il codice.
- `B10:D16` in `Controllo` viene riservato agli orari settimanali (giorno, dalle, alle), come richiesto.
- Le assenze possono essere multiple e sovrapposte; la logica considera “segretario non in servizio” se **esiste almeno un record attivo oggi**.

---

## 1) Proposta layout foglio `Controllo`

### Sezione A — Stato generale (hero block)
**Posizione suggerita:** `A1:F4`

- **Titolo:** `STATO DEL SISTEMA` (A2:C2, anche celle unite se desiderato)
- **Toggle operativo:** `B2` (dropdown: `Acceso`, `Spento`)
- **Badge stato sintetico:** `E2:F2` (formula + formattazione condizionale: `🟢 Attiva`, `🟡 Sospesa`, `🔴 Spenta`)
- **Descrizione breve (A3:F3):** frase di aiuto in linguaggio naturale (“Il sistema risponde automaticamente solo quando...”).

**UX note:**
- B2 è l’unico controllo “master”, molto visibile.
- Il badge è ridondante (testo + colore + icona) per accessibilità.

### Sezione B — Mini-dashboard “Stato oggi”
**Posizione suggerita:** `E5:F9`

Righe consigliate:
- `Risposta automatica:` valore calcolato (`Attiva/Sospesa/Spenta`)
- `Segretario:` (`In servizio/Assente`)
- `Motivo:` (es. `Spento manualmente`, `Fuori orario`, `Assenza: Malattia`)
- `Oggi:` data odierna
- `Fascia oraria attuale:` es. `08:00–14:00` oppure `Nessuna`

### Sezione C — Sospensione per giorno (vincolo B10:D16)
**Posizione obbligatoria:** `B10:D16`

- Colonne:
  - `B`: Giorno (`Lunedì` ... `Domenica`)
  - `C`: Dalle (ora)
  - `D`: Alle (ora)
- Riga fissa 7 giorni, ordinamento naturale settimana.
- Descrizione sotto titolo: “Fuori da questa fascia il sistema è sospeso (salvo override).”

### Sezione D — Link rapidi a tabelle estese
**Posizione suggerita:** `A18:F22`

- Box con istruzioni + link (menu fogli) a:
  - `Assenze`
  - `Filtri`
- Motivazione: in `Controllo` restano i controlli giornalieri; i dati estesi stanno in fogli specializzati.

---

## 2) Mappa celle/range (Named Ranges consigliati)

> Convenzione nomi: prefisso `cfg_` (config), `sum_` (summary), `tbl_` (tabella), `lst_` (lista).

| Named Range | Foglio | Intervallo | Tipo dato | Chi lo legge |
|---|---|---|---|---|
| `cfg_system_master` | Controllo | `Controllo!B2` | testo enum (`Acceso/Spento`) | codice + utente |
| `sum_auto_status` | Controllo | `Controllo!F5` | testo (`Attiva/Sospesa/Spenta`) | formula + codice |
| `sum_secretary_status` | Controllo | `Controllo!F6` | testo (`In servizio/Assente`) | formula + codice |
| `sum_today_reason` | Controllo | `Controllo!F7` | testo | formula + codice |
| `sum_today_date` | Controllo | `Controllo!F8` | data | formula + utente |
| `sum_today_slot` | Controllo | `Controllo!F9` | testo/orario | formula + codice |
| `tbl_week_schedule` | Controllo | `Controllo!B10:D16` | tabella (giorno, ora, ora) | codice + utente |
| `tbl_week_days` | Controllo | `Controllo!B10:B16` | testo | formula + codice |
| `tbl_week_from` | Controllo | `Controllo!C10:C16` | ora | codice + utente |
| `tbl_week_to` | Controllo | `Controllo!D10:D16` | ora | codice + utente |
| `tbl_absences` | Assenze | `Assenze!A2:G` | tabella normalizzata | codice + utente |
| `lst_ignore_domains` | Filtri | `Filtri!A2:A` | lista testo (dominio) | codice + utente |
| `lst_ignore_keywords` | Filtri | `Filtri!C2:C` | lista testo (keyword) | codice + utente |
| `cfg_timezone` | Controllo | `Controllo!B4` | testo (`Europe/Rome`) | codice |
| `cfg_holidays_mode` | Controllo | `Controllo!B5` | boolean/testo (`Considera Festivi`) | codice + utente |

---

## 3) Strutture dati consigliate

### 3.1 Assenze segretario (foglio `Assenze`, tabella normalizzata)

**Intestazioni (`A1:G1`):**
1. `id_assenza` (UUID o progressivo)
2. `tipo` (`Ferie`, `Permesso`, `Malattia`, `Altro`)
3. `data_dal`
4. `data_al`
5. `intera_giornata` (`TRUE/FALSE`)
6. `note`
7. `attiva_oggi` (formula)

**Esempi righe:**
- `A-2026-001 | Ferie | 12/08/2026 | 30/08/2026 | TRUE | Estate | TRUE`
- `A-2026-002 | Permesso | 14/08/2026 | 14/08/2026 | TRUE | Ufficio comunale | TRUE`
- `A-2026-003 | Malattia | 17/02/2026 | 19/02/2026 | TRUE | Influenza | TRUE`

**Formula colonna `attiva_oggi` (G2):**
`=SE(O(C2="";D2="");FALSE;E(OGGI()>=C2;OGGI()<=D2))`

### 3.2 Sospensioni per giorno (`Controllo!B10:D16`)

Schema fisso:
- `B10:B16`: Lunedì ... Domenica (bloccato/protetto)
- `C10:C16`: ora inizio servizio
- `D10:D16`: ora fine servizio

Esempio:
- `Lunedì | 08:00 | 20:00`
- `Martedì | 08:00 | 14:00`
- `Sabato | (vuoto) | (vuoto)` → nessuna fascia attiva

### 3.3 Domini ignorati (`Filtri`)

- Colonna `A`: un dominio per riga, senza protocollo
- Da `A2` in giù, espandibile all’infinito
- Esempi: `amazon.com`, `eventbrite.com`, `mailchimp.com`, `noreply.paypal.com`

### 3.4 Parole chiave ignorate (`Filtri`)

- Colonna `C`: una keyword/espressione per riga
- Da `C2` in giù, espandibile
- Esempi: `unsubscribe`, `newsletter`, `opt-out`, `annulla iscrizione`, `do-not-reply`

---

## 4) Regole di validazione e protezione

### Validazioni
1. **Master switch (`cfg_system_master`)**
   - Lista consentita: `Acceso,Spento`
   - Input non valido: rifiuta + messaggio “Scegli Acceso o Spento”.

2. **Orari (`C10:D16`)**
   - Tipo: Ora valida.
   - Regola: `=O(E(C10="";D10="");C10<D10)` applicata per riga.
   - Messaggio: “Inserisci orario in formato HH:MM e verifica che ‘dalle’ < ‘alle’.”

3. **Assenze (`Assenze`)**
   - `tipo`: elenco chiuso (`Ferie,Permesso,Malattia,Altro`)
   - `data_dal`, `data_al`: devono essere date valide.
   - `data_dal <= data_al`: regola custom su riga.

4. **Domini (`Filtri!A2:A`)**
   - Regex (validazione personalizzata):
     `=REGEXMATCH(A2;"^(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$")`
   - Messaggio: “Inserisci solo dominio (es. example.com), senza https://”.

5. **Keyword (`Filtri!C2:C`)**
   - Non vuota, trim automatico (eventuale formula appoggio o Apps Script onEdit).

### Protezioni
- Proteggi intestazioni e colonne struttura (`giorni settimana`, header tabelle).
- Lascia editabili solo aree dati (`B2`, `C10:D16`, `Assenze!A2:F`, `Filtri!A2:A`, `Filtri!C2:C`).
- Proteggi celle formula riepilogo (`F5:F9`) da editing umano.

---

## 5) Indicatori visivi e mini-dashboard

### Semafori + badge
- `🟢 Attiva`: master acceso + in fascia oraria + non assente + non filtro bloccante.
- `🟡 Sospesa`: master acceso ma condizione temporanea blocca risposta (fuori orario/assenza/festivo).
- `🔴 Spenta`: master su spento.

### Badge testuale consigliato (cell `F5`)
- Formula indicativa (pseudologica):
  - se `cfg_system_master="Spento"` → `🔴 Spenta`
  - altrimenti se `segretario_assente_oggi=TRUE` → `🟡 Sospesa`
  - altrimenti se `ora_corrente_fuori_fascia=TRUE` → `🟡 Sospesa`
  - altrimenti `🟢 Attiva`

### Messaggi d’errore amichevoli
- “Hai inserito un dominio non valido. Esempio corretto: diocesi.it”
- “La data di fine deve essere uguale o successiva alla data di inizio.”
- “Per martedì manca l’orario ‘alle’.”

### Mini-dashboard “Stato oggi”
- 4 KPI chiari:
  1. Stato risposta automatica
  2. Stato segretario
  3. Motivo blocco (se presente)
  4. Fascia valida del giorno corrente

---

## 6) Fogli separati: proposta nomi + pro/contro

## Nomi fogli
- `Controllo` (comando + dashboard)
- `Assenze` (eventi assenza normalizzati)
- `Filtri` (domini + keyword)
- *(Opzionale)* `Lookup` (liste statiche: giorni settimana, tipi assenza)

## Pro
- Scalabilità (liste lunghe non invadono `Controllo`).
- Minore rischio errori (ruoli chiari per sezione/foglio).
- Codice più robusto (range stabili e semantici).

## Contro
- Più fogli da governare (serve onboarding minimo).
- Se non protetti bene, utenti possono alterare strutture.

**Compromesso UX consigliato:** `Controllo` resta “cockpit”; gli altri fogli sono “dati avanzati”.

---

## 7) Strategia di migrazione (compatibilità B2/B6/C9)

### Fase 0 — Preparazione (no rotture)
1. Crea fogli nuovi `Assenze` e `Filtri`.
2. Crea Named Ranges chiave (`cfg_system_master`, `tbl_week_schedule`, `tbl_absences`, `lst_ignore_domains`, `lst_ignore_keywords`).
3. Mantieni lettura legacy di `B2`, `B6`, `C9` nel codice.

### Fase 1 — Doppia scrittura / doppia lettura temporanea
1. Copia dati storici:
   - vecchie assenze → `Assenze!A2:G`
   - domini/parole dal riquadro a destra → `Filtri!A2:A` e `Filtri!C2:C`
2. Implementa adapter nel codice:
   - prima prova Named Ranges
   - fallback a celle legacy (`B2/B6/C9`) se range assenti o vuoti

### Fase 2 — Attivazione nuova logica
1. Sposta orari in `Controllo!B10:D16` (se non già lì).
2. Calcola `RIASSUNTO` da tabelle nuove.
3. Evidenzia in `Controllo` un avviso: “Modalità nuova configurazione attiva”.

### Fase 3 — Decommissioning legacy
1. Dopo 2–4 settimane senza errori, rimuovi fallback hardcoded (`B6/C9`).
2. Conserva `B2` come alias del master switch (può restare definitivo).
3. Blocca/archivia vecchi blocchi non più usati.

### Named Ranges da creare subito (priorità alta)
1. `cfg_system_master` → `Controllo!B2`
2. `tbl_week_schedule` → `Controllo!B10:D16`
3. `tbl_absences` → `Assenze!A2:G`
4. `lst_ignore_domains` → `Filtri!A2:A`
5. `lst_ignore_keywords` → `Filtri!C2:C`
6. `sum_auto_status` → `Controllo!F5`
7. `sum_today_reason` → `Controllo!F7`

---

## Nota tecnica per robustezza con celle unite
Se vuoi un layout più “premium” con celle unite (titoli, box, badge), usa questa regola:
- **celle unite solo in aree decorative/informative**;
- **mai nelle tabelle lette dal codice** (`tbl_*`, `lst_*`), che devono restare normalizzate;
- il codice legge solo Named Ranges, non coordinate singole.

In questo modo hai grafica accattivante **e** affidabilità enterprise.
