# Customer Excel workbooks

Build an Excel workbook from complete results already retained in the customer
analysis workspace. A saved definition chooses the source export or published
report section for every worksheet, along with column order, headings, cell
types, null presentation and numeric precision. The finished delivery contains
the Excel file, its definition and the original typed source files.

## Install and open

Install the workbook extra in the same Python environment that runs the original
customer application:

```sh
python -m pip install '.[workbooks]'
python -m stellar_forge_buyer.analysis_workspace --database /private/customer/database serve --open
```

For an existing running workspace, reopen its original private launch link.
Its existing process owns the database and performs workbook jobs through the
same executor and activity history. Set `TMPDIR` to a private directory on a
volume with room for worksheet staging before starting that process when its
system temporary volume is small.

The **Workbooks** tab is the complete customer workflow:

1. Choose a complete query export or a published report section. The picker
   pages through the original retained history. Query exports must include
   their original typed JSONL output; the standard complete export selects it.
2. Add worksheets and choose their order. Each worksheet displays its retained
   source identifier, source digest, row count and available columns.
3. Choose column order, headings and cell mappings. Save a named definition.
   Every revision remains available, and a save compares against the loaded
   current revision.
4. Preview the saved cell projection. The preview identifies text, numbers,
   dates, blanks and explicit conversions for up to 20 rows.
5. Build the workbook and handoff. Progress and cancellation use the existing
   workspace job. The delivered workbook contains all selected source rows.
6. Open the completed delivery in history and download `workbook.xlsx`,
   `handoff.zip` or `manifest.json`. Reopening downloads the retained files.

The workbook uses neutral headings, frozen header rows, filter controls and
readable column widths. `Readme` explains recipient semantics; `Sources`
records each source, column mapping, null choice and precision choice.

## Cell mappings

| Mapping | Input and Excel representation |
| --- | --- |
| Native value | Original text stays literal text. Integers and finite numbers fit into Excel numeric cells when the precision policy permits. Binary and nonfinite values have explicit text representations. |
| Text | Keeps a textual representation, including leading zeros and strings beginning with `=`. |
| Integer | Accepts an original integer or an integer string. Values beyond 15 digits remain text with **Preserve**. |
| Number | Accepts a finite number or decimal string. **Preserve** retains values beyond Excel numeric precision or range as text. |
| Decimal text | Validates a finite decimal and keeps its exact original spelling and scale, including `599.010000`. |
| Boolean | Accepts a boolean, integer `0`/`1`, or text `true`/`false`. |
| ISO date | Accepts `YYYY-MM-DD`. Dates before 1900 remain text. |
| Timestamp → UTC | Requires an ISO timestamp with a timezone, converts supported values to UTC, and labels the Excel format UTC. |
| Local timestamp | Requires an ISO timestamp without a timezone. |
| Binary → Base64 | Encodes original binary bytes as Base64 text. |

**Preserve** is the default numeric choice. **Use Excel numeric precision** is an
explicit choice to write numeric cells with Excel's precision. Use **Decimal
text** for amounts whose original decimal scale is part of the deliverable.

Each column chooses an empty Excel cell or a text label for SQL null. The
default label is `NULL`. Excel can display an empty source string and an empty
cell alike; their original values and types remain in the included query JSONL
or published report JSON. The manifest also counts null, empty-string and
precision conversions for every output column.

The writer uses ISO date storage with the 1900 date system. Dates before 1900
and timestamps containing precision beyond milliseconds remain original text.
All strings are explicitly written as literal strings; formula text is retained
as data. Text exceeding Excel's 32,767 UTF-16-unit cell limit or containing
unsupported XML characters ends the job with a specific cell error.

Every worksheet supports 16,384 selected columns and 1,048,575 data rows plus
its header. Larger results continue on numbered worksheets. The writer checks
all final sheet names for collisions, including continuation sheets and the
reserved `Readme` and `Sources` sheets.

## Original result bindings

A query sheet binds the existing `query-export` job to its exact original
`QueryExport` manifest SHA-256. The original native reader verifies the typed
JSONL bytes and complete row count. The handoff includes every original output
selected for that export: JSONL, CSV and/or SQLite, with its original manifest.

A report sheet binds a published report ID, publication SHA-256 and section.
The original `AnalysisReports` reader verifies the publication, complete report
result and every section row. Its full original typed JSON export is included
once per publication, even when several workbook sheets use it.

Published report queries can return repeated column labels. Report selections
therefore preserve each column's original position. The browser displays
**Column 1**, **Column 2** and the original label; generated Excel headings are
made unique and remain editable. The `Sources` sheet records the one-based
input ordinal beside that label.

A headless report projection uses a zero-based `source_index` together with the
original `source` label. For example, two columns both labelled `amount` remain
separate with these mappings:

```json
[
  {"source": "amount", "source_index": 0, "header": "Principal", "type": "decimal-text"},
  {"source": "amount", "source_index": 1, "header": "Fee", "type": "decimal-text"}
]
```

A unique report label can still be selected by name. An ambiguous repeated
label requires its position, and a changed label at that position produces a
source error. Query-export recipes continue selecting their original named
columns.

The saved definition contains those bindings. Later changes to current views,
saved SQL or other reports leave the selected retained results available. A
changed source manifest or original report digest produces a source error.

## Headless customer delivery

`WorkspaceWorkbookClient` uses the current private launch record of the existing
workspace. It saves a definition, builds it, streams all three customer files,
receives the handoff and reopens the original typed sources.

Create a private recipe. Source IDs and digests come from the Workbooks picker
or its source API; use actual retained values in place of the example labels:

```json
{
  "name": "customer_operations",
  "expected_revision": 0,
  "title": "Customer operations",
  "notes": "Complete retained sales summary for the selected period.",
  "sheets": [{
    "name": "Sales summary",
    "source": {
      "kind": "query-export",
      "id": "EXISTING_32_CHARACTER_EXPORT_ID",
      "sha256": "EXISTING_64_CHARACTER_MANIFEST_SHA256"
    },
    "columns": [
      {"source": "region", "header": "Region", "type": "text"},
      {"source": "total", "header": "Total", "type": "decimal-text"}
    ]
  }]
}
```

```sh
chmod 600 /private/customer/workbook-recipe.json
stellar-forge-workbook-deliver \
  --database /private/customer/database \
  --recipe /private/customer/workbook-recipe.json \
  --operation /private/customer/workbook-delivery
```

The operation directory retains the exact save request and build ID before the
HTTP writes. Run the same command with the same recipe and operation directory
to recover a lost reply or interrupted client. The server returns the same
saved definition and workbook job. Completed files are reused after their byte
counts and SHA-256 values match the retained delivery.

The Python API is also available:

```python
from stellar_forge_buyer.workbook_client import WorkspaceWorkbookClient

client = WorkspaceWorkbookClient("/private/customer/database")
delivery = client.deliver(recipe, "/private/customer/workbook-delivery")
print(delivery["workbook"])
```

## Offline receiving and reopening

The handoff contains `workbook.xlsx`, `definition.json`, `manifest.json` and the
original source exports under `sources/`. The manifest binds their exact bytes
and records the completed row counts, physical worksheet names and mappings.

```sh
stellar-forge-workbook receive \
  --archive /private/inbox/handoff.zip \
  --sha256 EXPECTED_HANDOFF_SHA256 \
  --destination /private/inbox/customer-workbook

stellar-forge-workbook inspect \
  --delivery /private/inbox/customer-workbook \
  --manifest-sha256 EXPECTED_MANIFEST_SHA256

stellar-forge-workbook copy \
  --delivery /private/inbox/customer-workbook \
  --destination /private/customer/archive/workbook-edition-1
```

Receiving checks the exact member list and hashes while streaming into private
staging tied to the selected destination and archive. After complete inspection,
it atomically publishes the final directory without replacing an existing target.
A process interruption during extraction leaves the final destination absent;
receiving the same archive at the same destination reclaims its own unfinished
staging and completes the original operation. Its default decompressed byte limit is 1 GiB; set
`--max-bytes` to the reviewed size when receiving a larger handoff. Existing
destinations are preserved. Offline inspect and copy use the manifest and
original result files without needing the workbook-writing extra.

## Workspace API

These routes use the existing loopback server and its
`X-Analysis-Capability` header.

| Route | Behavior |
| --- | --- |
| `GET /api/workbook-sources?kind=query-export&before=SEQUENCE` | Page complete native query exports and their typed source bindings. |
| `GET /api/workbook-sources?kind=report&before=SEQUENCE` | Page published report sections. |
| `POST /api/workbooks/NAME` | Save a definition with `id`, `expected_revision`, title, notes and ordered sheets. |
| `GET /api/workbooks/NAME?revision=N` | Reopen a saved definition, digest and revision history. |
| `GET /api/workbooks/NAME/preview?revision=N&sheet=0` | Preview its saved typed cell projection. |
| `POST /api/start/workbook` | Build with `id`, `name`, `revision` and `definition_sha256`. |
| `GET /api/jobs/ID` | Read the existing job status, progress and complete result. |
| `GET /api/workbook-runs?before=SEQUENCE` | Page retained delivery history. |
| `POST /api/workbook-runs/ID/cancel` | Request cancellation of the selected running workbook. |
| `GET /api/workbook-runs/ID/file?name=workbook.xlsx` | Stream the original Excel file, handoff ZIP or manifest with its exact byte count and SHA-256 header. |

On process restart, the existing job log records interrupted work. The workbook
component adopts a complete retained delivery only after checking the saved
definition, every retained file and the complete ZIP. Interrupted incomplete
work remains visible in the original history; the customer can use a new build
ID for another attempt.

Writer API reference: [openpyxl optimized modes](https://openpyxl.readthedocs.io/en/stable/optimized.html)
and [date and time handling](https://openpyxl.readthedocs.io/en/stable/datetime.html).


## Recurring workbook editions

A recurring workbook keeps the existing workbook name and ordered worksheets
while replacing selected complete source results. Open a saved definition in
**Workbooks**, choose **Review newer sources**, then select the worksheet whose
source you want to update.

The source picker starts from that worksheet's recorded lineage:

- A query-export successor must be a newer complete export with exactly the
  same SQL and typed parameter values. Its title alone does not identify it.
  Saved-query edits need a separate query run and export before they can be
  chosen through the ordinary workbook editor.
- A report successor must be a newer publication of the same saved report and
  saved query. A uniquely occurring query may move to another section. If that
  query occurs more than once, the section position must also match.

**Find newer complete results** reads the retained results. **Older results**
continues the cursor through every eligible completed-result page. The comparison
shows old and new row counts, ordered column labels, added and removed labels,
SQL, typed parameters, bound views and immutable source versions. A newer result
may contain the same rows; the explicit selection records which completed
edition the customer intends to deliver.

### Review the source and column changes

Choose **Use this complete result** for each changed worksheet. The original
headers, formatting, null policy and precision policy remain in the editor.
Columns with a unique old and new label can be mapped by that label. A missing
or duplicate old label requires an explicit choice in **Source column**. Report
columns show their ordinal as well as their label.

For example, an old report might contain:

| Old source column | Workbook header | New source column |
| --- | --- | --- |
| `label [0]` | Domain | `domain [1]` |
| `label [1]` | Title | `label [0]` |

Choose each new source column explicitly. The editor cannot determine the
meaning of the two old `label` columns from their names. Added source columns
are available in the same picker; add a worksheet column when you want one in
the delivered workbook. Review its type, null treatment and precision policy
as part of that change.

Use **Keep original source and columns** to restore the selected worksheet.
Other worksheets can keep their prior complete results. Worksheet positions
stay fixed during an edition review so each before/after record has an
unambiguous counterpart. A normal workbook edit can change the worksheet
structure separately.

Add an edition note explaining the reporting period or source change, then
choose **Review selected sources and cells**. The review shows up to 20 actual rows per
worksheet, the projected cells, observed source types and conversion errors.
Correct any displayed mapping or conversion error and review again. This is a
preview: the complete workbook build reads and projects every retained row.
A conversion problem later in the result fails the build with its original
error in delivery history.

Choose **Save workbook definition** after the review is ready. The existing definition
compare-and-swap checks the expected head revision. If another operator has
saved meanwhile, reopen the current definition and review the intended change
against it. The new edition uses the original workbook build, progress,
cancellation, authenticated download and offline receiving controls.

The browser retains the draft review and pending save identity in its existing
workspace-specific local storage. Reconnecting after a lost save reply reuses
the same request. A successful save is a new immutable revision; an existing
revision and its completed delivery remain available through history.

### Headless edition delivery

The same operation is available through the existing client. Obtain the base
definition and its digest, discover the intended successors, and create this
private recipe shape using the actual IDs and mappings from those responses:

```json
{
  "base_revision": 1,
  "definition_sha256": "EXACT_BASE_DEFINITION_SHA256",
  "expected_revision": 1,
  "reason": "October reporting edition; reconcile renamed report columns.",
  "definition": {
    "name": "customer_operations",
    "title": "Customer operations",
    "notes": "Reviewed reporting edition.",
    "sheets": [{
      "name": "Sales summary",
      "source": {
        "kind": "query-export",
        "id": "EXISTING_NEW_COMPLETE_EXPORT_ID",
        "sha256": "EXACT_NEW_SOURCE_MANIFEST_SHA256"
      },
      "columns": [
        {"source": "region", "header": "Region", "type": "text"},
        {"source": "total", "header": "Total", "type": "decimal-text"}
      ]
    }]
  }
}
```

The proposed definition must contain all existing worksheets in their current
order. Include the original source and mapping for every worksheet being kept.
For a report column, include its actual `source` label and numeric
`source_index`; both are checked against the chosen section.

```sh
stellar-forge-workbook-deliver \
  --database /private/customer/database \
  --refresh-recipe /private/customer/october-edition.json \
  --operation /private/customer/october-edition-delivery
```

Or use the Python client:

```python
client = WorkspaceWorkbookClient("/private/customer/database")
delivery = client.refresh(recipe, "/private/customer/october-edition-delivery")
```

The client retains `review.json`, the exact reviewed save request, its stable
request ID and one build ID before sending the save. Run the same command with
the same recipe and operation directory after interruption. It resumes the
same saved edition and build, streams the complete files, verifies the retained
downloads, receives the handoff and writes `delivery.json`. A different recipe
requires a different operation directory.

### Refresh API and replay

| Route | Request or result |
| --- | --- |
| `GET /api/workbooks/NAME/refresh?revision=N&sheet=0&limit=25&before=SEQUENCE` | Source lineage, candidate comparisons, suggested mappings, unresolved columns and the next cursor. Omit `before` for the first page. |
| `POST /api/workbooks/NAME/refresh-review` | Recipe above; returns the normalized definition, per-sheet changes, actual cell previews, readiness and `review_sha256`. |
| `POST /api/workbooks/NAME/refresh` | The identical recipe plus a stable 32-character `id` and the returned `review_sha256`; saves through the original definition store. |

The server recomputes the source and mapping review before accepting its
digest. The digest covers the base definition, proposed definition, expected
revision, reason and complete before/after source bindings. Mutable current-head
display information is outside that digest so a reply lost after a committed
save can be recovered with its original request identity. Reusing that identity
for a different change is rejected.

### Complete handoff and historical reopening

A refreshed handoff contains the new Excel workbook, current definition,
complete current sources and the exact predecessor definitions identified by
its refresh history. The prior definitions live at
`history/definition-N.json`. Their complete original sources are retained under
the same `sources/` layout, with a shared source stored once.

Each refresh origin records the base revision and definition digest, the
reviewed change and its reason. The delivery manifest lists the retained
definition history and hashes every included file. Offline inspect follows
the descending history chain and checks each exact definition. A sequence of
refreshes carries that chain back to its original saved definition. An ordinary
manual save starts its own subsequent refresh chain; other saved revisions
remain available in workspace history.

Use a receiver containing this edition feature for these extended handoffs.
Excel itself opens the generated `.xlsx` normally. The original earlier
workbook and archive retain their prior bytes and can still be received or
reopened independently.
