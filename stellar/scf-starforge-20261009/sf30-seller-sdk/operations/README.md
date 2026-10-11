# SF30 seller operations

A live, read-only operator surface for the **existing SF30 seller service**. See which API routes receive traffic, return payment challenges, fail or disconnect, without collecting customers or turning HTTP codes into revenue. Node 22+, no additional packages or hosted services.

## Run

From the repository root:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/operations/launch.mjs -- \
  --config stellar/scf-starforge-20261009/sf30-seller-sdk/examples/service.json
```

The original seller prints its usual startup line. A second line contains the local `operations` URL (default `http://127.0.0.1:8424`). Open it, request an advertised resource, and watch route outcomes, in-flight requests, latency and the last hour of traffic. `/_seller/` metadata requests are excluded.

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/operations/launch.mjs \
  --operations-port 9001 -- --config /path/to/seller.json --port 9000
```

Every argument after `--` goes unchanged to existing `serve.mjs`, including `--handlers`, `--facilitator` and `--allow-local-facilitator`. This launcher does not sign, verify or settle payments; keep the existing SF30 native runtime setup. Without a facilitator it runs the original challenge-only service. Ctrl+C closes both listeners. Failed dashboard startup closes the seller rather than leaving a half-launched process.

## Existing API and upstream bindings

To wrap a merchant-owned API **and** observe that existing seller in one
operator command, pass `--upstream` before the argument separator. All
options after `--` go to the original upstream seller instead of the
ordinary static-response seller:

```sh
S=stellar/scf-starforge-20261009/sf30-seller-sdk
node "$S/operations/launch.mjs" --upstream --operations-port 0 -- \
  --config "$S/examples/upstream-service.json" \
  --upstreams "$S/examples/upstreams.json" \
  --allow-loopback-upstream --port 0
```

Run the fictional backend in [UPSTREAM.md](../UPSTREAM.md) before this example.
The launcher prints the same original seller URL, mode and offer/health metadata,
then the independent operations URL and snapshot path. Requests to the original
seller appear on the dashboard; challenge-only 402 responses do **not** call the
upstream API. No extra payment or monitoring implementation is introduced.
Ctrl+C stops both seller and dashboard. The fixed local backend is a separate
process. For a real merchant API, replace both configs and follow the original
facilitator/reverse-proxy instructions in UPSTREAM.md.

The default launcher syntax (without `--upstream`) is unchanged. The new option
selects only the maintained `upstream-serve.mjs` entrypoint; options after the
separator, including `--allow-loopback-upstream` and `--facilitator`, belong
to that entrypoint. Dashboard traffic metrics are not payment reconciliation.

## Integrate with the existing workspace

An existing launcher already calling `startSellerService()` can attach this surface without starting a second seller:

```js
import { startSellerOperations } from './operations/server.mjs';
const operations = await startSellerOperations(existingSellerSession, { port: 8424 });
console.log(operations.url);
// At shutdown:
await operations.close();
await existingSellerSession.close();
```

`existingSellerSession` is the original `{server, compiled, mode, ...}`. All new source is in `operations/`; no modifications to seller compilation, admission, routing or payment code are needed. `observeSellerTraffic(session)` from `traffic.mjs` also provides `snapshot()` and `detach()` without a browser listener.

## Use

**Demand:** the first card and 60-minute chart show HTTP attempts, including retries. Route attribution uses the original SF30 compiled selector, including dynamic paths and static precedence, retaining only configured route IDs/templates. Search to isolate a route.

**Failures:** rows sort by server errors/disconnects, then traffic. HTTP 402, other 4xx, 5xx and early disconnects have separate columns. Finish/close reconcile in-flight without double-counting. Unknown paths, unsupported methods and invalid targets enter fixed aggregate buckets, not arbitrary labels.

**Handoff:** download current route CSV or JSON. Exports remain fresh even when display updates are paused. CSV cells are quoted and formula-like strings neutralized. JSON carries session/capture/start times, totals, routes, 60 minute buckets and the latest metadata-only outcomes. No request contents or persistent request log are generated.

## Semantics

One request is **not** one buyer. HTTP 2xx means the server finished writing; it does **not** establish client receipt, on-chain settlement or revenue. There are no currency totals or payment controls. Existing payment/accounting components remain responsible for financial reconciliation.

Latency is arrival-to-finish/disconnect, including cancelled requests. Mean/max are measured; `latencyP95UpperBoundMs` is the upper bound of the histogram bin containing the 95th percentile, not an exact percentile. Bins: 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 15000 ms, then `">15000"`; no completions gives `null`.

Totals begin at observer attachment, not before the seller starts. Starts/completions enter their own event-time minute; long requests may finish in a different bucket. In-flight is session/route scope, not a completion bucket. Backwards wall clock changes cannot expand the ring; durations use a monotonic clock.

## Privacy and deployment

Memory is bounded by configured route count, 60 aggregate buckets and a recent-outcome ring (160 by default, maximum 2000). No request URL, query, parameter value, body, header, token, wallet, IP or receipt is retained. Only configured route metadata becomes a label. Observation does no disk/network I/O, payment call or retry. Observer errors do not enter the seller path; `observerErrors` identifies incomplete counts.

Restart begins a new in-memory session; export before stopping when a record is needed. Detach stops new observation while already observed requests may finish.

The separate operator listener binds `127.0.0.1`. Keep it outside the public seller reverse proxy. It accepts only its own loopback Host/Origin and GET/HEAD, rejects browser cross-origin access, grants no CORS permission, and serves local assets with a restrictive CSP. Display strings use text nodes. There are no arbitrary-file, network or mutation endpoints.

This is an owner-local interface, **not authentication against other local processes**. Use OS isolation on multi-user hosts. The browser requests one snapshot at a time every three seconds and pauses hidden tabs. No cloud worker or scheduled task is created.

## Focused acceptance

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/operations/acceptance.mjs
```

One actual Node HTTP exercise with controlled outcomes imports unchanged SF30 path compilation/selection. It covers attribution, outcomes, disconnects, noncollection, exports, origin/method controls, detach and rolling aggregates. It does not exercise a facilitator or assert settlement. The launcher above uses maintained `serve.mjs` directly.

Node semantics: [ServerResponse finish/close](https://nodejs.org/docs/latest-v22.x/api/http.html#class-httpserverresponse); `finish` does not establish client receipt. No additional test framework, npm install or Actions run is required.

## Recent outcomes and Prometheus

The existing dashboard now includes a searchable **Recent request outcomes**
view. It keeps only a session sequence number, completion time, configured route
ID, normalized HTTP method, outcome category, status (when sent) and duration.
Dynamic customer values, request targets, bodies and headers are never retained.
An early disconnect before headers has `status: null`, displayed as **Not sent**,
not a misleading default HTTP 200. Completed status counts exclude disconnects.

`recentLimit` is an optional setting on `startSellerOperations(session, options)`
and `observeSellerTraffic(session, options)`: 0 disables individual outcomes;
160 is the default; 2000 is the maximum. The newest terminal outcomes are returned
first. Pausing the page does not stop observation. JSON export includes this
bounded history; CSV stays route aggregates only. Downloaded exports have their
own operator-managed lifetime. Snapshot objects do not expose mutable counters.

`GET /metrics` on the SAME existing operator listener exports classic Prometheus
text, protected by its existing Host/Origin/read-only controls. No second observer,
server, collector, external call or background service is installed. Configure an
existing Prometheus instance on the operator host, when needed:

```yaml
scrape_configs:
  - job_name: sf30_seller
    static_configs:
      - targets: ['127.0.0.1:8424']
```

```promql
sum(rate(sf30_http_requests_total[5m])) by (route_id)
sum(rate(sf30_http_responses_total{status=~"5.."}[5m])) by (route_id)
sum(sf30_http_active_requests) by (route_id)
histogram_quantile(0.95, sum(rate(sf30_http_request_duration_seconds_bucket[5m])) by (le, route_id))
```

Duration keeps the original population: **arrival to finish OR disconnect**.
`sf30_http_request_duration_seconds` includes cancelled/disconnected attempts;
it is not a completed-response-only histogram. JSON `durationHistogram` contains
noncumulative bins in milliseconds, count and unrounded sum. Prometheus bins are
cumulative in seconds, with `+Inf` equal to `_count`. Exact HTTP status counts are
only finished responses. Route/method labels come from fixed original route
metadata; unknown targets retain fixed aggregate labels. No buyer, currency,
wallet, transaction or request parameter becomes a label.

This extends the already merged operations application rather than introducing
an alternative dashboard or changing its minute chart, CSV, route matcher,
launcher, mobile sticky columns or payment handling. The existing acceptance
exercise covers the extension as well; it requires no new test suite or CI.
