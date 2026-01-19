# Changelog

All notable changes to this project will be documented in this file.

## [2.3.9] - 2026-01-19

### Changed
- Refactored `EmailProcessor.gs` logic for better modularity and thread safety.
- Enhanced `PromptEngine.gs` with improved testing support.
- Configured default settings sanitized for public release.
- Expanded unit test coverage (`gas_unit_tests.js`).

### Fixed
- Fixed critical bug in `gas_rate_limiter.js` regarding cache refresh cycles.
- Corrected boolean logic in `gas_gemini_service.js` for quick check responses.

## [2.3.8] - 2026-01-17

### Security
- Hardened regex patterns in `ResponseValidator` to prevent ReDoS attacks.
- Added strict type checking for API inputs.

### Changed
- Implemented "Safety Valve" mechanism to throttle requests when API quota exceeds 80%.
- Updated logging to use structured JSON format for better observability.

## [2.3.6] - 2026-01-15

### Added
- Native support for Gemini 2.5 Flash model.
- Dynamic vacation handling via Google Sheets integration.
- Active Listening 2.0: Prevent AI from asking questions already answered in the email thread.

### Fixed
- Resolved issue with "comma followed by uppercase" rule in Italian grammar check.
