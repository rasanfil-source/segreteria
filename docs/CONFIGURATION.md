# Advanced Configuration

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

## Validation Thresholds
- **VALIDATION_MIN_SCORE**: `0.6` (Minimum quality score to send automatically). Lower this if too many emails are marked as "Verifica".
