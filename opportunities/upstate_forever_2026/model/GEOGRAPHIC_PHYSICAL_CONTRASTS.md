# Geographic changed-pixel physical inputs

This companion explains the physical setting of the actual pixels changed by the retained geographic restoration and control scenarios. It reuses the original completed baseline, restoration, control, native grid, scenario footprints, HUC polygons and Receiving masks. It does not select a different control, change the original matcher, create a scenario, run NDR/SDR, or replace any native pollutant quantities.

The scalar inputs are shared by all three scenarios. A restoration/control difference here describes where the land-cover edits occur. It does not mean that the scenario changed rainfall, soil erodibility, erosivity or elevation.

## Original entry and receiving course

The maintained entry remains `model.geographic_receiving_context.prepare`, reached by the original geographic receiving workflow. Its allocation step now binds the exact physical inputs and accumulates these statistics inside the existing bounded 256-pixel-window allocation pass. No second raster-analysis pass or separate operator action is needed.

Continue the same admitted operation, original selection and output directory:

```sh
PYTHON source_tools/receive_geographic_headwaters.py \
  --workspace ACTUAL_WORKSPACE --selection ORIGINAL_SELECTION \
  --output SAME_ADMITTED_OUTPUT --report-only --adopt-handover
```

Use the current C57E maintained caller and its completed-checkpoint continuation. Do not replace it with an earlier standalone source overlay. The caller's existing complete native course, if still running, remains the original owner’s process. The companion is a reporting step after the actual completed native results; it does not justify a new simulation.

The normal returned allocation source is appended by the existing context source-choice API. Its complete source collection, report companions, edited scientific project and original full archive remain available through the existing report/review/handover path. A report-only ZIP is not a substitute for the editable Workspace.

## Exact input contract

The helper is `model/geographic_scenario_contrasts.py`. It reads the selected `Workspace.get_grid(prepared.grid_id)` record:

- `files[ROLE]` identifies the exact already-aligned, single-band raster and its declared units.
- `inputs[ROLE]` retains original source ID, SHA256, URI, vintage, resampling, conversion, valid/nodata counts and whole-grid minimum/maximum.
- `spec.source_collection_id` and `spec.input_sources` point to the original retained source entries. Their full metadata and body/companion descriptors are copied into the physical binding.
- Width, height, transform and CRS must match the native prepared grid exactly. Original file bytes and SHA256 are checked. There is no resampling or second unit conversion.

| Variable | Meaning | Units / restriction |
| --- | --- | --- |
| DEM | Original elevation input | `m`; never presented as slope or LS |
| PRECIPITATION | Original NDR runoff proxy | Preserve the actual declared units; call it annual precipitation only when the original aligned descriptor explicitly declares `mm/year` |
| R_FACTOR | Rainfall erosivity factor | `MJ*mm/(ha*h*year)` |
| K_FACTOR | Soil erodibility factor | `t*ha*h/(ha*MJ*mm)` |
| R_TIMES_K | Product of the original nonnegative R and K inputs | `t/(ha*year)`, on joint finite support; an input-factor product without LS, cover, practice or routing |

R × K is neither predicted erosion nor SDR sediment export. It is not multiplied by area or substituted for a native mass result. Original native annual N/P and sediment units, direction, support and calculations are unchanged.

Inputs absent from the original selected model scope are explicitly unavailable. An unavailable variable is not zero. Empty geographic masks and zero changed-cell selections remain visible, with unavailable means and no fabricated statistics.

## Geographic and categorical support

Every original allocation region receives the companion: complete model/reporting selections, local HUCs, actual Receiving subjects and family unions, and the explicitly bound RFP utility upstream mask unions. Each row retains its relationship and scope. Overlapping regions must not be summed.

For each region:

1. Intersect the original region mask with finite categorical support common to baseline, restoration and control.
2. Select each arm’s actual final baseline-to-alternative changed pixels. Do not reconstruct them from a proposed planting mask.
3. Split by original baseline class: all, 81, 82 and other. “Other” includes every remaining original code; “all” includes the three groups.
4. Record the number of changed pixels shared by restoration and control. Compiled scenarios are not assumed disjoint.
5. Intersect each arm/class denominator separately with each scalar’s finite, unmasked support. R × K requires both original factor cells.

The kernel checks that the companion’s all-class common support and changed-cell counts equal the original allocation’s exact denominators. Every sample retains selected, valid and missing counts, valid fraction and hectares. A reported mean difference always retains both arms’ valid counts.

## Statistics and distributions

Each scalar is read once per active original allocation window. The accumulator computes centered Float64 per-window moments and merges them with the Chan formula. The displayed spread is population standard deviation over the selected pixels. Equal-area native cells receive equal weight.

Every variable uses shared histogram edges across all regions, classes and arms:

- The original prepared-grid minimum and maximum define 32 bins.
- The original alignment writer computes these bounds from the final written Float32 values, after declared conversion and masking.
- A constant original input has one explicitly identified bin.
- Empty original input support has no bins.
- The last bin includes its maximum endpoint.
- R × K uses enclosing bounds from nonnegative original factor minima/maxima. The bounds are not described as observed product extrema.
- Selected values outside their retained bounds are rejected, not silently clipped.
- Histogram counts must sum to valid count; valid plus missing must equal the arm/class denominator.

Actual per-region minima/maxima remain separate from the global histogram bounds. No quantiles, confidence intervals, significance, causal effect or matched-pair estimate are invented. Restoration minus control is only a difference between independently supported arithmetic pixel means.

## Retained output and report links

All three new companions are direct clickable links in the original scientific report recipe and are included in the same source collection and archive:

| Member | Complete contents |
| --- | --- |
| `physical-contrasts.json` | Exact input binding, source metadata, grid, run IDs, all regions/classes/arms, counts, moments, histograms and qualifications |
| `physical-contrasts.csv` | Every region × original-class group × arm × variable, including availability, units, selected/valid/missing counts, coverage, mean, population SD, extrema and descriptive R−C mean |
| `physical-distributions.csv` | Every original common bin with bounds, inclusive-endpoint flag, count, fraction of valid support and bound basis |

CSV rows are streamed from the compact accumulated record; the full bin table is not retained as a second in-memory list. Original allocation JSON, land-cover transitions, actual mask geometries and original pairwise pollutant quantities remain in the same source.

Rendered tables emphasize whole selections and the explicit RFP utilities. Full HUC/Receiving/class distributions remain downloadable, without hiding or truncating records. The helper appends original observed-report sections before the source recipe is frozen; it introduces no renderer or alternate report service.

## Identity, reuse and historical reading

New allocation identity includes the complete physical input binding and helper implementation SHA256. The outer geographic context also binds the helper SHA256 and original utility-profile file SHA256, alongside its original kernel and renderer hashes. A changed implementation or declared utility profile therefore receives a new reporting identity.

Completed historical contexts and allocations remain inspectable through their retained identity and file descriptors. Inspection does not require old reports to have a physical-input field, compare historical profile companions against the current application, or rerun native models. Current UI consumers must treat physical contrasts as an optional field when opening an older completed report.

The new per-region field is `physical_contrasts.classes`. Each class has exact changed counts and overlap, `samples[arm][variable]`, and `mean_differences[variable]`. Variable labels, units, provenance and shared bin edges are in `report.identity.physical_input_binding.variables`.

## Receiving and actual inspection

This source contribution has original-contract and statistical source review. That is not an actual native execution or visual acceptance claim.

The existing equipped producer must run the exact outgoing report continuation, open the resulting source and report, and inspect its actual desktop and narrow presentation. Operate the original controls, open all three data links, verify the retained IDs/units/counts, download and extract the final archive, and reopen the actual editable Workspace. View the final HTML/PDF, maps and any other outgoing attachments, including their full long tables and unit labels. Capturing screenshots without looking at them is insufficient. Fix clipped, unreadable, unstyled or broken presentation directly.

Record the actual command, process/log, resulting allocation/context/source identities, elapsed time, report paths, restored project and first real exception in the same original operation. Keep private operator URLs in the existing private URL file. Do not start a duplicate numerical job to exercise this reporting companion.

---

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

