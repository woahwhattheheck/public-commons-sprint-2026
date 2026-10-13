# Original annual station support in the five-basin report

The normal native assessment delivery can now add the original national USGS station periods, estimator method and published standard error to the completed eleven regional annual-reference targets. The existing five-basin maps, eleven regional yield rows and ten basin relationships are retained.

## Continue the existing source and viewer operations

Use the original ES-9960 / 9072 national inventory course and the existing annual 5154 / SEASON13 report viewer. Preserve any admitted process and its original outputs. The source inventory is a standard-library archive read; it does not execute a hydrologic model. Existing regional native computation remains the priority.

The upstream source owner supplies the actual F7DN436B original files and the complete output of the maintained command:

```bash
python -B -m source_tools.usgs_annual inventory \
  --original-root ORIGINAL_NATIONAL_DIRECTORY \
  --huc8 03060101 --huc8 03060102 --huc8 03060103 \
  --huc8 03060104 --huc8 03060105 --huc8 03060106 --huc8 03060107 \
  --output ORIGINAL_NATIONAL_INVENTORY.json
```

The original directory contains load_est.zip, sitegage.zip and F7DN436B-original-metadata.xml. Preserve any original HTTP receipt named by the inventory. The existing importer owns archive parsing, exact selected rows, inclusive-to-exclusive flow-period handling and the final-method estimator choice. Do not reconstruct those rows from displayed rounded values.

From the current complete application, generate a new report directory using the original producer:

```bash
node source_tools/native_assessment_delivery_cli.mjs \
  --application APP --output NEW_ANNUAL_STATION_REPORT \
  --microbial \
  --national-inventory ORIGINAL_NATIONAL_INVENTORY.json \
  --national-source-root ORIGINAL_NATIONAL_DIRECTORY
```

Add the existing --workspace WORKSPACE --python PYTHON options to import the completed manifest into the original receiving application. The CLI verifies every original archive/XML/receipt byte length and SHA-256 against the retained inventory. Its existing source containment and new-directory rules remain in force.

Both national options are required together. Omitting them follows the original report producer and preserves its existing source identities. Providing actual national inputs produces a new context-bound scientific source ID and association-report identity; it does not replace the previously completed report or mutate observation/calibration records.

## What the reader receives

The interactive association report adds a source section grouped by constituent. It displays the original regional annual reference, the national annual estimate, the standard error belonging to that national estimate, station-specific water-quality dates, observation/censor counts, inclusive flow prediction dates and the original estimator. Missing, ambiguous and source-qualified matches remain explicit.

The scientific recipe receives the same original fields in separate readable mass/error and sampling/flow tables. Normal Scientific Reports rendering produces the ordinary PDF, HTML and Markdown. No new report renderer or model runner is introduced.

The association directory retains:

- annual-reference-station-context.json: every matched original candidate and complete paired source record, original fields, period basis and source identities.
- annual-reference-station-context.csv: complete original numeric values, exact station/reach/constituent keys, methods, periods, standard errors and edition differences.
- annual-reference-station-context.md: readable methods and original-source references.
- annual-reference-station-report.json: exact source binding and original archive descriptors.
- inputs/original-national-annual-inventory.json and inputs/original-regional-reference-yields.json.
- source/usgs-national-annual-2012/: the unchanged original national archives, XML and any retained HTTP receipts.

Those originals belong to the association document's own source companions. Its standalone HTML archive links therefore work after an ordinary standalone source export. The combined scientific source and complete ZIP point to the same single retained copy under association/source/. Every new file also enters the existing complete source recipe and archive inventory.

The existing selected-basin GeoJSON, original-component GeoJSON, seven map SVGs, eleven-row regional CSV and ten-relation CSV remain separate and unchanged. The normal completed-report source picker can select the resulting OBSERVED_CONTEXT source. Use the existing scientific_report_editions.preview → render_prepared → inspect → export workflow and original Workspace backup/restore.

## Scientific interpretation

Joining uses exact original station_id, parameter_code and COMID, not station-name similarity. Multiple candidates are not silently resolved. A source row with existing issues retains those issues.

The regional reference remains its own published value. The national estimate and its standard error remain a separate published edition. National minus regional is a direct comparison of the two original estimates, not a replacement calibration target. The national standard error is neither a confidence interval nor an uncertainty estimate for a modeled intervention.

Nitrogen and phosphorus use kg/year. National sediment kg/year is divided by 1,000 once to display the existing regional metric-tonne unit. Parameter 00530 is TSS and 80154 is SSC; this report applies no TSS-to-SSC conversion. Source-global date ranges, station-specific sampling dates, included prediction-flow dates and the 2012 reference basis retain their separate labels.

Whole-basin yields continue to use the original complete polygon areas in hectares. The national release's published station/gage drainage areas remain additional source fields, never replacement denominators. Nested basin totals and estimator errors are not summed. The original ten overlap/containment relationships continue to describe dependence, not independent regional pieces.

Primary sources: USGS release https://doi.org/10.5066/F7DN436B and Saad and others (2019), https://doi.org/10.3133/sir20195069. The maintained national importer and original publisher dictionary define each field and estimator.

## Source implementation and receiving

annual_reference_enrichment_core.mjs is the original three calculation/CSV/Markdown functions extracted byte-for-byte from ES-9960's published source. annual_reference_enrichment.mjs keeps its original command and re-exports those functions. Pure report builders import the pure core; they do not acquire Node filesystem dependencies when national inputs are absent.

annual_station_report.mjs composes that original function with retained archives, readable scientific tables and the standalone report section. Existing native_assessment_delivery, assessment_association_report and native_assessment_delivery_cli carry the resulting context through their ordinary source identities, manifests, report and export flow. The assessment-source-delivery component includes the full direct source closure.

Actual receiving must use the returned original national inventory; source compilation is not a numerical result. The preceding completed annual4090 product remains the viewer's valid original edition while the optional national source arrives. Inspect the changed station tables and their downloads on desktop and 390px, open every resulting PDF page, use the existing basin controls, open CSV/JSON and both original national ZIPs, then reopen the exported source/report through the existing application. Return the first concrete source/render exception in the same operation so it can be repaired.

## Complete current owner direction

The following is the current original owner direction, retained in full for this active receiving guide.

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


## Complete the original five-view course with its annual scientific report

The existing `source_tools/operate_annual_assessment_context.py` can now carry the already-produced annual report through its original queued rendering, full project snapshot and independent receiving sequence. This is one optional continuation of the original b9d5 project. It adds no model solve and preserves the existing annual target, assessment and microbial selections.

The original seventeen-file source bank supplies the assessment/annual/microbial contexts and the five saved map views containing **159, 18, 6, 4 and 1 stations**. Those views are distinct from the **five original annual-reference basins** and two scientific map figures in the completed annual basin report. Keep both sets. The original seventeen files and this annual report's source family have no overlapping paths.

First materialize the original17 `receive_annual_source_20261013.py` through its existing ordinary file and run it into an owned source intake. Compose its full source bodies into the current application, preserving newer operator, formatter and Study code. Materialize and extract the unchanged completed annual report ZIP using its existing README; its root `sources.json` is the optional report input below. Its original inputs and generated HTML/maps/CSV/GeoJSON remain inside that complete source package.

Run the same existing course with its original Workspace, output journal and exact original domain collection:

```sh
PYTHON -B APP/source_tools/operate_annual_assessment_context.py \
  --application APP \
  --workspace ORIGINAL_B9D5_WORKSPACE \
  --output SAME_ANNUAL_OUTPUT \
  --project-id b9d5d257-c6bb-4f07-b975-8e8c63705db3 \
  --domain-collection ORIGINAL217_COLLECTION \
  --domain-source-id upstate-wbd-upstream-domain-20261012 \
  --annual-report-manifest EXTRACTED_ANNUAL_REPORT/sources.json
```

The default report source is the original completed basin edition:
`native-assessment-observed-bef411c2954fc3e7deb6-microbial-f53df7b5a31d-annual-yields-basin-maps-v1`.
If that exact manifest has already been imported, use `--annual-report-collection ACTUAL_RETAINED_COLLECTION` instead of the manifest option. The manifest and collection options are mutually exclusive. For a deliberately selected later national-enriched edition, pass its actual returned `--annual-report-source-id`; do not rename an older collection or substitute a station estimate. `--annual-report-title` is an optional explicit title.

### Original queue, saved output and continuation

The driver preserves every original five-view operation ID and map/PDF. It then imports the selected full manifest through the existing `source.import` queue, prepares and saves the exact ordered source preview, and invokes `source-reports.render` followed by `source-reports.export`. These are the same actions exposed by Sources → Prepare a scientific report. The normal formatter produces the complete PDF, HTML, Markdown, structured tables, figures and retained input files; the ordinary report ZIP includes those original members.

The report request records its exact source ID, title and manifest hash or existing collection. Its preview is saved before queue dispatch, and its retained task payload is reused after an interrupted response. Once this optional request is saved in the original journal, repeating the command without report intake options continues that same request; an external manifest is no longer required after the original source-import task completes. Supplying a different source/title to that same report request fails explicitly rather than silently replacing the selected edition.

A report-scoped snapshot and receiving operation follow. Their stable identity contains the completed scientific edition ID, keeping the older five-view-only snapshot and receiver intact. If an earlier completed result exists, its original JSON is retained under `completed-editions/` before the current result advances. All original selected task history travels, including source import, saved maps and report rendering/export.

Cold receiving reopens the same original project, source collections and map reviews; verifies all five original selections; then opens the exact scientific edition through `scientific_report_editions.inspect`. Its source order, file descriptors and complete report ZIP must match the producing edition. The actual resulting IDs, file descriptors and received report directory are in `working-project-native-result.json → annual_report`, with `annual_report.receiving` describing the reopened edition. The existing top-level `receiving` continues to identify the full project archive.

Without a saved or newly selected optional annual report, the original command keeps its previous task identities, snapshot/receiving paths and output shape. National source inventory is optional and is not a prerequisite for the completed regional report or five-view course.

### Operate the exact outgoing product

Use the populated source/report project, rather than an empty demonstration. Open every one of the five saved map PDFs and all scientific report pages, including both annual basin/component maps. Open the standalone association HTML at desktop and 390 px, use the original map/table/dropdown selection, fit and excluded-component controls, and download/open the actual CSV, JSON, GeoJSON and SVG. Open the report ZIP's contents and the independently received project with its archived application, then reopen the same maps and scientific edition.

Return the first actual source/queue/render exception immediately in the existing annual receiving operation. Preserve its original task, source selection and project writer while the relevant source owner repairs that boundary. Return viewed original screenshots/PDF pages and actual native IDs through that same operation. Source checks or captured-but-unviewed screenshots do not replace looking at the outgoing product. The complete owner direction above continues to apply, including the original 14:00 UTC cutoff and priority of the actual-geography native case.
