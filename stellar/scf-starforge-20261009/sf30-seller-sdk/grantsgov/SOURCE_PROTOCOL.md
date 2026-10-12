# Grants.gov source protocol

This module captures a saved federal opportunity query, retains the complete public source behind every opportunity, and restores that same acquisition on another receiving workspace. It provides the source layer used by the Grants.gov research operator and dataset merchant.

The protocol uses the official public [search2](https://grants.gov/api/common/search2) and [fetchOpportunity](https://grants.gov/api/common/fetchopportunity) services. Both are documented without authentication. The initial native acquisition on October 12, 2026 used their current production endpoints and the exact retained search/detail responses.

Display this required [Grants.gov attribution](https://grants.gov/api/terms-conditions) in the operator:

> This product uses the Grants.gov API but is not endorsed or certified by the U.S. Department of Health and Human Services.

## Components

| Module | Responsibility |
| --- | --- |
| source.mjs | Query contract, provider data verification, exact numeric parsing, opportunity fields, source pointers, scalar dataset columns and comparisons |
| transport.mjs | Serialized public POST requests, size and time limits, provider errors and retry timing, public data extraction |
| capture.mjs | Original acquisition identity, immutable response files, per-response checkpoints, status, complete export and receiving restoration |
| acquire.mjs | Runnable source acquisition/status/export/import utility |
| ../usaspending/core.mjs | Existing canonical hashing, exact source-number parsing and decimal arithmetic |
| ../postgres/publisher/files.mjs | Existing private files, atomic JSON writes, directory synchronization and kernel-owned workspace lock |

Use Node 22.13 or newer on Linux, with util-linux flock available. The shared source-number parser requires JSON.parse source contexts; it preserves the original numeric lexeme before a JavaScript number can round it.

## Query and provider calls

normalizeQuery accepts exactly these fields. Unknown fields produce GRANTS_QUERY_FIELD_UNKNOWN rather than a silently broader search.

| Field | Input | Default and meaning |
| --- | --- | --- |
| keyword | String | Empty; original provider keyword search |
| opportunityNumber | String | Empty; original opportunity number filter |
| statuses | String array | posted and forecasted; also accepts closed and archived |
| agencies | String array | Empty; original agency codes |
| eligibilities | String array | Empty; original applicant eligibility codes |
| fundingCategories | String array | Empty; original funding activity categories |
| fundingInstruments | String array | Empty; original instrument codes |
| aln | String | Empty; assistance listing number filter |
| pageSize | Integer 1–100 | 25; this adapter's operator limit |

The normalized definition retains sorted, unique code sets. It preserves the original keyword and opportunity number text. buildSearchRequest(query, startRecord) emits rows, startRecordNum, keyword and pipe-separated oppStatuses, plus the requested nonempty optional filters. The provider's returned searchParams are compared with the requested definition. A conflicting echo is retained in coverage.

The public query field aln is sent as cfda on the current wire protocol. The October 12 source verification sent the same posted NSF artificial-intelligence query with assistance listing 47.041. The documented aln wire key was ignored: the response echoed an empty cfda and reported 19 broader results. The corrected cfda wire key echoed 47.041 and reported 8 results; the first five returned records each contained 47.041. Both original responses are retained separately, and the corrected response's public data digest is 6f61812f20e9bed112399bd06c52563d9fe642c38e78e023ce1a3749689b1fb3, captured at 2026-10-12T01:41:09.346Z. Receiving still recognizes the prior aln request spelling so its original filter mismatch remains visible.

The current response uses agency and cfdaList in search hits, and cfdas in detail records. The documentation also shows agencyName, alnist and alns; normalization accepts both source spellings. The original byte slice retains the exact spelling returned for that acquisition.

Production requests are:

- POST https://api.grants.gov/v1/api/search2
- POST https://api.grants.gov/v1/api/fetchOpportunity with {"opportunityId":363268}

The transport exposes:

~~~js
import { createGrantsTransport } from './transport.mjs';
import { normalizeQuery } from './source.mjs';

const transport = createGrantsTransport();
const query = normalizeQuery({
  keyword: 'artificial intelligence',
  statuses: ['posted', 'forecasted'],
  pageSize: 25
});
const first = await transport.search(query, 0, { signal });
const detail = await transport.detail('363268', { signal });
~~~

Each call returns a source record and its decoded payload. The search payload contains hitCount, startRecord and oppHits. The detail payload retains the complete opportunity, current and historical document variants, attachment folders, related document links, application packages and revision history.

Calls on one transport are serialized. Default spacing is at least 1,000 ms after a response. Default timeout is 30 seconds, with a maximum public response of 16 MiB. The transport retries eligible network/temporary-service failures up to three attempts. HTTP 429 uses Retry-After; a required wait beyond the configured local wait allowance returns retryAt to the caller. Authentication and permission responses remain distinct errors.

The API terms do not publish a fixed numeric request quota. The adapter's page, response, time and concurrency limits are implementation controls and are configurable within the supported ranges.

## Public source record

Every accepted search page and opportunity detail has this shape:

~~~js
{
  schema: 'stellar-forge.grantsgov-source.v1',
  kind: 'search', // or detail
  request: {
    url, method: 'POST', body,
    base64,       // exact original JSON request bytes
    sha256
  },
  response: {
    status, headers, startedAt, capturedAt,
    bodySha256,  // original complete HTTP response bytes
    bytes
  },
  envelope: {
    errorcode: 0, msg,
    excludedFields: ['token'], tokenRetained: false
  },
  data: {
    base64, sha256, bytes,
    originalSha256, byteExact, redactions,
    wirePointer: '/data'
  },
  attempts: []
}
~~~

The public data fragment is sliced from the original JSON response without reserializing its numbers, whitespace, Unicode, grant text, metadata or history. Its independent byte count and SHA-256 can be verified after receiving. The response receipt separately records the full wire response hash and length.

The current unauthenticated response envelope includes a token. This adapter does not retain or reuse that envelope token. It also removes a nonempty data.accessKey or data.token value if one is returned; such a fragment explicitly records byteExact:false, its original fragment hash, and the exact redacted pointer. All other public fields remain in the retained fragment. Empty accessKey values are ordinary source data. Portable packets therefore preserve public opportunity data and source receipts.

decodeSourceRecord verifies the exact request bytes, public data bytes, target endpoint, successful provider response, search pagination shape and detail opportunity identity. It reconstructs the lossless payload from those retained bytes.

## Original acquisition and continuation

~~~js
import {
  captureGrants, readCapture, exportCapture, importCapture, readCaptureExport
} from './capture.mjs';

const original = await captureGrants({
  directory: '/private/grants/ai-20261012',
  query: {
    keyword: 'artificial intelligence',
    statuses: ['posted', 'forecasted'],
    pageSize: 25
  },
  operationId: 'grants-ai-native-20261012',
  includeDetails: true,
  onProgress(event) {
    console.log(event.phase, event.coverage.uniqueOpportunities,
      event.coverage.detailCount);
  }
});
~~~

The capture ID is derived from the operation ID and normalized query. The initial manifest is committed before any new provider read. Each source response is then written into a stable request slot before the manifest advances:

~~~text
capture.json
publisher.lock
sources/search-0000000000.json
sources/search-0000000025.json
sources/detail-363268.json
...
~~~

A source slot holds one complete, verified response. If a process is interrupted after committing the source file but before advancing the manifest, the next call discovers and adopts that original file. It continues the same acquisition instead of fetching the already retained response again.

A repeated captureGrants call must use the original operation ID, query and includeDetails setting. A conflicting call leaves the original capture intact. A completed capture returns its verified original state without another provider request. A new source edition uses a new operation ID and private directory.

readCapture(directory) supports an in-progress acquisition. It reads one atomically committed manifest and immutable response files, returning:

~~~js
{
  schema, captureId, operationId, query,
  startedAt, updatedAt, completedAt, status,
  coverage, sourceSignature,
  header,               // original manifest
  pages: [{ ...descriptor, source }],
  details: [{ ...descriptor, source }],
  pendingSources: [],   // committed source slots not yet accepted into the manifest
  opportunities: []     // normalized from this exact retained state
}
~~~

It does not acquire the writer lock, so the research operator can display a durable partial checkpoint while acquisition continues. Each immutable research edition should retain exportCapture's packet at adoption. readCaptureExport(packet) verifies and normalizes that exact saved packet in memory; it has no filesystem or provider side effect. Later capture progress cannot change an earlier edition's source.

### Coverage

Pagination follows the returned startRecord and actual row count. The next offset is the accepted page start plus its actual row count. The capture continues through the reported result count, including a final shorter page.

Coverage preserves these separate facts:

- Whether the returned pagination reached its end.
- The first reported expected hit count and all observed count changes.
- Total received hits and unique opportunity IDs.
- Duplicate IDs across source pages.
- Whether all requested detail records are retained.
- The exact missing detail IDs and source/filter warnings.

searchComplete requires contiguous pages, a stable result count, the expected number of unique opportunities, zero repeated IDs, and matching returned filter semantics. A changing live cohort remains explicit. Reaching the final offset alone is insufficient to mark a cohort complete.

An empty source page before the reported end is retained as a pending response without advancing the accepted cursor or appending the same page twice on resume.

A partial capture preserves its accepted pages, details and original errors. Capacity limits return a partial state which can continue with a larger allowance. Temporary service errors preserve retry timing. A missing individual detail record is recorded separately while the remaining cohort continues.

## Opportunity fields and qualification

DATASET_COLUMNS defines the public scalar merchant view. Monetary values use exact decimal strings. Null remains null. No implicit Number conversion is used for award amounts.

The scalar fields include original opportunity identity; title and document type; owning and top-level agency; document revision/version; posted, closing, original due and archive dates; separate forecast dates; raw and parsed amount fields; eligibility, instrument, category and assistance listing codes; attachment/package/history counts; and original source pointers and observation time.

The rich opportunity record adds:

- description_html and a separate text rendering;
- complete eligibility type entries and the original eligibility narrative;
- current funding terms with raw amount text and parsed values;
- source date objects with raw text, companion date string, calendar date, timezone and description;
- original attachment folders/document URL manifests;
- open and closed application package manifests;
- a source-linked revision history;
- active, superseded or absent forecast-object state;
- exact search/detail source references and field pointers.

### Dates

A date is normalized to a calendar day without converting the provider's midnight timestamp into an invented application cutoff. Raw timezone text, original DateStr companion values, and explanatory deadline text remain available.

Current synopsis deadlines and forecast estimates are distinct. A posted opportunity may retain an older forecast object; its forecast fields remain historical estimates while its current funding/deadline fields come from the active synopsis. Application package opening and closing dates are also retained separately from synopsis publication dates.

A posted record with an empty closing date remains visibly unspecified. The qualification workflow can join the original narrative, package and full announcement before recording its conclusion.

### Amounts and eligibility

The current native source contains literal "none" award floor and ceiling values. The raw fields preserve "none"; the corresponding parsed decimal fields are null. A source "0" remains the exact decimal "0". Estimated program funding, an individual award ceiling/floor and expected award count retain separate meanings.

Eligibility code 25 means Other. The original narrative can explicitly include for-profit organizations even when that is the only coded eligibility entry. The operator receives both representations and a narrative-review annotation.

Original detail records contain funding-document links and attachment metadata. The manifest distinguishes the attachment ID, file name, MIME type, reported byte size and modification time. The original public detail fragment holds the complete source metadata for subsequent document acquisition.

## Portable export and receiving

~~~js
const packet = await exportCapture('/private/grants/ai-20261012');
const frozen = readCaptureExport(packet);

const receiving = await importCapture('/private/receiving/ai-20261012', packet);
if (receiving.captureId !== packet.captureId ||
    receiving.sourceSignature !== packet.sourceSignature) {
  throw new Error('Receiving identity changed');
}
~~~

The packet carries the original capture manifest bytes and every retained source file's bytes, size, path and SHA-256, including complete pending source slots. Its own digest covers the packet content. Receiving validates all members, paths, provider requests, opportunity IDs, query bindings, manifest coverage and source signatures before writing.

An existing receiving directory accepts an identical replay. It preserves an existing acquisition journal when an incoming packet differs; restore that separately named edition to its own directory. The imported capture keeps the original operation and capture ID, so an interrupted imported acquisition can continue from the original retained cursor.

exportCapture uses the source writer lock to freeze one coherent packet. The source files are immutable; the original workspace remains available after exporting.

## Command-line operation

~~~bash
node acquire.mjs capture \
  --directory /private/grants/ai-20261012 \
  --query-file /private/grants/query.json \
  --operation grants-ai-native-20261012

node acquire.mjs status --directory /private/grants/ai-20261012

node acquire.mjs export \
  --directory /private/grants/ai-20261012 \
  --output /private/grants/ai-source.json

node acquire.mjs import \
  --directory /private/receiving/ai-20261012 \
  --input /private/grants/ai-source.json
~~~

The export utility commits the complete output through a temporary file, synchronizes it, and atomically replaces its selected output path. An interrupted write leaves an existing complete output intact.

The utility also accepts an explicit seed manifest for already retained HTTP responses. Every supplied request and response is checked against its original acquisition receipt before public data extraction. The native October 12 acquisition used this route for its original first page and three already retrieved details.

The research workspace can continue from these exact records to saved queries, opportunity qualification, analyst workshares, version comparison, dataset delivery and receiving.
