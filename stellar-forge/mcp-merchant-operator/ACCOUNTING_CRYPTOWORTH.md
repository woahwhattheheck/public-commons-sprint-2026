# Cryptoworth accounting through the installed merchant

The installed merchant exposes the complete existing Cryptoworth accounting workflow through the original merchant MCP listener, a typed JavaScript client, a prepared-operation command, and the existing Applications console. Every interface uses the same private accounting workspace, original accountant revisions, native import-unit history and workspace lease.

The [original operator guide](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/CRYPTOWORTH.md) covers the customer template, exact Crypto ID mapping, dates and atomic amounts. This guide covers connecting the installed product and carrying those operations through review, saving, recovery and delivery.

## Connect the original workspace

Use an installed distribution containing the Cryptoworth component and the current merchant operator. Declare the existing accounting directory and its original source paths in a private accounting configuration. Input aliases refer to the actual customer-supplied template, native export, date evidence and saved receiving packets.

```json
{
  "workspaces": {
    "merchant": {
      "label": "Merchant accounting",
      "directory": "/srv/starforge/accounting",
      "outboxDir": "/srv/starforge/outbox",
      "proofDir": "/srv/starforge/proofs",
      "termsFile": "/srv/starforge/terms.json",
      "cryptoworthInputs": {
        "customer_template": "/srv/starforge/inputs/customer-template.csv",
        "native_export": "/srv/starforge/inputs/native-export.csv",
        "transfer_dates": "/srv/starforge/inputs/transfer-dates.json",
        "receiving_packet": "/srv/starforge/inputs/receiving-packet.json"
      }
    }
  }
}
```

Paths above are configuration examples; select the existing customer operation's actual paths. Each original source map supports up to 64 named inputs. The listener resolves aliases through its existing host file reader. Caller requests carry a source alias and original filename, followed by exact SHA256 and byte count after preview.

Initialize the original merchant configuration in a new private directory and start its existing listener:

```sh
starforge merchant-mcp init-accounting \
  --dir /srv/starforge/accounting-mcp \
  --accounting /srv/starforge/accounting-inputs.json
starforge merchant-mcp serve \
  --config /srv/starforge/accounting-mcp/merchant-mcp.json \
  --port 3211 \
  --token-env MCP_ACCESS_TOKEN
```

The token is supplied through the named runtime environment variable. The listener returns its actual MCP URL. Opening an accounting alias acquires the original workspace lease. Close the original browser or Applications owner before opening that directory through MCP; close the MCP accounting owner before launching its managed browser. The original lease enforces this ownership transition.

## Select the actual source

Use `merchant_accounting_cryptoworth_status` to read the current workspace ID and revision. Its `profiles`, `plans`, `handoffs` and `rollbacks` views page retained records with offsets and limits of 1–200. `merchant_accounting_sources` lists the configured input aliases.

Select the original handoff and an explicit accountant revision. The value `initial` selects the unchanged first handoff. The source preserves the frozen payment and verified-return snapshot; later live refunds remain in the later accounting source. Rows retain exact atomic amounts and opaque native identifiers.

`merchant_accounting_cryptoworth_source` accepts:

```json
{
  "workspace": "merchant",
  "handoffId": "SELECTED_ORIGINAL_HANDOFF_ID",
  "accountantRevisionId": "initial",
  "offset": 0,
  "limit": 50
}
```

Inspect the actual native CSV template before mapping it:

```json
{
  "workspace": "merchant",
  "file": {
    "source": "customer_template",
    "name": "customer-template.csv"
  }
}
```

The template result retains its actual headers, delimiter, newline, byte count, SHA256 and sample rows. Map the required native roles to those exact headers, and explicitly supply literal values for the remaining template columns.

## Review and save the complete customer operation

The four operation families use the same preview/save protocol:

| Kind | Original operation | Selected inputs |
| --- | --- | --- |
| `profile` | Retain a mapping of the customer's template | Template alias, exact columns and constants, customer entity/connection, merchant account, date format/timezone and chain-specific asset/Crypto ID/scale mappings |
| `plan` | Freeze the selected merchant/accountant source and generate the native import file | Profile ID, original handoff ID, explicit accountant revision, optional preceding plan, original movement decisions and exact date evidence |
| `capture` | Compare a selected native export with that frozen plan | Plan ID, export alias, actual native import ID/entity/connection/time/reference, baseline or import-return purpose and selected export layout |
| `return` | Apply the reviewed comparison through the original accountant engine | Plan/capture IDs, current accountant parent, operator, REVIEWED or BOOKED status and bookkeeping references |

Call `merchant_accounting_cryptoworth_<kind>_preview` with `request` and, for captures/returns, `planId`. Retain the entire returned preview. The preview includes the normalized request ID and timestamp, original workspace ID and revision, each selected file's SHA256 and byte count, native request SHA256, native preview SHA256 and the complete wire SHA256.

The SDK's `save(preview)` validates that complete binding, reconciles the saved original ID first, and then submits the exact native request when it still needs saving. This ordering lets a completed operation reopen even when a source alias has since changed. A pending save reopens every selected alias and requires its original reviewed bytes before continuing.

Native IDs follow the existing core's `[A-Za-z0-9][A-Za-z0-9._-]{0,159}` contract. Generated UUIDs and valid retained names such as `mapping-current` use the same read/save/recovery path.

### Typed client

The installed package exports the connection and operation modules, with TypeScript declarations:

```js
import {connectAccountingCryptoworthClient} from
  '@tokenjunkielabs/starforge-merchant/merchant/accounting-cryptoworth';
import {prepareAccountingCryptoworthOperation, runAccountingCryptoworthOperation} from
  '@tokenjunkielabs/starforge-merchant/merchant/accounting-cryptoworth/operations';

const client = await connectAccountingCryptoworthClient({
  url: process.env.MERCHANT_MCP_URL,
  workspace: 'merchant',
  tokenEnv: 'MCP_ACCESS_TOKEN',
});

try {
  await client.open();
  const status = await client.status();
  const handoffs = await client.allStatus('handoffs');
  // Choose a retained source and build its complete request from the actual
  // template/source results described above.
  const preview = await client.preview('profile', selectedProfileRequest);
  await savePrivatePreview(preview);
  const prepared = await prepareAccountingCryptoworthOperation({
    directory: selectedNewOperationDirectory,
    url: client.endpoint,
    workspace: client.workspace,
    kind: 'profile',
    preview,
  });
  const saved = await runAccountingCryptoworthOperation({
    directory: prepared.directory,
    client,
    execute: true,
  });
  console.log({phase: saved.phase, id: saved.record?.id});
} finally {
  await client.closeWorkspace();
}
```

The example's request selection and private preview writer belong to the calling application. The complete request types are exported in the client declaration file. `createAccountingCryptoworthClient({workspace, call})` also accepts an existing structured merchant MCP call function.

`allStatus`, `allPlan` and `allRows` require a stable original workspace ID, revision and count across pages. A changed observation asks the caller to reopen its current selection. Direct page methods remain available for an interactive view.

### Installed command

The same client is available at `starforge merchant-accounting-cryptoworth` and through `starforge merchant-mcp cryptoworth`.

```sh
starforge merchant-accounting-cryptoworth status \
  --url http://127.0.0.1:3211/mcp --workspace merchant

starforge merchant-accounting-cryptoworth preview \
  --url http://127.0.0.1:3211/mcp --workspace merchant \
  --kind profile --request /srv/starforge/requests/profile.json \
  --out /srv/starforge/reviews/profile-preview.json

starforge merchant-accounting-cryptoworth prepare \
  --dir /srv/starforge/operations/profile-save \
  --url http://127.0.0.1:3211/mcp --workspace merchant \
  --kind profile --preview /srv/starforge/reviews/profile-preview.json

starforge merchant-accounting-cryptoworth execute \
  --dir /srv/starforge/operations/profile-save
starforge merchant-accounting-cryptoworth reconcile \
  --dir /srv/starforge/operations/profile-save
```

Use the actual URL returned by the original listener. Request and preview inputs are private regular JSON files; prepared-operation directories are new, private directories. `prepare` saves one immutable request and its state journal. The endpoint, workspace alias, token environment-variable name and exact native arguments are retained; credentials stay in the runtime environment.

`execute` and `reconcile` always reuse that saved operation. `reconcile` queries its original result. `execute` continues the saved native request after reconciliation when required. An uncertain response retains `OUTCOME_PENDING`; reopening uses the same native ID and hashes.

For direct use of the already running accounting browser owner or its stopped local workspace, retain the existing command:

```sh
starforge merchant-accounting-workspace cryptoworth --help
```

That command uses the original browser API or local controller. The installed MCP command connects to the existing merchant listener.

## Original accountant recovery

A native return is staged before the original accountant engine applies its protected CSV. Its retained status carries the actual outcome:

| Native return state | Caller behavior |
| --- | --- |
| `PREPARED` | Retain the exact request, preview hash and ID; execute the same saved operation to finish or recover the original accountant result |
| `COMMITTED` | Consume the original saved result and protected accountant revision |
| `SUPERSEDED` | Keep the terminal history and prepare a new review against the actual current accountant parent or receiving coverage |

The controller checks whether that original native ID is already present in accountant revisions before superseding an interrupted stage. A saved accountant result recovers through the original ID. The client requires both request and preview hashes to match before adopting any retained result.

`disconnect()` drains the caller's tracked calls and retained file reads while leaving the original accounting owner open. `closeWorkspace()` drains the caller and closes that original owner. Both prevent new calls from entering after closure. The original merchant maintenance pause also drains accepted operations and file reads before closing its controllers.

## Return files and receiving packets

Use the original `merchant_accounting_file` scope `kind: "cryptoworth"`. Select a profile and filename, or a plan plus an optional capture/return/rollback. Staged and completed return files retain their native `scope`. A complete packet selects only the plan and `file: "packet"`.

```json
{
  "kind": "cryptoworth",
  "planId": "SELECTED_NATIVE_PLAN_ID",
  "file": "packet"
}
```

File listings supply the original names, sizes and SHA256s. The installed download uses the original retained-read handle, verifies the selected metadata on every chunk, verifies the complete file hash, releases partial reads and writes a new private destination.

```sh
starforge merchant-accounting-cryptoworth download \
  --url http://127.0.0.1:3211/mcp --workspace merchant \
  --selection /srv/starforge/requests/packet-selection.json \
  --sha256 SELECTED_FILE_SHA256 \
  --out /srv/starforge/delivery/receiving-packet.json
```

A receiving host declares the packet in its own `cryptoworthInputs` map. `inspectPacket(file)` reconstructs the original template, profile, source, generated CSV, native comparisons, accountant returns and coverage. `receivePacket(inspection, {actor})` binds both the actual input SHA256 and the sealed packet SHA256. It checks existing original IDs before merging and records the exact received packet. `reconcilePacket(inspection)` reads that original receipt before another receive attempt.

The prepared command supports `--kind packet --inspection PRIVATE_JSON --actor NAME`. It retains the same packet inspection and destination workspace binding for execute/reconcile.

## Record a completed native rollback

The native vendor import unit is identified by its actual import ID, customer entity and connection. After the operator completes that whole-unit rollback, `rollback(arguments)` records its actual completion time and reference in the original accounting workspace. Receiving coverage for every movement in that import unit updates together. Earlier plan, capture and accountant history remain retained.

Arguments contain `workspaceId`, `planId` and a request with `id`, `captureId`, `nativeImportId`, `completedAt`, `actor`, `reason`, `reference` and current `revision`. The installed prepared command accepts `--kind rollback --request PRIVATE_JSON`; execution reconciles the same native rollback ID before recording it.

## Open the original desk through Applications

Choose **Cryptoworth accounting** in the existing Applications catalog and select the initialized private accounting workspace. The original runtime inspection verifies that the installed component contains the binding inspector. Review records the original workspace ID and source-configuration SHA256, and declares its source directories, terms file and runtime modules as inputs.

Launch uses the original `merchant-accounting-workspace` command with those expected identities and `--desk cryptoworth`. After acquiring its original lease, the server checks the workspace and source configuration before startup recovery writes. Its retained startup message names the same identities and actual loopback browser URL. Applications verifies that message and opens the original Cryptoworth desk.

A replaced directory or changed accounting source configuration requires a fresh Applications review. Product edits within the same workspace remain part of the original accounting history. Stop drains the original pending Cryptoworth mutation and closes the same owner through the existing managed-command lifecycle.

## Source and limits

The adapter calls the original [Cryptoworth controller](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/cryptoworth-workspace.mjs), [CSV model](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/accountant/cryptoworth-csv.mjs) and [accountant engine](../../stellar/scf-starforge-20261009/merchant-settlement-accounting/accountant/cryptoworth.mjs). Host configuration, token validation, file delivery, maintenance and managed processes remain in their original owners.

Customer template and native CSV files use the native 64 MiB limit. A plan's complete date-evidence selection is capped at 64 MiB. Complete receiving packets use the native 128 MiB limit. The MCP wire carries pinned aliases instead of embedding those full files in tool results. Native CSV comparison retains explicit date layouts, selected signs, exact decimal scales and opaque Crypto IDs throughout the operation.
