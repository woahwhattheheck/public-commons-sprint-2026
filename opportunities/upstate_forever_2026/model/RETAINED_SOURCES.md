# Retained scientific sources

The existing source importer now reuses a verified content-addressed object before it creates an intake copy. Re-importing the same NLCD, DEM, precipitation or table source therefore needs no second full-size staging file. The original source edition, source ID, filename, byte count and SHA-256 remain unchanged.

## Install in the current application

A current checkout includes the complete changes in `model/common.py` and `model/workspace.py`. These are the same original model and Workspace modules. The cumulative Workspace keeps the current selected-model, combined-run and Communities operations.

For an already installed application, use its maintained selected-model source receiver and the accompanying complete two-file source packet:

```bash
python3 -B /ABS/current-application/model/receive_selected_model_source.py \
  --application /ABS/current-application \
  --packet /ABS/current-checkout/source_tools/retained_source_reuse/source.json
```

The receiver is the existing `ca8fc22691cfe50e579b6e857e081b358ba46e88` implementation. It checks every complete body, parses the resulting Python and compares the current bytes again before each atomic file publication. Repeating the command preserves an already current result.

The packet starts from the complete 70CB source edition `f784b703c04b282680714b48e4f54761be0c1148`. It supplies exact context joins for the two imports and the two original methods. A later Workspace containing combined-run, Communities or other unrelated functions keeps those functions when these joins are applied. The current public source was composed against `0cfae283fdbf17e6301b74b6669d625c423fcf7c`, whose Workspace is `ef74fc94b9f28654b9a5f591bcb32929c7bbb4aa`.

Reopen the same application process after installing source so later requests load the new modules. Retain the existing workspace directory, source collection IDs, prepared grids, profiles and native run selections.

## Intake and reuse

`Workspace.import_sources` continues to read the original local `upstate.sources/v1` manifest and every selected primary file and companion. For each file, the importer:

1. Opens the original regular file and streams its SHA-256 with a one MiB buffer, checking its inode, size and timestamps before and after the read.
2. Opens the expected stored object without following a symbolic link and verifies its complete content and stable identity.
3. Reuses a matching stored object immediately, completing file and directory durability without creating an intake temporary or a new lock file.
4. For a missing or damaged object, takes the existing per-digest file lock, checks again and creates an independent verified temporary copy only when it is still needed.
5. Publishes the full copy atomically and removes its owned temporary name.

An external source whose supplied SHA-256 no longer matches is rejected before storage. The original source is always read; an expected hash is not permission to skip its verification.

Current importers of the same missing digest share one lock. The first completes one independent stored copy, and the following importer verifies and reuses it. An older process that was already running may still perform its original copy; the new writer verifies its complete publication before reuse. Original inputs are not hard-linked into the durable object store.

## Repair a retained object and reopen its native view

If a stored regular object is damaged and the complete original input is still available, re-import the same original manifest. The importer restores the object from an independently copied, fully verified original and keeps the original source edition identity.

Native source views preserve original sidecar names and relationships. A view may still refer to the old inode after an object repair. `Workspace.source_file` now locks that source view and object, verifies the repaired object, and reconnects a missing or damaged derived view atomically. Its hard-link path and cross-filesystem copy fallback both verify the complete bytes. The candidate remains tracked through publication and cleanup, including a concurrent older writer linking the same inode to the final path.

Objects and source editions retain their original schemas. Per-digest and per-view locks are zero-byte `.lock` files in the object directory. The maintained portable exporter already excludes those locks, temporary intake names and the entire derived `source-views` tree. A full workspace archive keeps the independently stored originals and reconstructs native views when they are next opened.

## Completed native storage operation

The complete operation ran with the real original Workspace and maintained source receiver on 2026-10-13, from 01:17:56 to 01:18:08 UTC. The process exited successfully and used 20,788 KiB peak resident memory.

| Original operation | Observed result |
| --- | --- |
| Receive both source changes through the maintained receiver | Both complete postimages installed and read back exactly |
| Repeat the original 4,194,304-byte source and its companion with temporary allocation returning ENOSPC | Same saved source collection; zero staging attempts |
| Repair a damaged stored object and its original hard-linked source view | Original bytes and source edition restored; external original remains independent |
| Two simultaneous original import callers | One independent copy; identical complete receipts |
| Re-import an existing 2,147,483,648-byte sparse source/object pair with no intake temporary capacity | Original writer attempted a copy and failed; new Workspace attempted zero copies; stored inode unchanged; allocated file blocks remained zero |
| Export through the unchanged portable writer and verify the complete archive | All 21 members verified; original source edition present; no locks or derived views exported |

The two GiB case is a storage fixture with fully hashed logical bytes. It uses sparse files to exercise large-file verification without allocating a second multi-gigabyte body.

The complete native result is 4,510 bytes, SHA-256 `1b1094f2680e53ddf8e01b475bed743276257149f5ce40493b570d0991a75bcf`. Its original workspace archive is 128,240 bytes, SHA-256 `3d3b30d7220bebcd2aac6d984f5c5f97534e39af33baac273ae025f29b27d2ef`.

## Reproduce the same isolated storage journey

The adjacent operating programme and input packet contain the complete original fourteen-file source edition, both changed source bodies, the original package initializer and the current original portable exporter. They use Python's standard library and do not load Rasterio or InVEST.

```bash
python3 -B source_tools/retained_source_reuse/run_storage_operation.py \
  source_tools/retained_source_reuse/storage_operation.json
```

The programme creates a new owned operation directory on an available normal volume, falling back to an owned `/dev` directory when needed. It preserves the original source collection through reuse, corruption recovery, concurrent import and portable export. It writes `Upper_Savannah_Source_Storage_Result.json` and the complete `Upper_Savannah_Source_Storage_Workspace.zip`. All steps in this command use that new isolated workspace.

The installed product uses its ordinary `Workspace.import_sources` and `Workspace.source_file` APIs. Source acquisition, parameter selection and original InVEST execution remain with the current scientific operations.
