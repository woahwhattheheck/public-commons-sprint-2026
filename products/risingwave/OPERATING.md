# RisingWave subscription data products

Turn a native RisingWave relation and its subscription into complete retained
editions and versioned customer datasets. One private workbench holds source
and merchant revisions, report definitions, subscription reviews, native
capture progress, complete differences, publisher runs, recurring policy and
customer handoffs. Its browser, CLI and MCP client operate that same state.

The report editor uses the actual catalogue to select visible columns and a
non-null unique key. Initial editions read the native subscription snapshot.
Later editions retain and apply subscription changes to a complete local
mirror before evaluating the report. Large identifiers, decimals, timestamps,
JSON, bytes, NULL and empty text preserve their declared representations.

## Install the selected product

Use Linux, Node 22.16 or newer, Git, npm and util-linux flock. The operating
filesystem must support private regular files, file locks, atomic rename,
hard links and fsync. Keep private state outside the source checkout. Allocate
disk for the full raw mirror, native event log, complete output formats and
retained editions; a report filter does not reduce the raw mirror requirement.

Build one committed source revision through the existing distribution:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo . --ref HEAD --selection risingwave \
  --out /absolute/private/packages/risingwave
~~~

Retain the archive and the SHA-256 returned by that build. The selected product
uses the original installer, runtime workspace, merchant, buyer and release
engines. Its source selection keeps the complete RisingWave component, original
publisher, native dataset loader, browser assets and operating material.

Install the returned source archive:

~~~sh
npm install --ignore-scripts --offline --omit=optional /absolute/path/to/package.tgz
npx --no-install starforge doctor
~~~

The examples below use the installed starforge executable. A local npm
installation can invoke it with npx --no-install starforge. The uninstalled
dispatcher is node stellar/scf-starforge-20261009/distribution/cli.mjs.

Prepare and install the native runtime from that exact archive:

~~~sh
starforge runtime-install prepare \
  --dir /absolute/private/runtimes/risingwave \
  --archive /absolute/path/to/package.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --native --feature risingwave --feature schema --feature openapi --operator

starforge runtime-install install \
  --dir /absolute/private/runtimes/risingwave

starforge runtime-install inspect \
  --dir /absolute/private/runtimes/risingwave --load --source
~~~

The installation retains its dependency selection, source manifest, package
lock and native load result. Open the product when that installation is READY.
Use its existing install/resume and cache options to continue an interrupted
installation. The [runtime installation guide](../../stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md)
describes those original operations.

The RisingWave source selects pg 8.16.3 through the risingwave runtime
feature. Its package lock records the resolved client and transitive packages. The original x402 packages serve published datasets. The
browser, workbench client and dedicated MCP transport use the product's
original Node modules.

## Start the selected native RisingWave runtime

The original receiving operation uses RisingWave 3.1.0. Keep its selected
executable, process owner and private database directory together through
native receiving and installed Applications receiving.

For the original Linux x86_64 runtime, the pinned
[release archive](https://github.com/risingwavelabs/risingwave/releases/download/v3.1.0/risingwave-v3.1.0-x86_64-unknown-linux.tar.gz)
is 201,363,854 bytes with SHA-256
`3e42052148bcd5cf9df076f983005f7164a8ee77d83128ab51e02489c9a7e629`.
Reuse the selected verified executable, and bind its absolute path as
RISINGWAVE_BIN. Set RISINGWAVE_STORE_ROOT, RISINGWAVE_LISTEN_ADDR,
RISINGWAVE_MEMORY_BYTES, RISINGWAVE_PARALLELISM and
RISINGWAVE_COMPACTOR_THREADS from that original receiver's host and runtime
selection. The memory value is the budget for the whole RisingWave process.

The pinned 3.1.0
[single-node argument contract](https://github.com/risingwavelabs/risingwave/blob/45baf6460ea942e4ff57a5aa057d5b8db7f3b563/src/cmd_all/src/single_node.rs)
uses --store-directory, also available through
RW_SINGLE_NODE_STORE_DIRECTORY. Single-node mode is the default when no
subcommand is supplied. Start that selected instance in its owning process:

~~~sh
"$RISINGWAVE_BIN" \
  --store-directory "$RISINGWAVE_STORE_ROOT" \
  --listen-addr "$RISINGWAVE_LISTEN_ADDR" \
  --total-memory-bytes "$RISINGWAVE_MEMORY_BYTES" \
  --parallelism "$RISINGWAVE_PARALLELISM" \
  --compaction-worker-threads-number "$RISINGWAVE_COMPACTOR_THREADS"
~~~

With the default local storage configuration, the selected directory retains
state_store and the SQLite metadata file meta_store/single_node.db. Keep both
with the original operation. The single-node source fixes the internal meta,
dashboard, compute and compactor ports at 5690, 5691, 5688 and 6660;
--listen-addr selects the frontend address. Use the same retained instance
for the native and managed stages.

Keep the original RISINGWAVE_URL in the private environment configuration
and point it at this selected database. The native receiving command selects
its explicit local/TLS options. Closing the native workbench writer hands
that workspace to Applications; the database continues serving the same
source while the managed workbench opens, closes and reopens.

The maintained `risingwave-runtime` command completes the local bootstrap above.
It resumes the pinned archive, verifies the executable, preserves the original
private state/environment and keeps one foreground instance through receiving.
`prepare`, `inspect` and `serve` retain the original configuration and process;
`inspect --connect` checks the actual database through the selected pg driver.
The [complete local runtime guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/risingwave/LOCAL_RUNTIME.md)
contains the exact preparation, host resource selection and interruption workflow.

## Connect to the actual source

Create a private source file containing environment reference names:

~~~json
{
  "schema": "stellar-forge.risingwave-source.v1",
  "connectionStringEnv": "RISINGWAVE_URL",
  "tls": "require",
  "allowLocal": false,
  "maxInFlight": 1,
  "queryTimeoutMs": 30000,
  "queries": {}
}
~~~

Set RISINGWAVE_URL in the launching environment to the intended PostgreSQL
wire connection string. It selects the actual server, database, account and
credentials. Keep that value in the existing private environment configuration.
For a private CA, set caFileEnv to the environment name containing its absolute
certificate-file path. The explicit local-development configuration uses
allowLocal:true and the appropriate tls option.

Discover the live relations before writing a report:

~~~sh
starforge risingwave discover \
  --source /absolute/private/inputs/risingwave-source.json \
  > /absolute/private/inputs/risingwave-catalogue.json
~~~

Use umask 077 when creating operator files by shell redirection. Discovery
includes native relation identities, visible and hidden column inventory,
types, primary keys, current subscriptions, retention and server version.
Optional --options supplies a JSON catalogue selection.

Use the exact relation and subscription names returned for this source.
Existing subscriptions can be selected immediately. A new subscription uses a
separate retained review and creation operation described below.

## Open the private workbench

Start the original foreground server from the READY runtime:

~~~sh
umask 077
starforge runtime-install run \
  --dir /absolute/private/runtimes/risingwave -- \
  risingwave-workspace \
  --state /absolute/private/risingwave-workbench \
  --source /absolute/private/inputs/risingwave-source.json \
  > /absolute/private/risingwave-launch.json
~~~

Open the risingwaveWorkspace URL from the private launch file in a browser on
that host. The listener uses 127.0.0.1 and an automatically selected port. The
URL fragment carries its private access token. CLI and MCP connect through
that same launch file.

After a normal stop, reopen with the same --state directory and omit --source.
Use the launch file from the new process. Saved source revisions, capture IDs,
comparison IDs and publication identities remain in the original workbench.

The Source panel edits connection reference names, source limits and merchant
terms. Saving uses the displayed source revision. If another client saved
first, load its revision and reconcile the draft. Earlier source and merchant
revisions remain available.

## Author a typed report

Select a relation in Source and choose Use in report. The Reports panel
provides the native relation/subscription names, output aliases, native source
columns, output types, unique key, parameter declarations and membership
filters. Save the complete report and source revision before capturing.

A declaration for an actual projects relation can take this form:

~~~json
{
  "relation": {"schema": "public", "name": "projects"},
  "subscription": {"schema": "public", "name": "projects_changes"},
  "key": ["id"],
  "columns": {
    "id": {"column": "project_id", "type": "bigint", "nullable": false},
    "units": {"column": "units", "type": "integer", "nullable": true},
    "description": {"column": "description", "type": "string", "nullable": true}
  },
  "parameters": {
    "minimum": {"type": "integer", "required": false, "nullable": true}
  },
  "filters": [{"column": "units", "op": "gte", "parameter": "minimum"}],
  "probe": {"minimum": 0},
  "maxRows": 100,
  "maxBytes": 1048576
}
~~~

Choose names and types from the actual catalogue; this example is a declaration
shape. Store it under a named source query, such as projects_report. The native
report compiler checks identifiers, visible key fields, compatible filters and
typed parameters.

| Value or control | Representation |
| --- | --- |
| integer | Exact safe JavaScript integer |
| number | Finite numeric value |
| boolean | true or false |
| bigint and decimal | Exact text |
| timestamp, timestamptz, date, time, interval | Native text |
| uuid, json and bytes | Native text |
| NULL | JSON null, distinct from empty text |
| Optional omitted parameter | Its filter is omitted unless a declared default supplies a value |
| Explicit NULL parameter | Native SQL NULL comparison semantics |
| in / notIn parameter | JSON array; exact large values remain quoted strings |

Use the parameter's Nullable option before selecting an explicit NULL value.
Include probe distinguishes an omitted optional probe from an explicitly empty
string. Required parameters include their probe. The execution controls preserve
that same distinction when selecting a preview, capture or publisher plan.

Filter names refer to output aliases. The raw mirror keeps the original native
columns and key before projection or filters. A later source change can therefore
move a row into or out of a report without losing the source row needed to
evaluate that change.

The report's maxRows and maxBytes bound its preview. Complete captures have
their own source-wide budgets. Read the preview's returned count and limit
state before choosing a complete edition.

## Review and create a subscription

Use the Subscriptions panel to inspect the selected report. For a new
subscription, prepare a review with a stable request ID and chosen retention.
The saved review binds the source revision, actual relation identity, intended
subscription, exact statement and retention. Create reviewed subscription
executes or reconciles that original operation.

The source CLI exposes the same native workflow:

~~~sh
starforge risingwave subscription-review \
  --source /absolute/private/inputs/risingwave-source.json \
  --query projects_report \
  --request subscription-projects-initial \
  --retention "1 day" \
  --out /absolute/private/inputs/subscription-review.json

starforge risingwave subscription-create \
  --source /absolute/private/inputs/risingwave-source.json \
  --review /absolute/private/inputs/subscription-review.json \
  --request subscription-projects-initial \
  --directory /absolute/private/subscription-operations/projects
~~~

A repeated request uses its original review and result. If the source relation
or subscription differs from the reviewed identity, load the current native
catalogue and prepare the intended revised operation. Discovery and report
capture use the selected subscription; they do not silently create one.

## Capture complete editions

Select a saved report and its exact execution parameters in Editions. Choose:

| Mode | Behavior |
| --- | --- |
| full | Read a new initial snapshot from the native subscription |
| changes | Continue from the selected complete compatible edition |
| auto | Use the latest compatible complete edition when one exists, otherwise start with the initial snapshot |

Compatibility includes the saved source bytes, report and normalized parameter
selection. An explicit previous edition selects that exact checkpoint. A
changed source revision or report can start a new full edition.

The complete capture defaults are:

| Budget | Default |
| --- | ---: |
| Raw source rows | 1,000,000 |
| Retained event and output bytes | 268,435,456 |
| Bytes per complete raw event or output row | 1,048,576 |
| Native FETCH batch size | 1,000 |
| Native FETCH timeout | 1 second |
| Maximum complete edition duration | 300,000 milliseconds |

The browser displays these as separate row, byte, batch and duration controls.
The original publisher console reads the same native defaults. A row limit
applies to the complete source mirror before report membership filters.

The operation receives a stable capture ID immediately. Keep that ID when
checking progress or continuing after a lost response. Repeating the same
capture ID and selection returns the original record. Its page retains the
native stage, source count, prior edition, checkpoint, error and completed
file identities.

Completion uses the actual native cursor state together with the retained
subscription identity, complete initial snapshot, replayed change epochs and
final materialization. A short or empty FETCH alone does not establish
completion. A FETCH timeout is an individual wait; the edition deadline covers
the entire operation.

The native retention choice is explicit. onGap:error preserves the prior
complete edition and returns the gap. onGap:rebuild authorizes a full rebuild
under the current original capture request and records its rebuild provenance.

Each complete edition contains the entire seven-file set:

| File | Contents |
| --- | --- |
| data.json | Complete typed projected rows |
| data.ndjson | Complete typed rows, one JSON object per line |
| data.csv | Complete canonical CSV with lossless NULL versus empty-text encoding |
| events.ndjson | Retained native event and recovery records |
| checkpoint.json | Complete durable replay boundary and native cursor information |
| state.sqlite | Full retained keyed native mirror |
| capture.json | Complete source, selection, lineage, counts and file manifest |

Individual files can be downloaded in the browser. Keep all seven when moving
a capture that will be reopened or used as the next native base.

## Resume the original operation

Cancel original read stops that capture's current native activity and retains
its request and progress. Resume this edition continues that same capture ID,
directory, saved source, mode, base and budgets.

A change capture resumes from its last durable complete native epoch and
reconciles inclusive replay. An interrupted initial snapshot starts a new FULL
attempt within the same original capture directory while retaining the
previous attempt. Complete native files can also be adopted after the workbench
lost their final response.

~~~sh
starforge risingwave-workbench capture-resume \
  --connection /absolute/private/risingwave-launch.json \
  --capture ORIGINAL_CAPTURE_ID

starforge risingwave-workbench capture-recover \
  --connection /absolute/private/risingwave-launch.json \
  --capture ORIGINAL_CAPTURE_ID
~~~

Use capture-resume for an interrupted read. Use capture-recover to adopt an
already complete retained native file set. Both retain the original request;
they do not select replacement inputs.

For the standalone native CLI, resume takes the original source file and
capture directory:

~~~sh
starforge risingwave resume \
  --source /absolute/private/inputs/risingwave-source.json \
  --directory /absolute/private/captures/original-edition
~~~

## Compare and receive every changed row

Choose two complete editions and their unique key fields. The comparison reads
every retained row, calculates added, removed, changed and unchanged counts,
and writes complete difference streams. The browser displays limited examples
while every difference remains downloadable.

| File | Full contents |
| --- | --- |
| added.ndjson | Key and complete after row for every added record |
| removed.ndjson | Key and complete before row for every removed record |
| changed.ndjson | Key, complete before row and complete after row for every changed record |
| comparison.json | Source edition identities, counts, display examples and full file identities |

The browser limits examples to the selected sample count and an aggregate
1 MiB of row samples. This display bound does not limit the retained streams.
Saved complete differences can be reopened after the browser or workbench
restarts.

A CLI comparison request can retain a stable ID:

~~~json
{
  "comparisonId": "comparison-projects-two-editions",
  "before": "ORIGINAL_BEFORE_CAPTURE_ID",
  "after": "ORIGINAL_AFTER_CAPTURE_ID",
  "keys": ["id"],
  "sampleLimit": 100
}
~~~

~~~sh
starforge risingwave-workbench compare \
  --connection /absolute/private/risingwave-launch.json \
  --input /absolute/private/inputs/comparison.json

starforge risingwave-workbench receive-comparison \
  --connection /absolute/private/risingwave-launch.json \
  --comparison comparison-projects-two-editions \
  --directory /absolute/private/customer-differences
~~~

Receive a complete source edition through the same client:

~~~sh
starforge risingwave-workbench receive \
  --connection /absolute/private/risingwave-launch.json \
  --capture ORIGINAL_CAPTURE_ID \
  --directory /absolute/private/customer-edition
~~~

Receiving retains the original selection and full file hashes. Repeating the
command continues each original partial file from its current byte offset,
verifies the complete files and reopens the complete native capture or
comparison. Use a different directory when intentionally receiving a different
selection. Keep private permissions and the completed receiving directory
together when transferring it onwards.

## Publish a customer data product

Save the merchant's actual public HTTPS origin and complete payment choices in
Source. Every choice retains its network, asset, amount, recipient, timeout and
additional metadata. Then create a product from a saved report and the intended
public resource path.

Open publication and refresh console enters the original publisher for that
product. Prepare a plan from the exact saved source and parameter selection.
Select the output columns, dataset filters, ranges and sorting options, plus
the complete native capture budgets. Exact large and temporal values default
to dataset Text. The native loader distinguishes NULL from quoted empty text.

Extract the plan and read its complete retained candidate. Review that actual
candidate and publish it against the displayed target snapshot and revision.
Publication creates an immutable dataset version. Later source corrections or
scope changes create later editions while the earlier versions remain
available to their original customers.

Configure recurring refresh from a current published run. The original policy
binds that reference run, plan digest, target snapshot and target revision.
Choose its interval, row bounds, maximum permitted drop, error behavior and
reviewer note. Enable or run it through the same original scheduler.

If a refresh response is lost, reopen the retained refresh and use its original
continue operation. Do not substitute a new run ID for the pending publication.
Pause refresh and stop seller preserves the product's history and versions.

Start the seller for a published product. Read the exact offer for a selected
published run, choose the intended payment option, and prepare the customer
request under its original intent ID. The customer URL remains pinned to that
published snapshot even after a second edition becomes current.

## Use the CLI, MCP and Applications

| Command | Work |
| --- | --- |
| starforge risingwave | Native catalogue, typed query, subscription review, capture and recovery |
| starforge risingwave-workspace | Original private browser workbench |
| starforge risingwave-workbench | Same-workbench operations and complete receiving |
| starforge risingwave-publisher | Original standalone publisher and recurring policy |
| starforge risingwave-mcp | MCP client attached to that running workbench |

The workbench provides 32 MCP tools over its original model. They cover source
revisions, catalogue and report compilation, subscription review and creation,
capture progress/cancel/resume/recovery, complete capture and comparison
receiving, publication, seller operation and customer preparation.

~~~json
{
  "command": "starforge",
  "args": [
    "risingwave-mcp",
    "--connection",
    "/absolute/private/risingwave-launch.json"
  ]
}
~~~

Use an executable from the intended installed runtime. Closing the MCP client
leaves the workbench's retained operations with their original owner.

In Runtime Workspace, select the READY installation. Under Applications,
select RisingWave source and dataset publishers and the initialized workbench
directory containing workspace.json. Supply its existing environment reference
values and intended dataset facilitator. Review and save, then use the original
Start, Open, Stop and reopen controls.

Close a separately launched workbench before handing its ownership to
Applications. The application binds its actual source release, native runtime,
workbench identity, saved revisions, merchant terms, publications and buyer
files. The same operating directory reopens under the new launch.

## Native receiving and upgrades

After the native operator completes, run the
[installed Applications continuation](../../stellar/scf-starforge-20261009/sf30-seller-sdk/risingwave/MANAGED_WORKBENCH.md).
It adopts that original workbench, receives both complete captures and every
difference through the selected MCP runtime, downloads both published editions
and the original buyer file, and completes stop and fresh-process reopen.
Keep the original native server and environment references available throughout.

The included [browser continuation](../../stellar/scf-starforge-20261009/sf30-seller-sdk/risingwave/examples/browser-workbench.mjs)
opens both managed launches with the existing Playwright and Chromium runtime.
Pass its absolute installed path with --browser-module. It visits all saved
report mappings and subscription reviews, receives fourteen capture files and
all four comparison files through the visible download controls, opens both
published run panels and the original customer offer, and downloads the saved
source and merchant terms. Each phase retains seven desktop and three mobile
views with the complete original file comparisons. The Applications guide
provides the exact invocation, inherited browser environment and retained
output paths.


The native receiving operator in the
[source guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/risingwave/README.md)
runs against an actual selected RisingWave server. It exercises initial
capture, native changes, interrupted capture continuation, complete receiving,
lossless values, original publication, recurring refresh, pinned customer
versions and a fresh workbench reopen. Retain its complete original case
directory with the source pin and runtime used for that run.

Stop the owning application before backing up the complete private workbench.
Keep its revisions, subscriptions, captures, comparisons, publications,
version stores, policies and customer handoffs together. Keep each separately
received customer edition as well.

For an upgrade, prepare a new runtime from the intended committed archive.
Attach the same operating state through the original Applications workflow.
Preserve the earlier source release and runtime while checking the reopened
operation and its complete retained history.

## References

- [Native source and receiving operator](../../stellar/scf-starforge-20261009/sf30-seller-sdk/risingwave/README.md)
- [Workbench interfaces and retained operations](../../stellar/scf-starforge-20261009/sf30-seller-sdk/risingwave/WORKBENCH.md)
- [Runtime installation](../../stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md)
- [Runtime Workspace and Applications](../../stellar/scf-starforge-20261009/distribution/runtime-workspace/README.md)
- [RisingWave subscriptions](https://docs.risingwave.com/serve/subscription)
- [RisingWave standalone deployment](https://docs.risingwave.com/operate/rw-standalone-mode)

Copyright TokenJunkieLabs. MIT; retained upstream components keep their original
licenses and source identities.
