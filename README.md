# Parish Email AI Assistant

[Italiano](README_IT.md) · Aligned with local source on 29 September 2026.

This Google Apps Script V8 application discovers eligible unread Gmail messages, applies filters, loads knowledge from Google Sheets, builds a Gemini response or a local receipt, validates it and handles delivery. Review, transient failures and uncertain delivery have separate outcomes.

## Language modes

Set **`Controllo!F2`** using the Italian dropdown values:

| Sheet value | Behaviour |
|---|---|
| **Tutte le lingue** (all languages) | Italian and other languages are eligible, subject to all other filters and checks. |
| **Solo straniere** (foreign languages only) | Messages identified as Italian are deferred with **`·`**, without an automatic reply. Other messages continue through the pipeline. |

“Foreign” means non-Italian; it does not refer to the sender's nationality. The response uses the detected language rather than a fixed translation target. Returning to all languages makes deferred messages eligible again if they remain unread and have no other exclusion. See [language detection and switching modes](docs/LANGUAGE_MODES.md).

## Scheduling and Gmail state

`setupAllTriggers()` installs `main` every 5 minutes, weekly memory cleanup and daily metrics export. `Controllo!B2 = Spento` disables processing. The weekly time ranges suspend automation **during office attendance**; configured vacation periods and the holidays handled by the code keep automation active unless the master switch is off. A bounded scan can bypass suspension for eligible unread requests older than 12 hours.

The local batch limit is 2, subject to time and quota budgets. Labels mean:

- `IA`: handled, including some filtered messages that received no reply.
- `Verifica`: human review; may mean blocked response, a warning after delivery, or uncertain delivery.
- `Errore`: a terminal error marked by the relevant path.
- `·`: Italian deferred in foreign-only mode.

Labels are applied at message level where required, and normal handling preserves unread state. A thread can display labels from different messages. Check sent mail before acting on `Verifica`; the application does not automatically create a draft for approval.

## Guides

- [Setup](docs/Setup_Guide_Non_Technical.md)
- [Configuration](docs/CONFIGURATION.md)
- [Architecture](docs/ARCHITECTURE.md) and [diagrams](docs/ARCHITECTURE_DIAGRAMS.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md) and [runbooks](docs/runbooks/README.md)
- [Knowledge base](docs/KNOWLEDGE_BASE_GUIDE.md)
- [Security and data](docs/SECURITY.md)
- [Contributor workflow](docs/CONTRIBUTING.md) and [validator tests](docs/validator_testing.md)

## Local verification

Root `gas_*.js` files include runtime modules and the unit suite. All eleven `gas_thread_*.js` components are needed by the processor. `gas_config.js` is tracked; secrets and environment values belong in Script Properties. `.claspignore` excludes documentation, modular tests, local scripts and temporary outputs.

On Windows use PowerShell 7:

```powershell
pwsh.exe -NoLogo -NoProfile -Command "node scripts/run_ci_test_suite.js"
```

Tests mock external services and generate `outputs/coverage/`. The 29 September 2026 run passed 52 modular suites. GAS `DRY_RUN` prevents the reply send, but can still access Google services, call Gemini and write logs; use the Node suites for offline verification.

Configured model IDs and quotas are local settings, not provider availability or free-service guarantees. Documentation reflects this workspace; it does not verify deployment state.
