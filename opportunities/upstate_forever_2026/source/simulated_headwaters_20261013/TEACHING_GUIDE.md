# Simulated Piedmont headwater: teaching case

This case asks a practical question: how do the selected model's annual nitrogen, phosphorus and sediment exports change when explicitly selected pasture and cropland are restored to forest? Open the retained simulated source edition, the unchanged baseline and the saved restoration alternative in the existing Upper Savannah Scientific Workbench. The native model results and their comparison come from those saved inputs.

## Open the working case

Use the current complete application and the case's retained Workspace. Launch its existing operator with the receiving package's absolute Workspace and operator-state directories, then open the full local URL printed by the server. The saved operator view and rehearsal retain the scientific IDs. Keep application source and Workspace data in separate directories.

Start with **Guided journey** and choose the saved baseline. **Operator rehearsal** holds the corresponding teaching record, original timings, screenshots and recording. Use the original result downloads to open the report. The package's receiving receipt names the exact source revision and saved project, baseline, alternative, comparison and delivery.

## The question and what changes

The source edition is a deliberately simulated Piedmont-style headwater catchment. Its landscape, terrain, soils, rainfall and biophysical coefficients are declared assumptions chosen to exercise the actual import and model workflow. The exact generated extent, resolution, land-cover areas, coefficients and changed-cell counts are retained in the case inputs.

The saved **Simulated present land cover** baseline covers 1,296 hectares: 14,400 cells on a 120 × 120 grid, with EPSG:26917 coordinates and 30-metre cells. The **Simulated 90 m riparian restoration** alternative converts 236 pasture/hay cells and 399 cultivated-crop cells to forest: 635 cells, or 57.15 hectares. Its retained mask selects those cells within 90 metres of the generated valley axes. The profile, grid and remaining landscape stay selected explicitly. Read the actual saved raster edit masks and before/after class counts: those show the implemented change. If another saved alternative changes a different parameter or land-cover area, give it its own comparison.



The saved **matched-area control** changes the same 236 pasture and 399 crop cells, totaling 57.15 hectares, outside the 90-metre corridor. Read its actual scenario title and run ID from the receiving receipt. The control matches treated area and starting land-cover mix; its retained diagnostics describe remaining rainfall, erodibility and terrain differences. Compare baseline-to-riparian and baseline-to-control on their actual native common support. Each has its own saved nitrogen-export swipe view and scenario-specific title. This asks how siting affects the selected model response without asserting that equal area removes every other landscape difference.

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

Original InVEST 3.20 nitrogen and phosphorus export rasters are annual densities in **kg/ha/year**; the sediment export raster is in **metric tonnes/ha/year**. The Workspace integrates these densities using the actual pixel area once. Its integrated export raster cells therefore contain **kg/year per cell** or **metric tonnes/year per cell**. Native watershed-vector totals already contain annual mass. Read the selected artifact's recorded units before summing, mapping or comparing.

A square 30-metre cell covers 900 square metres, or **0.09 hectare**. A density of 10 kg/ha/year on one such cell corresponds to 0.9 kg/year of cell mass. This arithmetic example explains the conversion; use the actual native outputs and their valid reporting support for the case's results. Summing a density raster directly or multiplying an already integrated mass raster by area again would change the physical quantity.

The saved SDR parameter **l_max = 122** is a dimensionless cap on the L factor. The input coefficient and its meaning remain separate from the 30-metre spatial resolution and 90-metre restoration distance.

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

Replace the example absolute paths with the received case's actual locations. The explicit Workspace override supports relocating the same saved project. The adapter checks the selected native records and writes `input.json`; the original receipt and this guide go under `uploads/simulated-headwaters/`, which the maintained teaching ZIP collects. The native runner saves the original paired spatial review before its scientific backup, so that saved view arrives with the received Workspace. If an earlier completed case lacks the view, use `--save-spatial-review` on its GIS-equipped receiving host before freezing a new teaching output; the adapter records the actual view ID and the maintained rehearsal then creates the fresh scientific archive. Repeating the same case uses its retained view ID. The full programme then uses `operator/rehearsal_receiving.py` for its original task, screenshot/recording and backup/restore lifecycle.

To stage the exact input before execution, omit `--run`. Once the input is written, retain it with the same output directory and browser selection. A changed teaching edition receives a separate output directory; existing original task requests remain intact.

The actual programme's native checkpoint is `results/native.json`; final result is `results/complete.json`. Screenshots, recording and browser measurements remain under `browser/`. The final ZIP includes the retained original requests, teaching files, media, scientific archives and independent receiving results.

For a configured browser whose continuation will use this same host and unchanged input, `--run --native-only` saves the native phase first. Continue through the maintained receiver without `--native-only` when its authorized browser interval is ready:

~~~sh
python -B operator/rehearsal_receiving.py \
  --input /owned/simulated-headwaters-teaching/input.json
~~~

When the model executes on a different host, first receive its completed scientific archive on the browser host and bind the receipt to that receiving Workspace. The teaching run opens those saved native results; it does not recalculate the models. Reuse the original source and actual receiving identity when selecting the Workspace.

## Continue into the same field and laboratory case

Open **Implementation & fieldwork** and select the original plan named by `fieldwork.plan_id` in `demo-receiving.json`. The continuation uses the same scientific Workspace and final recipe. Its three planned sampling locations are retained with original projected cell coordinates, transformed latitude/longitude and the recipe hash: the lowest source-DEM cell in each upstream half at 40% of grid height, plus the lowest downstream cell at 85%. Show those locations against the actual computed drainage map. They are planned sampling sites selected from the input terrain.

Use **Field records** to inspect the visits, sample activities and seven original laboratory records. All are explicitly simulated **total phosphorus, mg/L as P**, with a whole-water collection definition, declared simulated EPA Method 365.1 analytical definition and 0.010 mg/L quantitation limit. The recipe and field design retain their exact authored dates and assumptions.

| Retained record | Original result | Teaching role |
| --- | --- | --- |
| sim-tp-left-01 | 0.055 mg/L as P | Initial western tributary sample |
| sim-tp-right-01 | 0.120 mg/L as P | Initial eastern sample |
| sim-tp-right-dup-01 | 0.200 mg/L as P | Its explicitly declared field duplicate |
| sim-tp-outlet-01 | 0.150 mg/L as P | Initial downstream sample |
| sim-tp-blank-01 | <0.010 mg/L as P | Censored field blank; retained numeric value is null |
| sim-tp-right-02 | 0.125 mg/L as P | Separate repeat eastern sample |
| sim-tp-right-dup-02 | 0.130 mg/L as P | Separate repeat field duplicate |

The initial and repeat pairs have declared control relationships and custody references. Similar identifiers alone do not establish a duplicate or blank relationship. Each original CSV, column mapping, source row and native laboratory audit remains available through the saved plan.

### Follow the four retained chapters

The existing native continuation supports cumulative **intake → review → repeat → closeout**. A completed demonstration opens those retained chapters; it does not need another sample import or model calculation.

1. **Intake.** In Field records, open the original laboratory source and an original observation. The initial CSV has five rows; the repeat CSV has two. The native mapping preserves result text, numeric value, unit, chemical basis, fraction, method, qualifier and collection context. The ordinary controls are **Import laboratory CSV → Open mapping JSON → Preview laboratory results → Import reviewed results in one native revision**. Use the retained import receipt when opening this completed case.
2. **Review.** Open **Sample quality control → Saved reviews in this original plan → Open exact review** for the initial report. Inspect its actual metric, declared relationship, original records and criterion. The authored project criterion is duplicate RPD at most 20%, evaluated only when both numeric values are at least five times their own quantitation limits. These are this demonstration's entered criteria, with their original basis retained in field-design.json.
3. **Follow-up and repeat.** Open **Review decisions and follow-up**. The initial pair creates one assigned corrective task with a documented reason. The censored blank remains a separate restricted-use decision. In **Work plan**, inspect the actual task, linked repeat-field-record.md and completed repeat visit. Return to the separate repeat QC report to inspect its new records and native result.
4. **Closeout.** Open the saved action history. The original pair is excluded from the explicitly selected teaching use; the repeat pair has a separate **use_as_reviewed** decision. The original task is completed with its evidence. Original laboratory values and the initial review remain retained. Open **Complete report and sources ZIP**, and the same case's scientific delivery, to see the field chapter alongside the model results.

For the authored values, the RPD formula `abs(a-b) / mean(a,b) × 100` gives 50% for the initial pair and approximately 3.92% for the repeat pair. These are arithmetic expectations that the native QC evaluator checks against its returned outcomes. During the walkthrough, read the actual saved metric and report ID. The blank's `<0.010` value remains a bound and is not assigned a zero or half-limit concentration.

The repeated collection demonstrates precision review and corrective follow-through. A sampled concentration and an annual modeled export have different quantities and time support. Explain each using its own units and retained source; these seven authored instantaneous results do not supply a catchment annual load.

The native field chapter registers five existing scientific source documents: the complete observation context, initial and repeat QC reviews, and the two final action/closeout reports. The maintained `attach_to_delivery` function appends those selections to the original ordered scientific report, preserving its existing native runs, maps, overlays and prior source chapters. Open the original report/source links from that delivery.

### Pause, continue and reopen the field chapter

The main demo driver prepares the field inputs from its final exact recipe and continues the same native plan through closeout before building the complete delivery and archive. The full operating guide is [SIMULATED_FIELDWORK.md](../../docs/SIMULATED_FIELDWORK.md). Its `prepare`, `continue_campaign`, `attach_to_delivery` and `inspect_campaign` APIs retain original operation identities.

For a live explanation before automatic closeout, the original owner can pause at an existing phase:

~~~sh
python -B -m model.simulated_fieldwork \
  --workspace /owned/simulated-headwaters-workspace \
  --inputs /owned/demo-output/field-inputs \
  --through review
~~~

Continue with the same inputs and `--through repeat` or `--through closeout`. The same-input request reopens completed steps. Each new native mutation retains its original request first; interruption resumes the same laboratory or quality-action operation. A changed original observation or its sampling context is shown for review in the ordinary editor before a new scripted decision. Unrelated later edits remain intact.

After independent scientific archive receiving, use the restored project and the actual returned operation ID:

~~~sh
python -B -m model.simulated_fieldwork \
  --workspace /owned/received-headwaters/workspace \
  --inspect ACTUAL_FIELDWORK_OPERATION_ID
~~~

Open that same saved plan in Implementation & fieldwork and inspect its original observations, task, source attachments, QC/action history and scientific report. The full archive carries `implementation/simulated-fieldwork/<operation_id>/`, all native plan revisions and report sources. The receiving receipt retains the reopened inspection result.

Add three actual screenshot frames to the same teaching packet: original laboratory record plus source mapping; initial QC outcome plus its linked corrective task; repeat QC/closeout and the independently reopened plan. Preserve their actual screenshot paths and original report/task IDs. The nine existing rehearsal stages remain the model-to-transfer course; this field chapter is its retained Implementation continuation.

### Primary method reference

[EPA Method 365.1, Revision 2.0 (August 1993)](https://www.epa.gov/sites/default/files/2015-08/documents/method_365-1_1993.pdf), sections 1.3 and 3.12–3.15, defines the method scope and phosphorus forms, including total phosphorus and reporting as P. The entered 20% precision criterion and five-times-limit applicability are authored project choices retained with this case. The source method label and exact total-phosphorus basis remain visible with every laboratory result.

## Retained handoff

The complete handoff contains the simulated original inputs and their assumptions; application source; original and restored Workspace identities; saved run/comparison/delivery IDs; readable report and maps; physical GIS outputs; source and runtime metadata; actual timing; screenshots/recording; and this teaching explanation. The maintained rehearsal receiver saves these within the scientific archive and its accompanying teaching packet.

The owner-directed build interval ends **13 October 2026 at 14:00 UTC (10:00 Eastern)**. Preserve the latest completed package and the same operation's current checkpoint at that time.

## Maintained application references

This teaching case uses `START_HERE.md`, `operator/GUIDED_JOURNEY.md`, `operator/REHEARSAL.md`, `operator/RECEIVING.md`, `PROGRAMMES.md`, and the native model/source definitions retained with the application. Their existing controls and scientific contracts own the operations described above.

## Native model definitions

The retained unit conversions and dimensionless L-factor interpretation follow the original [InVEST 3.20 NDR source](https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/ndr/ndr.py) and [InVEST 3.20 SDR source](https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/sdr/sdr.py). Their [NDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html) and [SDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html) define the original inputs, raster units and watershed totals.
