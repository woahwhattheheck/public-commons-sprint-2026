# Crossref publication metadata and research enrichment

This product adds DOI publication metadata and registered editorial-update pages
to the original Starforge seller. Its retained response opens directly in the
existing research dossier. A saved OpenAlex cohort and a Crossref edition share
the same DOI evidence groups; earlier research text, selections, notes and
findings keep their original occurrences and revisions.

The installed commands are **crossref** and **crossref-dossier**. The maintained
package exposes **/seller/crossref**, **/seller/crossref/config**,
**/seller/crossref/source**, **/seller/crossref/metadata**, and
**/buyer/research-dossiers/crossref**.

## What the customer receives

Each response is an **sf88-research-results-v1** retained research envelope. It
contains the selected DOI identities, complete original Crossref response bytes,
their source URL, retrieval time, SHA-256 and public response headers. Its
readable metadata projection preserves:

- Original author order, publication title, publisher, work type and citation.
- Separate issued, online, print, creation, deposit and indexing dates, including
  the original precision of each date-parts value.
- Funders and award identifiers, license links and their content versions.
- Registered relations, update-to records, references and cited-by counts.
- The exact update query, original cursor chain, returned count and whether
  collection started at the beginning and reached its final page.

Missing fields stay absent or null. A zero-result update collection remains a
complete query result with zero returned records and its original body. Each
original source stays available inside the envelope's **originalResponses**.
The raw bodies use base64 so JSON serialization never changes their bytes.

**crossrefFieldChanges** compares publication, author, date, license, funder,
relation, update and reference fields between retained records.
**compareCrossrefMetadata** applies that comparison to two original dossier
revisions. The existing dossier provides the surrounding question, analyst
selection, finding, report and portable reopen operations.

## Configure the original merchant

Use **merchant.example.json** as the input shape. Set the actual public merchant
origin and the operator's existing Stellar network, asset, payee and price before
starting a payment-enabled service. **paymentOptions** passes through the original
SF30 compiler and native facilitator adapter.

The two product kinds are:

| Kind | Original Crossref operation | Customer input |
| --- | --- | --- |
| work | GET /works/{URL-encoded DOI} | doi |
| updates | GET /works?filter=updates:DOI | doi, optional rows and cursor |

A DOI is encoded as a complete identifier. Its internal slash and valid suffix
punctuation remain part of the DOI. The update filter follows Crossref's
comma-separated clause syntax; DOI values containing a comma use the singleton
metadata operation.

~~~sh
npx --no-install starforge crossref check --config /private/crossref.json
npx --no-install starforge crossref openapi --config /private/crossref.json --out /private/crossref-openapi.json
npx --no-install starforge crossref serve --config /private/crossref.json --state /private/crossref-source --port 8437 --operations-port 8438 --facilitator https://your-facilitator.example
~~~

Without a configured facilitator, the original seller supplies its challenge
and developer surfaces. With the existing native facilitator, the same service
uses the original payment route, handler lifecycle, input validation and
operations listener. The provider's upstream HTTP status is preserved. A changed
successful-response contract becomes a source error with its captured original
body retained locally.

**crossrefSourceOptions** reads an optional **provider.mailtoEnv** from the
operator's server environment. A configured contact selects Crossref's polite
pool through the server-owned User-Agent. The merchant input contains only the
environment variable name. Use the same source directory and account label for
processes drawing from the same Crossref pool.

## Shared source account and caching

The maintained Crossref limits effective December 1, 2025 are:

| Pool | Requests per second | Maximum concurrent requests |
| --- | ---: | ---: |
| Public singleton | 5 | 1 |
| Public list | 1 | 1 |
| Polite singleton | 10 | 3 |
| Polite list | 3 | 3 |

The source starts with these ceilings. It reads the returned
**x-rate-limit-limit**, **x-rate-limit-interval**, **x-concurrency-limit** and
**x-api-pool** headers, adopts more restrictive observed limits, and retains
HTTP 429 Retry-After cooldowns. Its account and pool identity, timing and public
header observations survive a process restart.

The gate composes the original Routescan private-file and Linux flock
primitives. A pool slot is held through the original HTTP operation. Separate
merchant processes use the same locks and the same atomic timing record.
An aborted request releases its source and pool locks.

Successful source responses are cached for 86,400 seconds by default. Configure
**cacheSeconds** from 0 through 604,800. Cache hits keep the exact capture body and
retrieval time; they do not issue another provider request. Concurrent requests
for the same DOI or update page share the same original cache miss. Failed
responses remain captured without becoming successful cache entries.

**timeoutMs** covers the wait for account capacity and the provider request.
**maxSourceBytes** limits one original HTTP body; **maxResponseBytes** limits the
complete merchant envelope. The defaults are 4 MiB source and 16 MiB delivery.
A large publication record or update page can use a smaller requested row count.

## Operate and retain a source result

The source command performs the authorized direct public metadata read and
writes a complete result that the existing dossier can open.

~~~sh
npx --no-install starforge crossref source --config /private/crossref.json --state /private/crossref-source --doi 10.1002/cphy.cp010129 --out /private/publication.json
npx --no-install starforge crossref source --config /private/crossref.json --state /private/crossref-source --doi 10.1002/cphy.cp010129 --updates --out /private/updates.json
npx --no-install starforge crossref snapshot --config /private/crossref.json --state /private/crossref-source
npx --no-install starforge crossref capture --config /private/crossref.json --state /private/crossref-source --capture-id RETAINED_CAPTURE_ID --out /private/original-capture.json
~~~

The command prints a compact original-source receipt. Output files are created
exclusively. **--refresh** requests a new original capture; otherwise the retained
cache is used. Keep the original source directory with the account when
restarting or moving the merchant.

In application code:

~~~js
import {createCrossrefSource} from '@tokenjunkielabs/starforge-merchant/seller/crossref/source';

const source = await createCrossrefSource({
  directory: '/absolute/private/crossref-source',
  account: 'crossref-public'
});
try {
  const result = await source.edition('work', {doi: '10.1002/cphy.cp010129'});
  // result.envelope is the complete retained research file.
  // result.captureId opens the exact original provider capture.
  const snapshot = await source.snapshot();
} finally {
  await source.close();
}
~~~

## Continue an existing research question

Open the original research dossier and select the existing question. The
original **Add research** flow can receive a merchant envelope as a retained
result file. Choose **crossref** as provider. The original question owns the
edition; DOI grouping connects it with its earlier OpenAlex or other research.

The installed receiving command can also acquire the question's already
selected DOI sources, then import one complete retained enrichment edition:

~~~sh
npx --no-install starforge crossref-dossier enrich --store /private/research-dossiers --id EXISTING_DOSSIER_ID --question EXISTING_QUESTION_ID --revision CURRENT_REVISION --config /private/crossref.json --state /private/crossref-source
~~~

The default receives metadata and complete registered-update collections.
**--metadata-only** selects publication metadata. **--all-sources** includes
DOI-bearing sources on that question even when not currently selected. The
original selection state is preserved.

If another analyst changes the dossier during acquisition, the original
expected-revision guard returns a conflict. The source captures remain retained;
continue using the current dossier revision to reuse them. HTTP or provider
failures remain in the acquisition result, and received source records retain
their actual coverage.

For an existing SF88 purchase:

~~~sh
npx --no-install starforge crossref-dossier import-buyer --store /private/research-dossiers --id EXISTING_DOSSIER_ID --question EXISTING_QUESTION_ID --revision CURRENT_REVISION --buyer-state /private/original-buyer-state --runtime /private/original-buyer-runtime --intent ORIGINAL_INTENT_ID
~~~

This uses the original Buyer operation recovery and **receiveBuyerResult**. Its
saved delivery status, original bytes, SHA, length and intent remain the
receiving authority.

Use the existing research-dossier selection, question, finding, comparison,
HTML/Markdown report and JSON portable export commands for the rest of the
analysis. **crossref-dossier compare** adds the field-level metadata comparison.
See **research-dossiers/CROSSREF.md** for the retained capture-pack interface.

## Provider contracts

- [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)
- [Current public and polite rate limits](https://www.crossref.org/blog/announcing-changes-to-rest-api-rate-limits/)
- [Pagination, finite date windows and caching](https://www.crossref.org/documentation/retrieve-metadata/rest-api/tips-for-using-the-crossref-rest-api/)
- [Original filter and record schemas](https://github.com/CrossRef/rest-api-doc)

Crossref metadata is reusable under its published metadata terms. Individual
abstracts may retain copyright. The complete response and its source terms
travel with each retained edition.
