# Workbook Exchange

Workbook Exchange extends the existing ATSSC questionnaire workspace with typed original-cell inspection, source-linked answer extraction, and editable XLSX editions. Its operator page is /workbook-exchange. It uses the retained workbook BLOBs, original questionnaire definitions, publication/respondent identifiers, and the existing native journal.

## Open the operator

Start the original server and open its normal operator session. Follow **Workbook Exchange**, select a retained original workbook, and inspect a worksheet/range. Visible and hidden sheets use the same source reader. The sheet selector shows their original state.

The cell grid distinguishes absent cells, physical blank cells, explicit empty text, exact decimal values including zero, Boolean values, dates, formula expressions, formula caches and original Excel error cells. The original names, styles, validations, rows, merges, protection and other workbook structures are available beneath the grid.

An unchanged download returns the retained XLSX bytes and their original SHA256. The original workbook remains available after every successor edition.

## Create an editable Excel edition

Select an original answer cell, choose its explicit value type, and add it to the reviewed change selection. A blank cell and an absent cell are separate choices. An empty text value is an inline string with an empty text node. Exact numbers are entered as decimal strings. A text value beginning with an equals sign remains text.

**Retain and download Excel edition** writes the selected changes into the existing worksheet XML and copies every other workbook member unchanged. Styles, relationships, hidden sheets, report-mapping sheets, shared strings, embedded objects and original formula/cache bytes remain in the source layout. The returned manifest links each edited cell to its complete before/after state, original workbook identity and successor identity.

Formula cells and array/data-table formula ranges belong to the existing calculation workflow. Merged answer ranges use their first cell. These rules prevent an answer edit from destroying a formula group or becoming invisible beneath a merged cell.

The resulting input edition is ready for the existing native calculation workflow. In Workbooks, choose **Calculate native workbook**, or choose **Submit workbook revision** for the respondent's returned workbook. Calculation retains its output through the original import_workbook operation, after which the same exchange reader inspects that calculated edition and its caches.

## Bind answers to the original template

Definitions remain the editable definitions of the original questionnaire application. exchange_mapping projects their exact workbook SHA, sheet/cell or table-row/column bindings. It includes disclosure, calculated fields, fixed source values, workbook scale, complete explicit row positions and overlapping scalar bindings.

exchange_extract selects one original template identity and one retained input or calculated workbook edition. It returns the native answers, validation, publication identity and complete source-cell records. Source rows retain stable identities based on the original template, worksheet, question and physical row. Explicit source.rows selections keep every row position, including cleared rows and gaps such as 40, 44 and 48. The complete cell records preserve absent, blank, empty text and zero independently of the native answer validator's normalized values.

A formula expression and its cached value are different source fields. The default extraction leaves formula values for calculation review. formula_values: "cached" selects the retained edition's caches; original error caches and missing caches appear as source-specific validation issues.

For a questionnaire spanning several original workbooks, select template_sha256 explicitly for each extraction. A respondent extraction merges the selected workbook's answers with its retained answers from the other originals. The original project_answers function supplies numeric scaling and Excel date conversion. Fixed source labels are checked against the retained template. Formula-derived fields remain separate computed values and use the original native calculation workflow when a response is submitted.

**Download Excel and complete source records** creates the internal extraction package. Its Excel file has the full question mapping, source-cell records, validation rows and original source identities. Its JSON companion retains the complete typed states and validation structure. The Excel register uses the existing respondent_operations.make_xlsx writer. Exact values and formula expressions are represented as source records, preserving empty, zero and raw lexical distinctions alongside their explicit type columns.

## Native methods

All methods run through the original Workspace.invoke and operator /api/invoke.

| Method | Required input | Result |
| --- | --- | --- |
| exchange_inspect | sha256; optional sheet with cells or range | Workbook structures and exact cell states |
| exchange_download_original | sha256 | Unchanged original XLSX bytes, source URL and SHA |
| exchange_mapping | questionnaire_id and optional version, or publication_id, or respondent_id | Source mapping from the selected original definition |
| exchange_extract | Definition/publication/respondent selector, sha256, and original template_sha256 when needed | Native answers, source cells, source-row identities and validation |
| exchange_extract_file | Same as extraction | Complete editable JSON extraction file |
| exchange_extract_package | Same as extraction | Internal Excel extraction, complete editable JSON and file manifest in one ZIP |
| exchange_export | sha256, explicit changes; optional retain (default true) | Original-format XLSX successor and full change manifest |
| exchange_export_answers | Definition selector, original template_sha256, answer map; optional source sha256 | Bound scalar/table answers written into the original XLSX layout |

Download methods return name, mime_type, bytes, sha256, data_base64 and metadata. A receiving client decodes the base64 bytes and compares the byte count/hash. The browser performs the transfer from the original scoped operator session.

### Explicit cell selection

Use source coordinates actually read from the original workbook:

    {
      "sha256": "<retained original SHA256>",
      "changes": [
        {
          "sheet": "<original worksheet name>",
          "cell": "<original answer cell>",
          "kind": "number",
          "value": "0",
          "expected_cell_identity": "<identity from exchange_inspect>"
        }
      ],
      "retain": true
    }

Supported kind values are text, number, boolean, date, blank, and absent. Blank may explicitly retain an empty value node with value_node_present: true. Duplicate edits to the same original cell are rejected before export.

### Bound answer export

Scalar answers use their original question IDs. Tables use explicit original source rows:

    {
      "questionnaire_id": "<existing questionnaire ID>",
      "version": 1,
      "template_sha256": "<definition source workbook SHA256>",
      "answers": {
        "<table question ID>": [
          {
            "source_row": 42,
            "values": {
              "<original numeric column ID>": "0"
            }
          }
        ]
      }
    }

The selected source row must be a member of the definition's exact original row selection. Omitted table cells remain unchanged; clear a selected cell explicitly with null. A supplied source_row_identity must match the selected original template and row. A fixed original label may be included unchanged, and a change to it is rejected. The retained response writer's _answer_record conversion preserves original percentage scaling and Excel date serials. For example, a percentage field with workbook_scale: "100" writes an entered 12.5 as original numeric 0.125 while keeping its original percentage style.

## Compose with the maintained application

The four implementation files are additive: workbook_exchange.py, workbook_exchange.mjs, workbook_exchange.html, and workbook_exchange.css.

Add "workbook_exchange" to the existing EXTENSION_MODULES tuple in questionnaire_workspace.py. The module exports the maintained OPERATIONS mapping, and its handlers receive the original Workspace from that router. Preserve the existing respondent_operations, reporting_workbench, workbook_calculation and workbook_intake entries.

    EXTENSION_MODULES = (
        "respondent_operations", "reporting_workbench",
        "workbook_calculation", "workbook_intake", "questionnaire_locale",
        "source_formula", "workbook_exchange",
    )

Each retained exchange runs one original _write transaction, including the successor workbook insert and the export manifest. It therefore shares the core's stable request-ID replay and collision behavior.

In the original server's existing do_GET, after its normal local-host check, serve:

- /workbook-exchange from workbook_exchange.html;
- /workbook_exchange.mjs as JavaScript;
- /workbook_exchange.css as CSS.

All workbook exchange RPC methods stay in the original operator route. The existing respondent allowlist does not expose them. Add a link to /workbook-exchange in the current workbook operator panel.

The current one-shot CLI can import ExchangeError and include it alongside OperationError in its existing JSON error handler. Its JSON-line RPC already handles structured exceptions.

The original project exporter includes these source files, the complete SQLite database and the original access-code files. Full project archives therefore carry the same exchange implementation and source workbook BLOBs into cold receiving.

## Source preservation

The imported original remains the authoritative retained input. Export validates its expected SHA before touching a cell. Each unselected ZIP member must have the same bytes/hash in the exported edition. The original worksheet XML is spliced at parsed cell boundaries, preserving namespace declarations, extension metadata and untouched rows/cells. New physical cells are inserted in numeric row/column order.

Workbook calculation uses the maintained native calculation workflow. The internal extraction package consumes those same source-cell records through the existing operating workbook writer. Public and protected respondent documents retain the original reporting workbench's mappings and disclosure decisions.

## Complete retained-customer operation

Run the full five-family programme on an independently received complete project:

    python application/WORKBOOK_EXCHANGE_CUSTOMER.py --workspace workspace

The programme uses the case's existing complete family definitions, publications and original entered plan. It retains all prior workbook BLOBs, calculation jobs, revisions and reports, then appends its source-linked exchange respondents and native editions in the same authority. Its output is saved under `workspace/source-evidence/workbook-exchange-customer`, including all original/input/calculated workbooks, complete mappings and four-sheet extraction packages, typed source records, native review findings and paired reports. Exact requests resume the retained edits and revisions.

The original text kind takes precedence over a numeric display format when an unlocked original cell already contains text, with original validations and explicit classifications taking precedence. For the retained domestic-producer source, the programme appends its complete kind-corrected definition/publication under the original questionnaire ID. Original definitions, publications, records and files remain retained alongside the successor.

Original formula errors and no-data markers remain typed review findings under `validation.formula_issues` and in the register's Validation worksheet. They are distinct from entered-answer validation issues. Selecting cached values uses the actual retained calculated edition; missing caches remain pending calculation. The complete JSON companion retains every original issue, value and source coordinate.

The four-sheet register uses readable wrapped columns, retained identifiers, filters and frozen source keys. Metadata counts, physical rows and Boolean states retain their native Excel types; exact source lexical values and formula expressions remain text beside their explicit source type. The original-format input and calculated workbooks remain the authority for calculation.

## Native original-source operation

WORKBOOK_EXCHANGE_EXERCISE.py receives the exact published Annex ZIP, retains every original workbook, operates all five source families through the native exchange, and saves complete successor workbooks/manifests. It checks the full original formula/error/hidden-sheet totals from the actual files, then cold receives the native project and reopens its retained original and successor editions.

The programme is one local customer operation. Its output directory contains the original-source manifest, all selected-cell records, the native result, the retained SQLite case and the complete project archive. Keep the full project with its operator/respondent access files in the private customer handover.

## English and French operator display

The exchange uses the existing `locale.mjs` language preference and display binding, including the same operator preference in the original SQLite workspace. The Language / Langue control updates its labels in place. Workbook names, worksheet names, original values, formula text, entered edits, selected files and the selected source mapping keep their original values. The exchange supplies its own bilingual wording through the existing `authoredText` interface, so its source addition does not replace the shared interface dictionary.

The exercise keeps stable original request identifiers for imports, publications, invitations, revisions, reviews and exchange writes. On resumption it verifies an already saved project archive and exact received members before reopening the original workspace. `NATIVE_PROGRESS.json` and `NATIVE_RESULT.json` are atomically replaced within this operation's own output directory.

The existing project receiver now retains the verified `START_HERE.md` and `HANDOVER.json` beside the original application and workspace directories. Both files are checked against the original project manifest before installation, and are included in the resumed receiving comparison. This carries the operator’s opening instructions and complete customer inventory into the independently received copy.
