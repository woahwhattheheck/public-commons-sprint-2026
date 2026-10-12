# Recover the original native MCP spending owner

The native MCP buyer now supports encrypted capture, verification, restoration,
and attachment to a current spending owner. Use this when carrying a governed
Cheesecake application or a direct native MCP operator between hosts.

The archive contains the complete original SF36 SQLite ledger and audit journal,
the original policy and host configuration, every retained MCP request binding
and finality record, and the original three SF36 control keys. SF101 encrypts and
authenticates this private component using its existing scrypt, AES-GCM, and
manifest authentication format. The application portability workflow carries
this encrypted component unchanged.

## Capture a consistent original owner

Drain the application's active calls before capture. The capture takes the
original native `state.lock` first, then the original SF88 ledger relay's SQLite
writer lock. The relay runs the original SF36 audit and online SQLite backup;
it holds the writer lock until the native files have been copied and verified.
This retains WAL-backed history as one consistent database. Other operators
sharing that ledger can continue after capture releases the lock.

Use the original host configuration, an existing private output parent, the
three original SF36 key environment values, and a separate backup passphrase of
at least sixteen UTF-8 bytes:

```sh
node stellar-forge/mcp-paid-agent/native-spend-recovery.mjs snapshot \
  --config /private/operator/native-host.json \
  --output /private/backups/native-spending-20261012 \
  --operation native-spending-20261012 \
  --pass-env MCP_BACKUP_PASSPHRASE --quiesced
```

The result returns `manifestSha256`, `recordSha256`, the full original
`checkpoint`, `ledgerIdentity`, the original canonical `owner` paths, and native
request/finality counts. Its \`boundRequestReferences\` contain each original
request UUID/digest, actor, service, and reservation state for the private
application export's exact operation join. Save these values with the original application export
receipt. A completed capture also preserves reserved requests that have not yet
received finality.

The owner state directory is the original native helper's private record
directory. It may contain original binding and finality JSON, the original
configuration and ledger initialization markers, its lock, and the original
helper's interrupted private temporary files. Filesystem links and unrelated
state cause capture to refuse the ambiguous closure.

## Verify an encrypted component

```sh
node stellar-forge/mcp-paid-agent/native-spend-recovery.mjs verify \
  --bundle /private/backups/native-spending-20261012 \
  --expected MANIFEST_SHA256_FROM_CAPTURE \
  --expected-record RECORD_SHA256_FROM_CAPTURE \
  --pass-env MCP_BACKUP_PASSPHRASE
```

Verification authenticates and decrypts the full SF101 component into a private
temporary directory. It compares every captured file, validates the original
host and native binding records, and invokes the original ledger audit. It
returns the original checkpoint and owner identity. Use `--temporary-directory`
to select existing local capacity; for example, the same private operation
directory used by the application importer.

## Restore at the original financial paths

The selected original owner paths remain part of the financial identity.
Create their private parent directories on the receiving host, then restore:

```sh
node stellar-forge/mcp-paid-agent/native-spend-recovery.mjs restore \
  --bundle /private/backups/native-spending-20261012 \
  --expected MANIFEST_SHA256_FROM_CAPTURE \
  --pass-env MCP_BACKUP_PASSPHRASE
```

Restoration publishes each missing file atomically and create-only. Exact
existing bytes act as resumable publication receipts. If the original ledger
already exists, the original relay audits and snapshots that current database
under its writer lock; restoration requires the exact captured checkpoint.
This allows an SF88 HTTP workspace to restore a shared ledger first, followed by
reattachment of the native MCP owner to that same ledger.

An interrupted restore retains the files already published and returns their
paths in `error.recovery.created`. Repeating the same selected operation can
complete the remaining files. A conflicting existing file or advanced history
is preserved and reported as a conflict.

The original three control keys remain in the encrypted component. The restored
native owner continues using its original environment-based key interface.

## Attach to an owner with later legitimate history

A receiving application can attach to the original owner after that owner has
continued working:

```sh
node stellar-forge/mcp-paid-agent/native-spend-recovery.mjs verify-current \
  --bundle /private/backups/native-spending-20261012 \
  --expected MANIFEST_SHA256_FROM_CAPTURE \
  --pass-env MCP_BACKUP_PASSPHRASE
```

This operation checks the exact canonical host/policy configuration and original
control keys, then audits the entire current journal. The captured sequence and
journal MAC must exist as a prefix of that current chain. Every captured native
binding and finality record must retain its exact bytes; later native records
and finality remain in place. The result includes both the archived checkpoint
and `currentCheckpoint`, the current ledger identity, and current native counts.
The original owner files are read under their existing locks.

Use the application layer's existing selection and original request checks
before reopening its current host. The component's prefix verification
establishes financial continuity; the application's original selection
establishes which project and operation should be opened.

## Embedding in an application

The module exports:

| Export | Main input | Result |
| --- | --- | --- |
| `inspectNativeMcpSpendingRecovery` | `configFile` | Original owner paths and current file/ledger identity |
| `snapshotNativeMcpSpendingRecovery` | `configFile, output, operationId, quiesced: true` | Encrypted artifact and original checkpoint |
| `verifyNativeMcpSpendingRecovery` | `bundle, expectedManifestSha256` | Authenticated archived owner |
| `restoreNativeMcpSpendingRecovery` | `bundle, expectedManifestSha256` | Restored owner or exact shared-ledger reattachment |
| `verifyCurrentNativeMcpSpendingOwner` | `bundle, expectedManifestSha256` | Archived prefix in the audited current owner |
| `withNativeMcpSpendingRecoveryEnvironment` | Selected bundle and asynchronous callback | Callback result with scoped original control keys |

All operations accept `passphraseEnv` (default `MCP_BACKUP_PASSPHRASE`),
`environment`, `signal`, and `onProgress` in their options or a second context
argument. Verify/restore/current verification also accept
`expectedRecordSha256`, `python`, and `temporaryDirectory`. The restore
`configFile` and `destination` options, when supplied, must equal the captured
configuration path and native state directory respectively.

For a recovered native host, keep the application's full lifespan inside the
scoped environment callback:

```js
await withNativeMcpSpendingRecoveryEnvironment(selectedBundle, async ({environment}) => {
  const host = await import(originalOperatorModule);
  const operator = await host.openOperator({environment});
  try {
    await serveOriginalApplicationUntilClosed({operator, environment});
  } finally {
    await operator.close();
  }
}, {environment: trustedHostEnvironment});
```

The callback receives a new environment containing only the three recovered
SF36 additions. The wallet and provider environment still comes from the
trusted receiving host. An existing supplied SF36 value must match the encrypted
original. The generated module also exports \`spendingConfigurationFile\` so the
private application exporter can compare the selected module's actual owner to
its requested native host configuration. The native host factory accepts this explicit environment,
while its existing zero-argument and lazy module interfaces continue to work.
