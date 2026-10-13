# Community plan revision comparisons

The Communities desk compares an earlier saved intervention plan with a later revision in the same original table lineage. The native queue retains a complete handover with the selected plans, their original Community source, received intervention CSVs, regional context and selected complete reports.

## Operator workflow

1. Open **Communities → Intervention plans**. Select **Compare revisions** beside a revised plan, or open that plan and use the same control.
2. Choose the later revision and an earlier ancestor. Each option shows its saved revision number and original identity.
3. Choose the complete saved reports to include. This list is frozen in the submitted request, so later report creation does not alter an interrupted or repeated operation.
4. Select **Review original changes**. Review additions, removals, field changes, original row ordering, ownership, next steps and estimates. The same view shows original community selections and saved scientific context.
5. Select **Save complete revision handover**. The host submits `community.plan.compare` with its original operation ID. Reopen the result from the completed task or **Saved revision handovers** in the existing Plans tab.
6. Download the complete ZIP, printable HTML, editable Markdown or the separate CSV/JSON files. Open `START.html` after unpacking the ZIP. Links resolve within the portable directory.

The existing saved Community view still records the selected table, plan and report, filters, compared GEOIDs and operating notes. Comparison controls use that same controller and the original Workspace queue.

## Meaning of a comparison

Only original linked plan revisions on the same source table can be selected. The comparison walks every retained `previous_plan_id`, checks revision numbering and preserves the complete ordered lineage. Separate branches and reversed or unrelated plan pairs are rejected.

Interventions are matched by their original IDs. Added and removed entries retain full original rows. Shared entries show every changed field, including missing-versus-null values, owner, next step, status, reason, notes, memberships and original estimate. Original array positions, full before/after ordering and changed relative order of shared entries remain available in the complete comparison.

Title, purpose and plan notes have their own change table. Selected whole block-group membership and original utility/watershed filters are compared directly. Source metadata and scientific selections retain their exact saved values. Changed native snapshot families include the original before/after snapshot hashes and complete saved snapshots in JSON.

Community quantities describe the selected whole original block groups. Native model selections and outputs keep their original spatial support. A change in retained model context is identified as a context change; the comparison does not allocate whole-run model differences to selected communities or interventions.

## Planning estimates

The original native Community plan uses decimal USD estimates. The comparison retains two-place values and calculates the known-estimate subtotal with decimal arithmetic.

A complete total change is available only when every intervention in both plans has a known estimate. If either plan contains an unestimated intervention, the complete total delta is null and displayed as **Unknown**. The partial known-subtotal change remains visible with the IDs whose estimates are missing. A shared intervention's estimate delta is calculated only when both original values are known. Zero is retained as a valid supplied estimate.

## Retained handover

The comparison family is `community-plan-comparisons`; native item and inventory key is `community_plan_comparisons`. Each result retains:

- `comparison.json`: complete reconstruction, plan lineage, original before/after values, source and geography, native context snapshots, ordering and missing-aware estimates.
- `intervention-changes.csv`: one row per changed field with explicit before/after presence flags.
- `interventions.csv`: all original intervention identities in earlier order, followed by new entries in later order; positions and complete original rows are retained.
- `plan-changes.csv`, `selection-changes.csv` and `scientific-selection-changes.csv`.
- `START.html` and `comparison.md`: readable and editable handover.
- `plans/<original-id>.json`: the exact native saved record for every edition in the selected lineage.
- `tables/<original-id>.json` and `source/`: the exact saved Community table and its original primary file and declared companions.
- `received-csv/<plan-id>/<original-filename>`: the exact received intervention CSV text, including original escaped cells, for every applicable lineage edition.
- `regional/`: original retained watershed context reports referenced by those plans.
- `reports/<original-id>/`: the explicitly selected saved report records and every original report member.
- `COMPARISON.json`: exact file identities and frozen report selection.
- `community-revision-comparison.zip`: the complete portable handover.

CSV export safely escapes spreadsheet expressions; complete JSON and received CSV originals preserve the original values and bytes.

## Receiving and reopening

Normal Workspace backup and restore carries the comparison registry and complete files. The registered provider verifies each restored comparison against its actual original plans, source and context. Reopening a saved comparison reconstructs its data from those plans and verifies every retained output before returning native file tickets.

An independent handover can also be checked with the maintained application:

```python
from pathlib import Path
from model.community_revisions import inspect_archive

received = inspect_archive(Path("/absolute/path/community-revision-comparison.zip"))
print(received["identity"])
```

This reads the ZIP without extracting it. It checks exact membership and file hashes, verifies the content-addressed original plan and table records, reconstructs the comparison, and checks original Community source, received CSV, regional and attached-report bindings. `identity: MATCH` means the comparison and enclosed records agree with the complete handover inventory.

## Application integration

The complete feature contains `model/community_revisions.py`, `operator/community_revisions.py`, `operator/extensions/community-revisions.json`, `operator/web/community_revisions.mjs` and the additive current `operator/web/community.mjs` join. The descriptor requires the original plan-save and report-build actions, registers one queued action plus GET reads, and exposes the existing native item/task/file interfaces.

The application uses its existing extension registry, task coalescing/recovery, operator workspace binding and file ticket verification. There is one existing Community controller. The scientific report preparation controls and saved-view callbacks are preserved.
