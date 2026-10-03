# System architecture

Local source reference: 29 September 2026. [Italiano](ARCHITECTURE_IT.md)

## Runtime

Google Apps Script V8 runs global JavaScript modules with Gmail v1 and Drive v3 advanced services and the `Europe/Rome` timezone. Node is used for local tests, not as the production module loader.

`main()` loads resources, checks the master switch, language mode and suspension, coordinates the batch lock and calls `EmailProcessor.processUnreadEmails`. It releases the global gate before constructing services that acquire their own locks. `processEmailsMain()` is an alias.

Resource loading covers `Istruzioni`, `AI_CORE_LITE`, `AI_CORE`, `Dottrina`, `Sostituzioni` and `Controllo`. The nominal six-hour cache includes modification checks and payload serialisation/chunking/compression as needed. Loaded knowledge is routed selectively into prompts.

## Thread components

`gas_email_processor.js` retains the batch, coordinator, helpers, declarative rules and send transactions. `processThread` delegates to eleven global components:

| File | Responsibility |
|---|---|
| `gas_thread_selection.js` | Identity, aliases, message labels, ordering, candidate and burst. |
| `gas_thread_message_state.js` | Shared message state and burst handling. |
| `gas_thread_policy.js` | Language, local filters, throttle, anti-loop and quick-check. |
| `gas_thread_context.js` | Knowledge, history, memory, greeting, territory and prompt options. |
| `gas_thread_attachments.js` | Attachment prechecks, extraction/OCR and contextual look-back. |
| `gas_thread_documents.js` | Document intent, evidence, consistency and directives. |
| `gas_thread_generation.js` | AI strategies, fallbacks and local receipt path. |
| `gas_thread_validation.js` | Validation, repair plans, retries and response selection. |
| `gas_thread_delivery.js` | Dry run, transaction, sending and reconciliation. |
| `gas_thread_completion.js` | Labels and memory after confirmed delivery. |
| `gas_thread_lifecycle.js` | Logging and errors before/after sending. |

Deploy every component with the coordinator. Tests also exercise reverse load order.

## Processing sequence

1. Discover eligible unread messages, using metadata by default; query mode remains available. Old terminal labels must not hide a new message in the same thread.
2. Select external messages, aggregate a recent burst, check internal speakers and duplicates.
3. Apply local filters and [language mode](LANGUAGE_MODES.md). Italian is deferred with `·` in foreign-only mode; that label is not an exclusion in all-languages mode.
4. Load memory and run Gemini quick-check for response need, language and conversation signals. Technical failure is not a valid no-response decision.
5. Build knowledge/history/territory/attachment context. Before routing, one structured analysis reads text and visual files, distinguishes requests, deliveries and supporting evidence, and supplies a reusable consistency result. Personal requests inside attachments inform purpose, profile and validation; printed form questions and historical requests do not become new requests. Local receipts require simple delivery confirmed by both quick check and complete document analysis. Partial reads, errors and uncertainty retain generation and validation. Critical crises can stop for review before generation.
6. Generate under model/time/quota constraints, then validate deterministically and semantically where required. A high score cannot override a blocking check; a required semantic check must succeed.
7. Send using an idempotent transaction, then complete labels and memory. Failures after confirmed delivery cannot permit another send.

## State and limits

The RAW send path uses `reply_<MESSAGE_ID>@parish-reply.invalid`. Persistent state is reserved before sending. On ambiguous network/timeout failure, reconciliation may confirm delivery; without evidence, `send_uncertain_<ID>` remains and requires review rather than automatic resend.

`IA` means handled, including some filtered messages with no reply. `Verifica` covers blocked responses, warnings after delivery and uncertain sends. Normal labelling preserves unread state.

`ConversationMemory` has columns A–J: threadId, language, category, tone, providedInfo, lastUpdated, messageCount, version, memorySummary, contextualFlags. Topics are retained by recency, up to 50; summaries use up to 5 configured bullets. Sensitive evidence expires after 180 days by default; weekly row cleanup uses 30 days since last update, with separate handling of invalid dates. It does not delete Gmail messages.

Local settings include batch 2, 280-second execution budget, 90-second margin, 8 history messages, 310-second thread lock and a 10-minute checkpoint with at most 3 rapid resumptions of the same work set. Checkpoints respect `notBefore`.

`GeminiService` contains `GeminiContentClient` and `EmailQuickCheckPolicy`. There is no public generic `GeminiClient.runTask` API. The current code calls `generateContent`, estimates tokens locally and does not implement the formerly documented `GEMINI_CONTEXT_CACHE` option.

See [configuration](CONFIGURATION.md), [diagrams](ARCHITECTURE_DIAGRAMS.md), [troubleshooting](TROUBLESHOOTING.md) and [test coverage](validator_testing.md). Offline tests do not verify production deployment or provider availability.
