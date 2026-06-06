# Advanced Configuration

[![Versione Italiana](https://img.shields.io/badge/Italiano-Versione-green?style=flat-square)](CONFIGURATION_IT.md)

This document details the configuration parameters available in `gas_config.js`.
Use `gas_config.example.js` as template in repository and create your local `gas_config.js` file for runtime settings.

## Core Configuration (`CONFIG`)

### API Settings
- **GEMINI_API_KEY**: Your Google Gemini API Key (stored in Script Properties).
- **MODEL_NAME**: Default quality-generation model (currently `gemini-3.5-flash`).
- **GEMINI_CONTEXT_CACHE**: Disabled by default for Free Tier. Enable it only if AI Studio shows `cachedContents` available for the project; if the endpoint is unavailable, the service falls back to direct `generateContent`.
- **GEMINI_FREE_TIER_NOTES**: Local quota profile for fast auxiliary tasks on Gemini 3.1 Flash-Lite; quality generation starts from Gemini 3.5 Flash. Always verify effective limits in AI Studio.

### Gmail & Processing
- **LABEL_NAME**: `IA` (Processed emails)
- **ERROR_LABEL_NAME**: `Errore` (Failed processing)
- **VALIDATION_ERROR_LABEL**: `Verifica` (Needs human review)
- **SKIP_LABEL_NAME**: `·` (Italian emails skipped when `foreign_only` mode is active)
- **MAX_EMAILS_PER_RUN**: `2` (Limits execution batch size to prevent timeouts). Set it to `0` to temporarily suspend processing without running Gmail discovery.
- **MESSAGE_DISCOVERY_MODE**: `metadata` (Default message-level discovery via Gmail list/get metadata; `query` remains the legacy fallback).

### Knowledge Base (Google Sheets)
- **SPREADSHEET_ID**: ID of your Google Sheet (stored in Script Properties).
- **Sheet Names**:
    - `KB_SHEET_NAME`: Instructions/General Info
    - `AI_CORE_LITE_SHEET`: Technical/Simple info
    - `AI_CORE_SHEET`: Deep pastoral info
    - `DOCTRINE_SHEET`: Doctrinal references
    - `MEMORY_SHEET_NAME`: Conversation history

### Features
- **DRY_RUN**: `false` (Set to `true` to test without sending emails).
- **USE_RATE_LIMITER**: `true` (Enables smart rate limiting).
- **VALIDATION_ENABLED**: `true` (Enables quality checks on responses).

### Gemini Models Configuration
The system uses a strategy to select models:
1. **flash-3.5**: Primary path for final quality responses.
2. **flash-3.5-backup**: Same quality model on the backup key.
3. **flash-lite / flash-3.5-lite**: Quick checks, category, AI language, semantic checks, and newsletter discard summaries.
4. **flash-3.5-lite-backup**: Lite fallback on the backup key.

## Script Properties
These values must be set in **Project Settings > Script Properties**:
- `GEMINI_API_KEY`
- `SPREADSHEET_ID`
- `METRICS_SHEET_ID` (Optional, for daily stats)
- `ADMIN_EMAIL` (Optional, critical error notifications)
- `VALIDATION_REVIEW_EMAIL` (Optional, human-review validation alerts)

## Attachment OCR (`ATTACHMENT_CONTEXT`)

> **Prerequisite**: Enable the **Drive Advanced Service** in the script editor and the **Drive API** in the linked GCP project.

This feature extracts text from PDF and image attachments using Google Drive's built-in OCR, then includes that text in the prompt for analysis.

### Parameters
| Parameter | Default | Description |
|-----------|---------|-------------|
| `enabled` | `true` | Enable/disable attachment OCR processing |
| `maxFiles` | `3` | Maximum number of attachments to process per email |
| `maxBytesPerFile` | `3MB` | Maximum file size per attachment |
| `maxMessageBytesForAttachmentDownload` | `25MB` | Maximum estimated message size before downloading attachments |
| `maxCharsPerFile` | `3000` | Maximum characters extracted per file |
| `maxTotalChars` | `9000` | Maximum total characters from all attachments |
| `ocrLanguage` | `'it'` | OCR language code (can be dynamically overridden by detected email language) |
| `ocrConfidenceWarningThreshold` | `0.8` | Minimum OCR confidence before appending a readability warning note |
| `pdfMaxPages` | `2` | Estimated page limit for PDFs |
| `pdfCharsPerPage` | `1800` | Estimated characters per PDF page |
| `ocrTriggerKeywords` | `iban`, `bonifico`, `ricevuta`, `documento`, `allego`, `in allegato`, `coordinate`, `modulo` | Keywords that trigger OCR when the body is relevant |
| `ibanFocusEnabled` | `true` | Narrows OCR context around an IBAN when detected |
| `maxCharsWhenKbTruncated` | `1500` | More conservative attachment text limit when the KB is already truncated |

### Supported File Types
- **PDF documents** (`.pdf`)
- **Images** (`.jpg`, `.png`, `.gif`, `.bmp`, etc.)

### How It Works
1. The system uploads the attachment to Google Drive with OCR enabled
2. Drive automatically converts the file to a Google Doc with extracted text
3. The text is retrieved and the temporary file is deleted
4. Extracted text is included in the prompt as context

## Validation Thresholds
- **VALIDATION_MIN_SCORE**: `0.6` (Minimum quality score to send automatically). Lower this if too many emails are marked as "Verifica".

