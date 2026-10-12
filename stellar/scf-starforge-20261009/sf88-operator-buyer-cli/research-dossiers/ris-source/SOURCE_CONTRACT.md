# Original RIS source and interpretation contract

This contract describes the `lossless-ris-v1` reader and reviewed RIS editions in the Research workspace. The complete original document bytes are the source authority. The parser supplies an indexed view of those bytes; the review records the operator's interpretation and selection; the existing Dossier store retains the resulting edition and its history.

Use [OPERATING_GUIDE.md](OPERATING_GUIDE.md) for the complete operator workflow and [RECEIVING_GUIDE.md](RECEIVING_GUIDE.md) for the original native selection, complete package and fresh-process receiving. This document explains the source representation, framing, derived fields and limits. It does not turn a prepared source or a source review into a completed native-operation receipt.

## 1. Implementation authority

The behavior below is defined by these complete source files:

| File | Responsibility | Reviewed Git object |
| --- | --- | --- |
| [constants.mjs](constants.mjs) | Schema names, parser version and finite intake limits. | `3292502942cb9b32df3d523f0311d482b2f3865a` |
| [parser.mjs](parser.mjs) | Declared encoding, ordered lines/tags, exact byte spans and framing diagnostics. | `a5399402971763b230e3f17b664b59e4f9a199a9` |
| [schema.mjs](schema.mjs) | Complete original documents, source declarations, identity construction and reinspection. | `88a1201d018d99b3b94a12edd0e7ed2a8872c87d` |
| [review.mjs](review.mjs) | Candidate interpretation, duplicate review, reviewed editions, projections and comparisons. | `97a78cddb5369a4943e62a0e0074968cbedc5423` |
| [store.mjs](store.mjs) | Original Dossier revision commit, request recovery, retained exports and portable validation. | `8c7bcf57418a2c2b0e692f21208c7119c44492ce` |
| [../normalize.mjs](../normalize.mjs) | Admission of reviewed RIS editions and their exact DOI or record identity. | `913bd1701968d2e1f26bf0f4d492319e35257741` |

The original RIS cohort is retained in the standalone product's merged source `9ca38f577cbcb2b901e85a281a9062b7e420fc05`. The contained identity correction is merged in standalone `90ca7ac31f345cb21cc30e3c381a43e589dc5e79` and maintained `ce1b2b35af6a6377697196fca1ce8ca6571904b9`. A later source edition should retain its own complete manifest and compare changed behavior against these original functions.

## 2. Complete documents and declared provenance

A source has schema `sf88-research-ris-source-v1` and parser `lossless-ris-v1`. It contains a label, a parseable `preparedAt`, source reference, required nonblank source terms, and one to 32 documents. Each document supplies a filename, declared encoding, complete canonical Base64 body and source declaration. Optional input byte counts and SHA-256 values must match the decoded body.

Filenames are single names of at most 240 JavaScript string code units. Slashes, backslashes, control characters, DEL, `.` and `..` are rejected. A filename is metadata, not permission to read an arbitrary filesystem path.

The declaration retains `database`, `query`, `exportedAt`, `retrievedAt`, `url`, `sourceReference`, `sourceTerms`, `notes` and `provenance`. Database and source terms are required. Export/retrieval timestamps may be null; supplied values must be parseable timestamps. An empty URL is permitted; a supplied URL must use HTTP or HTTPS and contain no username or password. The source does not manufacture missing query, export date, retrieval date or licensing terms. Additional provenance is retained as bounded canonical JSON.

All named input objects reject undeclared fields. Canonical JSON requires finite numbers, dense arrays and plain objects; prototype-related keys are rejected. Base64 decoding requires the exact canonical alphabet and padding, and does not silently discard embedded whitespace or invalid characters. Reinspection recomputes document IDs, lengths, hashes, declarations and parser results.

`risdoc_` is followed by the SHA-256 of canonical document metadata: filename, encoding, complete declaration, original byte count and original body SHA-256. Changing a filename or declaration therefore produces another document identity even if the body bytes match. Exact duplicate document identities in one prepared source are rejected; separately declared copies retain distinct identities and can be reviewed as duplicates.

The complete prepared-source JSON also has its own byte count and SHA-256. When a valid existing source file is supplied, its original JSON bytes are retained and hashed; semantic reinspection does not replace its formatting with a new serialization.

## 3. Declared encoding and byte locations

Supported encodings are `utf-8`, `windows-1252`, `utf-16le` and `utf-16be`. The default declaration is UTF-8. The reader does not guess an encoding from bibliographic content. A recognized UTF-8 or UTF-16 byte-order mark must agree with the declaration. UTF-16 data must have complete two-byte code units. The entire document is decoded with fatal error handling, including material outside records.

The reader recognizes LF, CRLF and CR line endings and retains each original ending. Line numbers are one-based. Byte `start`/`end` ranges are half-open offsets into the complete original encoded document; they are not JavaScript character offsets. A document-level BOM remains in the original document. The first indexed line starts after that BOM, so a record-span download does not add a document BOM that is outside its span.

Every indexed record retains its original start/end, byte length, line range, SHA-256, decoded raw text, ordered fields, continuation lines and diagnostics. Each field retains its position, tag, complete interpreted text, byte range, source lines and original line endings. The original encoded document and record span remain independently available.

## 4. Framing and diagnostics

The accepted field-line grammar is the implementation's exact expression:

```text
^([A-Z0-9]{2}) {2}-(?: (.*))?$
```

A tag consists of two uppercase ASCII letters or digits, two literal spaces and a hyphen. An optional single separator space introduces the remaining value. `TY` begins a record; `ER` ends it. `TY` must have a nonblank value. `ER` must have an empty or whitespace-only value. Unknown tags that satisfy the grammar remain in the ordered field list.

A subsequent line that is not a tag or malformed tag delimiter continues the previous field. The reader appends the prior line's original line ending and the new line's exact text. It preserves indentation, blank lines, repeated spaces, unknown fields and repeated tags. A line resembling a tag with a lower-case name or an invalid space/tab delimiter produces a delimiter diagnostic instead of becoming an ordinary continuation.

A new `TY` before `ER` finishes the preceding record immediately before that new line and records a missing terminator. End of file with an open record also records a missing terminator. An `ER`-terminated record is complete only when it has no error-severity framing diagnostic. The parser does not repair a malformed record or silently drop unrecognized material.

| Diagnostic | Meaning |
| --- | --- |
| `CONTENT_OUTSIDE_RIS_RECORD` | Nonblank material occurs outside a `TY`/`ER` record. |
| `RECORD_TERMINATOR_MISSING` | A new record or end of file was reached before an `ER`. |
| `RECORD_TYPE_MISSING` | The `TY` value is blank. |
| `CONTROL_CHARACTER_IN_RIS_TEXT` | Record text contains a prohibited C0 control character or DEL; ordinary tab is allowed. |
| `RECORD_TERMINATOR_VALUE` | The `ER` field has a nonblank value. |
| `RIS_TAG_DELIMITER_INVALID` | A tag-like line does not match the exact uppercase/two-space delimiter. |
| `RIS_CONTINUATION_WITHOUT_FIELD` | A continuation cannot be attached to a preceding valid field. |

Contiguous outside-record segments retain byte ranges, line ranges, lengths and SHA-256 values, including whitespace-only segments. Blank outside-record text does not itself create an error. Empty or zero-record documents are represented by their actual counts; the parser does not invent a record.

All parser diagnostics currently use error severity unless the caller explicitly supplies another severity to the internal diagnostic helper. Structural input, encoding and size errors throw their named errors before a prepared source can be retained. Those exceptions are different from a parsed source carrying reviewable framing diagnostics.

## 5. Native fields and explicit interpretation

Original values remain in the field list. The following is the review projection used for displayed bibliographic metadata:

| Projection | Original fields and rule |
| --- | --- |
| Title candidates | `TI`, `T1`, `CT`; trim leading/trailing whitespace. Candidate order prefers TI, then T1, then CT, retaining original tag order within each. |
| DOI candidates | Each `DO`; trim, remove a `doi:` prefix, or decode the path of an HTTP(S) doi.org/dx.doi.org URL without credentials, query or fragment. Accept the original DOI shape `10.<4–9 digits>/<non-whitespace suffix>` and lowercase it. |
| Year candidates | `PY`, `Y1`, `DA`; a leading four-digit sequence followed by a non-digit or end of value. This is an extracted source token, not a validation of publication chronology. |
| Authors | Every `AU` or `A1` value, in original order, without name splitting or removal of repeats. |
| Abstracts | Every `AB` or `N2` value, preserving their complete text and line endings. |
| Journal | Every `JF`, `JO` or `T2` value in original field order. |
| Record type | Trimmed value of the first `TY`; no automatic conversion to a CSL publication type. |
| URLs | HTTP(S) values from `UR`, `L1`, `L2`, `LK` without embedded credentials; the projection retains all accepted values and uses the first as its primary URL. |
| Native IDs | Original `ID` and `AN` tag/value pairs. |

A field with exactly one distinct normalized candidate is selected by default. Multiple distinct candidates require an explicit interpretation choice for a selected record, `interpretationReviewed:true` and a nonblank reason. Selection uses original `tagIndex`, so a changed or nonexistent field index is rejected. A reviewer can choose null rather than silently manufacture a title, DOI or year. With no chosen title the projection displays `Untitled RIS record`; the originals remain intact.

A malformed record defaults to unselected and cannot be selected in a complete review. Classifications are `supports`, `contradicts`, `background` or `unreviewed`; record notes and interpretation reasons are retained. Invalid DOI text remains an original field even when it supplies no DOI candidate.

### Identity and duplicate review

A record occurrence ID is `risrec_` followed by the canonical hash of its document ID, ordinal and exact record-byte SHA-256. A reviewed source identity is `doi:<normalized DOI>` when a DOI is chosen; otherwise it is `ris-record:<the 64 lowercase hex characters of the record ID>`. The shared normalizer admits exactly those two original forms. It does not replace a no-DOI key with a title-derived key.

Records sharing an explicit DOI form a `native-doi` duplicate group. The existing Research source view groups that DOI while retaining each occurrence. Records without a DOI may form an `exact-title-year-authors` review group: NFC-normalized, en-US-lowercased title and trimmed author values, the extracted year and author order supply the comparison key. This second grouping is a review candidate; it does not merge the source identities.

Every duplicate group requires a decision and reason, including groups with unselected records. `keep-all` selects every member; `choose` selects a nonempty proper subset; `defer` selects none. The complete review validates those choices. All source error diagnostics also require explicit acknowledgement. Acknowledging a diagnostic records awareness; it does not make an incomplete record selectable or rewrite its bytes.

## 6. Frozen review, edition and request recovery

The preview schema is `sf88-research-ris-preview-v1`. A complete review names the original request ID, target question, reviewer and review timestamp; supplies one choice for every record; resolves duplicate groups; acknowledges source errors; and optionally selects a previous RIS edition with `keep` or `deselect` for its prior occurrence selections.

`planSha256` binds the parser version, exact prepared-source descriptor and complete review. Edition creation requires that same plan hash and no unresolved review issues. The resulting `sf88-research-ris-edition-v1` retains the exact complete prepared-source JSON as Base64 plus its byte count/hash, the complete review and the plan hash.

The existing Dossier commit supplies the original revision comparison and immutable blob storage. Receipt and edition identities bind the dossier/question, original request ID and retained edition. A lost acknowledgement is recovered by the original request ID only after matching the complete input, plan and edition bytes. A changed input under the same request raises `RIS_REQUEST_INPUT_CHANGED`; a request receipt is not permission to receive a different selection. The completed-request check precedes a new revision check, so an exact retry can recover a committed result after later dossier changes.

A previous edition is retained. Choosing `deselect` changes its occurrence selections as part of the new revision; it does not delete that edition, its source documents or its historical review. Portable validation reopens and checks the original RIS editions and transitions. If a received portable no longer has a separately prepared source blob, the RIS store recovers the exact source representation embedded in its immutable edition.

The shared normalizer accepts RIS results only from a reviewed RIS edition with the matching `ris-document` provider. A generic provider-results object cannot bypass the RIS review.

## 7. Exports and edition comparison

| Export | Representation |
| --- | --- |
| `source` | Exact retained prepared-source JSON. |
| `edition` | Exact retained reviewed-edition JSON. |
| `document` | Complete original encoded document, including its original BOM and all outside-record bytes. |
| `record` | Exact original encoded half-open record byte span. |
| `selected-ris` | Explicitly derived UTF-8 text for complete records selected in the edition's frozen review; original decoded record text is used and a final LF is added only when a record has no trailing CR or LF. |
| `csv`, `html`, `md` | Derived complete review projections and reports, with their own byte count/hash. |
| Comparison `json`, `html`, `md` | Derived full comparison of two retained editions for the same question. |

The selected-RIS and review-report exports describe the choices frozen inside that reviewed edition. Later Research occurrence selections are separately visible as `currentSelection`; they do not mutate the original RIS review. UTF-8 selected output is not an original-byte replacement for a UTF-16 or Windows-1252 document.

Edition comparison groups occurrences by their reviewed source identity and compares native fields, frozen choices, projected interpretation, source declarations and occurrence counts. No-DOI records whose document identity changes can therefore appear as absent and added rather than as a guessed semantic match. Absence in a later source edition does not establish retraction of a publication. A source with acknowledged parser errors still projects `PARTIAL` and retains its warnings; acknowledgement does not relabel it as error-free.

## 8. Limits

All limits are enforced by the original source before or during inspection:

| Item | Limit |
| --- | --- |
| Original bytes per document | 8 MiB |
| Original bytes across all documents in one source | 8 MiB |
| Prepared-source JSON | 16 MiB |
| Reviewed-edition JSON | 64 MiB |
| Documents | 32 |
| Records across a source | 5,000 |
| Fields per record | 4,096 |
| Original bytes per record or line | 2 MiB |
| Lines per document and across a source | 200,000 |
| Diagnostics across a source | 10,000 |
| Canonical declaration provenance per document | 65,536 bytes |
| Preview records per page | 1–100 |

MiB means 1,048,576 bytes. Limits constrain the complete original input as well as the displayed projection. A preview page does not truncate the retained source or authorize an oversized intake. The complete native and package programmes additionally validate their selected source manifests, ordinary file types, original hashes and private paths.

## 9. Citation.js primary-source comparison

This comparison is pinned to the first-party `citation-js/citation-js` tag `v0.9.0`, commit [`51a37ce28fd3508e5cc2957b7d17794cdbad8ed0`](https://github.com/citation-js/citation-js/commit/51a37ce28fd3508e5cc2957b7d17794cdbad8ed0). Its [RIS package declaration](https://github.com/citation-js/citation-js/blob/51a37ce28fd3508e5cc2957b7d17794cdbad8ed0/packages/plugin-ris/package.json) identifies `@citation-js/plugin-ris` 0.9.0, MIT licensing, Node >=22.12.0, `@citation-js/core` ^0.9.0, the date dependency ^0.5.0 and name dependency ^0.4.2. These are the comparison package's declarations. The Research RIS implementation above uses its own retained parser and does not import or install that plugin.

The observations below come from reading the pinned original source. They are source-code implications, not a claim that a Citation.js installation or a second native RIS programme was executed.

### Framing comparison

The first-party [ris.js](https://github.com/citation-js/citation-js/blob/51a37ce28fd3508e5cc2957b7d17794cdbad8ed0/packages/plugin-ris/src/ris.js) parser returns normalized record objects. Its [index.js](https://github.com/citation-js/citation-js/blob/51a37ce28fd3508e5cc2957b7d17794cdbad8ed0/packages/plugin-ris/src/index.js) also supplies a string autodetection expression and chooses a tag specification.

| Aspect | Pinned Citation.js 0.9.0 reader | Research `lossless-ris-v1` reader |
| --- | --- | --- |
| Line boundaries | Splits LF or CRLF and trims the complete line. | Recognizes LF, CRLF and CR; retains original byte offsets, text and each ending. |
| Tag recognition | Requires an uppercase first letter and an uppercase letter or digit second character after trimming the line. | Accepts the exact untrimmed two-uppercase-letter-or-digit grammar in section 4. |
| Tag value delimiter | Uses a split and retains its first tag/value pair; a further matching delimiter inside a value is not retained. | Recognizes the leading field delimiter and retains the remainder as its value. |
| Continuation | Appends one space and the trimmed line to the previous field. | Appends the original preceding line ending and exact continuation text. |
| Repeated field | Repetition becomes an array; a later continuation uses string concatenation, which can coerce that array to comma-joined text. | Every occurrence and its own continuations remain in order. |
| Empty ER | Its empty-value branch runs before tag dispatch: it clears the last tag but leaves the current entry. A later nonempty tag can attach to that entry. | ER closes the record immediately; subsequent outside-record content is retained and diagnosed. |
| TY and final framing | Pushes an entry on TY, uppercases its type and aliases JOURN to JOUR; no explicit final-ER validation appears in that function. | Retains the original TY value and diagnoses missing terminators and malformed framing. |
| Source representation | The result is a tag/value object, without record byte ranges or cross-tag occurrence order. | The complete original document and exact record spans remain separately available. |

Additional edge behavior follows the same pinned control flow: a nonempty ER reaches the branch that clears the current entry; a nonempty recognized field before any TY attempts to address an absent entry. Its string autodetection checks TY at the beginning of a line before the later parser performs trimming. These observations describe that exact version, not every RIS tool or later Citation.js release.

### Field normalization comparison

The pinned [specification selector](https://github.com/citation-js/citation-js/blob/51a37ce28fd3508e5cc2957b7d17794cdbad8ed0/packages/plugin-ris/src/spec/index.js), [new mappings](https://github.com/citation-js/citation-js/blob/51a37ce28fd3508e5cc2957b7d17794cdbad8ed0/packages/plugin-ris/src/spec/new.json), [old mappings](https://github.com/citation-js/citation-js/blob/51a37ce28fd3508e5cc2957b7d17794cdbad8ed0/packages/plugin-ris/src/spec/old.js), [mixed composition](https://github.com/citation-js/citation-js/blob/51a37ce28fd3508e5cc2957b7d17794cdbad8ed0/packages/plugin-ris/src/spec/mixed.js) and [mixed additions](https://github.com/citation-js/citation-js/blob/51a37ce28fd3508e5cc2957b7d17794cdbad8ed0/packages/plugin-ris/src/spec/additions.json) map native tags into CSL fields. The mixed specification concatenates the new mappings with its additions. The [converters](https://github.com/citation-js/citation-js/blob/51a37ce28fd3508e5cc2957b7d17794cdbad8ed0/packages/plugin-ris/src/converters.js) and original [core Translator](https://github.com/citation-js/citation-js/blob/51a37ce28fd3508e5cc2957b7d17794cdbad8ed0/packages/core/src/util/translator.js) define the resulting interpretation.

Those mappings select alternatives and transform field values. ANY chooses the first truthy alternative. The name converter splits comma-separated family/given/suffix components; a single word becomes a family name, while a single multiword component or a shape with more than three components remains literal. Keywords are joined with commas. Date conversion takes the first three slash-separated components, then removes empty components before calling the declared date dependency; a single-source issued mapping uses its numeric-year or raw-value path. DOI conversion extracts a matching substring instead of applying this Research review's anchored whole-value identity validator. Page and serial-number fields have their own converters. The Translator copies applicable mapped fields into a new object, and a later mapping can overwrite an earlier value for the same target.

For a JOUR entry under the mixed specification, the original mappings include TI/title, AU/author, DA before PY/issued, AB/abstract, T2/container-title and DO/DOI. Additions use T1 before BT when TI is absent, A1 when AU is absent, Y1 when DA and PY are absent, N2 when AB is absent, and JO before JF before J1 when T2 is absent; an EP addition supplies the SP/EP page representation. Other applicable new mappings, including TA and TT, can also supply author or title, so that example does not establish one universal priority for every record type. The complete original mapping order remains the reference.

The converter's 20-character ID truncation belongs to its output mapping. It is not evidence that the input parser truncates native IDs. The [type mappings](https://github.com/citation-js/citation-js/blob/51a37ce28fd3508e5cc2957b7d17794cdbad8ed0/packages/plugin-ris/src/spec/types.json) and [data types](https://github.com/citation-js/citation-js/blob/51a37ce28fd3508e5cc2957b7d17794cdbad8ed0/packages/plugin-ris/src/dataTypes.json) are part of that pinned normalization source.

In this Research product, all original tags, repetitions, native IDs and decoded field text remain available beside the explicit projection described in section 5. Conflicting title/DOI/year candidates require an operator decision for selected records. The chosen semantic key and review are then bound into the retained edition; importing a normalized CSL object does not substitute for the original RIS document.

## 10. Reuse and complete delivery

Keep this contract with the full RIS source, original engine/LICENSE and installed `research-client` contribution. The contribution declares this document as a support file so source-built installations carry the same explanation as the standalone source. Native packaging includes each file named by the selected engine manifest, both operating guides, original provider input, original operation selection and complete received outputs.

The original native programme reads its already-retained provider response carrier. It does not reacquire RIS merely to explain or verify the parser. Continue an existing programme with its original operation, private source/runtime selection and retained outputs. A new receiver's generated example has placeholders for a deliberately new operation; it is not a replacement identity for an interrupted original run.

The runtime paths in the guides must be actual installed paths: Node 24 or later, Python 3, the installed Playwright module and its matching Chromium executable, on the Linux/POSIX file/process path used by the native receiver. This source contract records no installed-host observation and no completed browser, Merchant or cold-receiving result.
