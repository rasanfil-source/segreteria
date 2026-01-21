# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

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
