# 📐 System Architecture Diagrams

[![Versione Italiana](https://img.shields.io/badge/Italiano-Versione-green?style=flat-square)](ARCHITECTURE_DIAGRAMS_IT.md)

> **Complete visual representation of SPA (Segreteria Parrocchiale Automatica) architecture**

---

## 1. Component View (C4 Level 2)

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

## 2. Email Data Flow (Sequence Diagram)

```mermaid
sequenceDiagram
    participant U as 👤 User
    participant G as 📧 Gmail
    participant M as 🎯 Main
    participant P as ⚙️ Processor
    participant C as 🧹 Classifier
    participant AI as 🤖 Gemini
    participant V as ✅ Validator
    participant S as 💾 Memory
    
    U->>G: Send Email
    Note over G: Unread email in Inbox
    
    rect rgb(240, 248, 255)
        Note over M: Trigger every 5 minutes
        M->>G: Search unread emails
        G->>M: Thread list
    end
    
    loop For each thread
        M->>P: Process thread
        
        P->>C: Classify email
        C-->>P: shouldReply, category, lang
        
        alt Email to ignore
            P->>G: Apply "Skipped" label
        else Valid email
            P->>AI: Quick Check
            AI-->>P: reply_needed, confidence
            
            alt Response needed
                P->>AI: Generate response
                AI-->>P: AI Response
                
                P->>V: Validate response
                
                alt Validation OK (score ≥ 0.6)
                    V-->>P: ✅ Valid
                    P->>G: Send response
                    P->>G: Apply "IA" label
                    P->>S: Store memory
                else Validation FAIL
                    V-->>P: ❌ Invalid
                    P->>G: Apply "Verifica" label
                end
            else No response needed
                P->>G: Apply "NoReply" label
            end
        end
    end
```

---

## 3. Validation Pipeline (7 Layers)

```mermaid
graph LR
    subgraph "Input"
        R["📝 AI Response"]
    end
    
    subgraph "Validation Layers"
        L1["1️⃣ Length<br/>25-3000 chars"]
        L2["2️⃣ Language<br/>IT/EN/ES"]
        L3["3️⃣ Signature<br/>Present?"]
        L4["4️⃣ Content<br/>Forbidden?"]
        L5["5️⃣ Hallucinations<br/>Invented data?"]
        L6["6️⃣ Grammar<br/>Post-comma uppercase"]
        L7["7️⃣ Thinking Leak<br/>Exposed reasoning?"]
    end
    
    subgraph "Output"
        OK["✅ VALID<br/>Send"]
        FAIL["❌ INVALID<br/>Review"]
    end
    
    R --> L1 --> L2 --> L3 --> L4 --> L5 --> L6 --> L7
    L7 -->|score ≥ 0.6| OK
    L7 -->|score < 0.6| FAIL
```

---

## 4. AI Model Fallback Strategy

```mermaid
graph TD
    subgraph "Task Type"
        QC["🔍 Quick Check"]
        GEN["📝 Generation"]
        FB["🔄 Fallback"]
    end
    
    subgraph "Model Chain"
        F31["⭐ Flash 3.1 Lite<br/>RPD: 3500"]
        FLITE["💡 Lite Alias<br/>RPM: 2000 / TPM: 2M"]
        CACHE["🧠 Context Cache<br/>TTL persisted"]
    end
    
    subgraph "Decision"
        CHECK{Quota OK?}
        NEXT[Try next]
        ERROR["🚨 QUOTA_EXHAUSTED"]
    end
    
    QC --> FLITE
    GEN --> F31
    FB --> FLITE
    F31 --> CACHE
    
    F25 --> CHECK
    FLITE --> CHECK
    F20 --> CHECK
    
    CHECK -->|YES| USE["✅ Use this model"]
    CHECK -->|NO| NEXT
    NEXT --> F20
    F20 -->|Exhausted| ERROR
```

---

## 5. Conversational Memory Management

```mermaid
stateDiagram-v2
    [*] --> NewThread: Email received
    
    NewThread --> FirstContact: No memory
    NewThread --> Continuation: Memory exists
    
    FirstContact --> FullGreeting: salutationMode = full
    Continuation --> CheckTime: Check lastUpdated
    
    CheckTime --> SoftGreeting: 48h - 4 days ago
    CheckTime --> NoGreeting: < 48h ago
    CheckTime --> FullGreeting: > 4 days ago
    
    FullGreeting --> GenerateResponse
    SoftGreeting --> GenerateResponse
    NoGreeting --> GenerateResponse
    
    GenerateResponse --> UpdateMemory
    UpdateMemory --> [*]
    
    note right of UpdateMemory
        Tracks:
        - Language
        - Category
        - Topics provided
        - Message count
    end note
```

---

## 6. Rate Limiting System

```mermaid
graph TB
    subgraph "Tracked Metrics"
        RPM["⏱️ RPM<br/>Requests/Minute"]
        TPM["📊 TPM<br/>Tokens/Minute"]
        RPD["📅 RPD<br/>Requests/Day"]
    end
    
    subgraph "Checks"
        C1{RPM < Limit?}
        C2{TPM < Limit?}
        C3{RPD < Limit?}
        SAFETY{RPD > 80%?}
    end
    
    subgraph "Actions"
        OK["✅ Proceed"]
        WAIT["⏳ Wait 60s"]
        FALLBACK["🔄 Fallback Model"]
        VALVE["🚨 Safety Valve<br/>Reduce load 50%"]
        BLOCK["🛑 QUOTA_EXHAUSTED"]
    end
    
    RPM --> C1
    TPM --> C2
    RPD --> C3
    
    C1 -->|YES| C2
    C1 -->|NO| WAIT
    
    C2 -->|YES| C3
    C2 -->|NO| WAIT
    
    C3 -->|YES| SAFETY
    C3 -->|NO| FALLBACK
    
    SAFETY -->|YES| VALVE
    SAFETY -->|NO| OK
    
    FALLBACK -->|No model left| BLOCK
```

---

## 7. Runtime Prompt Construction Pipeline

```mermaid
graph LR
    subgraph "Runtime Inputs"
        A1["📧 Email + Subject"]
        A2["💬 Thread + Memory"]
        A3["🤖 Gemini Quick Check"]
        A4["🗺️ Territory + Physical Constraints"]
        A5["📅 Time + Season"]
        A6["📎 Attachments/OCR"]
    end

    subgraph "PromptContext"
        C1["Profile<br/>lite / standard / heavy"]
        C2["Active concerns<br/>risk, memory, multi-question"]
        C3["Register + Salutation<br/>institutional / pastoral / crisis"]
        C4["Concern synthesis<br/>single directive for competing signals"]
        C5["Relational warmth<br/>enthusiasm/appreciation"]
    end

    subgraph "PromptEngine.buildPrompt()"
        S1["systemInstruction<br/>rules, constraints, register, output"]
        U1["user prompt<br/>KB, email, history, attachments"]
        K1["Source routing<br/>KB always; AI_CORE/Doctrine if needed"]
    end

    subgraph "Budget + Output"
        B1["Token/char estimate"]
        B2["Semantic KB/attachment truncation"]
        B3["Skip non-critical sections"]
        F["Gemini payload<br/>systemInstruction + contents + inlineData"]
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

## 8. Google Sheets Architecture

```mermaid
erDiagram
    KNOWLEDGE_BASE ||--o{ ISTRUZIONI : contains
    KNOWLEDGE_BASE ||--o{ AI_CORE_LITE : contains
    KNOWLEDGE_BASE ||--o{ AI_CORE : contains
    KNOWLEDGE_BASE ||--o{ DOTTRINA : contains
    
    ISTRUZIONI {
        string Category PK
        string Information
        string Details
    }
    
    AI_CORE_LITE {
        string Principle PK
        string Instruction
    }
    
    AI_CORE {
        string Principle PK
        string Instruction
    }
    
    DOTTRINA {
        string Category PK
        string Source
        string Citation
        string Application
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

## 9. Request Type Decision Flow

```mermaid
graph TD
    subgraph "Input Analysis"
        IN["📧 Email Received"]
        REG["🔍 Regex Scoring"]
        GEM["🤖 Gemini Quick Check"]
    end
    
    subgraph "Classification"
        TECH["🔧 TECHNICAL<br/>Schedules, documents, procedures"]
        PAST["💜 PASTORAL<br/>Spiritual support"]
        DOCT["📖 DOCTRINAL<br/>Theology, catechism"]
        MIX["🎨 MIXED<br/>Both aspects"]
        SIMP["📋 SIMPLE<br/>Basic secretariat"]
    end
    
    subgraph "Prompt Profile + Sources"
        LITE["🪶 lite<br/>Operational KB"]
        STD["📦 standard<br/>KB + guardrails/relational_warmth"]
        HEAVY["🏋️ heavy<br/>KB + AI_CORE/Doctrine if needed"]
    end
    
    IN --> REG & GEM
    REG --> |Confidence < 0.75| SCORE["Score Keywords"]
    GEM --> |Confidence ≥ 0.75| DIRECT["Use Gemini Category"]
    
    SCORE --> TECH & PAST & DOCT & MIX & SIMP
    DIRECT --> TECH & PAST & DOCT & MIX & SIMP
    
    TECH --> LITE
    PAST --> HEAVY
    DOCT --> HEAVY
    MIX --> HEAVY
    SIMP --> LITE
    GEM --> WARM["💛 Enthusiasm/appreciation"]
    WARM --> STD
```

---

## 📚 Legend

| Symbol | Meaning |
|--------|---------|
| 🎯 | Entry Point / Orchestrator |
| ⚙️ | Processing component |
| 🤖 | AI Service |
| ✅ | Validation |
| 💾 | Storage / Memory |
| 📧 | Email / Gmail |
| 🗺️ | Territory |
| ⏱️ | Rate Limiting |
| 📝 | Prompt / Template |

---

**[Versione Italiana](ARCHITECTURE_DIAGRAMS_IT.md)** | **[Detailed Architecture](ARCHITECTURE.md)** | **[Back to README](../README.md)**
