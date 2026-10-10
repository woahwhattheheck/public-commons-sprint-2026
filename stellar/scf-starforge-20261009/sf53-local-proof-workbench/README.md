# SF53 — Local proof workbench (source-linked, no-wallet)

A small, customer-reviewable **browser view of the actual public Stellar Forge source**, extending—not cloning—the already merged [SF51 checkout smoke](../sf51-local-commerce-smoke/README.md) and [SF46 release preflight](../sf46-release/README.md). This UI serves an immutable, read-only snapshot of the *original* Node modules' return values. No independent simulator, network mock, signing SDK, payout subsystem or new data collection is introduced.

## Use

In a full checkout of `woahwhattheheck/public-commons-sprint-2026`, with Node 22:

```sh
node stellar/scf-starforge-20261009/sf53-local-proof-workbench/serve.mjs
```

Open the printed **127.0.0.1** URL on **the same machine**. The launcher runs the original SF51 `runLocalSourceSmoke()` once, plus `assessRelease({strictPins:false})` from SF46. It displays the resulting timestamp, actual source import/preflight state, Git blob pin matches/drift, and the limited original checkout-smoke path: discovery, local HTTP 402, signed call count, cancelled quote replay and zero payments. It does not silently refresh pins or source state. A failure is shown as a failure. The browser can only GET an in-memory snapshot; refresh cannot trigger another proof run, payment or registration. A full public live deployment is not implied by this local operator UI.

For one isolated original workbench HTTP/security contract check, without hosting CI or contacting any payment system:

```sh
node --test stellar/scf-starforge-20261009/sf53-local-proof-workbench/test/workbench.test.mjs
```

This check injects known module *return values* to test report presentation boundaries; **the launcher imports the real SF51/SF46 source**. To validate the true end-to-end local commerce run, use the actual launcher above. The test is not an acceptance substitute for paid Stellar transactions.

## Safeguards and scope

- Listener binds the exact loopback IPv4 address `127.0.0.1` on a kernel-assigned port. It rejects unexpected `Host`, remote addresses and methods other than GET/HEAD. It has no reverse proxy, external URLs, redirection, wallet, checkout route, mutation endpoint or ability to send application forms. Strict Content Security Policy, no permissive CORS, no-store and nosniff guard the local source report.
- Its original SF51 proof intentionally uses a trusted local synthetic seller entry and an *unspendable* fixture `TEST-ONLY-UNISSUED` asset/recipient. The real loopback HTTP request returns a 402 with a PAYMENT-REQUIRED challenge. Original MCP paid execution has no signer/approval and must never send a signed request or funds. Only local smoke checks, not a live seller adoption or on-chain transaction.
- SF46 preflight inspects actual current first-party files, exports, imports and Git blob hashes. Source drift yields visible warnings, not an automatic green strict pin claim. Missing imports/source failures remain errors. A `PASS_SOURCE_CONTRACTS_ONLY` result does **not** imply approved Stellar testnet settlement, payment acceptance, valid SCF grant track, merchant/customer traction, pubnet release, security audit or deployment.
- No proprietary merchant data, Stripe credentials, SCF submission, Slack/email contact or GitHub Actions build. Reviewer/partner runs require a local checkout and operator consent. All separately owned product implementation modules remain unchanged.

## Revenue/grant handoff

The workbench is a self-serve local technical demonstration for an approved commercial discovery/checkout-assurance conversation. A scoped paid diagnostic can use separate, owner-authorized seller evidence and contract milestones, but it is **not** paid revenue or a representation that SCF has accepted the project. The SCF application assembly remains owner-held and unsent. Report sourced local engineering results distinctly from independent third-party acceptance.
