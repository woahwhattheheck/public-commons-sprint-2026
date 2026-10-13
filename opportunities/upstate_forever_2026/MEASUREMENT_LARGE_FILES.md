# Large files and complete measurement handovers

Version 1.2.0 · ECO-CLOUD-3F90 · 13 October 2026

## The complete operating course

The existing Measurements workspace receives an original CSV in restart-safe chunks,
normalizes the entire source to disk, and commits its original records in one native
SQLite transaction. A saved export pins one complete workspace revision, writes full
record and calibration populations, retains the original source files and every
rejection, and produces a ZIP64 handover. A recipient opens that handover as another
editable Measurements workspace, including original source identities, reviews,
version selections, reach bindings and saved population editions.

The unchanged engine/normalise.mjs remains the scientific interpreter. The large-file
parser preserves the original physical row numbers, UTF-8 values, quoted newlines,
headers, mapping and record identities. No concentrations, units, censoring bounds,
replicates, source-version choices or eligibility decisions are silently changed.

## Install in the original application

Use Node 22.16 or later and Python 3.10 or later. The Node service uses its bundled
node:sqlite DatabaseSync and backup APIs. No npm/pip dependencies or remote services
are needed for this extension. The existing scientific application's own requirements
remain in force.

```sh
python install_measurement_large_files.py \
  --application /absolute/current/upstate_forever_2026
```

The source directory is normally the directory containing this command. --source-root
selects another complete release source directory. --dry-run computes the exact
installation without changing source files. The installer verifies the complete
inventory, composes the authored hunks into the existing files, preserves unrelated
modules and Python namespace initializers, and mirrors the composed browser modules
to the original host's native aliases. It stages every changed body before publication.
The same command reuses identical files and completes a stopped installation. A source
hunk changed by another author is named precisely and retained for composition.

The older install_measurements.py entry delegates to this installer when the 1.2
source manifest is present. Restart the original operator after installation, keep
its ordinary authentication, and open **Measured observations** in the selected
Workspace. No shared server, job scheduler, scientific renderer or run is replaced.

For the independent original CLI, create an application directory and add
--standalone. This skips only the check for the original extension_registry.py;
the actual installed Measurements engine, CLI and native files are the same.

## Receive and review an original source

In **Large files and complete handovers**, select **New original**, choose the exact
CSV, choose WQP chemistry or station CSV, and prepare it. Uploads use 256 KiB checked
chunks. A stopped upload can be reopened from its saved intake and the original file
reselected. Every reused prefix chunk is compared before the remaining bytes continue.

The preview reports all source rows, native records, rejected rows, columns and the
source checksum. Its 25-row sample is for display only: all rows are normalized and
all rejected rows remain on disk. Enter an explicit column mapping as JSON and use
**Reprocess mapping** to reuse the same uploaded bytes. No reupload is needed.

Commit uses the displayed source, normalizer edition and native workspace revision.
The original import/record identities, station metadata, event history and one
revision change are committed together. A retry after a lost response reuses the
existing source import rather than adding it again. Normalization can restart from
the retained complete source; an interrupted native commit rolls back.

Use the existing station/domain assignment and record-review controls after import.
Reach or HUC identifiers come from the selected original source; geographical
proximity is not a substitute for an explicit assignment. The native desk retains
the bound outer-Workspace source file in a handover, so the received project can
resolve the same identifiers without the sender's filesystem.

Under **Original sources**, download the exact original CSV, complete rejected-row
JSONL, and source metadata/mapping. These are complete downloadable populations,
not a sampled preview. The same ordinary original files also travel in the ZIP.

## Save complete populations and receive them elsewhere

**Save complete edition** captures the native database revision and complete retained
source/companion files. It produces:

* records.csv — every selected native record, with original identity and source links;
* calibration.json and calibration.csv — the original accepted/excluded decision
  populations and complete source-bound accepted input rows;
* accepted.jsonl and excluded.jsonl — streamable complete decision records;
* project.zip — the full native Measurements database, source files, companions,
  bindings, saved population editions and checked archive inventory.

The calibration JSON retains the original schema and canonical content hash. Native
source/version/review choices govern eligibility exactly as before. Reports include
explicit exclusions rather than inventing measured values for nondetects or changing
the source record. Every saved edition is revision-pinned. Reopening or retrying the
same export identifier recovers that edition even after the current Workspace changes.

Export recovery retains a completed capture, population-writing and archive phase.
A killed process releases its SQLite operation lock. Resume the same identifier;
the exporter does not silently recapture a newer live revision. Saved population
files are retained inside the project. ZIP files are not recursively nested as
historical ZIP-of-ZIP copies.

Select a **new empty receiving Measurements workspace**, choose the full project.zip
and receive it through the same upload controls. The receiver checks every member,
original source hash, native record/source relation and reviewed population before
the native database transaction. Repeating the same archive is idempotent. A received
review can be edited and reopened independently; the sender is not changed. Existing
populated recipients are not overwritten. The native bridge's empty derived reach
cache may be replaced by the verified incoming cache; conflicting authored context
is preserved.

This is the complete **Measurements workspace** handover. Whole-application scientific
Workspace transfer remains the original application's own export/restore feature;
this component does not relabel one as the other.

## Installed command line

The command remains the original Measurements engine entry. Source and receiving
folders below are explicit examples, not default locations. Run from the installed
application directory. Preparation prints the retained intake identifier.

```sh
node measurement_workspace/engine/cli.mjs large-prepare \
  --workspace /projects/measurements-a --file /sources/original.csv \
  --kind wqp --label 'Original laboratory source'

node measurement_workspace/engine/cli.mjs large-commit \
  --workspace /projects/measurements-a --intake ACTUAL_RETURNED_INTAKE_ID

node measurement_workspace/engine/cli.mjs large-status \
  --workspace /projects/measurements-a

node measurement_workspace/engine/cli.mjs large-export \
  --workspace /projects/measurements-a --id YOUR_STABLE_64_HEX_OPERATION_ID \
  --output /delivery/measurement-edition

node measurement_workspace/engine/cli.mjs large-receive \
  --workspace /projects/measurements-b --file /delivery/measurement-edition/project.zip
```

large-import combines prepare and commit for a previously selected source. --mapping
accepts a JSON file using the original engine's mapping names. --expected-revision
can bind a commit to a previously inspected revision. --filters selects a JSON file
using the original native filters. --result writes the full command response to a
new file. Keep --id stable when resuming an export; omit it to create a new edition.
When using the CLI on a native operator measurement directory, supply
--native-workspace /absolute/outer/workspace to large-export so the exact bound
outer domain source is captured, as the native browser does automatically.

The command's --workspace is the **measurement directory**. In the original operator
this is OUTER_WORKSPACE/measurement-observations. It is not the outer model Workspace.
Use MEASUREMENTS_PYTHON to select the Python executable for ZIP64 packing in a direct
Node invocation. The managed native Python bridge passes its own interpreter.

## Native interface and implementation

The existing /api/measurements/rpc wrapper and original managed Node token protect
all calls. Its normal path/method/payload envelope now accepts /large/intakes,
/large/editions and /large/sources. Upload and download operations move small checked
chunks, not whole base64 files. The new browser is installed as the original
measured_large_files.mjs alias; no separate public service is opened.

The database adds source_chunks, source_rejections and large_receives. Original tables
and native IDs remain. Source bytes/rejections are read incrementally. Large export
metadata is registered in the original exports table; complete files stay on disk.
Old source() and portable() callers remain compatible through a narrow read adapter.
Those legacy whole-object calls still allocate whole objects; use the large-file
commands/pane for large sources.

Memory scales with a parsed CSV record, the working batch, indexes and native SQLite
cache, rather than the entire CSV population. Individual cells are limited to 1 MiB,
a parsed record to 16 MiB and columns to 10,000 to give malformed input a clear error.
The large CSV path supports WQP and station CSV. Existing USGS GeoJSON/provider-page
receiving preserves its original parsing path and size characteristics.

Allow disk for the original upload, normalization database, live native database,
frozen backup, complete exports and independently received copy. These are real
retained outputs, not temporary memory. The browser writes downloads to its
origin-private filesystem where supported. Its compatibility fallback constructs a
Blob, so use the installed CLI for files larger than that browser's memory allowance.
Native writes are atomic SQLite transactions. Companion files use verified,
create-only installation; interrupted receiving can retry the same originals.

## Executable checks

verification/large_file_journey.mjs exercises complete parser/native identity parity,
all exports, full-source ZIP receiving and independent review/reopen. The browser
journey operates the original Python-to-Node service and the actual browser module.
verification/large_file_capacity.mjs accepts a record count and a new output directory
for a complete authored population; it compares every native record after receiving.
The original verification/journey.mjs and collections_journey.mjs remain available.
The capacity rows are labeled software workloads, not field observations.

## Current-source recovery integration, 13 October 2026

Installer 1.2.1 composes the original 1.2.0 engine and pane into the current
collection and Chemistry controllers. It preserves the native atomic snapshot,
all current Chemistry capability bindings and routes, the existing collection
asset route, and source-relative versus installed-alias imports. The original
descriptor keeps its peer assets and receives only measured_large_files.mjs.
The original release ZIP remains byte-preserved separately; no legacy controller
is installed over a newer peer implementation. An unrelated exact hunk change
still stops installation for explicit composition.

### Recovery operation and remaining inspection

The compatible native source executed complete 800-record receiving and an authored
350,000-row software workload on 13 October 2026. The larger course completed all
source, native population, export, independent receiving and all-record identity
comparison in 147.343 seconds, peak reported RSS 233,428 KiB. Of the authored rows,
346,391 were accepted and 3,609 excluded with original reasons retained. These are
software workloads, not field observations or a watershed-model acceptance.

This source recovery is a draft. The composed visual interface has not been
accepted: local Chromium failed with socket Operation not permitted. The cloud
browser could not reach the local HTTP server (ERR_CONNECTION_REFUSED); rebinding
its internal chrome-error page also returned a protocol-policy denial. The error
page was not read or bypassed. No screenshot inspection or browser-control
completion is claimed. Do not present this as a ready client application. Complete
the original loaded/empty/error/download/reopen desktop and narrow-width journey
in an authorized browser before product delivery. No denied route is retried.

The preserved original 1.2.0 ZIP SHA256 is
29e9100f210c38682891656e225acf7242e56c4bc952650aad0117d9ef7380a7.
The 1.2.1 source composes the installer/UI integration over current native
Chemistry, collection routes and atomic snapshot without replacing their owners.

## Current application direction retained with this handoff

# Current owner direction: Ecosystem Sciences demonstration

Version: `2026-10-13.3`. Owner: Bryce / TokenJunkieLabs. Direction for the Upper Savannah application, demonstration, presentation and work orders. Continue the broad build without arbitrary feature/scenario caps. Preserve today's cutoff: **October 13, 2026, 10:00 a.m. Eastern / 14:00 UTC**. Do not pause work or extend the sprint.

## Direct owner instructions

> do the simulated model

> just make sure that what we put infront of him is something he would need and want and he will be blown away how relevant it is to him and how he wants it,a nd also the speed we produced it

> just checking dont pause anythi g

> and make sure wherever the fleet is coordinating in slack or github or wherever on this demo / presentation / ecosystem gets that update toand passes it along to other agents because the feed may be moving fast

## Build for an experienced scientific practice

Ecosystem Sciences lists GIS, hydrology/monitoring, ecological modeling, watershed assessment, statistics, visualization, optimization and publishing. Tim Maguire's practice includes GIS, modeling and water resources. Its South Platte work assembled data, mapped natural capital and produced watershed investment decision support. Do not assume it lacks these capabilities. Its unmet tooling, InVEST or production-capacity gap is unknown until the call. Sources: [Services](https://www.ecosystemsciences.com/read-me), [Firm](https://www.ecosystemsciences.com/firm), [South Platte](https://www.ecosystemsciences.com/).

Show concrete delivery and engineering offload on the actual Upper Savannah RFP workflow: source assembly, reproducible native calculations, editable scenarios, useful decisions and a complete working handoff. The prime retains scientific direction, method choices, interpretation/review and the client relationship. Relevance comes from useful work they can inspect, adapt and receive; do not promise Tim's reaction or claim an unconfirmed need.

## Execute the prepared simulated case now

Native execution is the immediate hard priority. Issue the prepared simulated case on the verified scientific runtime, retain its actual run identity and progress, and obtain the real native outputs. Continue the source/runtime/application integration needed to make that happen. Further plans, stock demonstrations, policy reviews and cosmetic inspection do not replace execution. Do not introduce a bid decision or a prime's yes as a gate.

Demonstrate the scientific operation in the actual application:

1. Use the RFP's 30 m GIS selection. Keep the upstream contributing model domain distinct from the South Carolina reporting mask and the four existing utility focus anchors; retain their actual source geometries and identities.
2. Run the baseline, a realistic riparian alternative and its matched control with explicit, editable source editions, assumptions, parameters and scenario changes.
3. Show active run/progress/logs and completed native annual NDR/SDR results: nitrogen and phosphorus in **kg/year**, sediment in **tonnes/year**, representing delivery to streams. Do not present these modeled stream loads as intake concentrations.
4. Compare the actual maps, tables and report, preserving matched scientific support and original units. Keep source/assumption edits and their consequences inspectable.
5. Export the editable GIS/project and complete scientific working package. Cold-reopen the delivered application/project and show the retained sources, selections, results and useful controls.

Identify the simulated case as modeled. Never invent measurements, completion or customer acceptance.

## Present the real work and real speed

Actually open, see and use the outgoing app and every attachment as its recipient would. Repair defects and ship a plain, readable product. Apply the standing inspection rule without review/test theatre or parallel bureaucracy.

If producing video, record the actual working application and use available natural generative voice/TTS. Watch and listen to the final export. Generated frames must never pretend to be a working app. Explain speed using actual elapsed start, commit, run and package history; do not invent delivery times or guaranteed reactions.

## Carry this direction with the work

Pass this complete brief into every current child, provider and cloud work order and handoff. Include its durable path and version `2026-10-13.3` with the next result. Relay it at the actual coordination surface and onward to participating workers; fast feeds can bury an update. Acknowledgment alone is not delivery.

Preserve active compute and existing implementation ownership. Do not force worker restarts, drop an active run or create a new controller. Keep lab attribution, source/copyright, incident and contact controls, personal-meeting approval, no private GitHub/Actions, no llama.cpp and focused internal validation. No new approval gate or broad test sweep is authorized.


## Streamed original continuity, recovery edition 1.2.2

DD6B's complete 804f9822 read-adapter correction is composed into this edition.
The original atomic fullSnapshot calls portableDocument inside its read
transaction. The old large-file adapter hydrated only portable, leaving original
content and rejected rows absent in the reviewed snapshot. The actual preimage
returned zero source characters and zero rejections while portable retained
90,427 source characters and three rejected rows.

The corrected adapter hydrates portableDocument inside that same transaction;
older standalone engines retain the portable fallback. No scientific parser,
normalizer or solver is replaced. Actual streamed import, native HTTP snapshot,
original collection publication and independent complete native receiving now
retain identical original content, rejected rows and every native table. Current
40,609-byte Chemistry binding and 35,156-byte browser helper are retained from
the maintained application; their hashes are pinned in the source inventory.
The package remains a draft pending actual visual product use.
