# Complete application source and native receiving

Use one pinned cumulative source checkout for the operation. The complete application is `opportunities/upstate_forever_2026` beneath that checkout. The maintained component catalogue is `integration/application_components.json`; the same catalogue drives source assembly and cumulative installation.

## What the selected edition carries

The source selection explicitly includes the original Implementation store, saved revisions, attachment and report handling, the original Greenwood plan and its two scientific source bodies, and the complete native receiving course. It includes Monitoring's current campaign-to-fieldwork and observed-context modules; Monitoring depends on the existing Implementation family.

The Parameter studies family carries paired-result checkpoints, the original GIS difference-map and report exporter, and the Gura suite exporter. The separate Scenario experiments workflow keeps its original source and namespace. Project transfer carries the source-acquisition and Implementation verification helpers, plus the current scientific study receiving helper when present in this edition.

The original utility family selects both `utility_observed_context.sources.json` and `source/utility-source-context-20261013.json` as native source manifests. The existing closure validator resolves each original primary and companion relative to its own manifest and checks its declared bytes and SHA256. Together those two source editions contain 54 distinct files and 5,521,858 bytes. Their complete data include the original 217-HUC network, ARJWS/Pioneer utility selections, original microbial and nutrient records, daily flow context, derived interpretation and offline reports. Source programme/state acreage and original geometric relationships keep their existing meanings.

## Receive the current application

Set the following paths from the existing operation:

```sh
UPSTATE_SOURCE=/absolute/pinned/checkout/opportunities/upstate_forever_2026
UPSTATE_APPLICATION=/absolute/existing-operation/application-received
UPSTATE_OPERATION=/absolute/existing-operation
UPSTATE_PYTHON=/absolute/existing/interpreter
```

The source and output application directories must be distinct. Preserve the existing Workspace separately. With the current complete checkout:

```sh
"$UPSTATE_PYTHON" -B "$UPSTATE_SOURCE/source_tools/install_cumulative_application.py" \
  --source "$UPSTATE_SOURCE" \
  --output "$UPSTATE_APPLICATION" \
  --archive "$UPSTATE_OPERATION/upper-savannah-application.zip"
```

This is the existing cumulative installer. It inventories source bytes, validates the selected component closure, runs the maintained component joins in a staging directory, checks the installed source, and publishes the application and ZIP. Its result contains the actual installation path and component inventory. A failed native attempt retains its actual staged source and `CUMULATIVE_INSTALLATION_FAILURE.json`; use that exception and its exact member path to repair the same operation.

For an already integrated full source directory that needs a portable carrier rather than installation, use the existing assembler:

```sh
"$UPSTATE_PYTHON" -B "$UPSTATE_SOURCE/source_tools/application_assembly.py" \
  "$UPSTATE_SOURCE" --edition ACTUAL_PINNED_EDITION \
  --operation-id ACTUAL_EXISTING_OPERATION \
  --source-map "$UPSTATE_OPERATION/application-source.json.gz" \
  --zip "$UPSTATE_OPERATION/application-source.zip"
```

The assembler retains original file modes and source identity and applies the same explicit family checks. Keep the actual source commit fixed while a running model or acquisition records its implementation.

## Updating only the maintained Monitoring family

The Monitoring installer now chooses the live maintained application source when it runs from a complete current checkout. Its retained older `src/` package remains available when the current application is absent. An explicit source root accepts either the complete repository or its application directory:

```sh
"$UPSTATE_PYTHON" -B "$UPSTATE_SOURCE/integrations/monitoring/install_monitoring.py" \
  "$UPSTATE_APPLICATION" --source-root "$UPSTATE_SOURCE" --check
"$UPSTATE_PYTHON" -B "$UPSTATE_SOURCE/integrations/monitoring/install_monitoring.py" \
  "$UPSTATE_APPLICATION" --source-root "$UPSTATE_SOURCE"
```

`current_application_files.json` names the current owned modules and the existing Implementation/Workspace dependencies. The current mode requires the registered extension host and those dependencies already installed, including the separately maintained Monitoring report-source family used by the current adapter. A complete cumulative install supplies them together. For an older partial target, install the existing Implementation family through `install_implementation.py` and the maintained shared host before adding this current Monitoring family.

The installer reads every selected source, retains its exact identity, recognizes its own packaged/predecessor versions, and refuses to overwrite an unrelated current module. It rechecks both source identities and destination preimages under the existing installation lock. Existing shared dispatch/browser migration, staged syntax checks, backup and rollback behavior remain with the original installer. Its result states whether it selected maintained application source or the retained original package.

## Complete the original receiving course

From the installed application, use the existing operation output directories:

```sh
cd "$UPSTATE_APPLICATION"
"$UPSTATE_PYTHON" -B source_tools/receive_utility_source_context.py \
  --out "$UPSTATE_OPERATION/utility-receiving"
"$UPSTATE_PYTHON" -B source_tools/receive_implementation.py \
  --workspace /absolute/actual/existing/workspace \
  --operation "$UPSTATE_OPERATION/field12-receiving"
```

The first command uses ordinary Python 3.10 or later and retained original source bytes to produce the real regional and utility packets. The second imports the actual original Greenwood plan, retains original source attachments and its native report, captures the existing Workspace and application through Project transfer, restores them to a fresh location, and reopens the exact saved plan revision. Each command returns its own actual `receiving.json` and output paths.

## Continue a saved campaign or reviewed client follow-up

A saved Monitoring campaign uses its actual retained sender revision. After the existing scientific operation releases its Workspace locks, run:

```sh
"$UPSTATE_PYTHON" -B source_tools/receive_monitoring_fieldwork.py \
  --workspace /absolute/actual/existing/workspace \
  --operation "$UPSTATE_OPERATION/monitoring-fieldwork" \
  --campaign-id ACTUAL_CAMPAIGN_ID \
  --revision-id ACTUAL_CAMPAIGN_REVISION_ID
```

This same course verifies the original campaign package, updates its editable Implementation plan, retains the native report, captures the whole Workspace and application, restores the captured edition and reopens the exact saved plan and attached originals. The source ZIP streams from retained files so a complete historical network package need not fit in memory. See [the full native fieldwork guide](IMPLEMENTATION_NATIVE_RECEIVING.md).

For an existing original Monitoring receiving receipt, `campaign_id` and `campaign_revision_id` describe the sender Workspace. An independently received campaign pairs `received.workspace` with `independent_revision`; keep those selected Workspace/revision pairs together.

A client-report follow-up starts with the exact saved report and its exported Meeting notes JSON. In **Implementation & fieldwork → Source selections → Receive briefing follow-up**, select those originals, preview the actual recorded entries, choose the work and receive the reviewed follow-up. [The briefing guide](BRIEFING_FOLLOWUP.md) documents the complete source-bound preview and native CLI. Then the existing generic fieldwork course receives its saved plan:

```sh
"$UPSTATE_PYTHON" -B source_tools/receive_implementation.py \
  --workspace /absolute/actual/existing/workspace \
  --operation "$UPSTATE_OPERATION/briefing-fieldwork" \
  --plan-id ACTUAL_SAVED_PLAN_ID --revision ACTUAL_SAVED_REVISION
```

The saved report, briefing index and notes remain original attachments. Recorded deadlines stay deadlines; real duration, staffing and cost are editable planning inputs.

## Reopen original scientific parameter results

After the current scientific operation has retained its output, use the saved study IDs:

```sh
"$UPSTATE_PYTHON" -B source_tools/receive_parameter_studies.py \
  --workspace /absolute/actual/scientific/workspace \
  --operation "$UPSTATE_OPERATION/parameter-receiving" \
  --study-id ACTUAL_SAVED_STUDY_ID
```

Repeat `--study-id` for several studies. Omitting it freezes the currently saved study list on first invocation. The original full Workspace is captured and restored; each selected study reopens through its existing native API. Receiving JSON lists original specification/case/run identities, current completion state and exact retained GeoTIFF/report/archive locations. A prepared or partial study keeps that state. Later work in the receiving Workspace remains intact. See [Parameter study native receiving](PARAMETER_STUDY_NATIVE_RECEIVING.md).

In the received operator, open Project transfer and the completed receiving operation. Open its retained Implementation row to select the restored Workspace and exact saved revision. The Handover view supplies the retained report and attachment downloads. In Monitoring, select an actual saved campaign revision and use Campaign fieldwork to continue through the same Implementation store and report path. Original source questions remain tasks until the operator records real work.

For native Parameter studies, use the already prepared study and its actual scientific interpreter. Its existing run/resume path retains paired-result progress, difference GeoTIFFs and report artifacts; the current Gura suite produces verified per-study exports and the final aggregate ZIP. The source installer does not create a replacement scientific study or receiving operation.

## Receive the complete native Flow routes family

The `native-flow-routing` component is declared in
`integration/component_fragments/native-flow-routing.json`. The maintained
component reader composes this additive declaration with the existing catalogue
and other fragments. It selects the full eleven-file Flow routes product,
including its kernel, original raster reader, native saved-report writer,
operator provider/extension/browser/style, complete operator guide, encoded
course and both original receiving modules. Its dependencies are the existing
scientific core and Native run desk.

A full current cumulative install uses the commands above unchanged. The
installer reads the effective component catalogue before and after staging and
retains this new declaration, its complete sources and the original operator
registration. A saved application or source package that predates this family
needs the current original declaration and all selected sources; adding only a
browser module does not install the routing product.

For a source overlay from an already complete pinned application, the maintained
assembler can export this explicit family with its transitive local dependencies:

```sh
"$UPSTATE_PYTHON" -B "$UPSTATE_SOURCE/source_tools/application_assembly.py" \
  "$UPSTATE_SOURCE" \
  --family-component native-flow-routing \
  --family-against "$UPSTATE_APPLICATION" \
  --edition ACTUAL_FLOW_ROUTING_SOURCE_EDITION \
  --operation-id ACTUAL_EXISTING_OPERATION \
  --source-map "$UPSTATE_OPERATION/flow-routing-family.json.gz"
```

Use `--family-against` only with the actual existing receiving application. It
records exact destination preimages for source members already present. Without
that option the exported family still carries its complete original source;
the receiving composer continues to require an explicit compatible predecessor
before replacing a different installed file.

The family exporter preserves the original complete catalogue and fragment
bodies as selection provenance. It does not replace the destination catalogue
with a partial copy. Receive this author's
`integration/component_fragments/native-flow-routing.json` through the existing
source composition first, together with the matching maintained core/Native run
declarations when the host is older. The same assembler checks those selected
definitions before applying the family. Keep newer unrelated families and their
original authors' declarations. If a definition or source preimage differs,
compose that actual current source with its owner; do not strip the guard or
force an old full catalogue over the installed application.

With those maintained declarations already received, use the same source
composer and a fresh application output:

```sh
"$UPSTATE_PYTHON" -B "$UPSTATE_SOURCE/source_tools/application_assembly.py" \
  "$UPSTATE_APPLICATION" \
  --overlay "$UPSTATE_OPERATION/flow-routing-family.json.gz" \
  --edition ACTUAL_JOINED_APPLICATION_EDITION \
  --operation-id ACTUAL_EXISTING_OPERATION \
  --output "$UPSTATE_OPERATION/application-with-flow-routes" \
  --source-map "$UPSTATE_OPERATION/application-with-flow-routes.json.gz" \
  --zip "$UPSTATE_OPERATION/application-with-flow-routes.zip"
```

The original Workspace remains separate from the application. Flow routes reads
an actual completed NDR or SDR stage: retained arguments, direction/terrain/stream
rasters and their original companions. It follows that selected native graph and
creates a source-bound explanation; installation or receiving does not launch a
new scientific model. The source-only workbook project is not a replacement for
the original native project.

### Operate, receive and reopen the same saved routes

Use the full [Flow routes operator guide](../operator/ROUTING_PATHS.md). In the
existing authenticated browser, its adjacent
`source_tools/receive_flow_routing_browser.mjs` exports
`receiveFlowRouting({page, api, workspace, workspaceDirectory, runId, model,
points, directory})`. The caller supplies its original page/API, holds the same
receiving-directory lock and selects two distinct actual source cells. Each
point includes its row, column, title, interpretation notes and explicit
`stop_at_stream` choice. The helper preserves original request identities and
retains complete source/report downloads, current working history and the
operator's original selection.

After that original browser operation returns its `operation_file`, run:

```sh
"$UPSTATE_PYTHON" -B "$UPSTATE_APPLICATION/source_tools/receive_flow_routing.py" \
  --workspace /absolute/actual/completed-native/workspace \
  --browser-operation "$UPSTATE_OPERATION/flow-browser/operation.json" \
  --output-dir "$UPSTATE_OPERATION/flow-native-receiving"
```

Use the actual returned operation file if its owned directory differs. The
command receives both saved immutable reports, captures the complete Workspace
and application, restores them to a fresh destination and reopens every original
route/source identity. If that receiving destination already exists, it rejoins
the original archive through `portable.resume_restore` with the retained archive
SHA rather than accepting directory existence as a receiving result.

Register the returned `reopened_workspace` through the existing application
Workspace opening flow. In that registered Workspace, call the same module's
`receiveReopenedFlowRouting({page, api, workspace, operationFile, directory})`
with the original completed operation file and a separate owned capture
directory. It opens both original saved routes and compares their complete
records, graph documents and thirteen outgoing files through the real operator.

The report ZIP contains its twelve original non-ZIP report members. Original
native raster/argument/companion bodies have their own source downloads and
travel in the full Workspace archive. Keep those distinctions in the handover.
The browser course operates the actual served interactive HTML with its
maintained response policy before reopening the exact downloaded offline HTML;
it also opens the real SVG, terrain image, JSON, CSV, GeoJSON and kernel source.
The producer must personally LOOK at the resulting desktop and 390-pixel screens
and every attachment in its normal viewer, operate its controls and repair the
affected result before presentation. Retain `AGENTS.md` and
`CURRENT_OWNER_DIRECTION.md` version `2026-10-13.4` with this same receiving
course and original scientific operation.

## Owner-directed rendered-product inspection

Source: direct owner instruction of October 13, 2026. Repository copy version: `2026-10-13.1`.
Scope: owner-controlled work across providers, local and cloud runtimes, and current and future workers. Existing owner controls remain in force.

Before calling a client/prospect-facing app, website, dashboard, demo, report, presentation or export ready, the producing worker must open/run/render the exact outgoing version, LOOK at the rendered screen or its real screenshots, and operate the important user controls. Check the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Fix ugly, broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Code review, DOM counts, HTTP200, unit checks or another worker's approval do not replace seeing the actual product.

The Ecosystem product requires plain industrial design: readable tables, clear hierarchy, consistent typography/spacing, restrained controls, useful labels and responsive layouts. Keep the real workflows/data/computation. Reviews must lead directly to repairs and must not replace implementation/integration or become endless rechecking. The existing focused-validation policy remains; do not run broad suites or build a verification product.

Persist this instruction in the active owner-controlled instruction surfaces actually read by the relevant workers: global/project AGENTS/CLAUDE/GEMINI/rules, provider-specific boot instructions, source mirrors, cloud repository copies and current build/receiving guides. Include this instruction in every delegated child assignment, including assignments to another provider or runtime. Maintainers update their own consumed files and return exact paths, source/version and readback. A coordination acknowledgment alone is not propagation. Do not alter historical evidence or third-party/vendor policies. No forced restarts, new watchers or revival of owner-stopped work.

Inspect the actual completed scientific screens, reports, source pages and downloadable HTML in the real operator. Prior empty-Workspace screenshots are not completed-workspace acceptance. Preserve current engineering owners; other coordinators receive propagation rather than duplicate implementation. Continue native source/runtime/archive joins rather than diverting everyone to cosmetic review. The earlier October 13, 2026 10:00 a.m. Eastern checkpoint was superseded by Bryce's direct 10:46 a.m. renewal in CURRENT_OWNER_DIRECTION.md version `2026-10-13.4`. Continue the same unfinished application and native receiving work while preserving completed results and current process ownership.

Source assembly and standalone application handoffs retain the application-level instruction copies with their current guides. This file records an owner-requested product delivery requirement; it does not change provider safeguards, repository access controls, or existing authorization boundaries.
