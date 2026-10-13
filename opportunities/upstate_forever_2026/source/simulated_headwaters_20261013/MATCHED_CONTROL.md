# Matched-area off-riparian control — same simulated headwaters operation

Source: A73C's final seven-file case, merged PR3496 / 32a8937b61b0023ad969f89a901287da6ab7b1ae. Original recipe SHA256 3f8842c985a4d9186d43eafea07023ad326de1a46780f3fc93b0c4e04874d0fb. The revised terrain, original land cover, precipitation, R/K and full corridor remain unchanged.

## Ready-to-use input

matched-control.json contains the COMPLETE 14,400-cell row-major binary mask, exact changed cell indices, all 635 target/control row/column pairs and per-class rainfall residuals. Role MATCHED_CONTROL_MASK; native source ID SIM_MATCHED_CONTROL_MASK. Convert original classes 81 and 82 to 41 through the ordinary saved scenario patch.

It selects 236 pasture cells and 399 crop cells, matching the original restoration's 57.15 ha exactly. Every control cell is outside the full RESTORATION_MASK, including its already-forested cells. The exact target cells and candidate cells come from the final retained recipe.

Class 81: target rainfall sum 350880.625005; control 350877.0833189998; mean absolute paired residual 0.04078369491527788 mm/year.
Class 82: target rainfall sum 592495.5624979999; control 592486.6457990009; mean absolute paired residual 0.05325792731832108 mm/year.
Maximum absolute paired rainfall residual is 0.625 mm/year.

## Maintained driver composition

The original A73C/ECO-DELIVERY13 driver owner retains source_tools/simulated_headwaters.py. Compose this additive source into that SAME driver before its initial input receipt is frozen:

1. Read matched-control.json, verify source_recipe_sha256 equals the actual original recipe file SHA256, verify grid and demo_id, and validate binary mask/count/class-disjointness against original recipe arrays.
2. Add MATCHED_CONTROL_MASK: mask to the arrays written by write_inputs, units mask, categorical nearest/int16. Keep the original input-recipe.json unmodified. Add matched-control.json and generate-matched-control.mjs as document companions in the SAME sources.json. Include the control document SHA256 in input-receiving.json and the resume check so a different control never silently reuses that receipt.
3. Use ordinary source helper to give this raster SIM_MATCHED_CONTROL_MASK. Save the second land-cover alternative with the control scenario's exact title/from_codes/to_code/reason and mask_source_id. Use the SAME collection/grid/profile and original baseline.
4. Replace two-case local enumeration with baseline plus both saved alternatives. Preserve each exact alternative ID in alternative_scenario_ids and alternative_run_ids; give each footprint/native phase and file a distinct scenario-derived name. Actual final footprint counts for BOTH alternatives must be 635 cells/57.15ha for this recipe.
5. The original comparison, native_process_report, delivery scenario_run_ids, archive required run members and rehearsal selection must include both alternatives in the same order. Keep source/loading/retention figures under the existing owner's interpretation. No additional baseline or independent Workspace is needed.

The merged PR3498 / 694c60e0e78342933fbebe4812d1332780f13add scenario_summary.py already retains final net native changed area and explicitly labeled reporting-area avoided export per net changed model hectare in JSON/CSV/Markdown. Use actual run ownership and shared valid support, not this planning mask as an executed result.

## Reproduce the exact selection

Import buildMatchedControl from generate-matched-control.mjs, pass the parsed exact input-recipe.json and that file's SHA256, and JSON-serialize the returned object. It uses deterministic within-class minimum-total-absolute-precipitation matching. Rainfall/index ordering plus earlier-subset tie handling makes the result reproducible. The actual final recipe was executed in V8; all 635 cells are unique, class-matched and disjoint from the corridor. Three small exhaustive subset cases confirmed the dynamic-programming objective and deterministic ties.

The selection deliberately preserves other physical differences in slope, routing, soil/erosivity and patch arrangement. Class area and precipitation are controlled or measured; the later native response is the full siting effect. Inspect the same final native stream mask alongside the corrected corridor. All inputs remain explicitly simulated.

Operation UPSTATE-DEMO-SIMULATED-INPUTS-20261013T140000Z. Original source/run owners retain the actual native execution and 14:00UTC cutoff.
