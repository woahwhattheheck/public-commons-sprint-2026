# Return a saved Measurements result with its original sources

Use this workflow to include an existing reviewed-input or concentration–discharge pairing result in the maintained **Source returns** handover. It preserves the saved result and its original workspace revision. Inspecting its source selection does not rerun calculations or change scientific decisions.

## Open the original result

In **Saved results**, choose the actual retained result and open its original snapshot. Confirm its type, saved time and original workspace revision. Inspect the full accepted/excluded population or paired/unpaired population, settings, reasons and provenance before choosing **Inspect source-return selection**.

Use a result already retained by the original workspace or receiving operation. The five-source, 533-row WQP capture is source material; it contains no discharge population and is not evidence of successful chemistry–flow pairing. Do not create a new scientific run merely to demonstrate this handover.

The source-selection inspector binds the complete displayed snapshot to the selected result. A different result ID, altered snapshot or changed selection is rejected. Unsupported historical formats remain available as their complete original JSON.

## Read the historical and current basis

The inspector shows the original result revision and the current workspace revision at which source associations were inspected. These are distinct facts.

| Saved result | What selects the original files | What remains historical |
| --- | --- | --- |
| Reviewed measurement/calibration input | Source IDs and available source digests retained in each accepted or excluded result row | The saved values, decisions, exclusions and original revision |
| Concentration–discharge pairing | Immutable chemistry and paired-discharge record IDs from the saved result, resolved through the current workspace's retained file associations | The original pairs, unpaired rows, settings and reasons |

A calibration row without a retained source reference is listed as unresolved. It is not silently assigned a current substitute. A saved reference that conflicts with the retained source digest is rejected.

A paired result does not retain historical source-file selections for every record. Its file associations must therefore remain labeled **Current original-file association**. Unpaired rows select their chemistry identity; the historical snapshot does not identify every rejected or ambiguous candidate discharge record. No missing flow selection is inferred.

Inspect every selected source's name, kind, bytes, selection basis and referenced-record count. Read the explanations and unresolved rows. The display shows at most the first 50 unresolved entries; **Download complete selection evidence** retains all of them and the full result/source binding.

An incomplete source selection does not make the saved result incomplete. It means the proposed return lacks some original-file associations. Preserve that distinction in the return note. If no original file is available, opening or downloading a working return selection is disabled; the original result and complete selection evidence remain available.

## Add the result without losing an existing return

Choose **Open source return** for a new working selection, or **Add to current source return** when a draft already exists.

The operation adds the selected original file IDs and result ID to the existing selections. It preserves the authored title and note, adds the historical/current explanation, and leaves previously selected sources and results in place. A blank title receives a descriptive title that can still be edited. This creates a working selection, not a published edition.

Alternatively, use **Download separate working selection**. It uses the existing Source returns working-file format and can be reopened through **Reopen saved selection**. Keep **Download complete selection evidence** alongside it when the detailed associations or unresolved rows need to travel.

If the current return has an unfinished publication, it cannot be replaced or extended. Choose **Open current return** and recover that original request. A separate downloaded working selection can be prepared without changing the pending request.

## Preview the complete return

In **Source returns**, inspect the selected originals and saved results. Preserve the historical result's original revision and the explanatory note; do not describe the current complete project as a reconstruction of the entire historical workspace.

Select **Preview every selected source row**. Review:

- Every original file and all its rows, including accepted, excluded, unresolved and unsupported records.
- The selected saved result's unchanged values, settings and exclusions.
- The complete current project and native context included with the return.
- Original workbooks or CSVs, reviewed companions, row/cell lineage, readable workbook/report and every declared collection companion.
- The title, note, limitations and unresolved source associations.

An original spreadsheet is preserved as supplied. The reviewed companion describes the row/cell relationship; this workflow does not silently rewrite formulas, source labels, units, dates or untouched cells.

If the workspace changes, obtain a current preview through the existing desk. The saved historical result remains unchanged, while the preview and complete project describe their actual current revision.

## Publish and recover the same edition

Use **Publish reviewed return edition** after reviewing the full preview. The existing publisher retains the exact request, expected revision and preview identity before dispatch.

After an interrupted or uncertain response, keep the same working selection and pending request. Choose **Check original publication**. If the exact saved edition is found, the desk reopens it. If no original publication is visible and the desk offers **Resume exact original publication**, continue that same retained request. Do not create another request or edit the pending body to clear an uncertain outcome.

Use **Save selection and unfinished title** to preserve the complete working file, including pending publication state where present. Reopen it through the existing desk. A selected working file rejected during receive remains downloadable as the exact originally selected file.

Publication returns a saved source-return edition. It does not create a new scientific result or alter the historical result that was selected.

## Open every delivered member and receive it independently

Open the exact saved edition and use **Download complete verified ZIP**, **Download edition manifest** and the original member downloads. Inspect the actual outgoing files in normal recipient-facing applications:

- Open each spreadsheet and all relevant sheets, including formulas and unchanged cells.
- Open every CSV and inspect the complete table, not only its first screen.
- Open the readable HTML/report and every relevant page; inspect settings, units, exclusions, provenance and all selected result populations.
- Open the original source files, reviewed companions, full selection evidence and retained result JSON.
- Extract the complete ZIP and inspect its manifest, complete project, native context, source-return record and all declared members.

The established **Receive complete return ZIP** route checks the complete member inventory, original bytes and regenerated source-return content. Receiving that return and restoring a scientific workspace are separate operations. Use the existing complete-workspace receiver with the included project to restore and cold-open the scientific workspace; do not infer that opening the ZIP alone restored it.

Cold-open the received return and its selected saved result through the existing receiving course. Confirm that sender history and later edits remain intact and the original result identity, values and revision remain unchanged.

## Read-only interface

The maintained Measurements CLI adds the following subcommand to its existing selected entry point:

~~~text
result-source-selection --workspace ACTUAL_WORKSPACE --id ORIGINAL_EXPORT_ID --output selection.json
~~~

The existing HTTP interface exposes:

~~~text
GET /exports/ORIGINAL_EXPORT_ID/source-selection
~~~

Both inspect the retained result and its source associations. They do not publish a return, run calibration or pairing, or change scientific state. Retain the complete returned selection evidence when using these interfaces.

## Complete the actual original receiving course

Use the same original native/browser owner, installed source, workspace and saved result. Open the exact outgoing version and personally view actual desktop and 390px screens. Operate snapshot selection, source inspection, add-to-existing draft, separate working-file download/reopen, pending publication recovery, full preview, publication and saved-edition reopening.

Include meaningful empty and unresolved source selections, a wrong result identity and the historical/current distinction. Confirm that long tables expose all rows and the complete evidence download retains rows beyond the displayed limit. Preserve an authored title/note and previous selection while adding a result.

Personally open every outgoing attachment and all relevant pages, inspect actual screenshots, and cold-open the complete delivered result. Repair observed clipping, poor contrast, missing data, broken navigation or export defects in the maintained source, then inspect the corrected outgoing version. Source hashes, DOM checks and source-only execution do not establish actual rendered or native acceptance.

Record the actual selected result, original/current revisions, outgoing edition and filenames, opened members, operated controls and concrete unresolved issue in the existing handoff. Continue the original operation after interruption; do not create a second browser course or a new scientific run.
