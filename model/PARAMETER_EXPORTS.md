# Portable parameter-study exports

Parameter studies retain their native run IDs, original parameters, quantitative results, paired-cell support, native versions and requested maps. Export edition `parameter-study-exports/3` adds a complete file manifest so a broad suite can avoid carrying both a study ZIP and the same large GIS bodies outside that ZIP.

## Complete study contents

Each standalone study still publishes `experiment-results.zip` in its original workspace directory. The new `export-manifest.json` is included in that ZIP and retained in the study's artifact record. It binds the workspace, study, immutable selection digest and export edition, and lists every other member with its relative path, byte length and SHA256.

The manifest includes the original report, CSV, results, profiles and native version tables; selected difference maps and their comparison/grid records; exact native and requested arguments; paired aggregation context and results; and any retained aggregation ancestry. A suite therefore has a complete description of the scientific contents previously accessible only inside the standalone ZIP.

Completed studies upgrade their exports from the same retained runs. The independent `parameter-study-summary/2` behavior remains in place, including the distinction between unchanged-support ranges and support-changing cases.

## Adaptive suite layout

The Gura suite compares two complete layouts for each study using unique descriptor paths:

- **Nested:** retain the visible study artifacts and their complete standalone ZIP.
- **Flat:** retain every complete manifest member, plus the manifest, directly at its original study-relative path; omit the nested ZIP from the suite.

The flat layout is selected only when its logical file lengths are no larger than the nested layout. Otherwise the nested layout remains. This matters for compact studies without difference maps: compressed argument and aggregation records may cost less inside their ZIP than as many direct JSON files.

Both layouts reopen offline. Study report paths and relative map links remain unchanged. The suite index links the report, CSV and complete file manifest; nested studies also expose their study archive. The original standalone study archive remains in the workspace for independent sharing.

The suite manifest retains `commons.gura-parameter-suite-package/v1` and its existing `files` mapping. New `study_layouts` metadata identifies each chosen layout. Consumers should follow declared files and available artifact keys; a flat study has no `archive` artifact in the suite. Every scientific member is instead present in the suite's ordinary files mapping.

## What the space counters mean

Each study records `nested_logical_bytes`, `flat_logical_bytes`, `selected_logical_bytes` and `logical_bytes_avoided`. The latter is the nested file-length total minus the selected file-length total. It is zero when the nested layout is smaller or a legacy study has no complete member manifest.

These counters measure exact retained file lengths. They do not estimate compressed outer-ZIP size, filesystem allocation, reflink savings or free disk space. The suite index and results JSON expose the totals alongside the chosen layouts.

The publisher copies each selected body independently using the existing verified reflink/stream-copy implementation. It reuses unchanged local copies by their recorded identity. After the replacement index, manifest and requested archive have been published, it removes only obsolete suite copies whose exact recorded identity, SHA256 and length still match. It never removes the original workspace study files. If publication stops early, previous copies remain available.

Outer ZIP creation continues to stream and verify all selected files, including large GeoTIFFs, with bounded buffers and ZIP64. External `--archive` delivery now uses the same verified copy mechanism and records the actual transfer method.

## Resume the original operation

Use [GURA_COMPLETE_OPERATION.md](../source_tools/GURA_COMPLETE_OPERATION.md) for the full original native, planning, report and study journey. The maintained entrypoint is:

```sh
/path/to/equipped/python -B source_tools/receive_gura_operation.py \
  --application /path/to/application \
  --operation /path/to/existing-gura-operation
```

The operation resumes its retained workspace and inputs and executes each unfinished native case in an isolated process. Completed native cases and shared stage-cache entries keep their original identity.

For a direct broad-study continuation, preserve the exact previous scope, baseline, planning and map options:

```sh
/path/to/equipped/python -B source_tools/receive_gura_studies.py \
  --application /path/to/application \
  --workspace /path/to/existing-workspace \
  --inputs /path/to/original-gura-inputs \
  --include-planning-evaluation \
  --isolate-native-cases \
  --archive /path/outside/workspace/gura-parameter-suite.zip
```

An existing suite selected without `--include-planning-evaluation` or with `--difference-maps` must retain those original choices. Packaging follows those saved selections. The suite report and its results describe every completed case even while unfinished cases remain resumable.
