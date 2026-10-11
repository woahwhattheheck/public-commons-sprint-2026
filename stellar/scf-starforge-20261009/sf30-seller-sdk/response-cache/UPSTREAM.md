# Reuse an upstream read through the original seller

`createCachedUpstream()` joins the existing response-cache engine to the original
`createUpstreamHandler()`. This makes repeated paid reads useful for a merchant
whose upstream API has a quota or a material per-request cost. Concurrent buyers
of the same fresh result can share one backend read; each buyer still enters the
original SF30 verification and settlement path independently.

The factory supports **GET and HEAD only**. It never caches payment headers,
verification, signatures, settlement results, or authorization decisions. Source
request forwarding, decompression, response validation, failure handling, and
optional response contracts remain in the original upstream implementation.

## Bind an existing route

The [application example](./examples/upstream-application.mjs) exports `weather`
and `weatherAdmission`. Put the trusted application module beside your existing
seller JSON, adjust its relative import to the checkout, and bind the route:

```json
{
  "handler": "weather",
  "admit": "weatherAdmission",
  "validateInput": true
}
```

Those are route fields to merge with the original route's ID, path, definition
and real payment terms. Retain the merchant's existing public resource identity,
price and recipient. `validateInput` keeps the original SF89 schema admission.
If an existing route uses custom admission, pass that function as the cache
options' `admit`; the cache controller preserves the original admission stage.
For an already availability-protected seller, retain its existing availability
admission and explicit composition. Caching does not authorize bypassing it.

Start with the original seller entrypoint:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/serve.mjs \
  --config /absolute/path/seller.json --handlers application.mjs
```

Use the original native facilitator option when configuring your existing paid
runtime. Without it, the seller emits payment challenges and never calls the
backend. The environment supplies the real merchant API origin and key; neither
value belongs in public service JSON or logs. No new server, CLI, account or
payment permission is introduced by the cache.

This adapter intentionally uses `createUpstreamHandler` directly. The declarative
upstream binding compiler has a narrower response-header allowlist and cannot
currently preserve all the HTTP freshness fields needed here. Do not put a cache
around its already stripped output and assume origin directives survived.

## Choose the sharing and cost policy

`createCachedUpstream(upstreamOptions, cacheOptions)` returns the original cache
control shape: `{handler, admit, stats, invalidate, close}`. The convenience
`createCachedUpstreamHandler()` returns the handler and attaches that controller
as `handler.cache`, admission as `handler.admit`, and stats as `handler.snapshot`.
The first argument accepts the original upstream options. The second accepts the
existing response-cache options, including an explicit `shareAcrossBuyers:true`.
The factory owns `handler`, `storagePolicy` and `bypassRequest`; those three
options cannot be overridden.

Select a TTL the product can promise buyers. A weather observation or analytics
snapshot may be reusable for seconds; a unique computation, personalized result,
mutable operation or per-buyer entitlement is not a suitable shared route.
Configure the merchant backend to declare its cache policy. An authenticated
upstream response requires `public`, `s-maxage` or `must-revalidate` before reuse;
an origin response with `private` always prevents sharing here.

| Control | Behavior |
| --- | --- |
| `ttlMs` | Merchant's maximum acceptable result age; default 1000 ms. Origin freshness can shorten it. |
| `maxEntries`, `maxBytes`, `maxEntryBytes` | Original cache entry and byte budgets. Only the current credential generation accepts new requests. |
| `maxSourceInFlight` | Also capped by upstream `maxInFlight`; enforced across all credential generations. |
| `maxWaiters` | Original limit on waiting consumers within a generation. Retain the native seller's own request-capacity limit as well. |
| `sourceTimeoutMs` | Original cache source deadline. Keep the upstream `timeoutMs` no longer than it. |
| `requestHeaders` | Every explicitly forwarded upstream header also participates in the generic cache identity. |
| `varyHeaders` | Additional noncredential input distinctions from the original cache interface. |

Each instance has one fixed upstream operation and one method. Keys retain the
exact public URL, including repeated query values and order, path parameters, and
declared request-header values. Different locales and query pages remain distinct.
Connection-nominated forwarded headers are removed before the cache strips hop
fields, preserving the original upstream forwarding contract.

## Credentials rotate as a complete generation

A synchronous configured header factory runs once for each application-handler
invocation, including a hit. Its output is normalized, validated and frozen;
that exact snapshot goes to the original transport. The factory cannot return a
Promise. Missing or invalid credentials return the original configuration failure
instead of releasing an older cached result.

Any server-header change retires the current cache. Already active calls retain
their original credentials and finish for their existing callers. Later callers
use a new generation, even if credentials subsequently rotate back to a previous
value. Once all old callers and source operations finish, the retired cache is
closed and released. Stored bytes can therefore briefly remain in an in-use old
generation; they are inaccessible to later requests. A single aggregate source
capacity prevents rapid rotation from multiplying backend concurrency.

The private equality digest and server headers never appear in cache stats,
seller output, a request parameter, or a durable file. This factory does not
change the original credential custody or environment configuration.

## Origin and buyer freshness rules

The adapter privately requests `Cache-Control`, `Vary`, `Age`, `Date`, `Expires`
and `Pragma` from the original upstream transport. It removes these extra fields
before returning the application result unless the operator explicitly included
one in their original `responseHeaders`. Private `cacheMetadata` timestamps reach
the cache policy hook only; they are neither stored nor delivered to a buyer.

The original transport also supplies two opt-in policy booleans: `hasSetCookie`
and `policyFieldsComplete`. A response carrying a session cookie cannot be shared,
although the cookie value is always stripped. A present origin freshness field
that cannot survive the original forwarding contract, including a dropped or
oversized field or ambiguous Date/Age/Expires values, also prevents reuse.

Only complete, validated HTTP 200 results are reusable. Origin `private`,
`no-store`, `no-cache`, `Pragma:no-cache`, malformed policy, or `Vary:*` disables
reuse. The existing cache also retains its own stricter response restrictions.
For a nonreusable response, coalesced followers make their own original request;
they do not receive another buyer's private result.

The freshness calculation uses `s-maxage`, then `max-age`, then `Expires` relative
to `Date`. It caps lifetime at the merchant TTL and subtracts the greater of
apparent age and `Age` plus response delay, along with time since completion.
Negative, malformed, ambiguous or expired lifetimes never become fresh. The
implementation follows the source rules in [RFC 9111 sections 3.5, 4.1, 4.2.1 and
4.2.3](https://www.rfc-editor.org/rfc/rfc9111.html), with conservative refusal of
qualified private/no-cache forms and duplicate directives.

Buyer no-cache/no-store and age preferences bypass result reuse through the
original cache hook. The original cache refuses conditional and range requests
during admission; do not declare those fields in a cached operation's forwarded
headers. Cache preferences reach the backend only when its original forwarding
contract permits them. `only-if-cached`
returns a local 504 without contacting the backend; that specialized HTTP mode
is not supported by this application cache. There is no conditional 304
revalidation, stale response fallback, background refresh or automatic retry.

## Operate it

### Original JSON launcher and merchant workspace

The existing `upstream-serve.mjs` also accepts optional `cache` in each original
`seller-upstreams.v1` binding. The binding must use GET or HEAD and explicitly
set `shareAcrossBuyers: true`. Other accepted cache fields are `ttlMs`,
`maxEntries`, `maxBytes`, `maxEntryBytes`, `maxSourceInFlight`, `maxWaiters` and
`sourceTimeoutMs`. The original transport determines `maxResponseBytes`; all
forwarded `requestHeaders` become cache variation fields. The original cache
constructor validates the final limits. Omitted cache configuration preserves
the ordinary upstream behavior.

The existing API merchant workspace provides these controls, original response
contract selection and backend availability settings in its saved package.
Its current-runtime controls inspect and invalidate cached bindings without
adding public seller write endpoints. See
[`workspace/README.md`](../../sf61-openapi-seller-import/workspace/README.md).
SF82/SF96 resume uses the same saved upstream settings and fresh credentials.

Embedding through `createUpstreamApplication()` exposes `invalidateCache(name)`
and async `close()`. The original upstream launcher attaches them as
`session.invalidateUpstreamCache` and cache-aware `session.close`; it drains the
original seller before closing caches. `session.upstreamSnapshot` includes
content-free cache activity and the configured limits.

With backend availability enabled, original `protectUpstream` observes actual
source calls before cache serialization and keeps one state across cache
invalidations. Cache hits cannot manufacture backend recovery. The adapter's
optional trusted `invokeSource(original, context)` hook supplies this existing
composition; it is never accepted from JSON and does not replace the transport.

Embedding code can inspect `weather.cache.stats()`. `sourceStarted`,
`sourceCompleted`, `sourceInFlight`, `sourceFailed` and `sourceResponseBytes` count
actual original transport invocations across generations. `cache` contains the
original core's current-generation statistics; it resets on credential rotation.
`generation`, `retiredGenerations`, `credentialRotations` and
`credentialUnavailable` explain the cache's lifetime without reporting content.
These counters describe application transport, not payments or revenue.

After the merchant updates underlying content, call `weather.cache.invalidate()`.
This retires the whole generation: a late response from an earlier read cannot
become a result for a later caller. New reads use the current original headers
and transport. During shutdown, call `weather.cache.close()` along with the
existing seller session close; await its result to use the original cache's source-cancellation
and waiter cleanup. No automatic invalidation is inferred from unrelated routes.

## Focused integration journey

`upstream-journey.mjs` runs the original upstream HTTP implementation against a
real loopback merchant server and the original cache engine. It exercises the
distinct adapter behavior: request coalescing, locale identity, header-factory
rotation and failure, origin privacy/freshness, caller cache bypass, and shared
source capacity across rotations. It does not re-run the native seller or cache
core's accepted coverage, contact a real merchant, or make a payment.

Recorded cloud Linux execution on Node 24.19.0: PASS, 14 actual loopback backend
requests and 19 header-factory evaluations. Three concurrent identical callers
shared one original HTTP request; locale and credential changes produced separate
requests; a rotated generation could not exceed the shared one-source capacity.
The source cache base was commit `debc5b9a10e4a55fce43f0268c23c9afbe1cf7de`.

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/response-cache/upstream-journey.mjs
```
