# Offline supplier workbook review

This is the spreadsheet review path for the original supplier comparison. It uses the same source editions, canonical fields, rules, item IDs, decision history, `decideMany`, finalizer and customer export as the browser and command-line review.

The workbook can leave the application for offline work. Its return is a proposal against a particular saved comparison revision. The original workspace remains the authority for the decisions applied when it comes back.

## Open the complete product

From `products/conapi/supplier-report` in the complete installed source:

~~~bash
node supplier-report-cli.mjs serve --port 8765
~~~

Open the displayed loopback URL. Load the original supplier workspace or create a comparison from the actual supplier editions and mapping rules. **Offline workbook review** is below the original review interface.

Spreadsheet file conversion uses the existing Analysis Python environment with `openpyxl`. The JavaScript comparison and its ordinary CSV/JSON/HTML/SQLite paths retain their original dependency-free operation. If Analysis has a separate executable, select it before starting the same server:

~~~bash
CONAPI_WORKBOOK_PYTHON=/absolute/path/to/analysis/python node supplier-report-cli.mjs serve --port 8765
~~~

The workbook helper also accepts `--python /absolute/path/to/python` on `workbook-export` and `workbook-review`. It uses the existing environment; it does not install a package or start another application server. Python's `review_workbook.py` module only reads and writes XLSX files. The original `supplier-report.mjs` module validates and records every decision.

## Export and fill the workbook

Choose **Download review workbook**. Keep the complete XLSX file.

| Sheet | Contents | Editable work |
|---|---|---|
| Review | Original item ID, key, change classification, complete-source summaries and existing decision | Reviewer in B8; return note in D8; Decision, Reason, Source side and Source row |
| Corrections | Every canonical field of every item, with its selected original starting value | Complete values for an item whose Decision is `replace` |
| Source values | Exact canonical and original values for every retained source row | Reference material; original identity and content are checked on return |
| Basis | Full original source editions, rules, report and ordered decision history, with a SHA-256 identity | Retained as supplied |
| Read me | Instructions for review, values and returning the complete file | Reference material |

Sorting and filtering are supported. Original rows are shaded; their complete identities and values are validated when the workbook returns. Keep the original sheets and every original item/field. Additional value fragments may be inserted in Corrections for a long value.

Each Review row accepts one of the original decision actions:

| Decision | Required values | Native meaning |
|---|---|---|
| `use_candidate` | Reason | Use the single valid incoming source row |
| `keep_baseline` | Reason | Use the single valid baseline source row |
| `exclude` | Reason | Exclude this comparison item from the accepted result |
| `replace` | Reason and every canonical field in Corrections | Record the complete corrected canonical row |
| `choose_source` | Reason, baseline/candidate and exact source row number | Select one valid original row when the item contains multiple source rows |

Leave **Decision** empty to leave the current item alone. If you edit a reason, source choice or correction, also select its applicable decision. The importer identifies unused edits instead of silently discarding them.

The complete original rules validate replacement keys, field types, allowed values, dates, required fields and exact canonical decimal representation. A malformed source row stays visible as a native exception; selecting its side does not bypass its original validation.

### Exact values

Canonical supplier values are strings or null. Price calculations remain in the original exact-decimal engine. The workbook writes identifier, price, date and decision cells as Excel Text cells.

- `Value kind = text`, empty Value: an empty string.
- `Value kind = null`, `Encoding = text`, empty Value: explicit null.
- `Encoding = json`: join the ordered parts and decode the complete JSON string. This carries characters that cannot be stored literally in an XLSX cell.
- Part numbers begin at 1 and are contiguous for each item/field. Keep the same kind and encoding on all parts. Each fragment contains at most 24,000 characters.
- `Source values` distinguishes **Canonical:** fields from **Original:** fields. Null source values use JSON encoding; the literal text "null" uses text encoding.

Excel stores only 15 significant digits for numeric cells. Formatting a rounded number as text afterward cannot restore its original digits. Returned decision and value cells must actually contain text; numeric or formula cells are rejected with their location. Re-enter the intended exact source value as text when correcting one.

The XLSX contains no generated formulas. A formula, macro, embedded object, external data relationship or external workbook link is not a supplier decision. Ordinary HTTP(S)/mailto hyperlinks added to textual review notes may remain; the importer uses their displayed original text.

## Bring the reviewed file back

1. Open the latest saved workspace for the same original comparison.
2. Select the reviewed XLSX under **Return reviewed XLSX**. Its complete bytes and parsed original basis are retained in this browser.
3. Choose **Review returned decisions**. Review original-at-export, current and returned decisions side by side.
4. For each decision changed since export, choose **Keep current decision** or **Use returned decision**. Each choice creates a fresh review against the actual current workspace.
5. Choose **Apply reviewed return**. Select **Require complete finalized output** when the whole review is ready for accepted output.
6. Save the original workspace, and download the complete workbook delivery from **Saved returns and recovery**.

Every returned comparison ID, source edition, rule set, original item and complete history is checked. The current history must retain the workbook's original history as a prefix. A later re-comparison with different source or rules has its own comparison ID; make its own workbook.

Unrelated later decisions are preserved. A returned decision already identical to the current decision is reported as already current and creates no duplicate history event. Overlapping changes are displayed with both original and current attribution. The final apply binds the complete review, current workspace SHA-256, returned file, actor, timestamp and conflict choices.

No second reviewer is imposed by this feature. The original reviewer attribution is recorded with the applied decisions.

### Recovery and returning to an older result

Before changing the original browser workspace, the application stores the exact prepared request and complete resulting workspace in IndexedDB. The **Resume original adoption** button uses that same operation and retained result. If the original result is already part of the current history, it preserves later work and returns that current workspace.

If another branch of decisions was adopted before the prepared return, choose **Keep attempt and review return again**. The earlier immutable operation stays available for download; a new review explicitly selects the current workspace. It does not resubmit the earlier request under a new identity.

**Open saved result** deliberately opens the original retained result at its recorded revision. Save any current workspace you want to retain before replacing it. Receiving a delivery into a workspace already containing that same result preserves its later decision history.

Browser storage is specific to the browser profile and origin. Download the full delivery for portable receiving. If storage cannot confirm the prepared result, the application keeps it in memory and exposes **Download prepared delivery** and **Retry saving and adopting original result**. It does not mark an unconfirmed browser save complete.

## Command-line operation

### Export the exact original review

~~~bash
node supplier-report-cli.mjs workbook-export \
  --workspace supplier.workspace.json \
  --out Supplier_Review.xlsx
~~~

The XLSX output is separate from the original JSON workspace. Replacing an existing regular XLSX requires `--force`.

### Read and review a returned workbook

~~~bash
node supplier-report-cli.mjs workbook-review \
  --workspace current.workspace.json \
  --returned Supplier_Review_Returned.xlsx \
  --out-dir review-001
~~~

The new review directory retains the actual XLSX, complete parsed return, exact preview and original selected workspace. Its `manifest.json` is written after the complete members.

For overlapping decisions, save a choices object keyed by the exact original item ID:

~~~json
{
  "item_ORIGINAL_ITEM_HASH": "keep_current",
  "item_ANOTHER_ORIGINAL_HASH": "use_returned"
}
~~~

Then repeat the review into a new directory:

~~~bash
node supplier-report-cli.mjs workbook-review \
  --workspace current.workspace.json \
  --returned Supplier_Review_Returned.xlsx \
  --resolutions choices.json \
  --out-dir review-002
~~~

Inspect the full `review.json`. It includes all returned decisions, current/source revisions, unresolved conflicts, selected original decision inputs, projected native summary and the complete review hash.

### Apply, retain and finalize

~~~bash
node supplier-report-cli.mjs workbook-apply \
  --workspace current.workspace.json \
  --review-dir review-002 \
  --operation ORIGINAL_WORKBOOK_RETURN_ID \
  --out reviewed.workspace.json \
  --delivery-dir workbook-delivery-001 \
  --finalize
~~~

The complete receiving result is durably written before the original workspace file is adopted. Use a new result file by default. `--force` explicitly permits replacing a selected regular output; its original bytes are checked again before replacement.

A retry uses the same original operation ID, review directory, delivery directory and finalization choice. The retained operation distinguishes a prepared result from an already-applied history. A changed input or another original operation is rejected instead of being attached to that receipt.

If the current workspace changes during file conversion or receiving, the prepared result remains in the delivery directory. Review its original return against the new saved workspace rather than changing the old review hash.

### Complete supplier customer export

~~~bash
node supplier-report-cli.mjs export \
  --workspace reviewed.workspace.json \
  --workbook-delivery workbook-delivery-001 \
  --out-dir supplier-customer-delivery
~~~

This adds the actual returned XLSX and complete workbook delivery packet to the original supplier export manifest. The existing supplier attachment adapter receives and verifies those exact members alongside the original source/report artifacts. A return whose result has not yet been applied to the selected original workspace cannot be attached as its applied workbook delivery.

Keep the complete installed supplier product assets supplied by the cumulative product publisher: original domain/CLI/browser/CSS, supplier attachment and catalogue helpers, workbook engine/browser/host/Python/guide, and the original native workflow guide. The customer export and application source use the same original supplier comparison.

## Fresh customer receiving

Download **complete delivery JSON** in the browser and choose it under **Receive complete delivery JSON** on the receiving machine. The receiver checks every member's complete bytes and reconstructs the original operation, history, reports and finalization.

Or use the original CLI:

~~~bash
node supplier-report-cli.mjs workbook-receive \
  --packet ORIGINAL.workbook-delivery.json \
  --out-dir received-workbook
~~~

An existing complete directory is also an input:

~~~bash
node supplier-report-cli.mjs workbook-receive \
  --delivery-dir workbook-delivery-001 \
  --out-dir received-workbook
~~~

The complete packet contains:

- `returned.xlsx`: actual returned spreadsheet bytes.
- `return.json`: the parsed original return with full source basis.
- `review.json`: exact current/source comparison and conflict choices.
- `operation.json`: original request, hash, actor, timestamp, before/after workspace and receipt.
- `before.workspace.json` and `workspace.json`: complete native workspaces, including original source and ordered history.
- Original `changes.csv` and `report.html`.
- When the resulting native review is complete: `accepted.csv`, `accepted.snapshot.sql` and `lineage.json`.

The SQLite file is an original **new TEXT snapshot**, with its original lineage and metadata tables. Use an unused table name and an executor that stops and rolls back on error. Canonical nulls and exact decimal strings remain distinct there and in the workspace; original accepted CSV represents null as an empty CSV cell.

## File limits and operation boundaries

The format supports complete XLSX files up to 64 MiB, up to 4,096 archive members and 256 MiB expanded archive content. It enforces Excel's 1,048,576-row limit per sheet and fragments long text below Excel's 32,767-character cell limit. The JSON conversion request is capped at 96 MiB; the complete encoded model must fit that bound as well as the worksheet limits.

The original loopback server handles one workbook conversion at a time. It rejects another conversion with a recoverable busy response and drains its accepted conversion during shutdown. Only the declared JSON conversion routes are added; browser requests cannot select filesystem paths or change original review files on the server.

The browser's original workspace adoption and the CLI's file adoption are distinct receiving surfaces over the same pure domain result. Their prepared result packets can be opened and checked independently through the original engine.

## Primary format references

- Microsoft, [Format numbers as text](https://support.microsoft.com/en-us/excel/format-numbers-as-text): preserve full identifier and decimal digits before numeric coercion.
- Microsoft, [Excel specifications and limits](https://support.microsoft.com/en-us/office/excel-specifications-and-limits-1672b34d-7043-467e-8e27-269d656771c3): worksheet and cell limits.
- openpyxl, [Optimised modes](https://openpyxl.readthedocs.io/en/stable/optimized.html): streaming complete workbook writes and read-only reopening.
- openpyxl, [Validating cells](https://openpyxl.readthedocs.io/en/stable/validation.html): native spreadsheet choice lists.

The domain definitions are supplied by the maintained original `supplier-report.mjs` recovery core, SHA-256 `989dade5e1ae1a37d2a62b568e2e5f5f18efb0e531ad573304c8a30f242899bd`, and its original CLI/UI source contract. Any successor core is joined by the same cumulative product publisher.

## Receiving the actual workbook cells

The browser and CLI send the exact retained `returned.xlsx` through the original Python reader before adopting a receiving packet. The complete parsed return must equal the original operation input, including row identities, reviewer, decisions, corrections and file identity. Matching packet hashes alone do not replace this check. CLI apply also reparses the XLSX from its retained review directory; customer export uses the same checked receiving route. Set `CONAPI_WORKBOOK_PYTHON` for the existing installed Analysis environment, or use `--python` on workbook review, apply and receive. The pure `receiveWorkbookDelivery(packet, {readWorkbook})` adapter requires that existing reader callback and retains the original supplier decision/replay engine.

## Complete original receiving continuation

`tools/receive_review_workbook.mjs` runs sequentially inside the maintained Conapi programme. It uses the genuine completed `examples/elite-reimport-workspace.json` (65,289 bytes, SHA256 `4020b1ee82e66b7b25886159248c92b7a1ee5006bc7fc71f698844e61a8924b9`), keeping its original 23 unchanged rows and complete source. The copied receiving case records explicitly attributed exercise decisions; it does not rewrite the supplier’s captured prices or capture dates.

Run with the actual installed dependencies and published complete-source commit:

```sh
node tools/receive_review_workbook.mjs --out /absolute/owned/workbook-operation --source-commit ACTUAL_COMMIT --node-modules /absolute/installed/node_modules --browser /absolute/installed/chromium --python /absolute/installed/python
```

An existing original local supplier server can be passed with `--url http://127.0.0.1:PORT/`; its served source bytes are compared before use. Otherwise the driver starts and closes the original CLI server once. It does not register a separate fleet job. A repeat invocation uses the same native state, source selection, browser profile and immutable outputs. Completed stage files are rechecked; a completed browser adoption is recovered from its retained original operation instead of creating another decision history. A packaging-only continuation reuses the final manifest without starting the application again.

The connected flow downloads the actual XLSX through the browser, fills and sorts its original rows with the existing openpyxl installation, preserves two actual intervening native decisions, resolves the one overlapping return in the browser, and adopts the reviewed output through the original engine. It then receives the complete packet in a fresh browser, uses the four CLI workbook commands, preserves a later local decision on same-operation replay, exports the full original supplier customer folder, and loads the accepted SQL into a real SQLite receiver. The final ZIP includes source, original input, both XLSX files, exact review/operation, complete workspace history, customer files, screenshots and the result manifest. Python, Chromium and Playwright are reused from the equipped owner’s installation.
