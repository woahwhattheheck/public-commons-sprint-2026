# Open a received native model study

This chapter continues the original selected Study transfer and the Scenario
sensitivity desk. A received scientific report can now open the exact saved model
design, land-cover contrasts, baseline parameter sensitivity, source figures and
original native run selections behind that report.

## Receive and open

Receive the original Study archive through the existing Study transfer or
Workspace restore action. Select its receiving Workspace, open **Study transfer**,
and choose its saved entry under **Received studies and original sources**.
The **Model studies and original physical results** section lists each original
native-ensemble scientific source separately.

Choose **View saved model results**. The existing Scenario sensitivity desk opens
the physical report captured with that particular source. The page shows:

- The original parameter-case and land-cover alternative counts.
- The saved land-cover contrasts and baseline parameter contrasts.
- The original annual quantities, percentage changes and common-cell coverage.
- The physical HTML report, CSV tables, structured report and source figures.
- The scientific report editions in this received Study that used that source.
- The original parameter, scenario and run roster.
- The complete captured source data, methods and source identities.

For a Study whose original project is the receiving project, **Open editable
study** opens the same saved design in the ordinary desk. Each **Native run**
control opens its actual retained run. A source from another project remains a
complete captured scientific source: its model results and original choices open
without interpreting its foreign model IDs as local editable records.

**Add original source to report** opens the current ordered scientific report
composer with that original source. The composer retains its existing draft
behavior, source ordering and title/contact editing. This action neither prepares
a replacement source nor changes the source selected by the received Study.

Opening the received view is a read operation. A model run, report refresh,
calibration or new source edition starts only through its existing explicit
action in the ordinary desk.

## Read the physical results

Each land-cover contrast pairs its baseline and alternative using the same
parameter profile. Its annual change is **alternative minus baseline**. A
negative value therefore means lower modeled export for that alternative.
Baseline parameter contrasts hold the retained land cover fixed and compare
each varied profile with the original reference profile.

The received view copies the original rows; it does not convert or recompute
them. Nitrogen and phosphorus retain the reported mass units, and sediment
retains its reported annual mass units. Each row keeps its original common-cell
support, unmatched cell counts, percentage and undefined values. Geographic
support identities remain with the original structured report. Equal counts
alone do not imply equal geography.

A captured report may contain a partly completed design or a legitimate
zero-overlap contrast. Original messages and undefined quantities remain
visible. Later completion of the editable study does not replace the report
captured with the selected source. To read the newer result, open the editable
study deliberately; to publish it, use its existing report/source action.

## Original sources and received files

The existing selected-Study resolver remains the source of the original report
lineage. Before the receiving view opens, it resolves the saved scientific
report editions and compares their native-ensemble source lineage with the
captured receipt.

The native receiving reader follows the actual source collection and the exact
source body. It reads the captured ensemble, numerical report and release from
the retained source companions. For a same-project source it also requires the
original immutable ensemble record and selected native runs in the resolved
lineage. It does not look up foreign-project IDs in the receiving Workspace.

The numerical report and original input/source companions use the ordinary
authenticated file tickets. Their original hashes and bytes remain attached to
the ticket descriptors. The source package remains part of the same original
Study and Workspace archive. Source-view copies and a separate receiving
database are unnecessary.

The physical report selected by the source is identified by its original report
ID. No current `latest-report.json` or `latest-scientific-study.json` pointer is
substituted for that selection. Original physical reports therefore remain
usable after the editable study advances.

## Download and reopen the original named files

Original source downloads retain their authored filenames and extensions,
including CSV, JSON, HTML, PDF, SVG and GeoTIFF. The source list shows the original
logical path when one is available. Distinct authored companions remain listed
even when their bytes share the same content-addressed object; equal bytes do
not erase the separate filenames or roles in the source.

At the existing received-study operation, download and open the actual source
recipe, one numeric table and each relevant document, figure and map in its
normal viewer. Keep the complete extracted source/archive directory intact for
relative document links and multifile GIS inputs. Check the original filename,
byte count and SHA256 against its retained descriptor, then reopen the completed
working project. The ordinary authenticated ticket still verifies the same
original source object; this presentation change does not copy or transform
scientific data.

## Complete application installation

The maintained files are:

| Area | File |
|---|---|
| Original-lineage reader | `model/ensemble_study_receiving.py` |
| Authenticated file links | `operator/ensemble_receiving.py` |
| Received-study section and navigation | `operator/web/ensemble_received_studies.mjs` |
| Existing scientific desk | `operator/web/ensembles.mjs` |
| Shared received-study model | `model/study_receiving.py` |
| Shared received-study provider | `operator/study_receiving.py` |
| Shared received-study browser | `operator/web/received_studies.mjs` |
| Existing Study preview | `operator/web/extensions/study_transfer.mjs` |
| Existing Study asset registration | `operator/extensions/study-transfer.json` |
| Existing ensemble installer | `operator/integrate_ensembles.py` |
| Owned component membership | `integration/component_fragments/ensemble-study-receiving.json` |

Receive the complete composed application. Its existing component-fragment
loader includes these files alongside the maintained Gauge, Implementation,
scientific report and native-study transfer dependencies. The fragment extends
existing components; it does not replace the canonical component catalogue.

From that application root, the original installer remains:

```sh
"$UPSTATE_PYTHON" -B operator/integrate_ensembles.py --apply
```

Use the existing operator startup command and the receiving Workspace. Keep
its authenticated session and existing report/download service. The native
reader uses only the existing common/Study models; opening its captured physical
table does not import or execute InVEST.

The new desk entry point is:

```javascript
host.openExtension('ensembles', 'openSavedStudy', {
  workspace_key,
  study_id,
  ensemble_id,
  report_id,
  source_operation_id,
  source: {source_collection_id, source_id}
});
```

All IDs come from the actual received-study detail. Browser requests recheck the
Workspace, selected Study, request generation and saved source identity before
opening a result. Switching Workspace or opening another result while a read is
in flight cannot publish that stale result in the new context.

## Continue the original native receiving course

The original simulated headwaters driver already publishes its saved native
study source, registers an ordered scientific report edition, exports the
selected Study, restores it, and cold-opens the archived application's original
receiving code. This navigation is the next visible step in that same receiving
Workspace. Keep the existing selected report, source, design, run and archive
IDs; the view does not require another model solve.

After the selected archive opens, use its received-study entry to inspect the
saved contrasts and source report. Then open its editable design and an original
native run, return to the received Study, and add its original source to the
scientific composer. Download and reopen the physical HTML and CSV and the
original scientific report. The full Workspace receiving course continues with
its existing original map, fieldwork, customer and source controls.

### Producing worker's rendered-product requirement

Bryce's current repository `AGENTS.md` applies to this outgoing application and
all delegated native/browser work. Open/run/render the exact completed
application and reports, LOOK at their real screen or screenshots, and operate
the important controls. Use the real screenshare width and a narrow width where
relevant. Check populated, empty, loading and error states, actual downloads,
exports and reopening. Seeing the rendered product is required; source review
or capturing screenshots without looking at them does not replace it.

Repair clipped tables, unreadable labels, overflow, broken links or other actual
issues directly in the maintained source. Keep the plain industrial appearance
and focused verification. Preserve the original Ecosystem sprint cutoff of
October 13, 2026 at14:00 UTC. The direct owner instruction is
https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791881463183449 .

## Complete current owner direction

The following unchanged brief governs this existing receiving operation and
travels with its native or browser handoff. Open and use the exact outgoing
application and every attachment; preserve the active computation and cutoff.

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
