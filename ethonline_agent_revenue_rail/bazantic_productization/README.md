# Agent Revenue Rail — Bazantic Lane C

Lane C turns the landed Graph purchase decision (Lane B) and the x402/Hedera settlement path (Lane A) into a fail-closed recipe outcome. It is a donor productization surface for ETHOnline/Bazantic work; it does **not** submit a hackathon entry, authorize payment, mutate a wallet, or claim prize eligibility.

## Current status

Version `0.2.0` closes the authority gaps found on the original donor carrier:

- the public evaluator no longer accepts caller-authored `graphPolicy` objects;
- evaluation time comes from a host capability, never from evidence JSON;
- Lane B and Lane A receipts must match exact out-of-band retained digests;
- the host capability is frozen and branded in a module-local `WeakSet`, so JSON serialization destroys authority;
- `PAYMENT_REQUIRED` means exact HTTP `402` and cannot carry settlement/report truth;
- `SETTLED` must bind an independently retained transaction, service response, and recomputed report payload;
- report bytes are digest-recomputed and cross-bound to the retained Lane A service response;
- the standalone release reducer has no `READY` path. It always returns `HOLD` until a real provider-integrated host independently reads GitHub, deployment, Bazantic, Graph, Hedera, A/B, and video evidence.

## Trust boundary

Untrusted callers may supply only retained receipt/payload bytes:

```js
{
  laneBReceipt,
  laneAReceipt, // optional
  report,       // optional
}
```

A trusted host verifies provider readbacks, builds the separate capability, and invokes the evaluator:

```js
import { createRecipeAuthority, evaluateRecipeFlow } from './src/recipe-contract.mjs';

const authority = createRecipeAuthority({
  evaluatedAt: trustedClock.nowIso(),
  laneB: {
    expectedReceiptDigest: retainedLaneB.receiptDigest,
    sourceHead: verifiedLaneBSourceHead,
    executionEvidenceDigest: retainedLaneBExecutionDigest,
  },
  // Add laneA/report bindings only after their independent readbacks succeed.
});

const outcome = evaluateRecipeFlow({ laneBReceipt: retainedLaneB }, authority);
```

**Never call `createRecipeAuthority()` on request-body data.** It is a host-only capability constructor, not a validator for caller assertions.

## Run the evidence suite

```bash
npm test
npm run verify:ab
npm run demo
npm run release:gate
```

Expected behavior:

- tests pass, including actual-Lane-B integration when run from the repository checkout;
- A/B fixture verification reports a meaningful structured improvement;
- the demo prints an explicit authority `HOLD`;
- `release:gate` prints `HOLD` and exits `3` because no provider-integrated release host exists in this donor.

## Components

- `src/lane-b-adapter.mjs` — exact current Lane B schema/provenance/service binding and freshness mapping.
- `src/recipe-contract.mjs` — branded host capability, Lane A receipt contract, report digest recomputation, and state machine.
- `src/release-gate.mjs` — manifest validator that cannot self-promote to release readiness.
- `src/ab-evidence.mjs` — comparable baseline/recipe scoring with drift rejection.
- `src/offer-surface.mjs` — exact tinybar/HBAR public offer formatting with no payment authority.
- `src/config-contract.mjs` — public configuration validation and secret-shaped value rejection.

## Authority and attribution

Original product/source/finalizer credit remains **Z-Argosy-913529-AZ7C**. Independent RED review credit remains **Z-AxialMoraine-2108-V6R2**. Authority-repair/recovery work is **Z-TungstenOrchard-2150-F7K2 (GPT-5.6 Pro)**.
