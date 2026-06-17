# 📐 Diagrammi Architettura Sistema

[![English Version](https://img.shields.io/badge/English-Version-blue?style=flat-square)](ARCHITECTURE_DIAGRAMS.md)

> **Visualizzazione completa dell'architettura SPA (Segreteria Parrocchiale Automatica)**

---

## 1. Vista Componenti (C4 Level 2)

```mermaid
graph TB
    subgraph "Google Workspace"
        Gmail["📧 Gmail API"]
        Sheets["📊 Google Sheets"]
    end
    
    subgraph "Google Apps Script Runtime"
        Main["🎯 Main.gs<br/>Orchestrator"]
        Proc["⚙️ EmailProcessor<br/>Pipeline Manager"]
        Class["🧹 Classifier<br/>Filter Engine"]
        ReqClass["🎨 RequestClassifier<br/>Type Detector"]
        Gemini["🤖 GeminiService<br/>AI Gateway"]
        Valid["✅ ResponseValidator<br/>Quality Gate"]
        Memory["💾 MemoryService<br/>State Manager"]
        Rate["⏱️ RateLimiter<br/>Quota Manager"]
        PContext["🧠 PromptContext<br/>Profile + Concern"]
        Prompt["📝 PromptEngine<br/>System/User Builder"]
        Territory["🗺️ TerritoryValidator<br/>Address Checker"]
    end
    
    subgraph "External APIs"
        GeminiAPI["🧠 Google Gemini API<br/>3.1 Flash-Lite + Context Cache"]
    end
    
    Gmail -->|Read Threads| Main
    Main -->|Schedule| Proc
    Proc --> Class
    Proc --> ReqClass
    Proc --> Territory
    ReqClass --> PContext
    Territory --> PContext
    Memory --> PContext
    PContext --> Prompt
    Prompt -->|systemInstruction + prompt| Gemini
    Gemini -->|Rate Check| Rate
    Rate -->|API Call| GeminiAPI
    GeminiAPI -->|Response| Gemini
    Gemini --> Valid
    Valid --> Memory
    Memory --> Sheets
    Valid -->|Send Reply| Gmail
```

---

## 2. Flusso Dati Email (Sequence Diagram)

```mermaid
sequenceDiagram
    participant U as 👤 Utente
    participant G as 📧 Gmail
    participant M as 🎯 Main
    participant P as ⚙️ Processor
    participant C as 🧹 Classifier
    participant AI as 🤖 Gemini
    participant V as ✅ Validator
    participant S as 💾 Memory
    
    U->>G: Invia Email
    Note over G: Email non letta in Inbox
    
    rect rgb(240, 248, 255)
        Note over M: Trigger ogni 5 minuti
        M->>G: Cerca email non lette
        G->>M: Lista thread
    end
    
    loop Per ogni thread
        M->>P: Processa thread
        
        P->>C: Classifica email
        C-->>P: shouldReply, category, lang
        
        alt Email da ignorare
            P->>G: Applica label "Skipped"
        else Email valida
            P->>AI: Quick Check
            AI-->>P: reply_needed, confidence
            
            alt Risposta necessaria
                P->>AI: Genera risposta
                AI-->>P: Risposta AI
                
                P->>V: Valida risposta
                
                alt Validazione OK (score ≥ 0.6)
                    V-->>P: ✅ Valid
                    P->>G: Invia risposta
                    P->>G: Applica label "IA"
                    P->>S: Aggiorna memoria
                else Validazione FAIL
                    V-->>P: ❌ Invalid
                    P->>G: Applica label "Verifica"
                end
            else Nessuna risposta necessaria
                P->>G: Applica label "NoReply"
            end
        end
    end
```

---

## 3. Pipeline di Validazione (7 Layer)

```mermaid
graph LR
    subgraph "Input"
        R["📝 Risposta AI"]
    end
    
    subgraph "Validation Layers"
        L1["1️⃣ Lunghezza<br/>25-3000 chars"]
        L2["2️⃣ Lingua<br/>IT/EN/ES"]
        L3["3️⃣ Firma<br/>Presente?"]
        L4["4️⃣ Contenuto<br/>Vietato?"]
        L5["5️⃣ Allucinazioni<br/>Dati inventati?"]
        L6["6️⃣ Grammatica<br/>Maiuscola post-virgola"]
        L7["7️⃣ Thinking Leak<br/>Ragionamento esposto?"]
    end
    
    subgraph "Output"
        OK["✅ VALID<br/>Invia"]
        FAIL["❌ INVALID<br/>Verifica"]
    end
    
    R --> L1 --> L2 --> L3 --> L4 --> L5 --> L6 --> L7
    L7 -->|score ≥ 0.6| OK
    L7 -->|score < 0.6| FAIL
```

---

## 4. Strategia Fallback Modelli AI

```mermaid
graph TD
    subgraph "Task Type"
        QC["🔍 Quick Check"]
        GEN["📝 Generation"]
        FB["🔄 Fallback"]
    end
    
    subgraph "Model Chain"
        F31["⭐ Flash 3.1 Lite<br/>RPD: 3500"]
        FLITE["💡 Alias Lite<br/>RPM: 2000 / TPM: 2M"]
        CACHE["🧠 Context Cache<br/>TTL persistito"]
    end
    
    subgraph "Decision"
        CHECK{Quota OK?}
        NEXT[Prova prossimo]
        ERROR["🚨 QUOTA_EXHAUSTED"]
    end
    
    QC --> FLITE
    GEN --> F31
    FB --> FLITE
    F31 --> CACHE
    
    F25 --> CHECK
    FLITE --> CHECK
    F20 --> CHECK
    
    CHECK -->|SÌ| USE["✅ Usa questo modello"]
    CHECK -->|NO| NEXT
    NEXT --> F20
    F20 -->|Esaurito| ERROR
```

---

## 5. Gestione Memoria Conversazionale

```mermaid
stateDiagram-v2
    [*] --> NuovoThread: Email ricevuta
    
    NuovoThread --> PrimoContatto: Nessuna memoria
    NuovoThread --> Continuazione: Memoria esistente
    
    PrimoContatto --> SalutoFull: salutationMode = full
    Continuazione --> CheckTempo: Controlla lastUpdated
    
    CheckTempo --> SalutoSoft: 48h - 4gg fa
    CheckTempo --> NessunSaluto: < 48h fa
    CheckTempo --> SalutoFull: > 4gg fa
    
    SalutoFull --> GeneraRisposta
    SalutoSoft --> GeneraRisposta
    NessunSaluto --> GeneraRisposta
    
    GeneraRisposta --> AggiornaMemoria
    AggiornaMemoria --> [*]
    
    note right of AggiornaMemoria
        Traccia:
        - Lingua
        - Categoria
        - Topic forniti
        - Contatore messaggi
    end note
```

---

## 6. Sistema Rate Limiting

```mermaid
graph TB
    subgraph "Metriche Tracciate"
        RPM["⏱️ RPM<br/>Requests/Minute"]
        TPM["📊 TPM<br/>Tokens/Minute"]
        RPD["📅 RPD<br/>Requests/Day"]
    end
    
    subgraph "Controlli"
        C1{RPM < Limite?}
        C2{TPM < Limite?}
        C3{RPD < Limite?}
        SAFETY{RPD > 80%?}
    end
    
    subgraph "Azioni"
        OK["✅ Procedi"]
        WAIT["⏳ Attendi 60s"]
        FALLBACK["🔄 Fallback Model"]
        VALVE["🚨 Safety Valve<br/>Riduci carico 50%"]
        BLOCK["🛑 QUOTA_EXHAUSTED"]
    end
    
    RPM --> C1
    TPM --> C2
    RPD --> C3
    
    C1 -->|SÌ| C2
    C1 -->|NO| WAIT
    
    C2 -->|SÌ| C3
    C2 -->|NO| WAIT
    
    C3 -->|SÌ| SAFETY
    C3 -->|NO| FALLBACK
    
    SAFETY -->|SÌ| VALVE
    SAFETY -->|NO| OK
    
    FALLBACK -->|Nessun modello| BLOCK
```

---

## 7. Pipeline Costruzione Prompt Runtime

```mermaid
graph LR
    subgraph "Ingressi runtime"
        A1["📧 Email + Oggetto"]
        A2["💬 Thread + Memoria"]
        A3["🤖 Quick-check Gemini"]
        A4["🗺️ Territorio + Vincoli fisici"]
        A5["📅 Tempo + Stagione"]
        A6["📎 Allegati/OCR"]
    end

    subgraph "PromptContext"
        C1["Profilo<br/>lite / standard / heavy"]
        C2["Concern attivi<br/>rischio, memoria, multidomanda"]
        C3["Registro + Saluto<br/>istituzionale / pastorale / crisi"]
        C4["Concern synthesis<br/>decisione unica se segnali concorrenti"]
        C5["Relational warmth<br/>entusiasmo/apprezzamento"]
    end

    subgraph "PromptEngine.buildPrompt()"
        S1["systemInstruction<br/>regole, vincoli, registro, output"]
        U1["prompt utente<br/>KB, email, cronologia, allegati"]
        K1["Routing fonti<br/>KB sempre; AI_CORE/Dottrina se necessari"]
    end

    subgraph "Budget + Output"
        B1["Stima token/caratteri"]
        B2["Troncamento semantico KB/allegati"]
        B3["Salto sezioni non critiche"]
        F["Payload Gemini<br/>systemInstruction + contents + inlineData"]
    end

    A1 & A2 & A3 & A4 & A5 & A6 --> C1
    C1 --> C2 --> C3 --> C4
    C2 --> C5
    C4 --> S1
    C5 --> S1
    A1 & A2 & A6 --> U1
    C1 --> K1
    K1 --> U1
    S1 & U1 --> B1 --> B2 --> B3 --> F
```

---

## 8. Architettura Fogli Google Sheets

```mermaid
erDiagram
    KNOWLEDGE_BASE ||--o{ ISTRUZIONI : contiene
    KNOWLEDGE_BASE ||--o{ AI_CORE_LITE : contiene
    KNOWLEDGE_BASE ||--o{ AI_CORE : contiene
    KNOWLEDGE_BASE ||--o{ DOTTRINA : contiene
    
    ISTRUZIONI {
        string Categoria PK
        string Informazione
        string Dettagli
    }
    
    AI_CORE_LITE {
        string Principio PK
        string Istruzione
    }
    
    AI_CORE {
        string Principio PK
        string Istruzione
    }
    
    DOTTRINA {
        string Categoria PK
        string Fonte
        string Citazione
        string Applicazione
    }
    
    CONVERSATION_MEMORY {
        string threadId PK
        string language
        string category
        string tone
        json providedInfo
        datetime lastUpdated
        int messageCount
        int version
    }
    
    SYSTEM_BACKUP {
        datetime timestamp PK
        string type
        json data
    }
```

---

## 9. Flusso Decisione Tipo Richiesta

```mermaid
graph TD
    subgraph "Input Analysis"
        IN["📧 Email Ricevuta"]
        REG["🔍 Regex Scoring"]
        GEM["🤖 Gemini Quick Check"]
    end
    
    subgraph "Classification"
        TECH["🔧 TECHNICAL<br/>Orari, documenti, procedure"]
        PAST["💜 PASTORAL<br/>Supporto spirituale"]
        DOCT["📖 DOCTRINAL<br/>Teologia, catechismo"]
        MIX["🎨 MIXED<br/>Entrambi aspetti"]
        SIMP["📋 SIMPLE<br/>Segreteria base"]
    end
    
    subgraph "Prompt Profile + Fonti"
        LITE["🪶 lite<br/>KB operativa"]
        STD["📦 standard<br/>KB + guardrail/relational_warmth"]
        HEAVY["🏋️ heavy<br/>KB + AI_CORE/Dottrina se necessari"]
    end
    
    IN --> REG & GEM
    REG --> |Confidence < 0.75| SCORE["Score Keywords"]
    GEM --> |Confidence ≥ 0.75| DIRECT["Usa Categoria Gemini"]
    
    SCORE --> TECH & PAST & DOCT & MIX & SIMP
    DIRECT --> TECH & PAST & DOCT & MIX & SIMP
    
    TECH --> LITE
    PAST --> HEAVY
    DOCT --> HEAVY
    MIX --> HEAVY
    SIMP --> LITE
    GEM --> WARM["💛 Entusiasmo/apprezzamento"]
    WARM --> STD
```

---

## 📚 Legenda

| Simbolo | Significato |
|---------|-------------|
| 🎯 | Entry Point / Orchestrator |
| ⚙️ | Componente di elaborazione |
| 🤖 | Servizio AI |
| ✅ | Validazione |
| 💾 | Storage / Memoria |
| 📧 | Email / Gmail |
| 🗺️ | Territorio |
| ⏱️ | Rate Limiting |
| 📝 | Prompt / Template |

---

**[English Version](ARCHITECTURE_DIAGRAMS.md)** | **[Architettura Dettagliata](ARCHITECTURE_IT.md)** | **[Torna a README](../README_IT.md)**
