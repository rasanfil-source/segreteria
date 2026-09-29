# 📚 Guida Knowledge Base - Come Popolarla Efficacemente

> Gli orari, contatti e procedure seguenti sono esempi redazionali, non dati operativi verificati. La selezione dei moduli è descritta nell' [architettura corrente](ARCHITECTURE_IT.md); la lingua delle risposte segue il rilevamento e la [modalità configurata](LANGUAGE_MODES_IT.md). Le istruzioni della KB non garantiscono la correttezza di ogni generazione.

[![English Version](https://img.shields.io/badge/English-Version-blue?style=flat-square)](KNOWLEDGE_BASE_GUIDE.md)

> **Come organizzare le informazioni della tua parrocchia per ottenere le migliori risposte AI**

---

## 🎯 Cos'è la Knowledge Base

La Knowledge Base (KB) è il "cervello" del sistema: contiene tutte le informazioni che l'AI userà per rispondere alle email.

**Pensa alla KB come a un manuale della parrocchia** che il sistema consulta prima di rispondere.

### I 4 Livelli di Knowledge Base

| Foglio | Quando si Usa | Contenuto | Esempio |
|--------|---------------|-----------|---------|
| **Istruzioni** | SEMPRE | Info base: orari, contatti, documenti | "Messe festive: Sab 18:00, Dom 10:00" |
| **AI_CORE_LITE** | Richieste con aspetto pastorale/dottrinale | Principi base | "Usa tono empatico per lutti" |
| **AI_CORE** | Situazioni complesse | Principi pastorali estesi | "Divorziati risposati: rimanda a parroco" |
| **Dottrina** | Domande teologiche | Catechismo, Magistero | "Perché andare a Messa la domenica?" |

---

## 📝 Foglio "Istruzioni" - Il Cuore della KB

### Struttura Base

| Categoria | Informazione | Dettagli |
|-----------|--------------|----------|
| Orari Messe Festive | Inverno | Sabato prefestiva ore 18:00, Domenica ore 8:30, 10:00, 11:30, 18:00 |
| Orari Messe Festive | Estate | Sabato prefestiva ore 19:00, Domenica ore 8:30, 10:00, 11:30, 19:00 |

### Categorie Consigliate

#### 1. Orari (CRITICO)

```
| Categoria | Informazione | Dettagli |
|-----------|--------------|----------|
| Orari Messe Feriali | Inverno (1 ottobre - 31 maggio) | Lunedì-Sabato ore 18:00 |
| Orari Messe Feriali | Estate (1 giugno - 30 settembre) | Lunedì-Sabato ore 19:00 |
| Orari Messe Festive | Inverno | Sabato 18:00, Domenica 8:30, 10:00, 11:30, 18:00 |
| Orari Messe Festive | Estate | Sabato 19:00, Domenica 8:30, 10:00, 11:30, 19:00 |
| Orari Segreteria | Lunedì-Venerdì | 9:00-12:00, 16:00-18:00 |
| Orari Segreteria | Sabato | 9:00-12:00 |
```

**⚠️ IMPORTANTE:** 
- Specifica SEMPRE "Inverno" ed "Estate" per orari stagionali
- Indicare intervalli e date di validità espliciti; il prompt usa il contesto temporale, ma la scelta generata va verificata con casi di confine.

#### 2. Contatti

```
| Categoria | Informazione | Dettagli |
|-----------|--------------|----------|
| Contatti | Telefono | 06-1234567 |
| Contatti | Email | info@parrocchia.it |
| Contatti | Indirizzo | Via Roma 10, 00100 Roma RM |
| Contatti | Parroco | Don Marco Rossi |
| Contatti | WhatsApp | 333-1234567 (solo messaggi, no chiamate) |
```

#### 3. Battesimo

```
| Categoria | Informazione | Dettagli |
|-----------|--------------|----------|
| Battesimo | Documenti richiesti | Certificato di nascita, stato di famiglia, modulo richiesta (scaricabile dal sito) |
| Battesimo | Corso preparazione | Primo sabato del mese ore 16:00, durata 2 ore. Obbligatorio per genitori e padrini |
| Battesimo | Date celebrazioni | Ogni seconda e quarta domenica del mese ore 12:00 |
| Battesimo | Requisiti padrini | Cattolici battezzati, cresimati, se sposati matrimonio in chiesa. Minimo 16 anni |
| Battesimo | Iscrizione | Almeno 2 mesi prima della data desiderata |
```

**💡 TRUCCO:** Più dettagli = Meno domande successive!

#### 4. Prima Comunione

```
| Categoria | Informazione | Dettagli |
|-----------|--------------|----------|
| Prima Comunione | Età | Bambini di terza elementare (8-9 anni) |
| Prima Comunione | Catechismo | Obbligatorio: 2 anni di catechismo prima della Comunione |
| Prima Comunione | Giorni catechismo | Giovedì ore 17:00-18:00 (gruppo A), Sabato ore 16:00-17:00 (gruppo B) |
| Prima Comunione | Iscrizioni | Settembre di ogni anno, presso segreteria |
| Prima Comunione | Data celebrazione 2026 | Domenica 10 maggio 2026 ore 10:30 |
```

#### 5. Cresima

```
| Categoria | Informazione | Dettagli |
|-----------|--------------|----------|
| Cresima Ragazzi | Età | Seconda media (13-14 anni) |
| Cresima Ragazzi | Percorso | 2 anni di catechismo. Incontri settimanali mercoledì ore 18:00-19:00 |
| Cresima Adulti | Percorso | Percorso personalizzato di 1 anno. Incontri quindicinali sabato ore 17:00 |
| Cresima | Requisiti padrino/madrina | Cattolico battezzato e cresimato, minimo 16 anni, se sposato matrimonio in chiesa |
```

#### 6. Matrimonio

```
| Categoria | Informazione | Dettagli |
|-----------|--------------|----------|
| Matrimonio | Primo incontro | Fissare appuntamento con parroco almeno 6 mesi prima |
| Matrimonio | Corso prematrimoniale | Obbligatorio. Prossime date: vedi bacheca parrocchiale o chiama segreteria |
| Matrimonio | Documenti base | Certificati battesimo recenti (max 6 mesi), stato libero, nulla osta (se di altra parrocchia) |
| Matrimonio | Pubblicazioni | Affisse 15 giorni prima del matrimonio |
```

**⚠️ SITUAZIONI COMPLESSE:**
Non inserire qui dettagli su divorzi, convivenze, matrimoni misti. Lascia che l'AI rimandi al parroco.

#### 7. Eventi e Attività

```
| Categoria | Informazione | Dettagli |
|-----------|--------------|----------|
| Adorazione Eucaristica | Quando | Ogni primo venerdì del mese ore 21:00-22:00 |
| Gruppo Giovani | Incontri | Sabato ore 19:30, sala parrocchiale. Età 18-30 anni |
| Catechesi Adulti | Quando | Martedì ore 20:30, ottobre-maggio |
| Caritas | Distribuzione | Giovedì 9:00-11:00, accesso da via laterale |
| Pellegrinaggi 2026 | Destinazioni | Medjugorje (maggio), Lourdes (settembre), Terra Santa (ottobre) - Programmi in segreteria |
```

---

## 🧭 Foglio "AI_CORE_LITE" - Principi Pastorali Base

### Cosa Inserire

**Istruzioni su COME rispondere**, non cosa rispondere.

### Template Raccomandato

| Principio | Istruzione |
|-----------|-----------|
| Tono generale | Usa sempre un tono professionale ma caloroso. Siamo segreteria di una parrocchia, non un ufficio burocratico |
| Firma | Firma sempre con "Segreteria Parrocchia [Nome Parrocchia]" o "Segreteria Parrocchiale [Nome Parrocchia]" |
| Saluti | Adatta il saluto all'ora (Buongiorno/Buonasera). Se utente straniero, saluta nella sua lingua |
| Riferimento sacerdote | Se qualcuno chiede un colloquio personale o supporto spirituale, suggerisci di chiamare o venire in segreteria per fissare appuntamento |
| Urgenze | Per urgenze (lutti, malati gravi), fornisci SUBITO contatti diretti (telefono segreteria, numero sacerdote se disponibile) |
| Bambini | Se richiesta riguarda bambini (battesimo, catechismo), usa tono ancora più accogliente |

### Esempi Pratici

**BENE ✅:**
```
| Principio | Istruzione |
| Tono per primi contatti | "Siamo lieti di accoglierla nella nostra comunità" invece di "La informiamo che..." |
```

**MALE ❌:**
```
| Principio | Istruzione |
| Tono | Usa un tono gentile |  ← TROPPO VAGO
```

---

## 🎓 Foglio "AI_CORE" - Gestione Situazioni Complesse

### Quando Viene Usato

Sistema carica questo foglio SOLO per:
- Richieste classificate "PASTORAL" o "MIXED"
- Email con indicatori emotivi (lutto, sofferenza)
- Situazioni canoniche complesse

### Cosa Inserire

**Linee guida per situazioni delicate:**

```
| Principio | Istruzione |
|-----------|-----------|
| Divorziati risposati | Per persone divorziate e risposate civilmente: NON dare risposte definitive. Spiega che la situazione richiede discernimento pastorale personalizzato. Invita a parlare con il parroco. NON dire "non puoi" ma "la tua situazione necessita di un colloquio" |
| Conviventi | Per conviventi che chiedono matrimonio: accogli la richiesta con gioia. Spiega che c'è un percorso di accompagnamento. NON giudicare, invita a fissare appuntamento |
| Lutti | Per chi ha perso una persona cara: esprimi subito vicinanza ("Siamo vicini a lei e alla sua famiglia in questo momento di dolore"). POI fornisci info pratiche su funerale |
| Malattie gravi | Offri supporto concreto: visita sacerdote, comunione a domicilio, unzione infermi. Fornisci contatti immediati |
| Crisi di fede | Non dare risposte teologiche complesse via email. Invita a dialogo personale con sacerdote. Mostra comprensione |
| Padrini/Madrine non in regola | Se padrino/madrina non ha requisiti: spiega i requisiti canonici MA aggiungi "Parliamone in segreteria, potrebbero esserci soluzioni" |
```

### Anti-Pattern (Cosa NON Fare)

❌ **Giudicare:**
```
"Se sei divorziato risposato non puoi ricevere i sacramenti"
```

✅ **Accogliere e rimandare:**
```
"La ringrazio per la fiducia. La situazione di chi è divorziato e risposato necessita di un discernimento pastorale personalizzato. La invito a parlarne con don Marco..."
```

---

## 📖 Foglio "Dottrina" - Risposte Teologiche

### Quando Viene Usato

Sistema carica questo foglio per domande tipo:
- "Perché la Chiesa dice che..."
- "Cosa insegna la Chiesa su..."
- "È peccato..."

### Struttura Consigliata

| Sotto-tema | Spiegazione | Fonte | Tono consigliato | Criterio pastorale | Limiti da non superare | Indicazioni operative AI |
|------------|-------------|-------|------------------|--------------------|-----------------------|-------------------------|
| Messa domenicale | La Chiesa insegna che la Messa domenicale è obbligo perché celebriamo la Risurrezione di Cristo, momento centrale della nostra fede. È il giorno del Signore dedicato a Lui | CCC 2042, 2180-2183 | Chiaro ma non giudicante | Spiega il "perché" prima del "cosa". Mostra la bellezza prima dell'obbligo | Non dire solo "è obbligo", non spaventare | Inizia spiegando significato della domenica, poi menziona aspetto precettuale |

### Esempi Popolamento

#### Tema: Sacramento della Riconciliazione

```
| Sotto-tema | Spiegazione | Fonte | Tono consigliato |
|------------|-------------|-------|------------------|
| Confessione obbligatoria? | La confessione dei peccati gravi è necessaria per ricevere l'Eucaristia degnamente. È un dono: Gesù ci perdona attraverso il sacerdote. Non è un obbligo pesante ma opportunità di riconciliazione | CCC 1456-1457, 1493 | Accogliente, mostra la confessione come dono non peso |
```

#### Tema: Vita Morale

```
| Sotto-tema | Spiegazione | Fonte | Limiti da non superare |
|------------|-------------|-------|------------------------|
| Convivenza prematrimoniale | La Chiesa insegna che l'intimità coniugale appartiene al matrimonio. Tuttavia ogni persona ha una storia: importante accompagnamento | CCC 2350-2391 | NON dare giudizi sulle persone. Spiega la dottrina MA invita sempre a dialogo personale per approfondimenti |
```

---

## 💡 Best Practices

### 1. Sii Specifico, Non Generico

❌ **Generico:**
```
| Categoria | Informazione | Dettagli |
| Battesimo | Documenti | Servono documenti |
```

✅ **Specifico:**
```
| Categoria | Informazione | Dettagli |
| Battesimo | Documenti | 1) Certificato di nascita originale 2) Stato di famiglia 3) Modulo richiesta battesimo (scaricabile da www.parrocchia.it/battesimo) 4) Fotocopia documento genitori e padrini |
```

### 2. Usa Esempi Concreti

❌ **Astratto:**
```
| Catechismo | Orari | Vari orari disponibili |
```

✅ **Concreto:**
```
| Catechismo Prima Comunione | Orari | Gruppo A (bambini nati 2017): Giovedì 17:00-18:00. Gruppo B (bambini nati 2016): Sabato 16:00-17:00 |
```

### 3. Anticipa Domande Successive

Dopo ogni info, chiediti: "Cosa chiederà l'utente dopo?"

Esempio:
```
| Battesimo | Documenti | ... (lista documenti) |
| Battesimo | Dove ottenere certificato nascita | Comune di nascita, Ufficio Stato Civile. Si può richiedere anche online su www.anpr.it |
| Battesimo | Modulo richiesta | Scaricabile da www.parrocchia.it/documenti oppure disponibile in segreteria |
```

### 4. Mantieni Aggiornato

**Pianifica revisione trimestrale:**
- ✅ Orari estivi/invernali
- ✅ Date eventi
- ✅ Contatti (se cambiano)
- ✅ Prezzi (se applicabile)

---

## 🚫 Cosa NON Mettere in KB

### Dati Sensibili

❌ **Mai inserire:**
- Numeri telefono personali fedeli
- Indirizzi email personali
- Dati anagrafici persone
- Situazioni pastorali di singoli

### Informazioni Mutevoli

❌ **Evita:**
```
| Evento | Data | Dettagli |
| Festa Patronale | 21 giugno 2026 | ... |
```

✅ **Meglio:**
```
| Evento | Data | Dettagli |
| Festa Patronale | Terza domenica di giugno | ... |
```

### Opinioni Personali

❌ **Non inserire:**
```
| Principio | Istruzione |
| Messe | La Messa delle 10 è la più bella |
```

✅ **Oggettivo:**
```
| Orari Messe | Domenica | 8:30 (senza canto), 10:00 (coro), 11:30 (famiglie), 18:00 (giovani) |
```

---

## 📊 Test della Tua KB

### Checklist Qualità

Questo esempio stampa domande per una revisione manuale; non chiama il generatore e non costituisce un test automatico della KB:

```javascript
function testKnowledgeBase() {
  console.log('🧪 TEST KNOWLEDGE BASE\n');
  
  const tests = [
    { domanda: 'A che ora è la messa domenicale?', risposta_attesa: 'Orari specifici' },
    { domanda: 'Come si fa a battezzare un bambino?', risposta_attesa: 'Documenti + corso + date' },
    { domanda: 'Abito in Via Roma 10, è vostra parrocchia?', risposta_attesa: 'Verifica territorio' }
  ];
  
  console.log('Verifica manualmente che la KB contenga info per rispondere a:');
  tests.forEach((test, i) => {
    console.log(`${i+1}. "${test.domanda}"`);
    console.log(`   Atteso: ${test.risposta_attesa}`);
  });
  
  console.log('\n✓ Se hai info per TUTTE queste domande, la KB è buona!');
}
```

### Verifica degli esiti

Valutare esempi concreti e motivi di revisione. IA include messaggi filtrati senza risposta; Verifica può accompagnare un invio e · dipende dalla modalità lingua. Il rapporto tra conteggi di label non misura automaticamente qualità della KB o tasso di risposte. Uno score alto non supera controlli bloccanti.

## 🔄 Workflow Aggiornamento

### Settimanale
1. Controlla email "Verifica"
2. Identifica info mancanti
3. Aggiungi alla KB

### Mensile
1. Revisiona orari (se cambiano stagionalmente)
2. Aggiorna date eventi
3. Verifica contatti ancora validi

### Annuale
1. Revisione completa
2. Rimozione info obsolete
3. Aggiornamento calendario liturgico

---

## Risorse disponibili

Il repository conserva una copia Excel locale in `outputs/link-email-2026-09-13/Base di Conoscenza AI.xlsx`. È un artefatto di lavoro: il runtime legge il Google Sheet selezionato da SPREADSHEET_ID, non quel file locale. I precedenti segnaposto di download non erano collegamenti a template distribuiti.
