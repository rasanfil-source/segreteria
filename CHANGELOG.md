# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.4.0] - UNRELEASED

### 🎉 Added
- [ ] Web statistics dashboard (in development)
- [x] Optimized Gemini 2.5 Flash support
- [x] Quick Decision Tree for rapid troubleshooting
- [x] Visual architecture diagrams (Mermaid)
- [x] Operational runbooks for incident management
- [x] Pre-commit checklist for developers

### 🔧 Changed
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
