# Regional delivery operator guide

TokenJunkieLabs · Upper Savannah watershed product

## Complete the selected native work

The regional-delivery command takes a completed native-model receiving manifest and produces the selected map families, a technical report, editable GIS delivery, scenario decision tables, and a separately reopened scientific workspace. It keeps the original source collection, grid, profile, scenario, run and comparison IDs connected throughout the handoff.

Run from the product application directory using its GIS-enabled Python environment:

```sh
python -B -m model.cli regional-delivery "$ECO_RECEIVING" \
  --output "$ECO_OUTPUT" --receive-directory "$ECO_RECEIVED"
```

`ECO_RECEIVING` is the existing `workspace/native-model/<selection-id>/receiving.json` produced by the original native batch. `ECO_OUTPUT` and `ECO_RECEIVED` are separate output directories outside the original workspace. Set them to the actual paths on the receiving machine. If the original workspace has moved, add the global `--workspace "$ECO_WORKSPACE"` before `regional-delivery`.

A currently executing native plan can continue into the same delivery by adding `--complete-delivery "$ECO_OUTPUT" --receive-directory "$ECO_RECEIVED"` to its existing `python -B -m model.native_batch` command. Preserve the original plan, source reference and source manifest arguments. When native receiving already exists, use the regional-delivery command directly.

The batch does not cap scenario counts. The required map families generate five shared baseline/priority maps and two future-map PDFs for each selected alternative. Baseline plus two alternatives therefore produces nine PDFs across seven families.

## Follow the actual work

The command prints a progress line when it starts maps and packaging, builds scenario decision tables, and reopens the editable project. `progress.json` retains the last phase and a concrete error if a step fails. `regional-delivery.json` is written after all three phases complete. Repeat the same command to reuse the retained delivery stages and receiving result. A changed selection uses another output directory; the original scientific selections remain available.

The final record points directly to every map, report, scale definition, summary, GIS archive, native working archive and reopened workspace. `scenario-summary.json`, `scenario-summary.csv` and `scenario-summary.md` contain the same retained quantitative results in machine, spreadsheet and readable forms. The GIS package navigator is the `navigator` path. The working archive contains original retained source bytes, aligned inputs, native model outputs and logs, scenario/profile definitions and the delivered application.

## Read the comparison correctly

Nitrogen and phosphorus run artifacts are kilograms per pixel per year; sediment artifacts are metric tonnes per pixel per year. InVEST 3.20's native per-hectare outputs are converted by the producer using the actual pixel area. At 30 by 30 metres, this area is 0.09 hectares. The stored `sum_units` annual totals are already converted. The decision tables use those retained run artifacts directly.

A change is alternative minus baseline. A negative export change is a reduction; avoided export is the opposite sign. Percentage reductions are calculated only when the baseline and alternative cover the same valid cells and the baseline total is positive. The table explains a missing percentage when these conditions do not hold. Land-cover changes, parameter changes and combined sensitivity cases are labeled from their actual stored selections.

Each pollutant uses one common change legend across all selected alternatives. The cap is the largest exact 98th percentile of the alternatives' nonzero absolute cell changes, unless `map_settings.display_percentile` selects another percentile. The same cap applies to both positive and negative change. Display caps affect the picture; quantitative GeoTIFF values and totals remain available in full. `maps/display-scales.json` records the cap, percentile, population, units and zero-range handling. The combined priority uses its fixed dimensionless zero-to-one scale.

## Source-water overlay labels

The drinking-water overlay uses the retained source's geography. SCDES surface-water protection polygons are protection areas, while the receptor-network product derives upstream watershed membership from original HUC links. Keep each product's name with its own geometry when reviewing the maps and report.

A source overlay selection accepts an optional `label` alongside its `source_collection_id` and `source_id`. For the original SCDES surface-water protection polygons, set `label` to `Surface-water protection areas`. The renderer retains this explicit caption and appends the source vintage. When no caption is supplied, the drinking-water fallback is `Drinking-water source areas`. High-quality-water styling continues to follow its source role even when its displayed caption is customized.

## Operate the received application

The command restores `scientific-workspace.zip` to `ECO_RECEIVED`, then runs that delivered application's own CLI against `ECO_RECEIVED/workspace`. It saves the actual CLI response as `reopened-workspace.json` and checks that the selected complete runs and comparison are present.

To continue the existing browser workflow from that received project:

```sh
python -B "$ECO_RECEIVED/application/operator/server.py" \
  --workspace "$ECO_RECEIVED/workspace" \
  --operator-state "$ECO_OUTPUT/browser-state" \
  --restore-directory "$ECO_OUTPUT/browser-restores" --port 0
```

Open the local URL returned by the operator. Use the existing project workflow to inspect the selected inputs and scenarios, compare current and future results, inspect spatial features, save a review, and open the delivered outputs. The original `operator/receiving.py` browser exercise remains compatible; its native handoff validation now shares the same implementation as the delivery command.

## Prepare Bryce's walkthrough

| Bryce does | What the prepared product shows | Meaning and useful explanation |
| --- | --- | --- |
| Open the received project | Original project title, selected grid, completed runs and comparison | This is the editable project and its saved modeled scenarios. |
| Show the source and grid context | Retained editions, source hashes, reporting area and upstream domain | The scientific flow domain and the reporting geography are recorded separately. |
| Open the current nutrient and sediment maps | Current selected physical exports and source metadata | These maps show annual modeled export under the selected source editions and parameter profile. |
| Compare the alternatives | Shared change legends, explicit scenario selections and annual decision tables | The map shows where export changes; the table shows the modeled annual quantity. |
| Open source-water and high-quality-water priorities | Original receiving-water overlays and combined priority | These views connect the modeled export priorities with the actual water-resource geography. |
| Open the saved GIS delivery and report | All selected map families, metadata, working project and interpretation | The delivered materials can be reviewed and reused with their original inputs and assumptions. |

The active receiving worker should record the actual opening, scenario comparison, export and reopen sequence from this prepared project, with screenshots and elapsed times. Keep a completed prepared result available while a fresh source-bound case runs in the original application.

## Retained grid and complete package

Each delivery carries a copy of its original completed `grid/grid.json` as a declared package artifact. The manifest's model grid ID, retained grid ID and original record ID must agree. The package audit compares every physical raster with that original record: projected metre CRS, dimensions, all six affine coefficients, pixel area and actual added context. The recorded context is checked against the model selection.

An unrotated 30-metre grid with positive added context uses the regional audit scope. Other original native grids, including a zero-context selection, use the source-native scope. This preserves the actual source edition: 15 × 15 metre cells are 0.0225 hectares; 30 × 30 metre cells are 0.09 hectares; 300 × 300 metre cells are 9 hectares. Read the actual retained grid record for the delivery being reviewed. A source-native result remains identified by its original geography and resolution.

The package engine writes into the delivery's own `package` directory, provided that directory contains none of the declared inputs. It captures every declared artifact, including the native grid record and editable working archive, and verifies their original bytes. On compatible Linux filesystems it creates independent copy-on-write files to reduce temporary disk use. Other filesystems use the same streamed copy path. The capture index records the declared, cloned and streamed byte totals.

Large regional archives have no implicit per-file, total-byte or artifact-count cutoff. Operators may supply an explicit storage budget when invoking the package engine directly:

```sh
python -B package_delivery.py pack "$ECO_DELIVERY/delivery.json" "$ECO_DELIVERY/package" \
  --max-file-bytes 21474836480 --max-total-bytes 107374182400
```

These example budgets are 20 GiB per artifact and 100 GiB total; omit the flags to capture all declared original artifacts. The ordinary regional-delivery command uses the unrestricted path. The same limits mapping is available to the Python API and verifier; metadata budgets remain independently selectable. Source identity and content verification apply in both cases. Packaging still needs disk space for its streamed copies, final archive and verification outputs; copy-on-write support depends on the receiving filesystem.

A completed matching package is reused by the existing delivery resume path. A failed earlier package remains separate while the next attempt selects a fresh package directory. The retained grid is part of the captured manifest and remains available when the package is independently reopened.

## Source integration

This change set carries complete files plus unified diffs against the retained source base. Apply the diffs to the current shared source so contemporary ensemble, receptor and stage-control additions are preserved. Resolve overlapping hunks by combining the owned functions. New files are `model/regional_delivery.py`, `model/scenario_summary.py`, `model/raster_stats.py` and this guide. Companion raster changes update `model/rasters.py`, `Workspace.prepare_grid` and `model/GRID.md`.

This complete overlay includes the regional delivery/map integration, scenario-summary module, and resumable raster alignment/exact statistics component together. The active cumulative-source owner can apply its diffs to the current shared application before the native receiving run.

Model references: [InVEST 3.20 NDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html) and [InVEST 3.20 SDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html).
