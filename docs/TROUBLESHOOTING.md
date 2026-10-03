# Operational troubleshooting

Local source reference: 3 October 2026. [Italiano](TROUBLESHOOTING_IT.md)

## No replies

Check Apps Script executions, the `main` trigger, authorisation, `Controllo!B2`, nonzero `MAX_EMAILS_PER_RUN`, office suspension and available quota/time. Only a confirmed stale backlog can bypass suspension; scan errors do not establish a result.

Check **F2**: foreign-only mode defers identified Italian with `·`. In all-languages mode that label stops excluding the message, but it must remain unread and otherwise eligible. Inspect individual message labels, filters, internal speakers, duplicate protection, locks and checkpoints. See [language modes](LANGUAGE_MODES.md).

Use `clearKnowledgeCache()` if resource changes remain stale. `setupAllTriggers()` restores schedules, not credentials or quota. Running `main()` is operational and can send.

## Review and uncertain delivery

`Verifica` can mean blocked validation, crisis review, document inconsistency, warnings after delivery or uncertain delivery. Score is not the only criterion. Diagnose the cause instead of automatically lowering thresholds. No approval draft is created; notifications depend on recipients, cooldown and service availability.

For `gmail_send_uncertain`, inspect the thread and sent mail. The RAW path uses `rfc822msgid:reply_<MESSAGE_ID>@parish-reply.invalid`. An immediate empty search does not prove failure.

- If delivery is found, do not force another send.
- If still uncertain, retain `Verifica` and `send_uncertain_<ID>`.
- Only after establishing non-delivery may an administrator remove the uncertain marker and the relevant message label. Check every burst ID and wait at least 15 minutes after the attempt for temporary `sending_`/`sendstarted_` markers.

Uncertain markers are retained for at least seven days and can then be removed by pruning. Always check sent mail during review. Never clear all Script Properties or labels to retry. A memory failure after confirmed delivery does not warrant another reply.

## Quotas, attachments and memory

Transient failures may defer without terminal labels and save a checkpoint. Resume respects `notBefore`, a 10-minute TTL and the configured rapid retry limit. Daily local Gemini accounting resets in `America/Los_Angeles`, not at a fixed Italian hour; 429 can refer to other windows. Local limits do not establish provider quotas.

Skipped/incomplete OCR does not verify a document. Attachment look-back can recover relevant older files but does not establish a new submission. Language precheck on the subject alone applies only with an empty plain body.

Weekly memory cleanup uses 30 days since last update, with special handling of invalid dates; it does not delete Gmail messages. Sensitive evidence has a separate 180-day TTL.

## Offline reproduction

```powershell
pwsh.exe -NoLogo -NoProfile -Command "node scripts/run_ci_test_suite.js"
```

Tests mock services. GAS dry-run may still call Gemini and log content. See [configuration](CONFIGURATION.md), [deployment](DEPLOYMENT.md) and [coverage](validator_testing.md).
