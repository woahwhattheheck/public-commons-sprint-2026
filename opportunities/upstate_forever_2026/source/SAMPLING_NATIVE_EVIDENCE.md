# Sampling targets backed by original native evidence

TokenJunkieLabs · Ecosystem Sciences

Sampling now retains a completed native scientific source beside an authored monitoring target. A scientist selects an actual matched-control outcome, Terrain response or saved native Conservation portfolio source, selects one of its native quantities, and explains how the result motivates the target. The saved proposal contains that evidence with its original source edition, scientific files, spatial support, native versions, station assignment, analytical cohort and historical observation window.

The existing Sampling compiler still calculates historical date gaps, laboratory reporting-limit context, itemized planning cost and eligible historical flow episodes. Its original network, design and calendar functions remain the execution path. The native evidence accompanies those decisions through preview, saved revisions, the readable Sampling report, original-file export and editable Study transfer.

## Work in the existing application

1. Open the original completed native result. For matched controls, prepare the existing outcome report using the explicit selected control roster and quantity scope. For Terrain, use the existing completed response to prepare its scientific report source. Both operations register an ordinary source in the same Workspace.
2. Open **Sampling**, choose the saved observational context and author the programme. Select the source station, exact analytical cohort, months, historical window, visits, reporting-limit objective, rationale and costs.
3. In that target's native-evidence section, choose the original report source and one of its actual available quantities. Write the scientific applicability: what the native result suggests investigating, which field measurements would address that question, and the relevant geographic, constituent and temporal qualifications. The original free-text sensitivity context remains available independently.
4. Preview the complete proposal. Read the retained native result alongside the original observation gaps and costs. Review the exact station-to-network-to-catchment assignment and analytical metadata. The original optional field stays absent for targets that do not use a native report.
5. Save the complete proposal with the existing queue. Reopen the saved edition and inspect its retained evidence. A revision uses the original parent ID and parent digest, preserving the complete prior proposal.
6. Use the existing native design/calendar action with its explicit budget, site and scheduling configuration. The saved native result retains its original plan and the target-to-calendar comparison.
7. Export the proposal and open **sampling-review.html**. The report contains the scientist's rationale, observed target support, native quantities and links to the complete retained native reports, original CSVs, maps and source identities.
8. Export the original full Workspace or a selected editable Study rooted in the Sampling proposal. Open the received project and use its original Sampling, Monitoring, Terrain, outcomes and Sources desks.

The existing controller retains the complete pending request before queue dispatch and recovers the original task after a lost response. The Workspace and operation identity continue through that recovery. A changed target or different native source is an authored revision.

## Native source selection

An evidence-bearing target adds one optional field to its existing selection:

~~~json
{
  "model_evidence": {
    "source_collection_id": "ACTUAL_SAVED_COLLECTION_ID",
    "source_id": "ACTUAL_NATIVE_REPORT_ENTRY_ID",
    "pollutant": "EXACT_AVAILABLE_NATIVE_QUANTITY",
    "applicability": "The scientist's specific explanation of why this result motivates the selected target."
  }
}
~~~

Choose these values from the actual catalogue. The example strings document the shape; the application supplies the saved identifiers and available quantities.

The original proposal schema and all other target fields remain in force. There is one selected native source and one quantity per evidence-bearing target. Several targets can reference the same source while retaining different quantities, analytical cohorts or scientific rationales.

The source must be an original **OBSERVED_CONTEXT** document with an ordinary scientific report recipe. Supported producers are the existing matched-control outcomes, Terrain scientific-source and saved Conservation report-source modules. The resolver verifies the recipe and complete source-member inventory, the original scientific identities, the selected quantity and producing project. For same-project sources, it also reopens the original completed native result. A retained report from another project preserves that relationship explicitly.

## What the report shows

The chapter starts with the scientist's authored rationale. It then places the original source and modeled quantity alongside the target's saved station, network assignment, catchment, analytical cohort, observation dates and selected months. Each cohort metadata field retains its original state, including a missing field, explicit null, empty value and supplied value.

All displayed native numbers come from the selected original records. The renderer performs no numerical reduction, unit conversion, model execution or rounding. Zero remains zero; an unavailable native result remains unavailable. Complete JSON and native output files accompany the readable tables.

### Matched-control evidence

The report identifies the original baseline **B**, restoration **R**, and each selected matched control **C**. It displays the actual annual export quantities and the originally computed differences:

- **B−R**: modeled reduction under restoration.
- **B−C**: modeled reduction under the selected control.
- **C−R**: the directly computed restoration advantage.

The complete selected-roster common support appears first. It is the finite native intersection of the baseline, restoration and every selected control for that quantity. Individual-design support appears in a separate section; it uses the finite intersection of the baseline, restoration and that one control. Those supports retain their exact mask identity, cell count, run roster and original quantities.

The report preserves three separate area denominators for each restoration and control: whole-scenario changed hectares, changed hectares in the selected region, and changed hectares within native common support. The original normalized quantities and source-cell partitions remain attached to their original denominator and support. Exact duplicate placements and pairwise overlap stay visible.

The selection's reporting scope or model-domain scope is retained. The original model-domain geometry is the scientific spatial object. Repeated placements or deterministic cases remain their original sensitivity comparisons.

### Terrain evidence

Each Terrain row retains **alternative minus baseline** on the finite native cells shared by the baseline and every selected alternative. The report shows the joint-support baseline, alternative and direct change, common cell count and hectares, original alternative run, entered burn depth and original percentage where available.

The original baseline and alternative full-support totals are displayed with their own valid-cell counts. Pairwise cells gained or lost relative to baseline remain separately labeled. The joint-support table carries the comparison.

Annual native tables and per-pixel map legends retain their original units. Original normalized pixel mass is summed once by the existing completed response producer. Entered stream-burn depth precedes filling; the original Terrain report supplies final elevation-change, source hydrography, corridor and native-version context.

### Connecting the model to field work

The saved evidence retains the exact source-pixel export quantity and modeled geometry. The target retains its exact source station, network station, catchment assignment and laboratory cohort. Their geographic and constituent relationship is carried as a scientist-authored explanation.

Annual modeled export and the selected historical sampling window have different temporal support. Nitrogen, phosphorus and sediment outputs retain their original quantity meanings beside the observed characteristic, analytical method, fraction, speciation, unit and value type. Existing flow-scope eligibility and laboratory reporting-limit handling continue to use the original observation records.

The original Sampling priority, proposed visits, costs and dates remain explicit planning inputs. The target's scientific rationale gives readers the reason for the decision together with the retained evidence that informed it.

## Saved state and editable history

The per-target resolved record uses **upstate.monitoring-native-evidence/v1**. It retains:

| Part | Preserved content |
|---|---|
| Selection | Exact source collection, entry, quantity and authored applicability |
| Source | Collection and entry identities, body and every companion, title, URI and classification |
| Native result | Original family, completed-result ID, project, native quantity, support, run IDs, geometry and producing versions |
| Target | Exact original station, cohort, context/network identities, historical dates and months |
| Relationship | Explicit geographic, constituent and temporal relationship to the target |
| Interpretation | Scientific qualifications of the original evidence and target connection |

The proposal digest covers the retained resolved record. Inspection verifies the original selected source again. The source files and native objects remain part of the original Workspace.

A later revision retains its parent and the complete prior source selections. Export traverses the proposal lineage so a previous edition's native report remains available even if the current edition selects another source. The selected Study resolver closes source objects for every retained proposal and adds the original native outcome or Terrain report-source root for a same-project result. Those existing typed roots preserve their cases, bindings, native results, source objects and editable workbenches.

## Original-file export

The existing Sampling export contains the proposal, selection, complete proposal history, native designs, readable report, historical-gap CSV, proposed-target CSV, observational context, network and original scientific sources.

Each selected native document is retained under:

~~~text
native-evidence/<source_collection_id>/<source_id>/
~~~

That directory includes the original **source-edition.json**, **source-entry.json**, document body and every original companion at its original relative path. Reports, CSVs, map rasters, previews, legends, scientific figures, original captured run metadata and producer files follow their actual source inventory. The exporter rechecks the selected source identities and file bytes before retaining them.

The report links to files inside that complete export. Keep the directory together when moving or sharing it. The original Workspace/Study export carries editable application state.

## Existing CLI and queue

Use the application's current Python environment and original Workspace. The CLI retains its existing actions:

~~~text
python -m model.monitoring_recommendations --workspace ORIGINAL_WORKSPACE catalog
python -m model.monitoring_recommendations --workspace ORIGINAL_WORKSPACE preview --request REQUEST.json
python -m model.monitoring_recommendations --workspace ORIGINAL_WORKSPACE prepare --request REQUEST.json
python -m model.monitoring_recommendations --workspace ORIGINAL_WORKSPACE inspect --request REQUEST.json
python -m model.monitoring_recommendations --workspace ORIGINAL_WORKSPACE design --request REQUEST.json
python -m model.monitoring_recommendations --workspace ORIGINAL_WORKSPACE export --request REQUEST.json
~~~

A preview request contains the complete original **selection**. A prepare request includes that selection and a stable original **operation_id**; an authored revision also includes **parent_id** and **expected_parent_digest**. Inspect/export use **recommendation_id**. Design uses the selected recommendation, explicit original **configuration**, stable operation ID and optional title.

The original Operator query uses the **monitoring-recommendations** provider and catalogue, context, preview, get and list operations. The original queued actions remain:

- **monitoring.recommendations.prepare**
- **monitoring.recommendations.design**
- **monitoring.recommendations.export**

The existing file ticket transports the complete retained export. The workbench uses the same application, queue, Workspace selector and Monitoring desks.

## Integration and receiving

Compose this complete component into the current application with its current shared source. The new resolver and readable chapter are **model/monitoring_native_evidence.py** and **model/monitoring_evidence_report.py**. The original compiler/provider/workbench/Study joins and component fragment accompany them. Preserve simultaneous changes to the shared Study resolver and dispatcher.

Continue the existing **ECO-SAMPLING-RIVER13-15227-20261013** course and its original RIVER inputs, application and Workspace. The existing **ECO-NATIVE-EXPANSION-13** and Terrain original-production course provide their completed sources; they retain their original actual inputs and native run identities.

The original **source_tools/receive_sampling_recommendations.py** accepts an evidence continuation on the same operation. Keep its original **--workspace**, **--selection**, **--successor-selection** when originally supplied, **--design-configuration**, **--operation-id** and **--output** arguments. Add:

~~~text
--evidence-selection FULL_AUTHORED_EVIDENCE_CHILD.json
~~~

That child is a complete original Sampling selection with at least one explicit native source, quantity and authored applicability. The receiver saves it as a revision of the original selected proposal. An optional **--evidence-successor-selection FULL_AUTHORED_SUCCESSOR.json** exercises a later revision; it may remove the current evidence choice while retaining the prior source in history. An optional **--evidence-design-configuration CONFIGURATION.json** supplies a separately authored Monitoring design configuration; otherwise the complete original configuration is reused.

The evidence phase retains its inputs and outputs in **OUTPUT/native-evidence/** under the original operation. It preserves the original course's completed proposal, report and Study archive. The phase opens every native report-packet member and exposes **report-files/sampling-review.html** with its complete original relative file tree. It exports the selected Study, restores its contained application and Workspace, and invokes that contained application's original receiver to reopen the actual proposal, full history, native design and exact scientific files. Repeating the same inputs reuses their immutable operations and original saved archives.

**sampling-native-evidence-result.json** identifies the actual selected proposal/design, native sources and quantities, required typed roots, report path, received application and Workspace. Use those actual paths when operating the populated desk and viewing the exported files.

Receiving should operate a real selected native source through the original catalogue, an authored target, preview/save/reopen, a changed revision, the original native design/calendar, report/native-file downloads and full plus selected Study receiving. Exercise both supported source families when their completed sources are available in the original project. A foreign retained report should keep its original project relationship. Open the exported report and original native attachments at desktop and narrow widths, and inspect the printed layout. The readable chapter uses small two-column tables and lets long scientific sections flow across printed pages. Detailed original metadata stays expandable on screen and available in the exported scientific files; printed pages emphasize the rationale, source identities, support and native quantities.

Source catalogue errors identify the concrete original document that could not be read. Repair that original source or its actual missing dependency in the same course, retain the original completed operation, and continue with the same scientific inputs and selected object identities.


## Saved Conservation decisions in measurement design

Complete and save a Conservation portfolio in the existing Conservation desk, then prepare its original **Scientific report** source. This retains the selected plan, study, exact candidates, original planning/source data, native bindings, editable selected-union geography and decision packet. A native-model portfolio appears in the existing Sampling evidence chooser alongside control outcomes and Terrain. A geographic context-only portfolio remains geographic context rather than a modeled mass source.

Choose the exact completed source and pollutant for a Sampling target and author its applicability to the target's original station, analytical cohort and observation window. For example, explain which retained family comparison motivates field investigation, what measurements could address the hypothesis, and which geographic and constituent relationships still need establishing. The software does not infer a station catchment from selected land or convert modeled annual export into a concentration, seasonal load or sampling benefit.

The readable target review and exported Sampling report preserve:

- The saved plan and study IDs, scientific purpose, original selected planning-unit IDs and original selected-union GeoPackage layer/CRS.
- Pollutant quantities from the **saved union summary**. Overlapping unit rows are available for inspection but are never summed into a portfolio total by this bridge.
- Baseline own-support totals, fixed-baseline pairwise comparisons, and all-declared-family comparisons in distinct sections. Each pollutant retains its own original support; no implicit cross-pollutant mask or unit sum is introduced.
- For each native pair, its actual run identities, original annual mass unit, signed alternative-minus-baseline change, baseline-minus-alternative reduction, common finite/structural coverage and unavailable values. Structural-only support does not become zero modeled mass.
- Matched-family labels, scientist-written reasons and references; per-pollutant common-support IDs and original mask hashes. The masks travel inside the original decision packet and are checked directly against retained study descriptors.
- Original source attributes/classifications, producing native versions and full source bodies. A source retained from another project stays explicitly foreign; this bridge does not claim a new local native execution.
- The saved analysis request, weights, filters, constraints, fixed normalization and original preference/case results when that report edition carries them. They remain authored decision context, not calibrated probabilities or statistical power. Original report edition1, which predates separate optimization companions, retains its exact reference without presenting absent case rows.

Only pollutants present in at least one actual bound original native output are offered. An originally selected pollutant with no finite mass on the chosen footprint remains selectable with its original null value and reason; an output omitted from every bound model is not offered merely because the historical summary contains a placeholder.

All choices use the existing optional `model_evidence` target field. The saved proposal, revisions, Monitoring design/calendar and full editable Study transfer remain the original workflow. The original source's recipe and every companion are retained in the Sampling export under `native-evidence/<collection>/<source>/`; open the saved decision ZIP, GIS layers, original report and complete source files there. A same-project Study transfer also includes the original Conservation report-source and its complete plan/study history through the maintained resolver.

### Producing and receiving this joined product

Continue the existing Sampling receiving operation on its actual retained Workspace. Select one completed original native Conservation portfolio source and author a target hypothesis against its actual observational context. Operate the populated desktop and390px target editor, review both original scientific support and exact observation metadata, save and reopen the same proposal, then open the Sampling report and every accompanying original report, CSV/GIS/JSON and ZIP member. Use the original design/calendar actions only with their explicitly authored scheduling inputs. Export the existing complete Workspace and selected Study, independently reopen the same saved proposal and original source files, and confirm the source, plan, native-run, station/cohort and target identities remain unchanged. Preserve all running native operations and earlier completed files.

The implementation adds `model/conservation_sampling_evidence.py` to the existing monitoring-native-evidence component and declares the original Conservation family dependency. It extends the maintained evidence resolver, readable report and existing Sampling panel; there is no second sampling compiler or geographic solver.


## Complete current owner direction carried with this receiving guide

The following is the complete maintained `CURRENT_OWNER_DIRECTION.md`, version `2026-10-13.4`, at Git blob `bf68e73cc2819cfc807c40d3015644f3b8699e38`. Preserve it with this original course and pass it to participating receiving owners.

# Current owner direction: Ecosystem Sciences demonstration

Version: `2026-10-13.4`. Owner: Bryce / TokenJunkieLabs. Direction for the Upper Savannah application, demonstration, presentation and work orders. Continue the broad build and finish as much of the existing Eco science application as possible before Bryce's call. Bryce renewed this work directly at **October 13, 2026, 10:46 a.m. Eastern / 14:46 UTC**, after the earlier 10 a.m. preservation checkpoint. Resume the existing unfinished work from its actual saved state and preserve completed outputs, active processes and original implementation ownership.

## Current project instructions

Complete as much of the existing Eco science application as possible before the scheduled call, using the existing fleet and complementary workers where useful.

This current instruction supersedes the earlier 10 a.m. Eco work cutoff. Prior cutoff records remain historical evidence. Coordinate at the existing Eco thread, reconcile actual issued handles, complete unfinished integration and native receiving, and publish usable durable handoffs in the existing application. Preserve the distinction between the sender's completed runs and the runs actually included in a received Study. Existing workers keep their current operations; additional workers clear complementary blockers. The recorded call remains unchanged; this direction schedules no meeting or automation and authorizes no client message.

Execute the prepared simulated model and deliver a relevant, usable application and presentation that demonstrate the actual work and elapsed delivery time. Continue active work while checking progress. Carry the current demonstration, presentation and Ecosystem instructions through the existing coordination surfaces and onward to participating workers.

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

Pass this complete brief into every current child, provider and cloud work order and handoff. Include its durable path and version `2026-10-13.4` with the next result. Relay it at the actual coordination surface and onward to participating workers; fast feeds can bury an update. Acknowledgment alone is not delivery.

Preserve active compute and existing implementation ownership. Do not force worker restarts, drop an active run or create a new controller. Keep lab attribution, source/copyright, incident and contact controls, personal-meeting approval, no private GitHub/Actions, no llama.cpp and focused internal validation. No new approval gate or broad test sweep is authorized.
