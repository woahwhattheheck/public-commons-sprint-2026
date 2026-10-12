# ArcGIS workbench

The workbench brings the original ArcGIS capture, source mapper, dataset publisher and managed release controls into one local operator interface. It opens the same publisher workspace and keeps its existing source, saved plans, candidates, reviews, dataset target and publication history.

## Open the workspace

Use Linux with Node 22.16 or later and util-linux `flock`. Run from the checked-out source root. Choose private directories owned by your normal account:

```sh
umask 077
mkdir -p "$HOME/starforge-arcgis"
ARCGIS_HOME="$(cd "$HOME/starforge-arcgis" && pwd)"
node stellar/scf-starforge-20261009/sf30-seller-sdk/arcgis/cli.mjs workbench \
  --workspace "$ARCGIS_HOME/publisher" --create \
  --state "$ARCGIS_HOME/dataset" --port 8457
```

Open the printed `http://127.0.0.1:…` address. The first opening may start without a source file. Prepare or import a capture, map its complete contents and select a source edition before saving a publication plan.

Reopen that exact workspace without `--create`:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/arcgis/cli.mjs workbench \
  --workspace "$ARCGIS_HOME/publisher" --port 8457
```

An existing ArcGIS publisher opens the same way. Its configured capture is enrolled as **Original configured source**; the application reads the existing capture and does not copy or replace the dataset or plan history. A CLI or agent process must close its owned publisher before another process opens that workspace. The operating system releases its original workspace lock if the process exits.

If the merchant already has a release store, pass the same absolute path with `--releases`. Otherwise the workbench stages releases under its own `arcgis/release-store` directory. Keep this setting consistent when reopening. `--seller` and `--resource` configure the original buyer-handoff view for an existing seller; seller signing keys and service tokens remain host environment variables.

## Prepare a source

**Live ArcGIS layer** accepts the original HTTPS FeatureServer or MapServer layer URL, including its numeric layer ID. Review the selection expression, retained fields, geometry choice and connection limits before pressing **Prepare capture**. Preparation retains the connection and selection. **Continue capture** then runs the original capture engine against the retained selection, requesting only missing pages. Optional token authentication names an environment variable; enter the variable name in the interface and supply its value to the host process.

**Original response files** imports JSON already acquired from the original service. Select the layer metadata and original attribute response pages, then review the page order. If attributes and geometry were acquired separately, add the original geometry response pages and their exact shared attribute field. The original importer checks complete identity coverage, overlapping attributes and spatial references before joining them. The captured attribute response supplies the complete attributes; geometry pages do not manufacture missing attributes.

The representation setting records whether inputs are saved parsed JSON or original response bytes. Neither mode re-fetches the service. The importer retains the exact supplied bytes under its own capture, so completing an import does not depend on the browser's selected files or an external input folder remaining in place.

Metadata is limited to 2 MiB and each imported feature or geometry page to 16 MiB. Browser uploads allow 64 MiB per file and 256 MiB of retained ingress across the workspace; the capture's declared source-byte limit is checked separately. Remove ingress copies after the capture or deployment has retained its own original inputs to free space.

A partial capture remains visible with its selected-record, retained-page and pending-page counts. **Pause capture** stops the active continuation and retains completed work. Reopen the same workspace and explicitly continue that capture; preparation is not repeated. A failed or paused request does not imply the capture is complete. The mapper becomes available only for the native `COMPLETE` state.

## Map and select an immutable source edition

Choose a complete capture to inspect its original field names, Esri field types, nullability, selection, spatial reference and actual attribute samples. The interface displays at most five samples; extraction uses the whole retained selection.

The native object-ID projection is always first. Use the projection Up/Down controls to preserve an existing public-column order or choose a new reviewed order. Choose up to 64 distinct public names, beginning with a letter and containing at most 48 letters, digits or underscores. Supported scalar projections preserve the native value and type. Complete attributes, geometry and spatial-reference projections retain original JSON as text; they do not transform coordinates, simplify rings, infer units or turn publisher model classes into observed measurements.

Save the reviewed mapping with a source-edition name and public query name. **Save source edition** writes an immutable source declaration bound to the complete capture digest. **Select for new plans** records an explicit selection against the current selection revision. If another operation changed that revision, refresh and review the current selection.

Selection affects new plans. Existing plans keep their exact captured source declaration and runtime source, and their prior candidate and review remain available. The current selection also applies when this same publisher is later opened through its maintained ArcGIS CLI or configured agent adapter.

## Use the original publication workflow

After selecting a source, configure the dataset in the existing publisher section. Choose public columns, filters, ranges and sorts, row and byte limits, and the ascending native object-ID extraction order. The ArcGIS interface exposes **Maximum characters per CSV cell**, initially 1,048,576, to accommodate original geometry JSON within the configured extraction and page-byte limits.

Save the plan, start extraction and inspect the complete retained candidate. Review its actual row count, query response and current target. For the first publication, use the original initialization option. For a refresh, start the existing dataset seller through its release controls and review the exact current snapshot and revision. The original publisher performs the expected-snapshot/revision publication.

The workbench adds no alternative writer or automatic publication. Its source operations and the original publisher's mutations share the same workspace ownership and busy state. Existing recurring schedules retain their saved plan identity and original scheduler; a newly selected source does not silently replace a scheduled plan.

## Deliver and operate the merchant

Select a `PUBLISHED` extraction in the original run history. In **Deliver this published dataset**, choose the original snapshot-enabled seller JSON and a deployment label. **Prepare deployment package** exports the original ArcGIS candidate into the existing six-file dataset package. Its binding retains the original dataset directory, exact snapshot and query contract, source declaration and seller terms.

The immutable package files live in the adjacent private `<publisher-directory>-arcgis-deployments/<request-id>` tree, outside the publisher and dataset directories as required by the original exporter. Their catalog and request identity remain in the original publisher. Retain that package tree together with the workspace when maintaining or moving the host.

Inspect the retained package and downloads, choose the release ID and label, and **Stage in the release store**. Staging uses the original SF82 dataset release implementation and does not start a seller. The browser selects a free local port for a newly staged release; the original release CLI remains available for explicit runtime configuration.

**Open release controls** is also available when reopening an existing configured release store, before creating a new deployment. Start its selected seller to review a refresh against the running original target. The button returns the owned original console. Follow its link to **Select this release**, **Start selected**, **Restart selected**, **Stop seller** or **Select previous release**. Selecting a release preserves any running process and reports a restart requirement until the operator restarts it. Stop and rollback act on the original owned process and release generation.

The console capability is returned only to the current local operator. It is absent from durable request records and browser operation history. Reopening the workbench requires explicitly opening current release controls; a historical request outcome is not a live console link. Closing the workbench drains its owned work and closes its owned console and seller before releasing the workspace.

Download the original package files and, after staging, the recovered receiving declaration. The native `source.json` travels inside the staged dataset release. The package's dataset directory remains a host deployment binding; moving it to another machine requires that machine's original dataset-store receiving procedure, rather than relabeling the old absolute directory.

## Dataset writer lifetime and upgrades

The Linux merchant retains a kernel `flock` on the private `writer.lease` file for its actual process lifetime. Closing or crashing releases that lock; a reused process number cannot own it. Keep the file in place while the store exists. Its inode remains stable across restarts.

The first updated Linux open upgrades the original `dataset-versions.v1` state to `dataset-versions.v2` while retaining the old writer exclusion. The snapshot, contract, revision, retained generations and cursor identities are preserved. Stop the original merchant through its owning console before that first upgrade, and use the updated runtime when reopening the upgraded store. The native release and publisher use this same version-store implementation.

A v1 runtime rejects the new state format. Active v2 preparation uses `.v2-stage-UUID` directories, which the old runtime's cleanup does not recognize. Legacy non-Linux v1 stores retain their existing behavior; opening an upgraded v2 store requires Linux and util-linux `flock`.

If an old v1 process was interrupted before it removed `writer.lock`, the updated Linux runtime leaves that exact file intact and reports `DATASET_LEGACY_WRITER_PRESENT`. Establish that the original owning execution has ended from its retained process/job record, preserve the exact lock bytes with that record, then recover that original private lock. A process number by itself is insufficient because execution namespaces can reuse it. Ordinary updated-runtime crash recovery uses the kernel lock and needs no PID-file cleanup.

## Recover an interrupted operation

Every ArcGIS mutation has an original request UUID, exact submitted JSON, workspace identity and persisted outcome. The interface stores the submitted input before dispatch. Its workspace header prevents a pending request from crossing into another workspace that happens to reuse the same local port.

**Submitted operations and recovery** provides **Check original request** and explicit **Retry same request**. Reloading the page reads retained state and does not repeat mutations. A retry with a different input is rejected; editing a rejected proposal creates a new reviewed request. After a restart, unfinished requests become `INTERRUPTED` and can be explicitly continued under their original identity. A successfully completed operation reuses its retained result.

For an interrupted file upload, reselect the same original file. Its name, byte count and SHA-256 bind the retry to the retained input. The browser does not persist file bytes or console capabilities. Capture, source-edition, upload and deployment histories remain available from the workspace even after the browser session is gone.

The original publisher's plan, extraction, review, publication and schedule recovery controls remain responsible for their own actions. Inspect an uncertain original publication before requesting another publication.

## GIS customer receiving

The complete original receiving workflow is in [DEPLOYMENT.md](DEPLOYMENT.md) and [README.md](README.md). A finalized original SF100 dataset delivery can be converted with:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/arcgis/cli.mjs receive \
  --delivery "$ARCGIS_HOME/customer-delivery" \
  --plan "$ARCGIS_HOME/release-receiving.json" \
  --out "$ARCGIS_HOME/received-feature-set.json"
```

The receiver verifies the delivered snapshot, query, original archived page chain and exact typed rows against the retained declaration, then produces an Esri FeatureSet with original fields, object IDs, scalar attributes, spatial reference and geometry. Payment state remains the original buyer's responsibility. An operator preview or a 402 challenge is not a settled purchase.

## Recorded receiving example

The completed 2026-10-12 operation reused the original captured UConn Long Island layer: 325 rows, the same public field order and native units, and snapshot `5247913debf82f89397c07b2e609e33eb7bc92cf9d9d38b8605edbeb411e808a` at revision 1. The browser saved the source edition and mapped plan, accepted the original seller JSON file, exported the package and staged it in the existing release store. Original publisher HTTP operations performed extraction, review and publication; the original release controller started and stopped the selected seller.

The receiving operation read all seven package/declaration downloads with their exact byte counts and hashes, and converted the retained two-page SF100 delivery into the same four-feature Esri FeatureSet (26,751 bytes). Reopening retained two plans and two runs, including the unchanged earlier plan, run and result files. The selected merchant was returned to its original release and left stopped. Source intake reused the already captured layer; it did not make a fresh provider request. The SF100 pages were original operator-preview responses, and this operation submitted no signed payment.

## Host integration

`openArcgisPublisher(options)` continues to own the original publisher and workspace lease. `startArcgisWorkbenchServer({publisher,port,releaseDirectory,environment})` adds the same-listener workbench and its original release-console lifetime. Closing that default service closes its owned publisher.

An existing host can attach the browser to its original `openArcgisWorkbench({publisher,releaseDirectory,environment})` model and scheduler with `startArcgisWorkbenchServer({publisher,workbench,schedule,ownsPublisher:false,port})`. The publisher must be the exact object owned by that workbench. Closing this borrowed browser drains only its listener and active responses; the original model, publisher and schedule remain available. The host closes the model and retained file reads before closing the publisher.

The maintained merchant MCP host implements that lifetime through one `MerchantPublisher.borrow` lease. Its ArcGIS workspace, browser and `merchant_publisher_*` tools share the same publisher, selected source, saved plans and native scheduler. Closing the owning publisher drains its attached workbench before releasing the original lease. Host-declared source aliases, source profiles, release configuration and the full agent-to-customer workflow are documented in [ARCGIS_WORKSPACE.md](../../../../stellar-forge/mcp-merchant-operator/ARCGIS_WORKSPACE.md).

The local ArcGIS routes are under `/api/arcgis/`. Obtain `workbenchId` from `GET status` and include it as `x-arcgis-workbench` on every mutation. Catalog requests report `RUNNING`, `SUCCEEDED`, `FAILED`, `PAUSED` or `INTERRUPTED`. Named IDs address retained objects; a request does not select arbitrary server files. Source and deployment downloads use fixed, verified package members. The original host enforces its loopback Host/Origin policy for both its existing publisher routes and the ArcGIS extension.
