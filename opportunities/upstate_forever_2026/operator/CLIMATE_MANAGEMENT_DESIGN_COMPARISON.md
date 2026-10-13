# Compare and hand over saved Management designs

TokenJunkieLabs · Ecosystem Sciences  
Owner direction: `CURRENT_OWNER_DIRECTION.md`, version `2026-10-13.4`.

The existing **Management across forcing** desk can compare two actual saved working revisions without completing either scientific design. Under **Compare saved working designs**, choose the exact Before and After revisions, name the comparison, and select **Preview saved-design changes**. Review the original values, then **Save readable design handover**. The original Operator queue retains that request and its reviewed preview identity.

This is an authored-design comparison. It does not estimate management benefit, calculate a climate interaction, judge scientific validity, or run a model. The separate numerical Management report still requires compatible completed native cases and its original scientific validation.

## What is compared

The readable report contains both immutable revision IDs, project and series IDs, revision numbers, parent/fork ancestry, authors, names, notes and creation times. The comparison tables retain:

- Design title, scientific question, explicit reference-period ID and difference-map choice.
- Complete original period order, each period ID and label, and reference/treatment/control study-and-case choices.
- Reporting source collection, original source ID, display name, layer and full filter values.
- Complete immutable forcing-study identities and reporting collection records bound by the selected drafts.

Blank strings, absent optional fields, JSON null, false and zero remain distinct. Unchanged fields are included. Revision counts and changed-field counts describe design editing; they are not scientific output quantities.

Periods align by their original literal IDs only when each side has unique nonblank IDs. Whitespace-only IDs are unfinished, and are not eligible identity keys. Duplicate or blank keys cause an explicit comparison by original position. The report retains the complete order on each side. An edited identity appears as a removed and added identity, not an inferred rename.

Reporting areas use the exact collection/source/layer tuple only when both sides have complete unique keys. Otherwise they also use original positions. No feature lineage is guessed. Two revisions from separate branches or series may be selected deliberately; the report discloses their actual relationship. Comparing a revision with itself is valid and produces unchanged design fields.

## Readable and editable handovers

A saved comparison supplies eleven ordinary native downloads:

1. `report.html`: full readable report, exact original identities and every before/after field.
2. `comparison.json`: complete stored comparison result.
3. `changes.csv`: all rows, explicit before/after presence flags, and change labels.
4. `before-history.json` and `after-history.json`: both complete ordered original histories.
5. `before-draft.json` and `after-draft.json`: exact unfinished raw controls.
6. `source-bindings.json`: both original immutable binding sets.
7. `README.txt`, `MANIFEST.json` and `working-design-comparison.zip`: instructions, member identities and the complete readable package.

CSV prefixes text beginning with spreadsheet formula characters with an apostrophe. The JSON files preserve literal original strings. The ZIP includes all ten non-ZIP members, with relative companion links for the HTML. Keep the complete extracted folder when using those links.

The JSON histories contain immutable source metadata, not the large source objects. **Export editable comparison Study** opens the existing Study desk with the saved `climate-management-working-comparisons` root. Preview the closure and export using the ordinary Study queue. It includes the exact Before and After working revisions, every ancestor/fork revision, all originally named reporting-source companions and each forcing family's existing native/source closure. A full Workspace backup remains available through its existing action.

Receiving preserves the original comparison ID, stored result, every file descriptor and both complete histories. Existing capture-time forcing-family receipts govern their dependencies; receiving does not discover a later unrelated report. Opening the comparison leaves the scientist's current editable draft untouched. Use the existing **Open working design** controls to deliberately restore one of its original revisions.

## Native API and CLI

Read operations:

- `GET /api/climate-management/working-comparison-catalog?workspace=...`: every original saved revision and retained comparison.
- `POST /api/climate-management/working-comparison-preview` with `{workspace,selection}`.
- `GET /api/climate-management/working-comparison?workspace=...&id=...`: verified immutable record and original file tickets.

The exact selection is:

```json
{"before_revision_id":"<original 64-character revision ID>","after_revision_id":"<original 64-character revision ID>","title":"Authored design comparison title"}
```

The original queued action is `climate-management.working.compare`, with `{selection,expected_id}`. Keep the original Operator operation ID on response-loss retry. A completed original preview reopens its saved result even after a later implementation change. A new creation requires the current preview ID; altered selected revisions or title cannot reuse another request.

Use the complete application and existing Workspace:

```bash
"$ECO_PYTHON" "$ECO_APPLICATION/source_tools/climate_management_working.py" \
  --workspace "$ECO_WORKSPACE" compare-list

"$ECO_PYTHON" "$ECO_APPLICATION/source_tools/climate_management_working.py" \
  --workspace "$ECO_WORKSPACE" --output "$OUTPUT/design-preview.json" \
  compare-preview --before "$BEFORE_REVISION" --after "$AFTER_REVISION" \
  --title "$COMPARISON_TITLE"

"$ECO_PYTHON" "$ECO_APPLICATION/source_tools/climate_management_working.py" \
  --workspace "$ECO_WORKSPACE" --output "$OUTPUT/saved-design-comparison.json" \
  compare-build --request "$ORIGINAL_COMPARISON_REQUEST"

"$ECO_PYTHON" "$ECO_APPLICATION/source_tools/climate_management_working.py" \
  --workspace "$ECO_WORKSPACE" compare-open --comparison "$COMPARISON_ID"

"$ECO_PYTHON" "$ECO_APPLICATION/source_tools/climate_management_working.py" \
  --workspace "$ECO_WORKSPACE" compare-verify
```

The build-request JSON contains the exact preview's `selection` and its `id` as `expected_id`. These commands use the original model APIs. They neither create a Workspace nor invoke a scientific run.

## Continue the existing unfinished-design receiving operation

This extends the original 3716 / 1151–2851 Management working-design course. Use its actual retained revisions and genuine zero-run source-intake Workspace. Its active annual-source task and source repair remain with the original owner. Completed Climate2171 native-result receiving is a separate existing operation.

1. Install the full current component with its original Management, Climate forcing and Study dependencies. Compose newer shared Study/provider/browser source rather than overwriting another owner's additions.
2. Use the first and second genuine working revisions already saved by the original course. Keep unfinished role/period fields as originally saved. Compare them and inspect the exact labels, attribution, blank values, notes and ordered roles. Compare an actual explicit branch with its original parent as well.
3. Save the readable comparison through the ordinary queue. Retain its original task, operation, preview and comparison IDs. Reconcile the same request and confirm the completed original record is reused.
4. Download all eleven original files. Verify each descriptor through the ordinary original download path. Open the HTML at desktop and 390 pixels, read every section and all wide-table columns, inspect the CSV and each JSON/history/binding file, and extract the ZIP with all original members. Confirm each HTML companion link opens the corresponding original file.
5. Export the comparison root through Study and also preserve the full Workspace backup. Receive each with the original upload/restore operations into distinct locations. The selected Study carries its precise reviewed dependency closure; unrelated sources need not appear merely because the full sender had them.
6. Cold-reopen each received Workspace from copied complete application source. In Study choose **Saved Management design comparisons → Open saved-design comparison**. Confirm exact before/after IDs, ancestry, raw controls and every original download. Open both original working designs from their retained Study roots. Preserve edits in any already-open unrelated draft.
7. Operate loaded/empty/error and interrupted-request states. Confirm that selecting a different pair during a pending preview cannot display stale results, and that late results from a previous Workspace cannot replace the current view.
8. Reconcile native-run counts and original completed-run identities with the pre-course state. The working comparison itself changes no scientific run. Return the actual operated results and any exact integration exception in the original receiving thread.

Before presenting the outgoing app or any attachment as ready, the producing worker must OPEN, USE and personally LOOK at the exact delivered version and actual desktop/narrow screenshots. Inspect every attachment in its normal recipient workflow, including all archive members. Fix clipping, broken links or lost controls in the authorized product. Source review and recorded screenshots alone do not replace viewing the result.

The complete component retains this guide, native comparison and Study visitor, same-desk controls, original provider/descriptor and CLI. The original immutable designs and scientific engines remain the authoritative source.
