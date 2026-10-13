# Exact regional matched restoration control

Operation: ECO-CLOUD-07AA, joining the existing Upper Savannah geographic preparation owned in Slack workstream 1791724121.853269, WAT8405 / 6A4E7845. The existing geographic producer and original native NDR/SDR operation remain the consumers.

## What this delivers

`source_tools/matched_control_exact.cpp` computes the exact minimum-total-absolute-precipitation subset matching, without a treatment-by-candidate cost/backtracking matrix. `matched_control_exact.py` supplies a NumPy API, unchanged-grid GeoTIFF CLI, full pair CSV, mask, original input identities, class/support report and explicit reporting-area comparison. The small original teaching case and its stored outputs are not overwritten.

The native engine requires C++17 once to build. The received Linux x86-64 executable can instead be supplied through `--binary`. Python needs NumPy; the raster CLI also needs rasterio. These are already available on the producing Linux host.

## Integration with the maintained raster-window preparer

WAT keeps `prepare_control(nlcd_path, restoration_path, corridor_path, reporting_mask_path, precipitation_path, destination, *, seed)`. Use the exact kernel below inside that function after identifying its authoritative target and eligible original-cell arrays. Do not substitute a second geographic input generator.

```python
from pathlib import Path
from source_tools.matched_control_exact import match_points

# IDs are original row-major cell indices in the unchanged 30 m model grid.
# The caller already ensures: one class and reporting stratum; each target is
# an actual changed cell; candidates exclude the WHOLE corridor/restoration.
pairs, summary = match_points(
    precipitation[target_ids], precipitation[candidate_ids],
    target_ids, candidate_ids,
    binary=Path("/actual/source_tools/matched-control-exact"),
    directory=Path("/actual/new-output/class-81-reporting"),
)
selected_original_ids = pairs["control_index"]
```

The preparer's separate restoration and corridor inputs must remain separate. `match_arrays` is suitable when its corridor's convertible cells are precisely the treatment. If a maintained recipe uses a smaller treatment subset inside a wider corridor, call `match_points` with the producer's exact target and candidate lists instead. Never turn the wider exclusion corridor into additional treatment.

`match_points` creates its directory once and retains input binary, complete ordered pair binary and result JSON. Repeated operation handling stays with the calling producer's existing content-addressed identity. Candidate membership and unique selection are checked after the native process. The caller owns original ID uniqueness, support/mask construction and scientific source identity.

The native result contains the exact integer objective, exact prefix optimum, lossless binary unit exponent and actual process time. Each pair retains original target/control IDs and signed precipitation residual in those integer units. Divide by `2**binary_scale_exponent` to obtain mm/year. No precipitation rounding or binning is introduced. Typical physical rainfall fits the fixed-width representation; extreme unsupported dynamic ranges fail without altering the inputs.

## Array API

`match_arrays` requires aligned two-dimensional land cover, precipitation, complete corridor and valid model-domain arrays. It matches each original source class, preserving the exact target count and excluding every corridor cell, invalid cell and unrelated class. Optional `reporting_mask` reports the actual treatment and control reporting areas. `reporting_stratified=True` explicitly adds reporting membership as a matching constraint. It must be selected by the geographic producer; it is not silently added to class-only matching.

Additional original `support_fields`, such as R_FACTOR, K_FACTOR and DEM, are summarized at the matched cells. They are not matching constraints. Their differences remain part of the native siting comparison.

## Raster CLI

```sh
python source_tools/matched_control_exact.py \
  --landcover /actual/inputs/nlcd.tif \
  --precipitation /actual/inputs/precipitation.tif \
  --corridor /actual/inputs/restoration-mask.tif \
  --domain /actual/inputs/model-domain-mask.tif \
  --reporting /actual/inputs/sc-reporting-mask.tif \
  --support R_FACTOR=/actual/inputs/r-factor.tif \
  --support K_FACTOR=/actual/inputs/k-factor.tif \
  --from-codes 81 82 --to-code 41 \
  --source-manifest /actual/inputs/source-manifest.json \
  --binary /actual/source_tools/matched-control-exact \
  --output /actual/new-control-output
```

Add `--reporting-stratified` only when that is the intended matching objective. Add `--compile` only when a fresh executable must be built, selecting a new `--binary` path. The CLI does not compile by default, resample, crop, redraw source geometry, run InVEST or alter the existing Workspace.

Every input raster must share its original CRS, shape and affine transform. This receiving course requires the owner's projected-metre, north-up 30 m grid. The domain and reporting masks may have nodata outside their geometry; nodata becomes zero support. Precipitation/class/corridor nodata inside the domain fails visibly rather than shrinking the scientific support. Output is a uint8 GeoTIFF, 0/1 within model support, 255 nodata outside.

Outputs include full original-grid mask, exact complete pair CSV and native pair binaries, source-bound JSON, readable HTML, original manifest copy, and actual input/source hashes. Open `index.html`; tables scroll on a narrow display and every pair remains available in the CSV.

## Algorithm derivation

Process required targets and optional candidates together in precipitation order. At each prefix, let `F(d)` be the minimum matching transport cost with imbalance `d = targets_seen - controls_selected`. Its finite domain is `[T-S, T]`, where `T` and `S` count targets and candidates seen. `F` is discrete convex.

A target shifts the domain right by one and leaves the slope sequence unchanged. A candidate changes the function to `G(d) = min(F(d), F(d+1))`: the new sorted slope sequence is the old sequence with one zero inserted. Advancing a precipitation distance `dx` adds `abs(d)*dx`; therefore the slopes at `d <= 0` decrease by `dx`, and the remaining slopes increase by `dx`. Their order is preserved.

An implicit treap maintains these ordered slopes with rank splits and lazy range additions. One candidate adds one node. Its zero insertion rank gives the predecessor-choice threshold, which is retained with the original event. Reverse traversal from final imbalance zero reconstructs the selected candidate subset. Pairing the selected and required points in sorted order realizes the line-transport cost and is optimal for absolute distance.

Expected runtime is O((T+S) log(S+1)); storage is O(T+S). Priorities use a deterministic SplitMix64 sequence. This is not a deterministic worst-case balancing guarantee. Events use 32 bytes and treap nodes 40 bytes in the producing Linux build, plus the selected-event vector and IO buffers. The old DP allocates `(T+1)*(S+1)` backtracking bytes per class before its row costs.

The implementation uses lossless binary integer precipitation coordinates, exact signed 128-bit objective accumulation and an independent equality between reconstructed-pair cost and the retained prefix optimum. It does not rely on a floating tolerance to assert optimality. Equal-cost selection is deterministic. The original case retained the same earliest-candidate subset as its existing DP; other equal-cost instances may be consumed as a separately identified edition rather than replacing historical selections.

## Completed original-input course

Source generator Git blob `f1acf0f2a1470e059ad5f5b8231178ae59876954` was physically copied, its complete Git blob identity checked, and its actual Node function executed. The new matcher selected the same original 236 pasture and 399 crop control cells as the old exact DP, with identical integer objectives. Total support is 635 cells / 57.15 hectares, zero corridor overlap. Matching process times on host `9d28c55207aa` were 0.003186779 and 0.003011961 seconds. These are small-case selector timings, not regional or native model timings.

The same focused course covered equal precipitation, unequal counts, endpoint cases, empty targets and insufficient candidates. Accepted numerical results are retained in the delivered original course and are reused; no repository test suite is involved.

## Scientific interpretation and handoff

Keep original geographic source collections, original 217-HUC contributing domain, the separate South Carolina reporting mask and actual utility footprints. Physical inputs remain labeled according to their original simulated/observed source edition. A control input and its precipitation residuals are not stream-export results. Native NDR/SDR runs supply annual nitrogen/phosphorus kg/year and sediment tonnes/year reaching streams, with original model support and units. Soil/terrain/routing/patch differences remain part of the modeled intervention comparison.

Read the complete maintained `CURRENT_OWNER_DIRECTION.md`, version `2026-10-13.3`, with the original application receiving instructions. Preserve October 13, 2026 10 a.m. Eastern / 14:00 UTC cutoff, existing native operations and their current source owners. The prime retains scientific methods, review and the client relationship. Keep source preparation, run, inspect, revise, export and cold reopen connected in the original application.

Before presenting the delivered product, open the actual HTML and all downloaded pairs, summaries, masks and source/project attachments as their recipient would. View desktop and 390px screenshots, use table scrolling, every download, print and reopening. Repair visible defects in the affected output. Source checks and screenshots not actually viewed do not replace using the product. Retain plain industrial presentation and continue engineering; this creates no separate review gate or broad test run.
