# Paycashless invoice, payment and settlement operations

A complete local operator application for the published Paycashless bank-rail API, exact invoice and instalment reconciliation, supplier/staff payouts, signed callbacks and independently selected Stellar settlement evidence. Browser, CLI, workers and receiving use one Node 24 SQLite workspace.

## Start

Install a supported Linux Node 24 runtime. The application has no npm package dependency. Keep this complete source directory together.

1. Copy `examples/configuration.example.json` to a private directory outside the application. Replace the selected merchant scope, environment, API key and API secret. Select original Horizon network/account bindings if needed. Remove unused example connections.
2. Retain the selected runtime for complete exports, then start the actual workspace:

```sh
node cli.mjs runtime-retain --destination /absolute/private/paycashless-runtime
node cli.mjs serve \
  --directory /absolute/private/paycashless-workspace \
  --configuration /absolute/private/paycashless-config.json \
  --runtime /absolute/private/paycashless-runtime
```

3. Open the reported local origin. Use the operator token from your private configuration or the workspace's `operator-token.private.json` in the access form. API credentials remain server-side.
4. Import original merchant response files or collect the exact issued read actions. Use invoice details and invoice-payment related reads to connect instalments to payment intents.
5. Save an immutable accounting book, review the native reconciliation, record explicit settlement decisions, and create the full JSON/CSV/HTML report.

The default private workspace starts with provider mutations disabled. Review a prepared original request before explicitly enabling dispatch. Read-only acquisition does not enable economic writes. A received workspace starts with mutations disabled and streams paused.

## Product entry points

| Entry | Purpose |
|---|---|
| `server.mjs` / `cli.mjs serve` | Complete browser operator and private native API |
| `cli.mjs` | Exact requests, full source import, inspection, export and independent receiving |
| `worker.mjs` | One leased worker for retained signed callback projection |
| `settlement-stream.mjs` | One leased Horizon SSE worker over a selected saved stream |
| `operate-paycashless.mjs` | Complete original merchant commissioning and receiving course |
| [Operator guide](PAYCASHLESS_OPERATOR.md) | Forms, registers, recovery, reports and downloads |
| [Native operations](OPERATIONS.md) | Provider action catalogue, configuration and exact request examples |
| [Accounting model](PAYCASHLESS_MODEL.md) | Original fields, controls, coverage and decision semantics |
| [Settlement stream](SETTLEMENT_STREAM.md) | Stream binding, original cursor, restart and shutdown |
| [Commissioning](COMMISSIONING.md) | Original-input course and actual rendered-product operation |
| [Source provenance](SOURCES.md) | Full API/signing/Horizon source identities and interpretation boundaries |

## What the application preserves

All 27 operations from the retained Paycashless API 1.1.0 are available with their actual path, parameters, body schema and response contract. Requests use the documented Bearer key plus HMAC-SHA512 signing. API request sorting and callback event-data signing are separate algorithms. Callback URL convention is explicit because the original documentation contains both exact and lowercase wording.

Original responses are retained byte-for-byte, with a separate exact numeric-token map. Provider IDs, currency, live mode, source scope and observed timestamps remain attached to each immutable resource version. Safe raw request text travels as `inputJSON`; unsupported numeric precision is rejected before preparation rather than rounded.

Invoices and instalments are linked observations of the payment-intent collection. Reports keep every original row while counting the underlying succeeded collection once. Payout flows and invoice stocks have separate totals. Missing population, unit, date, account or transaction evidence remains explicit.

Stellar links require supplied original operation, transaction and network evidence, exact account/asset/issuer/direction and explicit conversion or scale evidence. The published Paycashless API does not expose a deployed Stellar contract or custody account; the application does not infer one.

## Complete working handover

Workspace export freezes the real SQLite snapshot, every referenced original object, complete application source and selected Node/runtime libraries. The manifest-first `.tar.gz` archive supports inspection and independent receiving. Later recipient edits do not rewrite earlier reports or original request results. The commissioned course checks producer report, customer continuation, return archive and original-request replay.

A source-reviewed build is not a claim of a completed merchant/provider or rendered-browser run. Follow the exact outgoing-product operation in the commissioning guide before presenting a deployment as ready.
