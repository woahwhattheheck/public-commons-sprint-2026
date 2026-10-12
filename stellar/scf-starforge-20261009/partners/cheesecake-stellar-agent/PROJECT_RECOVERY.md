# Encrypted application projects

A project backup carries the complete selected HTTP and remote MCP application:
its original handoff, configuration, saved reviews, operation identities, full
received response files and the original financial recovery owners. The receiver
can inspect and read the captured work immediately, then restore the original
host or attach to its current journal and continue using the same operations.

The application composes the maintained SF88 workspace recovery, native MCP
spending recovery and SF101 authenticated encryption. The original financial
ledger includes all of its buyers and journal history. Shared spending caps,
existing reservations and settlement history retain their original authority.

## Select the installed source and private environment

Use the same complete maintained installation described in
[INSTALLED.md](INSTALLED.md), with Node 24 or newer, Python 3.11 or newer and its
selected native/MCP dependencies.

```sh
starforge stellar-application paths
starforge stellar-application project-help
```

The paths output includes the selected application, SF88 runtime and this guide.
A source checkout exposes the same commands through `node project-cli.mjs`.
A receiving host can select an existing trusted SF88 runtime with
`--runtime /absolute/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli`.
Use canonical real paths throughout.

Set a private passphrase of at least 16 UTF-8 bytes in the receiving process
environment. The examples select its name, `STELLAR_APP_PROJECT_PASSPHRASE`.
The same environment supplies the native operator's original SF36 control keys
when capturing an existing owner. Wallet/provider credentials remain in their
existing host environment.

Each encrypted component retains the original control-key material required to
authenticate its full journal. The complete project encrypts those native
recovery artifacts again together with the application payload. It keeps signer
and authorization modules as exact source references. Passphrase values and
wallet/provider secrets do not enter the application configuration or commands.

## Configure one complete project

The optional application field `projectProfile` selects a private JSON profile:

```json
{
  "schema": "stellar-forge.application-project-profile.v1",
  "exportsDirectory": "/srv/private/stellar-project-backups",
  "passphraseEnv": "STELLAR_APP_PROJECT_PASSPHRASE",
  "httpRecovery": {
    "directory": "/srv/private/original-operator",
    "stateRoot": "/srv/private/original-buyer-state",
    "operators": []
  },
  "nativeMcpHost": "/srv/private/native-mcp/host.json"
}
```

| Field | Selection |
| --- | --- |
| `exportsDirectory` | Private existing directory for complete encrypted project directories and their receipts. Keep it outside the captured application, handoff and SF88 state root. |
| `passphraseEnv` | Name of the protected environment variable used by the original encryption tools. |
| `httpRecovery.directory` | The existing SF88 operator workspace selected by the HTTP buyer profile. |
| `httpRecovery.stateRoot` | Its original canonical recovery root, containing the complete original financial workspace. |
| `httpRecovery.operators` | Additional original SF88 operator directories sharing the selected recovery collection. |
| `nativeMcpHost` | The exact private native spending host JSON used by the application's selected governed operator module. |

Select `httpRecovery` when the application has an `operatorProfile`.
Select `nativeMcpHost` when the application has a remote MCP backend.
An application receiving an HTTP handoff without an execution profile can
capture its handoff, reviews and results without selecting a financial owner.

The current native operator generator exposes its private
`spendingConfigurationFile` identity and an environment-aware
`openOperator` factory. Regenerate an older private module with the maintained
`mcp-spending setup` command before enabling complete native project capture.
Ordinary request approval and signing keep their original callback contracts.

For an existing application, the configure command creates a new configuration
and adjacent profile, preserving the original configuration and application
state:

```sh
starforge stellar-application project-configure \
  --config /srv/private/client/application.json \
  --out /srv/private/client/application-with-project.json \
  --exports /srv/private/stellar-project-backups \
  --pass-env STELLAR_APP_PROJECT_PASSPHRASE \
  --http-workspace /srv/private/original-operator \
  --state-root /srv/private/original-buyer-state \
  --native-host /srv/private/native-mcp/host.json
```

Include only the selected backends' options. Use `--http-operators` with a JSON
array of absolute directories when the original HTTP recovery is a collection.
The new file uses the existing application state, handoff, subject, operator
profile and remote selection.

A new installed application can select its prepared profile at initialization:

```sh
starforge stellar-application init \
  --dir /srv/private/stellar-applications/client-data \
  --id client-stellar-data --subject tenant-01:operator-01 \
  --handoff /srv/private/merchant-handoff \
  --profile /srv/private/original-buyer-profile.json \
  --remote /srv/private/selected-remote-mcp.json \
  --project-profile /srv/private/client-project-profile.json
```

Inspection shows the actual source references and financial owner selections:

```sh
starforge stellar-application project-inspect \
  --config /srv/private/client/application-with-project.json
```

Snapshot compares the selected native host to the operator actually attached to
the application. It joins every captured reservation to the original quote UUID,
request hash, actor and service in the authenticated native recovery component.
When HTTP and MCP share a ledger, their captured journal checkpoints must agree.
A concurrently advanced shared ledger produces a source-change error; the
original ledger stays intact and the operator can capture the current project
again.

An untouched native owner can also take its first backup. If the original
ledger exists, the native component audits and copies its complete shared
history even when this native adapter has no request records yet. If the
configured ledger has never been created, the component records that absence
with `ledgerState: UNINITIALIZED` and a null checkpoint. Capture preserves that
state without creating a financial ledger. Exact restore preserves the absence;
attachment after legitimate original-host initialization verifies the new
current journal explicitly.

## Capture through the running application or CLI

The browser's **Project** section shows the selected backup directory,
passphrase environment name and original financial owners. Choose
**Create encrypted project** to capture that application's current work.
The interface retains its export operation ID for a retry, then displays the
encrypted bundle path, manifest hash, record hash and saved-result byte count.

A capture first drains active application work. Cancellation and status remain
available while a request awaits original terminal approval. Once the drain
finishes, the application captures the original saved reviews and complete
results. It reads existing quote UUIDs directly, including expired reviews, and
uses SQLite's online backup for the original quote database.

The single application owner remains active during capture. Closing during
approval starts the original broker's cancellation before draining requests.
An encryption already capturing private state finishes its cleanup before that
owner releases its keys and file handles.

For a standalone CLI capture, close the process currently owning that
application state, then use the same saved configuration:

```sh
starforge stellar-application project-snapshot \
  --config /srv/private/client/application-with-project.json \
  --operation client-data-20261012

starforge stellar-application project-archives \
  --config /srv/private/client/application-with-project.json
```

A repeated successful `--operation` authenticates and returns the same existing
encrypted project. Choose a new operation ID for a later capture.

The output is one encrypted directory, for example:

```text
/srv/private/stellar-project-backups/client-data-20261012/
```

Transport that complete directory: `manifest.json` and every file under
`objects/`. Keep the returned manifest and record SHA-256 values with the
receiving instructions. The adjacent receipt is a convenient index; the
encrypted manifest and authenticated payload define the captured project.

## Receive and use the complete saved results

On the receiving host, select a trusted installed source and supply the
passphrase in its protected environment. Verify and receive into a new private
directory:

```sh
starforge stellar-application project-verify \
  --bundle /srv/private/incoming/client-data-20261012 \
  --pass-env STELLAR_APP_PROJECT_PASSPHRASE \
  --expected-manifest-sha256 CAPTURED_MANIFEST_SHA256

starforge stellar-application project-receive \
  --bundle /srv/private/incoming/client-data-20261012 \
  --dir /srv/private/received/client-data-20261012 \
  --pass-env STELLAR_APP_PROJECT_PASSPHRASE \
  --expected-manifest-sha256 CAPTURED_MANIFEST_SHA256
```

Receiving authenticates the whole project and each original native financial
artifact, verifies the handoff and remote selection through their original
parsers, and checks every captured response hash. It retains the complete
encrypted original under the receiving directory's `backup/` so a subsequent
restore authenticates that original again.

Saved reviews, operation state and response bytes are immediately available
through the original reader. HTTP responses retain their 1 MiB limit; remote
MCP responses retain their full 2 MiB limit.

```sh
starforge stellar-application project-read \
  --dir /srv/private/received/client-data-20261012 \
  --subject tenant-01:reviewer-01 --intent ORIGINAL_INTENT \
  --format json --limit-bytes 2097152

starforge stellar-application project-export \
  --dir /srv/private/received/client-data-20261012 \
  --subject tenant-01:reviewer-01 --intent ORIGINAL_INTENT \
  --out /srv/private/received/original-response.json
```

Use a limit appropriate to the selected request. JSON, UTF-8 text, base64 and
verified file metadata use the original result reader. Export creates a new
destination exclusively and preserves the complete captured bytes.

For the browser and MCP receiver, set `STELLAR_APP_ACCESS_TOKEN` in the protected
environment and start:

```sh
starforge stellar-application project-serve \
  --dir /srv/private/received/client-data-20261012 \
  --subject tenant-01:operator-01 --port 0
```

Open the printed loopback origin and enter that token in the existing connection
field. The original request list, reviews, operation view, complete HTTP download
and `stellar_request_read` tool now use the received project. Its **Project**
section exposes the original-path review and the available receiving actions.

The receiver uses its host-selected subject and current authorization callback.
A receiving reviewer can read the selected archived work. Opening the original
live host requires the original application's subject and its own current
authorization.

## Choose original restore or current-host attachment

Review the original destinations, trusted source references and financial
owners before opening the live host:

```sh
starforge stellar-application project-review \
  --dir /srv/private/received/client-data-20261012 --mode restore
```

| Mode | Operator workflow |
| --- | --- |
| `restore` | Restore the selected original financial owners and missing application files at their original canonical paths. Existing equal files are reused; a changed destination is reported as a collision. An existing financial history must match the captured original for exact restoration. |
| `reattach` | Verify the already present original host and its full current financial journal. The captured sequence and MAC must remain a valid prefix; later legitimate journal history and application state stay current. Original source selection, immutable native bindings, policy and control-key identity remain bound. |

The application preserves its original intent IDs, quote UUIDs, configuration
and result metadata. Original native request hashes bind the canonical paths,
so live restoration uses those paths. Receiving and reading the encrypted
project can use a new private receiving directory.

For a migrated host, install the same trusted application/runtime and attach
the original signer and authorization modules at the paths shown by the review.
The module hashes must match the original selected references. The native
recovery APIs restore their canonical workspaces with create-only publication;
the application publishes its configuration after the component state and
captured files are ready.

The browser provides **Restore original paths**, **Verify current host** and
**Open live host** using the reviewed record identity. CLI restoration uses the
same original workflow:

```sh
starforge stellar-application project-restore \
  --dir /srv/private/received/client-data-20261012 \
  --mode restore --expected-record-sha256 REVIEWED_RECORD_SHA256
```

For an already operating original host, use `--mode reattach`. The receiving
review identifies missing sources and paths and distinguishes an equal file
from a collision. Resolve the selected original destination explicitly; a
restore preserves existing conflicting files and reports any already created
component state in its recovery result.

An original shared financial ledger remains the same shared ledger. Complete
history and aggregate reservations travel with its original encrypted owner.
The project workflow does not split that history into a new application-only
budget.

## Reopen with original encrypted key custody

The received project can open the restored or verified host directly.
**Open live host** retains the recovered SF36 control keys in a scoped
environment for that original application lifetime. **Close live host** closes
the original broker and returns to the received views.

The host continues to supply wallet/provider environment values and its
original controlling terminal. Native approval, aggregate reservation, signing,
result retention and finality reconciliation run through the same original
implementations.

A command can perform that whole scope for one original operation:

```sh
starforge stellar-application project-command \
  --dir /srv/private/received/client-data-20261012 \
  --mode reattach --expected-record-sha256 REVIEWED_RECORD_SHA256 \
  --action status --intent ORIGINAL_INTENT

starforge stellar-application project-command \
  --dir /srv/private/received/client-data-20261012 \
  --mode reattach --expected-record-sha256 REVIEWED_RECORD_SHA256 \
  --action read --intent ORIGINAL_INTENT --format json --limit-bytes 2097152
```

The command also supports review, execute, recover, export, cancel, spending and
reconcile. A repeated execute uses the saved original native intent and quote.
The original ledger prevents a new reservation/signing authorization for an
existing quote UUID. A settled or retained reservation stays attached to its
original operation.

Before exposing the live application, the receiver compares the configuration
actually parsed by the original loader with the authenticated project, including
its exact raw-byte hash, canonical config path, subject, handoff, remote selection
and retained request bindings. The recovered key scope closes with the
application; it does not replace the process-wide environment.

## Embed in an existing product

The installed project and receiver modules expose the same application APIs.
A trusted backend can inspect/capture its configured live application through
`loadApplication`, then use the receiver with its actual authenticated subject
and current grant lookup:

```js
import {
  openReceivedApplicationProject,
  withRestoredApplicationProject,
} from './project-receive.mjs';

const receiver = await openReceivedApplicationProject({
  directory: settings.receivedDirectory,
  sourceRoot: settings.trustedInstalledSource,
  subject: settings.receivingSubject,
  environment: privateEnvironment,
  authorize: async ({ context, action, applicationId, request }) =>
    grants.authorize({
      subject: context.subject,
      action,
      applicationId,
      intentId: request?.intentId,
    }),
});

const result = await receiver.call(
  { subject: authenticatedSubject },
  'read',
  selectedIntentId,
  { format: 'json', limitBytes: 2097152 },
);
await receiver.close();

await withRestoredApplicationProject({
  directory: settings.receivedDirectory,
  sourceRoot: settings.trustedInstalledSource,
  expectedRecordSha256: reviewedRecordSha256,
  mode: 'reattach',
  environment: privateEnvironment,
}, async loaded => {
  return loaded.application.call(
    loaded.context, 'status', selectedIntentId,
  );
});
```

Keep the complete live application lifetime inside the callback when using
`withRestoredApplicationProject`. It owns the recovered-key scope and closes
the original application after the callback settles.

| API | Purpose |
| --- | --- |
| `inspectApplicationProject` | Inspect one configured live project's original sources and financial selections. |
| `application.project(context, 'snapshot', {operationId})` | Drain and capture that application's complete encrypted project. |
| `verifyApplicationProject` | Authenticate an encrypted project and every native recovery component. |
| `receiveApplicationProject` | Create a private receiving directory with full saved work and the retained encrypted original. |
| `inspectReceivedApplicationProject` | Review original path state, source references and native owner selections. |
| `restoreApplicationProject` | Restore canonical original state or verify attachment to its current history. |
| `openReceivedApplicationProject` | Open the original-shaped, authorized received application and its live-host controls. |
| `withRestoredApplicationProject` | Verify/restore and open the original application inside its recovered-key scope. |

The browser and authenticated MCP host expose project inspection, capture,
archive listing, restore, attachment and open/close controls according to the
loaded mode. Tool arguments select an operation ID, reviewed record hash or
receiving mode. Trusted host configuration selects filesystem paths, financial
owners and environment names.

Managed Applications launch includes all thirteen executed application modules
and browser assets in the original selected source map. The existing managed
worker compares the copied release against that same map before publishing its
bound startup. The installed command and direct source CLI use this same
implementation.

## Original receiving operation

The complete receiving journey lives beside the original application:

```sh
node operations/governed_receiving.mjs \
  --handoff /absolute/original/buyer-handoff \
  --work /absolute/new-private-operation-directory \
  --python /absolute/python3
```

It uses the original handoff, original SDK/broker/governor and retained result
interfaces. Its explicit provider/payment fixtures exercise original application
integration, complete UTF-8 result delivery, cancellation, permission revocation,
encrypted receiving, restored key scope and same-UUID reuse. The complementary
native recovery operation covers original reservations, settlement, canonical
restoration and attachment to a later journal prefix.

Production payment reconciliation continues to use the selected original
SF86 network and transfer verification through the native operator.
