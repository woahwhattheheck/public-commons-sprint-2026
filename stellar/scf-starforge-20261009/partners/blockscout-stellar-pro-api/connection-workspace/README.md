# Blockscout connection setup workspace

This private local application prepares the first deployment of the existing Blockscout token merchant. It accepts an existing valid token plan or a complete exported connection bundle, retains the original input, presents the provider/account/payment settings for review, and receives a private merchant package through the original connection engine. Its Applications controls use the existing Stellar Forge runtime workspace and original managed process.

## Open the operator

Use the complete current Stellar Forge source and Node 24 or later on Linux. The workspace uses the existing private-file and kernel-lease helpers, including the host's `flock` command.

```sh
node stellar/scf-starforge-20261009/partners/blockscout-stellar-pro-api/connection-workspace/cli.mjs \
  serve --workspace /private/blockscout-connections \
  --applications /private/stellar-forge-runtime-workspace
```

The parent of a new workspace must already exist as a private real directory owned by the current operator. A retained workspace is reopened with its original identity. The command prints a single startup record containing the private browser URL. Open that URL on the same host, or through the existing authorized browser carrier for that host.

The running server binds to 127.0.0.1. Its URL fragment supplies the local capability; application data and actions require that capability, and writes require the actual local origin. The browser removes the fragment from the current address after retaining it in this tab's session. Keep the startup URL private.

The same application appears in the original Applications catalog as **Blockscout connection setup**, with command `blockscout-connections`. Select the private connection directory and, optionally, the existing runtime workspace. The catalog's startup receiver checks the returned workspace identity, original configuration hash and local browser URL before retaining the link.

## Complete the browser workflow

1. **Input.** Choose the original token merchant plan or a complete exported connection bundle. The workspace retains the complete JSON text, filename, exact byte hash and normalized original plan. Open any saved input again from the input table.
2. **Connection review.** Inspect the actual provider origin, authentication mode, account alias, credential environment name, selected data chain, limits and reference source. Existing payment network, asset, recipient and atomic prices remain visible. A bundle uses its original complete review; a plan can produce a new provider/account review.
3. **Packages.** Choose a private package destination. Preparation and receiving call the existing connection engine. It publishes the complete package atomically and reopens an interrupted operation at the same destination. The package table retains the plan, package manifest and complete bundle hashes. Export the complete connection bundle for another authorized installation.
4. **Applications.** Connect the existing runtime workspace that owns your installed Stellar Forge runtimes. Select the received package and runtime, then enter a merchant label, the correct private merchant state, facilitator URL, optional private environment JSON path and local ports. Review the original Applications selection and save it.
5. **Launch and recovery.** Reopen the saved runtime connection if its initial adoption is still completing. Review the original launch, then start the merchant. The card shows the original run, provider desk link, process output, recovery and graceful stop controls. Refresh reads its current retained state.

The browser uses forms and file selection for the workflow. Source identities and original operation IDs remain available for receiving and recovery; credential values are supplied by the host environment.

### Provider/account decisions

The original connection engine distinguishes Blockscout PRO credits from an operator instance's local request budget. PRO uses its documented origin and bearer authentication. An operator instance selects one existing data chain and its original reviewed route; the form sets one request per attempt, keeps the daily request budget equal to its attempt budget, and uses no provider-credit minimum.

A different provider identity requires another account alias. The retained review explicitly states when a separate merchant state is required. Continue using the same state directory for the same account across restart and credential rotation. The original provider/merchant engine checks the account identity when it opens that state.

Payment amounts remain the original atomic decimal strings. The workspace does not convert them through floating-point display or choose new prices, recipients or assets.

### Challenge-only deployment and paid activation

The merchant form has an explicit deployment mode. Paid remains the default. Challenge-only opens the original unpaid routes, offers and private provider desk while provider credentials and facilitator configuration are being completed.

After the original run stops, **Review deployment** edits the same saved application. Its review pins the current revision and changes only mode, facilitator, environment-file reference and the local-facilitator option. Save the review, then use the existing launch review/start controls. The package, runtime, managed home, account state and earlier runs remain attached to that same application ID.

[Complete deployment, activation and recovery guide](../DEPLOYMENT.md) includes both installed CLI and browser paths. History can reopen a saved deployment review or finish its original save after a lost return. The selected installed runtime must include the explicit deployment capability; old default-paid source requests remain supported.

### Applications authority

The setup workspace stores a binding to the exact existing runtime workspace identity. It calls that workspace's original review, save, runtime adoption, launch, output, recovery and stop methods. Each saved merchant belongs to this desk's selected package and original application revision. A later external application edit must be reconciled in Applications before this desk can launch it.

Saving the same retained application review resolves to one deterministic original Applications save request. A lost local return can therefore reopen the same merchant record. Launches retain the caller's stable request ID as the original managed run ID. A new launch requires the existing engine's launch review and runtime/resource checks. Recovery selects a retained run; it does not create a replacement process from an inferred status.

Closing the setup server drains every active request, including work continuing after a caller disconnects. It closes its own local view after receiving finishes. The separately managed merchant remains under the original Applications process controls and is stopped through its explicit original stop action.

## CLI receiving

All writes use a stable request UUID. Keep that UUID with the selected original input. For example:

```sh
node CONNECTION_CLI init --workspace /private/blockscout-connections
node CONNECTION_CLI intake --workspace /private/blockscout-connections \
  --file /private/actual-token-plan.json --request-id ORIGINAL_UUID
node CONNECTION_CLI review --workspace /private/blockscout-connections \
  --source RETURNED_SOURCE_ID --request-id REVIEW_UUID
node CONNECTION_CLI prepare --workspace /private/blockscout-connections \
  --review RETURNED_REVIEW_ID --request-id PREPARE_UUID
node CONNECTION_CLI export --workspace /private/blockscout-connections \
  --package RETURNED_PACKAGE_ID --out /private/blockscout-connection.json
```

`CONNECTION_CLI` is the full CLI path used above. The example names denote returned identities and operator-selected UUIDs; use the actual returned values.

For a complete bundle, `intake` followed by `review` without a changes file retains its original source review. For a plan, a review without changes records the actual retained review operation's creation time; reopening the same request preserves that time. An explicit changes file carries its selected reviewedAt. `prepare` chooses the original receiving path automatically and rebuilds the trusted local handler entry using this installation. Exported handler strings are checked as package bytes and are never evaluated as remote code.

To select another connection from a plan, provide `review --changes /private/connection-changes.json` using the original `reviewConnection` change contract: a complete connection object and, when needed, accountAlias, apiKeyEnv and limits. `record --type sources --id SOURCE_ID` reopens the original source; `record --type reviews --id REVIEW_ID` opens the full retained review.

The default package destination is inside the private connection workspace's `received` directory. A chosen `--out` destination can be elsewhere under an existing private parent. Foreign existing content is preserved by the original receiver.

### Original Applications receiving

```sh
node CONNECTION_CLI connect --workspace DESK \
  --applications EXISTING_RUNTIME_WORKSPACE --request-id BIND_UUID
node CONNECTION_CLI applications --workspace DESK --binding RETURNED_BINDING_ID
node CONNECTION_CLI application-review --workspace DESK \
  --package PACKAGE_ID --binding BINDING_ID --runtime ORIGINAL_RUNTIME_ID \
  --label "Selected merchant" --settings /private/merchant-settings.json --request-id APP_REVIEW_UUID
node CONNECTION_CLI application-save --workspace DESK \
  --review APP_REVIEW_ID --request-id APP_SAVE_UUID
node CONNECTION_CLI reconnect --workspace DESK \
  --application ORIGINAL_APPLICATION_ID --request-id CONNECT_UUID
node CONNECTION_CLI launch-review --workspace DESK \
  --application ORIGINAL_APPLICATION_ID --request-id START_REVIEW_UUID
node CONNECTION_CLI launch --workspace DESK \
  --review ORIGINAL_START_REVIEW_ID --request-id ORIGINAL_RUN_UUID
```

The private settings file contains stateDirectory, facilitator and optionally environmentFile, port, operationsPort, deskPort, drainGraceMs and allowLocalFacilitator. The package path is supplied from the retained package record. Ports are integers and 0 selects an available port. Drain grace is a whole-number string, preserving the original Applications field contract. Local HTTP facilitators are limited by the original merchant helper to explicitly selected 127.0.0.1.

For a lost response, use:

```sh
node CONNECTION_CLI history --workspace DESK
node CONNECTION_CLI resume --workspace DESK --operation ORIGINAL_REQUEST_UUID
node CONNECTION_CLI output --workspace DESK \
  --application ORIGINAL_APPLICATION_ID --operation ORIGINAL_RUN_UUID
node CONNECTION_CLI recover-run --workspace DESK \
  --application ORIGINAL_APPLICATION_ID --operation ORIGINAL_RUN_UUID --request-id RECOVER_UUID
node CONNECTION_CLI stop --workspace DESK \
  --application ORIGINAL_APPLICATION_ID --operation ORIGINAL_RUN_UUID --request-id STOP_UUID
```

History is paginated with `--after` and `--limit`; the response returns the next original cursor. The first workspace overview includes the newest 30 operations. The CLI and browser use the same saved records.

## Host integration API

`createConnectionWorkspace({directory})` initializes an empty private location or recovers the same existing configuration. `openConnectionWorkspace({directory})` opens its retained identity and returns:

| Method | Result |
| --- | --- |
| `state()` | Original configuration, saved inputs, reviews, packages, Applications bindings and recent actions |
| `history({after,limit})` | Stable ID page of retained actions |
| `record(type,id)` | One complete original source, review, package, binding or action |
| `call(action,payload)` | The selected action with required stable requestId for writes |
| `applicationsState(bindingId)` | Existing runtime choices and only merchant applications saved by this desk |
| `output(applicationId,operationId)` | The selected original Applications operation output |
| `download(packageId)` | Complete original bundle bytes, SHA-256 and filename after package readback |
| `close()` | Releases this view; process lifetime stays with Applications |

Actions are `intake`, `review`, `prepare`, `connect`, `application-review`, `application-save`, `reconnect`, `launch-review`, `launch`, `recover-run` and `stop`. `resume` takes only the original operationId and reuses its retained action and input.

The local server exposes these as `POST /api/actions/ACTION`. Read routes are `/api/state`, `/api/history`, `/api/records/TYPE/ID`, `/api/applications/BINDING_ID`, `/api/output/APPLICATION_ID/OPERATION_ID` and `/api/packages/PACKAGE_ID`. All data routes require the startup capability in `x-blockscout-connection-token`; writes additionally require the exact local Origin. Requests are capped at 4 MiB and complete input files at 2 MiB.

## Retained implementation

This workspace composes the original connection review and package receiver from [PR1950](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1950) (merge `4d3eb762c22c68f4f1e09ea82855e6b8f9d102b5`), the original private storage/lease helpers and the original Applications engine. The existing `blockscout` merchant command and embedded operator desk remain available in the same distribution.

The distribution contribution adds one command, two API exports and this browser asset manifest. Its provider registration extends the existing Blockscout provider with a source-owned catalog, command preparation and startup observer for this desk. Payment, provider calls, runtime installation and process lifetime continue through those original engines.

For the maintained merchant plan, payment and provider contract, use [../CONNECTIONS.md](../CONNECTIONS.md), [../CONTRACT.md](../CONTRACT.md) and [../README.md](../README.md). The completed original provider response, payment and merchant tail can be reused as receiving inputs; commissioning this setup workflow does not require repeating that completed provider call.
