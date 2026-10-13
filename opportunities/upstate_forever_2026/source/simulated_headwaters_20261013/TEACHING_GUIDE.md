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

## Interpret the restoration and siting experiment

Start with the intervention that the original inputs actually specify. The riparian restoration and matched-area control each replace 236 pasture/hay cells and 399 crop cells with forest. At 0.09 hectare per cell, that is 21.24 hectares of pasture and 35.91 hectares of cropland, totaling 57.15 hectares in each alternative.

| Declared input | Pasture/hay → forest | Cropland → forest |
| --- | --- | --- |
| Nitrogen loading coefficient, kg/ha/year | 10 → 2 | 22 → 2 |
| Phosphorus loading coefficient, kg/ha/year | 0.7 → 0.12 | 1.8 → 0.12 |
| Maximum nutrient retention proportion | 0.35 → 0.80 | 0.15 → 0.80 |
| Dimensionless USLE cover factor | 0.025 → 0.003 | 0.18 → 0.003 |

These are the demonstration's original assumed coefficients. The native `measured-runoff` label specifies how the loading coefficient enters the equation. Both treatment recipes specify the same unadjusted land-class loading reduction: **888.12 kg N/year** and **72.648 kg P/year**, obtained by multiplying the area in each changed class by its original coefficient difference. These are input-accounting quantities before the model applies the precipitation/runoff proxy and delivery processes. The saved native exports show the resulting modeled response.

NDR combines the adjusted source loading with delivery along downslope paths. A changed vegetation cell can affect nutrients originating upslope as well as its own load. SDR combines rainfall erosivity, soil erodibility, terrain, land cover and delivery. Use the original process maps to explain where the result came from. The 90-metre restoration mask measures distance from the generated valley axes; the 100-metre nutrient critical length is a separate profile parameter used along flow paths.

Matching treated area and starting land-cover classes holds treatment amount constant. The original control diagnostics show the remaining terrain, rainfall, erodibility and location differences. Read those diagnostics alongside the modeled export change when explaining the effect of siting.

### Choose between locations on the joint support

For “what changed from baseline?”, open the ordinary native comparison and read its actual alternative-minus-baseline change, annual-mass unit and common valid-cell count.

For “which location performs better under this profile?”, open the parameter course's **joint siting decision report**. Its original producer evaluates the baseline, riparian alternative and control on common finite support for each selected quantity. Use that report's shared-support values to compare the two treatments. Separate baseline-to-alternative comparisons can cover different cells, so their individually printed reductions are not a substitute for the joint comparison.

For “does that ordering persist under the explored model choices?”, inspect the retained routing and dimensionless maximum-L parameter members. Each member has its own baseline and both alternatives. The joint decision outputs preserve distinct support groups where the available cells differ. Explain the ordering and descriptive range within those original groups, together with completed and pending native runs.

The parameter range describes the saved model choices. NDR does not use SDR's maximum-L parameter, so several coupled members may repeat the same nutrient result. Read the actual profile changes before explaining variation or repeated results. The native study's scalar pair report and the ordinary comparison print alternative-minus-baseline change. Its paired raster products and joint siting benefits print baseline-minus-alternative reduction. Use the product table below when moving between these views.

### Turn the result into the next planning action

Use the saved decision report to select candidate locations for reconnaissance, then open their original change mask and physical export maps with the units, extent and legend visible. A treatment whose ordering persists across the completed choices is a useful candidate for field screening. An ordering that varies identifies which terrain, routing or source assumptions the team should investigate first. Keep entered costs and source-water priorities visible as additional planning dimensions.

Continue into the same field chapter to show how the proposed work receives sampling records, quality review, a corrective task and closeout. Instantaneous phosphorus concentrations retain mg/L as P and their sampling support; annual modeled export retains its watershed support and mass/year unit. The original Upper Savannah RFP block-group summaries belong to that separate retained project. Use its own source-bound Community report when discussing socioeconomic context.


## Read the physical quantities correctly

Original InVEST 3.20 nitrogen and phosphorus export rasters are annual densities in **kg/ha/year**; the sediment export raster is in **metric tonnes/ha/year**. The Workspace integrates these densities using the actual pixel area once. Its integrated export raster cells therefore contain **kg/year per cell** or **metric tonnes/year per cell**. Native watershed-vector totals already contain annual mass. Read the selected artifact's recorded units before summing, mapping or comparing.

A square 30-metre cell covers 900 square metres, or **0.09 hectare**. A density of 10 kg/ha/year on one such cell corresponds to 0.9 kg/year of cell mass. This arithmetic example explains the conversion; use the actual native outputs and their valid reporting support for the case's results. Summing a density raster directly or multiplying an already integrated mass raster by area again would change the physical quantity.

The saved SDR parameter **l_max = 122** is a dimensionless cap on the L factor. The input coefficient and its meaning remain separate from the 30-metre spatial resolution and 90-metre restoration distance.

Read the printed quantity and support of each named product. The parameter course retains several products with different conventions:

| Open this retained product | Printed quantity and direction | Meaning of lower export | Geographic support |
| --- | --- | --- | --- |
| Ordinary native comparison | Export change = alternative − baseline | Negative change | That baseline/alternative pair's common valid cells, for the selected output |
| Native study report, `pairs.csv` | Export change = alternative − baseline within the same profile | Negative change | Original pairwise common-valid mask; ranges group identical mask hashes |
| Native study report, `sensitivity.csv` | Export change = varied-profile baseline − reference-profile baseline | Negative change | The two profiles' common-valid cells with land cover held fixed |
| Paired raster product | Reduction = baseline − alternative | Positive reduction | Original per-metric raster cohort support |
| Joint siting decision | Avoided export = baseline − alternative | Positive benefit | Common finite cells across the baseline and all selected alternatives, per metric |

For example, a baseline of 10 kg/year and an alternative of 8 kg/year on the same support give −2 kg/year change and +2 kg/year avoided export. This arithmetic illustration explains the signs. Present the actual saved case values from the selected product.

The source-aware teaching companion records these conventions beside the original run, profile and support identities. The scalar report, raster reductions and joint decision each remain attached to their original producers.

Inspect common valid support before interpreting a difference or percentage. The report's original total and its paired common-cell total can cover different supported areas. A percentage needs a nonzero baseline with the reported compatible support. The full spatial pattern is useful even when changes vary across the catchment.

The restoration case is an experiment under the declared assumptions. Explain the computed result that actually appears, including an increase, near-zero response or mixed spatial response if returned. A diagram, display scale or expected ecological direction cannot replace the native result.

## A short spoken walkthrough

1. “Here is the simulated catchment and the source edition used by this saved study.”
2. “These are the terrain, land cover, rainfall and soil inputs, and this table defines the selected model assumptions.”
3. “This is the baseline. In the alternative, the selected pasture and cropland inside this raster mask becomes forest.”
4. “These runs use the same original grid. Here are their actual profiles and any selected parameter changes. These logs and stage times show the calculations that produced their outputs.”
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

## Read the actual frozen selection

The rehearsal binder first opens the maintained native teaching capture. It checks the original source and grid, baseline scenario, selected profiles, complete model artifacts, and the comparison and delivery's exact ordered run IDs before freezing `input.json`. A same-grid parameter sensitivity run retains its own profile; it is described explicitly alongside the land-cover alternatives.

Open `uploads/simulated-headwaters/selected-case.md` for the actual selected-case table. It lists each saved scenario and profile, original run ID, and the net changed cells and hectares from that run's selected footprint edition. The original baseline, riparian restoration and matched-area control recipes above remain the definitions of those particular scenarios. Additional selected scenarios use their own retained patches, transitions and footprint values.

The same page lists each native pollutant change with its original unit and common valid-cell count. It reads the actual alternative-minus-baseline artifact directly. It does not subtract full-run totals that may cover different valid areas. The companion `selected-case.json` preserves the exact scenario patches, coefficient-profile identities, native artifact descriptors and comparison rows used by the explanation.

When the receipt includes the retained parameter course, the binder reads that existing ensemble and its original course result. Its grid, baseline, base profile and ordered alternatives must match the teaching scenarios. The page displays the original native-run completion and course state. Each parameter member retains its own baseline and alternative runs. The course's scalar native-study report uses **alternative minus baseline**; its parameter contrasts use **varied-profile baseline minus reference-profile baseline**. Its paired raster reductions and joint siting benefits use **baseline minus alternative**. Read their separate metric support and original case identities. The selected-case companions name these conventions individually.

The binder performs no scientific calculation. Existing task, browser, transfer and archive operations continue through the same rehearsal receiver. Both selected-case companions travel in its existing teaching uploads and final package.

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

## Explore the saved parameter study and siting decision

After opening the three original runs, open their retained parameter study, **Simulated headwaters: routing and slope-length sensitivity**. Read its actual ensemble ID from the case receipt. This is the existing `routing-lmax-v1` study; the driver prepares it from the same grid, original profile, baseline, riparian restoration and matched-area control.

| Selected setting | Retained choices | Interpretation |
| --- | --- | --- |
| Native flow routing | `mfd` and `d8`, linked in NDR and SDR for each member | Compare the two supported ways of routing flow through the same retained terrain. |
| SDR maximum L factor | 122 and 333 | Compare the catalogue's declared dimensionless cap values. These are separate from cell size and the restoration distance. |
| Original working profile | Retained as the reference member | Keep its actual source table, grid and original run selections visible beside the explored choices. |

Open the study's saved specification and source references before its summary. The source catalogue states the meaning and provenance of these choices. The actual member inventory shows which unique profile/run selections were materialized and which original completed stages were reused. The displayed planned and completed counts explain the current scope.

Each parameter member compares its own unchanged baseline with both restoration alternatives. This keeps the selected model assumptions aligned within that comparison. Open the retained profile assignments, original native logs and outputs from a member whose result differs visibly from the reference. Read the physical units and actual shared valid area beside the numbers.

The L-factor cap is used by SDR. Changing only that setting can therefore repeat nutrient outputs while changing sediment outputs. Show that relationship using the saved assignments and actual results. A range across these explicitly chosen settings describes this study's explored cases; it has no probability or confidence level attached to it.

### Read the paired maps and joint decision

Open the study's paired raster product for the selected pollutant and alternative. It retains its original support, case IDs and printed difference direction. Then open the saved joint siting decision from the course result. Its complete output is recorded in `ensemble_results/<ensemble_id>/headwaters-results.json`; `joint_decisions.support_group_reports` lists the retained report indexes, native package paths and reference comparison/profile for each supported group.

The decision compares both restoration alternatives on actual common finite cells. If the available support differs among parameter members, the course retains separate support-group reports. Open each relevant group and its reported pending-member count before summarizing whether the preferred alternative changes. The saved decision selection starts with empty costs and targets, so its physical comparison should be explained through the actual exported quantities and selected support. Enter any later project costs or targets as their own explicit sourced inputs in the maintained application.

The mapped scientific report also includes the retained treatment response. Read its net final changed area, annual mass difference, and supported benefit per treated hectare. The two restoration cases both select 57.15 hectares, while their locations and terrain differ. Explain any reported eligibility reason or unequal common support beside the normalized value. Follow the underlying scenario summary and source tables when a result needs explanation.

For this chapter, say: “These are the same two siting choices under the displayed model settings. Each has a matching baseline. We can see whether their ordering changes, where the supported map comparison applies, and which original outputs support that judgment.”

Retain one actual screen showing profile assignments, member progress and paired physical results, plus one of the selected joint decision's support and source links. Record the native parameter-course interval separately from the three initial case runs; the course keeps its own start, completion and interrupted-state records. Continue an unfinished course through its saved ensemble ID rather than creating another study.

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

### Record the saved QC and corrective-action course

The maintained headwaters rehearsal freezes the completed original campaign from its saved `fieldwork_operation_id` and `fieldwork_plan_id`. Its raw `inspect_campaign` result travels as `uploads/simulated-headwaters/fieldwork-inspection.json`, retaining the project, original plan, two QC report IDs, three action-report IDs, source files, observations and corrective tasks. This complete descriptor is part of the recording identity.

The field chapter uses the existing recorded Operator page and browser context before the customer handback chapter. It opens the exact saved plan and original evidence, follows its retained initial and repeat QC reviews, and operates the original quality-action history. The maintained `run_sample_qc_browser.mjs` callable owns these controls and their original export/receive operations. The surrounding model-to-transfer course keeps its original native runs and selected scientific outputs.

Each actual action retains its request, task identity and completed result under `browser/field-qc/`. The original native input, journey, two QC exports, three action-report exports, downloaded source evidence and real screenshot files all travel in the complete receiving packet. Desktop and narrow frames join the same browser media inventory and original recording. Any temporary browser contexts used for an independent QC/report reopening are closed by this chapter; the parent recorded page stays open for the customer transition.

Resume an interrupted course with the same immutable input and recording output. Completed native tasks are reconciled through the original retained request and task IDs. A changed field plan, changed selected report or later original laboratory edit requires a new recording edition, preserving the prior course and source bytes. An older completed model/customer-only course cannot silently stand in for this extended field edition. The existing cooperative cutoff retains completed actions and finalizes the partial video before bounded process shutdown.

The producer must inspect the actual original laboratory report, both QC reports, all three action reports and their downloaded sources. Extract the outgoing archive and open the contained working plan and complete records as the recipient will. Watch the recorded field transition, inspect its desktop and narrow frames, and fix clipped or unreadable tables, hidden criterion text, broken evidence links or unclear status labels in the maintained source before handoff.

## Continue into customer requests and engineering handback

The same completed field campaign can be taught through **Customer reviews** and its **Worklist**. This uses the retained laboratory, QC and corrective-action evidence. The reviewer wording, engineer names, assignments and engineering dispositions are explicitly labelled **SIMULATED TEACHING INPUT** in the original records and visible titles.

Start from the completed field operation returned by the driver. The maintained consumer is `model.simulated_customer_review`; its full guide is [SIMULATED_CUSTOMER_REVIEW.md](../../docs/SIMULATED_CUSTOMER_REVIEW.md). It advances the same project through three phases:

| Phase | What Bryce opens | What to explain |
| --- | --- | --- |
| Request | **SIMULATED TEACHING INPUT — initial field quality review**, its original response, then the filtered **Worklist**. | The original QC and open corrective-action reports support two authored requests: explain the follow-up evidence, and preserve the original laboratory records and source flags. |
| Planning | The original review's **Handbacks** tab and saved planning edition. | Each original request has an assigned engineer and a documented plan. Requested assignee and current engineering owner remain separate fields. |
| Ready | **SIMULATED TEACHING INPUT — revised field evidence and engineering closeout**, then the ready handback. | The actual revised artifacts come from all five saved field source editions. Follow each request to its replacement evidence and original requirement. |

Open the original observation context, initial and repeat QC reports, and both closeout action reports from the revised review. The original response and planning edition remain available in history. Read the engineering explanation beside its selected evidence; the application's separate customer-response controls let the reviewer decide what to do with the handback.

For an interactive explanation, advance one phase at a time from the same application:

~~~sh
python -B -m model.simulated_customer_review \
  --workspace /owned/simulated-headwaters-workspace \
  continue --field-operation ACTUAL_FIELDWORK_OPERATION_ID --through request
~~~

Repeat with `--through planning` and then `--through ready`. The complete driver may already have prepared all three; in that case open the saved historical editions. The returned `original_review_id`, `response_id`, `planning_handback_id`, `revised_review_id` and `handback_id` identify them exactly. `operation_id` identifies this same customer continuation. An earlier phase reopens retained work without rolling it back. If a new human response has arrived before a new phase, continue that current request in the ordinary review editor.

### Open the complete review packages

The maintained export uses an ordinary delivery directory outside the application and scientific Workspace:

~~~sh
python -B -m model.simulated_customer_review \
  --workspace /owned/simulated-headwaters-workspace \
  export --operation ACTUAL_CUSTOMER_OPERATION_ID \
  --output /owned/demo-output/customer-review-case
~~~

Open `original-review/index.html` for the selected original review and its authored response. Then open `engineering-handback/index.html` for the ready engineering edition and its linked original/revised evidence. These complete offline desks are useful on a browser that supports local HTML. Use actual application navigation when showing the live Worklist or editing a response.

The accompanying `original-review.zip` and `engineering-handback.zip` are the maintained native packages. `current-worklist.json` and `.csv` contain every matching request at their stated captured snapshot, including owners, wording, dispositions and replacement IDs. `selection.json` retains the project, field operation and all selected review generations. `case-manifest.json` binds the original package identities and companion bytes.

Create the scientific project archive after this customer continuation reaches ready. Its selected edition must include the customer operation and all five review/response/handback IDs, plus the saved `06-ready-handback.result.json` under the returned operation directory. The integrated driver uses those identities to distinguish this complete handback from its earlier field-only archive.

### Reopen the same customer case after project transfer

Keep the complete `customer-review-case` directory beside the scientific project archive. Restore the original project using the maintained portable receiver, then run from the **received application**:

~~~sh
python -B -m model.simulated_customer_review \
  --workspace /owned/received-headwaters/workspace \
  receive --source /owned/delivered/customer-review-case \
  --output /owned/received-customer-review
~~~

Use the returned `receipt_id` in **Customer reviews → Received packages**. Open the retained incoming generation and its local viewer, then the original ready handback and revised evidence. The receive result also returns the current filtered Worklist; later local responses can appear there while the historical teaching IDs remain unchanged. Repeating the same receive command verifies and reopens the same package identity.

For a short spoken handoff: “We started with the saved quality finding. The reviewer asked for follow-up evidence and original laboratory context. Engineering assigned the work, linked the five actual closeout documents, and returned a revised review. This received copy opens those same records, and the next response continues their history.”

Add two actual frames to the same teaching packet: the original request beside its assigned engineering work; and the independently received ready handback with its revised source evidence. Retain their exact review, response and handback IDs and the measured preparation/receive times alongside the existing model and field frames.

### Record the same customer transition

The maintained rehearsal now binds the completed case export from `demo-receiving.json` automatically. It verifies `case-manifest.json`, the original scientific project and all six customer operation/review/response/handback identities before using the existing browser context. The complete export is copied immutably into the receiving packet at `uploads/simulated-customer-review/`; it retains both native ZIPs, both desks, their complete files and the original worklist snapshot.

After relocating the same export, add `--customer-case /owned/delivered/customer-review-case` to the existing `source_tools/simulated_headwaters_rehearsal.py` command. That explicit path is checked against the retained receipt's original manifest; it does not create a new customer generation. Continue the same input/output directory after an interrupted recording. A previously completed course whose input did not include this customer chapter keeps its original recording unchanged: create a separate recording output edition bound to the same scientific project and six saved customer identities. The immutable input and browser progress binding prevent an older completed video from silently standing in for this extended chapter.

The recorded customer chapter opens the populated original review and its saved response, downloads the original response record and one exact retained artifact, operates the source-file search and its empty state, then reopens the original purpose and requirements. It uses the ordinary review controls to prepare an explicitly **SIMULATED local teaching draft**, displays the required-name error, saves the draft, reopens it and downloads its JSON against the original saved parent response. The draft stays in this recording's browser profile and exported teaching files. The native customer history retains its original six saved identities.

Next, it follows the ready engineering desk into the exact revised review and its replacement files, then uses the handback's original-response link to reopen the retained customer request. Desktop and 390-pixel views cover the original/revised Overview, Files, Requirements and Responses, plus the engineering resolutions table. These transitions are part of the existing operator walkthrough video. The surrounding receiver continues its original media attachment, complete scientific backup and fresh receiving steps.

`browser/results/browser-progress.json` records customer chapter actions, the selected identities, real timestamps, completed downloads and retained screenshots. Interrupted actions and the finalized partial video remain available. The existing 14:00 UTC cutoff and cooperative browser shutdown apply to this chapter.

**Inspect the actual outgoing pixels.** The producing worker must open this exact populated edition, view its real desktop and narrow-width screenshots, operate the important controls and inspect the downloaded/reopened records. Capture count, DOM checks and a successful exit are not visual inspection. Return viewable image handles for the original response, revised evidence and complete engineering table; fix clipped, crowded, unstyled or unreadable output before presenting it. Retain the application's `AGENTS.md` version `2026-10-13.1` with the delivered source. Use its plain industrial typography, spacing, tables and controls. The same requirement applies to the neighboring field/QC chapter.

## Narrate the frozen selected case

The same adapter writes `uploads/simulated-headwaters/narration-script.json` and `narration-script.md` beside `selected-case.json`. The script reads the actual saved scenario and profile titles, retained footprint areas and native signed comparison quantities. Its source records identify the exact selected-case SHA256 and JSON pointers, plus the selected field/customer identities when those chapters are present. The spoken text does not invent a model response or declare a preferred alternative.

The script has scene identifiers matching the original study, geography, parameter, scenario, calculation, map, comparison, delivery and transfer course, with the retained parameter, field and customer continuations. Timing remains unset until the actual recording exists. Use the original video/action timestamps and scene transitions to align generated narration; retain pauses needed to read source tables and explanations. Do not substitute native model duration for the recorded walkthrough duration or truncate records to fit an arbitrary length.

Use an existing authorized high-quality generative voice route for a neutral natural narrator. Keep the raw recording, frozen script, generated audio and finished export together. Pronounce NDR and SDR as their letters; say nitrogen and phosphorus in the explanatory passages; read hectares and annual mass units clearly. Numeric display values and full original precision remain in the saved case. Watch and listen to the final edited video, including the actual field and customer transitions, and correct pronunciation, pacing, source-text readability and audio alignment. Native execution and the actual product inspection continue while this audio leg is prepared.

## Producing-worker inspection and final media

Owner instruction: `rendered-product-inspection-20261013-all-attachments-v1`.

Before calling a client/prospect-facing app, website, dashboard, demo, report,
presentation or export ready, the producing peer must actually open, run or
render the exact outgoing version, LOOK at the rendered screen or its real
screenshots, and operate the important user controls. Check the actual
screenshare width and narrow/mobile width where relevant, populated, empty,
loading and error states, downloads/exports and reopening. Capturing screenshots
without viewing them is insufficient. Fix ugly, broken, unstyled, cramped,
clipped, overflowing or unreadable output within the authorized work before
presenting it. Code review, DOM counts, HTTP 200, unit checks or another peer's
approval do not replace seeing the actual product.

ALL ATTACHMENTS count. Literally open, view, play and use the final delivered
HTML, PDF, report, slides, spreadsheet, map, image, video, audio, archive and
project as its recipient would. For archives, extract and open the actual
contained deliverables and working project. Tests, checklists and screenshots
merely captured are not substitutes. Use available high-quality generative media
models and natural voice generation/TTS for videos; avoid robotic default
voices. Watch and listen to the final export for pronunciation, pacing, timing
and audio alignment. Keep building and fixing; inspection is not review/test
performance theatre.

For the Ecosystem product use plain industrial design: readable tables, clear
hierarchy, consistent typography and spacing, restrained controls, useful labels
and responsive layouts. No decorative template slop. Keep the real workflows,
data and computation. Reviews must lead directly to repairs and must not replace
hard implementation/integration or become endless rechecking. The existing
focused-validation policy remains; do not run broad suites or build a separate
verification product. Prior empty-Workspace screenshots are not acceptance of a
completed scientific Workspace.

PERSISTENT PROPAGATION REQUIRED: copy this rule into every active owner-controlled
policy/instruction surface the provider and workers actually read: global and
project AGENTS, CLAUDE, GEMINI and rules files, provider-specific boot instructions,
Commons source mirrors, cloud repository instruction copies, and current build
and receiving guides. Every delegating peer includes this complete rule in child
assignments, including its all-attachments and final-media clarification. Return
exact changed paths, source/version and readback. A Slack ACK alone is not
propagation. Preserve all existing owner controls and do not alter historical
evidence or third-party/vendor policies. No forced restarts, new watchers or
revival of owner-stopped work.

Continue the same Ecosystem Sprint Integration assembled product and its original
scientific, run, browser and receiver owners. Continue native source, runtime and
archive joins rather than diverting everyone to cosmetic review. Preserve the
October 13, 2026 fleet cutoff at 10:00 a.m. Eastern (EDT), 14:00 UTC. This project
cutoff does not expire the standing inspection rule or change other projects'
owner-directed schedules.

## Retained handoff

The complete handoff contains the simulated original inputs and their assumptions; application source; original and restored Workspace identities; saved run/comparison/delivery IDs; readable report and maps; physical GIS outputs; source and runtime metadata; actual timing; screenshots/recording; and this teaching explanation. The maintained rehearsal receiver saves these within the scientific archive and its accompanying teaching packet.

The owner-directed build interval ends **13 October 2026 at 14:00 UTC (10:00 Eastern)**. Preserve the latest completed package and the same operation's current checkpoint at that time.

## Maintained application references

This teaching case uses `START_HERE.md`, `operator/GUIDED_JOURNEY.md`, `operator/REHEARSAL.md`, `operator/RECEIVING.md`, `PROGRAMMES.md`, and the native model/source definitions retained with the application. Their existing controls and scientific contracts own the operations described above.

## Native model definitions

The retained unit conversions and dimensionless L-factor interpretation follow the original [InVEST 3.20 NDR source](https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/ndr/ndr.py) and [InVEST 3.20 SDR source](https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/sdr/sdr.py). Their [NDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html) and [SDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html) define the original inputs, raster units and watershed totals.
