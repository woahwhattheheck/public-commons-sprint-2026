# Select the completed original terrain cohort for WO22

This read-only helper belongs to the existing structural-study receiving operation. It reads the completed original terrain response and its four native runs from the original Workspace. It does not prepare a grid, create a profile/run, dispatch a task, or perform another native model solve.

## Exact originals

- Project: 1b6a344c-df5a-4986-a5e4-47a2d158324b.
- Terrain case: 658a363d919dcd72d7fd666b588a1862c472d10cbf37e86e62358d3804371a45.
- Completed response: f9985d3897c6c806abd7de9279ce4e66ad4748db61d51123dde60ac9d7fc6445.
- Reference run: 4b5ea04c911dbbf16a8f214c884a9fbf69c96cc718b2063b1ade9e221aa8e4fc.
- Three case runs: 6a8067a5d03e24338204970b1291a18acf6ee94eab99a82e03686b8b417572a9; 85ccbc533ed8d1b9896be4825e7e7870b3dee4111393fe416bddc84b61eb483e; b2366163904e5e2795a0fe12a3bbd7ee71e394a10f2315d5d9fa90e71b398f2e.

The original producer delivered this cohort at https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791913117693809 . Maintained original producer source is PR4693 / bf128ad3580a2b0b68502a868f14b2955adf828f, including source_tools/terrain_conditioning_response.py and source_tools/TERRAIN_CONDITIONING.md. The original terrain record establishes which run belongs to each 0.5/1/2 m depth. Never assign these depths from the order of the four run IDs.

## Use the current original application and Workspace

After composing the complete structural-study product and original terrain producer into the receiving owner's existing application, run its installed scientific Python:

```sh
python -B APP/source_tools/resolve_structural_terrain_selection.py --workspace ORIGINAL_WORKSPACE --output EXTERNAL_RECEIVING_DIRECTORY
```

Replace the three uppercase path placeholders with actual paths already owned by that receiver. The output directory must be outside the original application and Workspace. Preserve the same original operation, current application composition, accepted native workers and scientific data. No new listener, model coordinator or receiving job is needed.

The helper opens the original completed terrain response through its maintained inspector, verifies its full output descriptors, obtains the exact original run/grid/profile/scenario/source records through Workspace, and passes the derived selection to StructuralStudies.preview. It captures and rechecks all original metadata bodies before publication. All three cases carry explicit existing_run_id, so the native preparation either reuses those exact validated original runs or rejects the selection; it cannot silently substitute new runs.

The complete output is selection.json, original-records-and-preview.json and receipt.json. The proof includes all original records and source editions, the original terrain response, exact metadata hashes, full native preview and physical-area/source interpretation. There is no truncated catalogue or invented grid identifier.

A SOURCE_SELECTION_READY receipt (exit 0) means that this exact source selection is currently eligible. Use selection.json as the full selection input to the existing authenticated WO22 browser/native course. Its ordinary original queued preparation, structural comparison, report and complete editable receiving retain their own canonical operation IDs. The helper does not call any of them.

SOURCE_REVIEW_REQUIRED (exit 2) preserves the full selection, source evidence and actual native eligibility findings. Resolve that concrete source mismatch through its existing producer. Do not remove existing_run_id or change scientific parameters merely to force the course to proceed.

## Scientific scope

This is the original simulated 30 m teaching cohort. Its completed source-native runs are actual software outputs, not empirical validation. The earlier terrain comparison uses common valid cells across the baseline and all alternatives separately by quantity. WO22 calculates pairwise geographic valid support. Their support totals may differ by design; preserve the original response and the new structural result as separately identified generations.

The ordinary 30 m production delivery remains unchanged. The purpose is to inspect terrain-source sensitivity, including unchanged source/profile/scenario/native-version bindings and each case's exact physical stream-initiation area. Neither stream thresholds nor model outputs are recomputed by this helper.

## Receiving and continuation

The helper's outputs are immutable through the maintained atomic writer. Repeating against the same originals reuses exact output bytes. If a selected metadata/source identity changed, the first handoff is preserved and a concrete mismatch is returned. No current timestamps or unrelated latest-run selections are inserted into the original receipt.

The existing equipped owner must still run the complete structural comparison/report course, open and inspect all outgoing HTML/PDF/GIS/table/archive artifacts and cold-received editable application, and return the actual results. This source helper has not been executed on that Workspace in this authoring lane.
