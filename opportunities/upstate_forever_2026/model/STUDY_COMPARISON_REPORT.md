# Review the complete published-study comparison

The retained study report connects the selected native results, their source coefficients, the physical differences between alternatives and the execution that produced them. It uses the existing experiment and Workspace. Source definitions, native outputs and recorded case identities stay with that same programme.

From the installed application, build or refresh the report after the existing experiment has published a summary:

```sh
python -B -m model.study_report \
  --workspace ACTUAL_WORKSPACE \
  --experiment ACTUAL_EXPERIMENT_ID \
  --programme-result ACTUAL_PROGRAMME_RESULT_JSON

```

The programme-result JSON is the existing output of `source_tools.upstate_study_profiles`. Supplying it carries the published choice names, citations and original spatial preparation into the report. The ordinary experiment summary supplies the actual completed case results. The report also works from a retained experiment without that optional programme-result file.

Open the returned `index.html` from the existing operator download or the retained `experiments/<id>/study-report` directory. It contains its data downloads, so forwarding the HTML preserves the report's CSV/JSON links. The existing experiment transfer retains the complete report and its marker. The ordinary experiment run/summarize and completed programme synchronization refresh an existing report using its verified retained source context. The explicit report command also rebuilds it from the same retained programme.

## Read the scientific result in three steps

First, check programme status and the actual land-cover transitions. The standard regional source programme has six named source choices and eight spatial states: the original baseline and seven alternatives. The engine's recorded counts and identities establish the selected programme. Source choices with equivalent native inputs can share a completed native calculation while keeping their scientific descriptions.

Second, read each alternative against its own profile's baseline. Nitrogen and phosphorus use annual kilograms; sediment uses annual metric tonnes. A positive reduction means lower modeled annual export. The signed percentage change uses alternative minus baseline. Read the retained coverage and paired-cell identity with every quantity.

Third, compare alternatives under the same profile. The pairwise comparison evaluates A and B only when they use the same baseline, identical paired valid cells and the same annual units for the constituent being compared. A's advantage is B's annual export minus A's annual export. Positive values favor A. Calculating that difference directly from the two alternatives avoids losing small differences when a much larger common baseline is subtracted twice.

The report identifies physical dominance across the selected constituents. A dominates B when at least one constituent improves and every other selected constituent improves or stays equal. A tradeoff means one constituent favors A while another favors B. The comparison keeps physical units separate and leaves implementation cost and preferences as their own decision inputs.

The **Alternatives to examine together** section turns those pairwise results into a physical shortlist for each profile. An alternative joins that profile's frontier only after all selected opponents have comparable completed outputs and none dominates it. Equal alternatives can both remain on the frontier. When outputs are incomplete or valid-cell supports differ, the unresolved comparison remains visible. An observed dominator can already establish that an alternative is dominated even while its other comparisons remain unfinished.

The source-profile summary distinguishes an alternative that stays on the frontier in every selected profile from one whose frontier membership depends on the source. It requires complete opponent coverage in every expected profile before describing that source-wide result. The downloadable `study-alternative-shortlist.csv` retains each profile/alternative, opponent counts, dominators, equals, tradeoffs, unavailable comparison reasons and original run identities. The same records are included in `study-summary.json` and the forwarded HTML.

This shortlist compares the selected land-cover alternatives with one another. Use their baseline effects to assess improvement over current land cover, and retain implementation costs, feasibility and policy priorities as separate decision inputs.

Read **compared profiles / expected profiles** beside every pair. A result becomes complete when all selected profiles have comparable completed alternatives for all selected constituents. Until then, its response describes the compared profiles. Ranges across profiles are grouped by each constituent's exact valid-cell support; different support groups remain separate.

## Interpret the actual source choice

The report's source inspection uses the selected Workspace profile tables and native parameters. Its transition inspection connects the actual saved source and destination land-cover classes to those coefficients. This makes two especially consequential published differences visible beside the native result:

- In the retained regional reference, pasture 81 to grassland 71 changes phosphorus loading from 1.35 to 0.15 kg/ha/year. The Albright table changes 0.1 to 0.4. Review this component alongside the crop-to-forest component in the combined steep-restoration case.
- Developed-land USLE C/P choices differ substantially. Deciduous forest 41 to low development 22 changes C×P from 0.001 to 0.05 in the regional reference, from 0.009 to 0.00003 in Albright, and from 0.002 to 0.05 in the Upper Flint hybrid.

Those source values describe local loading and erosion assumptions. The native output includes routing, retention and the rest of the selected landscape. Use the signed completed output to explain the actual modeled response, then use the selected coefficients and parameters to explain why profiles can disagree.

The complete source comparison, original references and exact tables are retained in [the coefficient interpretation](../source/regional-studies-20261013/COEFFICIENT_INTERPRETATION.md). Upper Flint keeps its explicit nine-class mapping; unchanged regional urban classes retain their original source identity.

## Read execution and capacity from the actual operation

The execution section reads the distinct native run IDs selected by the experiment, including their paired baselines, once each. It separates calculated, reused and pending NDR/SDR stages. A reused stage retains its original donor and scientific input signature.

Recorded native elapsed time counts completed local native stages and their registry capture. Donor timestamps inherited by reused stages are excluded from that local total. Transfer elapsed time uses the actual reuse start/end records. Missing or reversed timestamps remain unknown. The underlying CSV retains original stage and donor timing fields for independent review.

Native output inventories deduplicate repeated registry, companion and delivered-export descriptors by run and relative path. Their byte totals describe logical retained file lengths. The per-model rows sum their own stage inventories. Actual shared disk allocation can differ when the verified importer uses reflinks.

Transfer totals include the stages with measured transfer bytes; separate measured/unknown counts identify older retained stages lacking that observation. A missing measurement stays unknown. Worker free-space observations retain their original timestamps and host context and are never added across runs on a shared filesystem.

This accounting reads small run records without loading raster arrays or a native model runtime. Each captured record retains its exact original bytes/hash descriptor. The report records its observation time separately from the experiment summary's publication time, so an active worker's later progress can be understood.

## Continue the same work

Use the existing experiment Run/Resume action or its original programme command to continue native execution. Completed case identities and verified stages remain available for reuse. The report reads those retained results; building it does not dispatch a model.

Keep the programme's native results, signed constituent differences, coverage, source choices and implementation assumptions together when moving into the Economic desk or a reviewed delivery. The original commercial workshare still selects its reviewed baseline and two alternatives. The broader source/scenario programme supports the team's scientific preparation and choice of those alternatives.

TokenJunkieLabs.
