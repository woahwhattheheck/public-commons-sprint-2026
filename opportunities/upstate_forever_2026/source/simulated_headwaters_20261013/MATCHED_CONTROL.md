# Matched-area off-riparian control — same simulated headwaters operation

Source: A73C's final seven-file case, merged PR3496 / 32a8937b61b0023ad969f89a901287da6ab7b1ae. Original recipe SHA256 3f8842c985a4d9186d43eafea07023ad326de1a46780f3fc93b0c4e04874d0fb. The revised terrain, original land cover, precipitation, R/K and full corridor remain unchanged.

## Ready-to-use input

matched-control.json contains the COMPLETE 14,400-cell row-major binary mask, exact changed cell indices, all 635 target/control row/column pairs and per-class rainfall residuals. Role MATCHED_CONTROL_MASK; native source ID SIM_MATCHED_CONTROL_MASK. Convert original classes 81 and 82 to 41 through the ordinary saved scenario patch.

It selects 236 pasture cells and 399 crop cells, matching the original restoration's 57.15 ha exactly. Every control cell is outside the full RESTORATION_MASK, including its already-forested cells. The exact target cells and candidate cells come from the final retained recipe.

Class 81: target rainfall sum 350880.625005; control 350877.0833189998; mean absolute paired residual 0.04078369491527788 mm/year.
Class 82: target rainfall sum 592495.5624979999; control 592486.6457990009; mean absolute paired residual 0.05325792731832108 mm/year.
Maximum absolute paired rainfall residual is 0.625 mm/year.

## Maintained driver composition

The original A73C/ECO-DELIVERY13 driver owner retains source_tools/simulated_headwaters.py. The accepted PR3496 recipe and its original source collection are already frozen. Add the control through source_tools/simulated_headwaters_control.py into a separate companion source collection, retaining the original baseline grid, parameter profile and run IDs.

1. Call `prepare(ws, original_receipt, recipe_path, recipe_path.parent / "matched-control.json", output / "control")`. The receiver verifies the exact recipe SHA256, demo identity, physical grid, complete mask, changed indices, class counts and disjointness.
2. The receiver retains the canonical mask raster, matched-control.json, generate-matched-control.mjs and its own source together. It imports those four source entries into a new collection, then saves the ordinary land-cover scenario using SIM_MATCHED_CONTROL_MASK from that collection.
3. The third run uses the original grid/profile and inherits the original selected models. Its actual scenario footprint must contain 635 net changed cells and 57.15 ha. The receiver returns source_collection_id, scenario_id, run_id, footprint_id and matching_summary without executing a native model.
4. Append that returned run to the same operation's ordinary native execution loop. Retain baseline, riparian and control order in the comparison, native_process_report, delivery scenario_run_ids, archive members and saved comparison views. Resume completed original runs under their existing IDs.
5. The full native result remains the source of export, retention and changed-area quantities. The input matching summary describes assumed inputs; the executed final land-cover ownership supplies the normalization denominator.
The merged PR3498 / 694c60e0e78342933fbebe4812d1332780f13add scenario_summary.py already retains final net native changed area and explicitly labeled reporting-area avoided export per net changed model hectare in JSON/CSV/Markdown. Use actual run ownership and shared valid support, not this planning mask as an executed result.

## Reproduce the exact selection

Import buildMatchedControl from generate-matched-control.mjs, pass the parsed exact input-recipe.json and that file's SHA256, and JSON-serialize the returned object. It uses deterministic within-class minimum-total-absolute-precipitation matching. Rainfall/index ordering plus earlier-subset tie handling makes the result reproducible. The actual final recipe was executed in V8; all 635 cells are unique, class-matched and disjoint from the corridor. Three small exhaustive subset cases confirmed the dynamic-programming objective and deterministic ties.

The selection deliberately preserves other physical differences in slope, routing, soil/erosivity and patch arrangement. Class area and precipitation are controlled or measured; the later native response is the full siting effect. Inspect the same final native stream mask alongside the corrected corridor. All inputs remain explicitly simulated.

Operation UPSTATE-DEMO-SIMULATED-INPUTS-20261013T140000Z. Original source/run owners retain the actual native execution and 14:00UTC cutoff.
