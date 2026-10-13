# Gura receiving and saved report recovery

The maintained workflow reopens the same scientific Workspace, original programme,
source collection, grid, profiles and comparison plan after the Workspace moves.
Its command remains:

```sh
python -B -m source_tools.gura_workflow run \
  --workspace /actual/restored-workspace \
  --source-directory /actual/receiving-directory \
  --backup /actual/archives/gura-complete.zip \
  --serve
```

Use the receiver's existing compatible interpreter and actual paths. The backup
path is outside the Workspace. Keep the original physical-only selection, where
applicable, by passing `--physical-only`. Existing conversion and watershed-field
choices come from the retained workflow capsule. An explicit conflicting choice
is rejected before continuing that cohort.

## Exact receiving records

Current Workspace capsules retain the original `receiving.json` bytes. Saved plans
bind both its byte count and SHA256. A receiving directory can change without
changing the record's scientific contents or its original path fields; the
workflow supplies the actual receiving Workspace separately.

Older capsules may contain the same JSON values formatted with indentation.
Recovery first looks for the exact record in the capsule, current intake,
retained location snapshots and existing comparison directories. If necessary,
it reproduces the original standard compact JSON plus newline and accepts that
candidate only when both its byte count and hash match the saved plan. The
recovered bytes are retained at
`gura-workflow/receiving-records/<original-sha256>.json` within the restored Workspace. The older source remains available. Plan and programme IDs
stay unchanged.

## Source headers and model selections

Reopening resolves land cover through the Workspace's original source collection.
It compares the real raster's projected metre coordinate system, north-up cells,
dimensions and affine transform with the source metadata retained by the grid and
receiving record. The saved model-grid resolution, cell area and upstream buffer
remain separate selections. A retained prepared edition keeps its own resolution
and context; reopening does not resample its inputs or select a new grid.

## Completed reports

A completed report verifies its original native run cohort, report artifacts,
zone-specific economic editions and archive descriptors before it is reused.
After a Workspace moves, the current result records the actual receiving report
and economic paths, while keeping the original result as a retained source.
This location update is saved even when the comparison command does not request
another Workspace backup. The original completion identity is preserved.

Continue the existing native child if it is active. The workflow's programme
observation and resume logic remains responsible for the original operation.
