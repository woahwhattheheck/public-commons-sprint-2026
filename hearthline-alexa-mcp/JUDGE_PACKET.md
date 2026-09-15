# Hearthline judge packet

Hearthline is a stateful household mission orchestrator for Alexa+ over MCP 2025-11-25 Streamable HTTP. This page is the **judge-first handoff** for the public carrier: what to run, what to inspect, which evidence is mechanically bound, and which external competition claims are intentionally still unresolved.

## 60-second path

From `hearthline-alexa-mcp`:

```bash
node judge/verify.mjs
node judge/packet.mjs > /tmp/hearthline-judge-packet.json
npm test
node runtime/conformance-probe.mjs
node scripts/demo.mjs
```

For the interactive browser-only authority simulator:

```bash
python -m http.server 8080
```

Then open `/simulator/` from that local server. The simulator has no provider-write path: it demonstrates routine execution, explicit approval for irreversible work, unknown-outcome reconciliation, idempotent command replay, evidence binding, and deterministic receipt export.

## What the offline verifier proves

`node judge/verify.mjs` fails nonzero unless all of the following are true:

- `PUBLIC_CARRIER_PROVENANCE.json` has the expected public-carrier schema and manifest-only authority;
- the provenance source commit, source subtree, and release-manifest Git blob match the judge source matrix;
- exactly **47** manifest-authorized source files are present;
- all 47 files recompute to the expected **Git blob SHA-1**, so one-byte source drift is detected;
- the committed public-release manifest names exactly the same 47 source paths as the judge matrix;
- source modes remain **46 × `100644` + 1 × `100755`**, with `release/public-release.mjs` retaining executable mode;
- public-carrier external claims remain false;
- judge submission fields keep every registration/submission/deployment/eligibility/judging/prize/payment claim false;
- the deterministic packet compiler, source matrix, submission draft, verifier, and this judge guide are all present.

The matrix lives at `judge/source-blobs.json`. It is deliberately separate from GitHub history so a reviewer can verify the carrier **offline**, without credentials, network access, or trusting a branch name.

## Three-minute product path

1. **Read `README.md`.** The product thesis is durable household missions across MCP sessions, not a single API wrapper.
2. **Run `node scripts/demo.mjs`.** Observe mission creation, pre-approval rejection, explicit approval, durable execution receipt, and idempotent replay.
3. **Open `simulator/index.html`.** Compare a routine action with an irreversible one. Simulate an unknown result and see retry remain fenced until reconciliation.
4. **Run `node runtime/conformance-probe.mjs`.** This exercises MCP 2025-11-25 initialization, session binding, lifecycle gating, tool/resource discovery, Origin fencing, version checks, session deletion, and protocol error behavior against the real server.
5. **Read `docs/ARCHITECTURE.md`.** The transport session is intentionally ephemeral; the household mission and receipts are durable application state.
6. **Read `aws/README.md`.** AWS/DynamoDB support has a reproducible offline contract, but a real AWS-runtime claim requires a separate live probe receipt.
7. **Inspect `release/README.md`.** Public release is fail-closed and manifest-scoped. It does not authorize or imply competition submission.

## Why the authority model matters

A Hearthline external-commit action cannot move directly from intent to effect:

```text
awaiting_approval
       |
       | mission id + action id + exact current planHash
       v
    approved
       |
       | idempotency key
       v
complete + durable receipt
```

Approval rotates the mission plan hash. That prevents an approval made against one visible plan from silently authorizing a later generation. Execution receipts are durable and exact replays return the original receipt rather than duplicating the effect.

The current shopping demo is intentionally bounded further: execution yields `prepared_not_purchased`. There is no merchant call path.

## Judge evidence map

| Question | Evidence |
|---|---|
| Is there a real MCP runtime? | `src/mcp-server.mjs`, `runtime/conformance-probe.mjs`, `test/http.test.mjs`, `test/runtime-conformance.test.mjs` |
| Does state survive transport sessions? | `src/store.mjs`, `src/orchestrator.mjs`, `test/restart.test.mjs` |
| Are irreversible actions human-gated? | `src/orchestrator.mjs`, `scripts/demo.mjs`, `test/orchestrator.test.mjs` |
| Is repeat execution idempotent? | `src/orchestrator.mjs`, `scripts/demo.mjs`, `test/orchestrator.test.mjs` |
| Is there an Alexa+/MCP App surface? | `src/app-resource.mjs`, `src/tools.mjs`, `test/http.test.mjs` |
| Is live context bounded and read-only? | `src/nws.mjs`, `test/nws.test.mjs` |
| Is AWS integration real code rather than a prose claim? | `aws/dynamodb-json-store.mjs`, `aws/sigv4.mjs`, `test/aws-*.test.mjs` |
| Is AWS deployment truth-bounded? | `aws/evidence-gate.mjs`, `aws/smoke.mjs`, `aws/README.md` |
| Is the browser demo provider-free and deterministic? | `simulator/`, `test/simulator-*.test.mjs` |
| Are public bytes mechanically bound to the private release authority? | `PUBLIC_CARRIER_PROVENANCE.json`, `judge/source-blobs.json`, `judge/verify.mjs` |
| Can a judge reproduce the public-release gate? | `release/`, `.github/workflows/hearthline-public-carrier.yml` |

## Draft submission copy

The reusable title, tagline, problem statement, solution statement, demo commands, judge path, and owner-action checklist live in `judge/submission-fields.json`. `node judge/packet.mjs` combines those fields with verified public provenance into canonical recursively sorted JSON.

The compiler intentionally emits **no current timestamp and no network-derived state**. Two runs from the same tree are therefore byte-identical. That makes review diffs meaningful and prevents a packet build from manufacturing freshness or an external receipt.

## Hard truth boundary

This repository proves a public, testable product carrier and its offline integrity. It does **not** prove or authorize any of the following:

- Alexa account/device registration;
- Amazon or Devpost submission;
- acceptance of current competition terms;
- competition eligibility;
- AWS deployment or cloud spend;
- organizer acceptance or judging;
- prize award, payment, or revenue.

Those facts require separate external receipts and, where applicable, owner action. `judge/submission-fields.json` keeps every one of those states false. A submission operator should change an external claim only after obtaining and preserving the corresponding receipt; this packet itself should remain a source/evidence handoff, not a substitute for the official portal.

## Ownership and provenance

The public carrier operation is `AMAZON-BSS-HEARTHLINE-PUBLIC-JUDGE-CARRIER-ZGEK9P4-20260913`. Original Hearthline/publication/source credit remains **Z-GaussEstuary-2210-K9P4 (ZGE-K9P4)** plus the earlier Amazon role owners recorded in coordination. Public-carrier recovery/finalization and this judge-packet successor were performed by **Z-ActiniumLantern-1929-V6Q2 (ZAL-V6Q2) / GPT-5.6 Sol**.

The judge packet is a conversion layer over the already-public carrier; it does not rewrite ownership of the product or source work.
