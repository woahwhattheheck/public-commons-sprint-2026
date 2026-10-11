# Workbook intake in the retained dataset publisher

This module feeds the existing SF30 dataset-refresh workspace. It retains the original XLSX and reviewed mapping, prepares the original typed CSV candidate, and uses the existing versioned seller for publication and customer preparation. It does not execute formulas, macros, external links, or another seller.

## Runtime

Workbook extraction uses a bundled Python 3.10+ standard-library program. The existing Node 22.16+ workspace uses its configured `--workbook-python` executable (default `python3`). Ordinary CSV, publication, version inspection, and buyer operations keep their current Node-only path. No workbook library or dependency installation is required.

The native worker receives the already-open private source file on descriptor 3. Prepared CSV and source-row map go to separately created exclusive descriptors 4 and 5. JSON input contains decisions and source identity; it cannot choose a filesystem path. Output is bounded metadata. The original workspace lock and action serialization own all state changes.

## Source and plan

An uploaded source is immutable: `id, filename, sha256, sourceBytes, createdAt, revision, workbook, plans`. Workbook metadata contains the exact epoch, original calculation properties, actual sheets and their names/state/part/dimensions, hidden rows/columns, merged ranges, observed cell/formula/error counts, and internal/external-link counts. Original number tokens and identifiers stay strings in source inspection.

A plan is a named, versioned decision record:
```json
{
  "name": "Reviewed public data",
  "notes": "",
  "sheet": "2023",
  "range": "A1:D40",
  "headerRow": 1,
  "hiddenRows": "include",
  "blankRows": "skip",
  "mergedCells": "reject",
  "columns": [
    {
      "name": "public_column",
      "source": "A",
      "blank": "reject",
      "formula": "reject",
      "error": "reject",
      "date": "raw",
      "trim": false,
      "valueMap": []
    }
  ]
}
```
Public column names, types and nullability come from the exact running generation. Each must have one explicit source column within the selected range; columns outside this public projection never enter the CSV. Header row is an original worksheet row or null for no header; data starts on the following row when a header is selected. Duplicate original labels remain distinguishable by column coordinates.

Decisions:
- `hiddenRows`: include or exclude, both explicit.
- `blankRows`: keep or skip; a row is blank only when all selected original cells have no value/formula, before transformations.
- `mergedCells`: reject or anchor. Anchor keeps the original top-left cell and leaves the other original coordinates empty; no fill-down is invented.
- `blank`: reject, null (only nullable native columns), or empty (only nonnullable native strings). The original nullable CSV contract maps the empty field to null.
- `formula`: reject, cached, or text. Cached uses only the original saved result; a missing cache is a cell-level error. Text keeps the original equation only when that cell actually contains its equation, and requires a string target.
- `error`: reject, text (string target or explicit value mapping), or null (nullable target).
- `date`: raw, iso-date, or iso-datetime-ms. Raw preserves the original serial or ISO token. Calendar conversion uses the workbook's actual 1900/1904 epoch; fictional 1900-02-29 is refused. Date-only conversion refuses a time fraction. Datetime conversion explicitly rounds fractional days to the nearest millisecond, half even, and invents no timezone.
- `trim` is an explicit text transformation; default false.
- `valueMap` is an ordered list of unique `{from,to}` values, where to is a literal string or null. It is not a formula or expression.

Native integers retain the existing safe-integer boundary. Long identifiers belong in original string columns; the extractor never silently turns them into JavaScript numbers. Original number fields keep the existing native finite-number semantics; inspection retains the literal source token beside that declared type.

## Existing workspace API additions

All calls use the original local Host/Origin and Bearer session checks. Mutations remain serialized by the same process and kernel-owned workspace lock.

- `PUT /api/workbook`: original XLSX bytes, XLSX MIME, percent-encoded `X-Upload-Name`; returns retained source and workspace view. Capacity counts original workbook bytes alongside retained CSV and row maps.
- `POST /api/workbook/inspect` `{id,sheet,range,offset,limit}`: exact selected-source metadata and bounded original cells. Offset pages worksheet rows within the range, including explicit missing cells. Limit 1–100; at most 64 columns.
- `POST /api/workbook/plan` `{id,planId,expectedSourceRevision,expectedPlanRevision,plan,expectedSnapshot,expectedRevision}`: create/update the reviewed mapping against the exact displayed current native schema. New plan uses null planId/expectedPlanRevision. Returns the saved source/plan and current workspace.
- `POST /api/workbook/prepare` `{id,planId,expectedPlanRevision}`: retain source identity and parser identity; prepare exclusive CSV/row-map/config files; validate with original loadDatasetConfig; adopt once through original drafts.adopt. Return the ordinary selected native draft and original status. Reusing the unchanged source/plan/native schema returns its already-retained candidate rather than duplicating it.
- `POST /api/workbook/download` `{id}`: exact original bytes.
- `POST /api/workbook/remove` `{id,expectedSourceRevision}`: explicitly remove an unused source; refuse while retained candidates still reference it.
- `POST /api/workbook/export` `{candidateId}`: private ZIP with original workbook, exact CSV/config, frozen mapping/source and parser identities, complete source-row map, original candidate/publication review, and manifest. Members are original.xlsx, data.csv, dataset.json, workbook-projection.json, source-rows.jsonl, workbook-parser.py, candidate.json, review.json and manifest.json. This is private merchant handoff; only the chosen CSV enters the public dataset.
- `GET /api/status` additionally returns `workspace.workbookSources`, `workbookRuntime`, and exact current `workbookSchema` for mapping. Responses with original `status` also return that version's `workbookSchema`.

Existing /api/draft, /api/preview, /api/publish, /api/activate, /api/buyer-offer and /api/buyer-prepare retain their contracts. Existing candidate summaries include optional `workbookSource`; candidate export includes the same immutable origin. Publication still requires the original reviewed expectedSnapshot/expectedRevision and native full-contract check.

## Source-version operation

Upload the changed workbook as a new immutable source. Inspect its actual sheet/range and explicitly copy/review the prior mapping into a new plan. The previous source, plan editions, candidate, published generation, buyer files and native cursor remain retained. A status refresh never silently rebases a plan or publication expectation.

## Original format references

- Microsoft Open XML CellValue: https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.spreadsheet.cellvalue
- Shared string table: https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/working-with-the-shared-string-table
- Excel epochs and date limitations: https://openpyxl.readthedocs.io/en/stable/datetime.html

The original Census 2023 jam-value workbook is a public input for the joined operating example. It is not merchant/customer acceptance or a new paid transaction.
