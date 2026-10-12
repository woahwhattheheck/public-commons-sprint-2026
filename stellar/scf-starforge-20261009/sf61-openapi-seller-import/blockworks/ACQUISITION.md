# Blockworks acquisition and retained responses

This module extends the original SF61 seller import application. It composes SF31's HTTPS/CONNECT transport and SF88's private exact-byte files and operating-system lease.

## Open a source-bound acquisition

Every method is asynchronous. The data directory is an absolute private path. The API key is selected by an environment-variable name; its value stays in the dispatch process and goes only in the native Blockworks header to the canonical API origin.

~~~js
import { openAcquisitions } from './blockworks/acquisition.mjs';

const acquisitions = await openAcquisitions({
  directory: '/private/migration/acquisitions',
  source: {
    file: '/private/migration/source/openapi.json',
    url: capturedSource.url,
    sha256: capturedSource.sha256
  },
  python: '/usr/bin/python3',
  // Optional: the original SF31 explicit CONNECT profile.
  buyerTransport: {
    mode: 'explicit-connect',
    origin: 'https://api.blockworks.com',
    proxyEnv: 'HTTPS_PROXY'
  }
});
const prepared = await acquisitions.create({
  id: 'catalog-reviewed-20261011',
  request: { path: '/query/tabular/catalog', query: { publicOnly: true } },
  review: { operator: recordedOperator, reason: 'Inspect selected catalog', sourceRef }
});
const outcome = await acquisitions.run(prepared.id);
~~~

Without a selected proxy profile, the original transport uses direct public HTTPS. It does not infer a proxy, follow redirects, attach cookies, or purchase access. An existing transport function can be injected instead. It receives {method:'GET',url,page,headers,signal} and returns {url,status,headers,body,capturedAt} with complete response bytes. The actual URL and status must be preserved.

A constructor's source applies only to new runs. Existing runs read and hash their own retained source edition when opened, run, or read. A newer constructor source cannot silently change an older run. An existing ID accepts only the same request, source, review and credential-variable name. Change a selection by creating a new reviewed run.

## Native request selection

Only GET operations under the captured OpenAPI's canonical /query/tabular/ and /query/timeseries/ paths are accepted. Parameters are validated against that retained source. Booleans, numbers and arrays remain typed in the reviewed request; arrays use the native comma-separated wire representation. Unknown parameters and undocumented path values are rejected.

A complete tabular request starts at page 1 with a fixed selected page size. Each complete response retains the native totalRows and totalPages. The next cursor advances only after the body and response metadata are durably retained and accepted. Missing totals, changing totals, duplicate entity keys and a final row-count mismatch remain reviewable; rows are never dropped to make a comparison appear complete. Asset assetID, blockchain networkID and stablecoin token id remain native identities. Stablecoin productID is a separate grouping.

Timeseries keep the exact selected timeframe or inclusive-start/exclusive-end window. The native limit is 9,000 points per series; a documented bounds:true request retains the first/last result and remains marked as a bounds selection. The reader never divides a window, changes granularity, or widens it. Series keys, entity objects, null values and ordered point_schema descriptors are preserved. An empty result without a resolved entity is distinguished from an identified empty series.

Catalogs retain complete model objects and native access metadata. Published models are not assumed anonymously accessible. HTTP401/403 is retained as access_required with complete response bytes. An authorized key can be supplied in the already-selected environment variable before resuming; the failed capture remains intact.

## Retention and restart

~~~text
acquisitions/
  sources/<source-sha256>.json
  runs/<run-id-sha256>/
    intent.json
    manifest.json
    responses/capture-<id>.body
    responses/capture-<id>.json
  rate/<provider-and-credential-reference-sha256>/state.json
~~~

The original SF88 operating-system lease serializes each run. A competing active owner receives the original lock error; a PID marker is not treated as ownership.

Before dispatch, the manifest records the exact pending GET and cursor. The complete response body is written and synced, then its immutable metadata is published, then the manifest advances. If the process ends after the complete response record was published, resume consumes those same bytes without requesting the page again. If only the request or body is retained, the attempt and any body remain available; explicit resume can repeat the same read. This subsystem has no provider-write method.

Native negative responses remain in the capture list. An error envelope cannot become an empty successful page. Retry-After is based on the response's actual capture time and retained across runs sharing the provider and credential reference. Resume honors that delay. An aborted request pauses while retaining accepted pages.

~~~js
const current = await acquisitions.get(id);
const allRuns = await acquisitions.list();
const resumed = await acquisitions.resume(id, { signal: abortController.signal });
~~~

States are ready, running, paused, review_required and completed. A review_required run has a native identity, shape or coverage problem requiring a new reviewed selection; repeatedly resuming it sends no further requests. A completed run also returns without redispatch.

## Import an existing actual capture

Muse or another authorized requesting process can provide an existing response without repeating the provider call:

~~~js
await acquisitions.importResponse(id, {
  url: retainedCapture.url,
  status: retainedCapture.status,
  headers: retainedCapture.headers,
  body: retainedCapture.body,
  capturedAt: retainedCapture.capturedAt,
  provenance: retainedCapture.provenance,
  sha256: retainedCapture.sha256
});
~~~

Supply actual complete bytes, URL, status and timestamp. An optional SHA-256 must match the body. The URL must equal the selected current cursor, including all filters and the window. Identical retained imports are idempotent. Imports cannot replace accepted pages or change the reviewed request.

## Read for mapping and comparison

~~~js
const manifest = await acquisitions.get(id);
const result = await acquisitions.readRows(id);
const captures = await Promise.all(
  manifest.captures.map(c => acquisitions.readCapture(id, c.id))
);
const mappingSide = { manifest, result, captures };
~~~

Each readCapture result is {body:Buffer,metadata}; body length and SHA-256 are verified against its immutable response record.

| readRows field | Meaning |
| --- | --- |
| kind | catalog, tabular or timeseries |
| rows | Actual catalog models or accepted native tabular rows |
| series | Original native timeseries containers with keys, entities and points |
| pointSchema | Returned ordered native point descriptors |
| metadata | Native page metadata, catalog/access data, matched-field information and provider errors |
| coverage | Accepted pages/rows, native totals, exact window/bounds and point count |
| complete | True only when native coverage and the run are complete |
| request, requestHash | Immutable reviewed request and fingerprint |
| source, sourceHash | This run's actual source edition |
| state, problem | Current retained disposition |

Failed captures remain directly readable and listed in metadata.nativeErrors. Their error documents do not become business rows. Consumers should use native coverage and identity fields instead of assuming a nonempty row list is complete.

## Portable export and reopen

~~~js
const exported = await acquisitions.exportRun(id, {
  directory: '/private/handover/catalog-reviewed-20261011'
});
const reopened = await openAcquisitions({ directory: exported.directory });
const sameRows = await reopened.readRows(id);
~~~

Choose a new explicit directory for each acquisition snapshot. An interrupted export resumes to the same path only when the original snapshot is identical. It retains the source, request/review binding, manifest, all complete successful/error responses, and body-only interrupted attempts. The final file index records paths, sizes and SHA-256 values.

Environment-variable values and live process locks are not exported. The selected credential-variable name remains in the immutable binding. A portable interrupted run can reopen and resume with that existing authorized environment configuration.

The default complete-response retention limit is128MiB, configurable at construction. A larger response is reported as a failed read; it is never relabeled as a complete truncated result. Raw bodies stay in private operation storage rather than source control.

