# Complete report editorial review and returned wording

This is an installed customer workflow on the original Analysis report engine. A report author can issue a complete retained report to a named recipient, the recipient can edit its wording in a self-contained HTML file, and the author can reconcile the return against a later report definition. The existing saved SQL, parameters, typed result rows, data selections, publications and original report writer remain in place.

Operation: ANALYSIS-REPORT-EDITORIAL-RETURN-7F5A-20261013. The original World Bank/Analysis case and FE85 receiving owner remain the customer continuation. The Economic client briefing review and Event worksheet review have their own original schemas and owners.

## Author: issue a complete original report

Open **Editorial reviews** from the existing private Analysis workspace. Choose a COMPLETE run from the original report history. Older runs are paged; an already selected run remains selected while paging. Enter the named recipient and review instructions, then retain the issue.

The issue captures every verified typed table from that one complete run, its full report definition, original query records, source/data selection and exact report result. It is independent of subsequent report edits. Issuing the same retained request ID returns the original issue. Changing the report or recipient under that ID is rejected.

Download the complete recipient HTML and original package. The HTML contains every original table, every query and all original identities. On-screen table pages display 50 rows at a time; the complete rows remain in the file and original JSON download. No service, account, remote script or network request is needed to edit the downloaded file.

This action prepares an artifact for the operator. Sending a message or attachment is a separate relationship action under Bryce's current instructions.

## Recipient: edit, save and return

Open the complete recipient HTML in a browser. Inspect the original data and query sections, then edit the report title, introduction, section titles and section notes. The typed tables and query/data selections remain original.

Use **Retain review edition** to preserve a complete named edition. Earlier editions remain available for restoring their wording without deleting the later history. Enter a message to the author when useful.

**Download editable HTML** saves the complete original report, current unfinished wording, all saved editions and any exact pending return. Reopen that downloaded file to continue. **Download working JSON** provides the same full editable state for importing into the matching original review. Browser storage is an optional convenience; its failures stay visible beside the controls until a successful save. The downloaded editable file is the portable working copy.

**Download attributed return** validates the original editorial field limits, saves a named edition and creates the exact return. Repeating the action with unchanged wording reuses the same return ID. Further edits create a subsequent explicit return when requested. The author receives the proposed wording, named reviewer, message and complete saved edition chain; the return binds the original workspace, issue and full source hash.

Return JSON is complete compact UTF-8 within 16 MiB. Editable HTML/working JSON have a separate 512 MiB limit; oversized current work is retained in the open editor and no field or historical edition is silently removed. The underlying original report source retains the original 128 MiB complete-source bound.

## Author: receive and reconcile

Open the original issue and receive the attributed JSON. The native workspace verifies the original issue/source identity, exact issued section structure, every editorial field and saved-edition hash chain before retaining it. Replaying the exact return is idempotent; a changed return with the same ID is rejected.

Select **Compare with current report**. Each field shows three complete values: issued wording, current author wording and returned wording. A recipient-only change, author-only change, agreement and overlap are distinguished.

The original section mapping follows exact pinned query identity. An unchanged full query sequence retains its original indices; a reordered unique query can be matched to its current section. Duplicate, removed or changed query identities require an explicit selection. The author can map an original section to a current section or keep the current report structure. Mappings are one-to-one. The screen shows both original and current query names/revisions. No returned SQL, parameters or source data replace the current author's selection.

For every changed return choose **Keep current author wording**, **Use returned wording** or **Use resolved wording**. The current query definitions, order and parameters are copied from the actual current report. Record the author decision note and save the complete author working file when pausing.

**Apply reviewed wording** first retains the exact source-bound decision and expected current definition. It then calls the existing reports.save writer with that expected revision and original durable request ID. A concurrent author change rejects the stale choice. If it occurs before the original save starts, the native review history retains that exact rejected request as NEEDS_REVIEW; continuing its ID returns the same rejection. The author can therefore distinguish this explicit rejection from an uncertain HTTP outcome. **Reconcile a rejected save with current report** retains that earlier rejected action and opens a fresh current comparison for a new explicit decision.

If the HTTP reply is lost after the original native save, **Continue original application** reuses the same request. The original report engine finds the accepted saved definition before checking the current head, so a later author edit remains preserved. Pending choices cannot be silently replaced by a new request. The final receipt names the exact saved definition. Run and publish it through the existing Reports editor when appropriate.

## Native and agent client

The Python wheel contains the complete UI, HTTP, source model and client. It does not depend on an adjacent seller checkout. Run the module against the directory of the already running Analysis workspace:

~~~sh
python -m stellar_forge_buyer.report_review_client --database /absolute/original/workspace history
python -m stellar_forge_buyer.report_review_client --database /absolute/original/workspace issue --request /absolute/issue.json --operation /absolute/report-review-operation
python -m stellar_forge_buyer.report_review_client --database /absolute/original/workspace download --issue-id ORIGINAL_32_HEX_ID --name review.html --output /absolute/Report_Review.html
python -m stellar_forge_buyer.report_review_client --database /absolute/original/workspace receive --request /absolute/Report_Editorial_Return.json --operation /absolute/return-receiving-operation
python -m stellar_forge_buyer.report_review_client --database /absolute/original/workspace preview --return-id ORIGINAL_RETURN_32_HEX_ID --output /absolute/Current_Review.json
python -m stellar_forge_buyer.report_review_client --database /absolute/original/workspace apply --return-id ORIGINAL_RETURN_32_HEX_ID --request /absolute/Reviewed_Choices.json --operation /absolute/author-application-operation
~~~

Use the actual IDs and result hash from the original history. An issue request contains job_id, result_sha256, recipient and instructions; the retained client creates its stable request ID once. A returned file is used whole. An apply request contains preview_sha256, the complete selected mapping array, decisions keyed by the original field keys, and note; the retained client creates its ID once. Each changed field has an explicit choice of current, returned or custom; custom includes text.

The client reads the current original analysis-launch.json, validates numeric loopback and stable workspace identity, and reuses the original capability transport. It creates no AnalysisWorkspace and takes no second engine lease. The complete request is committed before dispatch. Reuse the same operation directory after interruption. Complete returned provider observations are retained under their content hashes as well as the selected result. Downloads are streamed, length/hash verified and published without replacing a differing prior file. The same stable workspace identity can be reached after moving its complete received workspace.

HTTP routes under the existing capability and origin checks:

| Method | Original route | Purpose |
|---|---|---|
| GET | /api/report-reviews?before=&limit= | Complete paged issue history |
| POST | /api/report-reviews | Retain one exact issue |
| GET | /api/report-reviews/ID?returns_before=&applies_before=&limit= | Issue with separately paged return/application summaries |
| GET | /api/report-review-returns/ID | Exact complete original return and edition chain |
| GET/HEAD | /api/report-reviews/ID/review.html | Complete self-contained recipient |
| GET/HEAD | /api/report-reviews/ID/package.json | Complete original source package |
| POST | /api/report-review-returns | Receive the whole attributed return |
| POST | /api/report-review-returns/ID/preview | Compare with current native definition |
| POST | /api/report-review-returns/ID/apply | Continue the reviewed original save |
| GET | /api/report-review-applies/ID | Exact retained application outcome |

## Complete workspace receiving and continuation

Issue lists retain compact source-bound summaries; returned reviews and author applications page independently. Every exact retained return and original full decision has its own download/read route. Older history is never dropped to fit a list response.

The three sf_report_review_* tables live in the same original SQLite database. The existing WorkspaceArchives full database snapshot includes every issue's full report tables, original source text, returned edition chain, current apply intent and immutable report save history. The original workspace identity is retained by the native archive receiver. There is no extra source directory to reconstruct for this feature.

Use the original workspace export operation and original restore_archive receiver. Continue the same received database through its normal single Analysis owner. Reopen **Editorial reviews**, download the same original recipient package, inspect earlier returns and continue a pending original save. Later author work in a completed received workspace remains governed by the original archive replay and report expected-revision contracts.

The CLI's request directories and outgoing/returned working files are useful original operator records. Preserve them alongside the complete native workspace archive when handing over the entire operator case; the native issue/return/application histories themselves already travel in the SQLite snapshot.

## Original-case receiving course

Continue FE85's already selected World Bank/Analysis workspace and complete saved report. The producing worker owns the existing native/browser lifecycle; do not start another AnalysisWorkspace or replacement receiving controller.

1. Select the actual original complete report, record its source result and definition, and issue it to the named internal recipient. Download both complete files.
2. Open the actual outgoing HTML at desktop and narrow widths. Inspect each table and its original query/data details. Make real editorial changes, including an unfinished field, then save, close and reopen the actual downloaded HTML and JSON.
3. Complete the wording and download the attributed return. Inspect the returned file and saved edition history.
4. Use the existing report editor to retain an author change before receiving the return. Reconcile an independent change and an overlapping change. If the original case has repeated/reordered query sections, operate the explicit section mapping against those actual definitions.
5. Apply the reviewed values through the original save. Verify the new definition through the original report history and preserve its exact queries, parameters and source selections. Run/publish through the original existing report flow when selected by the case owner.
6. Exercise the original lost-reply continuation at the HTTP response boundary without killing the shared workspace or its scientific jobs. The same retained action must return its accepted saved revision after a later author save. Also inspect an actual rejected current-revision case through the explicit reconcile control.
7. Export the whole native workspace, use the existing single-owner cold receiving route, reopen issue/return/application history and download the original complete recipient again. Keep the full native archive, complete source selection, all outgoing/returned working files and exact observed result together.

A native admission or source compilation is not a rendered product run. Record the actual native handle/output and any concrete error in the original thread. Fix the exact source and continue that same operation.

## Producing-worker rendered product instruction

Before calling this customer-facing editor, report or export ready, the producing worker must open/run/render the exact outgoing version and personally LOOK at the actual screens or real screenshots. Inspect the real desktop/screenshare and narrow/mobile widths, populated/empty/loading/error states, important controls, every downloaded HTML/JSON/report and complete archive receiving. Open the attachments in their normal viewer and operate the saved/reopened result. Screenshot capture alone, source review, DOM counts, HTTP success and a peer approval do not replace seeing the actual product.

Fix clipping, cramped tables, broken controls, lost edits and unreadable layout in the authorized source. Keep plain industrial styling and the actual original workflow. Preserve the exact source/artifact identities, images actually viewed and important operated states with the original case. Keep Bryce's current in-app browser meeting hold; isolated cloud browsers and engineering work remain separate authorized routes. No new watcher, external message, private Git repository or paid Actions run is introduced by this receiving guide.

### Browser storage unavailable

The author’s complete working JSON uses the same 512 MiB limit for saving and reopening. If browser storage fails before an original issue or application is dispatched, save that complete working file and reopen it in this workspace. The page verifies that the exact pending issue/application is present in the reopened file before continuing its original ID. Further changed pending actions require their own saved-and-reopened file. An unavailable browser cache does not discard the open draft or change the native request identity.

### Concurrent browser working copies

Each browser save preserves complete, separately restorable working editions before updating the convenient current selection. The author’s pending requests also have exact content-addressed records under their original IDs, verified before dispatch. A second tab’s save preserves the earlier full edition; a different request body under the same action ID is a visible conflict. Use the complete browser-edition controls to restore a displaced tab’s work, or retain and reopen its working file when browser storage is full. Earlier author comparisons and recipient branches remain accessible in their working-history controls.

## Complete original operating course

The maintained [caller-owned Page course](receiving/REPORT_EDITORIAL_COURSE.md) and [complete module](receiving/report_editorial_course.mjs) operate issuing, unfinished recipient save/reopen, attributed return, concurrent author rejection, accepted-save response loss, later-author preservation and independent received-workspace reopen. They consume the original owner’s actual completed report and existing Pages, retain the same request IDs and full source editions, and keep operation, received-workspace and personal visual inspection completion distinct.
