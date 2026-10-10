# SF-43 | Two real agent-commerce exemplars: executable acceptance lane

This original Node 22 ESM code targets the Stellar Community Fund RFP's two genuinely paid integrations, not synthetic claims. It **consumes existing merged public-main owners** rather than forking a payment engine: SF-30 seller (`stellar/scf-starforge-20261009/sf30-seller-discovery/index.mjs`, [PR475](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/475)), PR451/SF-25 real catalog and validated settlement intake, SF-26 MCP capability snapshots, SF-31 buyer transport ([PR470](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/470)), SF-50 quote guard ([PR469](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/469)), SF-32 MCP tools/call owner, and SF-46 release integrator. **No deployed product, grant submission, blockchain transaction, or earned revenue is claimed by these source files.**

## Exemplar A — seller hosts a genuinely payment-gated API

Use the owner SF-30's current `createSellerDiscovery` and `makePaymentRequiredResponse` to construct original x402 v2 / Bazaar metadata from a real route. The original `example-http.mjs` at first-owner SF-30 serves a true HTTP 402, but its `DEMO_*_UNSET` placeholders are intentionally **not a payable resource**. To satisfy the real integration, use a testnet-funded recipient with matching token trustline, official `@x402/express` `paymentMiddleware`, a canonical `@x402/stellar/exact/server` mechanism, and authorized `HTTPFacilitatorClient` from `@x402/core/server`. This is the upstream-supported middleware interface, demonstrated in the [OpenZeppelin public facilitator README](https://github.com/OpenZeppelin/relayer-plugin-x402-facilitator#using-with-x402-packages-eg-x402-express). The server MUST verify/settle the submitted signature **before** returning a 200 response or passing its independent trusted settlement callback into SF-25/46's persistent catalog. Auto-discovery starts *after* an authentic settled payment; an unverified seller self-registration is not a valid shortcut.

Required actual seller proof: first unsigned request returns 402 with exact resource/method, testnet CAIP-2 network, contract ID, recipient and atomic price; signed replay is accepted only after an upstream verified settlement; response contains canonical `payment-response` receipt and protected data; trusted facilitator sends actual settled hook to SF-25/46; `GET /discovery/resources` then contains a matching, schema-validated route from the genuine transaction. Negative proofs: absent/wrong signature, non-matching network/asset/amount, cancelled payment, rejected settlement, replay, stale catalog and route drift do not unlock protected data. The existing source-coupled SF-30 `test/repo-integration.test.mjs` proves offline *software wiring only*; it does not make network settlement real.

## Exemplar B — an ordinary agent discovers price and pays via MCP

`mcp-buyer-acceptance.mjs` exports `executeDiscoveredHttpPayment` and a descriptive MCP tool contract. SF-32's original streamable-HTTP JSON-RPC server (`initialize`, `tools/list`, `tools/call`) should **import this function into its existing handler**, not duplicate or replace that server. Its function asks the source PR451 `/discovery/search` for a real seller API, requires the selection be unique, binds the exact listing quote through SF-50, observes the real HTTP 402, rejects drift **before** consent, and invokes SF-31 `X402BuyerClient` with the caller's genuine policy approval and canonical official x402 scheme signer. The ordinary agent supplies a search and resource choice: there is no hard-coded paid seller endpoint in this MCP adapter.

The live run must use a real already-listed, funded `stellar:testnet` seller, operator approval, real signing function, testnet receipt and independent onchain proof. An HTTP 200 and a seller's reported `payment-response` are not proof of the SEP-41 transfer. The independent testnet check in `verify.mjs` requires `getTransaction` SUCCESS plus a matching `transfer` emitted by the actual token contract, with exact recipient and atomic amount, decoded by `@stellar/stellar-sdk` from real RPC XDR; missing event coverage is reported distinctly.

## Real, already-deployed Stellar testnet payment baseline

[Stellar's first-party exact guide](https://developers.stellar.org/docs/tools/cli/agent-cli/guides/pay-for-apis-x402) provides a real 0.01 **testnet** USDC x402 seller at `https://stellar.org/x402-demo/api/protected/testnet`. This is a live independent upstream baseline to verify the buyer/SDK/network leg while our own seller/facilitator wiring is completed. It is **not** TJLabs's seller or a granted SCF award. Requirements: Node >=22, `npm install @x402/stellar @x402/fetch @stellar/stellar-sdk`, locally held funded testnet signer, and exact maximum approved base units **from the actual contract decimals**, never assume seven decimals.

```sh
# In THIS sf43-agent-commerce directory, with authorized local credentials
npm install --no-save @x402/stellar @x402/fetch @stellar/stellar-sdk
# Derive SF43_MAX_ATOMIC using the actual quoted asset's decimals and owner policy;
# the runner prints exact actual 402 terms and demands interactive 'PAY TESTNET'.
SF43_MAX_ATOMIC=YOUR_AUTHORIZED_ATOMIC_MAX STELLAR_SECRET="$LOCAL_TESTNET_SECRET" node live-stellar-testnet.mjs
```

No signing key is printed, committed, posted to Slack, or captured by this source. Do not execute on mainnet, send real-value funds, or use a reusable owner's mainnet seed. The runner independently queries the official read-only `https://soroban-testnet.stellar.org` RPC `getTransaction` then scoped `getEvents` for actual SEP-41 transfer; it prints whether the exact token transfer was proven, the tx hash and ledger. If the event decoder/provenance is unavailable, it does NOT upgrade to transfer proven, and can be replayed after the real event is indexed. Reference: [RPC getTransaction](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransaction), [RPC getEvents](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getEvents).

Run the focused software contract check: `node --test test/verify.test.mjs`. At initial publication this produced **8/8 PASS** in this seat's cloud container; no hosted CI or broad repository suites, and this is **not** payment proof. True E2E completion requires linked onchain seller transfer and agent MCP tool trace with provider readback, requested from authorized local/Muse runners in `#sim-data` on October 10.

## Acceptance ledger (must be filled from original provider data)

| Evidence | Required source | Initial status |
|---|---|---|
| Seller host + unmodified x402 middleware | Actual local/hosted service response and exact source SHA | Awaiting authenticated facilitator & recipient |
| Valid testnet 402 offer + Bazaar metadata | Original seller HTTP headers and SF-30 output | Offline source implemented; live seller not yet accepted |
| Auto-discovery after actual settlement | Authoritative facilitator callback into existing SF25/46/PR451 | Awaiting actual receipt/hook |
| Ordinary MCP `tools/list/call` | SF-32 live JSON-RPC trace and SF-26 matching capability snapshot | Handoff to SF-32 owner |
| Onchain testnet token transfer | Original Stellar testnet RPC tx and SEP-41 event (payTo, asset, amount) | Requested Muse/local runner; no receipt yet |
| Decline/reject/rollback | Real middleware and payer trace, no paid execution on reject | Focused negative contract cases only |
| User-visible real transaction result | Exact transaction hash, network, ledger, amount and outcome | None until a genuine event is supplied |

This lane is explicitly **not a complete SF-43 product demo** until the actual two exemplar traces, including onchain transfer, are present. The code and acceptance harness are immediately runnable where the actual official signer/testnet environment is already installed. No application, external outreach, mainnet wallet, paid Actions or grants were touched.

## October 10 SEP-41 source-format interoperability follow-up

Official [Stellar token events](https://developers.stellar.org/docs/tokens/token-interface) permit both legacy scalar `i128` and modern `{amount:i128,to_muxed_id?:...}` map transfer event values. Actual [Stellar SDK `scValToNative`](https://stellar.github.io/js-stellar-base/scval.js.html) returns a JS object for map ScVal and BigInt for i128. Previous `String(decode(event.value))` incorrectly turned correct modern event amounts into `[object Object]`, making legitimate testnet transfers unprovable.

`parseSep41TransferAmount` accepts legacy scalar and modern SDK-native map exact positive decimal atomic units; rejects non-null muxed destination, unknown map fields, unsafe/negative/zero/noncanonical amounts. The independent existing RPC `getTransaction` and `getEvents` exact token, tx, payTo, atomic amount gates still apply. Focused source-coupled test extends original `test/verify.test.mjs`; run `node --test stellar/scf-starforge-20261009/sf43-agent-commerce/test/verify.test.mjs` on authorized local checkout; actual wallet/testnet receipt still owned by original SF43/Muse.

## October 10 x402 `payer` to onchain SEP-41 transfer-source binding

The [official Stellar x402 exact scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_stellar.md) requires a `SettlementResponse.payer` (client's address, **not** facilitator fee-paying transaction source) and authorizes the token transfer `transfer(from,to,amount)` from that payer. Previous SF43 matching checked transaction hash, actual token contract, recipient and amount but not `transfer.from`, and would treat somebody else's same-token same-price transfer in a transaction as matching the seller's claimed payment. The independent RPC verifier now requires a syntactically valid G/C `receipt.payer` and the actual decoded SEP-41 event's `from` to equal it. When caller knows the actual authorized signer address it may pass `expected.payer`, which must match `receipt.payer` before RPC access; the validated return contains the payer.

This is **not** proof that a seller-provided payer belongs to the current agent or that a contract-address signer has been independently authorized. A live adopter must independently tie `expected.payer` to the real operator-approved auth entry, run real token XDR/ledger checks with the canonical Stellar SDK, and preserve actual first-party testnet receipts. No new wallet signer, billing, payment or transaction submit is added. One focused existing verifier-module test is extended for positive/negative sender provenance, including a valid C payer.

## October 10 Stellar `getEvents` cursor pagination wire fix

The official [Stellar RPC `getEvents` contract](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getEvents) requires that `startLedger` and `endLedger` be **omitted** when `pagination.cursor` is supplied. Previously the first-party SF43 on-chain verifier sent `startLedger` on every event page; the second page could be rejected by a conforming RPC, so a genuinely matching token transfer beyond the first page would remain `TX_INCLUDED_TRANSFER_UNVERIFIED` with `TOKEN_EVENTS_UNAVAILABLE`. It now sends the transaction's `startLedger` only on the first page and the opaque returned cursor on subsequent pages, preserving token contract, transaction hash, payer, recipient and exact signed atomic amount checks.

`node --test test/event-pagination.test.mjs` exercises both a successful two-page exact SEP-41 transfer and a mismatched second-page atomic amount using an offline, RPC-contract-enforcing fixture. This is a source-level compatibility check, **not** a claimed live Stellar transaction, settlement, grant award or payment receipt; use the existing SF43 authorized testnet lane for actual on-chain acceptance.
