# Separately captured notice sources

The existing desk retains complete CanadaBuys CSV editions. A notice that is absent from an imported feed may be entered from a separately retained first-party HTML page using the explicit derived-source contract below. This operation adds a new source and notice edition. It does not replace the feed, assert that the new row appeared in that feed, or change the existing workspace identity, profile, saved commands or prior editions.

## Original and derived sources

Ordinary imports remain `bodyKind: original-utf8-csv`, `coverage: federal`. Their source identity remains SHA256 of the stream, newline and original CSV digest. Existing v1/v2 packages and original CSV imports retain their previous behaviour.

A derived source requires:

- `stream: complete-tenders`, exactly one parsed row, `bodyKind: derived-notice-utf8-csv` and `coverage: single-notice`.
- Its own complete CSV bytes and digest, including the required tender headers. A missing reference number stays blank. The real solicitation number and buyer fields retain the original native notice identity rules.
- A complete UTF-8 HTML capture, its original URL, explicit retrieval timestamp, byte count, SHA256, canonical Base64 bytes and retained HTTP response metadata (or explicit null). The capture limit is 8 MiB.
- A versioned manual derivation with author, creation time, jurisdiction and an explicit scope note.
- One field mapping for every CSV column. No unmapped fields or duplicate mappings are accepted.

The derived source identity additionally binds the canonical complete derivation and coverage. Two different captures or mappings cannot silently share a source identity even if their resulting CSV cells are identical. `derivationSha256` is computed by the native importer; callers may omit it on initial import and must preserve it thereafter.

A byte/span/hash check proves preservation and the declared mapping's binding. It does not prove that an operator's interpretation is correct, authenticate the publisher, verify current eligibility, or turn a document heading into a mandatory requirement.

## Exact import shape

Use the existing `CanadaBuysWorkspace.importCsv(rawText, metadata, expectedRevision)` or `CanadaBuysClient.importCsv(rawText, {...metadata, expectedRevision})`. The existing HTTP import route passes this same metadata to the native transaction. It does not fetch a source.

```js
const metadata = {
  stream: 'complete-tenders',
  label: 'Separately captured notice — operator transcription',
  bodyKind: 'derived-notice-utf8-csv',
  coverage: 'single-notice',
  url: capturedURL,
  retrievedAt: capturedAt,
  expectedSha256: sha256(derivedCSVBytes),
  derivation: {
    schema: 'starforge.canadabuys.notice-derivation.v1',
    method: 'manual-field-map',
    createdAt: mappingCreatedAt,
    author: operator,
    jurisdiction: 'British Columbia',
    note: 'One separately captured notice, not a row from the retained federal CSV feed.',
    original: {
      url: capturedURL, retrievedAt: capturedAt,
      mediaType: 'text/html', encoding: 'base64',
      bytes: htmlBytes.length, sha256: sha256(htmlBytes),
      bodyBase64: htmlBytes.toString('base64'),
      response: retainedHTTPMetadata
    },
    fields: mappings
  }
};
```

Each mapping has exactly `{column,value,status,fragments,note}`. Each fragment has exactly `{startByte,endByte,sha256}`, with an exclusive end offset. Offsets refer to original UTF-8 response bytes, not rendered text, JavaScript string offsets or decoded HTML entities. Both ends must lie on complete UTF-8 character boundaries.

| Status | Required representation |
| --- | --- |
| `observed` | Nonblank exact CSV value appears literally in at least one retained fragment. Every fragment's bytes and SHA match the full capture. |
| `normalized` | Nonblank value, retained fragment(s), and an explicit transformation note. For example, decoding a source entity or converting the expressly shown EST deadline to an ISO timestamp with `-05:00`. |
| `unknown` | Exactly blank CSV value, no fragments, and an explicit reason such as “No reference number is shown in this captured notice.” |

A literal `*` copied from the original remains a literal cell. The existing bidder engine continues to treat blank and wildcard classification values as unknown; this import does not add eligibility or geographic inference.

Preserve the original published date/status/amendment text in its mapped field and evidence. Do not invent a revision number from an amendment date, infer a reference number from the solicitation, infer a residential/contractor capability, or substitute a deadline from an older linked document. A currently linked issuer document and a retained historical reference document are distinct evidence records with their own access/review states.

## Atomic version transition and receiving

The first derived-source insertion upgrades that workspace's metadata and SQLite user version to v3 inside the same existing write transaction as the source and entries. Its original UUID and history remain; the ordinary operation advances the revision once and records the schema transition in that audit entry. A failed transaction rolls back the source and transition together. Normal CSV-only workspaces remain v2. An old v2 application refuses to open a v3 workspace.

Exports from a v3 workspace use `starforge.canadabuys.package.v3`; the existing v2 bidder-record graph format remains unchanged within it. Older receivers refuse the new outer schema instead of silently stripping source evidence. This version handles v1, v2 and v3 package receiving through the original transaction. A purported v1/v2 package carrying derived-source metadata is rejected.

Receiving verifies the package digest, complete CSV, original HTML, every field mapping and source/entry identities before accepting the same saved records. Repeated receiving retains the existing same-package receipt. Selected and complete packages carry full source provenance; the merchant/SF100 bridge preserves it while keeping original payment and dataset behaviour. Mixed package aggregation selects v3 whenever one selected package uses v3.

Saved decisions freeze the complete source descriptor, including original HTML and the mapping. Cold bidder-graph receiving checks both derivation and digest against the retained source. JSON/CSV reports preserve that complete source record; HTML reports show source type, coverage, original HTML identity and mapped fields. Source views distinguish the derived CSV and expose exact original HTML and provenance downloads. HTML bytes are downloaded, not inserted into the application's DOM.

## Applying this source to an existing case

Keep the complete prior application and native checkpoint. Adopt this complete source edition explicitly, then import the one separately identified notice into the original recovered workspace with its current revision. Select the new native source/entry IDs returned by that import. Preserve the original 908-row source, original profile, original commands and previous failure evidence. Do not manufacture an original-feed row or reuse an old source-entry identity.

The native module does not acquire the notice, replay a prior case, or create a replacement workspace. The executing owner selects its exact capture and its existing saved case. Any original case continuation must retain its own actual request and terminal receipts.

## Validation state

Complete source and inline browser scripts have been checked for JavaScript syntax in V8. Native SQLite execution and an actual derived-notice cold receiving remain with the original executing case owner; no successful native or browser result is claimed by this source change.
