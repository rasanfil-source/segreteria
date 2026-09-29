# Source state notes

## 2026-09-29 — Follow-up audit fixes

Handled null attachment skip lists, normalised case in body-only presence clauses, unified reply-prefix length checks and restored alert paragraph spacing. Added regression tests verified before and after the fixes. All 52 modular suites, smoke and unit tests passed with coverage gates met. Local changes only; no deployment.

## 2026-09-29 — Documentation alignment

Guides, configuration, architecture and procedures aligned with the local workspace. No runtime change or deployment attestation.

- Documented all-languages and foreign-only modes, detection and the · label lifecycle.
- Documented eleven gas_thread components and current limits.
- Corrected IA/Verifica, dry-run and uncertain-send semantics.
- Distinguished historical reports, proposals and operating instructions.
- Evaluated the four audit findings without applying patches.

[Audit evaluation](VALUTAZIONE_AUDIT_2026-09-29.md) · [Architecture](ARCHITECTURE.md) · [Language modes](LANGUAGE_MODES.md)

Dated reports preserve their original verification results and do not necessarily describe current code. Local cleanup removed logs, scratch scripts and intermediate reports while retaining the workbook and baseline needed by optional comparison tests.
