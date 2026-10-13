# Delivery risks and mitigations

This desk adds a complete dated risk and issue register to the existing Grant Operations case. It uses the original contributors, work packages, source files, immutable reviews, request receipts and complete case export. Open **Delivery risks** in Customers and delivery.

The browser prepares and displays documents. The native risk engine normalizes them, checks their lineage and source, produces findings, and saves an immutable edition through the original Operations command writer. This contribution contains source; no customer case, browser course or risk result has been executed by its author.

## Who can use the desk

Owners and leads may save risk editions in their permitted open cases. Finance and reviewer staff may inspect, seed and preview registers for their assigned cases. Their Save button remains unavailable; this UI adds no permission to the native writer. Contributor staff keep their existing desk.

The original enrolled staff identity is passed through the parent transport and mutation-ID function. Local draft and request storage is scoped by the original installation, staff member and case. The entered recording operator remains the original Operations operator. Register entry owners and mitigation owners are selected from the case contributors; an explicitly unassigned owner is valid.

## Open or start a register

1. Open the existing Operations case and select **Delivery risks**.
2. The current native edition opens if one exists. Its assessment date, recording operator, review ID, SHA, full report and original source are visible. A historical edition is labelled and its current predecessor is shown.
3. Select **Prepare current draft** to request the original native seed. It contains the complete document and current contributor, work-package and source choices. A first edition may be empty.
4. Set the name and assessment date. The native report evaluates review and action deadlines at this date. It does not substitute today's date when reading an older edition.
5. Add only actual risks or issues identified by the recording operator. The desk generates a stable lower-case risk ID once for each new row. It never creates entries from forecast gaps or budget figures.

Preparing another seed replaces only the local draft after an explicit confirmation. Download the draft first if its entered work must be retained. Opening an immutable edition or browsing history does not replace the draft.

## Assess a risk or issue

Each entry includes title, description, category, original identification date, owner and owner context, state, likelihood, impact, priority, reasoning, trigger, next review, original work-package links, source files and source context.

An issue has already occurred, so its likelihood is **Not applicable**. An existing risk may become an issue; an existing issue cannot become a risk. An inherited identification date stays fixed.

Likelihood, impact and priority are explicit recorded assessments. The interface does not derive a score, expected exposure, estimated money, forecast change or cash entry. Native preview returns all status counts, unassigned owners, overdue reviews, overdue mitigation actions and link findings.

New work-package links use the current saved plan. An inherited retired package remains visible as a retained original link. The native engine decides whether a new link is valid and flags historical links without silently deleting them.

Sources are chosen from the original case. **Open supporting sources** takes you to the existing attachment workflow. Return to this desk and refresh the current case to see newly retained files. Source downloads reopen the original file route and verify complete byte length when available and SHA-256 against the native metadata before offering the file.

### Dated reviews and resolution

A changed existing entry requires a current dated review: date, reviewer and note. Native validation checks this against the predecessor and assessment date.

Resolved and closed entries require both a dated review and a resolution date with evidence. Record what actually resolved the issue, or why the risk is closed. Preserve the original entry ID rather than deleting it.

The first edition and a successor may contain up to 200 entries. The desk intentionally provides closure states instead of deletion controls, preserving the native lineage. Native import and preview remain authoritative for any complete supplied document.

## Mitigation actions

Every risk or issue can hold up to 100 actions. Each action has its own stable ID, title, scope, contributor or explicitly unassigned owner, owner context, state, due date, completion or cancellation date, progress and supporting sources.

Actions move through Planned, In progress, Done or Cancelled. Done and cancelled actions require a completion date and progress or outcome note. Actual identification, review, resolution and completion dates cannot be later than the assessment date. Future due dates and review dates are allowed.

Complete or cancel an inherited action instead of deleting it. The native successor check preserves all prior risk and action IDs.

## Preview and save an edition

1. Finish the complete draft and select **Review complete draft**.
2. Inspect the native report, including overdue flags, unassigned owners, source findings and historical package links. The full normalized document, native source identity and preview SHA are available below the report.
3. If you edit the document, its preview becomes invalid immediately. A refreshed case version also invalidates the old preview. Run the native preview again.
4. Enter a nonempty reason for saving the edition. The owner or lead then chooses **Save reviewed edition**.
5. The desk freezes the complete original command, including expected case version, recording operator, action, normalized document, expected preview SHA, note and original request ID. Local publication must succeed before dispatch.
6. The read-only risk request lookup first checks that exact command. An existing matching result is reopened; otherwise the original command is sent once.
7. The returned success is retained immediately. The desk reopens the complete immutable edition, verifies its review SHA and preview SHA, reopens the case at the accepted version, and publishes the complete local receipt before releasing that request.

Saving creates a native review with purpose DELIVERY_RISK_REGISTER and action risk-register.save. The original backend performs the compare-and-set and current-head checks. A historical seed may be inspected, but saving must supersede the exact current register head. An old draft is never silently rebased.

After saving, the entered draft remains available for inspection. Use **Prepare current draft** for the next edition so its predecessor comes from the current native head.

## Exact request recovery

The **Request recovery** view is part of the same case and staff desk.

- **Read original outcome** submits the retained complete command to the native read-only request lookup. It does not call the writer.
- **Reconcile and send the same request** first reads that original outcome. Only a returned found:false permits one replay of the same complete command and ID.
- A returned result becomes **Known native success** before any subsequent case read or local publication. If storage or reopening fails, that same accepted object remains retained and the desk offers **Reopen known saved edition**.
- A network error, cancellation, authentication problem, missing source, opaque failure, REQUEST_CONFLICT or RISK_REQUEST_CHANGED keeps the exact request locked. Absence by itself is not a rejection.
- Only an explicit native save rejection with one of INVALID_RISK_REGISTER, RISK_HEAD_CHANGED, RISK_PREVIEW_CHANGED, INVALID_OPERATIONS, OPERATIONS_CONFLICT or OPERATIONS_CLOSED, plus a new found:false lookup, permits **Return rejected request to draft**. The full rejected command remains in the local history. The draft then needs a current preview and a deliberately selected new request.
- Before every later replay, the prior rejection flag is cleared and saved. A later uncertain attempt cannot inherit a previous attempt's definite rejection.
- The desk does not run a timer that retries saves.

Use **Download full desk and receipts** when a local-storage error appears. Keep the current browser desk open until a known success is durably retained or exported. The backup includes the full draft, normalized preview, source choices, original pending command, accepted result and request history; it contains no session credentials. It is an operator recovery record, not a second import writer.

A locally unreadable stored desk blocks edits and saves. Its raw original record is included in the downloadable backup rather than silently cleared. Recover that original state before selecting replacement work.

## Browse editions, sources and history

The Register view can filter the selected native report by text, state, kind and owner. The native totals continue to describe the entire edition. Text search includes original ID, title, category, contributor name and description.

**Inspect entry** shows its original reasoning, dated review, resolution, complete action scope and sources. **Edition history** opens the native lineage for that stable entry ID. Each history row keeps the edition's date and identity and provides its complete entry, action outcomes and review evidence.

**Editions and history** lists all immutable editions newest first. Open an edition, download its complete risk document, or use **Export complete case and this edition**. The ZIP is returned by the original native exporter and includes the complete original case plus the exact selected risk JSON, two CSV views and HTML. The UI does not construct an approximation of the case archive or rewrite its timestamps.

The Operations finder recognizes DELIVERY_RISK_REGISTER reviews and opens the selected original edition in this desk. All other navigation entries keep their existing behavior.

## Complete document import

The Draft view accepts the native stellar-forge.sf47-delivery-risks.v1 JSON document, bounded to 8 MiB. It checks the complete structural container, risk/action arrays, review and resolution objects before retaining it locally. It never interprets file content as a script or HTML.

Import is a draft selection. It creates no native review. Native preview checks exact predecessor, dates, IDs, roles, packages and sources before any save. Importing a complete archived case continues through the original Operations case importer, preserving its native reviews, sources and history.

## Portable working copies

The **Working copies** view carries an entire editable Risk desk between browser sessions for the same Operations case and signed-in staff scope. It preserves the draft, its original source and predecessor, saved views, save note, retained exact command, receipt observations and complete local checkpoints. It does not import an Operations case or move a request to a different installation or staff member. To share only a proposed risk document with another operator, continue to use **Download complete draft** and the existing complete-document import.

### Save and reopen a copy

1. Choose **Download complete working copy**. Keep the downloaded JSON with the original private project records.
2. In the same case and staff scope, choose that file and **Review selected working copy**. Legacy complete desk JSON from **Download full desk and receipts** is also accepted.
3. Review its filename, complete byte identity, draft name and case version, original request ID, receipt observations and checkpoint count. Expand the complete selected desk to inspect every field. This step changes no editable draft or native record.
4. Choose **Reopen reviewed working copy**. The desk retains both the preceding full desk and the selected original copy as checkpoints before replacing editable state. All native reads must finish and the complete resulting local state must be stored successfully. A failed read or local storage write leaves the preceding desk and selected review available.
5. A draft without an unfinished request opens in **Draft edition** with its original predecessor and stable entry/action IDs. Choose **Review complete draft** to obtain a fresh native assessment before saving. Stored preview identities cannot authorize a save.
6. A copy with an unfinished command opens in **Request recovery**. Native read-only lookup determines whether that exact original command was accepted. If accepted, the actual review SHA and original preview identity must match before the known result is adopted. If absent, the same original command remains locked for reconciliation and an explicit same-command retry.

Import never sends a native save. An imported claim of acceptance, absence or rejection is not authority: the original request table is read again. Imported rejection flags never unlock a draft or permit a replacement key. A known accepted command that is absent from the selected native case stays an unresolved source-case problem; it is not converted to an unaccepted request.

If this desk already owns a pending or accepted command, reopening requires an identical complete command. A different request cannot replace it. Native roles and the existing recording-actor checks remain in force. This is particularly relevant when an owner is viewing a staff member's copy: select the original staff scope instead of reassigning the request.

### Complete checkpoints and receipt history

Each successful reopen keeps the preceding full desk and the selected original desk as immutable local checkpoint observations. Earlier checkpoints in the imported copy are carried forward by their complete canonical SHA256 identities. Checkpoints do not nest other checkpoints; the portable copy contains one flat list.

Use **Review checkpoint** to inspect and reopen it through the same native lookup flow, or **Download checkpoint** to retain it independently. **Remove local checkpoint** requires explicit confirmation and removes only that local observation from future copies. It never changes the active draft, unfinished request, native edition or original source. Download a checkpoint before removing it when it is still needed.

Imported historical receipt observations remain verbatim inside the selected full checkpoint. They are not silently merged into the active desk's verified native receipt list. An actual lookup result for the selected unfinished request becomes the active known result and follows the original **Reopen known saved edition** flow. The active desk's existing receipt history remains intact.

The desk permits up to 16 complete checkpoints. File input and complete working-copy output are bounded to 32 MiB. Browser session storage may have a smaller quota. If retaining the whole state fails, the previous desk remains active and the selected copy remains available for download and retry. Download and explicitly remove older checkpoints when space is needed. There is no automatic pruning.

### File format and boundaries

The portable envelope is:

~~~json
{
  "schema": "stellar-forge.sf47-delivery-risk-working-copy.v1",
  "exportedAt": "<actual export time>",
  "payloadSha256": "<SHA256 of canonical complete payload>",
  "payload": {
    "schema": "stellar-forge.sf47-delivery-risk-desk.v1",
    "programId": "<original case ID>",
    "staffContext": "<complete original public staff context>",
    "...": "all original desk fields and the flat copies list"
  }
}
~~~

The checksum is an integrity check, not a signature or permission grant. JSON is decoded as strict UTF-8, parsed as data and rendered with escaped text. The full original installed staff context, including installation and staff identity, must match. No credential or access code is added to the copy.

Legacy desk exports retain their existing shape and are accepted without an envelope checksum. The received file's complete byte SHA256 and byte length are still recorded. An export containing unreadable original storage is retained for manual source recovery; it is not treated as a replacement for that unresolved desk.

Working copies use only existing case, register, seed, saved-review and exact-request read routes. They add no domain writer, background worker, account, case or local database. All reads and file operations remain within the original retained per-staff task owner. Navigating away drains that same operation before later reuse.

## UI, lifetime and custody

The interface uses the original grayscale Operations styling, semantic headings and fieldsets, labelled controls, native buttons, visible focus, status and error messages, keyboard navigation and responsive tables. Narrow layouts collapse the entry editor and filters to one column. Overdue findings use explicit text, not color alone.

A per-staff, per-case retained session owns every admitted transport promise. Closing or replacing the rendered view removes its handlers and suppresses subsequent DOM updates; it does not cancel a dispatched command or discard a known response. The same retained session owns the request until its response bodies and follow-up reads finish. Reopening waits for that owner before refreshing.

All downloaded bodies and imported file reads finish inside the retained operation. Object URLs refer only to already-read immutable Blob bytes and are revoked after the browser download handoff. The UI starts no host, process, background worker or new database.

## Source and integration contract

New files:

- operations_risks.mjs — complete browser desk, draft, report, edition/history, exact request and download workflow.
- operations_risks.css — complete grayscale responsive styles.
- RISK_REGISTER_OPERATOR.md — this guide.

Guarded existing joins:

- operations.mjs — import and mount; per-staff retained session; permitted navigation; finder selection; independent busy, disposal and case-observation joins.
- operations_navigation.mjs — section metadata and native risk review routing.

mountDeliveryRisks receives the original container, current complete case, staff-pinned saveApi transport, retained session, mutationId, recordingActor, staffContext, canSave and existing onCase/onSources callbacks. It returns {root,ready,setHostBusy,dispose}. The parent must keep the retained session across renders. dispose returns the currently owned transport promise but never abandons it when the original parent uses synchronous disposal.

The final assembler must retain these sources in the original source selector, serve operations_risks.mjs and operations_risks.css from the existing static route, and keep the original staff-session and transport modules. No new role grant, account, persistence engine or domain writer is introduced.

### Native routes consumed

| Route under /api/operations/{case} | Purpose |
|---|---|
| GET /risk-register | Full current head and immutable edition list |
| POST /risk-register-seed | Native full draft and original source choices |
| POST /risk-register-preview | Complete normalized assessment and preview identity |
| GET /risk-register/{reviewId} | Full original review, document, report and source |
| GET /risk-register-history/{riskId} | Complete stable-entry lineage |
| GET /risk-register/{reviewId}/export.zip | Complete original case and selected edition |
| POST /risk-register-request | Read exact original command outcome without writing |
| POST /command | Original risk-register.save command |
| GET /sources/{sourceId} | Original complete retained source file |
| GET case root | Original current case and version |

The only native mutation introduced by this desk is the existing Operations command with action risk-register.save. Sources remain with the original source.add workflow.

## Receiving course for the assembled original product

The native course owner should use the same original host and case. This checklist describes observations to retain; it is not a claim that a course has run.

1. Open an owner or lead's assigned case and inspect the native empty/current register.
2. Prepare the native seed; add a sourced risk with an explicitly assigned or unassigned contributor and a dated mitigation action. Preview the full normalized result.
3. Save the reviewed first edition and retain its exact command, review SHA, preview SHA and original case version.
4. Reopen that edition and its source through the UI. Export the original complete case ZIP.
5. Prepare a native successor, record an actual dated review and complete or cancel the original action. Resolve or close the same stable entry with a dated note. Preview and save the exact current-head successor.
6. Read its full history and both immutable editions. Verify the old edition remains unchanged and the current source changes are labelled.
7. Reopen an actual retained working copy for the same case and staff scope. Review its full checkpoint and original request, use native read-only reconciliation, and preserve any actual source/predecessor conflict returned by the original course.
8. Reopen the same retained accepted request and inspect its existing outcome; no new edition should be created.
9. As an assigned finance or reviewer, inspect and preview while Save remains unavailable and the native writer enforces its original role rules.
10. Use the original case receiving/import course for the complete exported archive and reopen its original risk reviews and lineage. Retain the complete native result and original source manifest with actual execution receipts.

The working-copy addition was checked by complete source parsing and exact guarded reconstruction against the maintained editor and actual native read interfaces. Its browser interaction has not been executed in this contribution. Continue it within the existing original case and receiving programme when that installed runtime is available.
