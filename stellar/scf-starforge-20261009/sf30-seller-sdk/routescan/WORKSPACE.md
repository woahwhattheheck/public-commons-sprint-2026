# Routescan operator workspace and customer delivery

The browser workspace connects the original Routescan project, merchant, saved source responses, revision history, customer exports and portable backups. Node and Python customers use one original SF88 buyer inbox.

Use the provider contract and quota guidance in [README.md](README.md) with this operating guide.

## Install and open

Use a complete Stellar Forge release containing this directory and the original SF88 buyer.fromWorkspace API. Install its original SF30 and buyer dependencies through the release's installation instructions. The operator host requires Linux with flock, Node 24.5+ or 22.21+, and Python 3.11+ for the archive worker.

Run from sf30-seller-sdk:

~~~sh
node routescan/workspace-cli.mjs \
  --project /srv/private/routescan-project \
  --config /srv/private/routescan-merchant.json \
  --port 8420 --merchant-port 8423 --operations-port 8424
~~~

The configuration is an operator-owned copy of merchant.example.json. Select the real customer-facing HTTPS origin, provider account, exact network and chain, allocated quota and original payment terms. Replace the example asset and recipient before configuring a paid merchant. Keep an optional provider API key in the named host environment variable.

Open the loopback URL printed by the command. The private workspace uses its own origin and request token for local changes. The original merchant and Operations have separate loopback listeners. Use the deployment's existing authenticated access and HTTPS boundary for authorized remote surfaces.

Later startup reopens the same project:

~~~sh
node routescan/workspace-cli.mjs --project /srv/private/routescan-project --port 8420
~~~

A supplied --config initializes an empty project; it does not replace a different saved input. Omitted ports default to zero so the host can select available listeners. SIGINT and SIGTERM drain accepted work and close the owned merchant, Operations and project.

## Six connected views

| View | Operator workflow |
| --- | --- |
| Overview | Read provider configuration and quota allocation; start, drain and restart the original merchant; see the active service revision. |
| Source requests | Select exact dates, an allowed interval and optional filters; retain the original provider outcome; reopen JSON, CSV or its source record. |
| Configuration | Save provider choices and original payment terms as a new revision. Full JSON editing preserves the complete native contract. |
| Customer handoff | Freeze an original client, select a completed source request from the same revision, and download the complete Node/Python package. |
| Revision history | Compare earlier input and restore it as a new revision, preserving request, export and quota identities. |
| Backup and restore | Download the saved project and restore its original records into a new private directory. |

Neutral controls and tables support desktop and narrow screens without changing the workflow.

## Query the original provider

The operator selects the provider network and a numeric chain ID or explicit all-chain selection. Customers cannot replace these route values.

Enter the original timezone-bearing dateFrom and dateTo strings. For a series, choose an allowed second, minute, hour or day interval. Optional ecosystem, includedChainIds and excludedChainIds retain the provider's own representation; chain lists remain comma-separated strings. Blank filters remain absent.

Running a source request consumes the configured provider quota. The original project retains its request before dispatch and then records the provider outcome. Reopening a completed request reads its saved bytes. Failed or interrupted operations remain in history under their original IDs.

The result dialog shows the exact source URL, configuration, status, byte length, SHA-256 and original string values. It preserves every returned column. The API describes the series as an array of string arrays and the total as an object with a string value.

The series interval controls time grouping. The published operation does not label a gas-price denomination. JSON downloads preserve the original bytes. CSV is derived; formula-like cells are escaped for spreadsheet use while the original JSON stays unchanged.

## Edit and restart

Review the actual provider account, allocated quota and payment terms before saving. Each change includes the revision the operator opened. When another editor saves first, refresh and apply the intended change to the current input.

A running merchant stays on its active revision until it drains and restarts. Overview shows when newer saved input needs that restart. Restoring an earlier configuration creates a new revision; it does not rewind provider usage or customer purchases.

The public merchant origin identifies the actual HTTPS deployment. Changing the local workspace port does not change that customer contract.

Supply the deployment's original native facilitator for paid delivery:

~~~sh
node routescan/workspace-cli.mjs \
  --project /srv/private/routescan-project \
  --facilitator https://YOUR_CONFIGURED_FACILITATOR \
  --port 8420 --merchant-port 8423 --operations-port 8424
~~~

The explicit --allow-local-facilitator option supports the original private http://127.0.0.1 facilitator. Follow the existing [native facilitator instructions](../native-facilitator/README.md) for actual network, asset, recipient, signer and settlement settings. Without a configured native facilitator, the merchant publishes the original challenge for contract review.

## Export a customer handoff

Choose a stable new export name and either a completed source request from the current revision or the configured example. The project creates its original generated client and export records, then adds the selected request and customer adapters.

The package contains:

- Original merchant input, review, OpenAPI and export records.
- Original generated client, declarations, package metadata, README and client export receipt.
- customer/customer.mjs and customer/customer.py.
- customer/request.json and a command guide in customer/README.md.
- customer-handoff.json identifying the revision, selected request and added file hashes.

The same export reopens its retained files after restart. A different request uses a distinct export name. Previously exported customer code remains attached to its original export even after the operator upgrades the workspace.

Provider key values are not included. Each customer host supplies its original runtime and private operator workspace. Optional --runtime, --state and --profile arguments display customer installation references; the browser does not load signing keys.

## Prepare, approve and execute one purchase

Initialize the customer operator using the original [SF88 workspace workflow](../../sf88-operator-buyer-cli/node/WORKSPACE.md). Its signer, payer, network, asset, recipient, payment flow, limits, evidence, policy, ledger and transport remain in that private workspace.

The adapter calls the original instance method buyer.fromWorkspace to adopt the generated request while retaining those native bindings. Use a release containing that API.

Run from the exported package, replacing paths, intent and ceiling:

~~~sh
node customer/customer.mjs init \
  --runtime /absolute/sf88-operator-buyer-cli \
  --state /private/routescan-buyer --inbox /private/routescan-inbox

node customer/customer.mjs prepare \
  --runtime /absolute/sf88-operator-buyer-cli \
  --state /private/routescan-buyer --inbox /private/routescan-inbox \
  --workspace /private/original-operator \
  --client /absolute/export/client/seller-client.mjs \
  --operation gasSeries --inputs /absolute/export/customer/request.json \
  --intent YOUR_STABLE_INTENT --max-atomic YOUR_EXPLICIT_CEILING --accept 0

node customer/customer.mjs review \
  --runtime /absolute/sf88-operator-buyer-cli \
  --state /private/routescan-buyer --inbox /private/routescan-inbox \
  --intent YOUR_STABLE_INTENT

node customer/customer.mjs execute \
  --runtime /absolute/sf88-operator-buyer-cli \
  --state /private/routescan-buyer --inbox /private/routescan-inbox \
  --workspace /private/original-operator --intent YOUR_STABLE_INTENT
~~~

Execution uses the original controlling terminal, explicit approval, native signer and permanent attempt. The adapter retains the original result and returns a nonzero exit status for execution or delivery errors.

Profile-based preparation remains available with --profile when an application uses an original operator profile instead of an initialized workspace.

## Reopen from Node or Python

Both languages use the same buyer state and inbox paths. Python invokes the adjacent Node adapter and keeps no additional purchase ledger. Applications can import the RoutescanCustomer class in either language.

~~~sh
python3 customer/customer.py recover \
  --runtime /absolute/sf88-operator-buyer-cli \
  --state /private/routescan-buyer --inbox /private/routescan-inbox \
  --intent YOUR_STABLE_INTENT

python3 customer/customer.py download \
  --runtime /absolute/sf88-operator-buyer-cli \
  --state /private/routescan-buyer --inbox /private/routescan-inbox \
  --intent YOUR_STABLE_INTENT --output /private/new-result.json

node customer/customer.mjs json \
  --runtime /absolute/sf88-operator-buyer-cli \
  --state /private/routescan-buyer --inbox /private/routescan-inbox \
  --intent YOUR_STABLE_INTENT
~~~

Inspect or recover the same intent after interrupted execution. If preparation completed but enqueueing was interrupted, attach adds that same saved Node operation to the original inbox. Response methods verify retained files before reading or downloading them and send no provider request.

Finalize continues original financial observation and reservation for the same purchase using --workspace. Report exports the original inbox history to a new HTML destination. Neither purchases again. Delivery, payment outcome and financial finalization keep their distinct original fields.

## Back up and move the provider workspace

Drain and stop the merchant before creating its portable backup. The archive worker locks the original project and quota, records each complete file's size and hash, and checks those bytes again before publication.

The archive includes saved configurations, revisions, previews, exports, customer handoffs and local quota. It excludes transient locks and host secret values. Restoration validates the manifest and original records, creates private files in a new directory and leaves the merchant stopped.

In the browser, choose the complete ZIP and select Restore into a new workspace. The previous project stays available. Restoration makes no source request or payment.

For a new host:

~~~sh
node routescan/workspace-cli.mjs \
  --restore /private/Routescan_Prepared_Workspace.zip \
  --project /private/new-routescan-project --port 8420
~~~

Install the matching source release and original dependencies first. Configure the provider environment reference and actual facilitator separately. Preserve the customer's original operator workspace, buyer state and inbox through the SF88 migration workflow; these private customer directories are separate from the provider backup.

For an account shared by several processes, retain one authoritative quota volume. This portable workspace backs up its local quota. When the project uses an externally shared quota directory, preserve that account's existing host-owned backup before moving dispatch.

Powered by Routescan.io APIs — https://routescan.io
