# Advanced Configuration

[![Versione Italiana](https://img.shields.io/badge/Italiano-Versione-green?style=flat-square)](CONFIGURATION_IT.md)

This document details the configuration parameters available in `gas_config.js`.

## Core Configuration (`CONFIG`)

### API Settings
- **GEMINI_API_KEY**: Your Google Gemini API Key (stored in Script Properties).
- **MODEL_NAME**: Default model (e.g., `gemini-2.5-flash`).

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
1. **flash-2.5**: Premium model for high-quality response generation.
2. **flash-lite**: Fast model for quick checks and classification.
3. **flash-2.0**: Backup legacy model.

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
| `ocrLanguage` | `'it'` | OCR language code (Italian) |
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

