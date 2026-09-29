# Secretariat setup and operating guide

Updated 29 September 2026. [Italiano](Guida_Setup_Completa_Per_non_tecnici.md)

An administrator prepares Gmail, Apps Script, Gemini access and the Google spreadsheet using the [deployment guide](DEPLOYMENT.md). All runtime modules, including the eleven thread components, are required. Keep parish facts in the knowledge sheets; sample contacts and schedules in guides are not production data.

## Switch and language

In **Controllo**, B2 controls Acceso/Spento. F2 selects:

| Italian dropdown value | Meaning |
|---|---|
| Tutte le lingue | Italian and other languages can be processed. |
| Solo straniere | Identified Italian messages are deferred without an automatic reply and labelled `·`; other languages continue. |

Foreign-only does not mean “reply in English”. Responses use the detected language. Very short or mixed-language messages can be ambiguous.

Switching back to all languages allows still-unread deferred messages to be reconsidered if otherwise eligible. Changing mode does not restore manually read messages or clear error/review state. Do not delete labels wholesale. See [language modes](LANGUAGE_MODES.md).

## Hours and absences

Rows 10–16 define **suspension while office staff are present**: day in A, start in B, end in D. Vacation periods in rows 5–7 and holidays handled by the program keep automation active unless switched off. A backlog check can allow requests older than 12 hours during suspension.

Triggers, quotas and service availability also affect processing; immediate replies are not guaranteed. Do not rerun sheet creation to change a setting: it can clear Controllo data.

## Gmail checks

`IA` means handled, including some filtered messages without replies. `Verifica` requires human attention and can appear after a reply or an uncertain send. `Errore` requires diagnosis. `·` identifies Italian deferred by foreign-only mode.

A thread can combine several message states. Inspect sent mail before manually replying to a review case. No automatic approval draft is created. Escalate uncertain sends using [troubleshooting](TROUBLESHOOTING.md).

Keep knowledge current and review the queue regularly. If settings remain cached after an external edit, an administrator can run `clearKnowledgeCache()`. Missing alert emails do not prove the review queue is empty.
