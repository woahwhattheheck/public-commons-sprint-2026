# Retained Crossref document intake

This intake turns saved Crossref work and work-list JSON into a normal Research edition. It preserves the exact source bytes, source URLs and supplied transfer provenance. The existing Crossref metadata projector supplies titles, authors, dates, references and the complete original record in metadata.crossref. Citation notice review can then use the same dossier, cited occurrences, findings, decisions and report revisions as an acquired edition.

## Operator command

Use a directory containing original JSON files and an exact provenance manifest:

    node crossref-document-cli.mjs \
      --provenance ./source/provenance.json \
      --source-dir ./source \
      --query "How does the registered retraction affect this cited work?" \
      --label "Retained Crossref retraction documents" \
      --supporting README.md \
      --output ./crossref-document-edition.json

The command reads local files, verifies their manifest lengths and SHA-256 values, builds and validates the edition, writes it atomically, and reads the saved bytes back. A repeated command reuses an identical existing output. A different existing output requires a new filename. Its JSON receipt gives the exact edition hash, record count, documentary coverage and any warnings. Supply the saved edition through the original Research receive/import operation using provider crossref-document and the matching research question.

The manifest must be a JSON object with sources entries containing filename, source_url, bytes and sha256. Filenames are relative to --source-dir. Existing fields, including transport details, original IDs, media types and provenance, remain in the retained manifest and per-document bindings. Optional source retrieved_at (or retrievedAt) means an observed upstream retrieval time; leave it absent when the transfer did not expose one. Manifest retained_at is retained separately. --supporting may be repeated to preserve a README or other source documentation. It does not create a Research result from those auxiliary files.

## Edition and module contract

crossref-documents.mjs exports:

- buildCrossrefDocumentEdition({documents, query, label?, dois?, updatesDois?})
- validateCrossrefDocumentEdition(value), returning the original envelope or throwing a coded error
- parseCrossrefDocument(input), returning its normalized retained record, exact bytes and parsed source request

Each input document has filename and either body (Uint8Array) or bodyBase64. Source documents use role source, an official https://api.crossref.org/works sourceUrl, and optional JSON provenance and retrievedAt. Auxiliary documents use role provenance or supporting-document. A provenance document must contain a JSON object. Each body is limited to 16 MiB, aggregate raw input to 40 MiB, and the serialized Research edition to 64 MiB.

The edition uses schema sf88-research-results-v1, provider crossref-document, and usage.schema stellar-forge.crossref-document-edition.v1. Its originalDocuments array retains every input body as base64 with filename, role, URL, timestamp, provenance, byte length and SHA-256. documentSha256 binds the canonical document metadata/provenance and body identity. documentId is crdoc_ followed by that hash.

Each projected result retains metadata.crossref and metadata.sourceDocuments. Its document binding is:

    {
      documentId, documentSha256, bodySha256, bodyBytes,
      sourceUrl, retrievedAt, role, requestedDois, provenance
    }

A result binding's role is metadata, registered-update or work-list. The same bindings are available in usage.sourceDocuments. The original projector's sourceOccurrences remains empty because this intake creates no HTTP captures. Citation review places these bindings in latestSource.documents and identifies them as retained-document. Source JSON is preserved in full, including update-to, updated-by, registered relationship attribution, deposited references and dates.

No HTTP-capture record is created. An unknown upstream retrieval time remains null. Supplied upstream status/header values, including explicit nulls, remain in the original provenance. Observed provider JSON status is validated independently of the transport.

Validation decodes all original bodies, verifies body and document identities, rebuilds the complete edition with the original selection, and compares every normalized result, coverage field, source binding and provenance field. A changed projection or body fails validation.

## Work and update coverage

The builder supports singleton work URLs and work-list queries, including registered updates filters. Singleton URLs must match the returned DOI. Work-list pages must contain a valid total-results count and DOI-bearing records.

Work-list collections retain their exact query parameters and document order. Completeness requires a retained initial cursor or offset, a continuous page sequence, consistent page size and totals, a final short page, and matching unique-record totals. Missing pages, repeated cursors, duplicate records, changed totals and uncertain page sizes produce explicit PARTIAL coverage and warning codes. An empty, complete list is valid evidence for that source query. The command does not fetch another page.

Additional filters or search terms on an updates query are labeled FILTERED_UPDATES. A selected-field projection is retained and warned about. Neither establishes complete unrestricted registered-update coverage. Original APIs may change results between pages; the original bodies and any differing work variants remain available for review. The last retained occurrence supplies the normalized record, matching the existing metadata projector's acquisition behavior.

usage.requestedDois is the expected work-identity scope. By default it combines singleton work DOI identities and update targets, or the work-list's returned DOI identities when neither exists. Optional dois makes that selection explicit; CLI --doi may be repeated. All original result records remain retained, including notices outside the selected target scope.

usage.updateRequestedDois independently identifies the DOI targets whose registered updates are being reviewed. It defaults to targets found in retained updates queries. Optional updatesDois, or repeated --updates-doi, declares additional expected targets. A supporting notice's singleton metadata does not imply that its own updates were requested. usage.missingUpdates is calculated only for this explicit update scope. usage.updatesLookup remains REQUESTED or NOT_REQUESTED, and each updates collection is explicitly document-based.

The frozen selection is stored in usage.selection so validation can replay inferred and explicit scopes exactly. The edition reports COMPLETE when the retained documentary scope has no coverage gap. Differing retained record variants remain explicit informational warnings (affectsCoverage:false); they do not imply missing source pages. Both original bodies remain available, and the last occurrence still supplies the normalized record.

## Included public retraction source

The complete five-file example retains work 10.1177/1758835919874651, notice 10.1177/17588359211061903, the filtered registered-update list, the original provenance.json and README.md. The update query returns one record from a requested 1,000-row page with total-results 1. Both publisher and Retraction Watch registration assertions remain in the original records. The retained connector transfer exposed no upstream HTTP status, headers or request timestamp; those fields remain null in its provenance.

Crossref's original source terms remain attached to the edition. Metadata reuse terms do not extend copyright permissions for third-party abstracts or article full text. Official documentation: https://www.crossref.org/documentation/retrieve-metadata/rest-api/ and https://www.crossref.org/documentation/register-maintain-records/maintaining-your-metadata/registering-updates/.
