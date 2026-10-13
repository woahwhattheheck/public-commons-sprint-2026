# Reopen retained reports and customer feedback from a Study

This continuation uses the original saved scientific edition, Customer review
and selected Study receiving APIs. It introduces no report renderer, review
store, export protocol or replacement queue.

## Original operator journey

Open **Study transfer** in the restored Workspace. Under **Received studies and
original sources**, open the retained Study. Each scientific report has
**Open original report** beside its original PDF, HTML and report-files ZIP.
This opens the exact retained edition in the original Sources scientific-report
view. Its ordered sources, native report artifacts, source identities and
existing **Prepare customer review** control remain available.

The receiving view also lists **Customer reviews and feedback**. Each review
shows the response count captured by the Study receipt and the current retained
count separately. Choose **Open customer review**, **Open response history**,
**Open corrections** or, when retained, **Open engineering handbacks**. These
open the existing Customer review screen and its original controls. Receive a
response, export the review desk or continue an engineering handback through the
existing workflow. Opening a review itself does not create a response or queue
an export.

A retained local scientific-report review also shows **Original scientific
reports** in its normal detail. **Open original report** returns to its precise
saved edition. A report whose source belongs to another project retains its
original contained documents and project attribution; its ID is not used to
open an unrelated local report.

The ordinary Study catalogue has the same original report/review controls.
After **Preview contents**, included report editions and included Customer
reviews can be opened even when they were reached through dependencies instead
of explicit selected roots. Opening these records does not alter the Study
selection, archive title or pending export operation.

## Identity and continuation

The receiving reader starts from the original Study receipt and dependency
closure. `model/report_review_study_receiving.py` calls the existing
`customer_review_study_transfer.verify_receipt`, then projects only reviews
captured in that receipt. Original review/project hashes, retained response
prefixes, handbacks, received packages and reconciliation history remain
validated by their native helper. Later appended responses remain allowed.

The reader returns `customer_reviews` with each original review ID and title,
current disposition, captured/current response counts, response IDs and exact
linked scientific edition identities. Local edition links must resolve to the
original `scientific-report-editions` node. Received report rows also expose
their associated `customer_review_ids`. These fields are read-only views of
existing records.

Original receipts that predate Customer review lineage use the same
`customer_review_lineage` and `report_source_keys` compatibility flags as the
existing archive verifier. They do not acquire new required histories merely
because the receiving application has been updated.

## Application ports

Scientific reports and Customer reviews are existing built-in views. They are
opened through the original app callbacks, not through invented extension IDs:

- `openSavedScientificReport({workspace_key, id})` opens **Sources** and calls
  `sourceReports.openForStudy(value, content)`.
- `openSavedCustomerReview({workspace_key, id, tab?})` opens **Customer reviews**
  and calls `customerReviews.openForStudy(value)`.

The app supplies an `isCurrent` guard to each original target. It binds the
workspace, workspace revision, connection epoch, navigation revision and exact
content element/anchor. The callbacks check the original request before and
after navigation; a reconnect or an A → B → A workspace transition cannot
admit a stale reply. The target controllers additionally check their own mount,
request and detail generations.

The saved-edition target is implemented in the coordinated original
`source_reports.mjs` and `source_report_editions.mjs` successor. A known
edition is read independently of an unrelated source catalogue failure.
Composer title, source order and pending requests are preserved.

The Customer review target validates the exact returned review ID and project.
It reads the original requested tab, including the existing handback/package
endpoints when needed. Allowed tabs are files, requirements, corrections,
history, handbacks, exports and received. It does not call the form opener,
close an unrelated form or replace queued operations. Only the existing
detail dialog is closed for intentional navigation. Current target errors
remain visible; obsolete errors cannot repaint a later view.

`study_report_navigation.mjs` provides the shared retained-record controls
used by the original selector and Received Studies view. The app's
`createExtensionHost` already carries original host callbacks through its
normal host spread; no second host or registry is introduced.

## Complete source adoption

Adopt the complete original source files and all guarded joins from the source
map. Preserve current peer changes in app, selector, Reviews and receiving
reader. The coordinated Sources successor is required: nested
`scientific.openForStudy` and wrapper `sourceReports.openForStudy`, not only
the older source-draft `openForSources` method.

The owned fragment extends the existing Study component with explicit source
paths. It adds no high-level component dependency edge: original component
closure and the original native source families remain in charge. The
cumulative installer admits the new optional helpers and requires their
existing native/host dependencies whenever the corresponding integration is
present.

## Receiving and direct inspection on the existing native operation

Continue the accepted original report/Study receiving course with its real
Workspace and retained IDs. Do not make another report or native model run
merely to exercise these opening controls.

1. Open the exact outgoing application in the equipped browser. Restore the
   existing Study archive through the original receiver and select its
   registered Workspace. Open its retained Study.
2. Open a report that is an included dependency, not only an explicit root.
   Verify the displayed original edition ID and source order against the
   receipt. Literally open its PDF and HTML, download and extract report-files
   ZIP, and inspect the contained scientific artifacts.
3. Open the retained Customer review. Open Files, Response history and
   Corrections. Where actual history exists, inspect its original response,
   assignment and engineering handback records. Download/open the complete
   original review desk or response file using its existing controls.
4. Follow **Open original report** from the review and **Prepare customer
   review** from the saved edition through the original workflow. Preserve an
   unfinished original Sources composer and an unrelated review form while
   testing read-only navigation. Do not create placeholder feedback.
5. Reopen the Workspace and Study, then revisit the same exact edition/review.
   Confirm the original IDs and captured response count remain stable while
   legitimate appended receiving history remains visible.
6. Exercise an actual unavailable source catalogue, a stale request followed by
   another view, reconnect, and workspace change using existing controls. The
   original known report/review must remain independent of an unrelated
   catalogue and no old response may replace the current screen.

The producing peer must personally inspect the exact rendered outgoing version
at desktop/screenshare and a narrow/mobile width. Look at the real screen or
captured screenshots, not only logs. Operate populated, empty, loading and
error states and the important links/downloads/reopen controls. Fix cramped,
clipped, overflowing or unreadable rows and unstyled controls directly.
Capturing screenshots without viewing them is insufficient. Code/DOM/HTTP
checks and peer approval do not replace this visual inspection.

All outgoing attachments count: literally open and use the final report,
PDF, HTML, spreadsheets/maps and original working project; extract archives
and open their contained deliverables. Retain the actual native/browser
receipt and inspected artifact identities in the existing receiving operation.
Do not publish private operator capability URLs.

## Verification limits

The source author's focused V8 exercises use the actual controllers with a
controlled DOM/API. They cover exact IDs, tab selection, mounted-view
lifetimes, stale errors, report links and draft-preserving read behavior.
They do not establish browser layout, Python execution or inspection of the
real customer's reports. Those are completed by the producing native/browser
peer on the same accepted receiving course above.
