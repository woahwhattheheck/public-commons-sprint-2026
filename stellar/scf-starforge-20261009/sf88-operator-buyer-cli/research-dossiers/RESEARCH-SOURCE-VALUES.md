# Read typed values from an original retained research record

`research-source-values.mjs` exposes one read through the existing ClinicalTrials packet parser. It accepts the complete original record text, its already-retained UTF-8 byte count and SHA-256, and a batch of JSON pointers. The source hash is verified before any pointer is evaluated. This helper does not fetch a record, select a study, authorize an occurrence, or write a dossier; those bindings remain in the original Dossier store.

## JavaScript interface

```js
import {resolveResearchSourcePointers} from './research-source-values.mjs';

const result = await resolveResearchSourcePointers({
  rawText: retainedRecord.content,
  expectedSha256: retainedRecord.metadata.recordSha256,
  expectedBytes: retainedRecord.metadata.recordBytes,
  pointers: selectedPointers,
}, {python: 'python3', signal});
```

Use the real retained record's fields at the caller seam; the example shows the original record content and metadata roles. The caller first binds that record to its retained occurrence, edition, page or member and requested dossier revision. Source extraction and replay should batch all required pointers for that record into this one call. `timeoutMs` defaults to 120,000 and accepts 1,000–900,000 milliseconds.

The result has this shape:

```text
{
  schema: 'sf88-research-source-values/v1',
  sourceSha256: <the verified original UTF-8 SHA-256>,
  sourceBytes: <the verified original byte count>,
  parser: {
    module: 'clinical-trials-packet.py',
    sha256: <the actual parser source SHA-256>
  },
  values: [{pointer, found, typedValue?}, ...]
}
```

Rows retain the requested order, including repeated pointers. A missing object member, out-of-range array index, `-` index or traversal through a scalar returns `found: false` with no `typedValue`. A present JSON null returns `found: true` and `['NoneType', null]`; the two states remain distinct.

## Original exact-number parser

The sibling Python module imports the same `clinical-trials-packet.py` used by the original retained ClinicalTrials reader and calls its `document(raw, exact=True)` and `typed(value)` functions. Keep that original file in every installed and portable source closure. This is an adapter around that parser, not a second numeric decoder.

The original parser rejects duplicate JSON keys and non-JSON constants. Numeric JSON tokens pass through Python Decimal and the original typed representation:

| Source kind | Returned typed value |
| --- | --- |
| JSON number | `['number', '<Decimal string>']` |
| JSON string, including reported “NA” | `['str', '<original string>']` |
| JSON boolean | `['bool', true or false]` |
| JSON null | `['NoneType', null]` |
| Array | `['array', [typed values]]` |
| Object | `['object', [[key, typed value], ...]]` |

Decimal values and the original parser's representation are preserved. The helper does not claim that Decimal's printed exponent spelling is the original numeric token's byte spelling; the complete original text and its hash remain the lexical source. Registry strings, zero, empty strings, null and absent values remain separate. Saved operator entry is separate from this source value, so an independently entered discrepancy can be reviewed and resolved by the extraction engine.

## Pointer rules and bounds

Pointers use the JSON string representation from RFC 6901, not a URI fragment. The empty pointer selects the whole record. Every nonempty pointer begins with `/`; `~1` represents `/` and `~0` represents `~`, decoded in that order. Invalid escapes fail. Object names match exactly without Unicode normalization. Array indices are `0` or a positive decimal integer without leading zeroes.

The current adapter accepts 1–512 pointers, at most 4,096 characters per pointer and 262,144 characters in total. The source is at most 16 MiB. The stdio envelope is bounded to its worst-case escaped source size; the response is at most 64 MiB. The Python adapter counts each selected result before retaining another, so repeated whole-record selections cannot accumulate an unbounded response. A limit violation fails the whole read; it does not return a truncated value.

Primary pointer specification: https://www.rfc-editor.org/rfc/rfc6901

## Native ownership and errors

The Node adapter starts one owned Python child with private pipes in the existing process group. It sends the complete bounded request, joins stdout/stderr and waits for child closure. Abort or timeout sends SIGTERM to that child and escalates to SIGKILL after five seconds if it remains alive. It creates no detached worker, persistent server, temporary record file or additional authentication boundary.

The parser returns a bounded structured error code for an invalid source, pointer or request. The Node adapter also validates exact response fields, original source identity, requested pointer order and every tagged value. It retains no raw source in error messages. The caller should retain its original dossier/occurrence/request identity and report an unsuccessful source read; a failed read has no committed mutation to replay.

## Python stdio interface

```sh
python3 research-source-values.py --stdio
```

The one JSON request on stdin has exactly `schema`, `rawText`, `expectedSha256`, `expectedBytes` and `pointers`; schema is `sf88-research-source-values-request/v1`. One JSON result and newline are written to stdout. A failed request writes `{schema:'sf88-research-source-values/v1',error:<code>}` and exits nonzero.

Callers importing the Python module can use `resolve_source_pointers(request)` directly with the same envelope. The original parser, source binding and result representation are identical.
