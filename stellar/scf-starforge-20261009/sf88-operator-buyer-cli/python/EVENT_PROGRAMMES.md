# Event programmes in the customer Analysis browser

This page receives a complete original SF88 subscriber export, maps useful payload
fields and continues the original EventFeedAnalysis programme. It shares the
customer's existing private Analysis server, database, source reader, query
exporter, reports, workbooks and portable workspace archive.

## Open the existing customer workspace

Use Python 3.11 or later, the original installed Analysis package with its workbook
dependencies, and the matching installed Node runtime. The source receiver needs
the original Node 24-or-later SF88 files. The full source-tree default locates
event-feed/analysis-source-cli.mjs next to the Python package's source tree. A
separately installed Python package uses an explicit trusted local source path:

~~~sh
python -m stellar_forge_buyer.analysis_workspace \
  --database /absolute/customer-analysis \
  --event-source-cli /absolute/sf88-operator-buyer-cli/event-feed/analysis-source-cli.mjs \
  --node /absolute/node \
  serve --open
~~~

The sibling analysis-source.mjs must come from the same installed source. Open
**Event programmes** from Analysis navigation. The existing capability in the
private launch URL is carried to this page. This configuration is a local launch
choice; uploaded files and browser requests never select executable source.

The existing workspace owns the process and lock. The event coordinator drains
before Analysis closes its job executor and source/report/workbook/archive clients.
It sequences original native jobs from a separate coordinator thread, so waiting
for a native job does not occupy that job's own single executor. WorldBank,
Research, SQL, report and workbook operations keep their original clients and
revision checks.

## Receive a complete source pair

Select the original events NDJSON and its original .manifest.json produced by the
subscriber export. The allowances match the original complete-document receiver:
32 MiB NDJSON, 4 MiB manifest, at most 100,000 events, and a complete projected JSON
document within 32 MiB. Both files can represent an empty but complete acquired
window. Source identity and every original paid-page record are validated by the
existing Node receiver before review completes.

The browser hashes the whole selected files, records one receiving identity, then
sends 256 KiB exact chunks. Requests remain below the existing Analysis 1 MiB JSON
body allowance. The database retains every accepted chunk with its original
offset/digest. A lost chunk response can repeat the same bytes at the same offset;
different bytes cannot replace that chunk. A stopped browser can select the same
files and resume at the server's recorded byte counts. **Use another source pair**
creates a new receiving identity without changing the earlier input.

The original upload is stored in SQLite, so an original workspace archive taken
during a partial upload also carries its accepted chunks. On the receiver,
reselecting the same original pair supplies only the remaining bytes. There is no
new remote acquisition or paid subscriber operation in this receiving action.

The source-pair and action lists paginate independently. **Latest** resets only
its own list. The input information shows the original file names, exact bytes,
digests and current receiving counts.

## Name the programme and choose fields

Use a programme name beginning with a letter and up to 24 letters, digits or
underscores. A first programme creates its original view, report and workbook.
Existing names are reopened instead of replaced.

All original event identity/timing fields and the complete payload remain in the
table. Add a column name and a JSON Pointer inside the payload for each useful
customer value, for example /contract/id or /amount. Keep the customer's actual
field names and source semantics. The original receiver validates distinct names,
reserved columns and pointer escapes. Each selected field also has a state column
for missing, null and the original JSON kind. Exact numbers already represented
as strings remain text.

**Use accepted field mapping** copies the currently accepted mapping for a later
window. A draft is saved by workspace and programme in this browser; it does not
change the selected source or the accepted customer version. The complete review
records the exact chosen mapping in the original database and source documents.

## Review, apply and preserve customer work

**Review complete source window** creates one retained action and native operation
identity. The original Node source receiver validates both full files, exact
payload hashes, source/store/feed identities, complete page sequence and event
counts. Later cumulative windows must retain earlier events and original pages;
a new event behind the accepted high-water sequence is rejected.

The complete review contains the native imported version, comparison, original
manifest, every projected column, accepted base view and selected current report
and workbook definitions. Read the counts, change summary and complete review;
the displayed sample or summary never replaces the full imported table.

Record the customer's receiving decision, then **Apply reviewed window**. Original
Analysis jobs produce the complete typed event table, spreadsheet-safe CSV,
summary report, published report and workbook. Existing customer notes,
worksheet names, conversions, columns and unrelated source sheets remain under
their original native revision checks. Changed source columns that need a
decision open the complete native worksheet proposal. Supply each affected
worksheet's complete reviewed column array by zero-based worksheet index; the
original workbook validator checks the resulting choices before saving.

A customer can edit their report or workbook through the ordinary Analysis page.
If those edits change an unfinished, already selected event operation, use
**Review current customer edits**, with a reason, before continuing. This retains
the original attempt and reviews the current definitions and views through the
existing refresh_review method.

## Continue a saved action

The browser stores the request identity before sending it. Its saved action has a
programme, operation ID, original file-pair ID or review digest, mapping and
decision. Server actions also remain in the original database.

An application restart marks RUNNING event actions INTERRUPTED; it never silently
replays them. Open an action from **Saved actions**, read the retained request and
result, then choose **Continue original saved action**. A repeated action ID must
have the same full request. Native jobs keep their original IDs and existing
continuation semantics. The same source is revalidated before source work resumes.

Reopening or refreshing a page does not overwrite a newer field edit with a late
response from another programme. The current programme generation and original
action identity guard delayed results. Input receiving and saved customer work
remain separate from a browser's unsent field draft.

## Deliver the complete customer workspace

**Prepare complete delivery** uses a new explicit delivery identity linked to the
accepted event operation. It reuses the original accepted source/review,
publication, workbook and full event export while taking a fresh native workspace
archive. This is useful after the customer changes work or restores an earlier
handover. The new delivery and any earlier delivery keep distinct original
archive requests and immutable bytes.

The full result includes:

- Event_Analysis.xlsx and the original Event_Workbook_Handover.zip.
- Event_Report.html, Event_Report.json and Event_Report_Tables.zip.
- Complete_Event_Table.jsonl, Complete_Event_Table.csv and its native manifest.
- Original_events.ndjson and its original manifest.
- Reviewed_customer_window.json and Customer_programme.json.
- Event_Analysis_Workspace.zip and the original archive manifest.
- Open_and_use.md and Event_Analysis_Delivery.json.

Customer_programme.json comes from the exact SQLite snapshot in that archive.
The manifest identifies the accepted result edition, original accepted operation,
new delivery operation and the programme edition inside the complete workspace
snapshot. This allows an older accepted result to accompany newer saved customer
work without pretending both editions are the same.

The original private server verifies each retained file descriptor before
streaming. The browser independently checks the downloaded file's complete byte
count and SHA-256 before offering it for saving. These are full source files and
native outputs, not rendered excerpts.

Restore Event_Analysis_Workspace.zip with the original archive receiver and its
recorded digest. Open the resulting directory in the ordinary Analysis
application. Sources, programme history, retained file chunks, saved SQL, reports
and workbooks reopen from that original workspace. After restore, select an
accepted operation and prepare a **new** complete delivery: that fresh operation
takes a new archive and does not depend on the sender's old absolute delivery
directory. To receive a later source window, use the same programme and review
the complete later original file pair.

## Composition and source ownership

The new files are event_programmes.py (coordinator and original-file receiving),
event_programmes_http.py (capability-protected routes), and
_analysis_event_programmes_ui.py (packaged browser assets). They are installed as
normal Python package modules. The original event_feed_analysis.py adds optional
delivery_id to its existing deliver method; a CLI --delivery-id makes the new
snapshot selection explicit. Original calls that omit delivery_id retain their
existing same-operation archive behavior.

Shared Analysis changes are additive: optional event_source_cli construction and
launch argument, event manager creation and close/drain, asset/get/post hooks and
one private navigation link. The WorldBank shared composer receives exact
before/after changes so its active intake/programme additions remain joined.

Original Mercury receiving stays in the existing company thread and customer
operation. Its actual retained subscriber export and field mapping supply the
native receiver walkthrough. The meaningful path is one original full export,
review and apply; one saved customer edit; a later original complete window;
complete delivery; original archive restore and fresh linked delivery. Keep the
actual original source identities, paths and output files with that operation.

## Explore the complete original payload before mapping

In **Event programmes**, choose the retained complete source pair and open
**Explore the original payload fields → Inspect complete source**. This reads
the same original NDJSON/manifest through the installed source receiver. It
validates the whole source pair before reporting actual payload paths.

The catalogue covers every event in the selected window. Each JSON Pointer has
present and missing counts and separate null/string/number/boolean/object/array
counts. A path that is absent in an event remains missing; a present JSON null
has its own count. Arrays retain actual index paths. Escaped slash and tilde
keys retain their original JSON Pointer meaning. An empty complete window has
zero paths and zero events; it can still use the accepted customer mapping.

Search paths or kinds, page through the complete catalogue and choose **Use
field**. The suggested output name is editable in the existing mapping table.
Select only fields useful to the agreed customer task. Existing native limits
remain: 100 selected fields, 48-character output names, 2,000-character payload
pointers and distinct names outside the original metadata columns. A longer
discovered path remains visible in the full catalogue; select a useful parent
within the native mapping allowance.

Catalogue examples are short previews, not the field's complete value.
Container examples describe their member count. **Open original values** reads
a page from the exact original event order, showing each event identity,
sequence, type, payload digest and complete selected value. The original native
JSON semantics match the existing projector; exact strings remain exact strings.
Missing and null remain separate. Earlier/later event controls retain the same
source and pointer. Download the complete selected value page or the whole
catalogue, including every source/file identity.

**Download complete mapping** saves the whole selected field list with its
original workspace, input, source edition and both file identities. **Open
selected mapping** accepts that exact original source selection and replaces the
editable field list only after the complete import is read and matched. For a
later useful source window, **Use accepted field mapping** reuses the actual
accepted programme choices. A different input never silently rebinds an imported
mapping. Unsaved browser field work retains the existing draft behavior.

Continue **Review complete source window** and inspect the actual native
review. Inspection and mapping preparation leave acceptance with the existing
explicit review/apply operation. The original source files, programme,
customer report/workbook and payment history retain their identities.

### Original CLI and private API

The same installed source CLI supplies the complete catalogue:

~~~sh
node event-feed/analysis-source-cli.mjs --ndjson ORIGINAL.ndjson --manifest ORIGINAL.manifest.json --inspect-fields true
~~~

Read complete values from original event offset 0:

~~~sh
node event-feed/analysis-source-cli.mjs --ndjson ORIGINAL.ndjson --manifest ORIGINAL.manifest.json --field-values '/amount' --offset 0 --limit 25
~~~

An empty pointer selects the whole payload. Offsets count original events,
including events where the selected path is missing. Select the returned
next_offset to continue; a terminal page has next_offset:null. These source-only
commands return complete JSON to stdout and preserve their original files.

The existing private capability protects GET
/api/event-programmes/inputs/INPUT_ID/fields and POST
/api/event-programmes/inputs/INPUT_ID/inspect. The latter body is
{"pointer":"/amount","offset":0,"limit":25}. Source inspection uses the same
coordinator executor, which is joined on workspace close, and the exact local
receiver code. Browser or agent data cannot choose an executable path.

Whole inspections reject excess capacity instead of omitting paths or events.
The catalogue supports 10,000 distinct paths and a complete 16 MiB response.
Value pages support one to 100 original events and the full existing response
allowance; choose a smaller page when necessary. The original manual mapping
and source files remain available when a source is too broad for discovery.


### Operate the actual explorer and complete returned mapping

In the same original receiving course, open the exact outgoing browser, inspect
its complete source, search a real path, read present/missing/null/mixed-kind
coverage, select and rename useful fields, and open complete original values.
Download the full catalogue, value page and mapping. Reopen each JSON file,
import the same mapping, continue native review/apply, and confirm the actual
customer report/workbook still receives every selected event. Open a complete
empty window and the actual invalid-selection/error state without replacing
the original customer source.

The producer must LOOK at the actual desktop/screenshare and relevant narrow
screens, operate the important controls, and open every outgoing attachment
as its recipient. View captured screenshots and repair concrete layout or
behavior defects in the same source. Source-only execution is separate from
this actual native/rendered course. Return the exact source edition, original
workspace/input/programme IDs, complete downloads and real screens to the
existing receiving owner; preserve the same original operation and deadline.
