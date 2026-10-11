# SF30 seller operations

A live, read-only operator surface for the **existing SF30 seller service**, with optional private aggregate history across restarts. See which API routes receive traffic, return payment challenges, fail or disconnect, compare observed UTC days and export a selected period without collecting customers or turning HTTP codes into revenue. Node 22+, no additional packages or hosted services.

For a one-command original native seller with the same SF98 fulfillment journal and live local operations, see [merchant launch](MERCHANT_LAUNCH.md).

Upstream-backed sessions also expose optional [backend availability and recovery](../UPSTREAM_AVAILABILITY.md)
in this same console. The original `/api/snapshot` and JSON export include an
`upstreams` object; read-only `/api/upstreams` serves it separately. Binding names,
capacity, failure counters and circuit state contain no backend address,
credentials, request data or payment outcomes. Ordinary seller sessions retain
their existing traffic data and optional usage history without an upstream object.

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

By default, every argument after `--` goes unchanged to existing `serve.mjs`, including `--handlers`, `--facilitator` and `--allow-local-facilitator`. Select `--upstream` before the separator to pass upstream-API options to its maintained launcher instead. This launcher does not sign, verify or settle payments; keep the existing SF30 native runtime setup. Without a facilitator it runs the original challenge-only service. Ctrl+C closes both listeners. Failed dashboard startup closes the seller rather than leaving a half-launched process.

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
await existingSellerSession.close();
await operations.close();
```

`existingSellerSession` is the original `{server, compiled, mode, ...}`. All new source is in `operations/`; no modifications to seller compilation, admission, routing or payment code are needed. `observeSellerTraffic(session)` from `traffic.mjs` also provides `snapshot()` and `detach()` without a browser listener.

## Seller capacity and readiness

This launcher passes `--max-in-flight` and `--drain-grace-ms` after its
`--` separator directly to the ORIGINAL static or upstream seller. Use
`GET /_seller/health` for the bounded request counters and
`GET /_seller/ready` for accepting versus draining state; both remain on
the original seller loopback listener. The existing operator dashboard still
reports HTTP traffic only, not successful payment settlement.

## Use

**Demand:** the first card and 60-minute chart show HTTP attempts, including retries. Route attribution uses the original SF30 compiled selector, including dynamic paths and static precedence, retaining only configured route IDs/templates. Search to isolate a route.

**Failures:** rows sort by server errors/disconnects, then traffic. HTTP 402, other 4xx, 5xx and early disconnects have separate columns. Finish/close reconcile in-flight without double-counting. Unknown paths, unsupported methods and invalid targets enter fixed aggregate buckets, not arbitrary labels.

**Handoff:** download current route CSV or JSON. Exports remain fresh even when display updates are paused. CSV cells are quoted and formula-like strings neutralized. JSON carries session/capture/start times, totals, routes, 60 minute buckets and the latest metadata-only outcomes. The separate History JSON and Daily CSV links export the applied date range and route from retained aggregate history. No request contents or persistent individual request log are generated.

## Retain and compare daily usage

Use a **different private directory for each merchant/seller service**. Keep that directory outside the public seller assets, reverse proxy, repository and shared download folders. History is off unless a directory is supplied:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/operations/launch.mjs \
  --history-dir /private/merchant-a/seller-usage --history-days 90 -- \
  --config /private/merchant-a/seller.json
```

These options belong before `--`, alongside `--operations-port` and optional `--upstream`. Original seller options remain after it. The active session checkpoints its aggregate counters every five seconds. Normal shutdown first closes the original seller, then flushes its final observations and closes operations. Reusing the same history directory on restart preserves prior daily usage and creates a separate session; it does not add the same cumulative checkpoint twice.

The same integration API accepts `historyDirectory`, `historyRetentionDays` (default 90; 1–365) and `historyCheckpointMs` (default 5000; 1000–60000):

```js
const operations = await startSellerOperations(existingSellerSession, {
  port: 8424,
  historyDirectory: '/private/merchant-a/seller-usage',
  historyRetentionDays: 90,
  historyCheckpointMs: 5000,
});
// Let existing requests finish before the final history checkpoint.
await existingSellerSession.close();
await operations.close();
```

Calling `operations.close()` alone detaches observation and saves the outstanding count at that moment; it does not turn unresolved requests into completed outcomes.

The **Usage over time** panel opens on the latest seven UTC days. Select an inclusive From/Through range and optional route, then **Apply range**. Seven-day and thirty-day shortcuts apply immediately. The table shows each retained day's attempts, HTTP outcomes, disconnects and duration histogram p95 upper bound. Its change column compares attempts with the preceding **adjacent retained calendar day inside the selected range**. Missing days remain absent rather than being invented as zero traffic. Today and a session's first observed day can have partial coverage; the comparison measures observations, not full-day demand, buyers or payment conversion.

Totals and exports follow the applied selection. Changing the controls does not silently change the table or its export selection until Apply is pressed. JSON and CSV are requested fresh from the server even if display polling is paused. A retention-clipped range is identified in the panel. History updates alongside the existing live view, at most once every fifteen seconds; hidden or paused pages stop automatic history polling.

The same protected operations listener provides:

```text
GET /api/history?from=2026-10-01&to=2026-10-11&routeId=example-route
GET /history.json?from=2026-10-01&to=2026-10-11&routeId=example-route
GET /history.csv?from=2026-10-01&to=2026-10-11&routeId=example-route
```

Omit `routeId` for all routes. History JSON uses `stellar-forge.seller-usage-history.v1` and includes the effective range, native totals/routes, retained daily counters, contributing sessions and storage status. `GET /api/snapshot` keeps the original live traffic schema and adds `usageHistory` storage metadata. History-disabled responses identify that state; they do not imply a zero-traffic saved history.

Expand **Retained sessions** to see active, finalized and interrupted checkpoint state, start/save times and the saved in-flight count. A saved in-flight value belongs to that checkpoint and is never presented as the current live balance. An interrupted session has no confirmed final flush and may omit activity after its last checkpoint. The panel also reports failed checkpoints and unreadable sessions so an incomplete history is visible. Runtime checkpoint failures do not interrupt the live seller or its payment handling. An invalid explicitly configured history directory or a directory in use causes launcher startup to fail and closes the newly started seller; correct that startup configuration before launching again.

Only one local writer may own a history directory. On Linux with accessible procfs, the private lock also retains the original process start identity, boot ID and procfs device, so a reused runtime PID after a container restart does not keep a dead writer locked. Recovery compares the original process in the same boot and procfs view and preserves its last saved session as interrupted. A live writer, a denied process read or a different host/procfs view keeps the directory owned. Older locks and systems without that process identity retain the existing PID check; clean shutdown releases their lock normally. The process identity stays in the private lock and is absent from usage exports.

Daily starts and terminal outcomes use each event's own UTC date. A request crossing midnight can start in one day and finish in the next. Daily aggregation therefore has **no in-flight field**, and daily starts need not equal that day's completions. Recent individual outcome metadata, request targets, headers, bodies, wallets, receipts and credentials are not persisted. History exports have their own operator-managed lifetime.

Unchanged idle snapshots do not rewrite the saved session file. The next UTC day still applies retention, and failed checkpoints are retried on the normal cadence. Graceful shutdown always writes a final checkpoint.

## Semantics

One request is **not** one buyer. HTTP 2xx means the server finished writing; it does **not** establish client receipt, on-chain settlement or revenue. There are no currency totals or payment controls. Existing payment/accounting components remain responsible for financial reconciliation.

Latency is arrival-to-finish/disconnect, including cancelled requests. Mean/max are measured; `latencyP95UpperBoundMs` is the upper bound of the histogram bin containing the 95th percentile, not an exact percentile. Bins: 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 15000 ms, then `">15000"`; no completions gives `null`.

Totals begin at observer attachment, not before the seller starts. Starts/completions enter their own event-time minute; long requests may finish in a different bucket. In-flight is session/route scope, not a completion bucket. Backwards wall clock changes cannot expand the ring; durations use a monotonic clock.

## Privacy and deployment

Memory is bounded by configured route count, rolling aggregate buckets and a recent-outcome ring (160 by default, maximum 2000). No request URL, query, parameter value, body, header, token, wallet, IP or receipt is retained. Only configured route metadata becomes a label. The request observer does no disk/network I/O, payment call or retry. Optional history checkpoints write aggregate snapshots outside the request path. Observer errors do not enter the seller path; `observerErrors` identifies incomplete counts.

Restart begins a new in-memory session. Optional history retains daily aggregate checkpoints across restarts; without it, export before stopping when a record is needed. Detach stops new observation while already observed requests may finish.

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


## Actual native merchant fulfillment view (SF98 integration)

The existing loopback seller operations listener now also serves **GET
/fulfillment**, a second page under the SAME local Host/Origin/CSP protections.
Its source is the existing SF98 postsettlement private journal, not inferred
HTTP status. A link is available on the original traffic dashboard.

**Integrate with the original merchant seller, not a second payment process.**
In the merchant's existing Node 22+ application, open the exact same SF98
outbox instance used by the original native settlement wrapper:

~~~js
// Imports below resolve according to your original merchant entrypoint:
const outbox = await openOutbox('/private/merchant/sf98-outbox');
const nativeFactory = async compiled => {
  const native = await createNativeSellerServer(compiled, {
    facilitatorClient: yourExistingTrustedFacilitator
  });
  return instrumentNativeSettlement(native, {
    compiled, outbox,
    onWriteFailure: () => console.error('SF98_JOURNAL_WRITE_FAILED')
  });
};
const seller = await startSellerService({
  config: yourExistingMerchantConfig,
  handlers: yourExistingHandlers,
  nativeFactory,
  port: 8423
});
const operations = await startSellerOperations(seller, {
  port: 8424, deliveryOutbox: outbox
});
console.log(operations.url + '/fulfillment');
~~~

See the real named imports, owned merchant handlers and existing facilitator
setup in the CURRENT sf98-merchant-delivery/README.md and SF30 README.
The ordinary operations/launch.mjs requires no new parameters and has not
been changed; it does not configure a native SF98 recorder by itself.

**Read endpoints** (all under existing strictly loopback GET/HEAD controls):

* /api/delivery: bounded recent 24 events and aggregate original native
  success journal, webhook accepted, pending, due retry, delayed retry and
  exhausted counts; unavailable without the actual outbox instance.
* /delivery.json and /delivery.csv: operator-downloadable metadata exports.
  Full event IDs are deterministic hashes intended for explicit named SF98
  requeue. No receipt payload, wallet, private order reference, buyer body,
  payment header or credential leaves the journal.
* /delivery.metrics: private Prometheus-compatible counters/gauges.
  Existing /metrics appends these only if an outbox is attached, otherwise
  stays the original HTTP-only output. Journal read errors leave original
  HTTP metrics available and expose a generic availability gauge.

The **same original durable SF98 outbox.rows()** drives both the UI and export.
A 7.5-second promise cache prevents browser refreshes and parallel Prometheus
scrapes from repeatedly scanning potentially large private journal files.
Only the most recent 24 events are passed to browser memory; aggregate counts
cover all recorded journal entries. No new listener, wallet, signer, payment,
automated drain, webhook request, or background delivery job is added.

Interpretation: an SF98 event means the original native SDK reported a
successful settlement with a supported receipt, not that this page
independently verified Stellar. Webhook accepted means receiver HTTP 2xx,
not that downstream merchant fulfillment necessarily completed. An exhausted
event calls for operator investigation using the existing SF98 CLI, not a
click-to-retry control. The original SF86 independent on-chain reconciliation
remains separate. Challenge-only merchants show no native settled events
unless separately instrumented as described above.

If the journal cannot be read, the fulfillment endpoint returns a generic
503 and does not expose a private state path; existing seller traffic remains
available. Keep merchant state/export files on a trusted owner machine with
the original 0700/0600 protection and never deploy this loopback listener
through the public seller reverse proxy. CSS follows existing restrained
industrial operations styling.
