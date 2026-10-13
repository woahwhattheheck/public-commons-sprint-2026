# Coefficient sources in scientific and customer reports

The ordinary delivery workflow carries the actual run profile and its original biophysical table into the scientific report, customer report and editable project. An operator may add specific saved evidence and range editions during the existing report review step. The report uses those exact choices; no latest edition or uncertainty range is selected automatically.

## Select the original evidence

Open the existing delivery or map-atlas wizard for a completed native baseline and compatible alternatives. In the review step, inspect the selected profile and choose any evidence or range records needed for this report. Evidence must belong to the actual run profile. A saved range may match that profile at its central, lower or upper position. When a derived endpoint is selected, the range's original central evidence and central table are retained alongside the actual endpoint table.

The existing delivery selection accepts:

```json
{
  "coefficient_evidence": {
    "evidence_ids": ["saved-evidence-id"],
    "range_ids": ["saved-range-id"]
  }
}
```

Use actual immutable 64-character saved IDs. Empty arrays select the original run profile and table without adding an evidence or range edition. Changing the baseline invalidates incompatible selections; the wizard keeps their IDs visible so the operator can remove or replace them deliberately.

The read-only catalog is resolved from the actual baseline run by the operator API. It returns profiles, direct evidence choices, compatible ranges, matched endpoint positions and cell coverage. Saved original records and source files are verified before the report selection is bound.

## Read the report

Both reports contain **Coefficient sources and selected ranges**. The section identifies each selected profile/table, source title and vintage, coefficient-cell coverage for each selected evidence edition, and the actual positions and parameter groups for any selected range.

Coverage is a count of input coefficient cells in the selected model scope. It is not geographic coverage or statistical confidence. Counts from separate evidence editions remain separate. Lower and upper coefficients are source-defined endpoint choices; they do not imply lower and upper pollution forecasts or a confidence interval. Original nutrient load types and values retain their native model meaning.

The primary section keeps citations and selected parameter summaries concise. Full cell-level values, citations and original rows remain in linked downloads. Existing peer report tables and scientific sections continue to use the maintained renderer.

## Download and reopen the exact source

Each completed delivery retains these relative paths in its file inventory and editable archive:

| Artifact | Relative path |
| --- | --- |
| Bound source and selection inventory | coefficient-evidence/coefficient-evidence.json |
| Complete selected coefficient rows and citations | coefficient-evidence/selected-coefficient-evidence.csv |
| Unchanged original tables and evidence CSVs | coefficient-evidence/sources/&lt;sha256&gt;.csv |
| Original profile, evidence and range records | coefficient-evidence/records/&lt;kind&gt;/&lt;id&gt;.json |
| Actual evidence readers, adapter and report implementation | coefficient-evidence/implementation/ |

The inventory binds the actual selected records, original source hashes, endpoint positions and implementation hashes. The delivery identity includes this binding before any reports are produced. Original files remain byte-for-byte copies. These files enter the ordinary delivery inventory and working-project snapshot, so existing export and reopen operations preserve them.

## Producing-worker receiving course

Use the actual equipped receiving workspace and its completed native run. Create the populated delivery through the maintained operator and inspect the outgoing product itself. Follow repository AGENTS version 2026-10-13.1: the producing worker opens or renders the exact product, looks at its screenshots, operates key controls at screenshare and narrow widths, exports and reopens it, and fixes visible defects before delivery.

1. Open the existing review step at a screenshare width and approximately 390 pixels. Read the selected profile/table and actual evidence coverage. Select a compatible evidence edition and a range, switch baseline and return, then check that selected IDs remain explicit and incompatible choices are actionable. Queue the actual delivery and follow its existing task view.
2. Open the resulting scientific HTML and customer HTML. Look at screenshots of the coefficient section at both widths. Open the actual generated PDFs and render/read the corresponding pages. Check legibility of titles, table wrapping, citation links, endpoint labels and original source details. Follow all visible download links from both HTML reports.
3. Read the retained inventory and full CSV. Compare original source bytes to their recorded SHA-256 values. Confirm the actual profile table and selected range position agree with the completed native run and saved selection.
4. Export the ordinary complete delivery and editable project, extract or reopen them through the maintained receiving workflow, and open the reports from that outgoing edition. Verify relative source links work in the extracted package, the original records/tables are available for editing through the project, and the selected evidence IDs remain unchanged.
5. Patch any visible or functional defect in the producing source and repeat the affected product steps. Send the actual delivery ID, source edition, screenshot paths, populated HTML/PDF paths and exported/reopened artifact locations to the existing Eco receiving thread.

The workflow uses actual saved model runs and source records. Its primary product is the existing scientific/customer delivery and editable project.
