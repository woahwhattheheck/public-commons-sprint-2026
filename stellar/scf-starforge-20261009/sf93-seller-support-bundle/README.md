# SF93 · Seller runtime support handoff (existing SF30)

An actual **private, create-only support packet** from the seller and its existing loopback operations collector. This is not another seller implementation, a payment adapter, a traffic dashboard, or the separately existing SF70/74/77 merchant sales work-order pipeline. It converts the live SF30 operational state into a portable support handoff that the SF49 merchant-pilot owner can diagnose and discuss without reconstructing screenshots or inventing payment milestones.

## One operator journey

Node 22+; use the *original* seller service and operations launcher, as merged. No dependencies or external jobs.

```bash
S=stellar/scf-starforge-20261009/sf30-seller-sdk
node "$S/operations/launch.mjs" -- \
  --config "$S/examples/service.json" --port 8423
# Original seller URL: http://127.0.0.1:8423
# Existing separate operations URL: http://127.0.0.1:8424
```

After using the original seller, capture the live local counters from **another terminal**:

```bash
node stellar/scf-starforge-20261009/sf93-seller-support-bundle/bundle.mjs \
  --seller http://127.0.0.1:8423 \
  --ops http://127.0.0.1:8424 \
  --out /private/support-cases/merchant-20261011-01
```

The bundle is a new directory and is never overwritten (0700 directory, 0600 files). Parent directory must already exist. Use a **new output directory** for subsequent captures. No background service, scheduler or network connection beyond these two local loopback listeners.

## Delivered packet

* `bundle.json`: machine-readable traffic counts, session, last-hour buckets, bounded recent *metadata-only* outcomes, original public route identifiers and concise operational alerts. Amounts/payees and full offers are intentionally not copied.
* `operator-brief.md`: readable request/402/5xx/disconnect summary, high-signal route priority and interpretation. Clear 2xx ≠ payment, 402 ≠ failure, distinct sessions ≠ buyer count.
* `metrics.prom`: verbatim original SF30 Prometheus metrics fetched from the already existing listener, including the original arrival-to-finish-or-disconnect latency histogram. The collection time can differ from the JSON snapshot; never force counter equality across sequential reads.
* `manifest.json`: original endpoint response hashes/byte counts/read timestamps plus output SHA-256 sizes, bound to original observer session UUID. The original full offer response is hashed but **not** persisted.

## Scope, privacy and runtime truth

The program allows only canonical `http://127.0.0.1:PORT` origins without userinfo, paths or credentials and only issues four hardcoded GET requests: `/_seller/health`, `/_seller/offers`, `/api/snapshot`, `/metrics`. No merchant resource GET/POST, payment header, wallet, facilitator, signer, redirect, retry or automated acceptance. It accepts only expected SF30 schema, mode, route identity/number, bounded histories, aggregate conservation and metrics names, with 2 MiB per-endpoint limits and five-second timeouts. If multiple unrelated local processes expose plausible data or the seller restarts between reads, it can fail the route/mode cross-check; choose original launch pair, not random URLs.

The original observer exposes only configured route labels/templates, HTTP status, duration, sequence and counts. SF93 whitelists those fields, excluding arbitrary unexpected JSON fields. No caller URL, query, body, headers, cookies, token, customer IP, wallet key or raw offer content is included. The configured route labels themselves may reveal merchant operations; **the bundle is private and needs review before sharing**. On a multi-user host, loopback does not replace OS isolation.

`observerErrors` and a detached observer are surfaced as warnings rather than silently representing complete history. An empty 402 count doesn't prove a payment succeeded; a 2xx HTTP write doesn't prove delivery, agreement, invoice, network settlement, merchant acceptance or cash. Use original native settlement evidence separately. Runtime logs are not synthesized. No GitHub Actions usage or hosted jobs.

The core source interface is unchanged: `sf30-seller-sdk/serve.mjs`, `operations/server.mjs`, `operations/traffic.mjs`, `operations/launch.mjs` and `sf77-merchant-workorder` are imported conceptually by URL, not copied or modified here. Existing SF49 owners can attach an actual merchant support packet to the **private** relationship record, then use the separately authorized merchant-intake/SF77 work order for price and before/after repair proof. No outbound contact is performed by SF93.
