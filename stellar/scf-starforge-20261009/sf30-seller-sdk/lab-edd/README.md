# Laboratory EDD receiving

Receive the complete original laboratory delivery, review its native records and
relationships, record explicit field decisions, and deliver the receiving files
with a portable operator report. The same application runs locally or through the
maintained sealed-file paid-job service.

The result is one archive containing the exact original inputs, every decoded
field and worksheet representation, the computed profile observations, complete
lineage, editable decisions, prepared native files, and a self-contained browser
editor. The original job runtime supplies file selection, sealing, canonical
request identity, payment, execution and result recovery.

## Source profiles

| Profile | Original input | Native output | Receiving contract |
| --- | --- | --- | --- |
| `equis-lab-3` | Original ZIP containing sample, test-batch and combined test/result/QC CSV members | Complete original file family with explicitly selected field edits | EQEDD-family laboratory review, preserving source sample and analysis keys |
| `equis-lab-4` | Original ZIP containing sample, test, result and batch CSV members | Complete original four-file family with explicitly selected field edits | EFWEDD-family laboratory review, including exact sample/test relationships |
| `geotech-dts8d` | Original XLSX workbook, optionally with retained supporting members in a ZIP | Native XLSX under the original filename | Enviro Data DTS8D, May 2026: one worksheet and all 150 exact ordered headers |

McCampbell Analytical publishes the two example CSV families on its
[EDD page](https://www.mccampbell.com/edds.php):
[three-file source ZIP](https://www.mccampbell.com/EDDs/Equis3.zip) and
[four-file source ZIP](https://www.mccampbell.com/EDDs/Equis4_CSV.zip).
The complete original examples, their HTTP retrieval and member hashes, and the
actual full-cohort model result are bundled in
[`examples/mccampbell`](examples/mccampbell/README.md). The supplied receiving
configuration selects those exact bytes. A new laboratory delivery uses its own
retained original file and source receipt.

The EQuIS profiles follow the published
[EQEDD](https://help.earthsoft.com/lib_eqedd_format.htm),
[EFWEDD](https://help.earthsoft.com/lib_efwedd-format.htm) and
[qualifier](https://help.earthsoft.com/qualifiers.htm) contracts. They check the
selected family structure, complete source references, duplicate versions, the
detected target/TIC result-value rule, and supplied QC recovery/RPD values against
their actual supplied limits. Source laboratory qualifiers and all original
limits remain available throughout review. A receiver's selected
[EDP format and reference values](https://help.earthsoft.com/edp.htm) supply its
final format-specific import checks.

The DTS profile implements the official
[Version 8D field specification](https://geotech.com/documents/EnviroDataDTS8.pdf).
It retains the complete sample and analysis identities, sample-only records,
duplicate and superseded indices, all five limits, qualifiers, source dates and
worksheet cell representations. The profile lists the actual source pages for
each field and observation. The native workbook route accepts XLSX. Save a legacy
XLS source as XLSX in its original spreadsheet application before selecting this
route; retain the original XLS alongside that supplied workbook when relevant.

## Run a complete receiving result

Use the supplied source-pinned `@tokenjunkielabs/starforge-merchant`
distribution containing this product. The source-owned registration adds
`starforge lab-edd` and `starforge lab-edd-receive`.
Node 22 or newer runs the application. The DTS workbook profile also uses Python
3.10 or newer with its standard library and the existing maintained workbook
reader. The EQuIS CSV profiles need no Python process.

```sh
starforge lab-edd profiles

starforge lab-edd inspect \
  --source /absolute/Equis4_CSV.zip \
  --profile equis-lab-4 \
  --out /absolute/private/source-inspection.json

starforge lab-edd receive \
  --source /absolute/Equis4_CSV.zip \
  --profile equis-lab-4 \
  --review delivery-01 \
  --out /absolute/private/delivery-01.zip

starforge lab-edd result \
  --file /absolute/private/delivery-01.zip \
  --out /absolute/private/delivery-01-manifest.json
```

From a checkout, replace the installed command with
`node stellar/scf-starforge-20261009/sf30-seller-sdk/lab-edd/cli.mjs`.
The source tree and installed distribution preserve the same paths and original
runtime dependencies.

Each output path is exclusive: select a new output file for a new receiving result.
The `result` command reopens an existing archive and checks every retained
member against its manifest, including each original input and prepared native
file. The full archive can be copied to another machine for receiving.

Set `LAB_EDD_TEMP_ROOT` to an existing writable private filesystem when the
system temporary directory is unsuitable. The application creates and removes
only its own temporary subdirectory. Set `LAB_EDD_PYTHON` to the installed
Python executable when it is not available as `python3` on PATH.

The supplied paid-job merchant declares `LAB_EDD_TEMP_ROOT`, `SF30_JOB_TEMP`
and `LAB_EDD_PYTHON` as its required worker environment. Set both temporary
roots to the selected writable private scratch directory and select an actual
Python executable (`python3` or its absolute installed path). The maintained
receiving driver supplies these values from its scratch and interpreter choices.
The original native-process broker owns workbook subprocess retirement and its
private scratch when the application runs as a file job.

## Review and change exact fields

Extract the complete result archive and open `report.html`. The report includes
paged records and observations, source/row identities, original cell details,
full lineage, and exact native downloads. The editor offers **Keep**, **Set exact
value**, and **Clear** for each field. A changed field requires a reason; an explicit
Keep reason remains a saved decision. The computed profile summary belongs to
the completed result. Draft changes produce a new decision document to run against
the same original source.

The editor downloads complete decision JSON and CSV, and reopens a saved JSON
document. The CLI also exports and imports full editable CSV and TSV tables:

```sh
starforge lab-edd table \
  --source /absolute/Equis4_CSV.zip \
  --profile equis-lab-4 \
  --out /absolute/private/decisions.tsv \
  --scope issues

starforge lab-edd preview \
  --source /absolute/Equis4_CSV.zip \
  --profile equis-lab-4 \
  --decisions /absolute/private/decisions.tsv \
  --out /absolute/private/reviewed-preview.json

starforge lab-edd receive \
  --source /absolute/Equis4_CSV.zip \
  --profile equis-lab-4 \
  --review delivery-02 \
  --decisions /absolute/private/decisions.tsv \
  --out /absolute/private/delivery-02.zip
```

Use `--scope all` for every selected source field and `--fields field_a,field_b`
to select complete columns. The default issue table includes every actual issue
target and each existing explicit decision. Both table formats include their
source-binding row even when the decision set is empty.

A decision document binds:

- The selected profile ID and version and the complete original source SHA256.
- The original record ID, row hash, native field key and exact before-value.
- One action per source field, its exact replacement when applicable, and its reason.

The source SHA256 binds the complete input member names, original byte hashes,
profile version and selected text encoding. It differs from the enclosing ZIP's
own byte hash. Keep both identities in acquisition and receiving records.
Row hashes retain original cell strings and workbook provenance. Clear and Set
with an empty string remain distinct documented actions.

Original headers, field ordering and every unassigned supporting source member
remain retained. CSV output keeps the original delimiter, text encoding and
newline convention; changed files are serialized from the full original row
sequence. An unchanged member is returned byte for byte. UTF-8 is the default;
select `--encoding windows-1252` only for a source actually using that encoding.

For a DTS workbook, native reissue retains all original ZIP parts and unchanged
cell values. It writes only the selected literal cells, preserving the original
date epoch and worksheet identities. Original formulas and error cells require
an explicit recorded literal decision before native preparation. Completed
literal replacement removes obsolete calculation-chain declarations. Blank,
duplicate or out-of-order headers and multiple worksheets remain visible in the
review; native DTS receiving still requires its documented ordered one-sheet
layout.

## Native preparation state

The result's `native-preparation.json` and manifest report either:

| State | Available result |
| --- | --- |
| `PREPARED` | Complete native files, original source, review, decisions, lineage and editor |
| `REVIEW_REQUIRED` | Exact native preparation refusal and its source/cell details, plus the complete original source, review, decisions, lineage and editor |

A native rendering refusal therefore leaves a usable review. Correct the source
layout in its originating application when necessary, or export explicit field
decisions and rerun the original source. The preparation state and the profile's
computed observations are separate: a syntactically produced receiving file can
still carry issues that the receiving operator must address.

## Reissued deliveries

Supply `--baseline /absolute/earlier-original.zip` during preview or receive.
Both inputs use the same selected source profile. Comparison groups records by
the profile's complete native identity and retains every version of an ambiguous
duplicate. The full comparison records added, removed, changed and unchanged
identities together with their exact original fields and cell provenance.

The application keeps blank nondetect result values, every reported threshold and
its unit, detection flags, laboratory qualifiers and supplied QC metrics. It
never substitutes an inferred concentration for a reported blank. A conversion
or correction requires explicit source-bound decisions for its affected fields.

## Existing Request and sealed-file jobs

`merchant.example.json` declares `laboratoryReview` in the maintained
paid-job ABI. Select its actual public origin, network, asset, receiving address
and price through the existing merchant setup before offering the paid service.
The sample contains explicit demonstration payment values.

| File slot | Contract | Size |
| --- | --- | --- |
| source | Complete original delivery ZIP or DTS XLSX | Up to 16 MiB |
| baseline | Optional earlier delivery in the same profile | Up to 16 MiB |
| decisions | Optional source-bound JSON, CSV or TSV | Up to 4 MiB |

The original slot policy limits the combined request to 36 MiB. The JSON request
selects `profile`, `reviewName`, optional source SHA256, encoding and editable
table scope. The original input engine owns `$files`; use its file-selection,
upload and sealing APIs rather than writing file descriptors by hand.

The worker returns `application/zip` through the existing bytes-output contract.
Its declared worker heap is 768 MiB, output allowance 64 MiB and execution timeout
ten minutes. The source decoder retains up to 128 members, 100,000 rows and 512
columns within its declared complete-source limits. The complete private job
runtime supplies resource admission and execution recovery.

## SDK

```js
import { inspectDelivery, normalizeDecisions, previewDelivery,
  renderPreparedFiles, compareDeliveries } from
  '@tokenjunkielabs/starforge-merchant/seller/lab-edd/model';
import { labProfile } from
  '@tokenjunkielabs/starforge-merchant/seller/lab-edd/profiles';
import { reviewTable, parseReviewTable } from
  '@tokenjunkielabs/starforge-merchant/seller/lab-edd/decisions';
import { laboratoryReview } from
  '@tokenjunkielabs/starforge-merchant/seller/lab-edd';
import { readLabResult } from
  '@tokenjunkielabs/starforge-merchant/seller/lab-edd/result';

const delivery = await inspectDelivery(originalFiles, labProfile('equis-lab-4'));
const decisions = normalizeDecisions(delivery, savedDocument);
const preview = previewDelivery(delivery, decisions);
const table = reviewTable(delivery, decisions, { format: 'tsv', scope: 'issues' });
const reopened = parseReviewTable(delivery, table.text, { format: 'tsv' });
const nativeFiles = await renderPreparedFiles(delivery, preview);
```

`originalFiles` contains exact `{filename, bytes: Uint8Array}` members.
`laboratoryReview(input, context)` receives the maintained worker's
`context.files`, signal, job ID and original native-process client. Native
profile hooks receive that optional `processes` client through
`inspectDelivery(..., {processes})` and
`renderPreparedFiles(..., {processes})`. It produces the complete portable result;
the lower-level rendering API reports its native format refusal directly.

## Complete maintained receiving operation

[RECEIVING.md](RECEIVING.md) describes the original worker, same-request replay,
whole native file verification and desktop/mobile editor operation. Its
`receiving.mjs` accepts the actual retained supplier files and resumes one
private operation. The examples select the two published McCampbell families or
one original DTS workbook. Each completed receiving edition retains its exact
original source, selected format and full operator choices.

## Complete cross-profile receiving

[RECONCILIATION.md](RECONCILIATION.md) describes the full EQuIS3/EQuIS4 source comparison, explicit correspondence, independent source-field editors, both native outputs, installed CLI/SDK and the complete original-file receiving configuration. Use `baselineProfile`, the `baseline_decisions` slot and the `reconciliation` slot with the original `laboratoryReview` job. The source-bound result reopens both original families and every corresponding native member.
