# Eurostat economic editions

Use the Eurostat workspace to acquire an official statistical response, review its
dimensions and reuse terms, publish a selected economic edition, and deliver the
complete purchased dataset with its original source. The browser, typed client,
command line and 26 Eurostat MCP tools operate the same saved project.

The maintained workflow keeps the original JSON-stat response, exact numeric
tokens, geography and time categories, missing-value states, observation flags,
query review, publication, merchant release and customer delivery together.
Monthly reports compare the same categories in the selected month and the same
month one year earlier. The report includes every selected observation.

## Choose an entry point

| Work | Entry point | Saved result |
| --- | --- | --- |
| Review and publish an economic edition | **Applications → Eurostat economic editions**, or `starforge eurostat serve` | One Eurostat project and its original publisher |
| Acquire official data | Browser source acquisition, `eurostat acquire`, or `eurostat_acquire` | Original request, returned response and capture |
| Open an existing source handover | Browser source import or `eurostat import-handover` | Complete source bytes and reviewed queries |
| Prepare an economic briefing | Browser briefing download or `eurostat briefing` | HTML, JSON, CSV and original JSON-stat response |
| Publish and operate the merchant | Original publisher actions and `eurostat release-*` | Retained candidate, review, dataset version and SF82 release |
| Receive the native purchased dataset | `eurostat receive` | Original SF88 pages, finalized accounting, SF100 delivery and source companions |
| Operate an open project from an agent | `eurostat mcp --origin LOCAL_ORIGIN` | The same project through 26 standard MCP tools |
| Integrate an application | `@tokenjunkielabs/starforge-merchant/seller/eurostat/client` | Typed requests to that same local listener |

The original product contracts are in the
[source README](../../stellar/scf-starforge-20261009/sf30-seller-sdk/eurostat/README.md),
[source acquisition and reuse guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/eurostat/SOURCE.md),
and [native receiving guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/eurostat/RECEIVING.md).
This guide connects those complete original operations to the installed Merchant
Workspace. Before installation, substitute
`node stellar/scf-starforge-20261009/distribution/cli.mjs` for `starforge`.
Original source guides that spell the dispatcher `stellar-forge` use the same
`eurostat` command; the installed executable in this product is `starforge`.

## Install the complete product

Use Linux, Node.js 24 LTS, Git and util-linux `flock`. Store operating projects on
a filesystem with file locks, atomic rename and fsync. The source-review and
briefing modules use Node's built-in facilities. The complete merchant/customer
workflow adds the maintained native Stellar and selected schema, OpenAPI and MCP
runtime dependencies.

From a checkout containing the intended original commit:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-workspace --ref ORIGINAL_COMMIT \
  --selection eurostat --out /absolute/releases/eurostat

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /srv/starforge/runtimes/eurostat \
  --archive /absolute/releases/eurostat/ORIGINAL_ARCHIVE.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /srv/starforge/runtimes/eurostat

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /srv/starforge/runtimes/eurostat --load --source

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
  --dir /srv/starforge/runtimes/eurostat -- registrations --source eurostat
~~~

Use the selected runtime for the subsequent commands in this same terminal:

~~~sh
starforge() {
  node /absolute/merchant-workspace/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs \
    run --dir /srv/starforge/runtimes/eurostat -- "$@"
}
~~~

Keep the original toolkit at the absolute path selected above. The function
dispatches each command through the installed product and its retained runtime.

Replace the commit with its full 40-character SHA and use the archive path and
SHA-256 returned by the builder. The recipe retains the complete Eurostat
component, original publisher UI, browser assets, native seller and buyer, release
operations, source data examples and installed product guide. It also retains the
shared merchant discovery, publisher, facilitator and receiving providers.
The Eurostat agent protocol is the product's own `eurostat mcp` command.

The selected archive identifies its original recipe and source revision in its
manifest. The runtime installer retains the actual dependency profile, lock,
installation progress and native readiness. Use its existing `--adopt-existing`
route when an already installed dependency tree satisfies that profile and lock.
See [runtime installation](../../stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md)
and [source selections](../../stellar/scf-starforge-20261009/distribution/SOURCE_SELECTIONS.md).

Continue an interrupted build in its original output directory:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-workspace --out /absolute/releases/eurostat --resume

node stellar/scf-starforge-20261009/distribution/build.mjs \
  --out /absolute/releases/eurostat --status
~~~

The saved selection and original source commit remain attached to that output.
A new source revision or different selection uses a separate release directory.
The maintained `runtime-install-cli.mjs run --dir RUNTIME -- COMMAND` dispatcher
runs each command from the selected original runtime.

## Open the saved project

Create a project and start its listener:

~~~sh
starforge eurostat init --workspace /srv/starforge/projects/eurostat

starforge eurostat serve \
  --workspace /srv/starforge/projects/eurostat --port 8468
~~~

Open the URL printed by the running command. The project owns `project.json`,
`source.json`, its source captures, original publisher and dataset version store.
The default dataset store is inside the project; an existing original dataset can
be selected with `--state /absolute/existing-dataset` during initialization.

The **Applications** entry exposes the same project directory, create option,
dataset state and optional seller/resource binding. Register the READY runtime in
the Runtime workspace, choose **Eurostat economic editions**, review the prepared
application, save it, start it, and open its observed URL. Stop and reopen it
through the same saved application record. If a seller binding is supplied,
provide both its local seller origin and the existing public HTTPS resource.

The browser server owns the project's original publisher lease and scheduler.
When switching from the browser to a command that opens that project, close the
listener first. Agents using the HTTP client or MCP can continue through the
already running listener.

## Receive the included official economic source

The committed example contains the complete official UNE_RT_M response retrieved
on 12 October 2026. Its selected observation interval is January 2024 through
December 2025. It contains 576 observations across 24 monthly series: Germany,
Spain, France and Italy; total and under-25 age groups; total, female and male
sex categories; seasonally adjusted percentages of the labour force.

The original response and complete reviewed handover are retained under
`sf30-seller-sdk/eurostat/examples/`. Import the source handover into the intended
project:

~~~sh
starforge eurostat import-handover \
  --workspace /srv/starforge/projects/eurostat \
  --file /absolute/merchant-workspace/stellar/scf-starforge-20261009/sf30-seller-sdk/eurostat/examples/reviewed-source-handover.json

starforge eurostat project-status \
  --workspace /srv/starforge/projects/eurostat

starforge eurostat serve \
  --workspace /srv/starforge/projects/eurostat --port 8468
~~~

In an installed archive, the same examples remain under its `source/` directory
with those original relative paths. Source handover import keeps identical
existing captures and queries. A conflicting saved query needs a distinct
explicit name; it cannot silently replace another selection.

For a fresh official acquisition, use the browser's source form or a complete
request JSON with `eurostat acquire --workspace PROJECT --input REQUEST.json`.
The original
[request example](../../stellar/scf-starforge-20261009/sf30-seller-sdk/eurostat/examples/source-query.json)
shows the exact dataset code, language, repeated dimensions, time filters and
operation ID. A new acquisition should use its own intended operation ID. Resume
an existing asynchronous response by continuing that original acquisition with
its retained identifier.

The source adapter retains every original returned response and retrieval record.
An official warning that data are being prepared remains attached to that
acquisition; its explicit continuation performs the subsequent official read.
A completed acquisition reopens its retained capture.

## Review dimensions and prepare an edition

Review the original dimension codes and labels before selecting a query. The
browser displays the complete capture metadata, paged cells, raw-response
download, selected categories and source comparison.

Each saved query binds one capture, its selected dimensions, whether to include
missing observations, and the operator's source/reuse review. Review contains the
reviewer, note, intended use, rights basis, attribution, exact selected geography
codes and adaptation notice. Read the source-specific references retained with
the official response and the
[source guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/eurostat/SOURCE.md)
when preparing a new selection.

The example handover already contains its original reviewed `unemployment`
query. For a different query, get the current source hash from the same project,
review the source in the browser, and save the exact selection. A stale hash
causes the original source-review conflict response; reload the current source
before deciding on the revised selection.

The publisher keeps the source's numeric spelling as text. It retains an
observation's `VALUE`, `NULL` or `ABSENT` state separately, and retains the
original global, present, null or absent status. Original category codes and
labels are separate columns. `cell_index` is the source's original numeric cell
position and provides a deterministic tie-break.

Build a full original dataset plan from the saved query:

~~~sh
install -d -m 700 /srv/starforge/plans
starforge eurostat template \
  --workspace /srv/starforge/projects/eurostat \
  --query unemployment --out /srv/starforge/plans/eurostat-unemployment.json

starforge eurostat publisher-help
~~~

Use the existing publisher's `save`, `extract`, `inspect`, `review`, `publish`
and `recover` actions with that project. The browser exposes the same plan,
candidate preview and publication review. The plan chooses columns, filters,
sorts, page limits and extraction capacity. Preserve the declared lossless column
types when exposing values and status fields.

Save the plan, start its extraction and retain the returned run UUID. Inspect the
complete candidate, review it against the current target dataset and publish
using the returned `review.id`. An interrupted publication is reconciled through
`recover` on that original run. The dataset version store, candidate and
publication history remain the common publisher's records.

Schedules reopen the same immutable source query. To publish a new provider
edition, acquire and review the new capture and save its explicit query/plan
before selecting it for the next scheduled publication.

## Produce and use the complete briefing

Export the included source's complete briefing:

~~~sh
starforge eurostat briefing \
  --workspace /srv/starforge/projects/eurostat \
  --id d233dffca23950f40743535de9b76b98c3a9c25b0ad0e32610d691e750a09727 \
  --query unemployment --out /srv/starforge/reports/eurostat-unemployment-2025
~~~

The output directory contains these four original files:

| File | Contents |
| --- | --- |
| `briefing.html` | Printable economic comparisons, source/reuse review, every selected observation and original metadata |
| `briefing.json` | Complete structured report, every selected cell and all series comparisons |
| `observations.csv` | Complete lossless values, category codes/labels and original status states |
| `original-response.json` | Exact original JSON-stat response |

For the included response, the December 2025 series with age `TOTAL` and sex `T`
are 3.9 for Germany, 10.2 for Spain, 8.0 for France and 5.7 for Italy. Their
changes from December 2024 are +0.4, −0.6, +0.7 and −0.7 percentage points.
The original report computes decimal differences directly from the source
tokens. Every comparison preserves the other dimension categories and carries
both observations' status fields. These values describe the selected December
2025 observations.

The committed
[complete briefing](../../stellar/scf-starforge-20261009/sf30-seller-sdk/eurostat/examples/briefing-20261012/briefing.html)
and its adjoining JSON/CSV/response contain all 576 observations and 24 series.
The original pure model/report implementation reproduces those three complete
report files from the retained source and saved review.

To compare source editions, select the original before and after capture IDs in
the browser or `eurostat compare`. The comparison follows full dimension
coordinates and reports changed, added and removed selections, source update
times and metadata differences. Follow its returned page offset for the complete
change list.

## Operate through the typed client and MCP

The typed client opens the already running local listener:

~~~js
import { createEurostatClient } from
  '@tokenjunkielabs/starforge-merchant/seller/eurostat/client';

const eurostat = createEurostatClient({ origin: 'http://127.0.0.1:8468' });
const status = await eurostat.status();
const source = await eurostat.source();
~~~

Use a loopback HTTP origin without a path, credentials, query or fragment.
The client accepts `127.0.0.1`, `localhost` and the IPv6 loopback address.
Its calls share the browser's source captures, saved queries, publisher
revisions, extraction UUIDs and release inputs.

Configure an MCP client to launch:

~~~sh
starforge eurostat mcp --origin http://127.0.0.1:8468
~~~

For an MCP client that launches a subprocess, select the executable and argument
vector explicitly:

~~~json
{
  "command": "node",
  "args": [
    "/absolute/merchant-workspace/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs",
    "run",
    "--dir",
    "/srv/starforge/runtimes/eurostat",
    "--",
    "eurostat",
    "mcp",
    "--origin",
    "http://127.0.0.1:8468"
  ]
}
~~~

Keep the original browser/server process running. This process opens the selected
runtime directly and uses standard newline-delimited stdio with the same typed
client.

| Area | MCP tools |
| --- | --- |
| Source and analysis | `eurostat_status`, `eurostat_source`, `eurostat_capture`, `eurostat_cells`, `eurostat_compare`, `eurostat_briefing`, `eurostat_original_response` |
| Acquisition and saved queries | `eurostat_acquire`, `eurostat_acquisition`, `eurostat_import`, `eurostat_save_query` |
| Native publication | `eurostat_plan_template`, `eurostat_save_plan`, `eurostat_extract`, `eurostat_inspect`, `eurostat_cancel`, `eurostat_review`, `eurostat_publish`, `eurostat_recover` |
| Customer selection | `eurostat_buyer_offer`, `eurostat_prepare_buyer` |
| Source handover | `eurostat_export_sources`, `eurostat_import_sources` |
| Merchant release | `eurostat_prepare_release`, `eurostat_stage_release`, `eurostat_activate_release` |

Retain returned operation IDs and publication review IDs when calling later
actions. Cancelling an HTTP/MCP wait does not turn an already dispatched publisher
operation into a new operation; inspect the saved project to continue it.

The selected package also exports the original source model, workspace,
publisher, release and complete native receiving modules under
`./seller/eurostat` and its named subpaths. The client export includes its
original TypeScript declarations.

## Prepare the merchant and complete native receiving

The complete receiving command carries the source through publication, release,
purchase, accounting and delivery:

~~~sh
starforge eurostat receive \
  --workspace /srv/starforge/projects/eurostat \
  --input /absolute/private/eurostat-receiving.json
~~~

Prepare that private configuration from the
[original receiving template](../../stellar/scf-starforge-20261009/sf30-seller-sdk/eurostat/examples/receiving-template.json)
and the [full receiving contract](../../stellar/scf-starforge-20261009/sf30-seller-sdk/eurostat/RECEIVING.md).
It names the intended original source file and retrieval metadata, exact query
review, publication reviewer, dataset state, release package/store and runtime,
payment choices, buyer configuration, operation ID and original accounting
workspace. Set the actual page size, total spend and response capacity for that
customer operation.

The example's 576 rows fit two pages when the chosen page size is 300.
The native buyer follows the actual original cursor and snapshot until the
complete selection arrives. Payment configuration and spend limits belong to
the intended buyer operation; the source example itself supplies no account
credential or new authorization.

The receiving controller performs the original workflow in order:

1. Import the exact source, preserve its retrieval record and save the reviewed
   selection in the existing project.
2. Write the complete economic briefing and native dataset plan.
3. Extract the original candidate, review the current target and publish its
   dataset version.
4. Prepare a source-complete SF82 dataset package, stage the original release,
   activate it and start the supervised merchant.
5. Read the merchant's actual native offer, bind the original SF88 buyer
   configuration and retrieve every selected page.
6. Finalize the original buyer entries in the chosen accounting workspace.
7. Create the complete SF100 dataset delivery, compare every delivered row with
   the selected source cells, and attach the original response, source review
   and full source handover.
8. Reopen the completed delivery from its original report and close the
   merchant and project leases.

The checkpoint is
`PROJECT/receivers/OPERATION_ID/receiver.json`. It retains the exact configuration
digest, original source and buyer bindings, extraction UUID, saved phase results,
publication, release and customer operation. The complete briefing remains in
`economic-briefing/`; customer files remain in `buyer-delivery/`.

An interruption continues with the same project, configuration and operation
ID. The original receiver reuses finished source, report, plan, publication and
release phases. It reconciles a completed retained candidate through the original
publisher recovery path. It opens an existing buyer session with its original
configuration, limits, cursor and snapshot. A changed configuration has to be
reviewed as a separate intended operation.

For manual release operation, `eurostat release-prepare`,
`release-stage`, `release-activate`, `release-rollback` and `release-run`
use the original SF82 contracts. The prepared package includes the selected
candidate CSV, dataset/seller configuration, original capture bytes, query and
publication review. Keep the package, source project, dataset state and release
store in their own canonical directories.

## Preserve the project and update its runtime

Export source and reviewed queries with:

~~~sh
install -d -m 700 /srv/starforge/handovers
starforge eurostat export-sources \
  --workspace /srv/starforge/projects/eurostat \
  --out /srv/starforge/handovers/eurostat-sources.json
~~~

That handover contains complete original source bytes and saved query reviews.
The native receiving workflow adds the purchased dataset, accounting, complete
delivery report and original source companions. Retain the complete original
project and release state when transferring ongoing merchant operations.

A runtime upgrade selects a new installed archive and attaches the same existing
project through Applications or `eurostat serve`. Source captures, original
publication and customer IDs remain in their existing operating directories.
Reopen the previous runtime/release through its original controls when using
rollback.

The source adapter accepts original responses up to 32 MiB and 250,000 declared
cells. A larger intended selection must fit the source's documented capacity.
Original empty-dimension and no-observation responses remain distinct from
populated editions. Browser/client source inputs, extraction capacities and
complete handover capacities are documented in the source README. Keep the
original capacities visible when reviewing a new dataset or customer query.

## Original source ownership

This installed product adopts the complete Eurostat implementation and official
source examples from the original source revision
`5bd4acb39c2012d0cf64c7efc93572416e0224a6`, including its finalized receiving
controller. The Merchant Workspace preserves the original domain, report,
publisher, client, browser, CLI and MCP modules. Its contribution adds the
Applications entry and named package exports; its committed selection binds the
complete installation and receiving guide to the package.

The original [MIT license](../../LICENSE) applies to the software. The official
statistical response retains its own source metadata, attribution and reuse
review.
