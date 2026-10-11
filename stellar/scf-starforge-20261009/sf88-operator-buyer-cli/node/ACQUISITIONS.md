# Complete buyer acquisitions in Node

`AcquisitionWorkspace` gives a customer application the original buyer-runbook
workflow: receive a merchant request, review the selected offer and local budget,
prepare its original receiver operator, assemble an immutable acquisition, run
the original approval and buyer, inspect accounting, consume saved resources,
and recover the complete set of original operators.

Import it from `@stellar-forge/native-buyer`, or from the complete installed
distribution's existing `./buyer/node` export. The standalone package needs its
matching original runtime directory. The complete distribution already includes
the buyer-runbook bridge. No additional dependency or payment implementation is
introduced.

## Select the customer's workspace

```js
import {AcquisitionWorkspace, AcquisitionError} from '@stellar-forge/native-buyer';

const acquisitions = new AcquisitionWorkspace({
  runtimeDirectory: '/opt/stellar-forge/stellar/scf-starforge-20261009/sf88-operator-buyer-cli',
  directory: '/srv/customer/state/acquisitions',
  configsDirectory: '/srv/customer/state/configs',
  operatorSettings: '/srv/customer/state/operator-settings.json',
});
```

Use absolute canonical paths and private directories. The configurations
directory is fixed when the original workspace is created. An existing workspace
can be reopened with `directory` alone. The receiver's preset uses the original
[`stellar-forge.buyer-runbook-operator.v1` format](../../buyer-runbook/WORKSPACE.md);
it selects the actual payer, actor, service, Python interpreter, signer reference,
and maximum local budget. A merchant packet does not choose those values.

Construction does not open a workspace, create a ledger, or create a restore
target. Each method runs one original command and waits for its owned native
process to finish. An existing `Buyer` can supply its runtime through
`buyer.acquisitions({directory, configsDirectory, operatorSettings})`; this does
not import that Buyer's separate operation store into the acquisition.

## Receive, review and prepare each exact request

```js
const received = (await acquisitions.receiveRequest(
  '/srv/customer/incoming/order.handoff.json'
)).native;

const reviewed = (await acquisitions.reviewRequest(received.id, {
  acceptIndex: 0,
  totalAtomic: '30000',
  dailyAtomic: '20000',
})).native;

// Show reviewed.review: the actual offer, request, payer and budget.
// Continue only with the exact review the customer selected.
const ready = (await acquisitions.prepareRequest(received.id, {
  reviewSha256: reviewed.review.reviewSha256,
})).native;
```

Select an actual advertised accept index and budgets appropriate to that
request; the amounts above are examples. The original importer retains the
packet's exact body, ordinary headers, discovery and operation ticket. Bodies
remain opaque bytes, including the native multipart and absent-body forms.
Preparing a reviewed request initializes its original receiver-owned workspace
and exposes the ordinary SF88 configuration in the selected local directory.

A prepared request is idempotent for its exact review. A changed preset, offer,
body, ticket or review is rejected by the original intake engine. Preparation
does not approve or pay for the request.

## Save and initialize an acquisition

Prepare all desired requests, then reference their returned `configName`
values in the original manifest. The original 1–64 operation limit, canonical
configuration selection and immutable revisions remain in force.

```js
const draft = (await acquisitions.save({
  manifest: {
    schema: 'stellar-forge.buyer-runbook.v1',
    id: 'monthly-orders',
    title: 'Monthly order acquisition',
    operations: [
      {id: 'order', label: 'Merchant order', config: ready.configName,
       saveAs: 'order.json'},
      // Add other prepared requests here, each with its own id and intent.
    ],
  },
})).native;

// Present draft.plan before accepting this exact immutable revision.
const initialized = (await acquisitions.initialize(draft.id, {
  expectedRevision: draft.revision,
  reviewSha256: draft.reviewSha256,
})).native;
const acquisitionId = initialized.id;
```

Update an existing draft by passing its `id` and exact `expectedRevision` to
`save`. Read a retained revision with `draft(id, {revision})`. Attach an existing
original run with `attachRun('/absolute/original/run')`; its plan, intent IDs and
journal bindings are retained at their existing paths.

## Execute, account and consume the original result

```js
const inspected = (await acquisitions.inspect(acquisitionId)).native;
const completed = await acquisitions.execute(acquisitionId, {
  expectedPlanSha256: inspected.planSha256,
  // only: 'order', // Optional explicit selection.
});
const accounting = await acquisitions.finalize(acquisitionId);
```

Execution requires the exact inspected plan digest and the original controlling
terminal approval. The SDK does not answer that approval. Headless applications
can receive, prepare, review, inspect, account and recover; an operator uses the
original terminal for an explicit purchase. Each native attempt keeps its
existing identity. A changed plan is rejected before launch.

`finalize` observes existing original reservations through the maintained SF88
and SF36 engines. It may query the original provider; it does not sign or submit
another purchase. Inspect each operation's accounting outcome and retained
original receipt. A completed command alone does not establish settlement.
Existing successful finality remains available when a later observation fails.
For an imported run, `bindAccounting(id, {only, workspace})` explicitly selects
its matching original operator workspace.

```js
const preview = (await acquisitions.preview(acquisitionId, 'order')).native;
const download = (await acquisitions.download(
  acquisitionId, 'order', '/srv/customer/exports/order.json'
)).native;
await acquisitions.export(acquisitionId, {
  format: 'csv', destination: '/srv/customer/exports/accounting.csv',
});
```

The original model requires a saved runbook resource, validates its complete
bytes and recorded SHA-256, and provides the original bounded text preview.
`download` copies the complete verified file. Downloads and JSON, HTML or CSV
reports publish a new mode-0600 file inside an existing private parent; an
existing destination is never replaced. File publication and later directory or
cleanup diagnostics are reported separately. `exportRequest(id, {kind: 'body'
| 'handoff', destination})` exports the exact retained request input; an absent
body remains absent.

## Cancellation and original recovery

Pass `{signal}` to a method to cancel its owned command. Native cleanup runs
before the call returns. The result keeps both caller cancellation and the
native process outcome, including a completed result written before shutdown.

```js
const cancellation = new AbortController();
try {
  await acquisitions.execute(acquisitionId, {
    expectedPlanSha256: inspected.planSha256, signal: cancellation.signal,
  });
} catch (error) {
  if (!(error instanceof AcquisitionError)) throw error;
  console.error(error.code, error.result.process);
  // error.result.native may contain a completed original result or publication.
}
```

`recover(id)` invokes the original interrupted-run recovery. `unlock(id,
{ownerPid})` requires the exact observed stopped owner and the original native
lease rules. Neither method authorizes another payment. Read `inspect(id)`
after recovery and make an explicit next decision.

Every successful call returns an `AcquisitionResult` with `native`,
`completionReported`, `process` and `ok`. An `AcquisitionError` retains the same
shape in `error.result`. A failed final state refresh preserves the held
execution result and inspected plan digest, with `stateRefreshError` and a null
refreshed state. Do not treat a subprocess error as proof that nothing was
published, and do not automatically repeat the action.

## Back up and restore the complete acquisition

The original [whole-acquisition recovery engine](../../buyer-runbook/RECOVERY.md)
includes every selected run, retained input and operator generation, and every
original authenticated ledger checkpoint. Select a private state root containing
all of those canonical paths. Stop external writers before capture.

```js
const review = (await acquisitions.backupReview({
  stateRoot: '/srv/customer/state',
})).native;

const backup = (await acquisitions.backup({
  stateRoot: '/srv/customer/state',
  output: '/srv/customer/backups/acquisition-2026-10-11',
  reviewSha256: review.profile.reviewSha256,
  quiesced: true,
  passphraseEnv: 'SF88_BACKUP_PASSPHRASE',
})).native;
```

The passphrase is supplied privately in the named environment variable.
Commands and results contain its name, never its value. The archive retains
operator authentication material encrypted; keep it and its passphrase private.
The caller's `quiesced: true` asserts that external writers were stopped. Native
capture also holds the original workspace, run and ledger locks and verifies
every staged journal before encryption.

Verify and restore using a standalone client so no application constructor
creates the absent original root:

```js
const recovery = new AcquisitionWorkspace({runtimeDirectory: acquisitions.runtime.directory});
const options = {
  bundle: backup.bundle,
  expectedRecordSha256: backup.recordSha256,
  passphraseEnv: 'SF88_BACKUP_PASSPHRASE',
};
await recovery.verify(options);  // Works without the live source.
const restored = (await recovery.restore(options)).native;
const reopened = await acquisitions.state();
```

Restore uses the archive's exact original canonical state root and refuses a
populated target. It restores the original plan, keys, journals and execution
identities, then reopens the original workspace. It does not execute, finalize,
unlock an unrelated owner, or relocate the acquisition. If publication succeeds
but a later reopen fails, the result retains that publication and diagnostic.
Recovery history is available in `state().native.recovery.history`.

## Method reference

| Work | Methods |
| --- | --- |
| Open and select | `state`, `attachRun` |
| Original request | `request`, `receiveRequest`, `reviewRequest`, `prepareRequest`, `exportRequest` |
| Immutable acquisition | `draft`, `save`, `initialize`, `inspect` |
| Original execution | `execute`, `recover`, `unlock` |
| Original accounting | `finalize`, `bindAccounting` |
| Saved resources | `preview`, `download`, `export` |
| Complete recovery | `backupReview`, `backup`, `verify`, `restore` |

[The executable example](examples/acquisitions.mjs) accepts a private SDK settings
JSON file and one explicit command JSON file. Its command names match the table
in that file. It performs only the selected command and prints the complete
native result with process diagnostics. The existing single-operator
`WorkspaceRecovery` API remains available and unchanged.
