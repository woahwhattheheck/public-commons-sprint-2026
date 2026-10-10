# SF52 — first-party seller-to-buyer x402 v2 HTTP wire acceptance

A source-integrated, no-wallet acceptance path using the **existing** SF30 seller offer compiler and SF31 buyer client. It imports ../sf30-seller-sdk/seller.mjs and ../sf31-buyer-client/buyer.mjs from the same checkout. No protocol algorithm, payment scheme, HTTP parser or SDK is recreated here.

From the repository root on **Node.js 22+**:

~~~sh
node stellar/scf-starforge-20261009/sf52-seller-buyer-wire/acceptance.mjs
node --test stellar/scf-starforge-20261009/sf52-seller-buyer-wire/test/acceptance.test.mjs
~~~

The acceptance starts an ephemeral actual Node HTTP server bound to 127.0.0.1, uses the original compileHttpSellerOffer and paymentRequiredResponse to emit a true source-generated x402 v2 PAYMENT-REQUIRED challenge on the wire, and sends six genuine HTTP POST probes from X402BuyerClient with the exact offer network, asset, recipient and decimal atomic amount.

It exercises six independently checked nonpayable cases: exact seller terms refused by an independent operator, maximum amount below quoted amount, recipient mismatch, seller price drift, network drift, and 402 resource URL drift. In all six, no signing callback or signed PAYMENT-SIGNATURE request may occur. One case must reach the policy callback; the other five must be rejected by the original client before approval. It asserts the observed HTTP method and request bytes on each of the six server-bound requests. Original payee/asset fixture values are intentionally unusable; no wallet keys, real funds, upstream facilitator, ledger, externally contacting API, GitHub Actions, paid transaction or external SCF application is involved.

The check measures **real local wire integration and policy non-execution**, not an executed Stellar payment, seller validation, provider compatibility, throughput, production security or actual chain finality. Those separate steps remain with the authorized first-party SCF SF38/SF43/Muse capture owners and the SF46 release integrator. This does not replace the SF51 Bazaar→SF32 MCP smoke: it specifically stitches SF30 seller metadata and SF31 buyer HTTP policy across their published module boundary. Use the latest actual checkout when reproducing; if source changes, record the corresponding main commit and blob SHAs.

MIT. No additional dependencies. Do not add CI workflows for this check.
