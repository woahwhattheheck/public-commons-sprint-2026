# Archived Parameter result → scientific report

This entry receives an original, completed Parameter result JSON into the current application's ordinary scientific-source collection. It reuses the maintained Parameter tables and figures and the shared PDF/HTML/Markdown formatter. The report opens with the scientific purpose and original per-case paired findings, followed by the actual mass/support tables. Detailed identities and coefficient provenance appear in its methods/source appendix. The receiving Workspace can select cases, areas and pollutants and compose this source alongside its other reports.

The archived original JSON remains byte-for-byte unchanged. Its donor Workspace, experiment, run, profile, scenario and grid IDs remain donor identities. The receiving operation creates a source collection and report, without creating a donor experiment or native run. Metadata uses `source_basis=saved_parameter_result_archive`, distinct from the live editable Parameter study source.

## Receive and open the actual original Gura result

Use an existing current application and its receiving Workspace. The retained original result is included at `receiving/gura-original-four-case-results.json`:

```sh
python -B -m model.parameter_archive_source \
  --workspace /actual/current/workspace \
  --result receiving/gura-original-four-case-results.json \
  --expected-sha256 20a0f25d11742011784ac3bcae7857de108b244adaee8ceae7a79f9a921eaa9b \
  --origin-uri https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8KE9N5U3 \
  --output /actual/owned/gura-archived-source.json
```

Run from the application root so the maintained model modules are imported. The existing Python environment needs the application's normal scientific-report dependencies; this course does not invoke InVEST or raster aggregation. Keep ongoing regional calculations and their workspaces running.

The output record identifies the receiving operation, source collection/source ID, report members, original-result companion and delivery selection. Its `files` descriptors are relative to the actual receiving Workspace. Open the exact `report.pdf`, `report.html`, `report.md`, `report-data.json`, selection and `scientific-report.zip` paths from that record. The archive includes the collected original source members. Inspect and use the exact numeric CSV and figure coordinate files as well as the rendered report and SVG figures.

To edit the report selection, pass `--selection selection.json`, containing any of `case_ids`, `area_ids`, `pollutants` and `title`. Choices must be original available identities; output follows the original case order. Excluding the baseline display case retains the original baseline reference for every comparison. Another selection yields another immutable report operation, leaving the earlier edition available. `--source-only` imports the source without rendering it; a later identical call without that option completes the existing operation.

The Python API is:

```python
from model.parameter_archive_source import prepare, get
from model.ensemble_scientific_source import delivery_selection

received = prepare(
    workspace, original_result_path,
    expected_sha256=original_sha256,
    origin_uri=original_location,
    selection={"title": "Original Gura NDR parameter comparison"},
    render=True,
)
ordered_selection = delivery_selection(
    received["source"], previous=current_delivery_selection
)
reopened = get(workspace, received["id"])
```

Use the existing SourceReports composer to append this source to the ordered delivery. Preserve the caller's existing selection when appending. The complete imported source collection carries the frozen recipe and every original companion through the ordinary source/Study transfer. Reopen the receiving application and its source selection, then render from the retained source collection; the original input-file path is unnecessary for that ordinary composer operation. Re-running this CLI requires the exact original input bytes, which remain available in the imported source's `original-result.json` companion.

## What the recovered Gura study says

The archived result is exactly 17,291 bytes with the SHA256 in the command above. It was recovered from the original 6A4E source Canvas, JSON block containing `receiving/ndr-original-four-case-results.json`. Donor Workspace:

`5afb21c0-0894-4476-b620-24b81fc9fe93`

Completed NDR study:

`0bde5ae5a60805b8a39e119a910f131ad72977aeaac00dfdd4d0c030713b30c2`

This NDR study completed **four of four original cases**, producing eight N/P rows. The wider original suite `ac52dfce004b9ecd4301b90d1f0d62c192684da0e00f66111cbcebaf5083b22a` also contains an interrupted SDR arm. The completed NDR case count must not be described as a four-case partial NDR study.

The landscape and grid are fixed. The factorial design changes NDR connectivity shape `k_param` between 1 and 2 and routing between MFD and D8. The original baseline is MFD with k=2. These are parameter/routing sensitivities of the original Gura case, separate from the Upper Savannah restoration programme and the current simulated headwaters demonstration.

All values below are original stored annual export values in **kg/year**. The human table rounds for readability; the report, selected CSV, coordinates and original JSON preserve the stored values.

| Original case | N paired change | N paired change (%) | P paired change | P paired change (%) | Paired valid cells |
|---|---:|---:|---:|---:|---:|
| MFD, k=2 baseline | 0 | 0 | 0 | 0 | 458,967 |
| MFD, k=1 | +530.541260 | +3.543577 | +273.292865 | +4.705594 | 458,967 |
| D8, k=1 | −770.452692 | −5.180707 | −156.980436 | −2.721641 | 456,304 |
| D8, k=2 | −725.147087 | −4.876061 | −222.385100 | −3.855591 | 456,304 |

Changes are **case minus baseline on each pair's common valid cells**. Negative means lower modeled export. The MFD pairs share the baseline's 458,967 valid cells, covering 10,326.7575 ha. D8 cases have 471,219 own-valid cells and 456,304 common cells, covering 10,266.84 ha on the common support. Their common baseline masses consequently differ from the MFD comparisons.

The baseline own-valid total is 14,971.911478747614 kg N/year. D8, k=2 has an own-valid N total of 15,188.786561910994 kg/year, while its **paired** N change is −725.147086863406 kg/year. The differing support explains why the independent totals and common-cell comparison can point in different directions. The scientific report puts both quantities beside their original cell counts.

For MFD k=1 the parameter step from the original baseline is negative (1 minus 2). Its positive mass change therefore has a negative stored response per parameter unit. That is the original finite-step sensitivity, not a fitted derivative. Categorical routing and multi-parameter cases have no single numeric response.

## Historical ranges, versions and maps

The original result predates the maintained range-producer correction: its stored ranges exclude the baseline and show one eligible MFD alternative. This receiver retains those historical rows and their stated basis unchanged in `historical-ranges.json` and the complete original JSON. It omits them from the current range display. It neither backfills current ranges nor recasts the historical values as a four-case range. The current live original-study continuation can refresh its summary from retained native runs through its existing owner, separately from this archived report.

The original baseline selection requests InVEST 3.20.0. The archived result does not retain the newer actual-runtime version/label maps. The report explicitly displays that absence. Embedded version strings 3.10.2 and 3.7.0 in the coefficient-source references describe the original source arguments within the published NDR/SDR data archives; they are not substituted for an executed-runtime record.

The original selection has `difference_maps=false`. This archived course presents its retained numeric rows and scientific SVG figures. Its source inventory accurately reflects the attachments present in the original JSON; it does not infer a raster map or manufacture missing inputs. Original grid, scenario, coefficient collection and native run identities remain in the report and companions.

## Retained members and source checks

Before receiving, the adapter verifies the caller-supplied SHA256 against the exact file bytes and rejects duplicate JSON keys, missing original identities, invalid numbers, duplicate matrix rows, mismatched case/run/profile assignments and inconsistent original support counts. It requires the declared completed case/area/pollutant matrix. It copies original physical values; it does not recalculate changes, percentages, support areas or ranges.

Each operation retains:

- `original-result.json`: exact original bytes.
- `archive-provenance.json`: donor/receiving identities, original selections, metadata presence and each selected-to-original JSON row index.
- `selected-results.json` and `selected-results.csv`: copied original rows and explicit range display policy.
- `historical-ranges.json`: original stored range rows and basis.
- Existing Parameter figure specification, SVGs, coordinate JSON/CSV, and undefined-value coverage.
- An ordinary observed scientific-report recipe, source manifest and all source companions.
- Shared rendered PDF, HTML, Markdown, report data, selection and ZIP.

The source operation pins the archived bytes, report selection, adapter, maintained section producer and figure helper source identities. Repeated calls verify frozen source members before reuse. Whole-source transfer preserves the original companions through the maintained source inventory; it does not masquerade as the original editable Gura Workspace.

## Actual receiving and product inspection

Use the existing equipped report host. Compile and run this exact source against the original result above, retain stdout and operation IDs, and correct any concrete exception in the maintained path. View the exact outgoing PDF and HTML, every figure, selected data, and archive contents personally. Operate the current composer at desktop and narrow widths where applicable; exercise populated selection, empty choice, loading and error feedback, downloads and reopen. Open the transferred source in an independent receiving Workspace and confirm its original result bytes and donor IDs remain exact. Reuse this source for report rendering; do not start another native programme for this receiving course.

The current scientific-source producer and report renderer remain the only presentation path. A screenshot or a source review does not replace looking at the actual rendered product.

## Complete current owner direction

The following is the complete owner brief carried with this receiving course.

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

