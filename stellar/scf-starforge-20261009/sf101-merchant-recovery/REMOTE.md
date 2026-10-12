# SF101 off-host encrypted recovery

This operator interface stores and retrieves the **original SF101 encrypted
snapshot** in an existing private S3 bucket or a configured compatible object
store. The transferred bundle remains `manifest.json` plus the original
`objects/*.gcm` files. The original `recover.mjs` authenticates the snapshot
before publication and after retrieval, and performs the final restore.

A completed remote snapshot gives a merchant operator a recovery copy on a
separate storage service. The service writes immutable encrypted objects and
the manifest first, then its completion descriptor. Inventory selects completed
snapshots by the exact `snapshotId`; interrupted uploads remain resumable through
their original local operation.

## Operator setup

Use Node 22 or later and the release's existing `@aws-sdk/client-s3` dependency.
Keep the transfer configuration, operation journals, downloaded bundles, and
restored state in private directories outside the public source checkout.

Choose absolute paths on storage owned by the receiving operator. The examples
below use `/private`; prepare their parent directories with private modes:

```sh
install -d -m 700 /private/merchant-recovery/operations /private/backups /private/downloads /private/restored
```

Create a private configuration for an **existing** bucket:

```json
{
  "schema": "stellar-forge.merchant-recovery-s3.v1",
  "region": "us-east-1",
  "bucket": "YOUR_EXISTING_PRIVATE_BUCKET",
  "prefix": "merchant-recovery/merchant-a/",
  "credentialProvider": "environment",
  "expectedBucketOwner": "YOUR_12_DIGIT_ACCOUNT_ID"
}
```

Replace the region, bucket, prefix, and account ID with the actual existing
destination. `expectedBucketOwner` is optional; when supplied, it is the bucket
owner's 12-digit AWS account ID. Store the file with private permissions.

```sh
chmod 600 /private/merchant-recovery/remote.json
```

The `environment` credential provider uses the existing
`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and optional `AWS_SESSION_TOKEN`
environment values. Select `"credentialProvider": "default"` to use the AWS
SDK's existing default credential chain, including the configured profile or
host role. Credentials are supplied through those existing facilities.

Optional configuration fields are:

| Field | Meaning |
| --- | --- |
| `endpoint` | The HTTPS endpoint of the selected S3-compatible service. |
| `forcePathStyle` | Use the endpoint's path-style bucket addressing when required. |
| `proxyEnvironment` | Use the deployment's existing HTTP(S) proxy environment with the SDK transport. Default is false; see supported Node versions below. |
| `timeoutMs` | Request/body deadline, from 100 to 3,600,000 milliseconds; default 60,000. |
| `allowLocalEndpoint` | Allow an explicitly configured `http://127.0.0.1` endpoint for a local native integration. Default is false. |

The adapter uses conditional create requests and verifies the actual content
when an immutable key already exists. An endpoint must support that behavior;
a conflicting existing object is an operation error. The response's opaque ETag
is distinct from the snapshot and encrypted-content SHA-256 values.

Each transfer uses the configured account's existing object-storage request and
retention charges. Bucket setup, retention policy, and storage billing stay with
that account's operator.

Set the following shell variable to this release's CLI location:

```sh
SF101_REMOTE=/path/to/release/stellar/scf-starforge-20261009/sf101-merchant-recovery/remote-cli.mjs
```

The private passphrase is already available through
`SF101_RECOVERY_PASSPHRASE` or another existing uppercase environment variable.
`--pass-env` passes its **name** to the original engine. The passphrase value is
kept out of commands, bucket configuration, transfer metadata, and source.

### Deployments that use an outbound proxy

Set `proxyEnvironment` to `true` when S3 traffic must use the deployment's existing proxy configuration. The CLI reads `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` from its environment; lowercase forms take precedence when both forms are present. Programmatic callers can supply the same settings through `openS3Store`'s `env` option. This mode uses the SDK's Node HTTP handler with dedicated proxy-aware agents. Use Node 22.21.0 or later within 22.x, Node 24.5.0 or later within 24.x, or a later major release. Omitted or `false` keeps the direct transport. The bucket, prefix, credentials, and retained snapshot identity use the same configuration as before. When supplying an existing client, configure that client's transport before passing it to `openS3Store`.

For example, add the option to the existing private-bucket configuration:

```json
{
  "schema": "stellar-forge.merchant-recovery-s3.v1",
  "region": "us-east-1",
  "bucket": "existing-private-bucket",
  "prefix": "merchant-recovery/",
  "credentialProvider": "environment",
  "proxyEnvironment": true
}
```

Configure the existing proxy URL and bypass hosts in the deployment environment, alongside its existing AWS credential variables. Then run the same `push`, `list`, `pull`, and `restore` commands.

See [Node's built-in proxy support](https://nodejs.org/api/http.html#built-in-proxy-support) for supported environment variables and bypass patterns.

## Operate through the private recovery workspace

The recovery workspace provides a browser for the same original encrypted
bundles, remote snapshots, transfer journals, and cold restores described in
this guide. Its host configuration selects the permitted stores and local
directories. An operator chooses a configured profile, reviews the exact
snapshot and destination, and starts the original transfer from that review.

Start the maintained workspace on the recovery host:

```sh
starforge merchant-recovery-remote workspace serve \
  --config /private/merchant-recovery/workspace.json \
  --directory /private/merchant-recovery/operator \
  --port 8481
```

The server binds to `127.0.0.1` and prints a capability URL containing a random
token in its fragment. Open that full URL through the host's existing browser
access. The browser sends the token in `X-Recovery-Token`; it stays out of the
request path and query string. The page retains the token in session storage
for reload and clears the fragment from the displayed address. Reopening the
server produces its current access URL.

The same entry is available from the source CLI as
`node "$SF101_REMOTE" workspace serve` with those arguments.
For an installed customer runtime, use its original launcher:

```sh
starforge runtime-install run --dir /private/starforge-runtime -- \
  merchant-recovery-remote workspace serve \
  --config /private/merchant-recovery/workspace.json \
  --directory /private/merchant-recovery/operator \
  --port 8481
```

The installed runtime needs the original `s3` feature. Its selected AWS SDK is
resolved from that runtime's own dependency directory. Invoke the launcher with
the supported Node version for the configured transport, including the proxy
requirements above.

A private workspace host configuration has this shape:

```json
{
  "schema": "stellar-forge.recovery-workspace.v1",
  "title": "Merchant recovery",
  "profiles": [
    {
      "id": "merchant-a",
      "label": "Merchant A",
      "storeConfig": "/private/merchant-recovery/remote.json",
      "operations": "/private/merchant-recovery/operations",
      "passEnv": "SF101_RECOVERY_PASSPHRASE",
      "bundleRoots": [
        {
          "id": "accepted-backups",
          "label": "Accepted merchant backups",
          "directory": "/private/backups"
        }
      ],
      "downloadRoot": "/private/downloads",
      "restoreRoot": "/private/restored"
    }
  ]
}
```

Use the actual existing store configuration and private parent directories.
`passEnv` is the name of the already provisioned environment variable. Each
profile binds its own original transfer directory and allowed backup, download,
and restore locations. The browser selects within that host configuration.

The operating sequence is:

1. Choose the intended merchant profile and inspect an existing original
   snapshot under its configured backup collection.
2. Review the snapshot identity and configured remote destination before
   starting an upload. The original engine authenticates the bundle and the
   transfer publishes its completion descriptor last.
3. Fetch the real remote inventory and follow its page cursor until the desired
   recovery point is visible. Select its exact snapshot ID.
4. Review an encrypted download, or a cold restore with both its encrypted
   download and separate new plaintext destination. Start the reviewed
   operation and follow the original saved phase and progress.
5. Use **Continue operation** to resume its same original ID and binding after
   an interruption. **Stop transfer** closes the workspace's owned S3 client
   and retains the journal. A local verification or restore already in progress
   may finish; read **Refresh progress** for its resulting saved phase.
6. Use the retained completed restore result with the original merchant's
   restored-host and startup procedure.

Read the saved workspace alongside a running server with:

```sh
starforge merchant-recovery-remote workspace show \
  --config /private/merchant-recovery/workspace.json \
  --directory /private/merchant-recovery/operator
```

The workspace and headless CLI share the transfer journal at
`OPERATIONS/ID/operation.json`. The headless `status` command remains available
for that same operation. See the [complete workspace operating
guide](workspace/GUIDE.md) for host preparation, review and resume behavior,
and the receiving-host handoff.


## 1. Obtain the original consistent snapshot

For a running SF99 merchant, use the original maintenance command so the
original service group and delivery outbox are quiesced together:

```sh
node /path/to/release/stellar/scf-starforge-20261009/sf99-merchant-deploy/cli.mjs \
  maintenance backup \
  --plan /private/merchant/maintenance.json \
  --id merchant-a-backup-20261011-01
```

Use the `snapshot.bundle` path in the completed maintenance result. An existing
accepted snapshot can be used directly. Preserve that same snapshot when an
upload is interrupted; its identity and original encrypted bytes remain stable.

The standalone native command is also available for an operator who has already
stopped the original writers according to the [SF101 production
runbook](README.md#production-runbook):

```sh
node /path/to/release/stellar/scf-starforge-20261009/sf101-merchant-recovery/recover.mjs \
  snapshot \
  --plan /private/merchant/recovery-plan.json \
  --out /private/backups/merchant-a-20261011-01 \
  --pass-env SF101_RECOVERY_PASSPHRASE \
  --quiesced
```

`--quiesced` describes the operator's actual completed shutdown. The original
snapshot engine reads the selected files and preserves their named logical
roots. The remote interface starts from that existing encrypted bundle.

## 2. Publish the selected snapshot

```sh
node "$SF101_REMOTE" push \
  --config /private/merchant-recovery/remote.json \
  --bundle /private/backups/merchant-a-20261011-01 \
  --operations /private/merchant-recovery/operations \
  --id merchant-a-upload-20261011-01 \
  --pass-env SF101_RECOVERY_PASSPHRASE \
  > /private/merchant-recovery/push-result.json
```

The command authenticates the complete original bundle before making it a
completed remote recovery point. It transfers the original encrypted objects
under keys derived from the snapshot identity, retains provider
acknowledgements, and publishes the completion descriptor last.

Retain the returned `snapshotId`, `completionKey`, original file/byte counts,
`store`, `progress`, and `verified` result together with the existing operation
journal. `status: "COMPLETE"` records the completed upload and provider
readback. A repeat of that completed operation returns its retained result with
`alreadyComplete: true`.

To reuse the exact returned ID in subsequent commands, read that JSON result:

```sh
SF101_SNAPSHOT="$(node -e 'process.stdout.write(JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8")).snapshotId)' /private/merchant-recovery/push-result.json)"
```

## 3. Browse completed recovery points

```sh
node "$SF101_REMOTE" list \
  --config /private/merchant-recovery/remote.json \
  --limit 20
```

Each page returns `status: "REMOTE_SNAPSHOTS"`, the configured `store`, a
`snapshots` array, `nextCursor`, and `ignoredObjects`. Each snapshot record
contains its exact ID, creation time, original file/byte/root counts, completion
key, and provider version ID when returned.
Select a specific returned `snapshotId`. Keep the returned `nextCursor`
unchanged when requesting another page:

```sh
node "$SF101_REMOTE" list \
  --config /private/merchant-recovery/remote.json \
  --cursor "$SF101_NEXT_CURSOR" \
  --limit 20
```

The default page size is 20 and the maximum is 100. A page's continuation token
determines whether more records remain; the first page is a partial inventory
when a cursor is present. Unrelated keys under the completion prefix contribute
to `ignoredObjects`. Inventory follows the configured bucket and prefix. Its
records identify recovery points; the original engine authenticates the full
selected snapshot during `pull` or `restore`.

## 4. Retrieve and authenticate on the receiving host

Provision the same existing storage access and the original recovery passphrase
on the receiving host. It may use its own private operations directory and a
new operation ID.

```sh
node "$SF101_REMOTE" pull \
  --config /private/merchant-recovery/remote.json \
  --snapshot "$SF101_SNAPSHOT" \
  --out /private/downloads/merchant-a-20261011-01 \
  --operations /private/merchant-recovery/operations \
  --id merchant-a-download-20261011-01 \
  --pass-env SF101_RECOVERY_PASSPHRASE
```

On the first invocation, select a new encrypted-bundle destination. The download
retains the selected completion identity, original manifest object metadata,
and the completion descriptor's provider version ID when returned. It rebuilds
the same `manifest.json`/`objects/*.gcm` layout, then calls the original full
authentication and verification.

After an interruption, repeat the **same** command with the same operation ID,
snapshot, configuration, and output path. The journal associates retained files
with that operation, allowing it to resume the same transfer. Files already
verified by the operation remain reusable.

The native verification remains independently available:

```sh
node /path/to/release/stellar/scf-starforge-20261009/sf101-merchant-recovery/recover.mjs \
  verify \
  --bundle /private/downloads/merchant-a-20261011-01 \
  --pass-env SF101_RECOVERY_PASSPHRASE
```

The native result is `SNAPSHOT_VERIFIED` with the original file count, plaintext
byte count, and root names.

## 5. Restore the original merchant state

For retrieval and a cold restore in one retained operation:

```sh
node "$SF101_REMOTE" restore \
  --config /private/merchant-recovery/remote.json \
  --snapshot "$SF101_SNAPSHOT" \
  --bundle-out /private/downloads/merchant-a-cold-20261011-01 \
  --out /private/restored/merchant-a-20261011-01 \
  --operations /private/merchant-recovery/operations \
  --id merchant-a-cold-restore-20261011-01 \
  --pass-env SF101_RECOVERY_PASSPHRASE
```

`--bundle-out` names the encrypted download and `--out` names the separate new
plaintext destination. The original restore verifies every object before
creating the restore directory. Files and directories retain the original
SF101 private modes, and named roots retain their original layout.

To use a bundle already retrieved by `pull` within this retained workflow, set
`--bundle-out` to that existing bundle. The facade authenticates it with the
original engine and requires its manifest to match the selected snapshot before
reusing it. The plaintext `--out` remains a new directory.

The original native restore also accepts a completed downloaded bundle:

```sh
node /path/to/release/stellar/scf-starforge-20261009/sf101-merchant-recovery/recover.mjs \
  restore \
  --bundle /private/downloads/merchant-a-20261011-01 \
  --out /private/restored/merchant-a-20261011-01 \
  --pass-env SF101_RECOVERY_PASSPHRASE
```

A completed native result has status `RESTORED_TO_NEW_DIR` and identifies the
new destination and original file/byte totals. Restore roots are named by the
snapshot plan; a standalone file root is restored under that logical name.
The original SF99 restored-host preparation preserves the configuration
filenames and maps original paths when composing a host migration.

Bring the original merchant components up against the isolated restored state.
Use their existing ownership and startup commands, confirm original SF60
catalog heads, and reconcile SF98 event IDs against the existing merchant and
facilitator records before exposing the restored merchant through the original
deployment process. Retain the previous active state and its source release
through that transition.

## Resume and inspect the same operation

```sh
node "$SF101_REMOTE" status \
  --operations /private/merchant-recovery/operations \
  --id merchant-a-upload-20261011-01
```

`status` reads the original local record without a bucket configuration or a
recovery passphrase. It is useful when network access or credentials are being
restored.

| Interrupted operation | Operator continuation |
| --- | --- |
| Upload before completion | Rerun the original `push` with the same ID and inputs. Already matching immutable objects can be reused. |
| Upload response uncertainty | Reopen the same operation. Its content-derived keys and exact readback resolve the original effect. |
| Partial download | Rerun the original `pull` or `restore` with its original download path and ID. |
| Completed restore invoked again | The operation returns its retained completion. |
| Original restore finished before its final journal write | Rerun the same operation. After authenticating the encrypted bundle, the facade checks the expected original directories and plaintext hashes and records the matching outcome as `originalRestore.reconciled: true`. |
| Existing restore destination is incomplete, changed, or belongs to another operation | Read the retained status and inspect that destination. Preserve it; select a new destination and operation if a fresh cold restore is required. |
| Wrong passphrase or changed original bundle | Correct the original input/secret through its existing owner, then resume the retained operation. |
| Provider denial, quota, or timeout | Retain the actual error and provider identifiers. Continue from the same operation after its underlying cause or provider cooldown is resolved. |

Use one active transfer process per **operations directory**. The transfer
facade holds the original local delivery lease across that directory; different
operation IDs within it share the lease. Separate merchant operations directories
can support independent transfers. Changing a snapshot, destination, or storage
account is a new operation with its own identity.

The operation's `status` records its last saved phase. An error adds `lastError`
while retaining that phase and the same operation binding:

| Phase | Meaning |
| --- | --- |
| `PREPARED` | The command, store identity, snapshot selection, and local paths are bound to the operation. |
| `VERIFIED` | The original engine authenticated the selected local snapshot for upload. |
| `UPLOADING` | Encrypted file objects are being published and acknowledged. |
| `COMPLETING` | The manifest is available and the completion descriptor is being published. |
| `DOWNLOADING` | The original encrypted bundle is being retrieved into its retained destination. |
| `DOWNLOADED` | The encrypted bundle is present and ready for final original verification or restore. |
| `RESTORING` | The operation has started the original restore into its selected new plaintext destination. |
| `COMPLETE` | The command finished and its original verification or restore result is retained. |

Use the phase together with `lastError` and `progress` to continue the original
command. Provider errors preserve their code, HTTP `status`, request IDs,
`retryAfter`, and any `mayHaveCommitted` or reconciliation details supplied by
the adapter. The CLI returns these fields with the same retained `operation`
summary. A successful continuation clears `lastError`.

## Command and result contract

The CLI parses the full command before loading the provider. Successful
commands print one JSON result; failures write an error to standard error and
return a nonzero exit status. `COMMAND --help` prints that command's accepted
arguments. Unknown, repeated, missing, and command-inappropriate arguments
fail before operation dispatch.

`push`, `pull`, and `restore` require a stable 1–80 character operation ID.
Use letters, digits, dots, underscores, and hyphens, beginning with a letter or
digit. Snapshot selections are the exact 64-character SHA-256 IDs returned by
this release. All file/directory arguments are normalized absolute paths.

The original SF101 manifest authenticates the selected bundle's metadata and
content. It includes logical root names and relative file paths; encrypted
objects carry the original file contents. Keep the complete remote snapshot in
the selected private destination and retain the passphrase through the
merchant's existing secret-management procedure.

`push`, `pull`, `restore`, and `status` expose the same operation summary:

| Field | Operator use |
| --- | --- |
| `operationId`, `command`, `status` | Identify the retained command and saved phase. |
| `snapshotId`, `completionKey` | Select the exact original manifest SHA-256 and its completion descriptor under the configured prefix. |
| `store` | Confirm the bucket, region, endpoint, prefix, owner constraint, and stable destination identity. |
| `bundle`, `destination` | Locate the encrypted bundle and, for restore, the separate plaintext destination. |
| `files`, `plainBytes`, `encryptedBytes` | Read the original file count and file-content byte totals. Metadata objects and provider request overhead are separate from these totals. |
| `progress.nextObject` | Count original encrypted file objects processed so far. |
| `progress.written`, `progress.reused`, `progress.bytesWritten` | Distinguish newly transferred file objects and bytes from matching retained objects. Manifest and completion writes are outside these counters. Upload progress accumulates across the operation; resumed downloads recompute their counters while rehashing retained files. |
| `verified`, `verifiedAt` | Identify the retained successful original authentication or restore and its time. Early phases can report `verified: false`. |
| `remoteReceipt` | Retain the completion descriptor's digest and returned version ID. Completed uploads also retain manifest version ID and manifest/completion PUT/readback request IDs. |
| `originalRestore` | Read the original `RESTORED_TO_NEW_DIR` result after a successful cold restore. |
| `createdAt`, `updatedAt`, `lastError` | Inspect operation timing and the most recent unresolved failure. |
| `alreadyComplete` | A repeated completed command returns `true` alongside its retained completion. |

Local records live under `OPERATIONS/ID/operation.json`. Uploads also append
provider object acknowledgements to `OPERATIONS/ID/receipts.ndjson`, keeping
per-object request/version details separate from the compact operation summary.
The remote object layout under the configured prefix is
`bundles/SNAPSHOT_ID/manifest.json`,
`bundles/SNAPSHOT_ID/objects/000001.gcm` (and subsequent original object names),
and the final `snapshots/SNAPSHOT_ID.json` completion descriptor.

Source integration uses `runRemote(options, { store })` from `remote.mjs`.
The same facade performs CLI transfers and native operator integrations, and
the original `recover.mjs` continues to own snapshot authentication and
restore.
