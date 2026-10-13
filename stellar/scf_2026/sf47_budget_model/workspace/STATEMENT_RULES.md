# Recurring statement classifications

Use **Accounts → Statements → Recurring statement classifications** for repeated transaction patterns. A saved bank setup controls parsing and column mapping; a classification rulebook controls which proposed row decisions the operator will review after the original native preview.

A rulebook belongs to one original case, exact account identity and currency. Its saved editions are immutable. It lives in the existing Staff-scoped statement working copy and complete named-copy archive. A saved rulebook is not a server cash command: the operator reviews matching rows, chooses recommendations, applies them to the draft and runs the original native statement preview before importing.

## First statement

1. Open the original CSV, OFX/QFX or MT940 file. Select the actual account, currency and interpretation, reconcile this period’s balances and use **Preview statement**.
2. Open **Recurring statement classifications → Start a new rulebook**. The exact current account and currency are copied into its unfinished editor. Give the book a useful account/purpose name and explain this edition.
3. Enter each rule in the form and choose **Add rule to unfinished edition**. All entered conditions must match: inflow/outflow, reference and description text, and inclusive minimum/maximum absolute amount.
4. Choose **Save immutable rulebook edition**. This also saves a complete named working-copy edition through the original atomic copy store. A stale saved-copy index requires the existing refresh-and-save workflow. A failed save does not silently declare the rulebook durable.
5. Choose the saved edition, then **Review this statement with these rules**. Inspect the matching conditions and complete before/after row details. Select the intended rule for each row. **Select unambiguous recommendations** selects only rows with exactly one matching applicable rule; it leaves overlapping matches alone. The operator can change or clear every selection.
6. Use **Apply selected rule decisions**. The complete current working copy is preserved first. Only the selected eligible row decisions change. Run **Preview statement** again, resolve any original source/balance/allocation findings and use the existing reviewed import.

The row reason retains the rulebook name, original ID and edition, rule name/ID, exact conditions and operator-authored reason. Existing native statement source/review and cash notes therefore carry the classification choice. The complete editable rule definitions and application history remain in the full working-copy archive.

## Matching semantics

- Account identity and currency must match the selected statement interpretation exactly. There is no inferred alias or currency conversion.
- Rules choose **IN** or **OUT**. Amount conditions compare the original positive absolute amount within that direction. Bounds use decimal integer arithmetic, never binary floating-point rounding. A bound can contain up to 30 integer and 12 fractional digits; no grouping or exponent syntax.
- A reference or description condition is **Exact**, **Starts with** or **Contains**. Text case is explicitly selected. Original spaces are retained; matching does not trim, transliterate, remove punctuation or interpret regular expressions.
- All nonblank conditions must match. A rule must have at least one text or amount condition, so an empty form cannot accidentally classify the whole account.
- A rule proposes classification or explicit exclusion. Grant tranche 0–3 requires a grant inflow. **Keep current** and **Clear** remain explicit alternatives. Existing native validation governs the final combination.
- Rules do not select invoice identities or allocate amounts. The original supplier allocation desk performs that task against actual current invoices.

Each rulebook edition supports up to 100 rules. The complete local library supports 1,000 original editions. It preserves every earlier edition and operator attribution.

## Protected rows and overlap

The review shows all original rows, including unmatched and protected rows. Only rows whose native status is **NEW** are eligible. Already-recorded, excluded and conflicting rows retain their original handling. A row with any explicit current decision, existing allocation or unfinished allocation work is protected.

This is deliberate when a colleague or accountant has already supplied a complete choice. The rulebook cannot overwrite that work by giving a pattern higher priority. Use the original row editor or recipient-review comparison for those decisions.

Two or more matching rules remain visible together. There is no hidden priority, “first wins,” merged classification or guessed grant tranche. Select one applicable rule, choose **Keep current / skip**, or leave the row unselected. Applying the selected rows preserves all other decisions. Search and filters cover the complete review, with pages of 25 rows. Selection spans pages and its total remains visible.

## Following editions and later periods

Choose **Edit following rulebook edition** to load a saved edition into the unfinished editor. Add, edit or remove rules, write the reason and save. The selected predecessor must still be the latest edition of that book. Editing an older edition cannot overwrite later work. **Copy rules into a new rulebook** creates a separate book after explicit account/currency review; it preserves the original book’s history.

Opening the next original statement file preserves the current complete working copy first. The local rule library and unfinished editor remain available. Map and preview that next file, select the intended saved rulebook edition, inspect the new matching rows and choose again. Old row choices are never carried into a different source.

For a fresh browser, receive the complete named-working-copy archive with the existing **Open working-copy archive** control, select its original saved copy/edition and use **Receive rules from selected saved working copy**. This merges only complete rule history and keeps the new statement’s original bytes, mapping, decisions and current request. Review the saved edition’s account/currency before use.

**Download complete rule library** and **Open complete rule library** also transfer the whole edition history for the same case. Exact overlapping editions reconcile once. A different body under the same original book ID/edition is refused; preserve both originals and resolve their source. An imported actor label is retained attribution, not independent authentication.

## Save, interruptions and native requests

Unfinished rule forms, rulebooks, row choices, matching review and previous applications are part of the original statement draft, recovery JSON and immutable complete-copy archives. **Save current rule work** explicitly waits for the existing copy save and draft persistence.

The review is tied to the complete original input, preview, case version, current decisions, allocation work and original pending-request state. Editing those fields makes earlier choices visibly stale. Reopening an archived working copy intentionally requires a fresh native preview and rule review. The earlier result remains inspectable; it cannot be applied to the changed statement.

Applying recomputes matching and the complete original batch proposal before changing the draft. The original copy-save transaction preserves the pre-apply version. A later import uses the unchanged native statement command and original retained request ID. Pending import, accepted/readback and saved-setup requests keep their existing recovery behavior.

Application history is paged in the desk. Each download contains the complete selected rule edition, source/preview identity and every before/after row decision. Whole archives retain the entire history. Use those files together with the original bank and native saved statement review when handing work to another operator.

## Original receiving course

The maintained operation is \`operations/scf-statements-original-32c2-20261013/operate-original-statements.mjs\`, in the existing A0D5/32C2/0C75/4593 account case. Its private browser context keeps the actual case/invoice and the main context’s original CSV decisions unchanged. Receive this module, stylesheet, original desk join and the original managed manifest as one source edition.

The course operates the original October CSV with overlapping inflow recommendations and the actual supplier invoice allocation protected, saves and revises the rulebook, checks exact complete-library replay and divergent-edition refusal, applies selected rules, uses the actual native preview and preserves the resulting full working-copy archive. Later source reuse and independent browser receiving retain the same case and selected original source. Actual desktop and narrow controls, complete downloads and restored editions must be opened and viewed through the existing equipped receiving owner.

Source validation and the authored pure-model course use the unchanged original 166-byte CSV with explicitly authored model context. Native financial operation and rendered product receiving retain their own actual host, case, output and screenshots.

## Rendered product inspection — owner instruction, 2026-10-13

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Bryce's standing rule is: “that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it”.

Before presenting a client/prospect-facing application, website, dashboard, demo, report, presentation, export or any attachment, the producing peer must open/run/render the exact outgoing version, LOOK at it and normally use it as the recipient would. View the actual screenshots you capture. Inspect the actual presentation/screenshare width and relevant narrow/mobile width, important user controls, populated/empty/loading/error states, downloads and reopened exports. Open the usable contents of ZIPs/projects and every applicable report/PDF page. Source review, schemas, HTTP 200, DOM counts, tests, checklists and another worker's approval cannot substitute for observing and using the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and continued delivery; it must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk. Do not run broad test sweeps, repeat accepted checks, build a verification product or create review bureaucracy or an approval queue.

For video and audio, Bryce directs: “also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them”. Use available high-quality generative voice/TTS and useful generative media, with natural professional delivery. Actually watch/listen to the final outgoing export, including pacing, pronunciation, timing and audio alignment. Preserve existing spending, voice and attribution controls.

Include this complete instruction in delegated assignments and the active owner-controlled provider/project/cloud policy, boot, build and receiving guidance those workers actually read. Reuse already updated copies and return exact updated paths/version in the original policy thread with the next substantive result. Delivery of source does not establish that every runtime loaded it. Preserve all other owner controls and original operation identities; leave historical records and third-party/vendor policies intact. This instruction creates no restarts, watchers, credential gate or new release permission and does not revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999
Canonical attachment/media clarification: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791885532614949

