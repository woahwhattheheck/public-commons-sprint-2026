# Saved land-cover comparisons in Scientific Reports

Open a completed **Land-cover changes** edition and choose **Prepare scientific report**. Once the source is ready, **Open Scientific Reports composer** opens the existing Scientific Reports composer. Combine it with retained water-quality, receiving-water or conservation sources in the desired order. The composer produces its ordinary saved PDF, HTML, figures and original source package.

The source uses the original completed ledger. It retains the interactive land-cover report, all summary/support/group/transition CSVs, the full numerical JSON, transition and polygon-fraction GeoTIFFs, original selected polygon geometry and properties, original input binding and complete land-cover report ZIP. The original raster source bodies and declared companions remain attached. Native-run mode additionally retains the actual run raster dependencies verified against the computed ledger's input hashes.

## What the report means

The baseline and each alternative keep their selected order and original titles. Retained annual-source labels use the source's own vintage string and band selection. Run-based comparisons use the original saved scenario title and run ID. No calendar years are inferred.

Areas are the existing reducer's fractional polygon/pixel intersections in the reported CRS. The report repeats the original area basis and projection method. Equal-area remains the normal regional choice; a deliberately selected projected planar analysis, such as the simulated EPSG:26917 teaching case, retains that exact label.

The unique study-area union appears once. Each original reporting polygon appears in the complete watershed inventory and comparison tables. Overlapping polygon rows must not be summed into the union. Full original geometry is attached separately from the existing browser display geometry.

The saved support choice remains explicit:

- `all`: every comparison uses the common supported pixels across the reference and every selected alternative.
- `pair`: each reference/alternative comparison has its own supported intersection.

The report presents raster-valid, supported-class, pairwise-valid and selected-analysis areas separately. Reference-only, alternative-only, neither-supported, excluded-by-other-alternatives and unknown-class areas are retained. A change quantity with no analysis support stays unavailable. Changes are land-cover areas; modeled nitrogen, phosphorus and sediment values belong to their original separate model reports.

The unique-union section includes every changed-class transition and the original group gains, losses and net changes. The watershed tables include every original polygon. Complete per-polygon transition detail remains in the original CSV, JSON and interactive report, linked from the composed report. Display tables format numeric values for reading; the retained numerical JSON and CSV preserve the original exported quantities.

## Native source interface

Use the same existing application and Workspace that own the completed ledger:

```python
from model import landcover_report_source, observed_report_render
from model.workspace import Workspace

ws = Workspace(original_workspace, create=False)
source = landcover_report_source.prepare(ws, {
    "ledger_id": original_completed_ledger_id,
})
preview = observed_report_render.prepare(
    ws, [source["source"]], title=source["title"],
)
report = observed_report_render.render(ws, preview, new_report_directory)
reopened_source = landcover_report_source.get(ws, source["id"])
```

`prepare` accepts only `ledger_id` and optional nonempty `title`. It verifies the existing ledger through `landcover_workspace.inspect`, copies its original files and imports a normal `OBSERVED_CONTEXT` document. It creates no new land-cover or hydrology execution. Its return value contains `id`, `ledger_id`, `title`, `source`, `observed_binding`, `files` and `members`. All descriptors in the returned receipt are relative to `ws.root`.

`list_sources(ws, ledger_id=None)` returns completed source summaries. `get(ws, id)` verifies the receipt, project, every retained member, original imported recipe and exact observed-context binding. A repeated identical preparation reopens its completed source. A changed producer or original edition creates a new source identity and leaves previous editions intact.

The command-line entry point uses those same functions:

```sh
python -B -m model.landcover_report_source_cli --workspace /actual/workspace prepare --ledger-id ACTUAL_COMPLETED_LEDGER_ID
python -B -m model.landcover_report_source_cli --workspace /actual/workspace list --ledger-id ACTUAL_COMPLETED_LEDGER_ID
python -B -m model.landcover_report_source_cli --workspace /actual/workspace inspect --id ACTUAL_REPORT_SOURCE_ID
```

Use the real returned IDs. The source is saved under `landcover-report-sources/<source-id>`. Its ordinary `sources.json` and `landcover-report-source.zip` can carry the exact original report document and companions to another Workspace; the receiving source collection retains its own imported identity. In that case the Scientific Reports composer consumes the receiving source choice. The old project-local source receipt is reopened only with its original complete project.

## Original-data receiving and complete project transfer

Continue the already accepted annual or native-demo operation after its ledger completes. Prepare this source from that ledger ID, reopen it, then render through the existing Scientific Reports composer. Return the actual source ID, collection/document choice, completed report operation and generated PDF/HTML descriptors.

To continue the same native report through the application's ordinary complete archive:

```python
received = observed_report_render.archive_report(
    ws, new_report_directory, report, new_project_archive,
    new_independent_restore_directory,
)
```

Use distinct paths outside the active application and Workspace. The existing receiver verifies the complete archive inventory, project identity, original source selection and restored report files. The archive includes the original land-cover edition, its imported input collections, newly prepared report source and saved scientific report. Existing land-cover CLI receiving can independently inspect the original ledger through the restored application's own interpreter command.

The additive component depends on the maintained land-cover source adapter and Scientific Reports components. The current Land-cover installer carries the model, provider, descriptor, UI and guide together while preserving the installed shared route policy.
