# Dwellir application migration workbench

A complete receiving and operator package for moving one existing Polkadot/Substrate application's HTTPS RPC configuration to Dwellir. It composes Dwellir's original endpoint catalog and native CLI with the application's existing environment or JSON bindings.

The migration operates real JSON-RPC reads against the selected original and Dwellir endpoints. It compares the intended genesis, chain name, health and finalized state, then retains an exact configuration change for the operator to review. Apply, reopen, handoff and rollback use the same private operation.

## Start the complete receiving example

Requirements: Python 3.10 or newer; Node 24.5 or newer for the supplied optional proxy flag; ordinary HTTPS access to Dwellir and rpc.polkadot.io. The operator uses Python's standard library. The Node application uses the standard HTTPS client. There is no dependency build.

~~~sh
python3 -B delivery/native_receiving.py \
  --source /absolute/path/to/dwellir-migration \
  --directory /absolute/private/path/dwellir-receiving \
  --node /absolute/path/to/node
~~~

Choose a new receiving directory. The command creates one application with its original rpc.polkadot.io configuration, prepares the migration, applies the selected review, runs both application clients against Dwellir, exports the complete handoff, and restores both original configuration files byte for byte. The receiving command retains each completed stage and can continue with the same arguments plus --resume. Exact completed provider responses within the selected observation age can be reused; each retained result keeps its original UTC time and source identity.

Its example values are:

| Setting | Selected value |
| --- | --- |
| Chain/network | Polkadot mainnet relay chain |
| Intended genesis | 0x91b171bb158e2d3848fa23a9f1c25182fb8e20313b2c1eb49219da7a70ce90c3 |
| Original HTTPS endpoint | https://rpc.polkadot.io |
| Dwellir HTTPS endpoint | https://polkadot-rpc.n.dwellir.com |
| Source environment binding | APP_RPC_URL in .env |
| Source JSON binding | /rpc/url in application-config.json |
| Declared application methods | chain_getBlockHash, chain_getFinalizedHead, chain_getHeader, state_getRuntimeVersion |
| RPC transport | HTTPS JSON-RPC 2.0 |
| Response limit | 1 MiB per response |
| Request timeout | 15 seconds |

The receiving directory contains the original application's private working configuration, a retained migration-operation, source captures, the two actual client outputs and a portable buyer-handoff. receiving.json records each stage and the original source hashes.

## Operate an existing application

Use the example plan as a starting point. Select the exact chain/network, intended genesis, existing environment binding, and one to three endpoint bindings. Application paths are relative to --project. Keep the operation directory outside that application.

A binding can update one existing environment variable or one existing string in a JSON file:

~~~json
{
  "bindings": [
    {"kind": "env", "path": ".env", "name": "APP_RPC_URL"},
    {"kind": "json", "path": "application-config.json", "pointer": "/rpc/url"}
  ]
}
~~~

Environment changes retain unrelated lines. JSON changes retain the parsed object and use stable, readable formatting. Review contains the exact original and proposed file hashes, the selected source-file hashes, discovered RPC references, actual method inventory, endpoint selection and finalized-state comparison.

~~~sh
python3 -B dwellir_migration.py prepare \
  --plan /absolute/path/polkadot-plan.json \
  --project /absolute/path/existing-application \
  --operation /absolute/private/path/migration-operation
~~~

Read review.json and the selected configuration snapshots in the private operation. Apply the returned reviewSha256:

~~~sh
python3 -B dwellir_migration.py apply \
  --operation /absolute/private/path/migration-operation \
  --review-sha256 RETURNED_REVIEW_SHA256

python3 -B dwellir_migration.py inspect \
  --operation /absolute/private/path/migration-operation

python3 -B dwellir_migration.py handoff \
  --operation /absolute/private/path/migration-operation \
  --output /absolute/path/new-buyer-handoff
~~~

The operator serializes writers with its original operation lock. Each replacement is written and synced before its atomic rename; the parent directory is then synced. Reopen compares the actual configuration with both retained versions. A later edit is reported as a conflict and remains available for a new review. A partially completed apply or rollback can continue from each file's observed version.

Rollback restores the original bytes and mode:

~~~sh
python3 -B dwellir_migration.py rollback \
  --operation /absolute/private/path/migration-operation
~~~

## Use the customer's existing Dwellir account and CLI

The native CLI is the owner of account selection, authentication, key lookup and environment generation. Source integration was read against Dwellir CLI 0.2.1 at f49ef22ffa38f611c46e700c7b618ef98d648d04.

Inspect the actual existing native account and endpoint selection first:

~~~sh
dwellir --profile CUSTOMER_PROFILE account info --json
dwellir --profile CUSTOMER_PROFILE endpoints get polkadot \
  --network mainnet --protocol https --json
~~~

Then select an existing enabled named key through the original project command. The wrapper invokes that same command with --key-name:

~~~sh
python3 -B dwellir_migration.py native-setup \
  --project /absolute/path/existing-application \
  --chain polkadot --network mainnet \
  --key-name EXISTING_ENABLED_KEY_NAME \
  --profile CUSTOMER_PROFILE \
  --env-file .env.local \
  --binary /absolute/path/to/dwellir
~~~

The native CLI writes DWELLIR_RPC_URL, DWELLIR_WSS_URL and DWELLIR_API_KEY to its private .env.local and adds the original ignore rule. This operator consumes DWELLIR_RPC_URL. Its setup result returns the selected hostname and file, while the original credential remains in the native environment.

Set the candidate in the application's migration plan:

~~~json
{
  "candidate": {
    "mode": "native-project",
    "file": ".env.local",
    "profile": "CUSTOMER_PROFILE",
    "binary": "/absolute/path/to/dwellir"
  }
}
~~~

Add nodeType when the native endpoint catalog requires that exact node selection. Native authentication resolves DWELLIR_TOKEN before the command profile; use the original account read to establish the selected account in that environment. Prepare retrieves the native endpoint catalog and matches the configured complete URL to exactly one native HTTPS template.

## Application clients

The two supplied readers consume the same application environment and retain the actual matching JSON-RPC requests and raw response text:

~~~sh
python3 -B apps/polkadot_reader.py \
  --env-file /absolute/path/existing-application/.env \
  --output /absolute/private/path/python-application.json

node apps/polkadot_reader.mjs \
  --env-file /absolute/path/existing-application/.env \
  --output /absolute/private/path/node-application.json
~~~

For a deployment with an existing approved HTTPS proxy, Node 24.5+ accepts --use-env-proxy. The receiving command supplies that flag when the original process declares HTTP_PROXY or HTTPS_PROXY. Normal certificate verification remains enabled.

The caller result identifies the selected host, genesis, finalized hash, header and runtime version. Every raw provider response is retained with its request and SHA-256.

## Historical application requirements

The baseline and candidate always compare chain_getHeader and state_getRuntimeVersion at the same original finalized block. That establishes a common actual state.

When an application depends on historical state, add its actual block-specific probes:

~~~json
{
  "historicalProbes": [
    {
      "name": "retained-account-state",
      "method": "state_getStorage",
      "params": ["EXACT_STORAGE_KEY_HEX", "EXACT_32_BYTE_BLOCK_HASH"]
    }
  ]
}
~~~

Use the application's actual storage key and retained block hash. Both providers must return the same result. Null is accepted only when the selected probe explicitly declares allowNull: true. The public catalog reports the example keyless Polkadot endpoint as archive: false; use the account's exact archive endpoint when the application's source requires an archive service.

The selected product contract is Substrate HTTPS reads. WebSocket subscriptions stay with the application's existing connection lifecycle and require a selected WSS migration scope. EVM chain identity, trace compatibility and other RPC families use their own method contracts.

## Files

| File | Purpose |
| --- | --- |
| dwellir_migration.py | Native CLI handoff, endpoint selection, source/configuration review and durable operator |
| apps/polkadot_reader.py | Actual Python application HTTPS caller |
| apps/polkadot_reader.mjs | Actual Node application HTTPS caller |
| examples/polkadot-plan.json | Complete selected receiving plan |
| delivery/native_receiving.py | Complete private receiving operation |
| OPERATOR.md | Recovery, source review and deployment handoff |
| OFFER.md | Fixed-scope commercial workshare |
| SOURCE_MAP.json | Original primary sources and native CLI pins |

The buyer handoff contains the operator, both clients, receiving command, selected plan/review and exact successful provider captures. The retained original configuration and credentials stay with the private operating application.
