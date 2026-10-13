# Transfer a saved scientific-report edition

A saved scientific report is a completed original edition, identified by the
SHA-256 of its retained render identity. Transferring it keeps the reading order,
source editions, figures and output bytes, together with the available original
studies that produced its scientific sections.

## Use the original operator

1. Open the intended Workspace, then **Sources → Saved scientific reports**.
2. Open a completed report and choose **Transfer this report and its studies**.
3. In **Study transfer**, review the selected report and choose **Preview contents**.
   The preview shows the report's original ordered sources and the actual
   dependency records. Shared source collections are retained once.
4. Choose **Export editable study**. The existing operator queue writes the
   original portable archive. Download it or continue through **Transfer archive**.
5. Receive the archive with the original restore workflow. Open **Sources** in
   the restored Workspace and reopen the same saved report. Its full edition ID,
   reading order, PDF/HTML/data and original checksums remain unchanged.
6. Use the original Diagnostic, Monitoring and calibration desks for retained
   editable records. **Use these studies in another report** prepares a separate
   report edition; reopening a received edition does not render again.

The report-file ZIP is a document handoff. Editable Study transfer also retains
the selected report's full source collections and typed local study history.
Complete Workspace backup remains available for an entire project.

## Original typed contracts

The new root is:

~~~json
{
  "schema": "upstate.study-selection/v1",
  "title": "Retained scientific report and studies",
  "roots": [
    {
      "kind": "scientific-report-editions",
      "id": "<original full 64-character edition ID>"
    }
  ],
  "include_related_results": true
}
~~~

The maintained `model.study_transfer` normalizer, preview, export, receiving
verification and original portable writer remain the authorities. No additional
archive format, task queue, native model run or report calculation is introduced.

`model.scientific_report_study_transfer` reads:

- `scientific-report-editions/<id>/edition.json`;
- the exact `selection.json` and completed `operation.json`;
- every original output in the edition's declared file descriptors;
- an existing validated `report-files.json` and its report ZIP, when present;
- each source collection in the report's original ordered source choices.

The helper checks the original project ID, render identity digest, completed
operation, source order and counts, exact source body/member bindings and all
file descriptors. Source metadata is read directly from immutable collection
records and CAS objects. It does not create source-view hardlinks during
preview or receiving. Original source objects are still verified by the normal
portable capture and restore. The original report identity's Workspace path and
the completed operation's output path are preserved as historical provenance.

The capture receipt records original edition and operation hashes, source order,
source binding and exact output members. A later report ZIP may be prepared
without changing the previously received report identity. A ZIP already included
in a capture must remain present with its original checksum.

## Editable scientific lineage

Only maintained explicit producer contracts create dependencies:

| Original source | Same-project history retained |
| --- | --- |
| Scientific interpretation | Saved diagnostic identity, exact historical report capture, complete original run cohort and native dependencies |
| Monitoring design and field history | Original report producer, design, source network, reported revision, complete editable campaign history and its replay identities |
| Calibration review | Calibration plan and result, selected original native run/profile, uncertainty and map/review records, original source-report record and completed export folders |
| Receiving-water scientific study | Original source plan, selected completed analysis, exact local source collections and original completed report capture; the maintained native visitor follows the declared run/grid cohort |

The ordered report's chosen sources are the starting point. A missing declared
local producer is a preview error; the transfer does not substitute another
edition or omit that history. Foreign-project report sources keep their original
contained files and provenance without inventing a local editable study.
Sources with other producer schemas retain their complete source collections
and report files; arbitrary prose, hashes and metadata do not become record
references.

Existing archives keep their original dependency semantics. Calibration, Monitoring and
receiving-water reverse-source links are invoked only for the new saved-edition root.
Existing generic diagnostic report lineage remains unchanged.

## Original locks and receiving

The original exclusive Workspace guard and native batch guard protect capture.
The report's `.observed-report.lock` and applicable original study owner locks
protect selected outputs. The transfer stages original files and uses the
maintained portable writer, source-hash checks and original receiving hook.

Receiving reconstructs the declared root and source closure, verifies its
captured identities and member descriptors, and retains all original record IDs.
Completed reports are read without changing their selection, render identity or
SQLite state. Later editable campaign or decision activity remains governed by
the existing study-specific receiving contracts.

## Source composition

The owned fragment
`integration/component_fragments/scientific-report-study-transfer.json`
extends the maintained component catalogue. It preserves concurrent catalogue
editions. The existing Decision workbench installer admits the complete optional
shared files and rejects a mixed source set that lacks the matching calibration
or Monitoring lineage helpers. Its hash/preimage replacement guards are unchanged.

The maintained source packet contains complete files, not patches or a second
operator. The app join adds one existing extension-host capability:
`openStudy(selection)` delegates to the registered
`study-transfer.openForStudies(selection)`, including the original Workspace key.

## Native receiving continuation

Continue the existing ASTRA13 ordered-report operation with its real retained
Workspace. The receiving record must name an actual completed operator
`scientific-report-editions/<id>/edition.json`; a standalone CLI
`observed-reports` capture is a different record and must not be relabeled.
Use the original Study transfer CLI or operator queue to preview/export the
exact root above, restore into an independent destination, and verify the same
edition ID, ordered source bindings, output checksums and available original
study histories. Open the restored report in the existing Sources desk. This
continuation does not require rerunning native models.
