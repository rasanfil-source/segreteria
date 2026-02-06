# ❓ Frequently Asked Questions (FAQ)

[![Versione Italiana](https://img.shields.io/badge/Italiano-Versione-green?style=flat-square)](FAQ_IT.md)

> **Answers to common questions for non-technical users and administrators**

---

## 👥 Non-Technical Section (Priests, Secretaries)

### 1. Does the system replace the human secretary?
**No.** The system is an *assistant*. It handles repetitive questions (times, certificates, addresses) to free up valuable time for the human secretariat, who can then dedicate themselves to listening and handling complex situations.

### 2. What if the AI gives a wrong answer?
The system has an internal check ("self-evaluation"). If it is not sure of the answer, it does not send it but saves it in the **"Verifica" (Check)** folder in Gmail. A human will have to check that folder and reply manually.

### 3. How do I teach it new things?
Just write the information in the Google Sheet (Knowledge Base). For example, if mass times change, just update the "Instructions" sheet and the system will immediately use the new times. No need to touch the code.

### 4. Can it handle attachments?
Currently, the system **reads** emails but responds only with text. If it needs to send a form (e.g., for baptism), it sends the *link* to download it (which we will have inserted in the Knowledge Base), not the physical file.

### 5. Does it reply to everyone? Even spam?
No. The system has intelligent filters. It ignores newsletters, advertising, and spam. It only responds to emails that seem written by real people with legitimate requests.

### 6. What happens if someone writes offensive or strange things?
The system tries to respond courteously if possible, but if the request is inappropriate or out of context, it classifies it as such and leaves it for human management.

### 7. Does it reply at night?
It depends on how it is configured. By default, to seem more "human", it can be set not to reply at night or to pause responses until the next morning. However, technically it can reply 24/7 if desired.

---

## 💻 Technical Section (System Administrators)

### 1. How do I update the script?
If you use GitHub integration, do a `git pull` and then `clasp push`. Otherwise, copy the updated code into the Apps Script editor. **Warning**: do not overwrite `gas_config.js` if it contains your customizations.

### 2. What happens if the Gemini API quota runs out?
The system will stop responding and will log the error. You can monitor the quota on the Google Cloud Console. We recommend setting up an alert. If it happens, the system will resume the next day upon quota reset.

### 3. How does the Knowledge Base cache work?
To save Sheet reads and speed up, the KB is saved in `CacheService` for 1 hour (configurable). If you update the sheet and want to see changes immediately, you can wait 1 hour or manually run a cache clearing function (non-critical, usually just wait).

### 4. Can I use a model other than Gemini?
The system is built modularly around the Google Vertex AI / Gemini SDK. Changing providers (e.g., OpenAI) would require rewriting the `GeminiService` class. Changing Gemini *version* (e.g., from `flash` to `pro`) is very easy: just change a constant in `gas_config.js`.

### 5. Where do I see error logs?
In the Apps Script dashboard under "Executions". The system also uses `console.error` which is captured by StackDriver (Google Cloud Logging) if associated with a standard GCP project.

### 6. How does it manage concurrency?
It uses `LockService` to prevent two simultaneous executions from replying to the same email. Additionally, it uses an "Optimistic Locking" mechanism for conversational memory on Sheet to avoid overwrites.

### 7. Is it possible to test changes without sending real emails?
Yes. Set `DRY_RUN: true` in `gas_config.js`. The system will do everything (reading, reasoning, draft generation) but **will not send** the final email, writing instead in the logs what it would have done.
