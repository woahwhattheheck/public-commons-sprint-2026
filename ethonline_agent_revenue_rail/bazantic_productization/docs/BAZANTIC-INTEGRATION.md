# Bazantic integration contract — Lane C

This package owns **productization and judge evidence**, not payment authority.

## Sponsor facts this lane is built around

Current ETHOnline 2026 Bazantic rules require a Bazantic account, an x402/MPP Gateway for the project, a Recipe explaining when/why/how to use the service, and a screen-recorded working flow. The sponsor-API Recipe track additionally requires at least one other Bazantic service or ETHOnline sponsor API and a final result that depends meaningfully on both services. The “Help an Agent Use Your Hackathon Project” track requires a same-prompt/model/settings/API-access A/B comparison where the Recipe is the material difference.

The portable spec in `bazantic/recipe-spec.json` intentionally does **not** claim to be Bazantic's private/import schema. It is the semantic source of truth to enter into the live Bazantic product once the fresh public project endpoint exists.

## Lane boundary

- **Lane A** owns the real x402/Hedera request/payment/settlement verifier and fresh public project integration.
- **Lane B** owns live The Graph / Agent0 purchase-policy source, including freshness and BUY/REFUSE/DEFER truth.
- **Lane C** owns normalization, Recipe semantics, Bazantic setup checklist, A/B comparability evidence, and demo/submission package.

Lane C never turns HTTP 402 into success, never creates a Hedera transaction, never promotes stale Graph evidence, and never infers sponsor acceptance.

## Lane B interface expected

Lane B now publishes the exact `graph-purchase-decision/v1` contract in `woahwhattheheck/public-commons-sprint-2026#42`. C consumes that receipt directly through `src/lane-b-adapter.mjs` rather than maintaining a competing policy schema.

Critical bindings checked by C:

- canonical `receiptDigest` recomputes exactly over the Lane B receipt;
- `authority.payment`, `walletWrite`, `providerMutation`, and `submission` must all remain `false`;
- trusted provenance is structural, not a self-asserted live flag: `qualification.evidenceTransport`, `declaredSourceMode`, `liveGraphEvidence`, and `fixtureOnly` must be mutually consistent, and fixture/untrusted evidence can never become a C purchase path;
- `BUY` maps to the paid-service path, `SKIP` maps to stop/refuse, and `HOLD` maps to defer/refresh;
- live Graph block time gets an additional bounded C freshness fence before a payment attempt;
- Lane B `serviceUrl` and `metrics.serviceOrigin` stay bound; once B returns BUY, Lane A must report the exact same canonical HTTPS `serviceUrl` before C will accept a payment-required or settled path;
- Lane B `priceAtomic` is a canonical decimal string and must exactly equal Lane A `amountTinybar` before C accepts a payment-required or settled path.

This preserves B's BigInt money semantics end-to-end and makes a changed/tampered receipt or price mismatch fail closed.

## Lane A interface expected

Normalize A's exact response into one of:

- `PAYMENT_REQUIRED` with HTTP 402 and exact requirement digest;
- `FAILED` with a bounded reason; or
- `SETTLED` only after A independently verifies the real testnet settlement and service response.

When Lane B supplied the purchase decision, A's evidence must also carry the exact canonical `serviceUrl` B approved. Matching only price, host family, or origin is insufficient: endpoint substitution after the Graph policy decision fails closed in C.

For current Blocky402/Hedera testnet compatibility the contract expects network `hedera:testnet` and HBAR token id `0.0.0`. Lane C checks only that A's supplied evidence matches those declared values; it does not verify the chain itself.

## Live Bazantic checklist

Perform these only when project endpoint and account authority exist:

1. Sign in/create the Bazantic account and record the exact attribution username used for submission.
2. Create an x402/MPP Gateway for the fresh Agent Revenue Rail service endpoint.
3. Confirm the live Gateway exposes the priced report route and preserves real HTTP 402 vs successful paid response behavior.
4. Create the Recipe using `bazantic/recipe-spec.json` as semantic source of truth.
5. Wire the Recipe to Lane B live Graph intelligence plus Lane A project Gateway.
6. Run a refusal/defer case proving Graph truth prevents purchase.
7. Run a BUY case proving Graph truth permits the paid-service attempt and final result consumes the paid report only after verified settlement.
8. Capture actual Bazantic Recipe/Gateway identifiers and account username.
9. Do not label the integration qualified until sponsor-required live steps exist and the recording proves them.

## A/B evidence

`src/ab-evidence.mjs` enforces the same prompt/model/settings/API-access/input-fixture condition. Replace placeholder fixtures with actual captures. If any variable besides Recipe enablement changes, the verifier rejects the comparison.
