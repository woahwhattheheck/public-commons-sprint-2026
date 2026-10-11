# Allium Explorer data through the existing Stellar merchant product

This is a runnable provider integration for the existing Allium commercial workshare. An operator executes one approved saved Explorer query, collects its completed result, projects a typed dataset, then uses the original SF30 query workspace and versioned seller to serve it. Acquiring provider data and charging a buyer are separate operations. Buyer requests never trigger an Allium query or receive the provider API key.

The implementation composes the original `sf30-seller-sdk/upstream.mjs`, `dataset-handler.mjs`, `dataset-cli.mjs` and `dataset-refresh/`. It adds no seller, wallet, facilitator, indexer or billing engine. No new dependencies or GitHub Actions are required. Use a full repository checkout and Node 22 or later.

## Verified provider fit, 11 October 2026

Allium publishes [Technology Alliance and Consulting & Services programs](https://www.allium.so/partners) for integrations, implementations and joint customer work. Its [Stellar table catalog](https://docs.allium.so/historical-data/supported-blockchains/other-ecosystems/stellar) and [transactions v2 schema](https://docs.allium.so/historical-data/supported-blockchains/other-ecosystems/stellar/raw/transactions-v2) establish a concrete indexed-data source.

The [Horizon-to-RPC migration notice](https://docs.allium.so/changelog/deprecated-stellar-v1) directs users to v2 datasets. The query recipe uses `stellar.raw.transactions_v2` and common retained fields. It avoids fields the migration notice removes, legacy effects, and assumptions about a future suffix removal. Confirm the approved saved query against the owning Allium workspace when onboarding.

Allium's [current machine-payment table](https://docs.allium.so/ai/machine-payments/endpoints-pricing) lists x402 on Base, Polygon, Solana and X Layer, and MPP on Tempo. It separately specifies API-key authentication for saved Explorer run/status/results. Stellar data coverage does not establish a native Stellar payment rail at Allium. This implementation uses authorized Explorer access and the existing SF30 Stellar seller downstream; it does not buy from a machine-payment endpoint.

## Prepare one approved query product

`examples/stellar-transactions.sql` is an operator-authored starting query using documented table/column names. It has an explicit time window, stable row ordering, a row limit, quoted output aliases and a string cast for exact stroop fees. The owning Allium operator creates or approves that saved query and its access scope. This recipe has not been executed in an Allium account by this work.

Copy `examples/product.json` to a private operator directory. Set its real saved-query ID, dates, approved projection, page limits and source table. Allium [parameters are strings substituted into a saved query](https://docs.allium.so/app/run-queries/parameterized-query). Treat these as trusted operator inputs; do not accept buyer SQL or buyer parameter values into this file. `run_config.limit` caps the provider result and an optional `computeProfile` uses an existing approved profile without creating or resizing one.

The example has seven selected transaction fields. `fee_charged_stroops` stays a string to preserve large integer values. Other decimal money, large identifiers and precision-sensitive values must also be cast to strings in the saved query and declared as strings. There is no implicit coercion from an imprecise JSON number. The exporter rejects missing fields, duplicate column metadata, incompatible values and oversized results. A nullable empty string is rejected because the original CSV format cannot distinguish it from null.

Only projected fields are written to `dataset.csv`. The source manifest records query/run identity, timestamps and digests, without copying SQL or parameter values into the public dataset. The private run directory contains the provider result and can include SQL or unselected fields; keep it off the public host. `rowLimitReached` identifies a result that reaches the configured limit. Narrow its window or explicitly describe the bounded selection before presenting it as a complete period. The byte limit is independently enforced; a row cap is not a completeness promise.

## Import an existing authorized export, entirely offline

Use an Allium **JSON** query-result envelope, containing `sql`, `meta.columns`, `data` and, when available, `queried_at`. The [official result format](https://docs.allium.so/api/explorer/fetch-query-run-results) defines `data` as a list of row objects. Raw CSV is already supported by the original SF30 dataset tool; this adapter provides the provider-specific JSON projection and source identity.

```sh
P=stellar/scf-starforge-20261009/partners/allium-explorer-pilot
node "$P/cli.mjs" inspect --product /private/allium-product.json
node "$P/cli.mjs" import --product /private/allium-product.json \
  --result /private/allium-results.json --out /private/allium-snapshot-001
```

The new directory contains `dataset.csv`, original-schema `dataset.json` and `source.json`. It is staged privately and validated by the original dataset loader before becoming available. This command prints row count and identity, never row contents. Existing nonempty output directories are preserved.

## Execute and collect with approved Allium access

Provide the API key through the environment variable named by `apiKeyEnv`; use the deployment's existing secret injection. Do not put it in product JSON, commands, logs or a buyer request.

```sh
P=stellar/scf-starforge-20261009/partners/allium-explorer-pilot
node "$P/cli.mjs" start --product /private/allium-product.json \
  --state /private/allium-run-001
node "$P/cli.mjs" collect --state /private/allium-run-001
node "$P/cli.mjs" status --state /private/allium-run-001
```

`start` makes exactly one authenticated `POST /api/v1/explorer/queries/{query_id}/run-async`, which can consume the account's provider credits. It records the returned `run_id` before another operation. An existing state directory cannot resubmit. `collect` makes one documented status read; `created`, `queued` or `running` returns that state immediately. Run it again later according to the operator's agreed provider budget and timing. There is no busy polling, automatic retry or subscription creation.

After a `success` status, collection fetches the results, keeps a private recovery copy and stages the dataset. A completed second collection returns the existing dataset without another provider request. `failed` and `canceled` remain explicit outcomes. Auth errors, rate limits, redirects, nested payment demands and malformed responses do not produce a dataset. The original SF30 transport supplies HTTPS, public DNS pinning, response/time limits and secret isolation.

If the process loses the POST response, inspect that saved query's actual runs in the owning Allium workspace. Recover its existing ID instead of replaying the execution:

```sh
node "$P/cli.mjs" recover --state /private/allium-run-001 \
  --run-id ACTUAL_EXISTING_RUN_ID
node "$P/cli.mjs" collect --state /private/allium-run-001
```

Use one operator command at a time per private run directory. Provider acquisition is an operator job, not a public HTTP API. Account access, source licensing and approved compute remain with the operator and provider.

## Use the existing workspace and seller

First inspect the real projected data in the original neutral query workspace:

```sh
S=stellar/scf-starforge-20261009/sf30-seller-sdk
node "$S/dataset-workspace.mjs" \
  --dataset /private/allium-run-001/dataset/dataset.json \
  --resource https://your-merchant.example/stellar-transactions
```

The workspace uses the original loader and prepares exact projection/filter/sort/pagination requests. It does not contact the public resource or make a payment. Public serving uses the same original dataset contract:

```sh
node "$S/dataset-refresh/cli.mjs" init --state /srv/allium-dataset \
  --dataset /private/allium-run-001/dataset/dataset.json
node "$S/dataset-refresh/cli.mjs" configure --state /srv/allium-dataset \
  --payment /private/approved-public-payment.json \
  --origin https://your-merchant.example --path /stellar-transactions \
  --out /private/allium-seller.json
node "$S/dataset-refresh/cli.mjs" serve --state /srv/allium-dataset \
  --seller /private/allium-seller.json --port 8423
```

These commands use operator-supplied public payment terms and start original challenge-only mode. Enable native paid delivery through the existing approved facilitator and signer flow described in the [SF30 dataset guide](../../sf30-seller-sdk/DATASET_API.md). The existing merchant fulfillment and settlement-accounting modules remain the source of delivery and reconciliation behavior. No provider fee, asset, recipient or customer acceptance is inferred from the sample configuration.

An actual later approved source result can refresh the active dataset without rewriting its price or route:

```sh
node "$S/dataset-refresh/cli.mjs" status --state /srv/allium-dataset
node "$S/dataset-refresh/cli.mjs" refresh --state /srv/allium-dataset \
  --dataset /private/allium-run-002/dataset/dataset.json \
  --expect CURRENT_SNAPSHOT_FROM_STATUS
```

Original retained snapshots preserve readers' page cursors while new queries use the refreshed data. Exposed schema changes require a separately configured route. The original private control socket and version store remain authoritative.

## Focused engineering exercise

```sh
node stellar/scf-starforge-20261009/partners/allium-explorer-pilot/acceptance.mjs
```

The completed exercise starts an actual local HTTP endpoint with the documented Allium run/status/results contract, submits once, resumes collection, projects rows, preserves a large fee string, excludes an undeclared field, and passes the data through the original SF30 loader, HTTP 402 seller, private refresh and disk restart. Provider responses in this exercise are clearly labeled fixtures. It does not assert Allium account connectivity, customer acceptance, blockchain settlement or revenue. The first paid customer deployment should use an actual approved query result and the existing merchant acceptance tools.

The commercial scope and acceptance deliverables are in [WORKSHARE.md](./WORKSHARE.md).
