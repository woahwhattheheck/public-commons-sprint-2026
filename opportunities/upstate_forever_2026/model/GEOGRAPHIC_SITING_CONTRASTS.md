# Native siting contrasts on identical source cells

This reader adds a decision comparison to the maintained geographic scenario
allocation. It uses the three completed original baseline, restoration and
control runs already selected by the geographic Receiving context. It reports
annual mass on an identical, pollutant-specific finite support, together with
the actual intervention areas and source-cell partitions needed to interpret
that mass. The existing allocation, physical contrasts and pairwise Receiving
results remain separately named in the same complete report.

The comparison is part of the original allocation pass. It opens no additional
raster dataset, changes no native scenario or matching pair, and launches no
solver. The source publisher for model/geographic_scenario_allocation.py remains
ES26; compose the supplied guarded changes on that maintained body.

## What Tim can read directly

For each whole selection and RFP utility upstream union, the existing native
observed report now shows baseline-minus-restoration, baseline-minus-control,
and control-minus-restoration annual export. A positive final contrast means
less modeled export under restoration. Negative results remain visible. Every
term uses the same source pixels for that pollutant and selected scope.

The companion area table separates these original denominators for each arm:

| Denominator | Original source and meaning |
| --- | --- |
| Whole-scenario changed hectares | Verified compiled footprint's final net changes from the original unchanged geographic baseline; not the sum of sequential patch assignments. |
| Changed hectares inside the region | The original allocation's actual baseline-to-alternative categorical changes on its all-three valid land-cover support inside this exact mask. |
| Changed hectares inside pollutant common support | The preceding changed cells that also have finite original annual output in baseline, restoration and control for this particular pollutant. |

All three areas are retained as separate JSON and CSV fields. The CSV also retains each explicit normalization_basis, normalized_units and the separately named local, whole-scenario and native-common rate unavailable reasons. No common native support is distinguished from a zero denominator; percent change separately identifies zero baseline mass. The shared-area rate is labelled C-R per equal local changed ha (descriptive). The principal
local rate is the entire region's avoided export divided by its actual local
changed hectares. Separately named companion rates use the complete intervention
area or the pollutant-common changed area. A zero denominator yields null; it
never becomes one hectare, zero benefit, infinity or an omitted record.

These rates answer different descriptive questions. The complete intervention
denominator allocates a region's outcome over the whole scenario's intervention.
The local denominator describes the outcome relative to intervention inside
that selected region. The common-support denominator makes the output-support
restriction visible. None establishes that the region's outcome was caused
only by its own converted pixels.

Control-minus-restoration per *shared* changed hectare appears only when the
two original local interventions have positive equal changed-cell counts and
equal original-class counts. Otherwise the annual mass contrast is retained,
but an equal-budget normalized effect is unavailable. Global exact precipitation
matching alone does not satisfy this local condition: pairs can cross HUC and
utility boundaries.

## Support and annual units

For one original region and quantity, the computation uses:

- The exact existing region selection. Original contribution masks remain
  authoritative, including Boolean OR utility unions and their boundary pixels.
- The intersection of finite original baseline, restoration and control annual
  output cells within that region.
- Native density-to-mass conversion already performed once by the maintained
  Receiving reader. Reporting artifacts are already mass per pixel; model-domain
  native outputs use their original grid pixel area exactly once.
- Nitrogen and phosphorus in kg/year, and sediment in metric tonnes/year.

For that common mask M, the new reader retains these direct sums:

    baseline mass             = sum_M B
    restoration mass          = sum_M R
    control mass              = sum_M C
    restoration avoided       = sum_M (B - R)
    control avoided           = sum_M (B - C)
    restoration advantage     = sum_M (C - R)

These are float64 reductions of retained original mass values, with a Neumaier
compensated merge between windows. Computing C-R directly avoids subtracting
two independently rounded large totals. The existing pairwise Receiving outputs
keep their own masks and their original change-pixel arithmetic. Their totals
are not silently replaced or used as a three-way subtraction.

The hash of common support includes each actual window address and the packed
selected bits. Counts alone cannot establish mask equality. The per-pollutant
common count, common area, categorical intersection and common fraction are
retained alongside the identity. Native nodata, including structural stream
support where applicable, stays excluded. It is never filled with zero.

The mask selects the origin of exported material. A source-pixel total describes
material originating within that selected area and delivered to streams along
the model's routing. It does not measure load crossing the mask boundary, an
intake concentration, a downstream receptor's observed exposure, or monitored
water-quality improvement.

## Where a modeled change originates

For each alternative, the same native common support is partitioned into:

1. Changed source cells: the original categorical-common cells whose final
   baseline and alternative classes actually differ.
2. Unchanged source cells: categorical-common cells whose classes remain equal.
3. Unknown categorical support: native-common cells lacking the all-three
   categorical support needed to assign either preceding label.

Each partition retains cells, hectares, baseline mass, alternative mass and
avoided export. Counts must cover the native common support exactly; changed
counts must equal the maintained allocation's pollutant-specific changed-cell
support. Finite native cells with unavailable categorical labels remain visible
in the third partition.

A nonzero difference at unchanged source cells is possible when modeled
retention or routing changes elsewhere. This is useful context for an upstream
restoration programme. It is not a separately identified causal estimate.
Likewise, a selected region can have zero local treatment but a nonzero native
scenario difference; that condition is explicitly flagged.

## Existing operator and source flow

Use the same completed geographic preparation and Receiving context currently
owned by the native operating seat. The maintained entry point remains:

    from model import geographic_scenario_allocation
    result = geographic_scenario_allocation.prepare(workspace, prepared, context)

Both prepared and context are the original retained records in that Workspace.
Their ordered baseline/restoration/control IDs, grid, profile, footprints,
source masks, native execution versions and completed state are validated by
the existing allocation and added reader. Do not construct replacement records
from display labels or combine the earlier 1,296-hectare square demonstration
with this original-geography edition.

The source bank supplies one complete helper, its guide, a complete composed
allocation postimage and guarded before/after edits for the sole publisher.
The composition base is the actual merged 4285 allocation, Git
a9858bea91530f398a0c9ba932194ff11dd2c91f, 40,936 UTF-8 bytes. It preserves that
edition's physical_contrasts, source companions, utility unions and renderer.

The reader snapshots its exact Python bytes, original native descriptors,
observed compatible native versions and complete-footprint intervention
summaries before allocation identity is computed. Original native source
descriptors are verified again after the window pass. A code or original-source
change therefore selects a new allocation edition; completed historical records
remain usable.

Whole-scenario changed area requires the original geographic baseline to have
zero final net changes from its prepared grid. The original scenario compiler
already records this condition. A different edited baseline must receive an
explicit baseline-relative area derivation before using this whole-scenario
denominator; its footprint's changes from an older grid are not silently
relabelled as changes from the selected baseline.

The current calculation holds native values only for the active 256-pixel
window and quantity scopes. It keeps small accumulators per original region.
The pre-existing physical scalar pass is preserved; no per-region raster
rescan or full-grid native output array is introduced.

## Complete result members

The allocation's existing immutable report inventory and original source import
include all five added files before the report source is created:

| File | Complete contents |
| --- | --- |
| siting-contrasts.json | All original-region/pollutant totals, denominator fields, support identities, partition rows, notes and complete source binding. |
| siting-contrasts.csv | One row per original region and pollutant, all three masses and signed contrasts, three distinct per-arm denominators, separately named rates and exact run/footprint IDs. |
| siting-change-partitions.csv | Every per-arm source-cell partition, with original region/run identity, count, area, baseline and alternative mass and avoided export. |
| siting-contrast-sources.json | Original quantity descriptors, observed runtime versions, whole-scenario footprint summaries and the exact implementation identity. |
| geographic_siting_contrasts.py | Exact snapshotted calculation source used by this edition. |

The standard observed-report sections show the whole selections and RFP utility
unions first. The full CSV and JSON include every original HUC, selected receptor
and retained accounting region. Region rows overlap according to their original
meaning; summing rows is not a valid new catchment total.

The report source links and source companions include all five members. Existing
scientific-report, selected-study and complete Workspace delivery consumers
therefore receive the same saved edition and original files. There is no second
report renderer, queue or browser application.

## Meaningful native handback

The existing completed-run owner can calculate this allocation directly from
retained outputs without repeating NDR or SDR. Return its actual allocation ID,
source collection/source ID and any native traceback. On the populated report,
inspect one original whole-selection row, both available utility unions, one
unequal or zero local treatment row when present, and the complete downloaded
CSVs/JSON. Confirm the displayed units and three area labels against those
exact retained rows. Native or browser failures are repaired in this same
edition's existing source/receiving operation.

Source/API review of the arithmetic is complete. Actual native execution and
personal rendered-product use are recorded only when the producing native seat
returns and opens the real result. This report follows the owner's complete
current rendering and outgoing-attachment direction below.

## Model interpretation sources

- InVEST 3.20 NDR: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html
- InVEST 3.20 SDR: https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html
- Maintained original adapters: model/receiving_waters.py,
  model/geographic_scenario_allocation.py, model/scenario_footprint.py,
  model/native_versions.py and model/rasters.py.

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
