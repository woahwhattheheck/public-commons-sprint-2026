# Principal native operator

This is the complete local Node 22.16 or later operator for the selected Principal reference contracts. It keeps one SQLite workspace, full original files, typed plans, native observations and immutable request history. The current implementation uses Linux for the Node workspace. Its dedicated Python child reuses the complete reviewed Linux subreaper/namespace/pidfd process owner. The included owner also retains its Windows implementation, but the complete Node workspace does not claim Windows commissioning.

## Start and inspect

Use the original selected Node 22.16 or later executable and a private absolute workspace directory:

```sh
node operator/cli.mjs init --workspace /ABS/principal-workspace --out /ABS/new-initial-state.json
node operator/cli.mjs serve --workspace /ABS/principal-workspace --token-file /ABS/private-operator-token --host 127.0.0.1 --port 0
```

The token file contains at least 24 characters. The server prints the actual loopback URL and workspace ID, without the token. Open that URL in the browser and enter the token. Only this server or one CLI command may own the original workspace at a time. Stop the server cleanly before using a separate CLI against the same directory. The server retains the workspace lease until outstanding commands and owned children have closed.

The CLI supports init, state, bootstrap, command, request, file, export, inspect, receive and course. Run help for exact arguments. Every output selected with --out is a complete create-only file. An existing output is accepted only when its full bytes agree. Do not reuse one output filename for a changed state or different result.

## Configuration

Save a complete or unfinished configuration through config.save. The supported object is:

```json
{
  "name": "Principal workspace",
  "network": {"rpcUrl": "OPERATOR_SELECTED_RPC", "passphrase": "OPERATOR_SELECTED_NETWORK"},
  "sourceAccount": {"alias": "existing-local-signer", "address": "ORIGINAL_G_ACCOUNT"},
  "stellar": {
    "executable": "/ABS/stellar",
    "sha256": "EXACT_EXECUTABLE_SHA256",
    "version": "EXACT_STELLAR_VERSION_OUTPUT",
    "configDirectory": "/ABS/existing-stellar-config",
    "python": "/ABS/python3"
  },
  "contracts": {
    "permissioning": {"id": "ORIGINAL_C_CONTRACT", "wasmSha256": "EXACT_DEPLOYED_WASM_SHA256"},
    "oracle_adapter": {"id": "ORIGINAL_C_CONTRACT", "wasmSha256": "EXACT_DEPLOYED_WASM_SHA256"},
    "risk_control": {"id": "ORIGINAL_C_CONTRACT", "wasmSha256": "EXACT_DEPLOYED_WASM_SHA256"},
    "sy_wrapper": {"id": "ORIGINAL_C_CONTRACT", "wasmSha256": "EXACT_DEPLOYED_WASM_SHA256"},
    "principal_manager": {"id": "ORIGINAL_C_CONTRACT", "wasmSha256": "EXACT_DEPLOYED_WASM_SHA256"}
  },
  "executionEnabled": false
}
```

These are explanatory placeholders, not a usable network, signer or deployment. Prepare requires the complete selected contract, network and runtime binding. Private signing material stays in the existing Stellar CLI key store. Each native attempt checks the alias's current public account against the selected address. The operator does not create accounts, deploy contracts or fund them.

The exact callable catalogue is derived from CONTRACT_API.json. Every i128/u64 parameter is a decimal string; every Boolean is an actual Boolean. Address parameters are explicit public G/C strings; contract byte hashes are 64 lowercase hexadecimal characters. The CLI performs full network and ABI validation. There is no floating-point money conversion.

## Native request and uncertainty

A command is exactly {requestId,expectedRevision,method,args}. Its full immutable body is saved before any native work. Identical original requests replay before revision checks. A changed body under an existing ID is rejected. A complete response records workspaceId, requestId, revision and result.

plan.prepare saves a complete typed instruction and exact simulation/execution argv. plan.simulate uses --send no. observation.capture accepts only installed read-only methods and also uses --send no. plan.execute requires an explicit current executionEnabled configuration equal to the original plan. It invokes the exact original --send yes command at most once for that plan in this workspace. An uncertain result remains held under the same original request.

Before invocation the dedicated Python attempt copies and hashes the complete selected Stellar executable, checks its exact version output and the actual RPC network passphrase, resolves the signer alias to the original public account and reads the deployed contract's WASM hash. Every command uses explicit RPC URL, network passphrase and configuration directory. STELLAR_* and SOROBAN_* environment overrides are removed for the child. Full stdout, stderr, actual process identities and the terminal attempt file are retained. Process groups and adopted descendants close before a terminal result is accepted.

The native attempt writes its original reservation before launching any CLI command. If the parent or host disappears after reservation and no complete terminal receipt exists, a resumed request refuses to spawn again. Preserve that directory and reconcile the original selected process/transaction with its operator. A new request ID is not an uncertainty recovery mechanism.

CLI_EXIT_0 reports the original CLI exit status; it is not an independent assertion of finality. CLI_NONZERO, UNKNOWN and NOT_INVOKED remain explicit. Original stdout is always retained. Valid JSON is decoded with an exact-number lexer: large bare integer values become their complete decimal strings with original JSON-pointer number tokens. Parse errors remain visible beside the original bytes.

Every observation includes the exact configuration plus network/RPC/contract binding. Numeric issue IDs from different managers or networks are separate source identities. Claims and principal_shortfall use USDC accounting atoms; budgets and payouts use the selected underlying token atoms. Both use seven decimal places, but their units remain distinct. PT/YT are issuance-scoped internal balances in this reference version.

## Source and portable workspace

source.import accepts {name,type,contentBase64,bytes,sha256}; all complete bytes and their verified digest are retained. Individual browser imports are limited to 32 MiB, native objects to 128 MiB, aggregate retained objects to 512 MiB and complete portable files to 768 MiB. Nothing is truncated. An oversized result remains in its original attempt directory and must be reconciled there; a new dispatch must not be substituted.

```sh
node operator/cli.mjs command --workspace /ABS/principal-workspace --input /ABS/original-command.json --out /ABS/original-response.json
node operator/cli.mjs request --workspace /ABS/principal-workspace --id ORIGINAL_REQUEST_ID --out /ABS/request-observation.json
node operator/cli.mjs export --workspace /ABS/principal-workspace --out /ABS/complete-workspace.json
node operator/cli.mjs inspect --input /ABS/complete-workspace.json --out /ABS/inspection.json
node operator/cli.mjs receive --input /ABS/complete-workspace.json --workspace /ABS/new-recipient --request-id ORIGINAL_RECEIVE_ID --out /ABS/receive-observation.json
```

A complete portable includes all saved state, all original requests/results, every original object, the exact action API and every selected application source member. Inspection verifies whole payload identity, all file bytes, request intents, history hashes and application roster. Receive copies into a new or same-request-owned destination, keeps the original workspace/request identity together and retains the exact received packet plus full application. It does not execute copied application code automatically. Current execution is disabled until the recipient explicitly saves a selected configuration.

Copied RUNNING/UNCERTAIN requests are marked as belonging to their original native owner. They cannot dispatch from the recipient, which lacks the original attempt's execution custody. Completed requests remain replayable. Repeating the same receive preserves all later customer changes and finishes any interrupted source-file materialization.

The browser working copy is separate from the native workspace: it holds unfinished fields, full selected source files, original browser requests and prior restored views. Export both when transferring unfinished work. Browser inspection/restore never dispatches a provider command.

## Exact native interface sources

The operation arguments and explicit send modes follow the official Stellar CLI manual and argument cookbook:
- https://developers.stellar.org/docs/tools/cli/stellar-cli
- https://developers.stellar.org/docs/tools/cli/cookbook/contract-invoke-arguments

The runtime is selected by its actual executable SHA-256 and version output, not by a floating latest-version assumption. Reference contracts use Soroban SDK 26.0.1, Rust 1.91 and wasm32v1-none as recorded in the full source ABI. This source delivery does not assert a native compile, deployed address, funded invocation or rendered browser receiving result.
