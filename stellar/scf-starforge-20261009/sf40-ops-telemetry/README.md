# SF-40: source-truth discovery operations (MIT / Node >=22)

A source-integrated process-level operations surface wrapping the **existing** verified `scf46-stellar-bazaar/src/catalog.mjs` `createDiscoveryServer` handler. No payment execution, ledger RPC, wallet, paid provider, or GitHub Action. It does not replace SF-20 deployment, SF-39 security review, SF-45 recovery, or SF-46 settlement/identity integration.

**Actual implemented controls:** authenticated-to-loopback only `/healthz`, `/readyz`, `/metrics`; bounded per-remote-socket-IP rate budget; bounded global in-flight admission and 503 backpressure; single-read handler with no hidden retries; bounded low-cardinality route counters, status-class counters and rolling sample p50/p95; safe observer events containing `route`, `status`, and `durationMs` **only**, never raw URL, query, IP, payment, wallet, metadata or secrets. Requests have at most 2048 active client buckets, 512 latency samples per route and six bounded route labels. All control failures return JSON and `Retry-After` for 429/503. No user-supplied `X-Forwarded-For` is trusted. The control routes also require a literal loopback HTTP `Host` (`localhost`, `127.0.0.1`, `[::1]` or IPv4-mapped loopback with a valid optional port), not merely a loopback socket address. This closes the DNS-rebinding path in which a browser connects to a loopback service with an attacker-controlled hostname. Malformed, missing or external hosts receive `403 LOCAL_ONLY`; public discovery routes are unaffected. For a reverse proxy, do not re-expose operational endpoints by rewriting arbitrary public hosts to a trusted loopback Host: keep ingress access policy/authentication independent. Side-effect-free wrapper works with source-native catalog, not arbitrary synthetic proxy data.

## Real source entrypoint

Run from the PUBLIC sprint checkout (no GitHub-hosted CI):

```sh
SF40_PORT=8780 node stellar/scf-starforge-20261009/sf40-ops-telemetry/start.mjs
curl --fail http://127.0.0.1:8780/healthz
curl --fail http://127.0.0.1:8780/readyz
curl --fail 'http://127.0.0.1:8780/discovery/resources?limit=5'
curl --fail http://127.0.0.1:8780/metrics
```

`start.mjs` deliberately creates an **empty in-memory** catalog; it proves the original server can start without a wallet or paid infrastructure, **not** that any real resource was ingested or an RPC/facilitator is healthy. Default bind is localhost. Explicit `SF40_HOST=0.0.0.0` exposes discovery and should only be used behind an external operator-managed ingress, TLS, auth/network policy and source-truth persistence; it **does not expose local-only operational endpoints** to non-loopback peers. `SF40_LOCAL_LOGS=1` prints safe bounded per-request summaries; by default no request logs.

## Production acceptance and honest limits

* `healthz` **only** indicates that this process can answer. `readyz` **only** indicates application-level handler and catalog are present and the operator `readyCheck()` resolves true. Synchronous or asynchronous probes are awaited; false results, thrown errors, rejected probes and timeouts yield HTTP 503 rather than a misleading HTTP 200. The local-only readiness timeout is `readyTimeoutMs` (default 2000 ms; valid 25–30000 ms); slow probes are not granted authority to perform payments, and probe implementations must independently bound/cancel their own network requests. Both explicitly mark ledger/RPC/settlement as `unchecked`. Do **not** advertise these as payment-service availability checks or uptime SLAs.
* `metrics` p50/p95 are exact percentiles over last at most 512 **this-process local completed requests per endpoint**. No full-time series, distributed scope, cross-worker merge, Prometheus scrape endpoint, or claim of a live p95. Deploy an authenticated external metrics aggregator only with approved operator configuration. Do not use raw addresses, query text, payment payloads, or seller metadata as metric labels.
* Before production, integrate SF-46 trust/settlement hook, persistent validated catalogs, actual Stellar testnet/persistent DB RPC probes, bounded RPC failover with validated chain/network, independent origin telemetry, and fail-closed readiness when dependencies are unavailable. Exactly-once / retry / fee correctness belongs to SF-18/33/34/45, not this read-only adapter.
* Production operator should set `maxInFlight` and rate limits from measured original provider traffic; watch 429/503 and p95, log sanitized rejection classes, alert on sustained 5xx, saturation and delta in admitted-requests, and canary with production-intent testnet validation. For failure: stop admitting, preserve authoritative receipt journal, recover without duplicated charges, re-enable only after operator-confirmed RPC/facilitator/catalog health. Never claim 99% uptime from synthetic traffic.
* Owner GitHub Actions spend reduction policy: run only the focused local `node --test stellar/scf-starforge-20261009/sf40-ops-telemetry/ops.test.mjs`. Do not add, enable or trigger hosted workflow tests for this module.

## Source and change-coupled checks

Existing exact source verified on 2026-10-10: `scf46-stellar-bazaar/src/catalog.mjs` blob `66beed7c3a4b617ab90680ec5fe8318e934e74f7`; public SF-22 HTTP handler integration `stellar-forge/discovery-resources/resources-api.test.mjs` blob `db4268f015a717b3dd5de3b351c98a50ca827712`. This wrapper invokes their actual public read handler without changing main product code. Six native Node 22 loopback/clock-focused checks exercise HTTP status, topology, 429 recovery, 503 concurrent admission, sensitive-label absence, bounded quantiles, readiness truth and safe exceptions; these are **functional checks of local ops**, not actual payment, provider uptime, deployed latency, or SCF validation.

## Zero-spend next operational measurements

After a persistent real catalog exists, request Muse/cloud original-source corpus workload replay from the existing SF-29 authentic resource pages, not a toy dataset; capture observed actual origin and spec pin; compare wrapper-on/off throughput, p50/p95 latency, errors and queue depth at multiple real catalog sizes, and exercise deliberate RPC loss only against authorized testnet with no funds. Disclose that measurements are local or testnet; only a hosted externally observed 24h window can substantiate deployment availability.
