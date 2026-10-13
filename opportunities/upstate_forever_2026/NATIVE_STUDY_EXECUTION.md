# Native study execution context and independent receiving

The original native-study delivery retains the complete NDR and SDR study on its actual projected grid. Its five map families, nitrogen/phosphorus/sediment units, source editions, original scenario IDs, reporting support and official InVEST source checks stay unchanged.

## Current publication

`model/native_study.py` publishes `native-study-release/3` within the existing `commons.native-study-context/v1` and `commons.native-study-delivery/v1` schemas. The selected edition participates in the existing delivery selection before its digest is computed. A new release therefore retains its own delivery identity; earlier delivery directories and context bytes remain intact.

The producer calls the maintained `native_versions.comparison_versions([baseline, *alternatives], ("ndr", "sdr"))`. It preserves the shared resolver and the entire selected cohort rather than deriving a second version policy. Both original native models are required by the existing full-report builder.

The retained study context adds:

| Field | Meaning |
|---|---|
| `execution.policy` | The maintained completed-stage / observed-run / labeled requested-legacy policy. |
| `execution.models` | The full original ordered NDR and SDR scope. |
| `execution.versions` | Each producing model's common resolved version across the selected baseline and alternatives. |
| `runs[].model_versions` | The shared resolver's exact per-model records, including requested and observed versions, basis, stage completion and reuse. |
| `runs[].stage_execution_sources` | Original per-model `completed_at`, `runtime` and `reused_from` fields retained so a recipient can verify the declared basis independently. |

Existing `runs[].selection`, `runtime`, `stage_runtimes`, `artifacts` and `scenario` stay present. Their IDs and source dictionaries retain their original meaning. Each retained official runtime now follows the shared resolver's completed-stage priority. An uncompleted stage's runtime dictionary is preserved as source metadata but cannot override the chosen observed-run fallback.

The raw runtime still has to retain the original InVEST 3.20.0 source declaration and the producing model's official module Git blob. A requested legacy version alone does not replace those existing native-study source requirements. Original annual rates are still converted once into the retained mass-per-pixel outputs using actual cell area.

## Standalone package inspection

The existing application-root `native_study_audit.py` remains the independent receiving entry point. It reads the delivered manifest and `native-study/study.json`, checks their exact agreement and the retained artifact hashes, then checks execution metadata against the immutable stage and run sources inside that same context. It does not import the application model package or query mutable source Workspaces.

For edition 3, the auditor requires the declared execution cohort, both per-model records and their original stage evidence. It checks their version, requested declaration, observed runtime, completion, reuse and fallback basis, as well as exact agreement with the manifest's existing `native_version_provenance`. It then retains all existing original-source/module, raster-unit, affine-grid, annual-mass, support, map and report checks.

Earlier editions 1 and 2 without the additive execution fields retain their original raw-runtime validation, including the legacy flat runtime representation. If additive metadata is present in an earlier context, it is checked for consistency as well. No original archived study needs to be rewritten.

Run the maintained inspection against the actual generated native-study delivery manifest:

```sh
python native_study_audit.py /absolute/path/to/native-study-delivery/delivery.json
```

Use the original environment containing Rasterio, NumPy and PyProj. The existing `--max-manifest-bytes` option still applies to the manifest and context. The resulting audit summary includes the retained execution cohort for the new edition.

## Reopening the same scientific study

Continue with the original Workspace, baseline run ID and scenario run IDs. Rebuild the same explicit native-study selection with the installed current producer to create its new edition; existing native runs remain reusable. The ordinary delivery then writes the original context and report/archive. Open its manifest with the standalone auditor above, and compare each context run's shared `model_versions` to the manifest provenance. The raw official `stage_runtimes` and `stage_execution_sources` explain the selected sources.

This source continuation is based on the original stage-runtime producer and auditor merged in PR #3182. The separate client-report, hashed native-execution companion and shared-helper presentation extensions retain their original owners.
