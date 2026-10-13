# Direct scenario comparisons from original native runs

TokenJunkieLabs · Upper Savannah scientific workbench.

The Scenario sensitivity desk can compare any selected original scenario with another scenario under every retained parameter profile. The result uses the original native comparison reducer and its actual common valid cells. A restoration-versus-matched-control result therefore has its own geographic support and direct change raster.

## Use the complete operator workflow

1. Open **Scenario sensitivity**, select the original saved ensemble, and choose **Compare two scenarios**.
2. Select the **Reference scenario** and one or more **Alternative scenarios**. For a signed restoration-minus-control result, choose the matched control as reference and restoration as alternative. The form displays the number of alternatives and original parameter profiles.
3. Choose whether to prepare the full scientific report, then select **Prepare direct scenario report**. The existing Operations queue records preparation and any original run problems.
4. Reopen **Compare two scenarios** and select **Open exact edition**. The saved result identifies its reference, original baseline, native run IDs, each annual quantity, actual common cells, unmatched cells and source edition.
5. Open a **difference map** to inspect the original comparison in the existing spatial viewer. The difference is alternative minus the selected reference. Pairwise rasters retain their native units; annual sums remain separately labeled.
6. Open the complete scientific report, printable numeric report, paired CSV and JSON. **Compose scientific report** selects this exact scientific source in the shared ordered composer. The scientific ZIP includes the original source companions and figures; the numeric ZIP contains the complete paired result and method.
7. Use **Revise this selection** to reopen its actual scenario choices. Preparing a revised selection retains another source edition. The original baseline report and earlier saved editions remain accessible.
8. Use the application's existing Study transfer or whole-Workspace export and restore workflow. Reopen the included exact scientific source after restoration. A history entry whose source directory was omitted from a selected transfer remains listed with its original ID and availability; the included current edition remains usable.

A concise walkthrough explanation: “We choose the control, compare the restoration with it under each scientific profile, inspect the actual paired cells and maps, and hand over the original results and editable project.”

## What the values mean

| Output | Meaning |
|---|---|
| Reference on common cells | Original selected reference run's annual exported mass summed over cells valid in both runs inside the reporting mask. |
| Alternative on common cells | Original alternative run's annual exported mass over that same actual support. |
| Annual change | Alternative minus reference on that support; negative means lower modeled export to streams. |
| Change percent | 100 × annual change / reference on common cells; undefined when the reference is zero. |
| Nitrogen and phosphorus | Kilograms per year of modeled export to streams. |
| Sediment | Tonnes per year, represented by the native annual sum unit `t/year`. |
| Own-valid total | Each run's annual mass on its own valid reporting cells; retained separately in the original table and source. |
| Unmatched cells | Cells valid only in the reference or only in the alternative; they do not enter the direct paired total. |
| Common support hash | Identity of the actual shared valid mask. Equal cell counts alone do not establish equal support. |
| Profile range | Range across selected profiles with identical scenario, pollutant, units and exact support hash. It describes the selected cases. |

A direct control comparison answers a different question from restoration-minus-baseline. Subtracting separately supported baseline effects cannot supply a direct common-support result. The original baseline remains an explicit property of the retained ensemble design, while the report's `scenario_reference` records the selected comparison reference.

The report retains native compatibility field names such as `baseline_common` and `baseline_run_id`. In this explicit-reference report those fields identify the selected reference. Its title, method, visible column labels, JSON selection, and appended CSV `reference_scenario_id` / `reference_scenario_label` columns state that meaning.

## Sources, assumptions and interpretation

The scientific source contains the original ensemble plan, grid metadata, profiles, coefficient tables, scenario selections, original source metadata and recipe documents, numeric report, exact compared run identities, figure specifications and coordinates. It reuses the current original input-scope and matched-control sections. Simulated inputs retain their original classification. The 1,296-hectare square SAME5156 case and a source-defined regional Upper Savannah case remain distinct through these actual source records.

Control matching describes the variables selected by its retained construction method. Matching original land-cover area and precipitation does not by itself establish equal slope, erodibility, routing, upstream area or a causal treatment effect. Read the original matched-control document and its pair-specific geographic support with the annual result. Intake concentrations require their own transport and observation interpretation.

## Native API and exact files

```python
from model import ensemble_scenario_contrasts, ensemble_study_source

choice = {
    "reference_scenario_id": original_control_scenario_id,
    "alternative_scenario_ids": [original_restoration_scenario_id],
}
# Uses completed original runs and the maintained native pair reducer.
numeric_release = ensemble_scenario_contrasts.build(workspace, ensemble_id, choice)
# Registers the same typed scientific source and ordinary report exports.
source = ensemble_study_source.prepare(
    workspace, ensemble_id, scenario_reference=choice, render=True
)
# Reopen the exact retained source operation.
reopened = ensemble_study_source.latest(
    workspace, ensemble_id, source_operation_id=source["id"], verify=True
)
```

The existing operator action is `ensemble.contrast-source`, payload `{ensemble_id, scenario_reference, render}`. Reads are `GET /api/ensembles/contrast-catalog?ensemble_id=...` and `GET /api/ensembles/contrast-source?ensemble_id=...&source_id=...`.

Original pairs are cached under `ensemble_results/<ensemble>/scenario-contrasts/<identity>/pairs/`. Each cache identity includes the exact grid, both native run IDs and their original artifact identities. A completed cached pair is reused. The full original ensemble run signature is checked again before a report is published. No scenario, profile, grid, native run or original baseline report is rewritten by this operation.

The current direct pointer is `latest-scenario-contrasts.json`; `scenario-contrast-sources.json` retains exact prior source IDs. Original scientific operations stay under `ensemble-study-sources/<id>`. Numeric releases stay under `ensemble_reports/<id>`, with independent content identities and the ordinary release manifest. The baseline `latest-report.json` and `latest-scientific-study.json` pointers keep their existing role.

Incomplete runs and ordinary pair failures stay named in the source. Correct or finish those actual original runs through their existing owner and prepare the same selection again. Storage exhaustion propagates immediately through the maintained native failure classifier, so the operation stops doing new pair work and completed cached pairs remain reusable. An interrupted scientific renderer retains the registered source, allowing the same selection to finish rendering later.

## Receiving and actual product use

Adopt this source through the existing original-run owner, on its pinned cumulative application. Preserve active compute and all original inputs. Run the direct comparison against the completed original ensemble and selected scenario IDs; do not substitute separately supported scalar differences. Open the populated operator at screenshare and narrow widths, operate reference selection, saved edition reopening, map inspection and scientific composer, then open the actual HTML/PDF/CSV/JSON/ZIP and restored project. Return the actual selection/source/report IDs and the useful numerical interpretation to the same receiving thread.

The current owner brief is `CURRENT_OWNER_DIRECTION.md`, version `2026-10-13.3`. The complete current text follows for source-only receivers.

---

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

