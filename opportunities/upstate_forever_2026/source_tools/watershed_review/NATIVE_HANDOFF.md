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


## Continue an interrupted native intake

The same command and output directory now resume one frozen original selection. Before importing a source or creating a plan, the receiver retains the complete delivery member inventory, project/workspace/output identity, original saved-review bytes, title and planning date in `intake-selection.json`. A changed input uses another output directory.

A stopped source import reuses the original collection. A stopped plan creation or original-review attachment reconciles the plan keyed to the same saved JSON. The receiver uses the native attachment API and verifies its original bytes; a later deliberately removed visible attachment link is preserved when its original committed history already retains the file. It never replaces the current plan with the incoming saved review. Unrelated plans may advance normally while this additive intake runs.

Before rendering, `report-selection.json` freezes the actual plan revision, original document digest, planning date and installed native renderer sources. If the native report published its final manifest before interruption, the receiver verifies and retains that exact report instead of rendering again. An incomplete report is moved with its complete member inventory to an owned `incomplete-report-*` directory; the same frozen revision can then finish. If the renderer changed while that original report was incomplete, continue with its retained application edition. A completed report remains reusable after a source upgrade.

The report and exported plan describe that frozen revision. Later native notes/tasks remain in the current plan and its saved history. Use another output directory to request a separately retained report of those later edits. Repeating a completed output returns the original receiving result and report identity. Original v1 output/report editions are accepted through their native manifest and saved revision checks.

At the original producer's existing browser boundary, personally open and use the populated review desk at desktop and narrow width, save/reopen the selected review JSON, receive that same selection, edit the resulting native task, reopen the original report and download the full editable project. Inspect every outgoing attachment and its important controls, including the restored recipient view. This is the existing product course under `CURRENT_OWNER_DIRECTION.md` v2026-10-13.3, with the 14:00 UTC handover deadline.

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

For an interrupted intake, continue the same exact command and output directory
under the frozen original selection described above. A completed original report
is verified and reused; a new output directory explicitly selects a separate
report edition from later native edits. The original committed attachment history
is authoritative, so deliberately removed visible links are not added back.

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

## Reopen while a saved file is loading

The desk preserves decisions typed while a selected project file is still being read. A newer selected file takes precedence over an older pending read; a cancelled selection invalidates the earlier reader. The complete original file/source validation remains in `restoreProject`. This is an actual control continuation, with the scientific preference calculations unchanged.

A rebuilt desk may contain corrected controls while retaining exactly the same original scientific dataset. Receiving the same saved review through that desk keeps the native plan's original source collection and verifies the complete original `data/dataset.json` bytes before reusing it. A changed scientific dataset remains a separate source selection. The result separately identifies the current incoming desk collection and the plan's original source collection.
