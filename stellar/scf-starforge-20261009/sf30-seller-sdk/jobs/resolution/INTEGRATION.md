# Integrate the paid-job resolution arm

Operation: **SCF-PAID-JOB-RESOLUTION-0B8D-20261012**.

The additive implementation lives entirely in `sf30-seller-sdk/jobs/resolution/**` and `sf88-operator-buyer-cli/job-workspace/resolution/**`. Compose these hooks with the current input-file receiving desk and shared download writer.

## Original source identities read

These exact preimages were read before the same team’s following input-file integration. Apply the narrow joins to the current cumulative postimage.

| Existing source | Reviewed Git blob |
|---|---|
| jobs/model.mjs, current input-file postimage | 4b8d0a5245791115576c69e20a52376ca8330a1c |
| jobs/customer.mjs | 098cbde0cd5b8504145aab1706c316aaab492f08 |
| jobs/workspace/server.mjs | 8c3ad9e0f52716254dc9ee48787e89fcba0b8174 |
| jobs/buyer.mjs | 30a4319d39204b736672d52cf9e382a376ec7947 |
| job-workspace/model.mjs | 6ed627da0d92de04f2383448fe7124fd4669c126 |
| job-workspace/server.mjs | 524b00b2f64d1d0556e1696bfdb9351bdef7d810 |
| merchant accounting workspace/adjustments-workspace.mjs | 679aaee22942811da9eb3d4a55d4264bbcc5bf52 |
| merchant accounting adjustments.mjs | 6554e1ec62d9bdae28e6bba1417ab0d65fe7ad72 |
| SF86 terms.mjs | e7de12283d30a475ca4a265258f8c403a96e90a9 |

## 1. Merchant model ownership

Import:

```js
import {openJobResolution} from './resolution/service.mjs';
```

Keep an outer `let resolution;` beside the existing runtime owners. Add the optional `resolution: resolutionOptions = {}` argument to `openJobMerchant`. Expose `get resolution() { return resolution; }` on its existing model.

Create one closure-private `const resolutionBorrow = Symbol('job-resolution-drain');`. Update `assertOpen(borrow)` to reject `closed` unconditionally and `closing` unless `borrow === resolutionBorrow`. Thread that internal optional argument through `rowFor`, `snapshot`, `get`, `customerRow`, `customerStatus`, `retry` and `cancel`. Retry/cancel must pass the same argument into their final `model.get`. Ordinary public calls do not receive this symbol.

Build the private same-owner facade after constructing the original model:

```js
const drainingModel = Object.freeze({
  directory,
  snapshot: () => model.snapshot(resolutionBorrow),
  get: id => model.get(id, resolutionBorrow),
  customerStatus: input => model.customerStatus(input, resolutionBorrow),
  retry: input => model.retry(input, resolutionBorrow),
  cancel: input => model.cancel(input, resolutionBorrow)
});
```

This borrows the original methods and store lease. It has no second writer or independent job state. The resolution service’s single-owner map remains keyed by the original public `model`.

After constructing `model`, and before its existing final freeze:

```js
try {
  resolution = await openJobResolution({
    model, drainingModel,
    accounting: resolutionOptions.accounting,
    fetchImpl: resolutionOptions.fetchImpl
  });
} catch (error) {
  await model.close();
  throw error;
}
return Object.freeze(model);
```

In original `model.close()`, await `resolution?.close()` before stopping the worker and closing the input/store leases. Keep its existing immediate `closing` marker so new public calls are rejected. Already admitted resolution work uses only its private original borrow during this drain; `closed` still rejects every call. Keep the current input producer/worker drain ordering. The resolution owner only borrows the accounting controller; its close drains its own requests and writes.

Default startup reopens the saved loopback accounting selection. Embedding may pass `accounting:{controller: originalAccountingWorkspace.adjustments}`. The model’s original `snapshot()` and `get()` continue to describe execution.

## 2. Original merchant operator host

Import:

```js
import {
  jobResolutionAssets, resolutionOperatorPath,
  handleJobResolutionOperator, readResolutionRequest,
  RESOLUTION_REQUEST_BYTES
} from '../resolution/http.mjs';
```

Register every `{route,type,bytes}` from `await jobResolutionAssets()` in the existing static asset map. The new UI is `/resolutions/`; its app and style are under that same path. Add a **Resolutions** navigation link that carries the original operator capability in the fragment.

After the original Host/Origin checks and Bearer authentication, and before dispatching ordinary job routes:

```js
if (resolutionOperatorPath(url.pathname)) {
  const value = await readResolutionRequest(request, {
        maxBytes: url.pathname === '/api/resolutions/receive'
          ? RESOLUTION_REQUEST_BYTES : 24000
      });
  const result = await handleJobResolutionOperator(model.resolution, {
    method: request.method, path: url.pathname, value
  });
  // Use the host's existing JSON and complete-file response helpers:
  // result.value -> JSON; result.file -> bytes/type/name/sha256.
  return;
}
```

Retain the original API query prohibition and admitted-request tracking. File responses set exact Content-Length, Content-Type, Content-Disposition and X-Content-SHA256. These complete small JSON responses use the existing socket; the input desk’s original verified-file download registry continues independently.

The new private routes are `/api/resolutions`, `/api/resolutions/accounting`, `/api/resolutions/connection`, `/api/resolutions/receive` and `/api/jobs/:jobId/resolution[/action]`. Actions are `reply`, `case`, `job`, `bind`, `refresh`, `preview`, `record`, `verify`, `withdraw`, `recover`, `resume`, `export` and `accountingexport`.

## 3. Original customer listener

Import the customer path predicate, handler and request reader from `./resolution/http.mjs`.

Before the existing GET/HEAD-only job branch, after the current host/origin checks, route a matching `resolutionCustomerPath(req.url)` through the same `takeCapacity` admission. Resolve its capability with the existing `token(req)`; the service rechecks it through `model.customerStatus`.

```js
const capability = token(req);
const value = await readResolutionRequest(req);
const result = await handleJobResolutionCustomer(model.resolution, {
  method: req.method, path: req.url, token: capability, value
});
```

Use the current private/no-store response headers. GET/HEAD returns the JSON receipt; `/receipt` returns its complete JSON bytes and SHA. The only customer mutations are POST `/issues` and `/messages`. Preserve query rejection, exact duplicate-header handling and the original socket/request drain. This listener borrows the merchant’s resolution service and leaves its final close to the merchant model owner.

## 4. Original customer workspace model

Import:

```js
import {openJobResolutionController} from './resolution/controller.mjs';
```

Extend the existing owner variables with `resolution`. After the existing model helper functions and original checkout/intake construction:

```js
resolution = openJobResolutionController({
  lease,
  getEntry: id => item(row(id)),
  listEntries: list,
  transport, fetchImpl, requestTimeoutMs, maxConcurrent
});
```

Expose `resolution` alongside the original `library`, `checkout` and `intake`. Add `resolution.close()` to the existing child drain before releasing the original customer workspace lease, and add `resolution?.close()` to its startup cleanup.

The callback’s ID is the original **64-character customer entry ID**. The resolution service then opens that entry’s original paid buyer directory and validates its acceptance identity. Each admitted operation owns and closes the existing kernel-held lease for that buyer’s resolution subdirectory. The parent controller’s capacity is the original customer capacity, up to four.

## 5. Original customer private HTTP host

Import:

```js
import {jobResolutionExtension} from './resolution/server.mjs';
```

Create `const resolutions = await jobResolutionExtension(model.resolution);`. Append its `additionalAssets` and `authenticatedRoute` to the original `serveLibrary` extension arrays. Keep the original library host’s authentication, signal and body reader. Its maximum-argument validator must allow `RESOLUTION_RECEIVING_BYTES` (48 MiB) for this explicit receiving route. Existing routes keep their current chosen maxima; ordinary resolution POSTs request only 24,000 bytes. Original retained documents and merchant receipt bytes are capped at 16 MiB; the complete customer carrier also contains base64 expansion, saved operations and original acceptance metadata.

**Place `resolutions.authenticatedRoute` before the existing general job-workspace route.** That original general route claims every `/api/job-workspace/` URL before checking its narrower job regex. The resolution extension handles only its exact new routes and returns false for the others.

The UI entry is `/jobs/resolutions/#ORIGINAL_TOKEN`. Add its link to the existing Jobs navigation and expose a `resolutionUrl` in the existing opened-host/launch metadata when useful. Include `model.resolution.close()` with the current checkout/intake host drain; its original parent lease stays with the model.

## 6. Installed command and API registration

Add these entries through the current cumulative distribution writer:

| Key | Source entry |
|---|---|
| command jobs-resolution | sf30-seller-sdk/jobs/resolution/cli.mjs |
| command jobs-buyer-resolution | sf88-operator-buyer-cli/job-workspace/resolution/cli.mjs |
| merchant jobs resolution API | sf30-seller-sdk/jobs/resolution/index.mjs; types index.d.mts |
| customer jobs resolution API | sf88-operator-buyer-cli/job-workspace/resolution/index.mjs; types index.d.mts |
| operating guide | sf30-seller-sdk/jobs/resolution/README.md |

Both commands run directly under Node and print JSON or help. Imports use existing source-relative dependencies. The original paid buyer and worker entrypoints stay in their current installed command registrations.

## 7. Existing original-state receiving

Use the already retained paid-job and buyer directories for the complete joined operation. Open the current merchant model and its original accounting workspace, bind the actual selected native event, and use the existing customer transport. Retain and reopen the same issue, original job decision, reviewed adjustment and customer receiving file.

The original accounting engine supplies any verified-return result. The input desk owner retains the same current native job operation. The SF36 buyer expense owner composes the original adjustment-export consumer; its existing workspace/MCP/SDK remain the receiving engine.
