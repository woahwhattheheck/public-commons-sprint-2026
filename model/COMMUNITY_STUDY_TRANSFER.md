# Transfer an editable Community planning study

A selected Community study keeps the original source table, saved plan revisions,
intervention history, scientific context and complete reports together. It uses
the existing Study transfer queue and ordinary Workspace archive/restore format.

## Choose the saved study

From Communities, open the saved plan or report and select **Transfer editable
study**. The existing Study transfer desk opens with that exact saved ID. Review
the dependency preview, choose the original archive options, and export through
the existing queue. Browser drafts are saved by the original Community editor
before they can be selected as a retained study.

The Study transfer catalog also lists:

- **Community source tables**: an original imported demographic table and its
  complete source collection. With related results enabled, saved plans using
  this explicitly selected table and their reports are included.
- **Editable Community plans**: the chosen immutable plan, every earlier linked
  revision, original intervention CSV bytes and the actual table. Related reports
  come from these selected plan revisions.
- **Saved Community reports**: the original saved report plus its editable plan,
  earlier revisions, table and complete report members.

Selecting a plan does not select later descendants automatically. Choose a later
saved plan when its subsequent work should be included. The original
previous_plan_id links and revision numbers remain intact.

## Original records retained

Community tables preserve source line positions, GEOIDs, utility/HUC memberships,
original source rows, metadata and the exact source collection/body. This retains
the distinction between whole-block-group population/household counts and a
utility's separately documented service population.

Plans retain their actual intervention IDs, row order, owners, next steps,
status, strategy, geographic selections and explicitly entered cost estimates.
Unknown costs remain unknown. A received intervention CSV retains its complete
original UTF-8 text, filename, byte count, SHA256, parsing summary and original
comparison plan. Earlier plan revisions are included rather than reconstructed
from the current editor.

Each plan's original scientific snapshot stays unchanged. The transfer follows
its selected source collections, prepared grid, native runs, comparisons and
saved delivery through the existing typed dependency closure. Native outputs
retain their original IDs, producing-stage provenance, units and spatial support.
The Community selection does not allocate native raster totals to demographic
groups or intervention rows.

A saved regional watershed context retains the exact original report and the
complete operator report directory, including original source bodies, native
companions, edition manifests and provenance. The plan's selected report bytes and
calculation-input fingerprint remain pinned. Added supporting-source editions
can coexist with the selected original edition. Received source provenance is
kept as provenance; it is not treated as a newly created local source collection.

Complete report files include the original report JSON, HTML, Markdown, CSVs,
original source table and the original ZIP. Newer report formats can also carry
their saved parent-plan comparison, exact before/after CSV and previous-plan
record; all declared members are retained. Selecting a report does not render it
again.

## Ordered scientific report lineage

When a saved scientific report edition explicitly includes a
community-planning-report-context source from this same project, transfer follows
that original source into its saved Community report and editable plan history.
It verifies the source's original recipe, project URI, plan/report IDs, report
SHA256, every retained report companion and saved-report record.

A report imported from another original project keeps its complete contained
source bodies and declared provenance. Its donor IDs are not interpreted as
local editable records.

The lineage join is scoped to explicitly selected saved scientific report
editions. It does not reinterpret all source collections or change the closure of
earlier archives that did not select this new family.

## Original command-line workflow

Run these commands from the current maintained application using its equipped
Python interpreter and the actual existing Workspace:

~~~sh
PYTHON -B -m model.study_transfer_cli catalog \
  --workspace ACTUAL_WORKSPACE --kind community-plans
~~~

Save a selection using the actual returned plan ID:

~~~json
{
  "title": "Selected Community planning study",
  "roots": [
    {"kind": "community-plans", "id": "ACTUAL_SAVED_PLAN_ID"}
  ],
  "include_related_results": true
}
~~~

Use the existing preview and export commands:

~~~sh
PYTHON -B -m model.study_transfer_cli preview \
  --workspace ACTUAL_WORKSPACE --selection community-study-selection.json

PYTHON -B -m model.study_transfer_cli export \
  --workspace ACTUAL_WORKSPACE --selection community-study-selection.json \
  --destination OUTSIDE_WORKSPACE/community-study.zip

PYTHON -B -m model.study_transfer_cli inspect \
  --archive OUTSIDE_WORKSPACE/community-study.zip
~~~

Restore through the ordinary original Workspace receiving path or the existing
Project transfer desk. The receiving verifier resolves the original selected
Community records and their dependencies. In the restored operator, open the
same saved Community plan/report ID, inspect its earlier revisions and original
CSV, then use **Revise plan** to continue. The recipient's new plan points to the
retained predecessor and preserves its original source table. The sender's
saved plan remains unchanged.

## Native receiving in the current Community course

Use the existing accepted Community project and its saved plan revisions,
reports and intervention CSV. Export one original saved report or latest plan,
restore it independently, and reopen the same IDs. Verify that its earlier
revision, original table/source, report downloads and scientific context are
available. Save one actual recipient revision through the ordinary Community
editor, then inspect the original sender again.

Where that same course already produced a saved ordered scientific report
edition containing the Community source, select that edition through the existing
saved-report transfer entry. This exercises the same original Community lineage
without a second render or model job.

The complete helper is model/community_study_transfer.py. Shared integration
adds its three root kinds, immutable-record dispatch, related-result discovery,
original report lock paths and catalog rows to model/study_transfer.py. Its
include_source(closure, collection_id, entry) is called only by the maintained
scientific_report_study_transfer source dispatcher. Community's existing browser
delegates to the original Study transfer desk through openStudyTransfer.

## Saved chosen-pair revision handovers

The current original Community comparison component is included. A saved `community-plan-comparisons` record is a selectable study root and its detail view offers **Transfer editable study**. The archive keeps both chosen plan editions, every intervening original revision, original table/source files, attached reports, the owner's comparison result, HTML/CSV/JSON members and complete comparison ZIP. The original `community_revisions.compare_saved` function verifies the retained comparison; transfer does not create a replacement calculation. Related capture includes a saved comparison when both chosen plans already belong to the selected history, so a selected earlier plan does not pull an unspecified later descendant into its study.

The restored Community desk keeps the original comparison identities and can reopen the handover, inspect either original plan, and continue with a new plan revision through the existing editor. The original comparison directory lock is retained during capture. Current owner revision-navigation callbacks remain intact.
