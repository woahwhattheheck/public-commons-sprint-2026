# Coastal source operations

Operate a coastal source study from the original NOAA response through source
review, receiving conventions, analytical workbooks, native publication and
complete customer files. The browser, command line and 48 coastal merchant tools
share the same private workspace, station profiles, immutable editions and saved
operations.

The application retains the requested station, products, dates, datum, units and
time basis with every source edition. Staff can compare later observations,
review original datum and quality evidence, prepare a model-input convention,
compose a reviewed study from several stations and receive its complete returned
files. The same original source also feeds analytical workbooks, native dataset
queries and merchant releases.

## Choose an entry point

| Work | Entry point | Saved result |
| --- | --- | --- |
| Capture, review and operate a study | **Applications → Coastal source operations** or `starforge coops-workspace` | Original coastal workspace, source responses, reviews and releases |
| Prepare a study and receive its returned files | **Studies & receiving**, `starforge coops study-preview` and `starforge coops study-return` | Exact station/edition windows, reviewed mapping, full source delivery and saved receiving decision |
| Run an explicit source operation | `starforge coops` | The same capture, archive, mapping, dataset or receiving operation |
| Build the complete analytical delivery | **Build coastal workbook** or `starforge coops analyse` | Offline HTML, editable workbook, all numerical/source files and manifest |
| Reproduce a downloaded workbook | `starforge coops-analysis` | A complete new delivery directory from its original input |
| Attach an agent | `starforge merchant-providers init coops-workspaces` and `starforge coops-mcp` | Original merchant host, workspace aliases and complete retained-file receiving |
| Receive the complete staff workflow | `starforge coops-receive` | One source study, actual review, mapped exports, native query and same-origin reopen |
| Receive purchased dataset pages | Coastal **Buyer** controls or `starforge buyer-dataset` | Original SF88 intent selection and complete SF100 customer files |

The complete source contracts are in the
[source operating guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/coops/README.md),
[Applications guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/coops/MANAGED.md),
[agent and file-receiving guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/coops/MCP.md),
[analyst guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/coops/analysis/README.md)
and [native receiving guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/coops/RECEIVING.md).
This guide connects those original operations to the installed product.

## Install the complete product

Use the maintained Linux runtime with Node.js 24, Python 3.11 or later, Git, npm
and util-linux `flock`. Keep source, runtime installations, private workspaces
and completed deliveries in separate directories. The workspace storage requires
file locks, atomic rename and fsync.

Build from a checkout containing the full selected commit:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-workspace --ref ORIGINAL_COMMIT \
  --selection coastal-operations --out /absolute/releases/coastal-operations

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /srv/starforge/runtimes/coastal-operations \
  --archive /absolute/releases/coastal-operations/ORIGINAL_ARCHIVE.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /srv/starforge/runtimes/coastal-operations

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /srv/starforge/runtimes/coastal-operations --load --source

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs run \
  --dir /srv/starforge/runtimes/coastal-operations -- registrations --source coops
~~~

Use the builder's actual archive path and SHA-256, and replace
`ORIGINAL_COMMIT` with its full 40-character source commit. Select this installed
runtime for subsequent commands in the same terminal:

~~~sh
starforge() {
  node /absolute/merchant-workspace/stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs \
    run --dir /srv/starforge/runtimes/coastal-operations -- "$@"
}
~~~

Keep that toolkit at its selected absolute path. This function dispatches each
command through the original private installation and its retained dependency
profile. It also works when the installation has no global executable on PATH.

The recipe retains the whole coastal application and offline analysis assets,
the original Stellar Expert workspace store and native dataset adapter, the
Socrata and generic dataset publishers, SF82 releases, SF88 buyer operations,
SF100 receiving and the shared merchant providers. Original dynamically loaded
publisher, dataset, receiving and browser files remain available in the package.

Use the existing installer adoption route when a completed dependency tree
satisfies this exact profile and lock. The
[runtime installation guide](../../stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md)
and [source-selection guide](../../stellar/scf-starforge-20261009/distribution/SOURCE_SELECTIONS.md)
describe installation, dependency receiving and recovery.

Continue a build using its original output:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-workspace \
  --out /absolute/releases/coastal-operations --resume

node stellar/scf-starforge-20261009/distribution/build.mjs \
  --out /absolute/releases/coastal-operations --status
~~~

A different source revision or product selection uses its own release directory.
A completed build reopens its original archive and retained source identity.

## Open the original workspace

Attach the ready runtime to the existing Runtime workspace. On a new operator
installation, initialize that operator workspace once:

~~~sh
starforge runtime-workspace init \
  --workspace /srv/starforge/operator \
  --runtime-home /srv/starforge/runtimes

starforge runtime-workspace attach \
  --workspace /srv/starforge/operator \
  --runtime /srv/starforge/runtimes/coastal-operations \
  --label "Coastal source operations"

starforge runtime-workspace serve \
  --workspace /srv/starforge/operator --port 8465
~~~

Open the returned private URL and choose **Applications → Coastal source
operations**. Select the private coastal workspace, the ready runtime and its
port. Review the original inputs, save the application, then start and open it.
The application creates one selected missing workspace leaf in an existing
private parent, or reopens the original workspace and UUID.

| Application input | Use |
| --- | --- |
| Private coastal-source workspace | Original station profiles, captures, reviews, mappings, datasets and deliveries |
| Original buyer inbox | Existing SF88 inbox containing the actual selected page intents |
| Private merchant runtime JSON | Original port, facilitator and local-facilitator settings |
| Identifying User-Agent | The operator's printable source identification |
| Runtime and process fields | Original installation, port and Applications process owner |

The Applications startup record retains the actual workspace UUID, source
directory, process and private URL. Keep that original URL record for the
merchant attachment. Stop and reopen through the same saved application.

For direct host operation, create the selected private parent directories first.
Run the original console in the foreground, retaining its startup JSON privately:

~~~sh
umask 077

starforge coops-workspace \
  --workspace /srv/starforge/projects/coastal-study \
  --port 8469 --startup-format json \
  > /srv/starforge/private/coastal-session.json
~~~

The JSON contains the current private URL and workspace UUID. Open that URL
through the selected host's browser route. A second terminal can use the same
runtime function and startup file:

~~~sh
starforge coops --session /srv/starforge/private/coastal-session.json schema
starforge coops --session /srv/starforge/private/coastal-session.json view
~~~

The running console owns the native writer. For an intentionally stopped
workspace, the same CLI accepts `--workspace /absolute/private/coastal-study`.
A running publisher remains under the console and its original process owner.

## Capture and review a source edition

Save a station profile with its seven-digit NOAA identifier, label, responsible
team and source note. Choose the actual products, inclusive dates, datum, units
and time basis, then preview the original request plan.

For a residual workbook, choose six-minute `water_level` observations and
six-minute `predictions` in GMT. One capture can supply both products, or
separate retained editions can supply the two selections. The workbook joins the
same station, datum, units and overlapping six-minute clock.

The included
[La Jolla reference](../../stellar/scf-starforge-20261009/sf30-seller-sdk/coops/examples/la-jolla-reference.json)
selects station **9410230**, January 1–7, 2025, metric units, GMT and MLLW.
Capture creates the actual response files and edition for that selection. The
receiving engineer chooses the station and basis for a project.

Start the reviewed capture. The source application retains the original station
response and follows the supported metadata resource URLs that response
advertises. Completed, unavailable and failed responses remain in the original
capture. Pause and resume continue that capture's saved requests.

Inspect the edition's complete source register, original responses, datum and
epoch evidence, actual observation coverage and quality fields. Save the
responsible review against that edition. Use **Handoff files** to receive the
complete source package and readable report.

| Source field | Operator meaning |
| --- | --- |
| `water_level` | Six-minute observations with their original preliminary or verified quality |
| `hourly_height` | The distinct verified hourly-height product |
| `predictions` | The separately selected tidal prediction product |
| Value and `valueType` | Original numerical text with empty, absent, null and recorded values distinguished |
| Datum and units | Exact selected basis, with station datum and epoch evidence retained separately |
| GMT timestamps | Validated UTC projection alongside the original timestamp |
| Local timestamps | Original local-standard or local-daylight basis retained for review |
| Preliminary `f[0]` | Excluded one-second sample count |
| Verified `f[0]` | Inferred-value flag |

The source contract and field definitions are retained in
[schema.mjs](../../stellar/scf-starforge-20261009/sf30-seller-sdk/coops/schema.mjs),
with the original [NOAA Data API](https://api.tidesandcurrents.noaa.gov/api/prod/),
[response definitions](https://api.tidesandcurrents.noaa.gov/api/prod/responseHelp.html)
and [Metadata API](https://api.tidesandcurrents.noaa.gov/mdapi/prod/) references.

## Review historical work and source changes

A historical study composes up to five calendar years through consecutive
native captures. It runs those child captures serially and retains every
completed edition. Staff can pause the study, inspect its current part and
continue that same original capture.

Six-minute observations and predictions use requests of at most 28 inclusive
days; verified hourly heights use at most 365 days per request. One capture
covers at most 366 days. These are the application's explicit source windows.
The complete historical CSV and JSONL exports stream the selected child
editions with their retained coverage and partial-state metadata.

A source refresh creates a separate edition. Compare the earlier and later
editions to inspect value and quality changes, requested-window changes and
ambiguous duplicate groups. Download the complete comparison JSON for every
change; the browser's example rows provide navigation through that result.

The same archive retains selected editions, original review notes and capture
operation IDs after reopen. A source-package import preserves the original
response bytes and observed times in its receiving edition.

## Adopt a model-input convention

Open **Model-input mappings → Select mapping file** and choose the actual JSON
convention. The included
[model-input convention](../../stellar/scf-starforge-20261009/sf30-seller-sdk/coops/examples/model-input-columns.json)
provides the original source-to-heading shape.

Choose a distinct mapping or the exact existing target, record the model owner
and intake decision, and inspect the incoming convention beside the saved target
and current draft. Open the reviewed file as a draft, adjust the receiving
headings as needed, then save the explicit mapping revision.

Each revision retains the exact incoming file, byte length, digest, original
declared identity, decision and adaptations. **Revisions / input file** receives
any selected original revision. Later changes preserve earlier files and
exports.

Mappings select columns and receiving headings. Retain `editionId`,
`recordId` and `sourcePageSha256`, together with the receiving time,
basis, quality and value fields. Keep `valueType` whenever `value` is
exposed. A project's numerical, datum or time conversion belongs in its
explicit analytical workflow.

Export complete CSV, JSON or JSONL with the selected revision and keep the native
export receipt beside each file. In **Datasets**, choose the same saved mapping
to pin its receiving headings into the original SF30 dataset. Native query
column names begin with a letter and contain at most 48 letters, digits or
underscores, excluding the retained reserved names. The dataset form reports
an incompatible heading so staff can save a reviewed convention.

The prepared dataset retains its original mapping revision, incoming mapping
file, source edition, CSV, query description and snapshot. Later convention
changes leave that earlier dataset and its native query identity intact.

## Prepare and deliver a coastal study

Open **Studies & receiving** after retaining the source editions and saving the
receiving mapping. A study binds one observation or prediction table to ordered
windows from up to five stations, 64 editions and five calendar years. Historical
capture parts enter as their original editions. Each saved revision retains the
engineering question, responsible team, selected mapping revision, source hashes,
station evidence and the review of native units, datum and time basis.

### Select the source and receiving convention

Choose a saved mapping for the study's table. It must include the original
source identity, station, product, time, quantity basis, value state and quality
fields. The application lists missing required fields before saving. The full
[study guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/coops/STUDIES.md)
describes every required column and complete native action.

The included
[study column convention](../../stellar/scf-starforge-20261009/sf30-seller-sdk/coops/examples/study-input-columns.json)
is an explicit reference exchange format. Import it through **Model-input
mappings** when that convention suits the receiving work, or retain the actual
supplied project mapping through the same original input-file review. The saved
mapping keeps its exact headings and source-file revision.

Enter the study name, project reference, engineering question and responsible
team. For each member, select its exact retained edition, inclusive first and
last calendar dates and products. Move members to establish output order.
Use **Load older retained editions** to select historical work beyond the
initial archive page.

**Preview exact selection** compares the mapping, source windows and native
bases. The preview lists the source response hashes and the original request
outcomes. It separates the coverage of each complete source edition from the
rows selected for this study. Overlapping windows for the same station, product
and native basis must be narrowed or replaced with one chosen edition.

Matching datum labels at different stations require a station-specific vertical
reference review. The study carries each station's original basis with every
row. If the selected requests use different datum, unit, time or prediction
interval settings, choose compatible editions or select the explicitly separated
mixed-basis form and review its warning.

### Save and review the exact study revision

**Save this reviewed selection** retains the preview digest and selected mapping
revision. Editing a study appends the previous full revision. The saved study,
earlier versions and their original row previews remain selectable.

Open **Review this revision**, inspect the source and mapping, then enter the
reviewer, decision and explanation. A Reviewed decision acknowledges each
generated source or basis warning. A Follow-up decision records the unresolved
work and remains the current decision until another review is saved. The saved
review binds the exact study ID, revision and digest.

When a later staff change is detected, compare the retained draft with the
current saved record. The console preserves entered fields and offers the
current version for review. After a lost reply, reopen the pending original
operation and apply its saved result before continuing.

### Deliver all selected rows and original source

**Create immutable delivery** streams the reviewed study into complete files.
Choose each file from **Immutable deliveries**, or use its original export ID
with the CLI or retained-file Merchant tools.

| File | Complete receiving content |
| --- | --- |
| CSV | Ordered selected rows using the saved headings and original string values |
| JSONL | The same mapped rows with exact string values and one object per line |
| HTML | Standalone study, source, review, basis warnings and actual row/value counts |
| Manifest JSON | Study and mapping identity, review, original response inventory and member hashes |
| Source TAR | The complete selected editions, accepted and failed response bodies, original mapping input when supplied, and the mapped files and report |

The source TAR includes whole selected source editions, even when a member
selects a narrower date window. Its manifest records each retained response and
each archive member. Shared original response bodies are included once by their
content hash. The delivery retains separate counts for selected rows, populated
numerical values and original request outcomes.

CSV users should import columns as text to preserve identifiers and decimal
precision. JSONL carries the same original string-valued fields directly.
Returned and generated files remain attached to their selected release.

### Receive and compare a returned file

Select **Retain a returned CSV or JSONL** on the exact immutable delivery. Enter
the source and purpose of the returned file, select its original file and format,
then retain its bytes. The browser records sequential one-MiB chunks and the
same pending request. Pause or reload can continue the original intake after
reselecting the file; the retained prefix is checked before more chunks are
accepted.

After all bytes are present, choose **Compare complete returned file**. The
application compares every released and returned row using the saved source
identity:

- `editionId`
- `recordId`
- `sourcePageSha256`
- `sourceRecord`

Changed fields appear against that identity. Changed identity fields appear as
an added and a missing row. Row order may differ. Duplicate identities remain
ambiguous in the complete comparison. CSV headings and order must match the
saved mapping; JSONL objects retain exactly the same headings and string values.

Download the full comparison for every difference, together with the exact
returned original and comparison summary. The page shows examples while the
complete file holds the full result. Format and capacity failures retain the
original returned bytes and the reason the comparison needs further work.

Open **Inspect and record receiving**, enter the receiving operator, decision and
note, and save the result. Acceptance records the reviewed changes, additions
or missing content against that exact comparison. An incomplete or ambiguous
comparison requires a Follow-up decision. Prior receiving decisions remain
available with the original file and release.

The source, returned and export file limit is 1 GiB. The comparison uses temporary
identity partitions within the same private workspace; each side of a partition
is limited to 16 MiB and each logical returned record to 2 MiB. When those limits
require a smaller study, retain the completed original intake and prepare the
next explicit source window.

### Operate the same study from the installed command line

Use the original private console descriptor for the running workspace. The
`starforge` wrapper below is the installed wrapper defined earlier in this guide.

~~~sh
starforge coops --session /private/coastal-startup.json study-preview \
  --file /selected/study-selection.json

starforge coops --session /private/coastal-startup.json action \
  --request /selected/original-study-save.json

starforge coops --session /private/coastal-startup.json study-rows \
  --study-id ACTUAL_SAVED_STUDY_ID --study-revision 1 --offset 0 --limit 100

starforge coops --session /private/coastal-startup.json study-return \
  --study-release-id ACTUAL_SAVED_RELEASE_ID --format csv \
  --file /selected/returned.csv --operation-id original-study-return-20261012 \
  --note "Actual returned-file source and receiving purpose"

starforge coops --session /private/coastal-startup.json download \
  --export-id ACTUAL_SAVED_EXPORT_ID --output /selected/new-complete-output
~~~

Replace the example IDs with the actual saved selections. Keep the same return
operation prefix, file and release on a continuation. The CLI checks the retained
prefix, complete file hash and original open-file identity before finishing.
A saved comparison resumes its original native finish operation.

The installed Merchant catalog exposes `merchant_coops_study_preview`,
`merchant_coops_study_rows`, the seven study write actions, and the existing
complete retained-file tools. The browser, CLI and agent use the same source
edition, study revision, review, export and receiving records.

## Build and receive the coastal workbook

Open a retained edition and choose **Build coastal workbook**, or use
**Compare retained editions → Coastal residual workbook**. Select the original
observation and prediction editions, the GMT window and the intended quality
choices. Record the analyst, project, question, interpretation and follow-up,
then build the complete workbook.

The analytical core uses:

~~~text
residual = observed water level − tidal prediction
~~~

It pairs finite, unique values at the identical six-minute timestamp. Missing,
ambiguous, off-grid and unplaced source rows remain in the complete analysis.
Quality choices, inference and tolerance exclusions, sample-sigma limits and
upper/lower residual thresholds remain explicit saved selections. The
[analyst guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/coops/analysis/README.md)
describes statistics, datum-epoch reconciliation, source references and episode
semantics.

| Complete output | Receiving use |
| --- | --- |
| `workbook.html` | Offline interactive workbook containing the original source and analyst tools |
| `workbook.json` | Editable portable workbook with source, options and interpretation |
| `analysis.json` | Complete slots, source references, statistics, gaps and episodes |
| `paired.csv` | Every paired, unavailable, excluded and off-grid row |
| `episodes.csv` | Complete selected threshold episodes and original peak references |
| `unplaced.csv` | Original rows with invalid or unrecognized timestamps |
| `source/*.json` | Exact original response and metadata bodies |
| `manifest.json` | Source/result identity and complete generated-file inventory |
| `README.txt` | Standalone receiving instructions |

Download the primary HTML or editable workbook from the completion dialog.
Every generated member also remains under **Handoff files** with its original
export identity. The HTML opens from a local file and uses the retained source.
A downloaded workbook can continue on another machine; reopen verifies its
source and recomputes the saved analysis.

For CLI operation, save an analysis selection with the actual
`observationsEditionId` and `predictionsEditionId`. Optional
`options` and `analyst` fields use the source-owned analyst contract:

~~~sh
starforge coops --session /srv/starforge/private/coastal-session.json \
  analyse --operation-id ORIGINAL_ANALYSIS_OPERATION \
  --request /srv/starforge/private/coastal-analysis-selection.json

starforge coops --session /srv/starforge/private/coastal-session.json \
  download --export-id ORIGINAL_WORKBOOK_EXPORT_ID \
  --output /absolute/delivery/workbook.json

starforge coops-analysis \
  --input /absolute/delivery/workbook.json \
  --output /absolute/delivery/coastal-complete
~~~

The standalone bundle output must be a new directory. The native workspace
analysis operation resumes using its exact original request and returns its
retained export IDs. Keep that saved request when continuing an interrupted
reply.

## Publish the original dataset and receive customer files

After source and convention review, prepare the selected observation or
prediction table in **Datasets**. Inspect its native description and query
capabilities. Use the retained snapshot and original receiving headings for
the first and subsequent cursor pages.

The prepared dataset supports at most 250,000 rows and a 256 MiB CSV snapshot.
For a longer historical archive, select the edition and window needed by its
consumer; the complete historical source remains in its original partitions.

Enter the actual release origin, route and payment terms, then prepare and
inspect the original publisher release. Activate the selected release with the
generation returned by inspection. Start and stop it through that same publisher
owner. The retained source package carries the edition, actual response files
and pinned model-input convention.

Attach the existing buyer inbox to the coastal workspace. In **Buyer**, inspect
the actual original intents in page order, then receive their completed dataset.
The original SF88/SF100 receiver creates these complete files:

| File | Original customer result |
| --- | --- |
| `dataset.csv` | Complete received tabular dataset |
| `dataset.jsonl` | Complete received records |
| `review.html` | Readable customer review |
| `delivery.json` | Original intent selection, queue and delivery record |
| `manifest.json` | Dataset and file byte/hash inventory |

Keep the five files together. The coastal browser and merchant file receiver
download these original outputs by their saved receiving identity. The selected
product also retains the original `buyer-dataset` command and dataset
receiving interfaces for the same native customer workflow.

## Attach the original merchant agent

Start the selected coastal application and retain its actual Applications URL
record. Create an owned private connection JSON using that record and the
original workspace UUID:

~~~json
{
  "schema": "stellar-forge.coops-workspace-connection.v1",
  "workspaces": {
    "coastal-study": {
      "label": "Selected coastal study",
      "workspaceId": "ACTUAL_ORIGINAL_WORKSPACE_UUID",
      "applicationUrlFile": "/absolute/private/ORIGINAL_APPLICATION_URL_RECORD.json"
    }
  }
}
~~~

For direct console operation, the same connection supports exactly one
`consoleUrlFile` containing the original private URL or
`consoleUrlEnv` naming its existing host variable. Keep the token in that
host-selected reference. Use actual startup values when the console reopens.

Prepare a private provider setup JSON:

~~~json
{
  "directory": "/srv/starforge/merchant/coastal-study",
  "connection": "/srv/starforge/private/coastal-connection.json",
  "name": "Coastal source operator"
}
~~~

The selected merchant parent directory must exist. Initialize its original
configuration and start the maintained MCP host:

~~~sh
starforge merchant-providers inspect coops-workspaces

starforge merchant-providers init coops-workspaces \
  --options /srv/starforge/private/coastal-merchant-setup.json

starforge merchant-mcp serve \
  --config /srv/starforge/merchant/coastal-study/merchant-mcp.json \
  --port 8470 --token-env MCP_ACCESS_TOKEN
~~~

Supply `MCP_ACCESS_TOKEN` through the host's private environment. Use the
actual MCP endpoint returned by that process for its original coastal client:

~~~sh
starforge coops-mcp tools \
  --url ACTUAL_MCP_ENDPOINT --workspace coastal-study \
  --token-env MCP_ACCESS_TOKEN

starforge coops-mcp action \
  --url ACTUAL_MCP_ENDPOINT --workspace coastal-study \
  --token-env MCP_ACCESS_TOKEN \
  --request-file /srv/starforge/private/original-coastal-action.json
~~~

The action file contains the exact native
`{action, payload, operationId, expectedRevision}` request. Read operations
use `call` with a `{tool, args}` file. Tools cover station and archive
work, source acquisition, mapping intake, review, analysis, dataset queries,
release operations and complete customer receiving.

Inspect a selected retained file set, then download and reopen it:

~~~sh
starforge coops-mcp inspect \
  --url ACTUAL_MCP_ENDPOINT --workspace coastal-study \
  --kind receipt --id ORIGINAL_RECEIPT_ID \
  --token-env MCP_ACCESS_TOKEN

starforge coops-mcp download \
  --url ACTUAL_MCP_ENDPOINT --workspace coastal-study \
  --kind receipt --id ORIGINAL_RECEIPT_ID \
  --workspace-id ACTUAL_ORIGINAL_WORKSPACE_UUID \
  --manifest-sha256 REVIEWED_TRANSFER_SHA256 \
  --out /absolute/delivery/coastal-customer \
  --token-env MCP_ACCESS_TOKEN

starforge coops-mcp reopen \
  --out /absolute/delivery/coastal-customer \
  --manifest-sha256 REVIEWED_TRANSFER_SHA256
~~~

The same client receives source editions, capture responses, mapping-source
revisions and retained exports. Inspection returns the exact transfer identity;
download continues in its original private directory. Offline reopen checks the
complete received files. Large files use the original retained reader, whose
maximum chunk is 196,608 bytes.

Package consumers can import `openCoopsClient`,
`inspectCoopsFiles`, `downloadCoopsFiles` and
`reopenCoopsFiles` from
`@tokenjunkielabs/starforge-merchant/merchant-mcp/coops/client`.
The source-owned provider contract remains the same across browser, CLI and
agent operation.

## Complete the native staff receiving journey

The installed `coops-receive` command runs the original
[source receiving host](../../stellar/scf-starforge-20261009/sf30-seller-sdk/coops/RECEIVING.md)
with the selected existing Playwright module and Chrome executable:

~~~sh
starforge coops-receive \
  --operation-id ORIGINAL_NATIVE_RECEIVING_ID \
  --workspace /absolute/private/coastal-workspace \
  --output /absolute/private/coastal-operator \
  --browser-profile /absolute/private/coastal-browser \
  --playwright-module /absolute/selected-runtime/playwright/index.mjs \
  --chrome /absolute/selected-runtime/chrome \
  --operator "Responsible receiving team" \
  --selection /absolute/source/stellar/scf-starforge-20261009/sf30-seller-sdk/coops/examples/coastal-receiving-selection.json \
  --review-response /absolute/private/coastal-operator/independent-source-review.json \
  --study-review-response /absolute/private/coastal-operator/independent-study-review.json
~~~

Choose those actual runtime files and retain the same operation, three separate
state directories, persistent browser profile and original listening port on
continuation. The native host saves its first actual port and reopens the same
workspace UUID and browser origin.

The complete journey captures the selected source, writes its full review
packet, receives an actual independent decision, imports and revises the model
convention, exports complete files, reimports the original source package,
compares its retained records, prepares and queries the original mapped dataset,
captures the selected historical study, and reopens the same workspace.

When the host writes `independent-source-review-request.json`, the reviewer
reads that exact packet and original files and writes the actual decision to
`independent-source-review.json` using the documented response fields.
The accepted decision remains bound to its original packet, edition and source
hash through continuation.

The default reference uses the seven-day La Jolla water-level selection followed
by the declared 2024–2025 hourly-height study. Select another supported source
window before the first run with `--selection ORIGINAL_SELECTION.json`.
The first checkpoint retains that selection and original mapping file.

The [complete coastal reference selection](../../stellar/scf-starforge-20261009/sf30-seller-sdk/coops/examples/coastal-receiving-selection.json)
adds the saved Study workflow to that same source and historical receiving.
It selects the original La Jolla editions, imports the full study column
convention, saves the actual study, and writes
`independent-study-review-request.json`. Inspect that packet, mapping and complete
source files before writing the separate study decision. The response binds
the packet hash, study ID, revision and digest, reviewer, time, explanation and
each acknowledged warning.

After that review is saved, the original browser creates and downloads every
study delivery file. It verifies the complete source TAR, retains the downloaded
JSONL through the real return form, compares every row and records the internal
receiving decision. This returned file is the original internal exchange file.
The result identifies that purpose and preserves its complete comparison.

The final same-origin reopen retains both the reviewed original study and its
later working revision, together with the original release, returned file,
receiving decision and selected rows. Follow the
[complete receiving response and continuation contract](../../stellar/scf-starforge-20261009/sf30-seller-sdk/coops/STUDIES.md#joined-original-operator-receiving)
when operating the full selected journey.

Keep the completed `coops-operator-result.json`, checkpoint, source files,
review, mapping revisions, complete exports and native query results together.
The host's closure record retains its original browser and console disposition.

## Continue work and carry the whole workspace

A saved operation is identified by its original action, payload, operation ID and
revision. After an interrupted response, inspect that native operation first.
An exact replay reconciles the retained result before checking the current
workspace revision. Capture and historical-study progress continue through their
saved capture IDs.

Station, mapping and source-review drafts retain the saved record they were
opened from. A change to that same record requires the operator to compare the
original, current and entered values. Unrelated background capture progress
preserves the draft's selected subject. Completed original saves can return
their retained result while later unsaved field edits remain available.

The browser's draft journal belongs to its original origin. Keep the actual
listening port for a receiving operation's stop/reopen cycle and use its current
legitimate session URL. The immutable workspace UUID continues to bind the
native store and merchant attachment.

For a whole-workspace handover, close the original publisher and console through
their owner and use the host's complete backup/recovery workflow. Carry the
workspace store, objects, editions, mapping history, datasets, publisher state,
exports, customer receipts and original operation records. Keep private startup
URLs and host credentials in the receiving host's private configuration.

Retained source packages and analytical workbooks provide complete selected
deliveries. The closed workspace backup preserves the continuing operation.
After an upgrade, attach that same operating state to the selected new runtime
and reopen its original records and received files.

Copyright TokenJunkieLabs. This product retains its MIT license and applicable
third-party notices.
