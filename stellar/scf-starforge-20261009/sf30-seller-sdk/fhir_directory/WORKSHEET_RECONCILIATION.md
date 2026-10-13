# Three-way review of a returned worksheet

A customer can return a worksheet after its source edition has changed. This workbench retains the original worksheet and returned bytes, selects an explicit current edition, and compares every proposed change with both its base value and the selected current value. It prepares an ordinary source-correction plan only after the operator records every decision.

## Start in the operator

Open **Customer worksheets**, select the returned file's saved record, and choose **Review against current edition**. The same workbench is available under **Three-way review**.

1. Open the original return and select the exact **Current edition**.
2. Match **every original worksheet row** to a complete current row, or leave it explicitly unbound. Give each match or unbound row a reason. Rows omitted from the customer's return still remain in this binding inventory.
3. Name the review and actor. If this continues an accepted correction, explicitly select that correction as the predecessor. Its accepted edition must be the chosen current edition.
4. Choose **Prepare three-way review**. The immutable comparison retains the full original/current row graph and every typed base, proposal and current atom.
5. Choose and explain every change. Save the review to prepare a correction plan.
6. Open that plan in **Source corrections**. Preview its complete derived sources and edition, then explicitly accept that reviewed preview. Preparing or reviewing a three-way comparison performs neither action.

The row picker shows complete source references. It never selects the first similarly named row or assumes that a provider ID uniquely identifies the current row. A current row cannot be reused for two different original worksheet rows. The native engine verifies every source, row, resource and member hash and rejects ambiguous ancestor/descendant targets.

**Clear all current matches** retains the original worksheet and clears all current matches and reasons. Use it to deliberately select another current edition without having to clear thousands of rows individually.

## Read the comparison

| State | Meaning | Available decision |
| --- | --- | --- |
| proposable | Current still matches the original base at this change | Accept proposal, keep current, or resolve the complete current row |
| already-applied | Current already has the exact proposed presence, type and lexical value | Accept proposal records agreement and creates no edit; keep current also preserves it |
| conflict | Both customer and current edition changed the selected value | Explicitly accept the proposal, keep current, or resolve the complete current row |
| unbound | No current row was selected | Keep current only; the original proposal remains retained |
| structure-conflict | Current parent structure, representation or physical CSV layout cannot safely use the original change | Keep current or explicitly replace the complete selected current row |

The **Base**, **Customer proposal**, and **Current** columns distinguish an absent value, explicit JSON null, numeric lexical tokens, strings, objects and arrays. **Unknown** current values indicate a structural blocker; they do not mean the field is absent.

JSON object fields are selected by the original relative RFC6901 pointer. Arrays and added or removed objects remain atomic. CSV positions are physical cell indices, including duplicate or blank headers. Changed headers or cell counts never silently reuse an earlier physical position.

For complete-row resolution, the editor starts with the **current row's representation and full value**. A JSON replacement keeps its lexical JSON text. A CSV replacement includes every physical cell as a string. All changes belonging to that row must choose **Resolve complete row**; granular choices cannot be mixed with a whole-row replacement. One retained resolution supplies the complete current-row edit and links every resolved decision.

## Working-copy and interrupted request recovery

**Save working copy** downloads the complete authoring input: original/current bindings, reasons, decisions, unfinished row editor text, selected records and the exact pending request. Session storage preserves the same working copy while the page is open. Unfinished return and current-edition selector text is preserved as a draft. The separately retained opened record IDs restore the actual review basis, so reloading while an ID is only partly typed keeps both the entered text and the previously opened rows.

If reopening a saved copy fails, its original text remains protected. **Retry original working copy** uses those exact bytes again. **Download original working copy** preserves them for portable recovery. A validated replacement requires an explicit restore action; a failed read never overwrites the saved draft with empty defaults.

A native mutation's exact input is retained before dispatch. An uncertain request prevents new authoring until **Resume exact pending request** reconciles that original input. Once native acceptance returns, the action, input and immutable record ID are persisted before the pending request clears. **Reopen accepted response** recovers the record or export even if the following screen read or download failed.

Leaving the section disposes that screen's callbacks. An old request cannot overwrite a newly opened working copy. Inputs remain frozen while an operation is pending.

## Native API

The main catalogue embeds the complete source-owned input schemas from `directory-correction-worksheet-reconciliation-schema.json`.

| Method | Path | Complete input |
| --- | --- | --- |
| POST | /api/directory/correction-worksheet-reconciliations/prepare | prepare |
| POST | /api/directory/correction-worksheet-reconciliations/review | review |
| POST | /api/directory/correction-worksheet-reconciliations/export | export |
| GET | /api/directory/correction-worksheet-reconciliations/catalogue | none |
| GET | /api/directory/{collection}/{id}/rows | offset, limit, optional rowKey and state |
| GET | /api/directory/{collection}/{id}/files/{fileKind} | none |

The collections are `correctionWorksheetReconciliations` and `correctionWorksheetReconciliationReviews`. Normal full-record and paginated collection reads remain available.

Prepared files are `input`, `rows`, and `comparison`. The rows file is the full original/proposed/current row graph; the rows **API** pages the comparison. Review files are `input` and `decisions`. All row/comparison/decision files are complete JSONL, with one source-defined compact JSON record plus LF per line.

Pages preserve original order, an immutable collection/record ID, contiguous `nextOffset`, total count and a4MiB byte budget. If one row exceeds that budget, download the complete file. No interactive response truncates an original row.

## CLI

Use the same original workspace and complete input files:

~~~sh
python cli.py correction-worksheet-reconciliation-prepare --workspace ABS_WORKSPACE --input ABS_PREPARE_JSON
python cli.py correction-worksheet-reconciliation-review --workspace ABS_WORKSPACE --input ABS_REVIEW_JSON
python cli.py correction-worksheet-reconciliation-export --workspace ABS_WORKSPACE --input ABS_EXPORT_JSON
python cli.py rows --workspace ABS_WORKSPACE --kind correction-worksheet-reconciliation --collection correctionWorksheetReconciliations --id EXACT_ID --offset 0 --limit 50
python cli.py file --workspace ABS_WORKSPACE --kind correction-worksheet-reconciliation --collection correctionWorksheetReconciliations --id EXACT_ID --member comparison --out ABS_COMPARISON_JSONL
~~~

Use `--row-key` and `--state` for explicit page filters. Use `records --kind COLLECTION --id EXACT_ID` to reopen full immutable metadata.

## Typed SDK and Merchant

The existing Directory provider exposes the following complete native actions:

- `directory_correction_worksheet_reconciliation_prepare`
- `directory_correction_worksheet_reconciliation_review`
- `directory_correction_worksheet_reconciliation_export`
- `directory_correction_worksheet_reconciliation_catalogue`
- `directory_correction_worksheet_reconciliation_rows`
- `directory_correction_worksheet_reconciliation_file`

Typed helpers are `prepareDirectoryWorksheetReconciliation`, `reviewDirectoryWorksheetReconciliation`, `getDirectoryWorksheetReconciliationRecord`, `directoryWorksheetReconciliationRows`, `directoryWorksheetReconciliationFile`, and `exportDirectoryWorksheetReconciliation`. The iterator checks every page's identity, count, contiguous order and byte budget. Full-file helpers bind the runtime's declared payload to the immutable native descriptor before downloading all bytes.

Complete native actions are bounded at32MiB. A Merchant inline request has its existing smaller envelope limit. For large actions, declare the complete original JSON file in the host's existing input map and use `input_apply` with the selected `directory_correction_worksheet_reconciliation_*` action. The scoped native input limit is32MiB; the global Merchant transport is unchanged. The file must exist with its original byte hash when the host configuration opens.

Complete comparison, row and decision files are bounded at256MiB and use the established retained-file receiver. Whole connected workspace files retain the existing512MiB ceiling. Larger native archives remain directly downloadable.

## Complete customer receiving and source history

An exported reconciliation packet retains the selected original/current records, complete inputs, original source/index files, comparison, optional review and the ordinary prepared plan. The exact export input is retained in its native record and manifest.

The whole editable workspace preserves both new immutable collections alongside every prior Directory, Gravity, worksheet, correction and procedure collection. Receiving accepts the previous **complete** registry shapes explicitly. It verifies all new file descriptors and replays original bindings and decisions against the retained sources. It never treats an arbitrary incomplete registry as a historical version.

The native operating course is documented in [CORRECTION_WORKSHEET_RECONCILIATION_OPERATING.md](CORRECTION_WORKSHEET_RECONCILIATION_OPERATING.md). The browser/Merchant/customer course uses `operate_correction_worksheet_reconciliation_clients.mjs` and preserves the actual final customer's workspace packet separately from the producer packet. Completed course results, journals and verified files establish execution; source publication alone does not.
