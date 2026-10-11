# SF93 · Seller support and incident operations

SF93 collects the original SF30 seller and operations data into a private four-file support packet. It also provides a continuous merchant incident workflow: local source registrations, original runtime conditions, durable acknowledgment/recovery, configured signed notification delivery, restart/retention and complete existing SF74 support-case export.

[Incident operations](INCIDENT_OPERATIONS.md) covers the complete continuous workflow, configuration, webhook protocol and case handoff. `incident-cli.mjs --help` lists its operator commands. The original one-shot collector below remains available.

## Capture a live support packet

Use Node 22+ and the original seller/operations launcher:

```bash
S=stellar/scf-starforge-20261009/sf30-seller-sdk
node "$S/operations/launch.mjs" -- \
  --config "$S/examples/service.json" --port 8423
```

From another terminal, read the printed local origins and create a new output directory:

```bash
node stellar/scf-starforge-20261009/sf93-seller-support-bundle/bundle.mjs \
  --seller http://127.0.0.1:8423 \
  --ops http://127.0.0.1:8424 \
  --out /private/support-cases/merchant-01
```

The parent directory must exist. Output is create-only: 0700 directory, 0600 files. A subsequent capture uses another new output directory.

| File | Content |
|---|---|
| `bundle.json` | Original source-bound session, route/counter summaries, native minute buckets and bounded recent metadata |
| `operator-brief.md` | Readable runtime outcomes and operational follow-up |
| `metrics.prom` | Verbatim original SF30 metrics, including maintained SF98 outbox gauges when attached |
| `manifest.json` | Output hashes/size and exact original four-response digest/byte/time records |

The collector validates original schema, seller mode, route membership, counter conservation and known original metric names. Per-response bounds are two million bytes with five-second absolute deadlines. Snapshot and metrics are separate sequential reads and can legitimately contain different current counts.

`readSupportBundle({seller, ops, signal})` returns the same original `{report, brief, files}` without writing to disk. `captureBundle({seller, ops, out, signal})` writes that packet through the existing create-only API. The watcher reuses this collector; its optional delivery read stays separate from the original packet's four-source digest contract.

The bundle retains configured route identifiers/templates and metadata counters. It excludes full offers, request query/body/header values, customer addresses and wallet credentials. Merchant route labels and operational notes still belong in private custody. A 402 is an unpaid challenge; an HTTP success or webhook acceptance is not an independent on-chain payment receipt.

Open the packet in the existing SF74 Runtime stage, or use the incident export command to carry its exact baseline/follow-up bytes, existing workspace, incident identity and notes into a complete importable support case. Native delivery and accounting tools continue to handle their original payment evidence.
