# 🔐 Security and GDPR Compliance

[![Versione Italiana](https://img.shields.io/badge/Italiano-Versione-green?style=flat-square)](SECURITY_IT.md)

> **Guide to security best practices and personal data protection for the Parish Email Secretariat**

---

## 🛡️ Fundamental Principles

Data security and privacy protection are absolute priorities, especially in a pastoral context that handles sensitive information.

### The 3 Pillars of Security

1.  **Data Minimization**: Collect and process only what is strictly necessary.
2.  **Privacy by Design**: Data protection is integrated into the system architecture.
3.  **Transparency**: Clarity on how the AI processes information.

---

## 🇪🇺 GDPR Compliance

The system is designed to help the parish comply with the General Data Protection Regulation (GDPR).

### 1. Personal Data Processing

| Data Type | How it is processed | Legal Basis |
|-----------|---------------------|-------------|
| **Sender Email** | Used only to send the reply and verify history. | Legitimate Interest (replying to request) |
| **Email Content** | Analyzed by Gemini AI to generate the response. **NOT** used for model training. | Legitimate Interest / Implied Consent |
| **Sensitive Data** | Instructions refer sensitive situations to the priest when appropriate. Conversation memory may retain summaries and contextual flags concerning bereavement, canonical situations or personal constraints. Actual retention is described below; flags have no independent expiry. | Special Protection (Art. 9 GDPR) |

### 2. No Training on User Data

Google guarantees that data sent via the Gemini API (Vertex AI / Google AI Studio) in paid/enterprise versions (and with proper privacy settings active):
-   **IS NOT** used to train foundational models.
-   **IS NOT** accessible to human reviewers.
-   Is retained only for the time necessary for processing.

### 3. Right to be Forgotten (Deletion)

The software provides these memory deletion mechanisms:
1.  **Conversation memory**: `cleanupOldMemory` clears rows whose `lastUpdated` is older than 30 days. Memory updates renew that timestamp, so active conversations can retain summaries and flags for longer than 30 days. This is not an expiry measured from each fact's origin. Deletion occurs on a successful cleanup run, not exactly on day 30; verify that the scheduled trigger is installed and working.
2.  **Anomalous dates**: for missing, unreadable or future `lastUpdated`, cleanup records first observation in a technical note on cell F (`AG_MEMORY_RETENTION_V1`). It retains the row for another 30 days from detection, then clears it on the next successful run. It does not change the interaction timestamp. A valid update resumes normal expiry; a missing or corrupt technical note restarts observation. Preserve these notes during routine maintenance.
3.  **Cleanup scope**: clears columns A:J of expired rows and invalidates their known caches. It does not move retained rows or delete Gmail messages, sheet revision history, backups, manual notes or data outside the table. The technical note contains no message text and does not enter prompts. Personal data in manual notes requires separate handling.
4.  **Manual deletion**: rows can be deleted from `ConversationMemory`; address relevant copies and caches as well. Manual sheet edits do not automatically invoke the software's cache invalidation.

Deleting a row removes its summary, previously covered topics, flags and physical presence state together. Subsequent turns may lose continuity or repeat advice; deletion does not establish that a personal difficulty has been resolved. Cleanup does not change instructions, models or AI budgets. These are technical software properties, not certification of an installation's compliance.

---

## 🔒 Security Best Practices

### 1. API Key Management

The Gemini API Key is the keystone of the system.

-   ✅ **USE** `ScriptProperties` to store it.
-   ❌ **NEVER** write the key directly in the code (`.gs` files).
-   ❌ **NEVER** commit files containing API keys to GitHub.

**How to configure securely:**
See the `DEPLOYMENT.md` guide, "Production Security" section.

### 2. Google Sheets Access

The spreadsheet acts as a database and Knowledge Base.

-   **Limited Access**: Share the sheet **only** with the account running the script and strictly necessary administrators (e.g., Parish Priest, Secretary).
-   **Separate KB and memory**: do not place parishioners' personal data in the shared KB (`Instructions`). `ConversationMemory` contains conversation data, potentially sensitive: restrict access, content and retention; avoid unnecessary personal details and sensitive manual notes.
-   **Logs**: Google Sheets maintains a revision history that acts as an audit log.

### 3. Logs and Monitoring

-   **Masked Logs**: The system is configured not to log sensitive email content in Apps Script logs, but only metadata (message ID, category, status).
-   **Audit Trail**: Keep track of who has access to the script and the spreadsheet.

---

## 🚨 Incident Response (What to do if...)

### API Key Compromise
If you suspect your API Key has been exposed:
1.  Go to Google AI Studio / Google Cloud Console.
2.  **Revoke/Delete** the old key immediately.
3.  Generate a new key.
4.  Set the `ScriptProperties` in the Apps Script project.

### Unauthorized Access
If an unauthorized account has accessed the sheet or email:
1.  Immediately change the parish Google account password.
2.  Check Drive sharing settings to see who has access to files.
3.  Check Google Workspace access logs (if available).

---

## 📝 Legal Disclaimer

*This "Parish Email Secretariat" software is a support tool. The use of Artificial Intelligence does not replace human responsibility in data management and pastoral relationships. The system administrator (the Parish) remains the Data Controller and must ensure to inform the faithful through the appropriate parish privacy policy.*
