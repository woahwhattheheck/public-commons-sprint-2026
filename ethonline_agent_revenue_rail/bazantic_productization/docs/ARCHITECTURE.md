# Architecture and authority boundary

## Domains

1. **Untrusted evidence domain** — receipt/report/manifest bytes supplied for evaluation.
2. **Trusted host domain** — provider adapters, retained digest store, verified source heads, execution receipts, and the host clock.
3. **External provider domain** — GitHub, deployment host, Bazantic, Graph, Hedera, and video provider.

The pure reducer may validate shape and recompute digests, but it cannot convert a caller assertion into provider truth.

## Runtime path

```text
provider readback -> retained bytes/digests -> trusted host
trusted host -> createRecipeAuthority(...) -> branded frozen capability
untrusted retained bytes + branded capability -> evaluateRecipeFlow(...)
```

`createRecipeAuthority()` clones through canonical JSON, validates the authority shape, deep-freezes it, and brands the object in a module-local `WeakSet`. A JSON round trip or object spread produces an unbranded lookalike that `evaluateRecipeFlow()` rejects.

The constructor is a capability boundary, not an authentication service. Request handlers must not invoke it on caller-controlled values.

## State machine

- Lane B `REFUSE` -> `SKIP_PURCHASE`.
- Lane B `DEFER` -> `DEFER_PURCHASE`.
- expired Lane B receipt -> `POLICY_EXPIRED` under the host clock.
- retained Lane B `BUY`, no Lane A receipt -> `PURCHASE_NEEDED`.
- retained exact HTTP `402` -> `PAYMENT_REQUIRED`.
- retained Lane A failure -> `PURCHASE_FAILED`.
- retained settlement, no retained report -> `REPORT_MISSING`.
- retained settlement plus recomputed and cross-bound report -> `USE_REPORT`.

No state authorizes payment, wallet writes, provider mutation, submission, prize eligibility, or revenue recognition.

## Receipt binding

Lane B authority binds:

- exact receipt digest;
- verified source head;
- independent execution-evidence digest;
- host evaluation time.

Lane A authority binds the same categories for its exact settlement receipt. A settled receipt must contain a 2xx result, an independently verified transaction identifier, a service-response digest, and the exact report-payload digest.

The report binding independently retains its payload digest and service-response digest. The evaluator recomputes the payload digest and requires both report and Lane A receipt to name the same service response.

## Release path

`evaluateReleaseEvidence()` is deliberately manifest-only and permanently returns `HOLD`. It rejects any second self-authored “authority” object. A future release host must perform provider API readbacks outside this reducer and own its own integration tests and operational credentials.
