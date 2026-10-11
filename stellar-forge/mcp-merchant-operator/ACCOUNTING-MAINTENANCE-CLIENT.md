# Operate accounting backup and recovery from a merchant client

The maintenance client uses the merchant MCP service that already owns the accounting workspace. It supports the complete pause, source review, encrypted backup, verification, cold recovery and resume workflow, while keeping the original job IDs and retained customer files available to the operator.

The installed command is:

```sh
starforge merchant-accounting-maintenance --help
```

The same client is also available as `starforge merchant-mcp maintenance ...`. The existing `merchant-accounting-recovery` command continues to import completed purchases; operating backup and restore use `merchant-accounting-maintenance`.

## Configure the existing host

In the accounting JSON already supplied to `merchant-mcp init-accounting`, add this optional block to the chosen `workspaces.<alias>` entry:

```json
{
  "recovery": {
    "stateRoot": "/srv/private/merchant",
    "backupRoot": "/srv/private/accounting-backups",
    "passEnv": "STARFORGE_ACCOUNTING_BACKUP_PASSPHRASE",
    "startPaused": false
  }
}
```

This is a fragment of that existing entry. Retain its original `directory`, `outboxDir`, `proofDir`, `termsFile` and every configured collection, recovery, pricing and accountant source alias. `stateRoot` must contain the original accounting directory. The backup catalog must be separate from the operating workspace. The original controller enforces private, owner-controlled paths and exclusive catalog ownership.

Use the existing `init-accounting` command when creating a new merchant MCP configuration. It carries this normalized recovery block into the original configuration without opening the accounting runtime. For an existing merchant, update its host configuration through the same deployment route used for its other declared sources.

Supply the backup passphrase to the merchant host through the named environment variable. The client's `MCP_ACCESS_TOKEN` is a separate bearer credential for the existing MCP listener. Neither credential belongs in a request JSON, a CLI argument value, a backup label or a tool call. Prepared operations retain only the bearer variable's **name**.

See [the accounting host guide](ACCOUNTING.md) for the native source aliases, accounting tools and returned file selections. Enabling recovery does not replace the original accountant or start another workspace engine.

## Open and inspect the declared alias

The CLI connects to an existing HTTPS endpoint or its original loopback HTTP listener. It does not start a server. For example, after setting `MCP_URL`, `ACCOUNTING_WORKSPACE` and the existing token environment variable:

```sh
starforge merchant-accounting-maintenance open \
  --url "$MCP_URL" --workspace "$ACCOUNTING_WORKSPACE"

starforge merchant-accounting-maintenance status \
  --url "$MCP_URL" --workspace "$ACCOUNTING_WORKSPACE"
```

`open` acquires the original configured workspace session. Opening a retained paused session preserves its pause; it does not issue `resume`. A new host session needs this explicit open before commands or job reconciliation. `close` closes that alias and its runtime ownership; closing the caller's HTTP connection alone does not cancel a queued merchant job.

Status includes the original mode, workspace revision, review identity, recovery state, active job and exact inventory counts. Its summary includes the newest 25 backups and 10 jobs. Page older catalog entries explicitly:

```sh
starforge merchant-accounting-maintenance status \
  --url "$MCP_URL" --workspace "$ACCOUNTING_WORKSPACE" \
  --view backups --offset 25 --limit 25
```

Views are `summary`, `backups`, `jobs` and `sources`. The jobs page covers the controller's original latest-50 view; the exact original `jobId` remains directly addressable after it leaves that summary.

## Prepare once, execute, reconcile the original job

An operation directory contains an immutable `request.json`, a private `state.json` and the existing native process lease. The request binds the endpoint, workspace alias, actor, action, original input identities and one UUID. `prepare` creates these local files without contacting the merchant. The parent directory must already exist with mode 0700, and each operation uses a new child directory.

For a pause:

```sh
starforge merchant-accounting-maintenance prepare \
  --dir "$ACCOUNTING_OPS/pause" --url "$MCP_URL" \
  --workspace "$ACCOUNTING_WORKSPACE" --actor "$ACCOUNTING_ACTOR" \
  --action pause

starforge merchant-accounting-maintenance execute \
  --dir "$ACCOUNTING_OPS/pause"
```

Read the prepared request before executing it. `execute` first looks up its exact UUID. If the native job already exists, it checks the original job inputs and follows that job. If no native job is retained, it writes the sending boundary before submitting the same prepared request. The host's existing UUID/digest admission handles a duplicate of those exact inputs.

If the connection closes or the reply is lost, retain this directory and reconnect to the same service. After opening the same alias in a new host session, use:

```sh
starforge merchant-accounting-maintenance reconcile \
  --dir "$ACCOUNTING_OPS/pause" --wait-ms 30000
```

`reconcile` only reads and waits for the original job. It never submits an operation. A missing job is reported as `found:false`, without claiming that an earlier request could not have reached the host. An explicit later `execute` still uses the original UUID and inputs; it does not invent a replacement operation.

The JSON return retains native `job` and `state`, plus `pending`, `submissionAttempted` and `acknowledged`. A lost reply followed by a successful job lookup can therefore retain the actual job without claiming an acknowledgment was received. Exit 0 means a completed operation or successful read/preparation, exit 3 means a pending or unobserved job, and exit 2 means an error or a native terminal status other than `COMPLETE`. The journal retains the latest original observation across CLI exits.

## Complete the maintenance workflow

Use a distinct prepared directory for each deliberate action. Keep each original request directory until the operation and its retained result have been reconciled.

| Action | Required operation inputs | Result to use next |
| --- | --- | --- |
| `pause` | Actor and UUID | Completed pause and original `PAUSED` state |
| `review` | Actor and UUID | Original review ID and complete paged source inventory |
| `backup` | Exact review SHA, `externalWritersStopped:true`, optional label | Selected original backup ID and manifest SHA |
| `verify` | Selected backup ID and exact manifest SHA | Native verification result for that backup |
| `restore` | Same selected backup ID and SHA, `externalWritersStopped:true` | Native restore/recovery state and preserved original paths |
| `resume` | Actor and UUID | Original reopened workspace revision and `RUNNING` state |
| `cancel` | Original cancellable job ID, actor and its own UUID | Retained cancellation request; follow the target job afterward |

After pause completes, prepare and execute the source review:

```sh
starforge merchant-accounting-maintenance prepare \
  --dir "$ACCOUNTING_OPS/review" --url "$MCP_URL" \
  --workspace "$ACCOUNTING_WORKSPACE" --actor "$ACCOUNTING_ACTOR" \
  --action review

starforge merchant-accounting-maintenance execute --dir "$ACCOUNTING_OPS/review"
```

Inspect the returned review and page `status --view sources` when its inventory exceeds the summary. Set `REVIEW_ID` to the exact returned review SHA. Stop original outbox, proof, terms and recovered-source writers outside the MCP service before asserting the external-writer flag. The MCP pause drains its own admitted calls and temporary file readers; that flag records the operator's separate action for external sources.

```sh
starforge merchant-accounting-maintenance prepare \
  --dir "$ACCOUNTING_OPS/backup" --url "$MCP_URL" \
  --workspace "$ACCOUNTING_WORKSPACE" --actor "$ACCOUNTING_ACTOR" \
  --action backup --review-id "$REVIEW_ID" \
  --external-writers-stopped true --label "Operating backup"

starforge merchant-accounting-maintenance execute --dir "$ACCOUNTING_OPS/backup"
```

Take `BACKUP_ID` and `BACKUP_SHA` from the actual returned backup catalog row. The ID is not a pathname. Verify that exact retained backup:

```sh
starforge merchant-accounting-maintenance prepare \
  --dir "$ACCOUNTING_OPS/verify" --url "$MCP_URL" \
  --workspace "$ACCOUNTING_WORKSPACE" --actor "$ACCOUNTING_ACTOR" \
  --action verify --backup-id "$BACKUP_ID" --sha256 "$BACKUP_SHA"

starforge merchant-accounting-maintenance execute --dir "$ACCOUNTING_OPS/verify"
```

A planned recovery can now close the transport and reopen the same host configuration with the same alias and retained paused catalog. Keep the original operating paths, catalog, passphrase and source aliases available. Select the verified backup for the original workspace that needs recovery:

```sh
starforge merchant-accounting-maintenance prepare \
  --dir "$ACCOUNTING_OPS/restore" --url "$MCP_URL" \
  --workspace "$ACCOUNTING_WORKSPACE" --actor "$ACCOUNTING_ACTOR" \
  --action restore --backup-id "$BACKUP_ID" --sha256 "$BACKUP_SHA" \
  --external-writers-stopped true

starforge merchant-accounting-maintenance execute --dir "$ACCOUNTING_OPS/restore"
```

The native controller preserves a partial restore after process loss or insufficient disk space. Reconcile its original job before continuing. An `INTERRUPTED` or `FAILED` job remains that original terminal job. To continue an unfinished restore deliberately, prepare a **new** restore request with the **same** selected backup ID/SHA and unchanged original paths after resolving the actual interruption. Keep the earlier request and native recovery marker. The controller admits only the matching continuation and keeps `resume` unavailable while the restore is unfinished.

When the original recovery state allows reopening:

```sh
starforge merchant-accounting-maintenance prepare \
  --dir "$ACCOUNTING_OPS/resume" --url "$MCP_URL" \
  --workspace "$ACCOUNTING_WORKSPACE" --actor "$ACCOUNTING_ACTOR" \
  --action resume

starforge merchant-accounting-maintenance execute --dir "$ACCOUNTING_OPS/resume"
```

Read the returned original revision and retrieve the same retained response, period close and accountant packet selections. Recovery does not make another purchase or send another payment.

## Use the same connection from an SDK or agent

```js
import { randomUUID } from 'node:crypto';
import { createAccountingMaintenanceClient } from
  '@tokenjunkielabs/starforge-merchant/merchant/accounting-maintenance';

const maintenance = createAccountingMaintenanceClient({
  workspace: 'accounting',
  // Reuse your initialized stdio, in-process or HTTP MCP session.
  // Return structuredContent, and throw the native error on isError.
  call: callExistingMerchantTool,
});

await maintenance.open();
const before = await maintenance.status();
const requestId = randomUUID(); // Retain this ID before the mutating call.
const accepted = await maintenance.command('pause', { actor: 'Operations', requestId });
const completed = await maintenance.wait(accepted.job.id);
if (completed.pending || completed.job.status !== 'COMPLETE') {
  // Keep the original job and reconnect/reconcile it; do not start a replacement.
  console.log({ requestId, ...completed });
}
```

`connectAccountingMaintenanceClient({url,workspace,tokenEnv})` reuses the existing merchant HTTP transport. It never launches another host. The package's `merchant/accounting-maintenance/operations` subpath exports `prepareAccountingMaintenanceOperation`, `runAccountingMaintenanceOperation` and `downloadAccountingMaintenanceFile` for applications that need the same private journal and portable operator workflow. Pass an already initialized `client` to `runAccountingMaintenanceOperation` to preserve a stdio session.

All method results preserve the native job/status fields. `wait` polls only that job and treats `COMPLETE`, `FAILED`, `CANCELLED` and `INTERRUPTED` as terminal. It does not automatically restore, resume, retry a mutation or issue a cancellation.

### Retained customer file readers

Use the original source selection returned by the accounting tools. `fileChunks` preserves every selection field, pins the original SHA on every continuation, verifies the complete byte stream, and releases its temporary reader when an unfinished iteration exits:

```js
for await (const chunk of maintenance.fileChunks(originalSelection, {
  expectedSha256: originalFileSha256,
  chunkBytes: 65536,
})) {
  await consumeOriginalBytes(chunk.bytes);
}
```

If an existing caller already opened a partial `merchant_accounting_file` read on the same connection, register its returned handle with `maintenance.registerFileRead(readId)`. `command('pause', ...)` and `closeWorkspace()` first drain admitted client file calls and release their unfinished snapshots. `drainFileReads()` and `releaseFile(readId)` are explicit alternatives. The host also drains its original admitted operations and process-owned snapshots through the same controller.

A released or expired `readId` is not a durable file identity. After resume, use the same original source IDs and expected SHA to open a new read. An interrupted generator reports that its reader was drained instead of silently selecting a different file.

For a complete disk download, save the original selector object in a private JSON file and use:

```sh
starforge merchant-accounting-maintenance download \
  --url "$MCP_URL" --workspace "$ACCOUNTING_WORKSPACE" \
  --selection "$ACCOUNTING_OPS/original-selection.json" \
  --sha256 "$ORIGINAL_FILE_SHA" --out "$ACCOUNTING_OPS/recovered-original.bin"
```

The output parent must be private. Download writes an owned temporary file, checks the complete original digest, then publishes the new output without replacing an existing file. The JSON result reports its actual original name, bytes, SHA and source selection.
