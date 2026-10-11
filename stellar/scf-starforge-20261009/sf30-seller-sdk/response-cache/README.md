# Merchant response reuse in the original seller

This adds an optional application-result cache to the existing SF30 seller.
Several buyers asking for the same read-only data within a merchant's freshness
window can share one backend read. Every HTTP attempt still uses the original
admission, native verification, settlement, cancellation and response delivery.
Each buyer gets their own native payment response. Cached application bytes are
never served from a separate free HTTP endpoint.

Use it for a merchant-approved shared data product such as a public inventory
query or reference dataset. The required `shareAcrossBuyers: true` declaration
means that every admitted buyer may receive the same result for the configured
input. Each source instance has its own memory cache. No results, credentials,
payment headers or cache keys are written to disk.

## Run with existing handlers

Keep your current seller config and trusted handler module. Selected routes must
use a named `handler` and the GET or HEAD method. Create a private policy using
[example-policy.json](./example-policy.json), with keys matching your actual
seller route IDs. Then, from `sf30-seller-sdk`:

```sh
node response-cache/serve.mjs \
  --config /private/merchant/service.json \
  --handlers /private/merchant/application.mjs \
  --cache /private/merchant/cache.json \
  --socket /private/merchant/cache-control/control.sock \
  --facilitator https://your-facilitator.example/facilitator
```

The original server binds to `127.0.0.1`. Its health, developer explorer, offers,
payment terms and HTTPS deployment requirements remain the original SF30
interfaces. Omitting `--facilitator` runs the original challenge-only mode; the
cache cannot execute a handler in that mode. Native mode uses the original
`createNativeSellerServer` and the existing official x402 packages. See the
[original seller setup](../README.md#enable-the-native-x402-runtime).

For the small original local example, copy `examples/service.json` into a private
directory, replace its `response` field with `"handler": "dataset"`, retain route
ID `dataset`, and point `--handlers` to the original `examples/application.mjs`.
Use `example-policy.json`. Start without a facilitator to inspect the original
402 challenge. That example's asset and recipient are local placeholders; live
merchants supply their real existing payment terms.

Existing dataset or SQLite handler/admission exports can be selected in the same
way. Retain each route's original `admit` and `validateInput` configuration. The
wrapper always invokes original admission, including for a cache hit. If an
original availability circuit refuses a request, it still refuses before the
native payment path. Cache use never overrides an application's admission.

For sources with an explicit shutdown export, pass `--close-export NAME`. On
SIGINT/SIGTERM the launcher drains the original seller, closes the private
operator socket, aborts remaining source reads, then invokes that export.
`--max-in-flight` and `--drain-grace-ms` configure the original seller lifecycle.

## Inputs and freshness

The cache key includes the exact method and URL, preserving query order and
repeated values, original path parameters, and values of `varyHeaders`.
Requests differing in any of these values are distinct. GET and HEAD are
distinct. The handler receives this same projection and an `AbortSignal`.
Only declared `varyHeaders` reach it; payment headers, caller Authorization,
cookies, forwarding information and undeclared headers do not reach the source.
Server-side credentials remain in the existing merchant handler configuration.
Admission receives the original isolated context so existing access checks work.

Choose every header that the shared result depends on, for example
`"varyHeaders": ["accept-language"]`. A merchant-specific tenant header can be
declared when original admission authenticates it. Handlers that depend on a
caller's bearer token, object identity or arbitrary extra context properties
need their existing direct path instead of this projected shared-result mode.

`ttlMs` is an upper limit beginning when the source response completes.
The core only retains successful status-200 results, caps freshness by numeric
`max-age`/`s-maxage` minus `Age`, and declines private, no-store, no-cache,
Set-Cookie, `Vary: *` and undeclared Vary responses. Declined responses are also
not shared with coalesced followers; each follower performs its own read. Other
statuses, timeouts and invalid source output are never retained. No stale result
is served after expiry or a source failure.

Request `Cache-Control: no-cache`, `no-store`, `max-age=0`, and `Pragma: no-cache`
force an independent read without storage. Range and conditional requests are
rejected by admission before native verification. This is an application cache
with an explicit merchant freshness budget, not an HTTP proxy or a revalidation
implementation. The upstream integration can supply a stricter freshness policy
for Date/Expires/response timing. HTTP field semantics are described in
[RFC 9111](https://www.rfc-editor.org/rfc/rfc9111.html).

## Capacity and cancellation

| Policy | Default | What it controls |
| --- | ---: | --- |
| `ttlMs` | 1,000 | Maximum retained freshness, milliseconds |
| `maxEntries` | 256 | Retained distinct requests per route |
| `maxBytes` | 16 MiB | Accounted retained body, headers and entry overhead |
| `maxEntryBytes` | 1 MiB | Largest retained response body |
| `maxResponseBytes` | 1 MiB | Largest accepted source response body |
| `maxSourceInFlight` | 16 | Actual active source reads, including cancelled reads still stopping |
| `maxWaiters` | 128 | Consumers sharing one active source read |
| `sourceTimeoutMs` | 10,000 | Deadline for returning a source result |

An LRU eviction removes the least recently used retained entry when an entry or
byte budget is reached. Each buyer receives fresh copies of headers and body;
mutating one result cannot affect another. When the original server or embedding
adapter supplies an `AbortSignal`, one cancelled buyer stops waiting without
aborting other consumers. The shared source is aborted once all consumers leave.
The cache also supplies its own source deadline signal. A handler must honor
that signal to release its underlying resources;
an uncooperative timed-out handler retains its source-capacity slot until it
actually finishes, preventing repeated timeouts from starting unlimited work.
These limits cover application work; the original seller's request and payment
limits remain separate. Retained-byte limits exclude Node's object allocator and
the explicitly bounded in-flight response copies.

## Operator status and invalidation

```sh
node response-cache/control.mjs status \
  --socket /private/merchant/cache-control/control.sock
node response-cache/control.mjs invalidate \
  --socket /private/merchant/cache-control/control.sock --route dataset
```

Omit `--route` to invalidate every configured cache. Invalidation advances the
cache generation: a read already in flight can finish for its existing buyer,
but cannot populate the newly invalidated cache. Status contains counters and
budgets, without request identities, response data or source credentials. The
Unix socket requires a directory owned by the process user with mode 0700 and is
created with mode 0600. An existing socket path is never overwritten. No operator
control is mounted on the merchant's public HTTP listener.

For environments that do not support Unix sockets, use
`--control-file /private/merchant/cache-control/control.json` instead of
`--socket`. The server creates a fresh mode-0600 descriptor containing a random
local control token and an ephemeral port bound only to `127.0.0.1`; the token
is never printed. Pass `--control-file` with that same path to `control.mjs` for
status or invalidation. Every control operation requires the token from the
private descriptor. The descriptor is removed on an orderly shutdown and is
never overwritten at startup. An existing file after a crash can be retained
while a new control path is selected. Both control transports use the same
commands, response limits and route validation.

## Embedding

`createResponseCache({ handler, admit, shareAcrossBuyers: true, ...policy })`
returns `{ handler, admit, stats, invalidate, close }`. Bind those two functions
to an existing original seller route. `bindResponseCaches({config, handlers,
policy})` produces a fresh config/handler map while preserving source exports,
other routes and the input-validation setting. `startCachedSeller` composes that
binding with the original `startSellerService`; it also accepts the same explicit
native factory, lifecycle options, optional `socketPath` or `controlFile`, and
`closeSource`.

Trusted integrations may add synchronous `storagePolicy(result)` and
`bypassRequest(originalContext)` callbacks to the direct factory. A storage
decision contains optional `ttlMs` and `cacheable`; it can shorten lifetime or
disable reuse, and cannot override the core's refusals. The policy receives an
isolated encoded response and optional cloned `cacheMetadata` supplied by the
handler. That metadata is neither retained nor sent to buyers. `close()` returns
whether actual source reads drained, with a default five-second grace period.

## Focused native exercise

After installing the original optional native packages, run only:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/response-cache/acceptance.mjs
```

This one workflow uses a real local HTTP merchant backend, the original upstream
availability application and original seller, and the official x402 2.28.0 SDK.
It checks separate native verification/settlement for concurrent buyers sharing
a source result, original admission on hits, fresh native receipt headers,
private-result isolation, header variation, operator invalidation, byte-copy
isolation, cancellation, expiry and LRU eviction. Facilitator outcomes are
controlled local values; the runner performs no network settlement or wallet
operation and is not a merchant-payment claim. No hosted Actions are needed.

Recorded on Node 24.19.0 with original x402 2.28.0: PASS. Twelve concurrent
buyers shared one actual local backend read while completing twelve distinct
native verification/settlement calls. The whole workflow used six backend reads
for eighteen separately completed native request lifecycles. Private loopback
control-file status/invalidation was exercised; Unix socket listen returned the
container's `EPERM`, so that transport is retained for supporting hosts.
