# Installation and deployment

Aligned with local source on 3 October 2026. [Italiano](DEPLOYMENT_IT.md)

## Setup

Use a Google Apps Script V8 project with access to the intended mailbox and spreadsheet. Deploy the root runtime modules, **all eleven `gas_thread_*.js` files**, `gas_config.js` and `appsscript.json`.

The manifest declares Gmail v1 and Drive v3 advanced services, `Europe/Rome`, and scopes for Gmail, Drive, Docs, Slides, Sheets, external requests, triggers and sending. Verify service enablement and authorisation in the target project.

Set at least `GEMINI_API_KEY` and `SPREADSHEET_ID` in Script Properties. Check bot identity/aliases, optional backup key, personal exclusions and alert recipients separately for each project. See [configuration](CONFIGURATION.md).

UI setup needs the active spreadsheet. `setupConfigurationSheets()` rebuilds Controllo formatting while preserving existing values. Use `applyValidationOnly()` for constraints without full layout setup. Choose B2 and F2 explicitly; [language mode](LANGUAGE_MODES.md) can later change without redeployment.

## Local verification

```powershell
pwsh.exe -NoLogo -NoProfile -Command "node scripts/run_ci_test_suite.js"
pwsh.exe -NoLogo -NoProfile -Command "git diff --check"
```

The runner executes smoke, unit and modular tests with validator coverage gates and mocks external services. GAS `DRY_RUN` prevents the response send but can still call services, consume quota and write logs/technical state.

## clasp

`.clasp.json` selects the local target with `rootDir: ./`. Ignore rules exclude docs, modular tests, scripts, maintenance and temporary output. The root unit suite and one-off test script are not automatically excluded; inspect the upload list.

`scripts/deploy_gas.ps1` runs `clasp.cmd push -f` sequentially for two projects. Set `GAS_PARROCCHIA_SCRIPT_ID` and `GAS_DON_RAIMONDO_SCRIPT_ID` as environment variables or matching keys in ignored `scripts/deploy_gas.local.json`; environment variables take precedence.

```powershell
pwsh.exe -NoLogo -NoProfile -Command "& ./scripts/deploy_gas.ps1"
```

This command changes both remote projects. It restores the local clasp configuration on exit; failure on the second project does not roll back the first. It does not run tests, commit, push Git or install triggers.

## Triggers and activation

After authorisation and configuration checks, `setupAllTriggers()` installs `main` every 5 minutes, `weeklyMemoryCleanup` on Sunday at hour 3 and `exportMetricsToSheet` daily at hour 23.

`setupTrigger()` aliases full setup; `setupProductionTrigger()` installs only the main trigger. `setupMainTrigger(minutes)` selects a supported interval from 1, 5, 10, 15 and 30. Legacy `setupWeeklyMemoryCleanupTrigger()` is a deprecated no-op.

`healthCheck()`, `testConfiguration()` and execution logs help inspect configuration; they do not prove delivery. Running `main()` can send mail when enabled and dry-run is false.

After deployment check uploaded revision, triggers, properties, F2 and per-message labels. Use [troubleshooting](TROUBLESHOOTING.md) for uncertain sends. This documentation update does not deploy or verify remote state.
