# Retained source documents in Analysis

Register a public capture or an operator-selected JSON/CSV file in the existing
Analysis workspace, map its records, and keep the exact source when that whole
workspace is exported and restored.

The source document is a local input. Its origin, publisher, capture time and
coverage are explicit. The ordinary response projection checks every selected
row; DatasetDatabase retains an immutable version; existing saved SQL, complete
query exports and WorkspaceArchives remain the analysis and delivery tools.

## Register and work

A producer supplies a directory containing `source.json` and its named
`files/<sha256>.<extension>` files. Use the descriptor created by the maintained
source adapter; keep the originals beside it.

```sh
python -m stellar_forge_buyer.analysis_workspace \
  --database /private/analysis response \
  --name issuer_facts --input-kind document \
  --manifest /private/source-document/source.json --format json

python -m stellar_forge_buyer.analysis_workspace \
  --database /private/analysis serve --open
```

Registration copies each verified source file into the original analysis
directory. The copied manifest is the original byte sequence. Repeating the
same registration returns its existing revision. A changed source requires
`--expected-revision` and creates the next retained revision.

Open **Retained responses and files**, select the registered source and inspect
its publisher and capture scope. Choose a JSON Pointer record collection (often
`/rows`) or the CSV record sequence. Map exact decimal strings to **Text**.
Preview checks every retained row. Review its complete count, mapping and
source identity, then import the original projection. The Data tab owns the
current SQL view selection; changing it uses the existing revision review.

Saved SQL and full JSONL, CSV and SQLite exports work as they do for a delivered
response. A query preview row limit is a display limit. The full export uses the
original SQL and explicit export limits, including any `LIMIT` in that SQL.

## Descriptor contract

The schema is `stellar-forge.analysis-source-document.v1`. The descriptor has
exactly these top-level fields:

```json
{
  "schema": "stellar-forge.analysis-source-document.v1",
  "title": "Issuer facts from the retained SEC companyfacts edition",
  "format": "json",
  "document": {
    "path": "files/<64 lowercase SHA-256 digits>.json",
    "bytes": 1234,
    "sha256": "<same 64 lowercase SHA-256 digits>",
    "contentType": "application/json"
  },
  "originals": [],
  "provenance": {
    "kind": "public-source",
    "publisher": "U.S. Securities and Exchange Commission",
    "capturedAt": "2026-10-11T22:24:01.883557+00:00",
    "sourceUrl": "https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json",
    "scope": "The complete retained companyfacts response for this capture",
    "description": "The maintained SEC parser preserves exact fact values as text."
  },
  "complete": true
}
```

The digest and byte values above are placeholders for the actual file identity.
The content-addressed file must exist and match before registration succeeds.

| Field | Required meaning |
| --- | --- |
| `title` | Human-readable source label, at most 200 characters. |
| `format` | `json` or `csv`; the document extension matches it. |
| `document` | The exact analytical input file. Its path contains its own SHA-256. |
| `originals` | Up to 32 retained source/evidence files. Each has the same four file fields plus a unique `role` (at most 80 characters), and optional `sourceUrl`. |
| `provenance.kind` | `public-source` or `operator-file`. |
| `provenance.publisher` | The actual publisher or file origin, at most 200 characters. |
| `provenance.capturedAt` | ISO datetime with an explicit UTC offset. |
| `provenance.scope` | What this particular capture covers, at most 500 characters. |
| `provenance.description` | Original coverage limits and interpretation, at most 12,000 characters. |
| `provenance.sourceUrl` | Required for public sources; canonical HTTPS without credentials, query state or fragment. |
| `provenance.transform` | Optional `{name,sourceUrl,sha256}` identifying the actual maintained transformation source. |
| `complete` | Whether the selected source capture is complete within its declared scope. |

A recent-filings response can be complete for its recent-filings scope while
the publisher lists additional historical files. Retain that distinction in
`scope` and `description`. It does not establish whole-history coverage.
Setting `complete:false` carries the original incomplete acknowledgement into
preview, import and reports.

Original evidence files may use `.json`, `.csv`, `.txt` or `.bin`. The
content type describes the actual bytes. The descriptor is at most 1 MiB;
JSON analysis input at most 32 MiB; an original evidence file at most 32 MiB;
the sum of distinct payload files at most 256 MiB. These are the existing
reader's working limits. Select another genuine source scope when larger
inputs require it.

## Exact bytes and durable source identity

The original descriptor SHA-256 is the document ID. Custody lives under:

```text
ANALYSIS_DIRECTORY/
  analysis-response-documents/
    DOCUMENT_SHA256/
      source.json
      files/SHA256.json
      files/SHA256.csv
      files/SHA256.txt
      files/SHA256.bin
```

Only actual named files exist. The descriptor's relative paths are not rewritten.
The original FileDelivery reader verifies every source file. Copies publish
complete content-addressed files first and the original descriptor last.
An interrupted copy resumes by checking matching files already retained.

The source registration and its history store the document ID. Runtime
resolution starts at the currently opened analysis directory, so copying or
restoring the complete workspace keeps the original source SHA, mapping
preview and imported version identity. No producer absolute pathname is used
to locate received source bytes.

The existing response preview includes the original document identity,
publisher, capture scope, original evidence hashes and transformation reference.
The derived table remains an explicitly mapped analytical representation of
that source.

## Complete workspace delivery

Use the existing workspace archive review and export. The archive selects
the source documents referenced by every retained response-source revision in
the same SQLite snapshot, alongside the existing tables, queries, reports and
customer export files.

```sh
python -m stellar_forge_buyer.analysis_workspace \
  --database /private/analysis archive-review
python -m stellar_forge_buyer.analysis_workspace \
  --database /private/analysis workspace-export \
  --id YOUR_ORIGINAL_32_HEX_OPERATION_ID
```

After the existing archive receiver restores the workspace, open its returned
database directory normally. Inspect the source, reopen a saved preview, or
create a new explicit mapping from the same retained file. The original
publisher and source bytes remain available within the delivered archive.

## Maintained integration API

`response_documents.retain_document(manifest_file, database_directory)`
returns the original `document_id`, current manifest location, descriptor
bytes, title and format. It does not register a source; the existing
`AnalysisResponses.register` owns that revision and compare-and-swap.

`read_document_source(paths, format)` supplies the existing ResponseSource
constructor inputs. Its identity reports `RETAINED_SOURCE_DOCUMENT` and
the actual origin, with no HTTP or payment result substituted.

`snapshot_document_files(directory, snapshot_connection)` gives the archive
owner sorted `{path,bytes,sha256}` entries for all referenced source revisions.
`allowed_document_payload(relative)` supplies its exact data-only path
grammar. Both are composed into the original WorkspaceArchives; neither
creates an archive, a second database or a parallel job store.
