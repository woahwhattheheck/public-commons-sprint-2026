# SF30 seller operations

A live, local traffic view for the **existing** SF30 seller service. It answers:
which routes are getting requests, which are returning payment challenges or
errors, which requests remain in flight, and where response time is increasing.
It is an operator feature, not another payment engine or external endpoint probe.

## Start the seller and its dashboard

From the full repository root, with Node 22+:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/operate.mjs \
  --ops-port 8424 -- \
  --config stellar/scf-starforge-20261009/sf30-seller-sdk/examples/service.json \
  --port 8423
```

Open **http://127.0.0.1:8424/** on the operator machine. The original seller
continues at **http://127.0.0.1:8423/**. Send an ordinary unpaid request to its
configured endpoint, for example `curl -i http://127.0.0.1:8423/dataset` with the
original example configuration. The existing challenge response and its HTTP 402
appear in the dashboard. Nothing on the dashboard sends a seller request.

Everything after `--` is passed unchanged to the original `serve.mjs` CLI.
This includes the existing `--handlers`, `--facilitator`, and explicitly local
facilitator options. Existing public-origin configuration, handler loading,
admission, native verification, cancellation and settlement remain in that
original implementation. There is no copied payment/config/native factory.

Use `--ops-port 0` for a free operator port; its actual URL is printed. A seller
port collision or operator-port failure closes the started service rather than
leaving a partial launch. SIGINT/SIGTERM use the original seller lifecycle and
close both listeners. The dashboard does not enable native payment mode; the
existing seller options do that.

## What the operator gets

**Traffic overview:** process-session request count, requests in the last 60
one-second buckets, current in-flight requests, completed HTTP 402 responses,
server errors and connections closed before completion.

**Route performance:** configured route ID, method and template; request,
in-flight, completion and abort counts; HTTP 402 / other 4xx / 5xx; response
latency histogram, mean, and p50/p95 upper bounds in the JSON API. The dashboard
shows p95. Dynamic customer identifiers never become metric labels.

**Recent outcomes:** the latest 160 in-memory outcomes, with local filtering by
route and completion/error/abort. Each includes only a session sequence number,
time, configured route ID, normalized method, completion state, status if sent,
and duration. Pause/resume affects browser refresh only, not collection.

**Exports:** download JSON from `/traffic.json`, get live machine-readable data
from `/api/traffic`, and scrape classic Prometheus text from `/metrics`.
The operator port's own requests do not count as seller traffic.

The browser uses only local static assets and refreshes its read-only snapshot
every two seconds while visible. It retains the last snapshot on disconnect and
labels it as disconnected. Narrow screens keep page controls usable and scroll
wide tables inside their own containers.

## Meaning of the numbers

The counters begin when the observer attaches and reset with a new process or
observer. They do not include traffic before attachment, HTTP parse failures,
upgrades, or sockets that never become a Node `request` event.

`completed` means the Node response emitted `finish`: its headers and body were
handed to the operating system. It **does not establish client receipt**, a
payment receipt, on-chain settlement, or revenue. This is the Node HTTP event's
contract, not an accounting inference. See the first-party [Node HTTP response
finish documentation](https://nodejs.org/api/http.html#event-finish_1).

An aborted request with no response headers has `status: null`, not the Node
object's default 200. A connection with headers but without completed output
retains its HTTP status in the recent outcome but increments only `aborted`, not
the completed-status counters or completion-latency histogram. Ordinary completed
responses' subsequent `close` event does not double-count them.

Latencies use a monotonic clock, from observer entry to response finish. Bucket
upper bounds in milliseconds are 1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500,
5000, 10000, 30000 and 60000, followed by overflow. p95 is the upper edge of the
bucket containing the corresponding observation rank; it is not an interpolated
or exact percentile. `null` means no observation when count is zero, or overflow
when count is nonzero. JSON histogram bucket counts are **noncumulative**;
Prometheus `_bucket` series are **cumulative** and use seconds, with `+Inf`
equal to `_count`. See [Prometheus metric types](https://prometheus.io/docs/concepts/metric_types/)
and [histogram guidance](https://prometheus.io/docs/practices/histograms/).

Metadata requests are labeled `@metadata`. Unmatched paths and unsupported methods
use `@unmatched`; rejected or ambiguous targets use `@invalid`. These are fixed
labels. Route selection imports the **original `selectServiceRoute`** rather than
inventing a competing matcher. HTTP-method labels have a fixed allowlist plus
`OTHER`. Configured route IDs cannot collide with the `@` labels.

## Local access and data retention

The operator server binds only to literal IPv4 loopback. It is separate from the
seller listener, so publishing the seller port does not also publish operations.
It requires its exact loopback Host, rejects foreign Origin and cross-site Fetch
Metadata, serves no CORS grants, accepts only GET/HEAD, and has no reset, execute,
proxy, configuration-write, or filesystem-browsing endpoint. Static asset names
are fixed, and content is served with a restrictive CSP and no-store headers.

These checks are **not user authentication**. Other processes/users with access
to the operator machine can read the local endpoint. Do not proxy the operator
port publicly; manage access at the operating-system boundary.

No raw URL, query, path parameter, IP, request/response body, credential, cookie,
payment header or transaction ID is retained or exported. Only configured route
templates and IDs become labels. Recent history is a fixed ring; counts and
histograms are aggregated by a finite route/method/status set. In-flight response
listeners live only until completion/disconnect. No traffic files are written,
no external service is contacted, and no collector dependency is installed.
Prometheus storage or a downloaded JSON file is an explicit operator export;
its lifetime is outside this in-memory observer.

## Embed in an existing seller

```js
import { startSellerService } from './serve.mjs';
import { startSellerOperations } from './operate.mjs';

const session = await startSellerService({ config, handlers, nativeFactory });
const operations = await startSellerOperations(session, {
  port: 8424,
  recentLimit: 160, // 0 disables individual outcomes; 2000 is the maximum.
});
console.log(operations.url);
// On application shutdown:
await operations.close();
await session.close();
```

For metrics without a web surface, use `attachSellerTraffic(session, options)`
from `traffic.mjs` and call `snapshot()` / `prometheus()`. `detach()` stops new
observations; already observed requests are allowed to complete. A second
observer on the same server is rejected while the first is attached or still
has pending requests, preventing overlapping collection by accident.

The JSON schema identifier is `stellar-forge.seller-traffic.v1`. Snapshots are
copies: a consumer modifying its returned objects cannot alter the counters.

## Prometheus on the same operator machine

```yaml
scrape_configs:
  - job_name: sf30_seller
    scrape_interval: 15s
    static_configs:
      - targets: ['127.0.0.1:8424']
```

Representative queries:

```promql
sum(rate(sf30_http_requests_total[5m])) by (route_id)
sum(rate(sf30_http_responses_total{status=~"5.."}[5m])) by (route_id)
sum(sf30_http_active_requests) by (route_id)
histogram_quantile(0.95, sum(rate(sf30_http_response_duration_seconds_bucket[5m])) by (le, route_id))
```

This is optional integration configuration, not an installed collector or a paid
service. A collector inside a different container needs an explicitly designed
local networking arrangement; this service does not bind to all interfaces.

## Focused execution

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/traffic-acceptance.mjs
```

One real loopback HTTP exercise covers unchanged response header/body delivery,
90 concurrent unique dynamic URLs, fixed grouping with no secret canary in JSON
or Prometheus, 402/503/404/400, in-flight observation, one client abort before
headers, bounded recent history, the actual operator HTTP server/assets/exports,
and method/origin/host restrictions. It uses the repository's original route
matcher and does not pretend its controlled HTTP service is a native x402
facilitator or chain transaction. It adds no GitHub Actions workflow.

For full-checkout acceptance, launch the original example with the first command,
request `/dataset` once, inspect `totals.statuses["402"]` at `/api/traffic`, and
check that the unchanged seller challenge is returned. Existing native-runtime
operators can use the same launcher and their existing application/facilitator
settings; this feature does not authorize any payment.
