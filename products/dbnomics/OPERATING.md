# DBnomics economic sources and analysis

This installed product carries a source edition from exact DBnomics economic
series through analyst review, saved reports, native dataset publication and
customer receiving. The browser, typed JavaScript client, MCP tools and CLI
operate the same saved project.

The included source contains the full original Insee index including imputed
rents for France, all households, unadjusted, base 2015: 36 annual observations
and 432 monthly observations over 1990–2025. The product retains every original
numeric spelling, source period, observation attribute, provider response and
reuse reference. Its saved analyst outputs include complete JSON, CSV and HTML.

## Install the selected product

Use Linux, Node.js 24 LTS, Git and util-linux `flock`. Operating projects need a
filesystem with file locks, atomic rename and fsync. Node 24 supplies the
original SQLite publisher and lossless JSON numeric-token support.

Build the selected product from the intended complete source commit:

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-workspace --ref ORIGINAL_COMMIT \
  --selection dbnomics --out /absolute/releases/dbnomics
```

Use the full 40-character commit and the actual archive path and SHA256 returned
by that builder. The recipe retains the entire DBnomics component, the original
source dataset publisher and browser, Dataset handler, SF82 release and SF88
Buyer, and their installed dependency closure. The complete source examples,
typed client, MCP entrypoint and this operating guide travel in the package.

Prepare and install the existing maintained runtime:

```sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /srv/starforge/runtimes/dbnomics \
  --archive /absolute/releases/dbnomics/ORIGINAL_ARCHIVE.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /srv/starforge/runtimes/dbnomics

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /srv/starforge/runtimes/dbnomics --load --source

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
  --dir /srv/starforge/runtimes/dbnomics -- registrations --source dbnomics
```

Dispatch subsequent commands through that exact installed runtime:

```sh
starforge() {
  node /absolute/merchant-workspace/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs \
    run --dir /srv/starforge/runtimes/dbnomics -- "$@"
}
```

The function keeps the selected archive and installed native dependencies
attached to each command. An existing maintained dependency installation can
use the installer's `--adopt-existing` route when it satisfies the retained
profile and lock. The runtime records installation progress and actual native
readiness.

Continue an interrupted build in its original output:

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-workspace --out /absolute/releases/dbnomics --resume

node stellar/scf-starforge-20261009/distribution/build.mjs \
  --out /absolute/releases/dbnomics --status
```

A different source revision or selection uses a separate intended output.
The original [runtime installation guide](../../stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md)
and [source selection guide](../../stellar/scf-starforge-20261009/distribution/SOURCE_SELECTIONS.md)
describe the retained package and runtime operations.

## Open a project through Applications or the CLI

Create and open the saved economic workspace:

```sh
starforge dbnomics init --workspace /srv/starforge/projects/dbnomics

starforge dbnomics serve \
  --workspace /srv/starforge/projects/dbnomics --port 8459
```

Open the printed local URL. The project contains `project.json`, `source.json`,
complete source captures and acquisitions, analyst note revisions, saved
reports, the original publisher and dataset target. The default dataset target
is inside the project. Select an existing target with `--state ABSOLUTE_PATH`
during initialization.

The installed **Applications** catalog contains **DBnomics economic workspace**.
Choose its project directory, whether to create it and optional existing dataset
state. Review, save and start that application through the original Runtime
workspace. The application observes the actual listener URL and reopens the
same source/publisher paths when restarted.

A running seller can be attached by supplying both its local origin and public
HTTPS resource:

```sh
starforge dbnomics serve \
  --workspace /srv/starforge/projects/dbnomics \
  --seller http://127.0.0.1:ACTUAL_MERCHANT_PORT \
  --resource https://EXISTING_MERCHANT_ORIGIN/economic-data
```

The server owns the original publisher lease. Stop it before opening that
project with a separate CLI command. The typed client and MCP can operate the
same already-running listener.

The browser provides five connected working areas:

| Area | Operator work |
| --- | --- |
| Source | Discover provider datasets/series, acquire exact series, import original captures and reopen every retained response |
| Observations | Inspect paginated original observations, source attributes and complete-edition facets |
| Analysis and notes | Save calendar-aware calculations and edition/observation notes; download full JSON, CSV and HTML |
| Revisions | Compare two exact captures, their changed/added/removed observations and series metadata |
| Customer edition | Review the saved source selection, create the original candidate and continue native publication/release/Buyer preparation |

Original provider strings, missing values and unsupported period combinations
remain visible. Notes retain a dirty browser draft and require the current note
revision when saved. Pending mutations retain their original ID and input
digest so an interrupted response can be reconciled against the saved operation.

## Complete the included 468-observation operation

The source files are located under the installed package's `source/` directory:

```text
stellar/scf-starforge-20261009/sf30-seller-sdk/dbnomics/examples/
  insee-ipc-annual.response.json
  insee-ipc-monthly.response.json
  insee-ipc.import.json
  insee-ipc.receiving.json
```

Run the included complete receiving configuration:

```sh
starforge dbnomics receive \
  --workspace /srv/starforge/projects/dbnomics-insee \
  --input /absolute/installed-package/source/stellar/scf-starforge-20261009/sf30-seller-sdk/dbnomics/examples/insee-ipc.receiving.json
```

Select the actual installation's source path. The configuration's
`source:{kind:"example"}` resolves the original response files relative to the
installed module. It imports all 468 observations, adds a measure note and an
exact monthly-observation note, and saves four reports:

| Saved report | Complete rows | Interpretation |
| --- | ---: | --- |
| Original levels | 468 | Both original annual and monthly series |
| Monthly year change | 432 | Percentage change from the exact month twelve periods earlier |
| Annual year change | 36 | Percentage change from the exact preceding annual period |
| Monthly index 100 | 432 | Every monthly observation relative to the explicitly selected January 2015 value |

The monthly year-change report carries 12 unavailable initial calculations and
the annual year-change report carries one. Those periods have no earlier
selected source observation at the required calendar lag. The original
observations remain in both reports. The index report's January 2015 base is an
explicit analyst choice; it is separate from the provider's original base-year
definition.

Every report is saved in full JSON, CSV and HTML. HTML contains all report rows,
the original source receipts and terms, methodology and selected analyst note
revision. CSV preserves original values and calculation/base-observation
identities. The browser chart labels its actual visible coverage; the exports
retain the complete report.

The same command saves the reviewed source query, extracts the native dataset
candidate, reviews the target initialization and publishes the original version.
It writes the complete customer CSV and publication description, exports all
source/notes/reports, receives that handover into a separate editable project
and reopens the original published workspace.

The final result is:

```text
PROJECT/receiving/dbnomics-insee-ipc-20261012/result.json
```

It identifies the capture, original extraction UUID, publication snapshot,
reports, output paths/hashes, received project and original reopen. The adjoining
`operation.json` retains the original input digest and extraction UUID.
Re-running the exact configuration continues those records and verifies the
saved output files.

To use the included source interactively in another intended project:

```sh
starforge dbnomics import-example \
  --workspace /srv/starforge/projects/dbnomics \
  --id insee-original-source

starforge dbnomics project-status \
  --workspace /srv/starforge/projects/dbnomics

starforge dbnomics serve \
  --workspace /srv/starforge/projects/dbnomics --port 8459
```

## Source identity, current acquisition and revision review

The included annual original is 166,662 bytes with SHA256
`71603292efe149a08cd025231722a0809f25917a6e39dc676b21123c50638c31`.
The monthly original is 178,349 bytes with SHA256
`031a92e135b398bf41f0fa3cf2d5325107d792dd13e630a4791b1d4302cd4ca8`.
Both were imported on 12 October 2026. Their native metadata records the
Insee dataset update as 29 January 2026; capture time and provider update are
separate fields.

The exact series are:

```text
INSEE/IPC-2015/A.IPC.SO.00.00.INDICE.ENSEMBLE.FE.SO.BRUT.2015.FALSE
INSEE/IPC-2015/M.IPC.SO.00.00.INDICE.ENSEMBLE.FE.SO.BRUT.2015.FALSE
```

The [source guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/dbnomics/SOURCE.md)
retains the exact source URLs, transport receipts and meanings. This measure is
the original index including imputed rents. Use its complete dimensions and
description when presenting economic conclusions.

For a new current acquisition, save an explicit request:

```json
{
  "id": "original-economic-acquisition",
  "selection": {
    "title": "Reviewed original economic series",
    "seriesIds": [
      "INSEE/IPC-2015/A.IPC.SO.00.00.INDICE.ENSEMBLE.FE.SO.BRUT.2015.FALSE",
      "INSEE/IPC-2015/M.IPC.SO.00.00.INDICE.ENSEMBLE.FE.SO.BRUT.2015.FALSE"
    ]
  }
}
```

```sh
starforge dbnomics acquire \
  --workspace /srv/starforge/projects/dbnomics --input ACQUISITION.json
```

The adapter calls the fixed official v22 origin with observations enabled and
period alignment disabled. It preserves every original response and receipt.
A completed response is retained before capture assembly; its original bytes
can finish a missing local body/receipt after interruption. Error returns,
actual status and absolute Retry-After remain in that acquisition.

The source model keeps both parsed values and original numeric lexemes. It
preserves `NA`, JSON null, original period labels and aligned observation
attributes. Frequency-aware calculations use the source's exact annual,
semester, quarterly, bimonthly, monthly, ISO-week or daily calendar. A conflicting
provided period start or unsupported calendar produces an explicit unavailable
calculation and retains the original source fields.

Derived arithmetic uses IEEE-754 numbers. The original numeric tokens remain
separate text columns and report fields. A revision difference between exact
source values uses the maintained decimal difference implementation. A missing
period is never silently replaced by the previous nonmissing observation.

A refresh uses a new intended acquisition ID and retains the previous capture.
Select both capture IDs to compare added, removed and changed observations and
series metadata. Original coordinates are full provider/dataset/series plus
period. A saved query and report keep their exact selected capture even when a
new provider edition is acquired.

For provider discovery, use the browser or `dbnomics discover --input FILE`.
The API's returned pagination belongs to discovery; a chosen complete source
uses explicit series identities. Follow the original response's count/offset
and retain the selected provider/dataset codes.

## Save analyst work and publish an edition

Edition notes describe methodology or interpretation. Observation notes bind
an exact original series and period. Each note update uses an expected revision;
each frozen report retains the selected complete note edition.

Reports support original level, exact-lag difference, exact-lag percentage
change and an explicit base-period index. Dates and series can be selected
without altering original captures. Unavailable calculations carry their
reason and original observation identity.

Export full analyst work and source:

```sh
starforge dbnomics export-report \
  --workspace PROJECT --id REPORT_ID --format html --out /absolute/reports/briefing.html

starforge dbnomics export-report \
  --workspace PROJECT --id REPORT_ID --format csv --out /absolute/reports/observations.csv

starforge dbnomics export-sources \
  --workspace PROJECT --out /absolute/handovers/dbnomics-sources.json
```

Save a customer query against the current source hash. It binds its capture,
series, date bounds, missing-value policy, optional analysis and reuse review.
The original publication plan supplies lossless column types, filters, sorts,
page limits and extraction capacity. Original numeric values and observation
attributes are text; the missing flag is Boolean.

Prepare and save a complete plan:

```sh
starforge dbnomics template \
  --workspace PROJECT --query QUERY_NAME --out /absolute/plans/dataset-plan.json

starforge dbnomics save-plan \
  --workspace PROJECT --input /absolute/plans/plan-operation.json

starforge dbnomics extract \
  --workspace PROJECT --input /absolute/plans/extraction-operation.json

starforge dbnomics publisher-help
```

`plan-operation.json` is `{id,plan}` with the complete template. The extraction
input is `{id:<one original UUID>,planId:<saved integer>}`. Inspect the actual
candidate in the original publisher, review it against the current target and
publish with the returned review ID. Existing targets use their actual running
snapshot and revision. The native initialization action applies to a new target.

Use the original run's `recover` operation after a lost extraction/publication
response. The original candidate, source files and target version store decide
its returned state. Scheduled publication retains its immutable source query;
acquire and review a new capture/query/plan before selecting a new provider
edition for a schedule.

## Native merchant, purchase, accounting and receiving

The full [receiving guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/dbnomics/RECEIVING.md)
documents exact configuration shapes, private paths, source preservation and
continuation.

Optional `release` settings in a receiving input identify the original public
payment terms file, merchant HTTPS origin, route, package directory, release
store and runtime. The package binds the exact original source-query hash,
capture, every original response, candidate CSV, review and publication snapshot.
Its `sourceGuide` carries the complete receiving guide inside the source-file
closure.

Adding `customer` carries that same operation through the existing native
merchant and Buyer:

```json
{
  "customer": {
    "id": "original-dbnomics-customer",
    "configFile": "/absolute/private/original-buyer-settings.json",
    "operatorWorkspace": "/absolute/private/original-accounting-workspace",
    "pageSize": 250,
    "maxPages": 2,
    "maxTotalAtomic": "20000",
    "maxPageBytes": 1048576,
    "acceptIndex": 0
  }
}
```

Combine this with the guide's complete `release` settings and actual
`activationOptions.expectedGeneration`. The illustrated total assumes an
existing authorized offer at 10,000 atomic units per page; use the selected
operation's actual terms and governor ceiling. The original 468-row selection
fits two pages of at most 250 rows.

The controller uses the original SF82 activation and supervised merchant,
reads the actual native offer and prepares the original SF88 Dataset
configuration. It retrieves all original cursor pages, finalizes the original
entries through SF36 and creates the complete SF100 delivery. It compares
every received typed observation to the reviewed source and reopens the same
delivery before recording completion.

The source companions include the complete capture, exact selected source query
and full analyst/source handover. The final native result includes the actual
Dataset report, accounting and received-row comparison. Customer state is
retained in `PROJECT/receiving/OPERATION_ID/customer/customer.json`.

An interruption retains the same input digest, buyer settings digest, offer,
limits, Dataset session, active release generation and accounting workspace.
A completed acquisition is reopened; unfinished finalizations continue on their
original entries. A release generation changed by another operator is reported
before starting another merchant. Keep TLS, payer material and credentials in
their existing native custody.

The source example and its analyst publication are directly usable without
an external data account. Native financial delivery requires the intended
deployment's real existing provider/account configuration. Provider values,
statistical units and source prices do not determine the merchant route fee.

## Typed client and MCP

The package exports the local client and its TypeScript declarations:

```js
import {createDbnomicsClient} from
  '@tokenjunkielabs/starforge-merchant/seller/dbnomics/client';

const dbnomics = createDbnomicsClient({origin:'http://127.0.0.1:8459'});
const status = await dbnomics.status();
const edition = status.captures[0];
const page = await dbnomics.observations(edition.captureId,{offset:0,limit:100});
const original = await dbnomics.originalResponse(edition.captureId,0);
```

Use the actual printed loopback HTTP origin, without credentials or path. The
client retains the original provider/publisher error code, actual HTTP status
and returned body. Downloads return complete bytes and media type.

The product's direct MCP entry uses the same running project:

```sh
starforge dbnomics mcp --origin http://127.0.0.1:8459
```

For a client that launches an executable and argument vector:

```json
{
  "command": "node",
  "args": [
    "/absolute/merchant-workspace/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs",
    "run", "--dir", "/srv/starforge/runtimes/dbnomics", "--",
    "dbnomics", "mcp", "--origin", "http://127.0.0.1:8459"
  ]
}
```

The newline-delimited stdio protocol exposes discovery, source acquisition and
refresh, original bytes, paginated observation and revision review, notes,
saved reports and files, native publication, release and Buyer preparation.
Use `dbnomics_operation` to reconcile a lost response against its original
operation. Cancelling a waiting protocol request preserves already dispatched
work in the original project.

Named exports include source, model, provider, workspace, publisher, typed
client, server, release, typed receiving, customer and MCP modules. These use
the selected product's original implementation and dependency graph.

## Transfer and reopen

The complete source handover includes exact original response bytes, capture
metadata and terms, saved query reviews, every note revision and complete frozen
reports. Import it into its intended receiving project:

```sh
starforge dbnomics init --workspace /srv/starforge/projects/dbnomics-received

starforge dbnomics import-sources \
  --workspace /srv/starforge/projects/dbnomics-received \
  --id original-source-receiving \
  --file /absolute/handovers/dbnomics-sources.json

starforge dbnomics serve \
  --workspace /srv/starforge/projects/dbnomics-received --port 8459
```

Identical capture and report IDs reopen their exact retained bytes. Conflicting
saved queries require an explicit reviewed choice. The receiving project has
its own original publisher identity; ongoing merchant and financial operations
continue at their original project, target, release and Buyer paths.

A runtime update selects a new installed source archive and opens the same
project through Applications or the CLI. The original captures, note revisions,
reports, extraction UUIDs and publication history remain in their operating
directories. Rollback uses the original retained runtime and release controls.

## Source terms and capacity

The [DBnomics Web API](https://docs.db.nomics.world/web-api/),
[data model](https://docs.db.nomics.world/data-model/) and
[legal terms](https://docs.db.nomics.world/legal-terms/) describe the aggregator.
The aggregate database uses ODbL 1.0; underlying provider terms remain attached
to source use. The included [Insee reuse terms](https://www.insee.fr/fr/information/2008466)
use Open Licence 2.0 and require source attribution, known update and faithful
meaning. Captures and reports carry those references and the intended source
review.

The adapter accepts at most 100 explicit series, one million observations,
32 MiB per original response and 128 MiB of captured source. A larger intended
population must be divided into complete explicit source groups. The API/client
and whole source-handover capacities are documented in the component guide.
Full numerical source bytes and metadata stay separate from paginated browser
display.

The software retains the repository's [MIT license](../../LICENSE). Statistical
source rights and attribution remain with each retained provider edition.


## Complete Python briefing and returned workbook

The selected package contains the complete **DBnomics Analysis and editable
workbook receiving** arm. In **Analysis and notes**, select the original
capture, complete saved reports and exact notes revision, then prepare/download
the full Analysis source. Its original raw economic handover travels with the
mapped records.

Install the original Python package with its declared `workbooks` extra in
the maintained Python runtime. **Applications → DBnomics analysis and workbook
receiving** runs the full original command with the selected installation;
**Analysis and workbook workspace** opens its `OPERATION/analysis` database.
Use the same private operating directory and native source checkout.

The Python command `stellar-forge-dbnomics-analysis` provides preparation,
full briefing/query/workbook outputs, original returned-file comparison and
review, exact source-notes adoption, archive receiving and source reopening.
The complete native example runs an already completed DBnomics receiving
project and can carry an explicitly selected real observation note through
the workbook return.

Read the full [Analysis and workbook operating guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/dbnomics/ANALYSIS.md)
for all command/input shapes, Python methods, installed application setup,
source semantics, complete file exports and the original recovery behavior.
The new named Node export is `./seller/dbnomics/analysis-source`; client and
MCP source/file methods use the same project operation.
