# Configuration

Checked against local source on 3 October 2026. [Italiano](CONFIGURATION_IT.md)

`gas_config.js` is tracked and supplies runtime settings. `gas_config.example.js` is an excluded deployment template; do not overwrite an existing configuration just to change one setting.

## Script Properties

Required: `GEMINI_API_KEY`, `SPREADSHEET_ID`. Environment settings include `BOT_EMAIL`, `KNOWN_ALIASES`, optional `GEMINI_API_KEY_BACKUP`, `PERSONAL_IGNORE_SENDERS`, `ADMIN_EMAIL`, `VALIDATION_REVIEW_EMAIL` and `METRICS_SHEET_ID`. Personal exclusions accept the formats implemented by the parser; an absent property means no personal list. See the [functional contracts](CONTRATTI_FUNZIONALI_IT.md).

## Control sheet

| Cells | Purpose |
|---|---|
| `B2` | Master switch; a value containing `Spento` disables processing. |
| `F2` | `Tutte le lingue` = all languages; `Solo straniere` = non-Italian only. |
| `B5:E7` | Vacation periods; start in B, end in D in the current layout. |
| `A10:D16` | Weekly suspension: day A, start B, end D; legacy B/C/D layout also supported. |
| `E13:F` | Sender/domain and keyword exclusions, merged with static filters. |
| `A19` | Review notification recipient. |

Office attendance ranges **suspend** automation. Vacation and holidays handled by the code keep it active unless the master switch is off. A missing control sheet uses static `SUSPENSION_HOURS`. A present sheet with no ranges permits round-the-clock operation when `STRICT_SUSPENSION_CONFIG=false`; strict mode rejects missing valid ranges. Nonempty malformed time rows cause configuration errors.

All-languages mode admits Italian and other languages. Foreign-only mode defers identified Italian with `·`, preserving unread state. Switching back makes still-unread, otherwise eligible messages candidates again. Blank/unrecognised F2 defaults to all languages. See [detection and switching](LANGUAGE_MODES.md).

`setupConfigurationSheets()` uses the active spreadsheet, rebuilding formatting and merged ranges while preserving existing values. `applyValidationOnly()` applies constraints without rebuilding the whole layout. Changing F2 does not require rerunning setup.

## Current defaults

| Setting | Value |
|---|---:|
| `MAX_EMAILS_PER_RUN` | 2; 0 suspends before processor discovery |
| `MAX_EXECUTION_TIME_MS` / `MIN_REMAINING_TIME_MS` | 280000 / 90000 |
| `MAX_HISTORY_MESSAGES` / `CACHE_LOCK_TTL` | 8 / 310 seconds |
| `SUSPENSION_STALE_UNREAD_HOURS` | 12 |
| `MESSAGE_DISCOVERY_MODE` | `metadata` |
| `BATCH_CHECKPOINT_TTL_MS` / `BATCH_CHECKPOINT_MAX_RETRIES` | 600000 / 3 |
| `BATCH_CHECKPOINT_MAX_THREADS` | 150 |
| `SEMANTIC_VALIDATION.activationThreshold` | 0.82 |
| Validation minimum / warning threshold | 0.6 / 0.9 |
| `CRISIS_HUMAN_REVIEW` | true |
| `INTELLIGENT_RETRY.maxRetries` | 1 |
| `MAX_SAFE_TOKENS` / `MAX_SAFE_PROMPT_CHARS` | 120000 / 120000 |
| `MAX_OUTPUT_TOKENS` | 6000 |
| Maximum memory topics / summary bullets | 50 / 5 |
| `SENSITIVE_FLAGS_TTL_DAYS` | 180 |
| `DRY_RUN` / `USE_RATE_LIMITER` | false / true |

Blocking checks can reject a response regardless of score. Diagnose review causes before changing thresholds. Dry run prevents the response send but may access services, call Gemini, write technical state and log content.

Checkpoint limits include the scheduled resumption: 1 allows one resumption, 3 allows three for the same pending set. Progress resets the counter. Reading and writing abandon a checkpoint only above the limit and respect its scheduled time and expiry. Without `LockService`, compatibility mode retains logical locks and persistent send markers without atomic concurrency guarantees. Uncertain markers are retained for at least seven days; see [functional contracts](CONTRATTI_FUNZIONALI_IT.md).

Generation strategy: `flash-3.7` → `flash-3.7-backup` → `flash-lite` → `flash-lite-backup`. Quality aliases use `gemini-3.7-flash`; Lite aliases use `gemini-3.5-flash-lite`. Auxiliary task strategies use Lite. These are local settings, not a claim about provider availability, prices or independent backup quotas. Token estimation is local. `GEMINI_CONTEXT_CACHE` is not implemented by the current code.

## Attachments

Enabled defaults: 3 files, 3 MiB each, 25 MiB message precheck, 3000 extracted characters per file and 9000 total. PDF, image and Office extraction/conversion paths depend on file type, intent, time and service availability. The 2-page PDF setting is estimated using 1800 characters per page, not an exact physical page cut.

Relevant older attachments may be recovered from the thread; they do not prove a new submission. The main path reads PDFs and images directly through the model and never treats a filename as proof of content. Present documents are examined within configured budgets even without body keywords. Textual OCR helper settings and visual reading have distinct budgets. One structured analysis precedes routing and supplies a reusable consistency result. Failed or partial reads require normal generation and validation.

See [architecture](ARCHITECTURE.md), [deployment](DEPLOYMENT.md) and [tests](validator_testing.md).
