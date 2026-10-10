# SF52 — x402 seller visibility self-check (read-only)

## Why it exists

A real x402 seller reported that two successful Base-mainnet payments did **not** result in their resource being indexed in Coinbase CDP's Bazaar after 24+ hours ([x402#3677](https://github.com/x402-foundation/x402/issues/3677)). The x402 Foundation's [Bazaar specification](https://github.com/x402-foundation/x402/blob/main/docs/extensions/bazaar.mdx) separates x402 payment settlement from facilitator-specific catalog indexing. It also defines optional `EXTENSION-RESPONSES` statuses (`success`, `processing`, `rejected`). These are different observables; a successful payment or a valid 402 challenge does not itself prove catalog visibility.

**This tool is diagnostic, not an indexing fix**. It checks one public seller's unauthenticated 402 response, pages a configured facilitator's actual `/discovery/resources` HTTP endpoint, finds URL and payTo evidence, and optionally decodes an original settlement extension-response header. It makes **no** payment, transaction, RPC call, account login, wallet signature, catalog registration or outbound sales contact.

## Run (Node 22+)

```sh
node stellar/scf-starforge-20261009/sf52-merchant-visibility/diagnose.mjs \
  --resource https://your-seller.example/premium \
  --catalog https://your-facilitator.example/discovery/resources \
  --pay-to YOUR_PUBLIC_PAYTO \
  --network stellar:testnet \
  --limit 100 --max-pages 500
```

Options: `--extension-responses BASE64` or `--extension-responses-file PATH` accepts the actual `EXTENSION-RESPONSES` HTTP header from a **previous authorized settlement**; it does not trigger one. `--allow-loopback` enables `http://127.0.0.1` for local testing only. The tool follows no redirects, caps each HTTP response at 2 MB and does not send credentials. It reads the whole catalog unless exhausted; a truncated or failing crawl is **INCONCLUSIVE**, never an absence claim. Use the actual facilitator endpoint, not a hardcoded universal index. It neither assumes one catalog covers all facilitators nor that the network filter is honored by the provider.

Catalog row identity: the original SF46 Bazaar serializes a resource as `resource: { url: "https://...", ... }`; some external facilitators instead return `resource: "https://..."`. SF52 now reads both forms while rejecting malformed envelopes. A catalog listing must not be reported absent merely because a provider uses the original nested resource envelope. The diagnostic retains separate URL, network and payTo observations rather than treating a name-only hit as a payment proof.

Output fields: `challenge` reports the seller's observed v2 payment requirements and Bazaar extension presence, `extensionResponse` reports indexing status **only if supplied**, and `catalog` reports raw pagination/coverage, resource URL match and same-payTo alternative URLs. `LISTED` is visible at read time; `LISTED_WRONG_NETWORK` means a URL matched but no listed accepts matched the desired network; `NOT_LISTED_IN_EXHAUSTED_CATALOG` means this particular catalog did not expose the exact resource URL after an exhaustively completed scan. `INCONCLUSIVE_CATALOG` means no missing-resource conclusion is allowed.

Read-only original-source focused local Node HTTP checks:

```sh
node --test stellar/scf-starforge-20261009/sf52-merchant-visibility/test/diagnose.test.mjs
```

### Operator handoff

First capture real provider output on the approved logged-in/local runtime, note timestamp, endpoint and observed completeness. For a missing listing, inspect the original seller `PAYMENT-REQUIRED` Bazaar extension and settlement `EXTENSION-RESPONSES` before asking the facilitator operator about indexing. Do not imply that this report establishes historical settlement, seller authorization, SCF grant eligibility, Stellar mainnet acceptance or a paying customer. The public x402#3677 example uses Base (`eip155:8453`), **not Stellar**, but exposes the same cross-facilitator visibility problem that the Stellar Forge Bazaar product aims to solve. This is additive to original SF24/SF29/SF41 authentic corpus owners, SF30 seller, SF40 operator telemetry and SF51 local commerce integration; it does not overwrite those modules.

MIT.