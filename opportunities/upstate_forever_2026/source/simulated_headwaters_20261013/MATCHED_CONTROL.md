# Matched-area off-riparian control — same simulated headwaters operation

Source: A73C's final seven-file case, merged PR3496 / 32a8937b61b0023ad969f89a901287da6ab7b1ae. Original recipe SHA256 3f8842c985a4d9186d43eafea07023ad326de1a46780f3fc93b0c4e04874d0fb. The revised terrain, original land cover, precipitation, R/K and full corridor remain unchanged.

## Ready-to-use input

matched-control.json contains the COMPLETE 14,400-cell row-major binary mask, exact changed cell indices, all 635 target/control row/column pairs and per-class rainfall residuals. This reproduction packet labels its mask MATCHED_CONTROL_MASK; the canonical native companion below labels the identical raster CONTROL_MASK and uses source ID SIM_MATCHED_CONTROL_MASK. Convert original classes 81 and 82 to 41 through the ordinary saved scenario patch.

It selects 236 pasture cells and 399 crop cells, matching the original restoration's 57.15 ha exactly. Every control cell is outside the full RESTORATION_MASK, including its already-forested cells. The exact target cells and candidate cells come from the final retained recipe.

Class 81: target rainfall sum 350880.625005; control 350877.0833189998; mean absolute paired residual 0.04078369491527788 mm/year.
Class 82: target rainfall sum 592495.5624979999; control 592486.6457990009; mean absolute paired residual 0.05325792731832108 mm/year.
Maximum absolute paired rainfall residual is 0.625 mm/year.

## Canonical native companion

A73C's complete three-file companion F0C8QFQF2DC supplies generate-control.mjs, control-input.json and source_tools/simulated_headwaters_control.py. All three original source hashes were independently verified. Its integer-micro-mm matching and this independently retained generator select EXACTLY the same 14,400 mask values; no cell differs. Use that existing native companion to preserve the already-prepared original source collection, grid, profile and baseline.

Canonical control-input.json: 252,261 bytes, SHA256 6345f7540fd4fbc622b377040170df8be4d1c9e1f70015940a1923ee2d6a4c8c. Original companion receiver: 9,226 bytes, SHA256 d84911c039477c1518bca06ab16ba8b9059f165bc50c142177ac93a93f86a75f. Native raster role CONTROL_MASK, source ID SIM_MATCHED_CONTROL_MASK. The full source is retained at https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8QFQF2DC.

The SAME driver imports its original module and calls:

```python
from source_tools.simulated_headwaters_control import prepare
control = prepare(ws, receipt, recipe_path, control_path, control_output)
```

Here ws and receipt are the original demo Workspace and demo-receiving.json; recipe_path points to the unchanged final input-recipe.json, control_path to the canonical companion control-input.json, and control_output to a sibling output directory under the same owned operation. The companion imports its exact-hash mask/source documents as a separate collection, saves the original third scenario on the SAME grid/profile, validates the actual635-cell/57.15ha footprint and returns run_id, scenario_id, source_collection_id, footprint_id and matching_summary. The parent's existing lock/runtime/cutoff still owns any later execution.

Retain those exact IDs beside the original baseline and riparian IDs. The existing native runner, all-alternative comparison, native_process_report, delivery scenario_run_ids, parameter course and archive membership then include this one control in the same saved ordering. Each alternative has its own phase/output filename. Existing baseline/restoration IDs and completed stages stay reusable.

The broader retained matching summary also exposes R_FACTOR/K_FACTOR/elevation mean differences; the same mask's closest geometric stream-axis distance is97.867779m and mean572.804952m. These support the stated spatial-control interpretation, with actual native flow/retention/export still evaluated by the original model.

The merged PR3498 / 694c60e0e78342933fbebe4812d1332780f13add scenario_summary.py already retains final net native changed area and explicitly labeled reporting-area avoided export per net changed model hectare in JSON/CSV/Markdown. Use actual run ownership and shared valid support, not this planning mask as an executed result.

## Reproduce the exact selection

Import buildMatchedControl from generate-matched-control.mjs, pass the parsed exact input-recipe.json and that file's SHA256, and JSON-serialize the returned object. It uses deterministic within-class minimum-total-absolute-precipitation matching. Rainfall/index ordering plus earlier-subset tie handling makes the result reproducible. The actual final recipe was executed in V8; all 635 cells are unique, class-matched and disjoint from the corridor. Three small exhaustive subset cases confirmed the dynamic-programming objective and deterministic ties.

The selection deliberately preserves other physical differences in slope, routing, soil/erosivity and patch arrangement. Class area and precipitation are controlled or measured; the later native response is the full siting effect. Inspect the same final native stream mask alongside the corrected corridor. All inputs remain explicitly simulated.

Operation UPSTATE-DEMO-SIMULATED-INPUTS-20261013T140000Z. Original source/run owners retain the actual native execution and 14:00UTC cutoff.
