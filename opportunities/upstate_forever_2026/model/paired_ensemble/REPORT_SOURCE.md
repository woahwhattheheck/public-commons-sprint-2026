# Paired ensemble scientific reports

The Paired raster analysis desk now continues a completed analysis into the
maintained scientific report composer. It carries every original quantitative
raster, member table, source/run/profile identity, overview and report companion.
The original model queue, ensemble computation and saved report renderer remain
in charge of their existing operations.

## In the maintained application

Open **Paired raster analysis**, choose a complete saved result, and select
**Add to scientific report**. The original queue runs
`paired_ensemble.report_source` with its existing request identity. It retains
and imports the complete scientific source and opens the existing composer with:

```javascript
host.openScientificReport({
  workspace_key: originalWorkspaceKey,
  sources: [{source_collection_id, source_id: 'paired-ensemble-scientific-report'}],
  title: originalResultTitle
});
```

The composer retains an existing draft and appends this source once. Other
selected studies keep their order. Its normal Preview, Render, PDF/HTML/Markdown,
complete report export and saved-edition controls apply. Adding another ensemble
creates another ordinary retained source; it never recomputes the watershed.

The ensemble view preserves its scientific selection when preparing a report.
Its original operation identity recovers a lost queue response. A completed
handoff survives detaching/remounting, so reopening the view does not silently
re-add a source that the user deliberately removed from a report draft. A new
explicit button press can add it again. An old task response cannot append its
source to a different workspace.

## Original Workspace and command line

```python
from model.workspace import Workspace
from model.paired_ensemble.ensemble_report_source import prepare
from model import observed_report_render

workspace = Workspace('/existing/workspace')
source = prepare(workspace, {'ensemble_id': completed_ensemble_id})
preview = observed_report_render.prepare(
    workspace, [source['source_choice']], title=source['title'])
result = observed_report_render.render(workspace, preview, '/outside/report-output')
```

```sh
python -m model.paired_ensemble.ensemble_report_cli prepare \
  --workspace "$WORKSPACE" --ensemble-id "$ENSEMBLE_ID"
python -m model.paired_ensemble.ensemble_report_cli render \
  --workspace "$WORKSPACE" --ensemble-id "$ENSEMBLE_ID" --out "$REPORT"
```

Use the existing Workspace backup to carry the imported source and scientific
report editions. The source import uses the unchanged `upstate.sources/v1`
manifest and `upstate.observed-report/v1` recipe consumed by the native report
renderer. The installed contribution fragment selects the original
`paired-ensemble` and `observed-context` dependencies. Receive this complete component through the usual cumulative
application installation and reopen the operator to load its registrations. The existing paired-analysis backend, designs, controls, selected-result
view and task poller remain unchanged. The additional report registration uses
that same operator queue, and its browser adapter attaches beside the current
desk’s export controls. This edition adds no server or background worker.

## Offline complete-result receiving

A result project exported by the existing ensemble feature can be received using
its existing `ensemble_cli receive` command. Prepare its complete scientific
source without loading an InVEST runtime or submitting any model jobs:

```sh
python -m model.paired_ensemble.ensemble_report_cli capture \
  --project "$RECEIVED_RESULT" --out "$SOURCE_DIRECTORY" \
  --zip "$SOURCE_ARCHIVE"
python -m model.paired_ensemble.ensemble_report_cli inspect \
  --source "$SOURCE_DIRECTORY/$REPORT_SOURCE_ID"
```

The archive contains `sources.json`, `report-source.json`, the exact original
quantitative/report files under `original/`, a full-precision scientific summary,
its exact report-producer and storage implementation, and its immutable capture
record. Extract it into a new directory and use the
original `Workspace.import_sources(path / 'sources.json')` to receive it in an
independent Workspace. Its source ID is `paired-ensemble-scientific-report`;
select the returned collection ID in the existing composer. The original HTML
and retained grayscale raster overviews remain directly openable offline.

Capture and export reuse identical completed products. A different title,
original file set, original calculation or producer version creates a different
report source. Interrupted captures resume from their unchanged intent and
already copied members. Source bytes are streamed and checked while copying;
large full-resolution rasters are not loaded into new numerical arrays.

## Scientific presentation

Every selected pollutant receives its own common-support population, physical
units, complete paired totals and selected-population distribution. Positive is
baseline minus alternative. Nutrients remain kg/year, sediment remains metric
tonnes/year. The native per-pixel improvement threshold remains separate from
the sign of a member's whole-area total. Basin quantiles are the original
quantiles of basin member totals, not sums of per-pixel quantiles.

Selected and planned member counts remain distinct. A fraction improving is a
fraction of explicitly tested members, not a probability of success. Common,
partial and missing support stay explicit. A zero baseline denominator is
unavailable; negative original inputs and missing native IDs are retained in the
complete originals. A fixture, teaching case or native modeled input keeps its
original kind and description in both the report and source metadata.

The report's table display rounds finite values to nine significant digits.
The original JSON, CSV and GeoTIFF quantities are copied byte-for-byte. Each
source retains `original/selection.json`, `original/analysis.json`,
`original/summary.json`, `original/paired-members.csv` and all originally declared
artifacts and report members. `science-summary.json` carries the complete
unrounded member-direction counts and original distributions used by the prose.
