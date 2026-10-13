# Receiving-water scientific report sources

TokenJunkieLabs • Maintained original Ecosystem Sciences application

This component turns one **saved receiving-water source plan** or one **completed
receiving-water analysis** into a retained scientific report document. Open that
document in the existing standalone scientific report composer, or append it to
the existing ordered source selection for a mapped report.

A source plan can be reported before a grid or native model run exists. An
analysis report retains the exact completed quantities and priorities already
saved in the Workspace. Preparing a report does not run a model, rebuild a plan,
recompute an analysis, solve a Monitoring design or change a source selection.

## Choose the saved study

Use exactly one of the following selections:

```json
{
  "plan_id": "EXACT_SAVED_PLAN_ID",
  "title": "Optional report title"
}
```

```json
{
  "analysis_id": "EXACT_COMPLETED_ANALYSIS_ID",
  "title": "Optional report title",
  "delivery_id": "OPTIONAL_EXISTING_SAVED_DELIVERY_ID"
}
```

Replace the illustrative identifiers with actual IDs from the existing
Receiving waters desk. A completed analysis resolves its own original plan; do
not supply a separate plan ID. Unknown fields and simultaneous plan/analysis
choices are rejected. Empty titles are rejected. An optional saved delivery is
validated before the first report write.

The title changes the report-source identity. The optional delivery ID does not:
the same retained scientific source can be appended to different ordered report
selections without copying or changing the source.

### What a source-plan report means

The dossier keeps the plan's title, immutable identity, source collection and
entry selectors, source edition and URI, original feature IDs and attributes,
designations, relationship rationale, coordinate reference system, complete
network when present, and original receptor/contribution geometry.

Three original relationship methods remain distinct:

| Original method | Meaning retained in the report |
| --- | --- |
| `source_area` | The published selected source polygon, with the source's stated meaning. |
| `geometric_context` | The explicit geometry and declared buffer. The geometric operation adds no flow-path evidence. |
| `upstream_huc` | The receiving HUC units and retained upstream ToHUC ancestors. The plan's original HUC12 resolution and stated limitations remain visible. |

The reported contribution area is the original projected geometry area in
hectares. It is not a pollutant load, concentration, exposure estimate or raster
valid-support area. Individual receiving areas can overlap; their areas must
not be summed as an unduplicated total. A source-only plan has no modeled
quantity, calculated priority, inferred intake load or completed native-run
claim.

Every saved receptor field is retained. The main dossier displays a concise source and relationship summary; linked records preserve the complete technical details. This includes original
native properties and explicitly recorded geometry-reader interpretation or
geometry operations when the saved plan contains them. This producer neither
repairs nor reinterprets geometry. A new source-plan edition produced by an
explicit geometry interpretation receives its own original plan identity.

### What a completed-analysis report means

The selected analysis must have state `complete`. Its exact plan record hash
must match the original saved plan. The producer copies every original
analysis and plan file, both immutable records and the unchanged
`receiving-water-delivery.json` inventory.

The numerical sections come directly from the maintained
`scientific_report.receiving_sections({"inventory": inventory})` formatter.
The producer does not recalculate or independently format the numerical
tables. Consequently, the existing definitions remain authoritative:

- The actual reporting or model-domain quantity scope.
- The selected pollutants and original physical units.
- Original baseline and alternative run identities.
- Fixed normalization, caps and weights.
- Original signed changes and distinct increased/avoided export priorities.
- Valid cells and quantity-specific support, separately from selected geometry
  and total selected pixel area.
- Unduplicated family unions. Different families can still overlap and their
  totals must not be added together.
- Individual receptor values, source classifications and relationship precision.

Original raster, geometry and tabular members remain companions to the source.
No unrelated native delivery or second model is required to prepare this
scientific source. The source does not turn land-export calculations into
measured receiving-water concentrations or a stronger flow relationship than
the original analysis supports.

## Use the application

1. Open **Receiving waters** in the current scientific Workspace.
2. Select an existing complete source plan or completed analysis.
3. Prepare its scientific report source using the existing queued operator
   action. The task retains the actual request, Workspace and saved result.
4. Choose **Open this report only** to replace the standalone scientific
   composer's draft source selection with this exact retained source and use
   its title. Choose **Add to current report** to keep the current draft's
   ordered sources and append this source once. The existing nonempty draft
   title remains when adding; an empty title uses the saved source title.
   These controls are available in the saved-source inventory, source details
   and completed task. Both pass the exact source selector through
   `openScientificReport({workspace_key, sources: [record.source], title,
   selection_mode: "replace" | "append"})`. The composer performs the
   selection change before its original rendering and export steps.
5. To include the same study in a mapped client report, choose **Open mapped
   report form**. That route uses the returned `delivery_selection` and
   preserves the saved delivery's original inputs and ordered source choices.

Saved sources can be reopened from the existing report-source inventory. A
saved study is still associated with its original Workspace and immutable
study identity after another plan or analysis is selected in the desk.

The typed source schema is the existing `upstate.observed-report/v1`.
The historical schema name does not classify modeled quantities as observations:
the source's report-context kind and explicit sections describe the actual
saved geography or completed model analysis.

## Native receiving commands

Run these commands from the actual application root in an equipped environment
containing the existing Workspace and maintained application. These are command
forms; the identifiers and paths below are placeholders.

Prepare a source-only plan dossier:

```sh
python -B model/receiving_water_report_cli.py \
  --workspace /absolute/existing/workspace \
  --output /absolute/new-receiving-result.json \
  prepare --plan-id EXACT_SAVED_PLAN_ID
```

Prepare an exact completed analysis:

```sh
python -B model/receiving_water_report_cli.py \
  --workspace /absolute/existing/workspace \
  --output /absolute/new-analysis-report-result.json \
  prepare --analysis-id EXACT_COMPLETED_ANALYSIS_ID
```

A complete selection file can supply the optional title and saved delivery:

```sh
python -B model/receiving_water_report_cli.py \
  --workspace /absolute/existing/workspace \
  --output /absolute/new-report-result.json \
  prepare --selection /absolute/receiving-water-report-selection.json
```

Use either the complete selection file or individual selection flags. Optional
`--title` and `--delivery-id` accompany the individual plan/analysis flags.

Verify a saved report source and derive its ordered selection:

```sh
python -B model/receiving_water_report_cli.py \
  --workspace /absolute/existing/workspace \
  --output /absolute/new-report-inspection.json \
  inspect EXACT_REPORT_SOURCE_ID --delivery-id OPTIONAL_SAVED_DELIVERY_ID
```

Omit `--delivery-id` when no saved delivery is selected. List manifest summaries:

```sh
python -B model/receiving_water_report_cli.py \
  --workspace /absolute/existing/workspace catalog
```

The CLI emits the complete result JSON on standard output and progress/errors
on standard error. Optional result files must be outside the scientific
Workspace. Prepare performs a complete inspection of the saved result before
reporting `receiving_verification`. This command does not itself render or
publish a scientific report; use the existing composer with the returned exact
source selector.

## Python and operator contracts

```python
from model import receiving_water_report_source as reports

record = reports.prepare(workspace, {"plan_id": exact_plan_id}, progress=callback)
verified = reports.inspect(workspace, record["id"], verify=True)
summaries = reports.catalog(workspace)
selection = reports.delivery_selection(
    workspace, record["source"], delivery_id=existing_delivery_id
)
```

The four maintained functions are:

| Function | Contract |
| --- | --- |
| `prepare(workspace, selection, *, progress=None)` | Capture and import one immutable saved study; return its complete record and current ordered delivery selection. |
| `inspect(workspace, key, *, verify=True)` | Verify the report identity, all retained members, original Workspace plan/analysis and source records, and imported recipe/member binding. |
| `catalog(workspace)` | Read saved record summaries without rereading large source bodies or raster companions on every UI poll. |
| `delivery_selection(workspace, source, delivery_id=None)` | Append the exact source once to an optional saved delivery's ordered sources, preserving other inputs and removing a stale observed-context binding. |

The backend-only operator provider exposes queued action
`receiving.water.report.prepare` and read route
`GET /api/receiving-water-report` with `action=catalog` or
`action=get&id=...`. Optional `delivery_id` on a saved-source read derives
the corresponding ordered delivery selection. The Receiving waters extension
uses the existing shared host and task queue; there is no additional controller
or native execution queue.

A complete record uses schema `upstate.receiving-water-report-source/v1` and
contains `id`, `state`, `identity`, `title`, `created_at`, normalized
`selection`, exact `source`, `summary`, `files` and `record_sha256`.
The returned `delivery_selection` is computed for the caller and is not
written into the immutable source record.

The source selector is:

```json
{
  "source_collection_id": "IMPORTED_ORIGINAL_SOURCE_COLLECTION_ID",
  "source_id": "receiving-water-scientific-report"
}
```

Summary fields distinguish `mode: source_plan` from
`mode: completed_analysis`, and include plan/analysis IDs, receptor and original
source-entry counts, selected families, and analysis scope/pollutants/run IDs
when an analysis exists. Source-only scope/run fields remain null or empty.

## Complete retained source and interruption recovery

Each report lives under:

`receiving-water-report-sources/<report-source-id>/`

The retained members include:

| Member group | Retained contents |
| --- | --- |
| `intent.json` | Fixed creation time and identity for this exact capture. |
| `native/plan/` | Original plan JSON and every original geometry/file descriptor. |
| `native/analysis/` | Original completed analysis JSON and all original analysis members, when selected. |
| `native/receiving-water-delivery.json` | The unchanged maintained exporter inventory for an analysis. |
| `original-sources/<selector-digest>/` | Complete selected source body and companions, full entry/collection records, original collection manifest bytes every original plan-source identity, and explicit contextual reference locations using that selector. |
| `original-source-index.json` | Exact source selectors and retained member descriptors. |
| `implementation/` | Actual capture producer/plan-reader source bodies and, for an analysis, exporter/scientific-formatter bodies. These are capture provenance; original historical engine hashes remain separately identified in the saved plan/analysis. |
| `report-source.json` | Existing typed scientific recipe, complete input identities, scientific sections and original file links. |
| `sources.json` | Stable original source importer manifest. |
| `prepared.json` | Complete prepared-source file identities for replay before/after import. |
| `report.json` | Immutable completed source record and Workspace-relative retained file identities. |

Every selected original source body and companion is retained. The original
collection manifest is preserved even when it names other entries; only entries
actually selected by this plan are copied. Duplicate source selectors in the
plan retain their separate original selections and feature identities while
sharing one exact source-body capture. Explicit nested contextual selectors,
including utility intake references, also retain their original bodies and
companions even when they did not participate in geometry preparation.

The immutable report ID binds the Workspace, normalized selection, exact
plan/analysis record hashes, every resolved original/contextual source entry and
manifest identity, and actual capture implementation hashes. The
original plan/analysis method identities remain unchanged. Updating application
code may produce a new capture edition; existing complete reports remain
inspectable from their saved implementation identities and retained bytes.

Member copies publish atomically and refuse unequal existing files. For an
analysis, the producer seeds the original plan/analysis members before calling
the maintained exporter. That exporter then verifies the exact existing copies
and creates its unchanged inventory. A crash cannot turn an incomplete large
copy into an accepted source member.

A retry uses the fixed intent time, exact prepared recipe, all companion hashes
and the same importer manifest. It verifies the original immutable records
again before source import. A crash after import but before final record
publication reuses the same content-addressed source collection. Corrupt or
different retained members are rejected, not silently replaced.

The existing observed-context binder verifies the recipe body and every
companion. The producer additionally compares the exact imported member map
against the retained recipe's complete input map, preventing a substituted or
incomplete imported document from being accepted.

## Transfer, installation and source boundaries

The producer holds the Workspace-root
`.receiving-water-report-source.lock` before any report writes. It never takes
`.workspace.lock` or a native model/analysis execution lock. Existing portable
capture takes the Workspace lock before this report lock and retains the new
folder through the original recursive Workspace capture. Preserve all other
existing capture locks and source roots when composing an installation.

The complete application component is declared through
`integration/component_fragments/receiving-water-report.json`. The existing
fragment loader adds its owned producer, CLI, guide, backend provider and browser
helper while preserving all existing component families and native manifests.
Use the maintained component installer and current original host interfaces;
do not replace the scientific report formatter, original Receiving waters
engine or shared application server.

This retained report source carries the full chosen study records and original
source companions. The complete Workspace remains the transfer route for native
run inputs, execution environment, other studies and further calculations.
Capturing an existing study is not a new native execution or a delivery to an
external recipient.

## Retained task-result controls

The registered Receiving waters desk supplies its original `taskActions` method for queued plan, source and analysis results. The report provider decorates a completed source task with `_extension_task_actions: {"extension_id": "receiving-waters"}`. The shared host resolves this hint only to an already registered desk with an explicit `client.task_actions` method; it never imports a module supplied by a task payload. The original controller generates the Inspect source, Open this report only and Add to current report controls, which retain the exact captured Workspace and source identity. The installer removes the legacy mounted controller and admits the published version 6 descriptor when applying version 7.

## Receiving the explicit report choices

Use the current browser helper with the existing host `openScientificReport`
and scientific composer's `selection_mode` contract. Both actions operate on a
saved source edition; opening or adding it does not queue source preparation or
publish another immutable report. Replacing changes the current composer draft,
including its title, while existing saved editions remain unchanged. Adding
preserves the current source order and title and ignores sources already selected.

In the actual received application, start with a different saved source in the
composer. From Receiving waters, use **Open this report only** and inspect the
resulting source list and title. Return to the saved source and use **Add to
current report** with another source already selected; inspect the order and
repeat the action to check that no source is duplicated. Exercise the saved
inventory, details and completed-task controls in the original Workspace.

Open and inspect every outgoing artifact: HTML, PDF, each map, and archive
contents. Open the received project and use its relevant controls. Capture and
look at real rendered screenshots at desktop and narrow widths, including both
report choices and the resulting source lists. The native producing owner
inspects the actual outgoing product and repairs visible errors. Retain the
actual source selectors, resulting edition IDs and original operation outputs
with the existing receiving course.
