# QuestDB merchant workbench

The workbench joins native time-series reports, full source captures, correction
review and original versioned dataset publication in one private application.
Its browser, CLI and MCP clients operate the same running workbench. Receiving
downloads the complete selected capture into a new private directory and
reopens it without another database query.

Use Linux, Node 22.16 or newer, and util-linux flock. The complete merchant
application uses the maintained Starforge runtime and its installed x402
dependencies. The QuestDB HTTP source itself uses Node built-ins.

The [native source guide](README.md) defines connection configuration, typed
parameters, time windows, SAMPLE BY, keyed ASOF, exact native types, file
formats and extraction limits.

## Install and open

The source-owned distribution contribution registers these commands:

| Command | Operation |
| --- | --- |
| questdb | Inspect a source, discover tables, run named reports, capture and reopen editions |
| questdb-workspace | Start the complete browser and retained product services |
| questdb-workbench | Use the running browser's operations and receive complete captures |
| questdb-publisher | Operate a standalone original publisher directory |
| questdb-mcp | Connect an MCP stdio client to the original running workbench |

With a source checkout, invoke the corresponding Node entry point below
questdb/. Installed commands use the same source.

Create a private source file using the schema in the native source guide.
Environment references are names such as QUESTDB_HTTP_URL; resolved endpoint
credentials stay in the launching environment. A queryless source can discover
the server before reports are saved.

Start one workbench:

~~~sh
umask 077
questdb-workspace \
  --state /absolute/questdb-workbench \
  --source /absolute/questdb-source.json \
  > /absolute/questdb-launch.json
~~~

The private launch file contains the local URL and access fragment under
questdbWorkspace. Open that URL in the browser. Reopening the existing
workbench uses the same --state directory and omits the import --source and
--merchant options. Imported files are retained as the first immutable
revision; subsequent source and terms changes create later revisions.

The browser listens on 127.0.0.1 with an automatically selected port. Its full
URL is a local capability. Keep the launch file private. A stopped workbench
gets a new listener URL when reopened; use that newly printed connection file
for its CLI and MCP clients.

A source connection is reused within each saved revision. Saving and selecting
a new revision opens and checks its own native query types. The workbench
holds one original workspace lease and closes its owned native requests and
product services before releasing that lease.

## Source, terms and saved revisions

The Source panel edits the endpoint environment reference, authentication
references, local connection choice and native concurrency. Discovery shows
actual table metadata, designated timestamps, types and partition information.
The complete returned metadata stays available in the expandable result.

Merchant terms can be added before creating a product. They contain the public
HTTPS origin, service name, description, tags and either one payment or the
complete paymentOptions array. Each payment choice retains its original
scheme, network, asset, exact amount, recipient, timeout and any additional
supported fields. The advanced terms JSON preserves fields beyond the table's
visible columns.

Saving uses the displayed expected revision. Another client's intervening save
causes a revision conflict; reload that revision and reconcile the draft.
History can load an earlier revision as a new draft without replacing its
original saved files.

The Source JSON panel supports complete reviewed declarations, including named
raw SQL. Applying JSON updates the draft; Save source records it. A saved raw
SQL declaration is displayed intact in Reports, with its full parameter inputs.
Edit that declaration in Source JSON. New report creates a separate structured
report.

## Reports and exact parameter values

Choose a time window, sample/aggregate, or keyed ASOF report.

- A window selects its inclusive start and exclusive end and keeps the declared
  timestamp precision. Existing custom start/end parameter names survive the
  form's save/reopen cycle.
- Sampling uses the native interval, keys, aggregates, fill and alignment.
  Each aggregate is entered as alias=function(column), one per line; count()
  accepts an empty argument.
- ASOF reports retain explicit left and right timestamp columns, join keys,
  right-side filters and native tolerance. Use alias=right.column for projected
  right-side fields. Top-level filters select the left side.

Additional parameters and filters use the declaration shapes in the source
guide. Enter all required parameter values, including the window endpoints,
before saving a structured report. Those values become its startup probe.
The values currently shown are used for preview or capture; changing execution
inputs does not rewrite the saved report.

Show compiled query uses the actual source compiler. Save report records the
compiled SQL and original builder metadata together as one source revision.
Unsaved report edits must be saved or explicitly replaced before another
report is selected.

Preview returns the selected native result, total count and truncation state.
A preview defaults to 100 rows and 1 MiB. Complete capture has its own
independent row, byte and time limits; a small preview limit does not silently
limit the retained edition.

## Complete capture and correction review

Capture complete edition starts one retained operation and returns its capture
ID. The Captures panel displays its status while the original request
continues. Every native edition has exact JSON, typed NDJSON, canonical CSV
and a completed manifest. Optional native CSV preserves a separate /exp
response and its comparison metadata.

SQL NULL is retained as null in NDJSON. In canonical CSV, unquoted empty means
NULL and quoted empty means an empty string. Exact LONG, DECIMAL and
microsecond/nanosecond values remain text through the source and publication
path. Use suitable numeric columns only when conversion preserves the exact
source value.

Default full limits are 1,000,000 rows and 64 MiB per representation. Plan disk
for JSON, NDJSON and CSV independently, plus a fourth representation when
native CSV is requested and the separate publisher candidate when extracting
a product. Complete captures fail if the native reported count exceeds the
returned rows or a representation exceeds its reviewed limit.

Downloads read the existing complete files. Selecting two captures compares
every retained NDJSON row with a disk-backed index. Unique identity fields
report added, removed, changed and unchanged rows. Without keys, the comparison
uses ordered row positions. The result includes both source hashes, original
inputs, full counts and the first displayed differences. The full captured
files remain available independently of the displayed difference sample.

A different time window can represent new coverage rather than a correction.
The comparison explicitly reports whether the named report and input selection
match, while retaining both source identities for interpretation.

### Original operation recovery

Use a stable captureId for a programmatic capture. Repeating the same ID with
the same revision, query, normalized input and extraction options returns the
original record. Different inputs under that ID are rejected.

After a lost response, read that capture's status. Workbench restart marks a
previously active capture INTERRUPTED. Recover completed native files checks
the original local manifest and files and reattaches a completed native
capture. It does not execute the query again. A failed partial native request
stays with its original capture; a deliberately new native attempt gets a new
capture ID.

Cancel targets the named original native request. Closing a CLI or MCP client
does not close the workbench or replace its captures and publisher runs.

## Receive a complete edition

Use the same original connection and capture ID:

~~~sh
questdb-workbench receive \
  --connection /absolute/questdb-launch.json \
  --capture capture-RETAINED-ID \
  --directory /absolute/customer-edition
~~~

The directory receives response.json, rows.ndjson, data.csv, capture.json and
native.csv when selected. receiving.json binds the original capture, source
hash and exact file descriptors. Transfer reads complete byte ranges,
continues each original partial file from its actual size, checks the full
SHA-256 and byte count, then publishes the final file.

Reopen the same command and directory after interruption. Already completed
files are verified and reused. Selecting another capture requires another
destination directory. The final operation calls readQuestDbCapture on the
received files, so the native capture is independently usable without the
source endpoint.

Individual MCP file ranges contain base64, offset, byte count, total size,
nextOffset and the full original file hash. Continue until nextOffset is null.
A range is a transport segment of one retained file; it is not a new database
result page.

## Original dataset publication

Create dataset publication binds one saved report, merchant revision and
public resource path. Each product gets the original publisher, version store,
schedule and buyer handoff. Open publication and refresh console to operate it.

The complete sequence is:

1. Select the named source report, review its typed input values and expose
   the intended dataset columns.
2. Save an extraction plan. The QuestDB console uses the saved source query's
   native order and startup probe values. It supports the optional separate
   native CSV export. Text columns preserve exact values and NULL/empty
   distinctions.
3. Extract the plan. One complete native capture feeds the original candidate
   writer. Inspect its full source identity, row counts, candidate and preview.
4. Review the candidate against the current target snapshot/revision, or
   choose initialization for a new target.
5. Publish that reviewed candidate into the original version store.
6. Start the original seller and read its complete snapshot-pinned offer.
   Select a payment option, retain the original intent ID and prepare the
   customer request.

Publication, seller reads and buyer handoff reuse the retained dataset rather
than rerunning the database query. The original seller's state remains tied to
its immutable snapshot. Reopening the workbench restores saved seller intent
and the same products; a startup error is displayed with that product.

Recurring policies use the original publisher scheduler. Save, enable, pause,
run now and continue operate its retained revision and original native run.
A fixed query window stays fixed; update the source or reviewed input policy
when a new intended time selection is required. Closing the workbench stops
its local services; saved recurrence resumes through the same retained product.

The QuestDB publisher's standalone template command creates a valid plan with
the selected query's typed probe input and native extraction options:

~~~sh
questdb-publisher template \
  --workspace /absolute/original-questdb-publisher \
  --query executions \
  --out /absolute/reviewed-plan.json
~~~

A standalone publisher CLI owns that publisher directory while running.
Use questdb-workbench product operations when the browser already owns the
product, so both clients share the original writer.

The shared CSV loader's explicit nullEncoding: "unquoted-empty" contract is
saved in QuestDB dataset configurations and included in their identity.
Existing CSV datasets retain their earlier default parsing and identities.

## CLI operation

Every workbench command accepts --connection PRIVATE_LAUNCH.json; alternatively
set QUESTDB_WORKSPACE_URL to the full original local URL. JSON input files
provide complete bodies and optional --out NEW.json retains the full result.

| Workbench command | JSON input or selection |
| --- | --- |
| status / revision | Optional selected revision |
| save | expectedRevision, source, merchant |
| compile | The structured report itself |
| discover | expectedRevision and optional tables |
| preview | expectedRevision, query, input |
| capture | expectedRevision, query, input, stable captureId; optional extraction and includeNativeCsv |
| captures | --limit and --offset |
| capture-status / capture-cancel / capture-recover | --capture |
| compare | before, after; optional keys and sampleLimit |
| product-create | expectedRevision, query, public path |
| product-status | --product |
| product | --product, --action and optional --input |
| seller-start / seller-stop | --product |
| run / buyer-offer | --product and --run; buyer-offer accepts --query |
| buyer-prepare | --product and full original buyer input |
| receive | --capture and --directory |

Product actions are source, plan, plan/save, extract, extract/start, cancel,
review, publish, recover, schedule/status, schedule/save, schedule/enable,
schedule/pause, schedule/run and schedule/continue. The original API defines
each action's plan/run/review IDs and required expected target values.

extract/start returns the original run ID immediately. extract,
schedule/run and schedule/continue wait for the same original operation.
Read product status after an interrupted wait before selecting another action.

## MCP client

Configure an MCP stdio host with the installed command:

~~~json
{
  "command": "questdb-mcp",
  "args": ["--connection", "/absolute/questdb-launch.json"]
}
~~~

The original maintained stdio transport handles initialization, IDs,
notifications, cancellation and concurrent requests. stdout contains protocol
messages; operational diagnostics use stderr. The MCP adapter connects to the
running workbench and drains only its own transport when closed.

The 22 tools cover source status and revisions, save/compile/discovery/preview,
capture start/list/status/cancel/recover/file ranges/comparison/receiving,
publication creation/status/actions, seller start/stop, candidate inspection
and buyer offer/preparation. Their complete input schemas are returned by
tools/list.

Resources expose questdb://workspace/status and questdb://workspace/guide.
Templates expose original captures, publications and saved revisions.
tools/call uses the same model methods as the browser. File receiving and
comparison keep their original capture IDs. A cancelled client wait leaves
the native product operation available through its retained status.

## Managed Applications

The installed Applications catalogue includes QuestDB source and dataset
publishers. Select the initialized workbench directory containing workspace.json.
The provider prepares the original command, source release, installed runtime,
environment references and current workspace binding.

Review and save that application, then use its original Start, Open, Stop and
reopen operations. It reads the actual printed local URL and original
workbench/product identities. Source release and installed runtime checks
include the QuestDB modules, shared NULL-aware dataset loader, original
publisher UI and maintained MCP transport. Merchant choices, publication
source revisions, seller intent and retained buyer requests stay attached to
their original workbench.

An explicitly chosen original local facilitator uses
--dataset-facilitator http://127.0.0.1:PORT together with
--allow-local-dataset-facilitator. Production facilitator configuration uses
its actual HTTPS URL and the maintained merchant runtime.

## Retention

Back up the complete private workbench after closing it, including revisions,
captures, comparisons, publications, version stores, schedules and buyer files.
Also retain separately received customer edition directories. Restore each
original directory with its private permissions before reopening the owning
application. Source declarations retain connection references, while runtime
credentials remain in the authorized environment.
