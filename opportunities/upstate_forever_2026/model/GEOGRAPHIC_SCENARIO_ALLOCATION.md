# Geographic scenario allocation: local accounting for the original simulated case

This report answers a concrete review question: **where did the retained restoration and matched control actually change baseline land cover, and are their local changed areas and original class mixes equal?** Matching over the whole reporting selection does not establish matching inside each HUC, upstream utility association, published protection area or nested buffer.

The implementation is an additive companion to the original completed geographic case. It reads the three retained compiled scenario footprints and the original Receiving masks, retains the exact run identities, and produces a scientific source for the existing ordered report workflow. It does not prepare substitute scenarios or execute NDR/SDR.

## Continue the original operation

Use the original application, Workspace, selection, output directory and runtime already owned by the receiving course. Preserve its admission files and active processes. The maintained caller is:

~~~sh
python source_tools/receive_geographic_headwaters.py \
  --workspace ACTUAL_WS \
  --selection ORIGINAL_SELECTION \
  --output ORIGINAL_OUTPUT \
  --report-only \
  --adopt-handover
~~~

Replace the placeholders with that operation's existing paths; use its actual Python interpreter. The completed-case continuation reuses original results and adds the current geographic context and allocation source. The original full course retains its existing --run mode. Do not start a second native run merely to make this report. The receiving course's maintained instructions remain [GEOGRAPHIC_NATIVE_RECEIVING.md](../docs/GEOGRAPHIC_NATIVE_RECEIVING.md).

The geographic context's original prepare path adds the allocation result, and its append_sources path adds the exact resulting collection/document choice to the ordered report selection. Existing retained contexts without the new field remain readable. Open the resulting source in the existing Sources report composer; preserve the original source order and existing review requirements. An existing native report-only continuation may render a new report edition, while the three completed native model runs remain unchanged.

For integrations inside the original application, the allocation API is:

~~~python
from model import geographic_scenario_allocation

result = geographic_scenario_allocation.prepare(
    workspace, prepared, receiving_context, progress=progress
)
same_result = geographic_scenario_allocation.inspect(workspace, result["id"])
source_choice = result["source"]
~~~

Use the exact retained prepared record and Receiving context. Their project, preparation, grid, ordered scenario/run identities and complete original footprints are validated. This is an application integration seam, not a second operator or receiving service.

## Three distinct kinds of support

| Output | What is counted or retained | Interpretation |
| --- | --- | --- |
| Primary land-cover allocation | Region mask intersected with finite categorical cells in baseline, restoration and control | Exact final baseline-to-alternative transitions on the same categorical support |
| Pollutant-specific three-run native support | Finite annual-output cells common to the same three runs; also its intersection with common land cover | Availability and changed area on a common support, separately for each pollutant and quantity scope |
| Original Receiving pairwise quantities | Baseline versus each alternative using that pair's original native masks | Retained annual totals and signed change; restoration and control pairs may have different common cells |

The primary allocation reports final raster transitions. It does not sum individual planting/edit instructions, which may overlap, revert a cell or cascade through more than one class. Missing or masked cells are excluded from common support; they are not assigned zero change.

Cell counts remain integers. Hectares use the actual projected grid cell area. The implementation admits an aligned projected metre grid and preserves its CRS, transform, width, height and pixel area. It does not assume every raster is a 30 m raster or replace the affine-derived cell area with a hardcoded 0.09 ha. The retained RFP selection remains the source of the actual resolution.

Vector polygon area, raster-selected area and common valid raster area have different meanings. A polygon boundary can select partial-edge cells by the original mask rule; multiplying selected cells by cell area is not an independent measurement of the vector polygon. The source JSON retains these fields separately.

## Geographic relationships and overlaps

HUC-local polygons, upstream HUC associations and published protection areas are separate records. A seed HUC and its retained upstream topology do not establish an intake point, a point-delineated intake catchment or reservoir transport. The original published protection geometry keeps its own provenance and meaning.

The model_domain scope and reporting scope remain distinct. The former describes the admitted contributing native domain; the latter uses the original reporting output/mask. Neither is silently replaced by the four utility focus anchors. The report groups rows by original kind, relationship and quantity scope.

Utility areas, nested protection buffers, HUC associations and family unions can overlap. **Do not add their row areas or native quantities.** A family union deduplicates pixels within that original union; its row is not the sum of its member rows. The diagnostic summary counts records with differences, not disjoint hectares, independent catchments or distinct affected customers.

An empty display geometry, a region with no selected cells, and a region with selected cells but no three-run valid categorical support remain explicit. The original raster mask can retain boundary cells even when its display polygon is empty. Those mask-selected cells and quantities remain valid retained accounting; the report names this condition and omits only the absent map shape, without inventing a replacement polygon. They do not become evidence of balance or no effect. The balance plot excludes only rows with no common categorical support, and its caption/table retain that exclusion. Supported zero-change rows remain visible at the origin.

### Original utility-focus unions

The optional utility_upstream_union rows use the retained source/receptor-profiles/utility-focus-20261012.json profile, whose original schema is upstate.receptor-spec/v1. That profile attributes its anchors to the issuer appendix identified by SHA-256 04313cdda0b19f98b4081ef1eeec2f52707437759f9058f8d0e5abc8d83d6dbf.

| Retained utility profile | Exact anchor HUC12s | Profile's issuer-reference pages |
| --- | --- | --- |
| ARJWS — Six and Twenty focus watersheds | 030601010703; 030601010704 | 6, 12, 16 |
| PRWD — Tugaloo and Choestoea focus watersheds | 030601020502; 030601020507 | 6, 14, 16 |

The kernel uses each anchor's already-retained Receiving upstream_huc_ids relationship and contribution geometry, then deduplicates their union for that utility. The explicit relationship is profile_upstream_huc_union, separately evaluated in model_domain and reporting scopes. It is a profile-anchored upstream HUC planning union, not an intake-delineated catchment or a substitute for published protection areas. The exact profile file is retained in the allocation artifact and identity.

These union rows have original categorical allocation and three-run native-validity/support counts. They do not have pairwise mass totals unless an actual matching original Receiving union analysis supplies those results. No pairwise totals are copied or summed from the overlapping member anchors, and common support counts are not represented as a native load calculation.

## Reading the allocation report

The report identifies the exact project, geographic preparation, allocation and three native runs before presenting numerical comparisons.

**Local allocation tables** show all region rows in their retained order, common categorical cells, restoration changed hectares, control changed hectares and the difference in changed hectares. R means restoration; C means control. The difference is R minus C for input land-cover area only. The diagnostic uses exact cell counts, so a rounded display does not establish equality.

**Coverage tables** retain selected-mask cells and the valid categorical counts for baseline, restoration and control separately, together with their common intersection. Empty display geometry does not erase an original raster mask.

**Original-class tables** show changed hectares from baseline codes 81 and 82 separately, including zero rows, and the total for all other changed origin codes. The caption lists the actual other origin codes in that group. Every individual origin, destination, unchanged transition, cell count and hectare value remains in transitions.csv and allocation.json. No class is discarded because it was unexpected.

**Common-support tables** show pollutant-specific native common cells, their intersection with common categorical cells, and restoration/control changed hectares on that intersection. These are support diagnostics. They do not compute a new native mass total or imply a pollutant benefit per changed hectare.

**Pairwise native quantity tables** retain the original baseline, alternative, common-cell count and signed change for each pollutant, alternative and geographic scope. Their units are copied from the original Receiving record. Nitrogen and phosphorus are annual kg/year; sediment is metric tonnes/year.

The native signed change is **alternative minus baseline**, accumulated from the original stored Float32 signed-difference pixels. Baseline and alternative totals retain the original accumulation of their values. Subtracting the displayed totals need not reproduce the stored signed change exactly, and the renderer does not recompute it. The full row retains direction and sum_basis in the original kernel's JSON/CSV.

**Do not subtract restoration and control pairwise native changes as a matched-control effect.** Their baseline intersections can differ. This companion adds three-run support counts but deliberately does not replace the native quantity calculation with a new common-support mass estimator.

These modeled annual quantities represent land export delivered to streams within the named support. They are not observed loads, intake concentrations, reservoir delivery or treatment removal. Equal local changed counts or class mix alone do not establish equal rainfall, terrain, routing, baseline export or native response.

## Maps and balance figures

The report uses the existing upstate.scientific-figure-spec/v1 contract and the maintained scientific_figures/scientific_map_figures renderers. The SVG attachment and PDF vector panel come from the same original Drawing.

Each original kind/relationship/scope group receives a geometry overview when it has nonempty geometry. Every original vertex, multipart component and hole is retained. There is no reprojection, simplification, basemap, inferred stream, inferred intake or invented monitoring location. Map labels, where a group has at most six regions, are cartographic interior anchors only. Larger groups retain all boundaries without a pile of unreadable numbered labels; exact region names and values remain in the tables, GeoJSON and figure specification.

Grey fill and dark edges describe the same region geometry. They do not show the changed pixels, rainfall, pollutant intensity or additive area. Grid north is positive projected Y, and scale is projected grid distance rather than a local ground-distance correction.

A second figure plots restoration changed hectares against control changed hectares for every region with categorical common support. The equal-area diagonal is a descriptive reference. It is not a statistical test, a local matching guarantee or a statement about hydrologic benefit. Coincident points can overlap. Each original point's region ID/title and full numeric values are retained in the figure specification.

## Complete retained outputs

The kernel writes the original numerical/geographic products before rendering:

| Member | Contents |
| --- | --- |
| allocation.json | Full identity, grid, ordered runs, every region, masks/support counts, transitions, local balances, native quantities and notes |
| regions.geojson | Exact projected region geometry plus original identifiers, scopes and displayed changed-area values |
| allocations.csv | Every region and alternative with selected/common cells and changed/unchanged allocation |
| transitions.csv | Every baseline-to-alternative class transition, including unchanged cells |
| native-support.csv | Every region/pollutant three-run native and land-cover support count and changed area |
| pairwise-native-quantities.csv | Every original Receiving pair with units, support, direction, sum basis and retained values |
| figures/allocation-figures.json | Source-bound native map/balance specifications and renderer provenance |
| figures/allocation-map-*.svg | Native vector geometry overviews |
| figures/allocation-balance-*.svg | Native vector changed-area plots |
| figures/allocation-figure-members.json | Exact figure input identity and byte/SHA descriptors |
| original-prepared.json | Original geographic preparation, retained by the kernel |
| original-context-selection.json | Original Receiving context selection, retained by the kernel |
| report-source.json / sources.json | Original observed-report recipe and source-import manifest |

The renderer API is:

~~~python
write(directory: pathlib.Path, report: dict, features: dict) -> dict
~~~

It returns standard observed-report sections, exact describe_file descriptors, figure choices and figure_spec. It first verifies that allocation.json and regions.geojson equal the supplied original objects and that their region rosters, labels, scopes and allocation values agree. The kernel imports the complete source using the existing Workspace source store; there is no new report family or review store.

The renderer never opens a raster and does not import the allocation kernel. Source tables are complete and grouped into readable blocks rather than producing a separate report chapter for every HUC. The JSON/CSV attachments retain all original precision. Small nonzero displayed values are not rounded into a false exact zero.

Completed figure inventories reopen their retained bytes. A changed original input is rejected; existing SVGs are not silently overwritten. New files use a private temporary file and atomic publication, with a directory fsync on supported non-Windows platforms. The allocation kernel retains its original locked staging/import/retry behavior.

## Editable handover and actual inspection

Use the original full Workspace backup and receiving workflow for a complete editable handover. It must include the application, original sources, prepared geographic selection, three scenario footprints, native run records/artifacts, Receiving plans/analyses and allocation/report source. A standalone report or source ZIP preserves its declared report/GIS/data attachments; it does not by itself promise the entire native working project.

After receiving, open the original workspace/project and confirm the retained allocation, source choices, report edition and exact original run identities. Open the GIS and CSV/JSON members as working data, not merely as filenames in an archive listing. Continue the original report/review controls; retain the prime's authored scientific interpretation and customer feedback separately.

The producing native peer must open, see and operate the exact outgoing version. Inspect the actual PDF pages, full HTML at desktop and narrow/mobile widths, both SVG figure kinds, the source CSVs/GeoJSON, downloaded archive contents and the independently reopened working project. Use populated, empty-support, loading/error and reopen paths relevant to the actual case. Confirm readable tables/units, intact long IDs and links, unbroken map extents/holes, non-clipped titles, downloads and retained source identities. Fix defects directly.

Source review, parsing, synthetic examples, HTTP responses and unviewed screenshots are not visual acceptance. This renderer source publication does not claim that a native raster case, rendered report or cold reopen has executed. Keep any actual execution result tied to its original run/capture/receiving identity and observed logs.

## Full standing owner direction

The following is the complete durable brief from CURRENT_OWNER_DIRECTION.md, version 2026-10-13.3. Carry it unchanged with the next native/browser/source handoff.

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
