# Saved source review decisions

The **Source review decisions** desk opens complete, retained original-source vector comparisons. It displays each feature's original and returned attributes, native-coordinate outlines, missing or ambiguous identity findings, and layer schema/CRS changes. It saves review dispositions and literal notes as independent immutable revisions.

The original GIS comparison remains authoritative. Saving a decision does not change source coordinates, attributes, CRS, source selection or adoption. The desk is a separate extension beside **Editable GIS projects**, so it composes with the broader exported-working-edition and raster review without replacing that owner's controller.

## Open, inspect and save

1. In **Editable GIS projects**, receive the actual project and complete its original-source vector review. Open **Source review decisions** and choose that saved comparison.
2. Search by retained identity, original finding or note. Filter by finding or disposition. The table shows 50 rows at a time and retains the complete comparison.
3. Choose **Inspect and review**. The feature detail reopens the selected original and returned native FIDs. It shows complete literal properties and original field mapping. Equivalent CRSs use the same XY extent; differing CRSs retain separate native extents. No reprojection, simplification or geometry repair occurs here.
4. Choose **Not reviewed**, **Accepted**, **Follow up** or **Rejected**, and enter a note. Review the layer-schema row separately because a type or CRS change can exist when paired feature values appear unchanged.
5. Enter a title and reviewer label (required for any recorded disposition; optional for an entirely unreviewed draft), then **Save review revision**. The original queue retains the full request and operation. A reviewer label is supplied text, not authenticated approval.
6. Reopen any saved revision from the selector. Browser drafts are kept separately for each Workspace, comparison and saved revision. The original queue operation can be reopened after an interrupted response.

Missing and ambiguous IDs remain explicit findings. The model never pairs features by their row order. The original comparison's Z and M findings remain visible; its `z_equal` means coordinate-multiset equality, not full three-dimensional surface or curve equivalence.

## Transfer and reopen a review

A saved revision provides:

- `review.html`: standalone offline report with every feature/layer finding and literal note.
- `decisions.json`: editable exact review text and scientific comparison binding.
- `decisions.csv`: complete spreadsheet export, including unreviewed rows.
- `comparison.json`: the complete retained scientific comparison.
- `MANIFEST.json`: file lengths and SHA-256 values.
- `review-decisions.zip`: the complete five-member report package.

CSV values beginning with spreadsheet formula prefixes receive a leading apostrophe. The JSON and HTML preserve the literal note and source identity. Use the editable JSON for lossless decision changes and receiving.

In **Receive review decisions**, choose either the exported JSON or complete ZIP. Preview resolves the same retained scientific comparison and reports its finding/note counts. **Import as a saved revision** retains a new immutable revision with the chosen predecessor and the declared exporter origin. Importing into another independently received Workspace is supported when the complete source/working comparison is identical: local project and receipt registration may differ, while the received edition, source files, selections, algorithms and all findings remain bound.

The complete ZIP manifest is checked before import. A JSON edit may change the title, reviewer label, existing decision disposition or note. Its comparison hash and decision row keys must still match the selected original comparison. Import never substitutes new source geometry or alters a prior revision.

## Installed source

The complete additive production leaves are:

- `model/gis_review_decisions.py`
- `operator/gis_review_decisions.py`
- `operator/extensions/gis-review-decisions.json`
- `operator/web/gis-review-decisions.mjs`
- `operator/web/gis-review-decisions.css`
- `source_tools/receive_gis_review_decisions.py`
- `source/webmap_county_context/GIS_REVIEW_DECISIONS.md`

The accompanying `integration/component_fragments/gis-review-decisions.json` selects those seven complete leaves in the maintained cumulative assembler and requires its existing `core` and `gis-projects` components. It preserves their current shared source instead of duplicating a component definition.

The existing native extension registry loads the descriptor and requires the original `gis.vector.review` action. It registers two queued actions, five read routes and the saved item kind `gis_review_decisions`. No shared app, server, GIS controller or raster-review installer is replaced.

Original `model.portable` application capture already recursively includes `model`, `operator`, `source_tools` and `source`. The native Workspace archive carries `gis-review-decisions` records and all their artifacts. The descriptor's `verify_workspace` callback reopens saved comparisons and decisions after restoration. Preserve the original source-comparison provider and the matching current GIS source leaves in the same application.

The existing extension host can open a specific review through:
```javascript
host.openExtension("gis-review-decisions", "openForReview", {
  workspace_key: currentWorkspaceKey,
  review_id: actualRetainedVectorReviewId,
  snapshot_id: actualSavedDecisionId // optional
});
```

## Native continuation on the original receiving course

Use the actual existing equipped application and original county Workspace. C5AE is the sole county receiving owner; keep that case and its completed sources, model-independent GIS history and review identities.

After the existing PR3694 vector-review phase completes, run this maintained continuation with an owned decision state directory:
```bash
"$PYTHON" "$APPLICATION/source_tools/receive_gis_review_decisions.py" \
  --application "$APPLICATION" \
  --workspace "$WORKSPACE" \
  --state-directory "$COUNTY_ROOT/review-decision-state" \
  --review-id "$ORIGINAL_VECTOR_REVIEW_ID"
```

The driver reopens the actual original comparison, saves a neutral unreviewed receiving note, downloads the native ZIP, receives both that ZIP and the editable JSON as retained revisions, verifies literal decision content and selected original FIDs, then restarts the same Operator state and reopens every original task/download. It uses content-derived native upload identities and the exact accepted queue operation identity. A completed phase is reopened; failed/interrupted/cancelled phases resume their original task.

For a supplied actual review, pass `--decisions /absolute/review-selection.json` containing the same queued save payload:
```json
{
  "review_id": "ACTUAL_RETAINED_REVIEW_ID",
  "previous_id": null,
  "title": "County source review",
  "reviewer": "Actual reviewer label",
  "decisions": [
    {"key": "ACTUAL_COMPARISON_ROW_KEY", "disposition": "follow_up", "note": "Exact review note"}
  ]
}
```
Keep that selection unchanged when resuming the same state. Use another receiving state for a genuinely new selection.

The driver writes `source-review-decisions-receiving.json` and `source-review-decisions-receiving-result.json`. The latter marks the completed native course and retains actual task/result/download identities. Its visual-review field remains `producer_inspection_required` until the producing agent performs the following original owner-required inspection.

## Required rendered product inspection

Before calling any outgoing app, report or export ready for a human, open or run the **exact outgoing version**, render it, and **look at the actual screens or screenshots yourself**. A screenshot merely created but not viewed is insufficient. Operate the important controls.

For this workflow, inspect a desktop/screenshare view and a narrow mobile view. Open populated, empty, loading and error states; select an original feature and a layer-schema row; enter a literal multiline note; save and reopen the native revision; download the exact JSON/CSV/HTML/ZIP; import that export; and reopen the report offline. Check clipping, wrapping, tables, focus, labels, missing data, source-coordinate sketches, download links and restart recovery. Fix visible defects in the same source before marking the outgoing edition human-ready.

Use plain industrial software presentation: readable labels, restrained grayscale, useful spacing and clean tables. Code review, test counts, DOM counts and another worker's approval do not replace your own inspection of the actual rendered product. Retain the actual screenshots/result with the same original receiving handover, and include this instruction in delegated receiving work. Preserve active native ownership and existing source/task identity throughout.
