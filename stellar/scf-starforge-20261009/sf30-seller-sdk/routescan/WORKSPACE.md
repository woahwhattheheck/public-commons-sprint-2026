# Routescan operator workspace

The workspace connects a saved Routescan merchant configuration, original provider responses, the SF30 merchant and a customer package. Open the same project after restarting the process to recover its revisions, source results and releases.

## Open an existing project

Run from `sf30-seller-sdk` in a complete Stellar Forge source release:

~~~sh
node routescan/workspace-cli.mjs \
  --project /srv/routescan-project \
  --port 8425 --merchant-port 8423 --operations-port 8424
~~~

On first startup, add `--config /srv/routescan-merchant.json`. The [provider guide](./README.md) describes the merchant configuration, provider account, quota and payment terms. An existing project retains its configuration; use its workspace to save the intended next revision.

The printed URL opens a private loopback workspace. Its merchant and Operations buttons use the original SF30 listeners. Add the deployment's `--facilitator https://YOUR-FACILITATOR` to configure the native seller. The explicit `--allow-local-facilitator` switch permits the original HTTP facilitator on `127.0.0.1`. Route a deployed customer endpoint through its configured HTTPS origin.

The host supplies the original SF30 dependencies, Linux `flock` and Python 3.11+ for portable archives. Node 24.5+ or 22.21+ supports the provider source's environment proxy. The original SF88 customer workspace import requires a source release containing `Buyer.fromWorkspace`.

## Review and operate a merchant

Use the workspace's saved configuration as the input to an operation.

1. Select the provider network and chain. The operator controls these path values. A numeric chain is the ordinary selection; use `all` only as an explicit operator choice.
2. Enter the provider account label, optional key environment-variable name and quota for the account's chosen plan. The host environment supplies the key value.
3. Set each customer product's route, operation, native network, asset, amount and recipient. Review the resulting native terms.
4. Save the change with the current revision. The workspace shows retained revision history and the configuration hash.
5. Start the merchant. Its displayed state identifies the original challenge-only or native mode and the active revision.

A running merchant serves the revision it started with. Saving another draft preserves that active revision until the operator stops and starts the service. The stop action drains the original service before closing its provider source.

## Retain a provider response

A preview is an actual request to Routescan. Choose its product, exact date range and a stable operation name.

A series request includes a time aggregation interval. Both series and total requests can include an ecosystem and included/excluded chain filters. Chain lists use comma-separated strings, such as `1,43114`. Dates keep their explicit timezone. The selected chain/network, exact source URL and response bytes stay attached to the saved result.

Review the retained response's status, source selection and original value strings. Open an existing preview to reuse that same response. Its JSON download preserves the original bytes. The CSV view is a derived spreadsheet export; it escapes formula-like text and retains the provider's string values.

Keep the provider quota with the project. The active native merchant owns the quota lease while it runs. Stop and drain that merchant before issuing a separate workspace preview through the same quota directory. The existing source result remains available throughout.

## Prepare the customer handoff

Select the reviewed merchant revision and, when relevant, the completed source preview whose selected request should become the customer's example. Give the release a stable name.

The customer release contains:

| File or directory | Purpose |
| --- | --- |
| `merchant.json` | Frozen operator-selected merchant configuration |
| `review.json` | Original native term and provider review |
| `seller-openapi.json` | Original customer HTTP schema |
| `client/` | Original generated Node client, declarations and export receipt |
| `customer/request.json` | Selected editable request in the generated client's input shape |
| `customer/customer.mjs` | Node customer workflow on the original SF88 inbox |
| `customer/customer.py` | Python interface to the same Node workflow and inbox |
| `customer/README.md` | Release-specific customer instructions |
| `customer-handoff.json` | Selected request, revision and retained customer file hashes |

Download the customer archive or individual retained files. A reopened release keeps its original source selection and content. Choose a new release name when the intended revision or customer handoff changes.

The generated client uses the merchant's configured public origin. Check that this origin reaches the intended running merchant before preparing a purchase.

## Run the original customer workflow

The customer supplies a complete original SF88 runtime, its application state directory, native inbox and existing operator workspace. Keep the release's generated client and customer adapters together.

Initialize the inbox:

~~~sh
node customer/customer.mjs init \
  --runtime /absolute/stellar/scf-starforge-20261009/sf88-operator-buyer-cli \
  --state /private/routescan-buyer --inbox /private/routescan-inbox
~~~

Edit `customer/request.json` to the actual desired query. Prepare one operation using an explicit intent and payment ceiling:

~~~sh
node customer/customer.mjs prepare \
  --runtime /absolute/stellar/scf-starforge-20261009/sf88-operator-buyer-cli \
  --state /private/routescan-buyer --inbox /private/routescan-inbox \
  --workspace /private/original-operator-workspace \
  --client /absolute/routescan-release/client/seller-client.mjs \
  --operation gasSeries --inputs /absolute/routescan-release/customer/request.json \
  --intent customer-gas-request-1 --max-atomic YOUR_ATOMIC_CEILING --accept 0
~~~

Use the operation ID exposed by the release's original OpenAPI. The maximum amount is expressed in the chosen native asset's atomic units.

Review the prepared operation:

~~~sh
node customer/customer.mjs review \
  --runtime /absolute/stellar/scf-starforge-20261009/sf88-operator-buyer-cli \
  --state /private/routescan-buyer --inbox /private/routescan-inbox \
  --intent customer-gas-request-1 --output /private/customer-gas-review.json
~~~

Execute through the original operator terminal:

~~~sh
node customer/customer.mjs execute \
  --runtime /absolute/stellar/scf-starforge-20261009/sf88-operator-buyer-cli \
  --state /private/routescan-buyer --inbox /private/routescan-inbox \
  --intent customer-gas-request-1 \
  --workspace /private/original-operator-workspace \
  --review-file /private/customer-gas-review.json
~~~

The original operator workspace supplies the signer, policy and native approval. The prepared request carries the generated client's expected terms into that same workspace. Profile-based preparation is also available through the documented `--profile` option.

If preparation created the operation before inbox intake was interrupted, `attach --intent customer-gas-request-1` enqueues that saved operation. After an execution interruption, inspect and recover the same intent.

## Reopen a completed response in Node or Python

Both language entry points reference the same runtime, buyer state and native inbox. For example:

~~~sh
python3 customer/customer.py recover \
  --runtime /absolute/stellar/scf-starforge-20261009/sf88-operator-buyer-cli \
  --state /private/routescan-buyer --inbox /private/routescan-inbox \
  --intent customer-gas-request-1

python3 customer/customer.py download \
  --runtime /absolute/stellar/scf-starforge-20261009/sf88-operator-buyer-cli \
  --state /private/routescan-buyer --inbox /private/routescan-inbox \
  --intent customer-gas-request-1 --output /private/customer-gas-result.json
~~~

The original response reader validates the retained body. `json` returns parsed source data and `csv` provides its derived spreadsheet representation. `response` and `inspect` expose the original delivery, payment and operation fields.

Use `finalize` with the same operator workspace for the original accounting continuation. Use `report --output /private/routescan-purchase-history.html` for the original inbox report. The report and saved response provide the customer with the original request history, native outcome and delivered data.

Python applications can import `RoutescanCustomer` from `customer.py`. Its methods invoke the same original adapter and inbox. Its execute method retains the operator terminal, then reopens the original intent.

## Back up and restore the project

Stop and drain the merchant, then use the workspace's backup action. The project archive includes saved merchant revisions, source requests and results, original generated releases, customer handoffs and the retained quota ledger.

Store the archive on the deployment's durable storage. A backup using the default project quota preserves that account's local usage history. An externally shared quota directory needs an account-level backup coordinated with its host.

Restore into a new private project directory:

~~~sh
node routescan/workspace-cli.mjs \
  --project /srv/routescan-restored \
  --restore /srv/backups/routescan-project.zip --port 8425
~~~

The original archive worker validates member paths, sizes and digests before opening the restored project. Reopen the retained source previews and customer releases from that project, configure its intended facilitator on the new host, and start the merchant at the chosen saved revision.

SIGINT and SIGTERM drain accepted workspace operations and close the merchant, provider source and project before exit.

Powered by [Routescan.io APIs](https://routescan.io).
