# Accountant handoff and return contract

`engine.mjs` is the accountant adapter for the original merchant settlement accounting workspace. A handoff retains a completed original reconciliation and optional original recorded-activity close. An accountant receives its CSV, adds external book references, statuses, account codes and notes, and returns that same template. Each saved return is a complete immutable revision of those external assignments, including any conflicts and omitted rows.

The original report remains the source for amounts, network, selected payment option, transfer evidence, delivery classification, source time and quoted USD. The adapter reads those records directly. The original period module owns selection and closing; the accountant adapter consumes its saved snapshot and hash.

## Pure API

All functions are synchronous, use Node built-ins, and perform no disk or provider operations. The existing workspace owns private source capture, request revisions, file persistence, downloads and idempotent save receipts.

```js
import {
  createHandoff, importReturn, inspectHandoff, renderCsv, renderHtml,
  validateHandoff, validateRevision, parseReturnCsv,
  HANDOFF_SCHEMA, RETURN_SCHEMA, CSV_COLUMNS,
  PROTECTED_COLUMNS, EDITABLE_COLUMNS, EXTERNAL_STATUSES,
} from './engine.mjs';

const handoff = createHandoff({
  id, name, actor, createdAt,
  reportBytes,
  source: {
    runId, reportSha256, manifestSha256, inputManifestSha256,
    // Optional original saved close:
    periodClose: { id: closeId, revision: closeRevision, sha256: closeFileSha256 },
  },
  periodCloseBytes,
  labels: [{ optionId, assetLabel, unitLabel, accountCode, accountName }],
});

const csvBytes = renderCsv(handoff);
const revision = importReturn({
  id: importId, name: importName, actor, createdAt,
  handoff, csvBytes: returnedCsvBytes,
  parentRevision: previousSavedRevision ?? null,
});

const completeCurrentCsv = renderCsv(handoff, revision);
const offlineHtml = renderHtml(handoff, revision);
const inspection = inspectHandoff(handoff, revision);
```

`id` defaults to a new UUID; `createdAt` defaults to the actual current ISO timestamp. Workspace previews pass the same proposed ID and timestamp to the explicit save so the saved revision digest exactly matches the review. `name` is at most 160 characters; `actor` at most 1,000. All source hashes are lowercase SHA256. `reportBytes` and `periodCloseBytes` accept a Buffer, Uint8Array or UTF-8 string; every supplied source is checked against its retained exact-byte hash.

`source.periodClose` may be absent or null; its bytes must then be absent or null. With a close, the original snapshot's ID, revision and hash are required. Its schema must be `stellar-forge.merchant-period-close.v1`; its ID, positive integer revision, run ID, report hash and input-manifest hash must match the selected original source. Its retained `scope` must equal the original report's `period` object. The original export ID, review-notes hash and review-snapshot revision are retained with its original period definition. The workspace retains the original close and review bytes together with the report. This adapter compares those original fields without selecting dates, recalculating period membership or performing another close.

Labels are optional and supplied for actual `optionId` values from the report. Duplicate labels or unknown options are rejected. `assetLabel` is an operator's currency or asset name; `unitLabel` describes the displayed unit. These labels do not set asset precision or exchange rates. Native `amountAtomic` stays an exact string. Account labels on the handoff remain protected; the accountant's returned account code has its own editable column. Changing source labels requires a new handoff.

## Retained schemas

### Handoff

Schema: `stellar-forge.merchant-accountant-handoff.v1`.

| Field | Meaning |
| --- | --- |
| `id`, `name`, `actor`, `createdAt` | Handoff identity and preparation record |
| `source` | Exact run/report/input-manifest/report-manifest identity and optional original close-file identity |
| `sourceHashes` | Original reconciliation's input lineage, copied unchanged |
| `sourceAccountingStatus` | Original accounting status, copied unchanged |
| `sourceOptions` | Original report's complete option groups, copied unchanged |
| `labels` | Operator-supplied option labels |
| `rows` | Frozen original ledger rows with handoff row IDs, exact original-row digests and labels |
| `summary` | Source-event, option, network, origin and missing-label counts |
| `integrity.sha256` | SHA256 of canonical JSON for the record excluding `integrity` |

Each `rows` entry is `{rowId,eventId,sourceRowSha256,original,label}`. The complete original ledger row is in `original`. `sourceRowSha256` hashes that entire row's canonical JSON, including original fields beyond those displayed in the CSV. `rowId` hashes the handoff ID, original report hash and event ID. The event's existing `eventId` is preserved independently.

`summary` contains `totalRows`, `optionCount`, `nativeCapturedRows`, `recoveredRows`, `testnetRows`, `publicNetworkRows`, `officialTransferMatches` and `missingLabelRows`. It does not combine amounts or currencies.

### Returned revision

Schema: `stellar-forge.merchant-accountant-return.v1`.

| Field | Meaning |
| --- | --- |
| `id`, `handoffId`, `handoffSha256`, `sourceReportSha256` | Exact handoff/source binding |
| `parentRevisionId`, `parentRevisionSha256` | Previous saved immutable return, or null for the first return |
| `createdAt`, `actor`, `name` | Import observation and operator |
| `importSha256`, `importBytes` | Hash and size of the exact returned CSV bytes |
| `assignments` | Complete current external assignments for every original handoff row |
| `results`, `issues` | Row-level outcomes, protected-field conflicts, invalid edits and unmatched rows |
| `missingRows` | Original rows absent from this return, preserving their preceding assignments |
| `summary` | Import outcomes plus complete current assignment counts |
| `integrity.sha256` | Canonical record hash excluding `integrity` |

Each assignment includes `rowId`, `eventId`, the four editable values, and `updatedAt`, `updatedBy`, `revisionId` for its last actual change. A returned row that exactly repeats its preceding assignment is `UNCHANGED`; the preceding assignment's attribution is preserved.

`summary` includes `totalRows`, `returnedRows`, `appliedRows`, `unchangedRows`, `conflictRows`, `unknownRows`, `missingRows`, `ignoredBlankRows`, `unreviewedRows`, `reviewedRows`, `bookedRows`, `excludedRows`, and `outcome`. `outcome` is `CONFLICTS` when any conflicting or unknown return row exists, otherwise `PARTIAL` when source rows were omitted, otherwise `COMPLETE`. COMPLETE describes return coverage; individual external statuses remain visible.

`inspectHandoff(handoff, revision?)` returns metadata in `handoff`, original `source`, `sourceHashes`, `sourceOptions`, source `summary`, optional `revision` metadata/current summary, joined `rows`, `issues` and `missingRows`. Each joined row preserves `original` and `label`, with the current assignment fields alongside them. The workspace pages this view for browser requests. `validateHandoff(handoff)` and `validateRevision(handoff, revision)` return their validated record or throw `AccountantError` with `code`, `message`, `status`, and optional `details`.

## CSV contract

The output is UTF-8, comma separated, with a header, quoted cells and CRLF record endings. Quoted quotes and multiline notes use the normal CSV representation. Import accepts LF or CRLF, a UTF-8 BOM, reordered columns and reordered event rows. Every header must appear exactly once; unknown or missing columns are a file error. Empty data records are ignored. Invalid UTF-8, malformed quoting, oversized inputs and duplicate headers are file errors; the operator can correct the input before previewing again.

Only these columns are editable:

| Column | Accepted values |
| --- | --- |
| `externalStatus` | `UNREVIEWED`, `REVIEWED`, `BOOKED`, `EXCLUDED`; an empty cell means `UNREVIEWED` |
| `externalBookRef` | Up to 200 characters; required for `BOOKED` |
| `externalAccountCode` | Up to 160 characters |
| `externalNote` | Up to 4,000 characters; quoted multiline text is supported |

BOOKED retains the accountant's report of an external entry. Its reference can be shared by several original events when an external book uses a batch journal. The report's original transfer class, asset units, quoted USD and network remain independently visible beside that external status.

All remaining columns are protected: handoff/run/report/close identities, row and original-row hashes; event/option/asset/recipient/amount; transaction, receipt, proof and recovered-response fingerprints; original time/time basis/origin; native transfer, delivery, exception, mapping and verification fields; merchant quote/cost/basis; and operator-supplied labels. `CSV_COLUMNS` is the maintained exact ordered list. Numeric-looking native amount strings are compared as strings; a spreadsheet-modified amount such as `50,000`, `5E4` or `50000.0` conflicts with source `50000`.

Spreadsheet formula triggers are escaped reversibly with one leading apostrophe. Literal leading apostrophes and numeric text containing more than 15 digits are escaped as well, so large native amounts retain their complete text when opened in a spreadsheet. The complete original source remains unchanged in `handoff.json`. Import compares protected values to their original text or that reversible exported representation. Editable values emitted by this adapter round-trip without repeated apostrophes. Formula text in a newly returned note is retained as text and escaped when the adapter emits another CSV. HTML exports escape every source and returned value.

## Partial returns and conflicts

The parent revision supplies the starting assignment for every source event; the first import starts with UNREVIEWED and empty external fields. A present, exact-source row supplies all four editable fields, so clearing a field is explicit. Omitted rows preserve their preceding assignments.

A protected-field mismatch, invalid edit, mismatched row/event pair or repeated target leaves every affected original event at its preceding assignment. All occurrences of a duplicated target are conflicts, even if one occurrence looks valid. A cross-wired pair that names two different source events protects both targets. Unknown rows are retained as unmatched outcomes. Other exact, valid rows in the same return can apply, and their complete result is available in the preview before an explicit workspace import.

Row outcomes are `APPLIED`, `UNCHANGED`, `UNKNOWN_ROW`, `DUPLICATE_ROW`, `IDENTITY_CONFLICT`, `PROTECTED_VALUE_CONFLICT`, `INVALID_EDIT`, or `ROW_LENGTH_MISMATCH`. Results preserve CSV record numbers and physical starting line numbers. Protected-field conflicts retain exact expected and received text. Raw CSV bytes remain in the workspace's immutable return packet.

The engine supports up to 22,000 source rows, 50,000 returned records, 128 MB original reports and 64 MiB CSV inputs. The connected workspace uses the same 64 MiB CSV upload limit. These are input bounds; no background polling, third-party booking, source modification or provider submission is performed by the pure adapter.
