# Agent Revenue Rail — Bazantic Productization Lane C

Zero-dependency Node package for the ETHOnline 2026 **Agent Revenue Rail** productization seam. It makes live The Graph intelligence load-bearing for a paid-service decision, preserves Lane A's x402/Hedera settlement truth, and emits deterministic Bazantic-facing outcomes plus A/B demo evidence.

## What it proves

- fresh `BUY` policy can progress to the priced report service;
- `REFUSE`, `DEFER`, or stale Graph policy prevents the purchase path;
- HTTP `402` stays `PAYMENT_REQUIRED`, never payment success;
- a report becomes usable only after Lane A says settlement is `SETTLED`, `upstreamVerified=true`, and supplies a transaction hash;
- payment amount is a canonical non-negative decimal string in tinybar; network/token are constrained to `hedera:testnet` / HBAR `0.0.0` for the current Blocky402 testnet contract;
- wrong network/token, future evidence, malformed digests and unknown authority-shaped fields fail closed;
- A/B evidence rejects prompt, model, settings, API-access, or input-fixture drift so Recipe enablement is the material experimental difference.

## Run

```bash
npm test
npm run demo
npm run verify:ab
npm run release:gate  # intentionally HOLDs on the shipped placeholder packet
```

## Files

- `src/recipe-contract.mjs` — deterministic Lane A + Lane B -> Lane C normalization.
- `src/lane-b-adapter.mjs` — exact adapter for the published Lane B `graph-purchase-decision/v1` receipt, including digest/authority/provenance/freshness/price and exact `serviceUrl` binding.
- `src/atomic.mjs` — canonical decimal-string atomic-money helpers; no safe-integer ceiling on public prices.
- `src/offer-surface.mjs` — exact integer tinybar pricing and HBAR display.
- `src/config-contract.mjs` — strict public, secret-free integration config.
- `src/release-gate.mjs` — fail-closed live-evidence completeness gate; never grants submission/prize/payment authority.
- `src/ab-evidence.mjs` — Bazantic A/B comparability and outcome rubric evidence.
- `bazantic/recipe-spec.json` — portable semantic Recipe spec; deliberately **not** represented as Bazantic's private/import schema.
- `fixtures/` — synthetic success/refusal/402 and A/B examples.
- `docs/BAZANTIC-INTEGRATION.md` — live integration checklist and ownership boundaries.
- `docs/DEMO-RUNBOOK.md` — 2–4 minute judge/demo capture plan.
- `docs/CAPABILITY-MATRIX.md`, `SPONSOR-FIT.md`, `ARCHITECTURE.md`, `RELEASE-CHECKLIST.md` — whole-product integration and claim boundaries.

## Authority boundary

This package does **not** create a Bazantic account, register a live Gateway, execute payment, verify Hedera, deploy a service, or claim sponsor acceptance. Those facts must come from live integrations and be recorded exactly. Lane C only normalizes already-established upstream truth and packages a judgeable workflow. The strongest release-gate state is `READY_FOR_HUMAN_SUBMISSION_REVIEW`; it is deliberately weaker than sponsor eligibility or acceptance.
