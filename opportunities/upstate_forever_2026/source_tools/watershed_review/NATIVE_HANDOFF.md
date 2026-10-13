# Watershed review: native source and editable task handoff

This module adds the completed offline review desk to an existing scientific Workspace and converts an explicitly selected saved queue into native candidates and planned tasks. It preserves the original project and existing plans. It uses the actual `Workspace.import_sources`, `source_file`, `ImplementationStore.create`, `attach_file`, `report`, and `retain_report` APIs.

## Receive the complete desk

```sh
python source_tools/watershed_review/receive_review.py \
  --application /absolute/application \
  --workspace /absolute/workspace \
  --delivery /absolute/Upper_Savannah_Watershed_Review \
  --output /absolute/new-receiving-output
```

Add `--review-project /absolute/Upper_Savannah_Review_Project.json` to receive that saved queue as an editable native plan. An optional `--title` labels the plan and `--as-of YYYY-MM-DD` selects the planning/report date. Otherwise the saved project's actual save date is used. This planning date does not book any field visit.

The plan is keyed to the exact original saved JSON. Repeating the same file intake keeps that original plan and its manual edits. Existing plan revisions are never overwritten. The exact review JSON is attached to its original plan. Candidate areas are retained classified hectares; no modeled-benefit array is populated from review scores. Original questions become planned tasks with unknown durations, zero claimed progress and no invented sampling coordinates, dates, costs or observations. The partner can edit the tasks in the existing implementation workspace.

## Completed receiving course

Original project: `dc92b8b9-6eda-4362-b12d-3cf2ef6c9007`.

Source collection: `3066545cc6da2cd39b368017c912c83e60be3491e2d9872175c2cbb3afc6a5a5`.

Source entry: `upper-savannah-watershed-review-desk-20261013`; exact HTML SHA-256 `63a7b2169ae8c7ea4acade3190f871f95f48c0e831887e8225e8742a6ba028c2`.

Retained native source members: 56.

Saved receiving-example plan: `watershed-review-8a028b1c2cc6df4788a99faf`, revision 2, one original Lower Tugaloo review candidate and planned task. This is labeled **Receiving example: Lower Tugaloo desktop review**.

Retained report: `6e45e9e5bf90f1935d986b4893e8d569cf340cc4e9f914bcd491a0c457299d6c`.

The original Eighteenmile lake-sample plan remains revision 2, and the original station/collection-event plan remains revision 3.

## Open the exact desk from a restored native project

```python
from model.workspace import Workspace
w = Workspace('/absolute/restored/workspace')
path, source = w.source_file(
    '3066545cc6da2cd39b368017c912c83e60be3491e2d9872175c2cbb3afc6a5a5',
    'upper-savannah-watershed-review-desk-20261013',
)
print(path)
```

Open that returned HTML path in an ordinary browser. All relative companions are materialized in the same native source view. Saved project controls provide independent persistence when browser-local storage is unavailable. The generated plan report is retained beneath `implementation/plans/PLAN_ID/reports/REPORT_ID`, and native `model.implementation_cli` exposes show/edit/export/report operations.

Current owner direction: `opportunities/upstate_forever_2026/CURRENT_OWNER_DIRECTION.md` v2026-10-13.3. This additive internal review workflow travels with the original Ecosystem Sciences workstream.

## Native report display improvement

The same original saved task report was refreshed after fixing table widths and keyboard scrolling. Current formatter source is included in the native archive. The guarded `apply_native_report_layout.py --application ACTUAL_APPLICATION` composes only table markup and CSS with a compatible maintained formatter. Its nine non-presentation report files remain byte-identical; all original plan revisions and the earlier report edition remain retained.

## Maintained application adoption

The original eight-file source delivery is retained unchanged in
`integration/watershed-review-original-20261013.json`. The current receiving
bank, `integration/watershed-review-source-20261013.json`, carries the complete
review desk/producer/receiver source and the current maintained formatter for
inspection. The installed formatter is composed in place by its three original
layout joins, or preserved when the newer maintained responsive layout is
already present. A historical formatter never replaces newer field/laboratory
or scientific report work.

At a normal idle source-adoption boundary, using the same complete application:

```sh
python /absolute/install_watershed_review.py \
  --application /absolute/application \
  --bank /absolute/watershed-review-source-20261013.json
```

The installer verifies every carried byte/hash before adoption, permits only
absent, identical, or the declared original review-source predecessors, and
adds the review paths to the existing Implementation component. It preserves
all other components and existing source paths. It does not install the model
engine, start or restart the operator, create a Workspace, run models, or rebuild
the completed desk. Keep any running worker on its existing source until its
original phase boundary.

For the completed REVIEW13 project, use the existing archive
`Upper_Savannah_Review_Native_Project_20261013.zip`
(70,065,207 bytes; SHA-256
`b998556537f3eec273175fb7f046467d7b1f6259ddde185a45f46e7c7978834e`).
Reopen it through the maintained native restore command into a new destination,
then open its retained source view and original Implementation plan. That
completed plan is already revision 2; source adoption alone does not receive it
again or regenerate its reports.

For a genuinely interrupted queue intake, rerun the original intake with a new
output directory and the same exact saved review JSON. The existing plan and
manual edits are retained. If the first process stopped between plan creation
and attaching that JSON, the receiver completes only the missing original
attachment and records the resulting revision. Repeating a complete attachment
does not advance the plan. All other pre-existing plans retain their revisions.

## Recipient use and current owner instructions

Read the complete `OWNER_INSTRUCTIONS.md` in this directory before continuing.
It includes CURRENT_OWNER_DIRECTION.md v2026-10-13.3 and the complete standing
all-attachments inspection rule. The cutoff remains October 13 at 14:00 UTC.

The original REVIEW13 producer opened the completed desk and plan report at
desktop and 390px, operated keyboard scrolling and cold-restored the native
archive. This source integration has not itself run a new browser session.
For any changed outgoing report, the producing receiver must open and view that
exact populated HTML, its relevant printable/PDF pages and downloaded source
files, operate Save/Open/filter/queue controls, and reopen the delivered archive
and editable plan. Keep the labeled Lower Tugaloo receiving example distinct
from original observations and from modeled native pollutant results. Inspect
the actual result as its recipient; source review is not a substitute.
