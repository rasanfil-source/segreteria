# All languages and foreign-only mode

Checked against local source on 29 September 2026. [Italiano](LANGUAGE_MODES_IT.md)

## Setting

Use **`Controllo!F2`**, keeping the Italian dropdown values:

| Sheet value | Internal mode | Italian messages | Other languages |
|---|---|---|---|
| Tutte le lingue | `all` | Eligible | Eligible |
| Solo straniere | `foreign_only` | Deferred with `·` when identified | Eligible |

The loader selects `foreign_only` when the cell contains both “solo” and “straniere”, case-insensitively. Other values, a blank cell or a missing control sheet default to `all`. Do not translate the dropdown values or enter internal mode codes in the cell.

Eligibility only passes the language filter: newsletter rules, previous handling, review, quotas and other checks still apply. “Foreign” means non-Italian, not the sender's nationality or email domain. The mode does not force all replies into one language.

## Detection order

`ThreadPolicy` first allows a subject-only Italian precheck in foreign-only mode **only when the plain body is empty**. Selected Italian terms can defer the message before quick-check. With a nonempty body, an Italian subject alone does not trigger that precheck.

Local detection then uses the main content with signatures and quotations removed where recognised. Codes such as `it-IT` are normalised to `it`. Italian messages in foreign-only mode are deferred before reply generation. Messages reaching Gemini quick-check may receive an updated language; the Italian filter runs again before generation.

`shouldSkipByLanguageMode_` excludes only `it` in `foreign_only`. Unknown language is not automatically Italian and may continue. Mixed-language, very short and textless messages remain ambiguous. Generated responses use the detected language; local templates and individual validators have finite language support and may fall back.

## Deferred messages and switching modes

Deferral adds `·` to the relevant messages, preserves unread state and does not promote them to `IA`. While foreign-only mode remains active, discovery excludes deferred messages and handling protects their skip label.

Switching back to all languages stops treating `·` as an exclusion. Deferred messages that are still unread and otherwise eligible can be considered again without manually removing the label. On actual handling, the processor adds `IA` and attempts to remove `·`; some filters can handle a message without replying.

Changing mode does not reset read state, `IA`, `Errore`, `Verifica`, uncertain-send markers or other exclusions. Gmail's thread-level label display can combine state from multiple messages. Detection uses the selected candidate and any grouped message burst.

## Applying changes

The resource loader stores the mode in `GLOBAL_CACHE.languageMode`. The `onEdit` handler recognises F2 for invalidation when it receives an edit event; resource loading also checks modification state. If an external edit leaves stale resources, run `clearKnowledgeCache()` and allow the next cycle to reload. No model change or redeployment is required.

The master switch, suspension, quotas and batch limits remain independent. Each GAS project reads the spreadsheet selected by its own `SPREADSHEET_ID`; projects sharing a spreadsheet also share F2.

See [configuration](CONFIGURATION.md) and the [offline test runner](validator_testing.md). Regression coverage includes advanced configuration, processor, Gmail, thread-characterisation and unit suites.
