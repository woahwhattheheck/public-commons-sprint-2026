# Parameter support reconciliation

This is a derived explanation of already-saved Parameter results. It is included by both maintained scientific-source producers: `model.parameter_report_source` for an editable local Parameter study and `model.parameter_archive_source` for an original completed result archive. The existing PDF, HTML, Markdown and source-package paths render the same sections.

It does not open a raster or execute a model. Original result bytes, selected row values, percentages, sensitivity values, figures, ranges and scientific selections remain unchanged. The new JSON/CSV explicitly identify their arithmetic as derived.

## The two questions answered by the original totals

A Parameter row retains the baseline and case totals on each run's own valid cells, and their totals on the cells valid in both runs. Define:

- `Bfull`, `Cfull`: original baseline and case own-valid masses.
- `Bpair`, `Cpair`: original masses on that pair's common valid cells.
- `Dpair`: the original stored paired change, with the producer's original sign convention: case minus baseline.
- `Bonly = Bfull - Bpair` and `Conly = Cfull - Cpair`: differences of the retained reductions.
- `Dfull = Cfull - Bfull`: derived own-valid full change.
- `residual = Dfull - Dpair - Conly + Bonly`.

The complete accounting identity is:

```text
own-valid full change
  = stored common-cell change
  + case-only mass difference
  - baseline-only mass difference
  + arithmetic residual
```

The term “mass difference” is deliberate: this helper subtracts original reductions and does not independently aggregate exclusive-cell rasters. The residual records the effects of separately stored/reduced floating-point values; the original paired change is never overwritten by a new subtraction. The companion also retains `stored_change_arithmetic_residual = Dpair - (Cpair - Bpair)`.

A lower common-cell export can coexist with a higher own-valid total when enough mass occurs on cells only valid in the case. Neither total replaces the other. Missing cells are not zero export, and an excluded-cell difference does not identify the reason those cells were excluded. This explanation does not establish a common mask across all parameter cases, conditional factorial effects, causal restoration effects, measured-load validation or statistical uncertainty.

## Counts, areas and missing quantities

Exclusive cell counts are original own-valid counts minus the original paired count. Common fractions use each run's own-valid cell count as its denominator.

Exclusive hectares are derived only from an original finite, positive `pixel_area_ha`; no nominal resolution is assumed. The original paired hectares are copied unchanged. When pixel area is unavailable, the exclusive areas remain null, with an explicit basis.

When paired support is empty, original paired masses remain null, the reconciliation and sign comparison are unavailable, and `unavailable_reason=no_paired_valid_cells`. A retained full-total difference can still be shown with its own meaning. Missing original masses or stored changes similarly produce `original_mass_or_change_unavailable`. Zero changes are not classified as opposite signs. Negative or small residuals are retained rather than clipped.

Units remain the original row's annual mass units; nitrogen, phosphorus and sediment are not summed together. The source sections group rows by original area and pollutant and preserve the selected case order.

## Original source identity and portable outputs

Every newly prepared scientific source includes:

- `support-reconciliation.json`: all derived rows, original selection, result SHA256, row keys, assumptions, null reasons and exact implementation identity.
- `support-reconciliation.csv`: the full flat projection, including original masses and counts, derived terms and source bindings.
- `parameter-support-reconciliation.py`: the exact implementation used for the projection.

Each row retains the original result SHA256, case/run/profile/area/pollutant identities and a `selected-results.json#/rows/N` pointer. The archive source additionally retains the actual original complete-result row index. The paged live source records the original composite row key without inventing a global array index.

The live source references `original-study/results.json`; the archive source references its byte-exact `original-result.json`. Both keep their original source basis. Report operation identities pin this helper's SHA256 alongside their existing producer and figure identities. The ordinary immutable companion inventory includes the two derived files and exact helper before source import, so the existing scientific-source/project transfer carries them. An updated helper produces another immutable source edition; old source reports remain readable.

The shared section producer still ends with `Original files and spatial interpretation`. The archive adapter replaces that live-source-specific appendix through its existing checked seam. Reconciliation sections precede it and are shared by both routes.

## Actual original Gura example

The retained input is `receiving/gura-original-four-case-results.json`, 17,291 bytes, SHA256:

`20a0f25d11742011784ac3bcae7857de108b244adaee8ceae7a79f9a921eaa9b`

It is the original completed NDR Parameter study `0bde5ae5a60805b8a39e119a910f131ad72977aeaac00dfdd4d0c030713b30c2` from Workspace `5afb21c0-0894-4476-b620-24b81fc9fe93`, published in merge `beb67ccfd9430f64f49f68eb42b47e87d155ec50` (source blob `a65f19640187c0066879109b1eb310ec5481219c`). It retains all eight rows for four NDR cases.

The clearest single-assumption example is D8 routing at k=2 versus the MFD k=2 baseline, original row 6. Its native run is `374ff39a2b48c7c3dcee8c097516b04ffedddca4b2d2c7d6ecbb5731de503912`; case `0da792d644560d7a0a6fddff61e479ac580b71cad4a72748a14bc8433aee1d46`; profile `76e0ed978e0aed0234ff6c83b13da515a583194ab7d00c841f0f2630aa4813d4`.

| Nitrogen term | kg/year |
|---|---:|
| Stored common-cell change | -725.147086863406 |
| Plus case-only mass difference | 1042.359159857966 |
| Minus baseline-only mass difference | 100.33698983117938 |
| Arithmetic residual for this saved row | 0 |
| Equals own-valid full change | 216.87508316338062 |

The source retains 456,304 common cells, 2,663 baseline-only cells and 14,915 case-only cells. The original 0.0225 ha per cell gives 10,266.84 common ha, 59.9175 baseline-only ha and 335.5875 case-only ha. This is the original 15 m Gura scope; it is separate from both the explicitly simulated 1,296 ha headwaters case and the Upper Savannah regional geography.

All eight rows are included, not just the example. Three have opposite full/common signs: D8 k=1 nitrogen and phosphorus, and D8 k=2 nitrogen. The original selected rows preserve the original percentages. Current historical range handling remains unchanged: the older archive's stored ranges are retained but are not advertised as a corrected four-case range. Its missing newer executed-runtime metadata remains explicitly missing. No absent raster is inferred from these aggregate records.

The original result can be received through the existing command in [PARAMETER_ARCHIVE_SOURCE.md](PARAMETER_ARCHIVE_SOURCE.md). For a live source, use the existing saved Parameter selection and `model.parameter_report_source.prepare(workspace, selection, render=True)`. Reuse the original receiving operation; a new model execution is unnecessary. Source-only preparation continues to work with `render=False`.

## Receiving and actual presentation

On the existing equipped report host, render the actual Gura archive through the maintained CLI and inspect its generated PDF/HTML and exact derived CSV/JSON. Open the accounting table, single-assumption explanation, original figure coordinates and source links. Check the actual outgoing page at screen-share and narrow widths, operate download and source-reopen, and repair any concrete defect. Do not describe a source inspection as a rendered-product inspection.

Run one writer per actual Workspace. Independent hosts may receive the same original source in isolated Workspaces, preserving original donor identities and their own receiving identities. Preserve active native calculations and their current source owners.

## Complete current owner direction

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
