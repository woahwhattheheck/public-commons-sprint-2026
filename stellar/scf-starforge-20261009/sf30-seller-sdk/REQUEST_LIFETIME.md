# Whole-request lifetime

The original SF30 seller now has one enclosing HTTP-attempt deadline, from reading
the body through admission, native verification, application execution and native
settlement observation. It composes with `handler-execution.mjs`, not a replacement
payment path. REST methods, original native receipts, asset delivery, operation
idempotency, response caching and the original capacity/drain controller remain.

## Configure and run

Add `"requestTimeoutMs": 120000` to the existing `stellar-forge.seller-service.v1`
configuration. The default is 120,000 ms; accepted values are integers from 1 to
3,600,000 ms. `admissionTimeoutMs` and `handlerTimeoutMs` retain their independent
existing meanings. The first applicable deadline wins; a later stage never grants
a fresh whole-request budget. These limits do not extend native payment expiry.

The primary launcher also accepts an explicit override:

```sh
node serve.mjs --config seller.json --handlers application.mjs \
  --facilitator https://your-facilitator.example --request-timeout-ms 120000
```

The facilitator URL above is a placeholder, not a deployed service. Existing
upstream, database, asset and other launchers that use `readSellerConfig` and
`startSellerService` inherit the JSON setting without another payment wrapper.
Embedded callers may set `startSellerService({ ..., requestTimeoutMs })` or pass the
same option to `createSellerResourceHandler` directly. Embeddings should continue
to wrap resource dispatch with the original `createSellerLifecycle` capacity API.

## Handler contract

The existing application `signal` now also retires on the enclosing request's
deadline. `deadlineEpochMillis` provides its absolute wall-clock deadline for
cooperative downstream work; enforcement uses a monotonic clock. Pass the signal
into fetch, database and worker calls that support cancellation. The maintained
upstream handler already passes it to its socket and compressed-stream cleanup.
The separate application deadline still starts when the handler is invoked.

A normally completed incoming request is not a client disconnect. An unfinished
response closing or an incomplete request closing retires the attempt. A partial
body is not left attached to a reusable connection after a deadline response.

## Payment and capacity behavior

Before verification, retirement starts no payment operation. A native verification
that finishes after retirement is handed to the original cancellation dispatcher
once, using `after_verify_aborted`. Application errors and non-success responses
retain their existing native cancellation and receipt behavior. Cancellation
failures are observed and counted; they are never retried or described as refunds.

After settlement starts, neither disconnect nor deadline invokes cancellation,
retries settlement, or returns the application payload without a successful native
result. A connected client receives HTTP 504 when the whole-request deadline wins:

```json
{"error":"REQUEST_DEADLINE_EXCEEDED","stage":"settlement","paymentOutcome":"unconfirmed","retrySafe":false}
```

This is an HTTP observation deadline, not a claim that the native call stopped or
that payment failed. Keep the operation unconfirmed for reconciliation through the
existing merchant accounting/support flow; do not automatically replay it. The
actual native promise remains observed, including late rejection, and the original
capacity slot remains occupied until native work and cleanup finish. Likewise a
noncooperative application retains capacity until its real work completes, even
after its 504. No timeout can forcibly terminate arbitrary JavaScript or an SDK
operation that does not support cancellation. Shutdown retains the original drain
deadline and its explicit incomplete-drain outcome.

## Operator visibility

`GET /_seller/health` adds `requestLifetime` with configured request and handler
budgets, active work, deadline/disconnect counts, late verification results,
cancellation requests/errors and interrupted settlement observations. These are
process-local operational counters, not payment outcomes, refunds or revenue.
They contain no request, response, credential, account or payment payload.

## Integration exercise

The actual changed runtime was exercised with Node 22.16, real buyer/backend HTTP
sockets and a controlled native-server collaborator: all six HTTP methods and JSON
body fidelity; admission rejection; both independent deadlines; plain and gzip
backend disconnect; late verification and failing cleanup; original capacity held
through native work and noncooperative handlers; original cancellation receipts;
no settlement replay after timeout; synchronous deadline crossing; and no unhandled
late rejection. Baseline files were checked against their Git blob hashes before
composition, preserving the concurrently merged original handler and upstream work.
This exercise did not invoke a wallet, chain transaction, facilitator, asset
snapshot compiler or operation-ticket signing implementation, and adds no new
repository test suite or GitHub Actions job.
