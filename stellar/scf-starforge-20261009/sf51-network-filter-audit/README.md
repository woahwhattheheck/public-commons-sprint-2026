# SF-51 — Original Bazaar network-filter acceptance audit

MIT. An additive acceptance instrument for **real original facilitator GET /discovery/resources raw response pages**, not another provider crawler or settlement implementation. It arose from direct October 10, 2026 observations where OpenX402 and Kobaru returned Base-only items for the `network=stellar:testnet` query. Existing collectors SF-29 and SF-41 retain their original owners and source.

The [official x402 Bazaar extension specification](https://github.com/x402-foundation/x402/blob/main/specs/extensions/bazaar.md) defines `network` as an optional **query filter** for `GET /discovery/resources`. The fact that it is optional for the *caller* does not make the result-network filter optional after the caller selects it. Each returned resource should have at least one `accepts[]` option on the requested CAIP-2 network.

## Real data flow

Use the **already merged** [SF-29 original-response collector](../../../tools/stellar_bazaar_interop/README.md) or an authorized native GET capture to preserve actual filtered and control HTTP 200 JSON response bytes in two files. Both captures must use the **same original HTTPS facilitator path** and all identical query parameters except `network`. Preserve actual UTC capture timestamps; don't substitute placeholder responses or extract HTML to claim raw-byte provenance. Capture every original offset page rather than using a couple example rows for provider-wide coverage. The standalone audit only evaluates supplied bytes and records their SHA-256; it never accesses a network or payment origin.

```sh
node stellar/scf-starforge-20261009/sf51-network-filter-audit/network-filter.mjs \
  --filtered /tmp/original-stellar-page.json \
  --control /tmp/original-base-page.json \
  --filtered-url 'https://actual-provider.example/discovery/resources?network=stellar%3Atestnet&limit=100&offset=0' \
  --control-url 'https://actual-provider.example/discovery/resources?network=eip155%3A8453&limit=100&offset=0' \
  --network stellar:testnet \
  --filtered-at '2026-10-10T06:00:00Z' \
  --control-at '2026-10-10T06:00:10Z' \
  --out /tmp/provider-network-filter-audit.json
```

*Replace the illustrative host, timestamps, paths and content with the ACTUAL observed values.* Repeat on every original page and provider, preserving full result coverage; don't imply a single page measures the whole corpus. `filtered_sha256` and `control_sha256` attest only to those local captured bytes. Exact raw equality, page resource identity parity, pagination totals, and all observed wrong-network rows are emitted. `buyer_safe_candidates` counts safe *network-eligible candidates only*; it is not seller verification or authorization to spend. Import `selectNetworkResources(items, network)` to retain only provider `accepts` matching the requested network, regardless of whether the remote filter works. Downstream callers MUST independently enforce trusted seller/recipient, exact asset/price, valid authorization and spend policy.

## Actual observations and handoff

On October 10, 2026 a read-only live browser extraction of first-party GETs showed OpenX402 `/discovery/resources` with `network=stellar:testnet` returned 2 Base-network items out of `pagination.total=63`; Kobaru returned 2 Base-network items out of total 2. Repeating each URL with `network=eip155:8453` returned the same resource identities and totals. PayAI returned empty `items[]`/total 0 for Stellar. The extracted pages are not preserved original JSON bytes in this publication and this note DOES NOT report SHA for them. Original provider-capture follow-up is routed to existing SF-29/SF-41/Muse owners in [#sim-data source thread](https://tokenjunkielabs.slack.com/archives/C0C1F274SGH/p1791614124619379); the `network-filter.mjs` runner is ready to attach exact captures to a source-verifiable report.

`focused.test.mjs` is a single focused software check against an upstream-published example envelope, not a paid test, external simulation, operator-health claim, SCF application, merchant enrollment or evidence of real Stellar settlement.

No wallet, private credentials, GitHub Actions, external communications or grant submission.
