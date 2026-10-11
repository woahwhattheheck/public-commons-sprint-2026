# Census address operations

This application takes one official Census address batch through retained source capture, match review, a typed dataset edition, the original dataset publisher, an SF82 merchant release, and the original SF88/SF100 customer session. The local browser and CLI open the same private workspace. Completed responses, reviews, original IDs, editions and customer attempts survive reopening.

Use it for an address list whose owner wants Census location and geographic identifiers attached to the original records: public facilities, a customer-approved site list, service locations or a research collection. A merchant edition can expose the reviewed columns and original query capabilities. It does not replace a postal-validation or building-verification service.

## Open the operator

Use Node 24 and the maintained Starforge installation with the original seller SDK dependencies. From a source checkout, run the adjacent CLI directly:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/census-geocoder/cli.mjs \
  --workspace /absolute/private/census-operations init

node stellar/scf-starforge-20261009/sf30-seller-sdk/census-geocoder/cli.mjs \
  --workspace /absolute/private/census-operations serve --port 0
~~~

The maintained command dispatch is:

~~~sh
starforge dataset geocoder --workspace /absolute/private/census-operations serve
~~~

Open the printed **operatorUrl** on that host. It contains the private session token in its URL fragment; the browser retains it in session storage and removes it from the address bar. The listener uses 127.0.0.1, authenticated API requests, a strict Host/origin check and no external page assets.

The process owns the original publisher and any seller it starts. Ctrl-C drains accepted operations, closes the original seller and publisher, then releases the workspace. Reopen the same directory; do not create a replacement workspace to recover a retained response or customer attempt. The **Open / reopen publisher** button reacquires the original publisher after a cold restart.

## 1. Select the official benchmark and vintage

**Read current benchmarks** retains the actual JSON and HTTP metadata from:

~~~text
GET https://geocoding.geo.census.gov/geocoder/benchmarks
~~~

Choose a specific returned benchmark. For geography results, **Read matching vintages** retains:

~~~text
GET https://geocoding.geo.census.gov/geocoder/vintages?benchmark=SELECTED_ID
~~~

Choose a vintage from that benchmark's returned list. The UI deliberately leaves the selection explicit. The saved batch binds the full returned benchmark/vintage objects and the original metadata hashes; a later list refresh does not change it.

Census names containing **Current** are rolling aliases. Retaining an ID alone is insufficient to describe a historical capture. This workspace keeps the original returned names, metadata, request and response together.

Choose **Locations + state, county, tract and block** for geographic identifiers, or **Locations only** when those geography columns are unnecessary. Locations-only requests do not send a vintage.

## 2. Retain and capture the original address batch

The official address-batch CSV has no header and uses these positions:

| Position | Field | Meaning |
| --- | --- | --- |
| 1 | id | Your unique record identifier; it stays text. |
| 2 | street | Street address. |
| 3 | city | City, or an empty field when ZIP is supplied. |
| 4 | state | State abbreviation, or an empty field when ZIP is supplied. |
| 5 | zip | ZIP, or an empty field when city and state are supplied. |
| 6 | urbanization | Optional Puerto Rico urbanization field. |

The application accepts 1–10,000 records within its local **5,000,000-byte** input ceiling. Preserve empty field positions. CSV quoting is supported. Each ID and street must be nonempty; provide city and state, or ZIP. If your file contains the displayed header, select that explicit option. The original UTF-8 file and the normalized submitted CSV are retained separately.

The adjacent **example-addresses.csv** contains only Census's documented public examples:

~~~csv
1,4600 Silver Hill Rd,Washington,DC,20233
2,101 Marietta St,Atlanta,GA,30303
3,101 Marietta St,,,30303
~~~

The first address is in the official API guide. The full and ZIP-only Marietta addresses are in the official User Guide. These examples are input addresses; the repository does not supply an invented batch response or a fixed expected match count.

**Retain batch and selection** freezes the original address IDs and source selection. **Submit this batch to Census** sends one multipart request to the selected original endpoint:

~~~text
POST https://geocoding.geo.census.gov/geocoder/geographies/addressbatch
addressFile = the retained submitted CSV
benchmark = the explicitly selected official benchmark ID
vintage = the explicitly selected compatible vintage ID
~~~

Locations-only uses the corresponding **locations/addressbatch** endpoint and omits vintage. Each attempt has its own retained request before dispatch. The complete response body and HTTP metadata are stored before parsing. Redirects are rejected, reads are bounded, and there is no automatic batch retry.

A completed batch returns its original captured result when reopened. For a failed or interrupted request, inspect its original details and downloaded response before explicitly choosing **Retry retained failed attempt**. A retry is a separate attempt on that same batch. To request a new observation after a successful capture, create a new batch. The Census FAQ explains that repeated whole-batch requests can produce varying outcomes; repeatedly submitting a successful batch is not a recovery mechanism.

Cancellation applies to the active Census HTTP request. Its original attempt remains retained. If a process ended after saving the response but before updating the workspace, reopening validates and adopts that response. If no complete response was retained, the attempt remains interrupted; reopening does not silently resubmit it.

## 3. Review matches and the published columns

Batch response CSV has no header and can return rows in a different order. The reader correlates the original unique IDs and restores the input order for review. It retains these original fields:

| Provider fields | Typed dataset handling |
| --- | --- |
| Match / No_Match / Tie | Original category, exposed as match_status. |
| Exact / Non_Exact | Original match type, retained separately from match status. |
| Matched address | Exact returned text. |
| Longitude, latitude | Native numeric columns plus coordinate_text containing the original coordinate token. |
| TIGER line ID and L/R side | Original text. |
| State / county / tract / block | Original zero-padded text with widths 2 / 3 / 6 / 4. |
| Tract / block GEOID | Concatenation of the complete original geographic components, retained as text. |

Census geocoding interpolates positions along MAF/TIGER address ranges. The coordinates are approximate and do not establish that a building exists at an interpolated address. Tied results are not automatically resolved to a chosen candidate. No_Match is not converted to coordinates. Missing geographic codes remain null.

The response view shows all original categories, provider match types, original IDs, matched addresses, coordinate tokens and available geographic IDs. A changed response shape remains downloadable for inspection and cannot become a reviewed edition through an assumed parser result.

Choose the dataset's exposed columns, included match categories and matched types. Exclude individual original IDs where your review requires it. **record_id** and **match_status** remain in every published edition. Omitting a result from publication never deletes it from the retained source.

Set the original dataset engine's equality filters, range fields, sortable fields and page limits. The native loader validates the resulting schema and its existing query budget. Numeric longitude/latitude use IEEE-754; retain **coordinate_text** where original decimal spelling matters. IDs, FIPS codes and GEOIDs remain strings, including leading zeros.

**Save this exact response review** binds the selections to the original batch, attempt and response hash. Later source captures or different column decisions require their own saved review.

## 4. Build, query and export the edition

A reviewed edition contains:

~~~text
edition.json                 complete file inventory and original dataset snapshot
dataset.csv                  only the reviewed rows and columns
dataset.json                 original typed dataset declaration
review.json                  exact saved review
source.json                  Census provenance and counts
seller.json                  original merchant declaration, when configured
source/
  input.csv                  original address input
  submitted.csv              exact submitted CSV
  batch.json                 original source selection and input hashes
  request.json               original attempt and submitted binding
  response.csv               unmodified official batch response
  http.json                  original HTTP exchange
  benchmarks.json
  benchmarks-http.json
  vintages.json              geography captures only
  vintages-http.json          geography captures only
  capture.json               retained external-capture manifest, when imported
~~~

To include a merchant, choose **Include this operator's public merchant terms** and enter the original supported network, asset, recipient, atomic amount and timeout with the public HTTPS origin and fixed route. These are public payment requirements; signing credentials stay in the original operator workspace. The original SF30 compiler validates the declaration.

**Build reviewed edition** delegates schema/query validation and snapshot derivation to the original dataset engine. It writes a create-only edition. If interrupted while building, the workspace retains the same build identity and continues that exact edition directory on the next build request; changed output bytes cannot be silently overwritten.

**Preview original query** executes the same native dataset query handler used by the merchant. For example, where those fields were explicitly enabled:

~~~text
limit=10&where_match_status=Match&gte_longitude=-125&lte_longitude=-66&sort=record_id
~~~

Use **Export complete portable edition** with a separate private directory. This copies the full source, review, dataset and file inventory. On another host, after transferring the complete directory through your existing authorized file channel:

~~~sh
starforge dataset geocoder reopen --directory /absolute/private/received-edition
~~~

Reopen verifies every retained file and reloads the original dataset snapshot. Export does not re-geocode the addresses, reinterpret the source selection, or create a new snapshot identity.

## 5. Operate the original publisher and merchant

**Prepare original publisher** consumes the selected complete merchant edition through the maintained field-agnostic publisher in **../socrata/publisher.mjs**. Its historical API name is **openSocrataPublisher**; Census does not add a second publication or payment engine. The same four-file export contract is used: adjacent dataset.csv, dataset.json, seller.json and source.json. The original Census provider provenance remains in source.json.

The original publisher owns the retained candidate store, dataset versions, authenticated controller, SF82 release store, original seller process and customer sessions. Its schemas retain their original names. The full shared lifecycle guide is [Socrata publisher operations](../socrata/PUBLISHING.md).

1. Select the prepared candidate and **Review current snapshot / revision**.
2. Inspect the actual candidate and current snapshot shown by the original publisher, then **Publish reviewed candidate**. The original expected-snapshot/revision checks remain authoritative.
3. Enter a release ID, label and local port. Configure the original supported facilitator when native settlement is desired. A blank facilitator starts challenge-only behavior.
4. **Stage original release**, select it, then **Activate at displayed generation**.
5. **Start selected release**. The actual listener and original runtime state are displayed. The retained dataset release uses the original authenticated loopback control transport.
6. **Drain / stop release** closes only the seller owned by this publisher. **Roll back release selection** uses the original displayed generation; a running release that differs from the selection requires the original stop/start transition.

The Census bridge does not change the current seller's data by editing its captured CSV in place. It submits the reviewed candidate through the original publication protocol. A stale review or failed publication remains in the original publisher's recoverable state; use **Recover original publication status** and the same candidate.

## 6. Use the actual buyer and reopen its acquisition

With the seller running:

1. Enter the first-page query and **Read actual offer and query**.
2. Inspect the actual offer, snapshot, resource, query and advertised payment options. Select one displayed option.
3. Enter the intended customer request ID and **Prepare reviewed buyer request**. The original buyer preparation rechecks the exact offer hash.
4. Download that original buyer request, or select an existing SF88 operator workspace configured with its native signer, transport, payer identity, policy and ledger.
5. Set the customer's maximum pages, total atomic allowance and row limit, then **Prepare / reopen original session**.
6. **Acquire eligible pages** delegates to the original SF88/SF100 session implementation. Existing native approval, policy, attempt and accounting behavior remains in that implementation.
7. **Recover original attempts**, **Account recorded pages**, and **Export complete acquisition** operate the same original session ID. They do not create replacement payment intents to hide an incomplete result.

The local console waits for the accepted original action. Closing it drains that action before releasing the publisher; it does not force-kill or blindly retry a payment. A cold reopen displays the retained session and its actual report after **Open / reopen publisher**. Its original CSV/JSONL/review exports remain under that session's retained export directory.

Challenge-only release startup and a buyer configuration are useful operator states, but they are not a completed native payment. Interpret the original returned session and attempt states directly.

## Continue a capture already made on another host

The **Import captured response** action consumes a private capture directory and sends no network request. Use it to carry actual source bytes into the operator after a separate acquisition host completed the official API request. It is also the CLI command:

~~~sh
starforge dataset geocoder --workspace /absolute/private/census-operations \
  capture.import --directory /absolute/private/original-census-capture
~~~

The directory must contain these fixed files, each a private regular file:

- **capture.json**
- **input.csv** and **submitted.csv** — the original input and exact submitted bytes, which may be the same bytes.
- **benchmarks.json** and **benchmarks-http.json** — original metadata response and HTTP exchange.
- **vintages.json** and **vintages-http.json** — required for geography captures.
- **response.csv** and **http.json** — unmodified batch response and its original HTTP exchange.

The capture manifest is:

~~~json
{
  "schema": "stellar-forge.census-geocoder-capture.v1",
  "label": "Official public address examples",
  "header": false,
  "returnType": "geographies",
  "benchmark": "4",
  "vintage": "4",
  "inputSha256": "SHA256_OF_ORIGINAL_INPUT",
  "submittedSha256": "SHA256_OF_EXACT_SUBMITTED_CSV"
}
~~~

The hashes are the real file hashes. IDs 4/4 are an example selection; use the exact metadata and selection for the original request. Locations-only uses vintage:null and omits the vintage files.

Each HTTP exchange uses the original **stellar-forge.census-geocoder-http.v1** shape returned by the exported **censusRequest**:

~~~json
{
  "schema": "stellar-forge.census-geocoder-http.v1",
  "requestedUrl": "https://geocoding.geo.census.gov/geocoder/geographies/addressbatch",
  "url": "https://geocoding.geo.census.gov/geocoder/geographies/addressbatch",
  "method": "POST",
  "status": 200,
  "contentType": "ORIGINAL_CONTENT_TYPE",
  "etag": null,
  "lastModified": null,
  "retryAfter": null,
  "startedAt": "ORIGINAL_REQUEST_START_TIME",
  "receivedAt": "ORIGINAL_RESPONSE_RECEIPT_TIME",
  "bytes": 0,
  "sha256": "SHA256_OF_ORIGINAL_RESPONSE",
  "submittedSha256": "SHA256_OF_EXACT_SUBMITTED_CSV",
  "benchmark": "4",
  "vintage": "4"
}
~~~

Replace placeholder hashes, times, content type and byte count with the actual exchange. GET benchmarks uses its exact endpoint, method:GET, benchmark:null, vintage:null and submittedSha256:null. GET vintages uses the exact benchmark query URL, benchmark:"4", vintage:null and submittedSha256:null. Original non-null ETag/Last-Modified/Retry-After values are retained when present.

Import validates exact official endpoints, successful HTTP status, selection compatibility, raw file hashes/lengths, submitted address equivalence and response IDs. It preserves the raw metadata and response bytes; it marks the new workspace attempt **IMPORTED_ORIGINAL_HTTP** and records the actual original exchange times plus the import time. It does not present the import as a newly performed HTTP request.

The import transaction retains its capture hash and selected batch/attempt IDs before writing. Reimport or interruption recovery reuses that same transaction and result. A changed capture gets its own original import identity. Do not substitute a single-address JSON example for a batch CSV response.

## CLI and embedded actions

The CLI accepts a JSON object through **--input FILE**. Select a whole action, not ad hoc mutations of private workspace files.

| Action | Required input |
| --- | --- |
| discovery.benchmarks | Empty object. |
| discovery.vintages | discoveryId, benchmark. |
| batch.create | label, inputText, header, discoveryId, benchmark, returnType; vintagesId and vintage for geographies. The CLI can supply inputText with --csv FILE. |
| batch.capture | batchId; retry:true only for an explicit subsequent failed-attempt request; optional timeoutMs. |
| capture.import | directory containing the original fixed capture files. |
| batch.review | batchId, attemptId, responseSha256, plan with selected fields/categories/query settings. |
| edition.build | reviewId; payment and origin together for merchant configuration, optional path. |
| edition.query | id, query. |
| edition.export | id, separate directory. |
| publisher.open | Empty object; opens or reopens the original publisher. |
| publisher.prepareEdition | id of a complete retained merchant edition. |
| publisher.* | Original documented publisher actions and payloads, unchanged. |
| operation.cancel | Empty object; only the active Census source HTTP request. |

Embedded applications use **openGeocoderWorkspace**, **startGeocoderServer**, **readGeocoderRecording**, **reopenEdition** and **copyEdition** from index.mjs. Use one open workspace instance and close it after accepted work drains. All publisher operations reuse one original publisher instance.

The root workspace persists selection metadata, batches, attempts, imports, reviews and edition identities. The original publisher persists its own candidate, release and buyer records. No independent scheduler, alternate signer, payment ledger, output parser or protocol emulator is introduced.

## Official source references

- [Census Geocoding Services API](https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html): request types, batch format, 10,000-record limit, metadata selection, documented Silver Hill address and multipart request.
- [Census Geocoder User Guide](https://www2.census.gov/geo/pdfs/maps-data/data/Census_Geocoder_User_Guide.pdf): public Marietta examples, no-header batch format, response fields, ID ordering and geography identifiers.
- [Census Geocoder FAQ](https://www2.census.gov/geo/pdfs/maps-data/data/Census_Geocoder_FAQ.pdf): range-interpolation meaning and repeated-batch outcome guidance.

These are the original provider contracts. Actual publication and customer acquisition use the repository's maintained dataset, SF82, SF88 and SF100 implementations.
