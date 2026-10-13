# Acquired event windows in customer Analysis

Receive an original SF88 event-feed export into the existing Analysis workspace,
produce complete typed event tables and an editable workbook, and continue that
same customer programme when a useful later window arrives.

The entrypoint is `stellar-forge-event-analysis`, installed with the existing
Python customer package. It uses the original source-document importer, immutable
SQLite row tables, DatasetChanges, SQL exports, Reports, WorkbookRefresh and
complete workspace archive. Sources, current views, saved definitions, full
results and programme history stay in that same workspace.

## Select the original installed runtime

Use Python 3.11 or newer and the original customer package with its `workbooks`
extra. Select Node 24 or newer from the same source/runtime installation as the
event subscriber. The Python runtime's normal resolve/install/activate flow is
documented in [Python runtime receiving](../../distribution/python-runtime/README.md).
Its package source is this `python` directory; the ordinary source selection
already includes the whole SF88 component and these source files.

A source checkout can install the package with:

```bash
python3 -m venv /private/customer/python
/private/customer/python/bin/python -m pip install '/selected/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python[workbooks]'
```

Use the selected virtual environment's lexical executable path. The receiver
needs the complete source root for its adjacent `event-feed/analysis-source-cli.mjs`
and `analysis-source.mjs`. Those two files have only Node built-in dependencies.
The same source parser is available through the installed distribution command
`starforge buyer-event-analysis-source` and export
`@tokenjunkielabs/starforge-merchant/buyer/event-feed/analysis-source`.

Each receiving command temporarily owns the original Analysis directory. Stop
its private Analysis server before receiving; reopen it afterward. The original
exclusive owner lock protects this sequence.

## 1. Export a complete acquired window

Use the customer's existing SF88 subscription and payment configuration. Continue
its original page operation if collection was interrupted. The subscriber's
`CAUGHT_UP` state identifies a complete captured window.

```bash
starforge buyer-event-feed inspect --dir /private/customer/event-subscription
starforge buyer-event-feed export --dir /private/customer/event-subscription   --out /private/customer/acquired/window-01.ndjson
```

Keep both `window-01.ndjson` and `window-01.ndjson.manifest.json`. An export
destination is bound to one subscriber snapshot; a later collected window gets
a new destination. The manifest selects every NDJSON byte, original feed/store
identity, complete checkpoint and original accepted page.

Each row keeps its source ID and individual event ID. Two events from the same
transaction remain distinct. Filtered sequence gaps keep their original meaning.
Payload SHA-256 follows the subscriber's original UTF-8 `JSON.stringify(payload)`
contract, which is checked in Node before the Python application receives data.

## 2. Choose useful payload fields

Prepare one complete private mapping JSON for the customer's actual projection.
Pointers select the already-acquired event payload. For example:

```json
{
  "schema": "stellar-forge.event-feed-analysis-mapping.v1",
  "fields": [
    {"name": "contract_id", "pointer": "/contractId"},
    {"name": "transaction_hash", "pointer": "/transactionHash"},
    {"name": "event_index", "pointer": "/eventIndex"},
    {"name": "amount_atomic", "pointer": "/amount"},
    {"name": "value_xdr", "pointer": "/valueXdr"}
  ]
}
```

These example pointers are choices to adapt from the customer's actual saved
projection. The parser always retains source/store/feed/revision, sequence,
individual identity, event type, timestamps, source-body/payload digests and
the complete projected payload JSON. Each selected field adds a value column and
a `_state` column distinguishing missing, null, string, number, boolean, object
or array. All scalar representations remain text; exact decimal and XDR strings
stay intact. SQL or the customer's original decoder applies domain meaning
deliberately.

Omitting the mapping retains the complete metadata and payload column. Up to
100 distinct payload fields can be selected. The original NDJSON and projected
JSON each fit the existing source-document capacity of 32 MiB; the manifest is
at most 4 MiB. This programme selects at most 100,000 acquired events per
cumulative customer snapshot. A larger ongoing service should use its agreed
database destination or a deliberately scoped subscriber programme.

## 3. Review the complete receiving result

Choose a stable customer programme name, at most 24 characters. Use the same
name and workspace for subsequent exports from this original subscription.
Choose one 32-character lowercase hexadecimal operation ID and retain it
through review, apply, delivery and interrupted continuation.

```bash
stellar-forge-event-analysis review   --workspace /private/customer/analysis --programme contract_events   --operation-id 7d3f9a1056714cadbf518e28f2d903c1   --ndjson /private/customer/acquired/window-01.ndjson   --manifest /private/customer/acquired/window-01.ndjson.manifest.json   --mapping /private/customer/event-fields.json   --source-cli /selected/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/event-feed/analysis-source-cli.mjs   --node /selected/node/bin/node
```

The command emits progress to stderr and its whole review as JSON to stdout.
The source receiver executes against private copies of the exact selected files
and its exact two source modules. The application retains the originals, full
mapping and receiver source beside the original source document.

Review imports the complete typed table but leaves the selected view unchanged.
For a later cumulative export, it compares every earlier event and paid-page
record, then prepares the original DatasetChanges comparison keyed by
`store_id`, `source_id`, `event_id`. New events must follow the prior complete
sequence boundary. Source/feed/subscriber changes select another programme.

The review names the full source edition, data version, previous view, complete
window comparison, native data comparison, saved report/workbook definitions,
all currently reviewed views and a `review_sha256`. Inspect the useful field
mapping and changes in the original Analysis Sources and Changes interface,
then stop the server before applying.

## 4. Apply that decision and continue existing customer work

```bash
stellar-forge-event-analysis apply   --workspace /private/customer/analysis --programme contract_events   --operation-id 7d3f9a1056714cadbf518e28f2d903c1   --review-sha256 ORIGINAL_REVIEW_SHA256   --note 'Receive the reviewed contract event window for the reconciliation report.'
```

The original native selection activates that complete data version. The first
application creates event-family and source-count SQL recipes, a saved summary
report and a workbook with Events, Event families and Sources sheets.

The Events sheet comes from the original full query exporter. A 100-row query
preview binds its exact SQL and reviewed views, then the exporter reads the
complete selected result into typed JSONL and spreadsheet-safe CSV. Its complete
row count must equal the acquired event count. The summary report uses the
native report engine's normal limits; it does not need to carry the full event
payload inside a report section.

The initial Events worksheet preserves the exact string values. Excel's original
cell and workbook constraints still apply. If the customer's selected payload
is too large for a worksheet cell, retain it in the complete source/table files
and select useful worksheet columns through the original Workbooks editor.

Later applications preserve the customer's saved report definition, worksheet
names, notes, conversions and column choices. Only worksheets following this
programme's exact previously selected event export or its original report
lineage advance. Other saved worksheet sources stay selected. Moved report
sections follow their saved query identity where it is unique.

When a changed payload mapping removes a selected worksheet column, apply
returns `WORKBOOK_COLUMN_CHOICES_REQUIRED` with the full old columns and new
source. Supply a JSON object mapping the zero-based worksheet index to its
complete reviewed column array, and repeat the same apply command with
`--columns /private/customer/reviewed-columns.json`. Keep intended columns,
headers, source positions and conversion/null policies together.

The native WorkbookRefresh review retains predecessor definitions and their
complete sources. Its next workbook contains both the selected current result
and the original refresh history.

## 5. Continue an interruption or a customer's concurrent edit

Repeat the same command with its original operation ID and input choices.
Completed original jobs and saved requests are reused. If a native job is
interrupted, failed or cancelled, inspect its actual error and use `--resume`
after correcting the cause. The original complete archive continues its same
snapshot; other terminal job attempts retain their history.

If a customer edited a report or workbook after a source was selected but before
the whole operation finished, keep those changes. Once the original source
activation is retained, explicitly refresh the current customer review:

```bash
stellar-forge-event-analysis refresh-review   --workspace /private/customer/analysis --programme contract_events   --operation-id 7d3f9a1056714cadbf518e28f2d903c1   --review-sha256 PREVIOUS_REVIEW_SHA256   --note 'Use the receiving engineer’s revised worksheet and report definitions.'
```

This records the previous complete review, jobs, publication and workbook-save
request, then returns a new review digest selecting the current definitions and
views. Apply that digest with a matching decision note. Earlier complete outputs
remain available in their original native history.

A removed report query or deliberately changed worksheet lineage is chosen in
the original Reports/Workbooks interface before refreshing the review. Current
source-view changes are surfaced explicitly. The programme never guesses a
replacement for the customer's different data selection.

```bash
stellar-forge-event-analysis status   --workspace /private/customer/analysis --programme contract_events
stellar-forge-event-analysis serve --workspace /private/customer/analysis --port 0
```

The private launch address opens the existing Analysis application. Use Sources,
SQL, Changes, Reports and Workbooks to work with the original retained records.

## 6. Deliver the whole customer result

```bash
stellar-forge-event-analysis deliver   --workspace /private/customer/analysis --programme contract_events   --operation-id 7d3f9a1056714cadbf518e28f2d903c1   --destination /private/customer/deliveries/window-01
```

The destination receives all of these complete files:

| Output | Customer use |
| --- | --- |
| Event_Analysis.xlsx and Event_Workbook_Handover.zip | Reviewed workbook, complete native source records and predecessor definitions. |
| Event_Report.html, Event_Report.json and Event_Report_Tables.zip | The selected published summary/report and its complete section tables. |
| Complete_Event_Table.jsonl, Complete_Event_Table.csv and Complete_Event_Table_Manifest.json | Every acquired event in the original typed query export. |
| Original_events.ndjson and its manifest | Exact acquired subscriber output, page records and source identities. |
| Reviewed_customer_window.json | The exact source and customer decision selected for that result. |
| Customer_programme.json | Programme state extracted from the delivered archive's exact SQLite snapshot. |
| Event_Analysis_Workspace.zip and its manifest | Original whole Analysis database, retained sources and native result files. |
| Open_and_use.md and Event_Analysis_Delivery.json | Receiving instructions, both edition identities and complete file hashes. |

A delivery is selected once from its original native outputs and complete archive.
Replaying it into the same or another destination reuses that plan. If an older
result is first delivered after the programme advanced, its full workspace
snapshot includes that newer work as well as the original selected result.
The delivery manifest identifies the selected result edition and the actual
workspace programme edition separately; Customer_programme.json comes from
that same archive, so the recipient sees a coherent complete workspace.

The final sender delivery journal is written after the database snapshot.
The archive already retains the applied programme and all original source,
report, workbook and export records. The receiving engineer continues that
accepted programme through a new operation for a useful later source window.

## 7. Receive and independently operate

Transfer the complete private delivery directory using the customer's existing
authorized route. Receive the original workspace archive into a new receiving
directory with its actual SHA-256:

```bash
stellar-forge-event-analysis receive   --archive /private/received/window-01/Event_Analysis_Workspace.zip   --sha256 WORKSPACE_ARCHIVE_SHA256   --workspace /private/customer/received-analysis   --operation-id e13208f4de694f08a2c6b04972d50ac3

stellar-forge-event-analysis serve --workspace /private/customer/received-analysis --port 0
```

The original archive receiver checks every member and recreates the original
workspace identity with a fresh private launch capability. Its same-operation
reopen preserves later customer edits. Select another receiving directory for
a different complete archive.

Have the receiving engineer open the selected report/workbook, inspect exact
event values and earlier source editions, save one useful report or worksheet
change, close/reopen the application, and review the next acquired subscriber
export through the same programme. Record those actual customer results in
the original installation/workshare.

For Mercury, this analytical delivery joins the original Mercury event/feed case.
Source acquisition, provider credentials, signed publisher state, paid subscriber
operations and company communication retain their existing owners. The customer
Analysis package contains the acquired projection and its downstream work.
Read [Webhook commissioning](../../../../products/webhook-feed/COMMISSIONING.md)
for the original authority, page economics, customer handover and SCF allocation.

## Complete source and native interfaces

- [Original subscriber and export](../event-feed/README.md).
- [Original Analysis application](PYTHON_ANALYSIS.md).
- [Source validator/projector](../event-feed/analysis-source.mjs).
- [File receiver](../event-feed/analysis-source-cli.mjs).
- [Native programme](stellar_forge_buyer/event_feed_analysis.py).
- [Native complete workspace handover](../WORKSPACE_ARCHIVES.md).

The source-document parser checks original file identity and full event/page
history. The application uses native view revisions, report publication IDs,
workbook refresh reviews and the existing archive receiver for continuity.

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
