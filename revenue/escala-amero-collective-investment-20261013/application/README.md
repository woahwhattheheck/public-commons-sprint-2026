# Amero collective investment operations

A complete local application for following an observed community/fund/proposal/milestone through evidence review, an explicitly prepared Stellar Disbursement Platform instruction file, and payment-to-ledger reconciliation.

The application uses one Node 24 SQLite workspace. It retains original provider responses, exact numeric tokens, immutable resource editions, request receipts, reviewer decisions, payout plans, reports and a complete portable application/runtime handover. The browser, CLI and background workers use the same store and request journal.

## Start

Use Node 24 on Linux. Copy `examples/configuration.example.json` to a private location and replace only the actual connection bindings you possess. Keep SDP bearer tokens in that private file.

```sh
node cli.mjs runtime-retain --destination /absolute/private/amero-runtime
node cli.mjs serve --directory /absolute/private/amero-workspace --configuration /absolute/private/configuration.json --runtime /absolute/private/amero-runtime
```

Open the printed local address. Use the operator bearer from the selected private configuration or the created `operator-token.private.json`. Provider credentials are never browser form fields.

The navigation follows the actual work: programmes; original resource register; recipient plans; reviewer decisions; provider requests and captures; reconciliation; reports; complete workspace handover. The [operator guide](COLLECTIVE_OPERATOR.md) describes the controls. [Operations](OPERATIONS.md) describes native requests, source scope and CLI examples. [Commissioning](COMMISSIONING.md) describes the original producer/customer/return course and required rendered-product inspection.

## Source meaning

The selected Escala API is the published mock at commit `ca9ae6256fdbf7786e20b4c2b2926ce179468944`. Its responses are fixed examples. Its Express implementation has no authentication middleware, durable custody, voting enforcement or real payment execution. The application keeps those observations visibly classified as mock and restricts that provider catalogue to the sandbox environment. Two Swagger webhook paths absent from the actual router remain source-only.

The SDP adapter is pinned to the official backend 7.0.0 source at `14704274467d267b6c6679052d7251ef6050d118`. This is the adapter's compatibility selection; it does not identify an Amero deployment. Select the actual SDP host, tenant, network, authentication and distribution account. Permissions and payment authorization remain with that selected provider.

Horizon observations retain the exact network passphrase and source account. Reconciliation keeps an operator's relationship declaration separate from original foreign keys, and never converts a mock attestation into approval to release funds.

## Payout plans

A saved plan pins the original programme, milestone, approval/evidence, source distribution wallet, asset and recipient registration selection. It retains the entire instruction CSV and plan JSON. `PREPARED` means the local file and selected source bindings are complete; it does not authorize payments.

Each stage prepares a separate original request:

1. Create an SDP draft.
2. Upload the exact retained CSV to a selected original disbursement edition.
3. Prepare an explicitly selected status change.

Dispatch is a separate operator action. Setting a disbursement to STARTED can initiate payments. The app preserves uncertain attempts and uses original readback; the selected contracts do not establish automatic financial retry.

## Complete handover

Export includes the consistent SQLite snapshot, all retained original files, the full declared application and the selected Node runtime with its libraries and launcher. An independent receive preserves historical records and pauses active workers. Customer changes create later editions; replaying an original request keeps those changes intact.

- [Domain and plan rules](AMERO_MODEL.md)
- [Source pins and implementation differences](SOURCES.md)
- [Horizon streaming](SETTLEMENT_STREAM.md)
- [Complete commissioning course](COMMISSIONING.md)

No dependency install or hosted workflow is needed to open the application. The retained YAML compiler dependency is included only to reproduce the pinned compiled provider schemas.
