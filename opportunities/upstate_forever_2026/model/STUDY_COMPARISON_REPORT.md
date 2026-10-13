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


## Completed watershed context in the scientific report

The report joins the grid's original `model_domain` and `reporting_area` source
selectors to a completed watershed-context edition by exact HUC12 membership.
It applies the original layer and property filter. A saved matching Workspace
context takes precedence; otherwise the checked-in completed-result package is
verified through the maintained native receiving code. This reads the completed
result and its original receipts without executing another model.

The geographic section and `study-watershed-context.csv` preserve one row per
HUC. They retain published whole-HUC acres, labeled state portions, FY26
source-water priorities and selected-class publisher feature counts. The
management group follows the actual reporting source, while other contributing
HUCs remain in the routing context. Whole-HUC membership does not establish
whether the reporting polygons were clipped to a state boundary. The reporting
mask's area, when available, comes separately from recorded native reporting
cells multiplied by the grid's actual pixel area. Pollutant comparisons retain
their own paired valid-cell support.

The retained original context contains 217 HUCs and 4,659,072.10 whole-HUC
acres. Its 116 SC-containing HUCs have 2,414,468.41 whole-HUC acres, of which the
published SC portions total 2,113,830.3203338 acres. These are source grouping
quantities; the actual grid selectors determine which group appears as managed
area. The original edition retains 15 FY26 priority HUCs and 1,886 selected-class
source features. The report links the NRCS and SCDES publisher sources and
retains the exact completed-result identities in its downloadable JSON.

Unrelated grids, including Gura, receive no regional context association when
their source HUC membership is absent or differs. Multiple matching saved
editions remain separate. The original result archive remains available through
the existing regional receiving workflow and Workspace delivery.


## Explore native comparisons visually

The existing profile, alternative, pollutant and text filters now update both the comparison table and its comparison plots. Each marker is the retained reduction for one source profile and land-cover alternative against that profile's own baseline. Positive values mean lower modeled export.

The default plot uses annual export reduction in the model's retained units. The percentage option uses the negative of the table's recorded alternative-minus-baseline percentage, so its direction remains consistent with absolute reduction. A zero baseline has no defined percentage; those rows remain available in the comparison table and are explicitly counted as omitted from percentage plots.

Separate pollutants, units, support hashes, cell counts, reporting counts and paired areas generate separate plots. Each has its own numeric axis, a zero reference, full source-profile legend, paired support identity and exact marker values. These are comparisons of the selected source choices; the view adds no statistical confidence interval or probability weighting.

Download any plot as a standalone SVG containing its alternative labels, source-profile legend, units and support identity. Each marker retains its full numerical values and profile, scenario, baseline-run and alternative-run identities in its accessible description. The original full CSV and JSON downloads remain in the report. The portable HTML needs no chart service or network request. The underlying shortlist and comparison methods are unchanged.


## Compare every original profile assumption

The **Original profile assumptions** section compares the exact original CSV cells selected by this experiment with its original baseline profile. It includes nutrient loads and their loading basis, retention fractions and critical lengths, subsurface nitrogen, sediment C/P factors, source descriptions, references and every additional original field. It identifies added or removed land-cover codes and fields, and distinguishes an empty cell from an absent cell, field or code.

Raw text stays unchanged: leading zeros, whitespace and published precision remain visible. A textual change such as `1.0` to `1.00` is reported as a source-text change. The maintained numerical interpretation still owns numerical deltas, loading-basis compatibility and routed effects; this source comparison does not reinterpret those outputs. Land-cover rows use the native reader's integer code for matching while retaining the original code spelling as a compared cell. Repeated column names retain their original occurrence, and additional unheaded cells remain available.

Open **Complete original tables and source references** for every retained original row and column, the full saved profile and source-entry metadata, selected model scope, native settings, model periods, references and source identities. Repeated CSV bytes are displayed and downloaded once. Each profile keeps its own full definition and every selected case keeps its original profile, scenario, state and native run binding in the companion JSON. Profiles sharing one table can still have different native settings or references.

The same portable HTML embeds `study-original-profile-comparison.json`, `study-original-profile-cells.csv` and each exact original CSV under `original-biophysical-<full SHA256>.csv`. Original CSV downloads preserve their complete bytes, including their original encoding/BOM and record endings, and are verified against the profile and source entry. The comparison CSV uses JSON-encoded source values with explicit presence-state columns, preserving exact strings and the distinction between empty and absent values. Parse those JSON value columns to recover original cell text. The original source entry retains the publisher's filename, location, edition and complete metadata.

These additions use the report's existing experiment/report locks, summary snapshot, complete embedded downloads and publish-last marker. The ordinary report refresh and original archive/restore carry them alongside all existing numerical comparisons and geography. Build the report with the existing command above; it reads retained source tables and does not start a native model run.
