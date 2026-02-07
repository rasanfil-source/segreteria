# Changelog

[![Versione Italiana](https://img.shields.io/badge/Italiano-Versione-green?style=flat-square)](CHANGELOG_IT.md)

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.7.0] - 2026-02-07

### 🎉 Added
- **Attachment OCR (PDF & Images)**: Extract text from PDF and image attachments using Google Drive's built-in OCR
  - New `ATTACHMENT_CONTEXT` configuration section with limits and language settings
  - `GmailService.extractAttachmentContext()`: Processes message attachments
  - `GmailService._extractOcrTextFromAttachment()`: Drive Advanced Service OCR
  - `PromptEngine._renderAttachmentContext()`: Includes extracted text in prompts
  - 11 new unit tests for OCR functionality

### 🔧 Changed
- `gas_email_processor.js`: Integrates attachment context extraction in email processing pipeline
- `gas_prompt_engine.js`: New `attachmentsContext` parameter in `buildPrompt()`

### 📚 Documentation
- Updated `CONFIGURATION.md` and `CONFIGURATION_IT.md` with Attachment OCR section
- Added prerequisite: Drive Advanced Service must be enabled

---

## [2.6.0] - 2026-01-24

### 🚀 Enhancements
- **Natural Conversion**: Introduced sophisticated prompt engineering to prevent robotic repetitions. The AI now recognizes ongoing conversations (`salutationMode`) and avoids re-introducing itself or repeating previously provided information (Continuity Guidelines).
- **Adaptive Empathy**: Implemented "Measured Humanity" logic. The AI is now instructed to be empathetic *only* when specific emotional or pastoral signals are detected, maintaining a professional and direct tone for standard administrative requests.
- **Smart Focus**: Enforced a "Main Topic First" policy to ensure answers are direct and efficient.
- **Advanced Classification**: Upgraded `RequestTypeClassifier` with:
  - **Text Sanitization**: Strips quoted replies and signatures to prevent false positives.
  - **Confidence Scoring**: Calculates a confidence metric (0-1) for every classification.
  - **Safety Downgrade**: Automatically downgrades low-confidence (< 35%) classifications to 'technical' to avoid inappropriate pastoral tones.
  - **Blended Hints**: Provides rich, multi-dimensional classification hints to the prompt engine.

### 🔧 Changed
- **Config**: Updated `gas_prompt_engine.js` and `gas_request_classifier.js` to support the new features.

## [2.5.4] - 2026-01-21

### 🐛 Fixed
- **Critical Race Condition**: Fixed premature global lock release in `GeminiRateLimiter` which allowed overlapping executions.
- **Memory Atomicity**: Migrated from `CacheService` to `LockService` (global) in `MemoryService` to ensure atomic writes and data integrity.
- **Cache Inconsistency**: Implemented forced local cache invalidation on version mismatch errors (concurrency), preventing failed retry loops.
- **Classifier False Positives**: Corrected greeting/acknowledgment detection logic which ignored question marks (`?`), erroneously silencing short questions (e.g., "All good?").
- **Auto-Loop Detection**: Extended sender check to include configured aliases (`KNOWN_ALIASES`) in addition to the active user.

## [2.5.3] - 2026-01-21

### 🔧 Changed
- **Prompt Logic Reinforcement**: Implemented strict "Answer ONLY what is asked" rules to prevent excessive responses (infodumping).
- **"Contact Us" Loop Prevention**: Added Critical Error #5 forbidding the bot from suggesting to "contact the office" if the user is already writing to the office.
- **Enhanced Active Listening**: The bot now integrates user-provided information instead of just repeating it (echoing).

## [2.5.2] - 2026-01-21

### 🎉 Added
- **Formal Baptism Cancellation Template (Sbattezzo)**: Dedicated code-level template to ensure administrative, formal, and non-pastoral responses to defection requests.
- **Formal Classification Category**: New `FORMAL` internal category to bypass generic pastoral logic for administrative requests.
- **Improved Keyword Detection**: Added specific terms for baptism cancellation and apostasy detection.

### 🔧 Changed
- **PromptEngine Scaling**: Increased modular template count to **19** to accommodate the new formal procedure.
- **Response Validation**: Aligned the validator to support the new blinded sbattezzo template while maintaining strict anti-hallucination checks.
- **Institutional Tone**: Standardized sbattezzo responses to the institutional "plural" ("con la presente confermiamo").

## [2.5.1] - 2026-01-21

### 🔧 Improved
- **Rigorous Reply Logic (Fail-Closed)**: The system now requires explicit confirmation to send a reply. In case of uncertainty, it prioritizes silence to avoid user disturbance.
- **Last Speaker Check**: Added automatic thread ownership verification. If the last message was sent by the secretary/bot, processing is suspended to prevent repetitions.
- **Continuous Conversation Support**: Search optimization to process new user replies even in previously managed threads, maintaining dialogue consistency.
- **Optimized Sender Filter**: System sender recognition (no-reply) now includes display name analysis in addition to the email address.

## [2.5.0] - 2026-01-20

### 🎉 Added
- **WAL (Write-Ahead Log) Pattern**: Crash-safe cache persistence in `GeminiRateLimiter`
  - `_persistCacheWithWAL()`: Writes checkpoint before full data
  - `_recoverFromWAL()`: Automatic recovery after crash
  - `_mergeWindowData()`: Safe merge avoiding duplicates
- **High-Volume Test**: `testHighVolumeScenario()` validates 50-email classification performance
- **Daily Metrics Dashboard**: Export quota stats to Google Sheets
  - `exportMetricsToSheet()`: Writes daily metrics row
  - `setupMetricsTrigger()`: Configures daily trigger at 23:00
  - New config: `METRICS_SHEET_ID`, `METRICS_SHEET_NAME`
- **Enhanced Token Estimation**: Component-level analysis in `PromptEngine.buildPrompt()`
  - Estimates tokens for: systemRole, KB, conversation, email, formatting, examples
  - Proactive warning at 90% threshold with breakdown

### 🔧 Changed
- `gas_config.js`: Added metrics configuration section
- `gas_unit_tests.js`: Added `testHighVolumeScenario()` to test runner

---

## [2.4.0] - UNRELEASED

### 🎉 Added
- [x] **Cross-Key Quality First Strategy**: Multi-API-key support with intelligent fallback
  - Uses backup key when primary quota is exhausted
  - Prioritizes high-quality model (Flash 2.5) over lite models
  - 4-level fallback: Primary High → Backup High → Primary Lite → Backup Lite
- [ ] Web statistics dashboard (in development)
- [x] Optimized Gemini 2.5 Flash support
- [x] Quick Decision Tree for rapid troubleshooting
- [x] Visual architecture diagrams (Mermaid)
- [x] Operational runbooks for incident management
- [x] Pre-commit checklist for developers

### 🔧 Changed
- [x] `MAX_EMAILS_PER_RUN` reduced from 10 to 3 (prevents timeout with multi-attempt strategy)
- [x] Rate Limiter: added `skipRateLimit` bypass for backup keys
- [x] GeminiService: `generateResponse()` now accepts options for key/model override
- [x] Rate Limiter: optimized cache (reduced I/O 60%)
- [x] Prompt Engine: dynamic profiling (lite/standard/heavy)
- [x] MemoryService: optimized search with TextFinder

### 🐛 Fixed
- [x] Race condition in cache refresh loop (`gas_rate_limiter.js`)
- [x] Boolean logic in quick check (`gas_gemini_service.js`)

### 🔒 Security
- [x] Markdown link sanitization (XSS/SSRF)
- [x] Header injection protection in GmailService
- [x] Hard slice safety cap in rate limiter windows

### 📚 Documentation
- [x] Quick Decision Tree (`docs/QUICK_DECISION_TREE.md`)
- [x] Architecture Diagrams (`docs/ARCHITECTURE_DIAGRAMS.md`)
- [x] Pre-Commit Checklist (`.github/PRE_COMMIT_CHECKLIST.md`)
- [x] Operational Runbooks (`docs/runbooks/`)
- [x] Known Issues section in Troubleshooting
- [x] Gemini model selection guide

---

## [2.3.9] - 2026-01-19

### 🔧 Changed
- Refactored `gas_email_processor.js` logic for better modularity and thread safety
- Enhanced `gas_prompt_engine.js` with improved testing support
- Configured default settings sanitized for public release
- Expanded unit test coverage (`gas_unit_tests.js`)

### 🐛 Fixed
- Fixed critical bug in `gas_rate_limiter.js` regarding cache refresh cycles
- Corrected boolean logic in `gas_gemini_service.js` for quick check responses

---

## [2.3.8] - 2026-01-17

### 🔒 Security
- Hardened regex patterns in `gas_response_validator.js` to prevent ReDoS attacks
- Added strict type checking for API inputs

### 🔧 Changed
- Implemented "Safety Valve" mechanism to throttle requests when API quota exceeds 80%
- Updated logging to use structured JSON format for better observability

---

## [2.3.6] - 2026-01-15

### 🎉 Added
- Native support for Gemini 2.5 Flash model
- Dynamic vacation handling via Google Sheets integration
- Active Listening 2.0: Prevent AI from asking questions already answered in the email thread

### 🐛 Fixed
- Resolved issue with "comma followed by uppercase" rule in Italian grammar check

---

## Breaking Changes Between Versions

### 2.3.x → 2.4.x
- ⚠️ `CONFIG.GEMINI_MODELS` now mandatory in `gas_config.js`
- ⚠️ `VALIDATION_STRICT_MODE` deprecated (use `VALIDATION_MIN_SCORE`)

### 2.2.x → 2.3.x
- ⚠️ Log format changed to structured JSON
- ⚠️ New required sheets: AI_CORE_LITE
