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
| **Sensitive Data** | The system is instructed to refer sensitive situations (health, family situations) to the priest without permanently storing them. | Special Protection (Art. 9 GDPR) |

### 2. No Training on User Data

Google guarantees that data sent via the Gemini API (Vertex AI / Google AI Studio) in paid/enterprise versions (and with proper privacy settings active):
-   **IS NOT** used to train foundational models.
-   **IS NOT** accessible to human reviewers.
-   Is retained only for the time necessary for processing.

### 3. Right to be Forgotten (Deletion)

To guarantee the right to erasure:
1.  **Conversational Memory**: The system includes an automatic cleanup function (`cleanupOldMemory`) that deletes old conversation data (default: 30 days).
2.  **Manual Deletion**: It is possible to manually delete rows from the `ConversationMemory` sheet if a user requests it.

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
-   **No sensitive data in KB**: Never insert names, surnames, private phone numbers, or addresses of parishioners in the `Instructions` or `ConversationMemory` sheets.
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
4.  Update the `ScriptProperties` in the Apps Script project.

### Unauthorized Access
If an unauthorized account has accessed the sheet or email:
1.  Immediately change the parish Google account password.
2.  Check Drive sharing settings to see who has access to files.
3.  Check Google Workspace access logs (if available).

---

## 📝 Legal Disclaimer

*This "Parish Email Secretariat" software is a support tool. The use of Artificial Intelligence does not replace human responsibility in data management and pastoral relationships. The system administrator (the Parish) remains the Data Controller and must ensure to inform the faithful through the appropriate parish privacy policy.*
