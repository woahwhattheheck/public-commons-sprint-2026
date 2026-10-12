# Geotech DTS8D legacy Excel receiving

The existing Laboratory application accepts an original Excel 97–2003 BIFF8
XLS workbook with the `geotech-dts8d` profile. It retains the complete binary
source, reads every original worksheet cell and physical formula record, and
uses the same field review, decision tables, paid file job and independent
result reader as XLSX. Native receiving creates a separately named XLSX.

The [official Enviro Data DTS8D specification, May 2026](https://geotech.com/documents/EnviroDataDTS8.pdf)
accepts `.xls` or `.xlsx`, requires the first and only worksheet, and specifies
the exact 150 first-row headers and one observation per following row
(pp. 12–15). Its discussion of the Value field explains why textual numeric
values can retain meaningful trailing zeroes. The
[official import FAQ](https://www.geotech.com/support/faq/joomfaq-using-enviro-data/faq-importing)
identifies `DTSFormat8.xls` and `SuccessfulImport8.xls` inside the receiving
Enviro/Edata8 installation. That installation supplies its lookup codes,
reference tables and chosen import options.

## Source and native output

| Original member | Complete retained source | Native receiving member |
| --- | --- | --- |
| `delivery.xls` | Exact original CFB/BIFF8 bytes, filename, size and SHA-256 | `delivery.xls.xlsx` |
| `folder/delivery.xls` | Exact original path and bytes inside its source archive | `folder/delivery.xls.xlsx` |
| `delivery.xlsx` | Exact original workbook and worksheet provenance | `delivery.xlsx`; the existing writer applies recorded literal choices |
| Supporting member | Exact original member in the source archive | Same supporting member and filename |

The prepared-file manifest records `sourceFile` with the original filename,
byte count and SHA-256, plus:

```json
{
  "from": "xls-biff8",
  "to": "xlsx",
  "profileId": "geotech-dts8d",
  "originalRetained": true
}
```

The result reader checks that binding against the complete original source
manifest, declared profile and exact native filename. The same check applies
independently to a baseline prepared archive. A resulting filename collision
is a native preparation error visible in the saved review.

The new XLSX contains the original or explicitly selected field values, cell
types, number formats, worksheet name, date epoch, hidden rows/columns and
physical blank rows. Original fonts, drawings, comments, workbook objects and
other binary details remain in the unchanged XLS container. Formula and error
cells become native literals through recorded choices. The original XLSX
writer continues to retain unchanged ZIP members and source bytes.

## Read and review a workbook

Use the installed `laboratory-edd` selection and its original
`--native --feature mcp --operator` runtime profile. Python 3.10 or later is
required. The complete pinned legacy reader ships with the source and requires
no package installation or external service.

```sh
starforge lab-edd inspect \
  --source /absolute/original/delivery.xls \
  --profile geotech-dts8d \
  --out /absolute/private/delivery-inspection.json

starforge lab-edd table \
  --source /absolute/original/delivery.xls \
  --profile geotech-dts8d \
  --scope all \
  --format tsv \
  --out /absolute/private/delivery-decisions.tsv

starforge lab-edd receive \
  --source /absolute/original/delivery.xls \
  --profile geotech-dts8d \
  --review dts8d-original-01 \
  --out /absolute/private/dts8d-original-01.zip
```

Extract the complete result and open `report.html`. Its records, cell details,
profile observations, lineage and decision controls refer to the same original
XLS. Use **Keep**, **Set exact value** or **Clear**, with a reason for a changed
field. Complete CSV/TSV tables use the existing source-bound decision format.

A calculated cell retains its raw BIFF formula record, token bytes, cached
result bytes, flags, worksheet/cell position, record offset and SHA-256. A
decompiled expression is an additional reading aid; the exact original record
remains available. The application reads stored values and reviewer choices.
It never evaluates a workbook formula.

**Keep** preserves a calculated or Excel-error source cell for further review.
An explicit **Set** or **Clear** resolves that cell for native literal delivery,
including a Set to the same visible cached value. Review/editor exports remain
available while native preparation requires a formula choice, valid header
layout or the first and only worksheet.

```sh
starforge lab-edd preview \
  --source /absolute/original/delivery.xls \
  --profile geotech-dts8d \
  --decisions /absolute/private/delivery-decisions.tsv \
  --format tsv \
  --out /absolute/private/delivery-preview.json

starforge lab-edd receive \
  --source /absolute/original/delivery.xls \
  --profile geotech-dts8d \
  --decisions /absolute/private/delivery-decisions.tsv \
  --format tsv \
  --review dts8d-reviewed-01 \
  --out /absolute/private/dts8d-reviewed-01.zip

starforge lab-edd result \
  --file /absolute/private/dts8d-reviewed-01.zip \
  --out /absolute/private/dts8d-reviewed-01-manifest.json
```

The result includes the native receiving ZIP and direct workbook download,
complete original binary input, source tables/cell provenance, normalized
decisions and their computed review. `native-preparation.json` lists each
completed conversion and its source binding. Copy the complete result to
another installation and use the original `result` command to reopen it.

For a checkout, replace `starforge lab-edd` with
`node stellar/scf-starforge-20261009/sf30-seller-sdk/lab-edd/cli.mjs`.
`LAB_EDD_PYTHON` selects the installed interpreter. `LAB_EDD_TEMP_ROOT` and the
job broker's `SF30_JOB_TEMP` select private scratch under the existing owner.

## Numeric, date and physical-row semantics

Original text cells retain their complete strings, including leading/trailing
zeroes, inequality characters, carriage returns and literal Excel escape
sequences. Original numeric cells retain their IEEE-754 bytes, round-trip
decimal representation, source style and number-format code. A binary number
has a different representation from laboratory-supplied text such as
`001.2300`; the original cell type remains explicit.

The original 1900 or 1904 epoch is carried into the native XLSX. Date serials
remain stored serials when unchanged. The existing date reader supplies a
calendar view for DTS date columns, with exceptional/invalid date state
retained in review. Explicit date choices use the same typed writer as XLSX.

Physical blank rows, hidden rows/columns, sparse missing cells, duplicate
sample/analysis indices and all five source limits remain in the source graph.
The existing DTS profile owns required fields, widths, numeric types, lookup
context, duplicate/reanalysis lineage and qualifier/limit interpretation.
Legacy intake changes the container decoder and declares its native reissue.

The data-only native path checks every original sheet and external workbook
reference. Unsupported older BIFF generations, encrypted compound files,
ambiguous workbook streams and malformed physical records have explicit input
errors. A readable source with native preparation observations retains the
complete editor and original files.

## Original paid function and merchant operator

The function remains `laboratoryReview` at `/laboratory-review`, with
`profile: "geotech-dts8d"`. Its existing source slot accepts
`application/vnd.ms-excel` and complete original XLS bytes, up to 16 MiB.
The optional baseline has the same allowance. The original decision and
correspondence slots retain their declared formats and sizes, and the complete
result remains the original ZIP byte output.

Use the existing 42-operation Laboratory MCP desk to select/upload source,
open its intake, review fields, save a decision edition, seal those exact
decision bytes, prepare/approve the original customer checkout, run or stop
the original task, download the native result and reopen its saved customer
edition. The existing task guards, process ownership and replay are preserved.

See [Applications](APPLICATIONS.md), the full
[Laboratory operator guide](../../../../stellar-forge/mcp-merchant-operator/LAB_EDD_WORKSPACE.md)
and [receiving guide](RECEIVING.md). The configured application source hash
includes this decoder, all ten original xlrd modules and the full license.

## Native format and whole CLI receiving

The maintained Python receiver opens the exact bundled upstream formula
workbook and generates a labelled 150-field DTS software-format fixture from
native BIFF records. It checks every original cell and formula binding, native
literal choices, all unchanged field values and types, text zeroes/CR/escapes,
the original 1904 epoch, hidden/blank rows and independent XLSX reopening.

Supply the existing Node executable to continue through the original complete
Laboratory CLI in the same operation:

```sh
python3 \
  stellar/scf-starforge-20261009/sf30-seller-sdk/lab-edd/workbook-legacy-receiving.py \
  --out /absolute/private/dts8d-legacy-receiving \
  --node /absolute/existing/node
```

The same command without `--node` performs the native format portion. The CLI
continuation uses `inspect`, complete editable `table`, `preview`, `receive`
and `result` against the original source. It keeps the complete 300-field
catalogue, records two explicit literals, exports and imports both complete
CSV and TSV representations, and reopens the initial and reviewed ZIPs through
the original result reader. Every prepared field is independently decoded.

The completed 2026-10-12 operation retained these actual outcomes:

| Operation | Retained outcome |
| --- | --- |
| Upstream original workbook | 3 worksheets, 6 source formula cells, exact original 16,896 bytes |
| Complete DTS format sources | 150 headers and 2 physical observation rows each, 1904 epoch, blank/hidden row retained |
| Original CLI workflow | 11 commands completed; 300 editable fields; full CSV and TSV round trips |
| Initial native output state | `REVIEW_REQUIRED`, with the original Excel error at cell N4 visible in review |
| Recorded literal choices | Description retains `reviewed\\rline\\n_x000D_`; value retains the exact text `001.2300` |
| Reviewed native output | `PREPARED`; exact `explicit-formula-values.xls.xlsx`, 4,989 bytes |
| Independent result reopening | Original XLS, all selected/native fields, source binding and complete conversion manifest matched |

The generated fixture also exercises incomplete required/reference fields.
Its recorded profile disposition is `CORRECTION_REQUIRED`, with 48 error
observations retained in the report; native literal preparation is recorded
separately as `PREPARED`. The recipient's reference tables and import choices
remain part of its own DTS receiving environment.

The [complete source and receiving delivery](../../../../deliveries/dts8d-legacy-excel-20261012/README.md)
contains the exact executable source used, full operator instructions, the
39-member native output archive and its complete member inventory. The archive
retains `cli-result.json`, original and reviewed result ZIPs, the full editable
tables, profile observations, native XLSX and offline report.

Outputs from the local command also contain the original upstream XLS and its
complete decoded cell graph, both generated format sources, source/received
tables, literal choices, native XLSX files and `result.json`. The source kind
and upstream identity are recorded. With `--node`, `cli-result.json` records the
complete original command sequence and source/review identities.

For the existing sealed-worker/browser workflow, copy
`receiving.legacy.example.json`, select the actual retained XLS input and source
receipt/decision document, then use `lab-edd-receive` as described in
[RECEIVING.md](RECEIVING.md). Original-format files retain their unchanged-byte
check; an XLS reissue uses its declared conversion binding and compares every
original or selected field after independent native reopening.

The format receiver can prepare its exact labelled source for that worker:

```sh
python3 \
  stellar/scf-starforge-20261009/sf30-seller-sdk/lab-edd/workbook-legacy-receiving.py \
  --fixture-only /absolute/private/generated-dts8d.xls
```

Use `sourceKind: "generated software-format fixture"` for this generated input.
A customer's original workbook keeps its own source kind, acquisition receipt,
field decisions, lookup environment and saved operation.

## Decoder source and redistribution

The parser is the complete unmodified
[xlrd 2.0.2 package at d8302dc39b16c03d643ef1eee89605c2e007ed2b](https://github.com/python-excel/xlrd/tree/d8302dc39b16c03d643ef1eee89605c2e007ed2b).
Its ten module identities and full license are in
[SOURCE.json](vendor/xlrd/SOURCE.json) and [LICENSE](vendor/xlrd/LICENSE).
A private module name binds the installed application to this exact package.

This product includes software developed by David Giffin <david@giffin.org>.
