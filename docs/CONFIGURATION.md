# Advanced Configuration

[![Versione Italiana](https://img.shields.io/badge/Italiano-Versione-green?style=flat-square)](CONFIGURATION_IT.md)

This document details the configuration parameters available in `gas_config.js`.
Use `gas_config.example.js` as template in repository and create your local `gas_config.js` file for runtime settings.

## Core Configuration (`CONFIG`)

### API Settings
- **GEMINI_API_KEY**: Your Google Gemini API Key (stored in Script Properties).
- **MODEL_NAME**: Default model (currently `gemini-3.1-flash-lite`).
- **GEMINI_CONTEXT_CACHE**: Enables REST `cachedContents` with TTL persisted in Script Properties. `systemInstruction` and tools are attached only to cache creation; final `generateContent` sends only `cachedContent` plus the new user prompt.
- **GEMINI_FREE_TIER_NOTES**: Local quota profile for Gemini 3.1 Flash-Lite Free Tier: 2,000 RPM, 2,000,000 TPM, 3,500 RPD, and 1,500 shared Google Search Grounding queries/day. RPD is the operational bottleneck.

### Gmail & Processing
- **LABEL_NAME**: `IA` (Processed emails)
- **ERROR_LABEL_NAME**: `Errore` (Failed processing)
- **VALIDATION_ERROR_LABEL**: `Verifica` (Needs human review)
- **MAX_EMAILS_PER_RUN**: `3` (Limits execution batch size to prevent timeouts)

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
1. **flash-3.1-lite**: Primary logical path for response generation.
2. **flash-lite**: Compatibility alias for quick checks, classification, semantic checks, and fallback.
3. **flash-3.1-lite-backup**: Backup logical path for cross-key fallback.

## Script Properties
These values must be set in **Project Settings > Script Properties**:
- `GEMINI_API_KEY`
- `SPREADSHEET_ID`
- `METRICS_SHEET_ID` (Optional, for daily stats)

## Attachment OCR (`ATTACHMENT_CONTEXT`)

> **Prerequisite**: Enable the **Drive Advanced Service** in the script editor and the **Drive API** in the linked GCP project.

This feature extracts text from PDF and image attachments using Google Drive's built-in OCR, then includes that text in the prompt for analysis.

### Parameters
| Parameter | Default | Description |
|-----------|---------|-------------|
| `enabled` | `true` | Enable/disable attachment OCR processing |
| `maxFiles` | `4` | Maximum number of attachments to process per email |
| `maxBytesPerFile` | `5MB` | Maximum file size per attachment |
| `maxCharsPerFile` | `4000` | Maximum characters extracted per file |
| `maxTotalChars` | `12000` | Maximum total characters from all attachments |
| `ocrLanguage` | `'it'` | OCR language code (can be dynamically overridden by detected email language) |
| `ocrConfidenceWarningThreshold` | `0.8` | Minimum OCR confidence before appending a readability warning note |
| `pdfMaxPages` | `2` | Estimated page limit for PDFs |
| `pdfCharsPerPage` | `1800` | Estimated characters per PDF page |

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

