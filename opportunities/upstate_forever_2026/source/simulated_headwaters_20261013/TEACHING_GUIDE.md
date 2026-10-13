# Simulated Piedmont headwater: teaching case

This case asks a practical question: how do the selected model's annual nitrogen, phosphorus and sediment exports change when explicitly selected pasture and cropland are restored to forest? Open the retained simulated source edition, the unchanged baseline and the saved restoration alternative in the existing Upper Savannah Scientific Workbench. The native model results and their comparison come from those saved inputs.

## Open the working case

Use the current complete application and the case's retained Workspace. Launch its existing operator with the receiving package's absolute Workspace and operator-state directories, then open the full local URL printed by the server. The saved operator view and rehearsal retain the scientific IDs. Keep application source and Workspace data in separate directories.

Start with **Guided journey** and choose the saved baseline. **Operator rehearsal** holds the corresponding teaching record, original timings, screenshots and recording. Use the original result downloads to open the report. The package's receiving receipt names the exact source revision and saved project, baseline, alternative, comparison and delivery.

## The question and what changes

The source edition is a deliberately simulated Piedmont-style headwater catchment. Its landscape, terrain, soils, rainfall and biophysical coefficients are declared assumptions chosen to exercise the actual import and model workflow. The exact generated extent, resolution, land-cover areas, coefficients and changed-cell counts are retained in the case inputs.

The saved **Simulated present land cover** baseline covers 1,296 hectares: 14,400 cells on a 120 × 120 grid, with EPSG:26917 coordinates and 30-metre cells. The **Simulated 90 m riparian restoration** alternative converts 236 pasture/hay cells and 399 cultivated-crop cells to forest: 635 cells, or 57.15 hectares. Its retained mask selects those cells within 90 metres of the generated valley axes. The profile, grid and remaining landscape stay selected explicitly. Read the actual saved raster edit masks and before/after class counts: those show the implemented change. If another saved alternative changes a different parameter or land-cover area, give it its own comparison.

Say: “This is a teaching landscape. We change a defined part of it, run the same scientific model, and inspect the saved outputs.”

## Walk through the existing application

| Step | Open and do | Read from the saved case | Explanation |
| --- | --- | --- | --- |
| 1. Source | Original sources → selected simulated edition | Generator assumptions, original input files, source units, source date and exact table | The run is tied to these retained inputs. |
| 2. Geography | Model grids → selected grid; Spatial review | Coordinate system, cell size, model domain, reporting polygon and land-cover map | The model calculates on the declared grid; the reporting mask defines the supported totals. |
| 3. Assumptions | Parameter profiles → selected profile | Actual NDR/SDR parameters, class codes and biophysical table | The profile states how land-cover classes and model parameters enter this run. |
| 4. Change | Land-cover scenarios → baseline and restoration | Retained raster mask, source and target class codes, patch order and changed area | The alternative changes an explicit part of the original landscape. |
| 5. Calculate | Native model runs or Run programmes | Run IDs, selected NDR/SDR stages, actual logs, start/end times and output states | Wait for the actual selected stages; inspect a failure's original log and continue the same saved run after repair. |
| 6. Compare | Saved comparison | Baseline and alternative totals, common valid cells, area, signed differences and units | Explain the sign printed by this particular comparison. |
| 7. Map | Spatial review and complete delivery | Case name, extent, legend, quantity, unit and common scale | Color describes the selected quantity; compare like quantities on the displayed common support. |
| 8. Export | Complete delivery → original report and downloads | Actual maps, physical layers, methods, original source inputs and package inventory | The exported files belong to this exact saved calculation. |
| 9. Reopen | Guided journey → Save view and transfer project → Project continuity | The independently received project identity, selected results, source inputs and saved notes | Open the received project and show the same result before adding a separate local note. |

## Read the physical quantities correctly

NDR nitrogen and phosphorus exports are annual mass quantities. The original native export rasters retain per-pixel annual mass: kilograms for N/P and metric tonnes for sediment. The Workspace also supplies rate layers in kilograms per hectare per year for N/P and metric tonnes per hectare per year for sediment. A square 30-metre cell has 900 square metres, or 0.09 hectare. The Workspace derives its rate layers using the actual cell area; retained mass rasters and reports preserve the physical mass and valid reporting support when forming totals. Read the emitted artifact's unit and summary rather than summing a rate raster directly.

The ordinary native comparison reports **alternative minus baseline**. A negative export difference means lower modeled export under the alternative. Paired ensemble products use their own printed **baseline minus alternative** reduction convention, where positive values mean a reduction. Read and state the selected product's sign; do not transfer a sign from one view to another.

Inspect common valid support before interpreting a difference or percentage. The report's original total and its paired common-cell total can cover different supported areas. A percentage needs a nonzero baseline with the reported compatible support. The full spatial pattern is useful even when changes vary across the catchment.

The restoration case is an experiment under the declared assumptions. Explain the computed result that actually appears, including an increase, near-zero response or mixed spatial response if returned. A diagram, display scale or expected ecological direction cannot replace the native result.

## A short spoken walkthrough

1. “Here is the simulated catchment and the source edition used by this saved study.”
2. “These are the terrain, land cover, rainfall and soil inputs, and this table defines the selected model assumptions.”
3. “This is the baseline. In the alternative, the selected pasture and cropland inside this raster mask becomes forest.”
4. “Both cases use this same grid and profile. These logs and stage times show the calculations that produced their outputs.”
5. “The comparison displays the actual annual quantities and the common area used to calculate their change.”
6. “This map shows the selected physical quantity and its unit. The report retains the inputs and interpretation alongside it.”
7. “I am downloading the working archive, receiving it into a separate directory and reopening the same project and saved results.”

Insert the actual saved values while presenting step 5. Use the generated result sheet or the original comparison view so values cannot drift from the selection.

## Screenshots and recording

Capture the actual application with the selected case visible. Use these six frames as the core story: source and simulated identity; grid and reporting area; restoration mask and changed classes; completed native stage log and timing; comparison plus readable map legend; independent received project with the same saved result. Retain the screenshot files through Operator rehearsal so their original identities travel with the teaching packet.

Record one uninterrupted short walkthrough of those same controls after the run completes. Include a real download and the received project's opening route. During a fresh calculation, capture the queue and live logs separately; a prepared result remains available for the rest of the explanation. Keep long model waits out of the concise recording while retaining their actual timestamps and logs.

Inspect a normal desktop width and a narrow layout. Fix obscured controls, unreadable legends, clipped units, stale selections and failed downloads in the maintained application. The case uses its existing local server and authorized browser route.

## Timing

Report three actual intervals separately: input generation/preparation; native baseline/alternative calculation; export/transfer/reopen. The existing task and native stage records supply their starts, ends and states. Browser interaction time is the walkthrough time, not a model benchmark. A repeated request that reuses a completed native stage remains a reused result.

## Bind the actual result to the teaching programme

The native runner `source_tools/simulated_headwaters.py` writes `demo-receiving.json` inside its selected output directory. Its schema is `upstate.simulated-demo-receiving/v1`; it retains the actual saved source, grid, profile, run, comparison, delivery and optional spatial-review IDs. Finish the baseline, alternatives, comparison and native-study delivery before freezing the recorded teaching selection.

On the receiving host, use the complete application and its actual scientific Python. Supply the existing browser runtime in a private JSON file with exactly these keys: `node`, `playwright_module`, and `executable`. Each value is the absolute installed path. Select a supported browser that can open this application's local operator.

~~~sh
python -B source_tools/simulated_headwaters_rehearsal.py \
  --receipt /owned/demo-output/demo-receiving.json \
  --workspace /owned/simulated-headwaters-workspace \
  --output /owned/simulated-headwaters-teaching \
  --browser-config /owned/private/browser.json \
  --run
~~~

Replace the example absolute paths with the received case's actual locations. The explicit Workspace override supports relocating the same saved project. The adapter checks the selected native records and writes the original receipt, this guide and `input.json`. The full programme then uses `operator/rehearsal_receiving.py` for its original task, screenshot/recording and backup/restore lifecycle.

To stage the exact input before execution, omit `--run`. Once the input is written, retain it with the same output directory and browser selection. A changed teaching edition receives a separate output directory; existing original task requests remain intact.

The actual programme's native checkpoint is `results/native.json`; final result is `results/complete.json`. Screenshots, recording and browser measurements remain under `browser/`. The final ZIP includes the retained original requests, teaching files, media, scientific archives and independent receiving results.

For a configured browser whose continuation will use this same host and unchanged input, `--run --native-only` saves the native phase first. Continue through the maintained receiver without `--native-only` when its authorized browser interval is ready:

~~~sh
python -B operator/rehearsal_receiving.py \
  --input /owned/simulated-headwaters-teaching/input.json
~~~

When the model executes on a different host, first receive its completed scientific archive on the browser host and bind the receipt to that receiving Workspace. The teaching run opens those saved native results; it does not recalculate the models. Reuse the original source and actual receiving identity when selecting the Workspace.

## Retained handoff

The complete handoff contains the simulated original inputs and their assumptions; application source; original and restored Workspace identities; saved run/comparison/delivery IDs; readable report and maps; physical GIS outputs; source and runtime metadata; actual timing; screenshots/recording; and this teaching explanation. The maintained rehearsal receiver saves these within the scientific archive and its accompanying teaching packet.

The owner-directed build interval ends **13 October 2026 at 14:00 UTC (10:00 Eastern)**. Preserve the latest completed package and the same operation's current checkpoint at that time.

## Maintained application references

This teaching case uses `START_HERE.md`, `operator/GUIDED_JOURNEY.md`, `operator/REHEARSAL.md`, `operator/RECEIVING.md`, `PROGRAMMES.md`, and the native model/source definitions retained with the application. Their existing controls and scientific contracts own the operations described above.
