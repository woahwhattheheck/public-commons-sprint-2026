# Stellar Forge SF-33: safe recovery diagnostics

An agent-facing, side-effect-free failure contract for canonical x402 v2 verify and settlement results. This is not a facilitator or a live payment service.

## Contract

`explainFailure({stage, reason, response, traceId, retryAfterMs})` produces a sanitized failure envelope and a recommended operator action without reflecting upstream error messages or exposing credentials. `gateNextAction(failure, {ledgerReceipt, explicitNewAuthorization})` is a pure decision gate that never signs, settles, or replays payments. Only approved idempotent reads are eligible for automatic retries.

For a possibly submitted settlement, reconcile the actual transaction hash and network against an independently fetched canonical ledger receipt before any new payment attempt. The absence of a hash or receipt does not establish failed payment or justify replay. A request for new authorization is a user/operator action, not authority derived from model output.

## Provenance

Original published SF-33 source and typed contracts: Slack Canvases `F0C920NMGAC`, `F0C81C92GN7`, `F0C920PR9R6`, completed 2026-10-09. Canonical upstream x402 v2 specification: `x402-foundation/x402`, commit `7f2b2f1f77fa5317615735e3378a6fad41cccb4e`, `specs/x402-specification-v2.md` Git blob `3b4631af0684748966eafcdf6a6a90a8cbbf7198`. This directory is a public, separately reviewed integration port; its Git blobs are distinct from the archived Slack artifacts.

## Use

Run `node focused-check.mjs` locally in this directory. No external network or wallet required. Integration into live SF31/SF32 producers is a separate change requiring canonical response parity; no service operation or network payment is claimed.
