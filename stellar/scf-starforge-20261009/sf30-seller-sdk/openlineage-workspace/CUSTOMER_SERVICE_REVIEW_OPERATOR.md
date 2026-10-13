# Customer service review operator

Use **Customer reviews** from the existing **Service levels** page, or open
`/customer-service-review.html` on the selected OpenLineage workspace host.
This page prepares an attributed customer handover from original saved records.
The original service and quality workflows continue to create assessments,
evaluations, comparisons, incident decisions and follow-up decisions.

A review saves the complete selected records and their supporting history at
one committed workspace revision. Its date range is the operator's stated
reporting context. It does not silently select, discard or recalculate records.

## Connect to the actual workspace

Start the maintained OpenLineage application with its original workspace and
access settings. The **Connection** dialog accepts the existing operator access
token; leave it blank only when that original local host requires no token.

The page displays the actual workspace ID, current revision and selected host
instance. Requests use both workspace and instance identities. If an address
changes to another workspace, reconnect to the original workspace rather than
replacing a pending request or creating a new case.

The token stays in the current browser session. It is absent from working
files, saved customer reviews and downloaded reports. Working files contain
private operational records and the exact pending proposal when one exists;
deliver them only through the project's authorized source or recipient route.

## Build a named working review

The **Draft review** tab has a local draft name and seven report fields:

| Field | What to enter |
| --- | --- |
| Review title | A specific title for the handover. |
| Customer / receiving team | The intended customer or team. |
| Period start / period end | Real dates in YYYY-MM-DD form when ready to preview. |
| Recorded by | The person or team taking responsibility for the narrative. |
| Scope and limitations | What the selected records cover, and what they do not establish. |
| Customer narrative | An explanation tied to those records and their original judgments. |

Unfinished text remains editable and is saved without applying the native
completed-document rules. Partial dates and empty fields can therefore be
retained as work in progress. The original native preview validates completed
dates, required fields, selection identities and any preceding review.

**New named draft** retains the current draft before starting another.
**Open saved draft** lists complete named drafts saved for this workspace.
These browser drafts are preparation; the native workspace is not changed by
opening, naming, searching or editing them.

Draft saves use the stored draft version. If another tab has advanced it, the
page saves the entered work as a separate copy and reports the conflict. It
does not replace the other tab's work. A storage failure leaves the current
state available through **Download complete working file**. Resolve the
storage failure or retain that full file before closing the browser.

## Select complete original records

Choose among four original record groups:

- **Service assessments**, with their original findings and source selection.
- **Quality evaluations**, retaining the original dataset and run identities.
- **Quality comparisons**, retaining both original evaluation identities.
- **Evidence result files**, retaining their original file identity and bytes.

Search changes the visible list, while selections remain retained across
searches, groups and pages. The list presents up to 100 records at a time.
**All explicitly selected originals** shows the complete selected set and
allows a deliberate removal.

**Full original** fetches the complete selected native record and verifies its
identity against the selected header. Inspect its actual fields rather than
interpreting a title or count as a new assessment.

The page does not create a risk score, service judgment, quality result or
incident disposition. Use the original service or quality editor when one of
those records needs to be created or changed.

## Preview and save the exact review

Choose **Preview complete review**. The page first retains the entered draft,
then asks the original native workspace for the complete preview.

Inspect the review document, source revision, complete counts and every
original record group. Supporting records may extend beyond the four
explicit selection arrays: the native writer includes the original incident
history, disposition and follow-up histories, supporting evaluations and
assessments, source editions, source files and events needed to explain the
selected work at that revision.

The source and evidence table offers **Original bytes** for each retained file.
A download reads all ranges from the original object and verifies the complete
length and SHA-256 before offering the file. Expanding a JSON section shows
the complete record or history; there is no truncated export hidden behind
the display.

**Save exact review** becomes available for the current preview. A new draft
edit or a refreshed, changed workspace revision requires another preview.
Before sending, the page durably retains the original operation ID, expected
revision, complete document, preview checksum, full preview and entered
working draft. The existing native workspace applies its ordinary
compare-and-swap transaction.

On acceptance, the page opens and verifies the complete saved review against
the original receipt. It then retains a separate following draft with an
explicit preceding-review identity. The original entered proposal remains
inside that draft's `appliedFrom` field. The current saved review is immutable;
the follow-up draft is editable preparation for a later edition.

If the native save succeeds but a response, saved-record read or browser
storage follow-up fails, the accepted original remains in the pending panel.
Do not create a replacement operation. **Finish saved review** reopens that
same accepted request and completes the local follow-up.

## Reconcile an unfinished request

The retained-request panel identifies the original workspace, operation and
state. **Download exact request** preserves the full original request and
preview for controlled inspection.

**Reconcile / retry original request** first reads the actual native operation
journal at one selected revision. If the original operation is already
accepted, the page uses its unchanged result. If absent, an explicit retry
sends the same original request body and operation ID.

A timeout, broken connection or unknown result keeps the proposal locked.
The page does not interpret an absent response as a failed transaction.
For a prepared request that was never sent, or a definite native rejection,
**Check absence and return to draft** verifies that no accepted original exists
before unlocking preparation.

An imported record claiming acceptance is also checked against the original
native journal before its pending state is cleared. Different arguments under
the same operation ID remain a conflict; the page does not silently issue a
new ID or replace the local pending request.

## Complete working files

**Download complete working file** saves the complete named draft and any
pending request in a JSON document with schema
`commons.openlineage.customer-review-working.v1`. The full original preview
and entered proposal travel with a pending request; they are not reduced to
IDs, counts or a display summary. No arbitrary small working-file limit is
imposed beyond the browser's actual reading and storage capabilities.

**Inspect working file** reads the entire selected UTF-8 JSON file, checks the
actual workspace identity, validates its complete draft and request structure,
and displays the complete incoming document. Inspection does not send a
native save or replace the open draft.

**Open as a separate local draft** first retains current work. An incoming
pending request must be admitted under the same original identity before its
draft becomes editable. It cannot replace a different local pending request.
The incoming draft receives a separate local copy identity while retaining
its original provenance. A pending imported proposal is reconciled before
ordinary editing is admitted.

This working-file route is for the same original workspace. Use the existing
complete workspace export and independent receiving workflow to deliver a
native case, application and source files. A browser draft is not a substitute
for that complete native delivery.

## Saved editions and customer downloads

The **Saved reviews** tab searches lightweight saved-review headers.
**Open saved edition** explicitly loads the complete frozen record and verifies
its checksum. Its detail shows the customer narrative, attribution, reporting
period, edition, original source revision, original records and full source
file downloads.

Choose one of the report formats:

| Download | Contents |
| --- | --- |
| HTML | A readable customer report derived entirely from the selected saved body, with complete original context. |
| CSV | The native report rows with original identities and judgments. |
| JSON | The complete immutable saved review, including its full preview and original records. |

Later incident reviews, source ingestion, dispositions or follow-ups do not
change these reports. A refreshed current workspace only changes what is
available for a new review; it does not rewrite an old edition.

**Start explicit following edition** retains the current working draft and
opens a separate preparation with the exact saved review ID and content
checksum as its predecessor. The native writer preserves the complete lineage
and rejects a conflicting head when saving.

**Complete editable workspace** uses the original workspace export with
application sources included. It downloads and verifies every archive range.
For a complete customer delivery, retain that export together with any chosen
human-readable report, following the existing `CUSTOMER_SERVICE_REVIEW.md`
and original receiving instructions.

Edition-10 metadata identifies the customer-review format. The existing
data-only export remains supported, but when application sources are included
they must be the complete 113-file edition. A partial application is invalid.
Use the complete application for an editable recipient delivery.

## Receiving and reopening

Use the existing native receiver for the complete exported workspace.
Its deep validation reconstructs the historical source selection and saved
customer review from the original operation records; it does not recompute a
saved handover against later incident or disposition state.

Open the received application through the original selected host and inspect
the same saved review ID, content checksum, complete JSON report and original
file downloads. The report must still contain the source snapshot that was
saved. A customer response or later review is separate work, never an in-place
change to that saved snapshot.

## Operator lifetime and actual presentation inspection

The page owns admitted requests, their complete response reads, draft writes,
the browser database and generated download URLs. Embedded receiving can await:

```js
await window.customerServiceReviewOperator.close();
```

A successful return is `{state:"CLOSED"}`. New admissions stop first; the
original admitted work drains, raw drafts and accepted requests are retained,
then the database and URLs close. A failed close remains retryable on the same
page object. `inspect()` reports actual workspace/instance, pending operation,
selected review, draft identity, dirty state, active work and closing status.

This source was prepared and reviewed against the original native APIs.
Source review is not a claim that a browser has rendered it. Before describing
the outgoing application or report as customer-ready, the actual existing
receiver must open this exact edition and look at its populated, empty,
loading and error states, operate selection/preview/save/reconciliation and
working-file controls, inspect the actual HTML report and downloads, reload
and reopen saved work, and view ordinary desktop, screenshare and narrow
widths. Keep those observations with the existing original course; do not
create a replacement case, provider response or verification programme.


## Recipient returns in this original operator

Open **Recipient returns** beside Draft review and Saved reviews after connecting to the original workspace. The return desk uses this operator’s same authenticated request and current workspace/instance identity. Select one saved immutable review, enter the actual recipient and requester, read its complete source preview and save the exact request. Download and open the complete editable recipient HTML before sending it. The recipient can retain its working JSON, reopen unchanged working files, enter each response and return the complete original JSON.

Import the actual return in the same desk, read its source-bound preview, enter the receiving operator and retain the response explicitly. Saved requests and history keep the exact original review and returned text. The desk offers the selected recipient document separately from the internal request-history report; the complete workspace export remains the maintaining engineer’s whole source handover. [REVIEW_RETURNS.md](./REVIEW_RETURNS.md) gives the full source, request, recipient, adoption and interrupted-save course.

Refreshing this tab refreshes original saved-review choices and invalidates an older preview. When the server instance changes, use the return desk’s explicit reconnect action to bind its retained work to that same workspace. Original review-authoring drafts and recipient-return working copies remain in their existing independent revision-checked stores. Both use the original workspace writer and operation journal; a changed revision requires explicit current review.

Closing `window.customerServiceReviewOperator` first drains the mounted return desk and retains any dirty or storage-fault state, then releases the original operator database and download URLs. A failed local save leaves the operator open with recovery and complete working-file download available. An accepted return updates the original review overview without recursively refreshing or closing its own desk. The receiving producer passes this same Page/client/workspace into `RECIPIENT_RETURNS_RECEIVING.mjs`, operates the full desktop and narrow course, opens every outgoing attachment and inspects the actual views under the complete owner directive above.
