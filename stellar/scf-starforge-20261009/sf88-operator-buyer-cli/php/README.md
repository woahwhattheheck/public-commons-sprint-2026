# Stellar Forge buyer acquisitions in PHP

This package gives a PHP application the original customer acquisition workflow:
receive a merchant request, review its actual offer and local budget, prepare the
original receiver operator, assemble an immutable acquisition, use the original
approval and buyer, consume saved resources, and recover the complete acquisition.

The implementation calls the maintained
[`buyer-runbook/customer-bridge.mjs`](../../buyer-runbook/customer-bridge.mjs).
Request custody, draft revisions, approvals, execution identities, accounting and
encrypted recovery remain in that runtime. The PHP constructor does not create a
workspace or a ledger. Each method or CLI invocation runs one explicit command.

## Install and select the runtime

Requirements are 64-bit PHP 8.1 or later with `ext-json`, a POSIX host with PHP process
functions enabled, Node 22 or later, and the complete matching Stellar Forge
runtime with its original dependencies installed. Keep `sf88-operator-buyer-cli`,
its sibling `buyer-runbook`, and the original operators together. The PHP files
alone do not contain the native payment, intake or recovery engines.

Use the PHP directory from that matching source distribution. It works directly:

```sh
php bin/stellar-forge-acquisitions.php --help
php bin/stellar-forge-acquisitions.php review-request --help
```

The included `composer.json` also supports a local Composer path repository; it
does not require a published registry package. Its classmap loads
`StellarForge\Buyer\AcquisitionWorkspace`, `AcquisitionResult` and
`AcquisitionException` from the maintained SDK source. There are no Composer
dependencies beyond PHP and `ext-json`. The executable is
`stellar-forge-acquisitions.php` when installed through Composer's bin directory.
`ext-pcntl` is optional and enables the CLI's cooperative SIGINT/SIGTERM handling.

Without Composer, load the SDK directly:

```php
require_once '/opt/stellar-forge/stellar/scf-starforge-20261009/' .
    'sf88-operator-buyer-cli/php/src/Acquisitions.php';
```

With a local Composer installation, load the application's `vendor/autoload.php`
instead. The PHP CLI and command-file example also work without Composer.

## Private customer settings

Copy [`examples/settings.json`](examples/settings.json) to the customer's private
configuration location and replace its example paths with actual canonical
paths. The essential shape is:

```json
{
  "runtimeDirectory": "/opt/stellar-forge/stellar/scf-starforge-20261009/sf88-operator-buyer-cli",
  "node": "/usr/bin/node",
  "directory": "/srv/stellar-forge-customer/state/acquisitions",
  "configsDirectory": "/srv/stellar-forge-customer/state/configs",
  "operatorSettings": "/srv/stellar-forge-customer/state/operator-settings.json",
  "paidFileClaimEnvs": ["SF101_CLAIM_TOKEN"],
  "temporaryDirectory": "/srv/stellar-forge-customer/tmp"
}
```

Use private directories with mode `0700` and private configuration/output files
with mode `0600`. Native paths must be absolute, canonical and free of symlink
aliases. The temporary directory must exist outside the selected acquisition and
configuration directories. A complete backup's temporary work also stays outside
the captured state root.

`operatorSettings` is the path to the original
[`stellar-forge.buyer-runbook-operator.v1` preset](../../buyer-runbook/WORKSPACE.md).
That customer-controlled preset selects the real payer, actor, service, Python
interpreter, signer reference and local maximum budget. A merchant handoff does
not select those values. The original configurations directory is fixed when the
workspace is created. Reopen an existing workspace by selecting its original
`directory`; construction itself does not open it.

| Setting | Purpose |
| --- | --- |
| `runtimeDirectory` | Complete matching native `sf88-operator-buyer-cli` directory. |
| `node` | Required absolute canonical path to the selected Node executable. |
| `directory` | Original acquisition workspace. Omit for standalone verify/restore. |
| `configsDirectory` | Native configuration directory for initial customer setup. |
| `operatorSettings` | Canonical filename of the original customer operator preset. |
| `paidFileClaimEnvs` | Optional initial list of declared claim environment names for original paid files. |
| `temporaryDirectory` | Existing caller-selected temporary parent outside captured state. |
| `resultLimit` | Maximum retained native result size, from 1 MiB through 256 MiB. |
| `timeoutMs` | Native command deadline in milliseconds. |
| `cleanupGraceMs` | Time allowed for the owned native process to clean up. |
| `outputLimit` | Bound on captured process output. |
| `environment` | Optional complete native process environment; omitted inherits the caller's environment. Keep values private. |

An explicit `environment` object replaces the inherited environment, matching
the original Node runtime. Include all variables the selected original operator
needs, including its declared signer, claim or recovery passphrase variables.
Leave the setting absent when the inherited process environment is intended.

## One explicit CLI command

```sh
php bin/stellar-forge-acquisitions.php \
  --settings /srv/stellar-forge-customer/settings.json \
  state --pretty

php bin/stellar-forge-acquisitions.php \
  --settings /srv/stellar-forge-customer/settings.json \
  receive --parameters /srv/stellar-forge-customer/commands/receive.json --pretty
```

The second command's parameter file contains:

```json
{"file":"/srv/stellar-forge-customer/incoming/order.handoff.json"}
```

`--settings` and `--parameters` accept ordinary JSON files of at most 1 MiB each.
The top level must be an object. The CLI retains nested `{}` as objects, `[]` as
arrays and quoted atomic amounts as strings; it never turns a budget string into
a float. Use quoted decimal strings for every atomic budget. PHP's large-integer
decoder also avoids truncating integer literals beyond its integer range.

The CLI passes the original command and parameter names unchanged. It accepts
one command and rejects extra positional commands or duplicate options. There is
no implicit execution, finalize, unlock or follow-up retry. Successful commands
write one complete `AcquisitionResult` JSON document to stdout. A native/SDK error
writes `{"errorCode":"SAFE_CODE","result":...}` with the retained result when
available. Raw child logs, private arguments and exception traces are not printed.

| Exit | Meaning |
| --- | --- |
| `0` | The returned result is successful. |
| `2` | Native/SDK outcome; inspect `result.native` and `result.process`. |
| `64` | Invalid CLI input or JSON document. |
| `70` | Local CLI failure reported with a safe code. |
| `74` | JSON output could not be written. |
| `130` / `143` | SIGINT / SIGTERM received through the installed PCNTL handlers. |

## Request review and original preparation

`receive` returns the original retained request ID. Inspect it with `request`,
then put that exact ID, an actually advertised accept index, and the customer's
selected local budget into a review file:

```json
{
  "id": "returned-request-id",
  "acceptIndex": 0,
  "totalAtomic": "30000",
  "dailyAtomic": "20000"
}
```

Those amounts are examples, not defaults. Run `review-request`, display the
returned actual offer, request, payer and budget, and use the selected review's
`reviewSha256` for `prepare-request`:

```json
{"id":"returned-request-id","reviewSha256":"exact-returned-review-sha256"}
```

Preparing the request initializes its original receiver-owned operator and
returns its native `configName`. It does not approve or pay for the request.
Changed bodies, offer selections, local settings or review digests are handled
by the original intake engine. Exact request body bytes and ordinary headers
remain in native custody, including multipart requests and the absence of a body.

## Save, initialize and execute an acquisition

Use prepared requests' exact returned configuration names in the original
manifest. For example, a `save` parameter file is:

```json
{
  "expectedRevision": 0,
  "manifest": {
    "schema": "stellar-forge.buyer-runbook.v1",
    "id": "monthly-orders",
    "title": "Monthly order acquisition",
    "operations": [
      {
        "id": "order",
        "label": "Merchant order",
        "config": "returned-config-name.json",
        "saveAs": "order.json"
      }
    ]
  }
}
```

An acquisition contains 1–64 operations under the original native limit. Editing
an existing draft supplies its `id` and exact `expectedRevision`; reading a
retained version uses `draft` with `id` and `revision`. An existing original run
can be selected with `attach` and its canonical `run` path.

Review the returned draft plan before calling `initialize` with its exact `id`,
`expectedRevision` and `reviewSha256`. Then `inspect` returns the initialized
acquisition and its actual `planSha256`. An explicit `execute` file contains:

```json
{
  "id": "returned-acquisition-id",
  "expectedPlanSha256": "exact-inspected-plan-sha256"
}
```

An optional `only` selects one original operation. Execution still requires the
original controlling terminal approval; the PHP client does not answer it.
Run the explicit purchase from the operator's original terminal. Headless
applications can prepare, review, inspect and consume results using this same
workspace.

`finalize` observes existing original reservations through the maintained
accounting engines. It may query the original provider and does not submit a new
purchase. Read the per-operation outcome and original receipt; a successful
command does not itself establish settlement. `bind-accounting` explicitly
selects a matching original operator workspace for an imported run.

## Saved resource and report delivery

Use `preview` with the acquisition `id` and `operationId` to read the original
bounded resource preview. `download` adds a new canonical `destination` and copies
the complete resource after checking its recorded length, SHA-256 and file
identity. `export` writes an original `json`, `html` or `csv` report. For example:

```json
{
  "id": "returned-acquisition-id",
  "operationId": "order",
  "destination": "/srv/stellar-forge-customer/exports/order.json"
}
```

The destination must be new and its parent must already be private. Existing
files are not overwritten. The native result reports publication separately
from subsequent directory-sync or cleanup diagnostics. `export-request` uses
the original request ID with `kind: "body"` or `kind: "handoff"` to export retained
request input; an absent original body stays absent.

## Original paid-file acquisition and delivery

The maintained bridge also exposes the original merchant paid-file intake and
retrieval engine. Its eight commands use the same original acquisition workspace
and command result shape. `state` includes its retained paid-file orders.

Receive the actual merchant handoff with `receive-paid-file`:

```json
{"file":"/srv/stellar-forge-customer/incoming/merchant-file.handoff.json"}
```

The original engine retains the exact source bytes and returns a **paid-file
order ID**. Use that ID for `paid-file`, `review-paid-file`, `prepare-paid-file`
and `export-paid-file`. An initial review is explicit about its revision,
customer-selected budget, destination filename and claim environment name:

```json
{
  "id": "returned-file-id",
  "expectedRevision": 0,
  "totalAtomic": "30000",
  "dailyAtomic": "20000",
  "filename": "merchant-order.pdf",
  "claimEnv": "SF101_CLAIM_TOKEN"
}
```

Choose actual amounts within the customer's existing operator limits. A later
review supplies the exact current `expectedRevision`. Show the native accepted
terms, original handoff identity and operator before passing the selected
`reviewSha256` to `prepare-paid-file`. Preparation returns the original
`configName`, `configSha256`, intent identity and paid-file binding. Put that
`configName` into the ordinary acquisition manifest and use the same
save → initialize → inspect → explicit execute workflow described above.

`paidFileClaimEnvs` in the initial settings may declare 1–32 unique environment
names matching `^[A-Z][A-Z0-9_]{1,64}$`, for example `["SF101_CLAIM_TOKEN"]`. The original default is
`SF101_CLAIM_TOKEN`. The native workspace retains this declaration and rejects
an incompatible change on reopen. `claimEnv` selects one declared name. Supply
its value through the private runtime environment; JSON commands contain the
name only, and native views report its availability without returning the value.

After the original purchase has produced its retained delivery authorization,
inspect the initialized acquisition's selected operation. `retrieve-paid-file`
uses the **acquisition ID**, its operation ID in `only`, and the current native
paid-file view's exact configuration and handoff digests:

```json
{
  "id": "returned-acquisition-id",
  "only": "order",
  "configSha256": "exact-current-operation-config-sha256",
  "handoffSha256": "exact-current-paid-file-handoff-sha256"
}
```

The original transfer engine owns retrieval and its retained progress. The CLI
waits for that selected operation and preserves native completion separately
from cancellation or later reporting failure. An explicit `reset-paid-file`
uses the same four fields to select the exact transfer state under the original
reset rules. Neither command automatically executes another purchase.

`download-paid-file` uses the acquisition `id`, `operationId` and a new private
`destination` to export a fully retrieved file. The original engine verifies its
advertised size, SHA-256 and retained descriptor before the bridge publishes the
complete bytes. `export-paid-file` instead uses the paid-file order ID to export
the exact original handoff. Existing output files are never replaced.

## Complete acquisition recovery

Use the original [recovery guide](../../buyer-runbook/RECOVERY.md) to choose a
canonical `stateRoot` containing all selected runs, input, configurations,
operator generations and authenticated ledger checkpoints. `backup-review`
returns the exact current review. Stop external writers before `backup`.

The CLI uses the **bridge names** in its backup parameter file:

```json
{
  "stateRoot": "/srv/stellar-forge-customer/state",
  "output": "/srv/stellar-forge-customer/backups/acquisition-2026-10-11",
  "expectedReviewSha256": "exact-backup-review-sha256",
  "quiesced": true,
  "passEnv": "SF88_BACKUP_PASSPHRASE"
}
```

Supply the passphrase privately through the named environment variable; the
parameter file contains only its name. `quiesced: true` records the caller's
assertion that external writers are stopped. Native capture also holds its own
workspace, run and ledger locks and checks staged journals before encryption.

Verify or restore with settings that select the native runtime and omit the live
workspace `directory`. Use the returned exact bundle path and record digest:

```json
{
  "bundle": "/srv/stellar-forge-customer/backups/returned-bundle-path",
  "expected": "exact-returned-record-sha256",
  "passEnv": "SF88_BACKUP_PASSPHRASE"
}
```

An optional `python` selects a canonical Python interpreter. Verification does
not need the live source. Restore uses the archive's exact original state root
and requires an absent target; it does not relocate an acquisition or overwrite
a populated workspace. It restores original keys, plans, journals and execution
identities and reopens the original workspace. Reopen that workspace with
`state` afterward. A completed publication remains in the result even if a later
reopen or cleanup reports a problem.

## PHP application integration and cancellation

The generic method has the same exact command interface as the CLI:

```php
use StellarForge\Buyer\AcquisitionWorkspace;
use StellarForge\Buyer\AcquisitionException;

$workspace = new AcquisitionWorkspace([
    'runtimeDirectory' => '/opt/stellar-forge/stellar/scf-starforge-20261009/sf88-operator-buyer-cli',
    'node' => '/usr/bin/node',
    'directory' => '/srv/stellar-forge-customer/state/acquisitions',
]);
$cancelled = false;
$isCancelled = static function () use (&$cancelled): bool {
    return $cancelled;
};

try {
    $result = $workspace->command('inspect', ['id' => $acquisitionId], $isCancelled);
    echo json_encode($result, JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT), "\n";
} catch (AcquisitionException $error) {
    echo json_encode([
        'errorCode' => $error->errorCode,
        'result' => $error->result,
    ], JSON_THROW_ON_ERROR | JSON_PRETTY_PRINT), "\n";
}
```

The callback should return a boolean cancellation flag, without changing its
source or starting another command. The CLI and the executable example install
PCNTL handlers that set this flag on SIGINT/SIGTERM and restore previous handlers
after the owned command returns. The SDK gives the original child its cleanup
period before returning. With no PCNTL extension, PHP applications can still
supply their own cooperative callback; the CLI's automatic signal integration
is unavailable.

`AcquisitionResult` implements `JsonSerializable` and retains `command`,
`commandId`, `completionReported`, `native`, `process` and `ok`. `process` explains
the caller/process outcome separately from the native record. A cancelled or
failed call may still retain completed native work. `AcquisitionException`
exposes only its safe `errorCode` through `getMessage()` and preserves a nullable
`result`. Inspect that retained result and original state before choosing a next
action. The SDK never adds a retry, unlock, purchase or accounting follow-up.

Process diagnostics also retain `nativeCleanupErrorCode` and
`temporaryCleanupErrorCode` alongside the combined `cleanupErrorCode`, so one
cleanup failure cannot replace the other. Check the retained native publication
and these diagnostics together when deciding what to do next.

`recover` invokes original interrupted-run recovery. `unlock` requires the exact
observed stopped `ownerPid` and the native lease rules. These actions do not
authorize another payment. An explicit later `inspect` shows the resulting state.

The camelCase convenience methods match the original Node acquisition client:
`state`, `attachRun`, `request`, `receiveRequest`, `reviewRequest`,
`prepareRequest`, `draft`, `save`, `initialize`, `inspect`, `execute`, `recover`,
`unlock`, `finalize`, `bindAccounting`, `preview`, `download`, `export`,
`exportRequest`, `backupReview`, `backup`, `verify` and `restore`.

The additional paid-file methods are `paidFile`, `receivePaidFile`,
`reviewPaidFile`, `preparePaidFile`, `retrievePaidFile`, `resetPaidFile`,
`downloadPaidFile` and `exportPaidFile`. They dispatch the corresponding original
bridge commands documented above.

| Convenience option | Exact generic command/CLI field |
| --- | --- |
| `backup(... reviewSha256 ...)` | `backup` → `expectedReviewSha256` |
| `backup/verify/restore(... passphraseEnv ...)` | `passEnv` |
| `verify/restore(... expectedRecordSha256 ...)` | `expected` |

Use the native field names with `command()` and in parameter files. This keeps
the CLI compatible with the original bridge rather than guessing aliases.

## Runnable command-file example

[`examples/acquisitions.php`](examples/acquisitions.php) accepts a private settings
file and one command document, mirroring the original Node example:

```json
{"command":"state","parameters":{}}
```

```sh
php examples/acquisitions.php \
  /srv/stellar-forge-customer/settings.json \
  /srv/stellar-forge-customer/commands/state.json
```

It reuses the same JSON reader, native dispatch, safe result output and signal
handling as the CLI. The example executes exactly the requested command and
returns its actual outcome.

## Native command reference

Square brackets mark optional fields. Values come from the original source or
previous native result; `COMMAND --help` prints a parameter-file shape.

| Command | Parameter fields |
| --- | --- |
| `state` | None. |
| `attach` | `run` |
| `request` | `id` |
| `receive` | `file`, `[filename]` |
| `paid-file` | Paid-file order `id`. |
| `receive-paid-file` | `file`, `[filename]` |
| `review-paid-file` | Paid-file order `id`, `expectedRevision`, `totalAtomic`, `dailyAtomic`, `filename`, `claimEnv`. |
| `prepare-paid-file` | Paid-file order `id`, `reviewSha256`. |
| `retrieve-paid-file` | Acquisition `id`, `only`, `configSha256`, `handoffSha256`. |
| `reset-paid-file` | Acquisition `id`, `only`, `configSha256`, `handoffSha256`. |
| `download-paid-file` | Acquisition `id`, `operationId`, `destination`. |
| `export-paid-file` | Paid-file order `id`, `destination`. |
| `review-request` | `id`, `acceptIndex`, `totalAtomic`, `dailyAtomic` |
| `prepare-request` | `id`, `reviewSha256` |
| `draft` | `id`, `[revision]` |
| `save` | `manifest`, `[id]`, `expectedRevision` (`0` for a new draft) |
| `initialize` | `id`, `expectedRevision`, `reviewSha256` |
| `inspect` | `id` |
| `execute` | `id`, `expectedPlanSha256`, `[only]` |
| `recover` | `id` |
| `unlock` | `id`, `ownerPid` |
| `finalize` | `id`, `[only]` |
| `bind-accounting` | `id`, `workspace`, `[only]` |
| `preview` | `id`, `operationId` |
| `download` | `id`, `operationId`, `destination` |
| `export` | `id`, `format` (`json`, `html`, `csv`), `destination` |
| `export-request` | `id`, `kind` (`body`, `handoff`), `destination` |
| `backup-review` | `stateRoot` |
| `backup` | `stateRoot`, `output`, `expectedReviewSha256`, `quiesced`, `passEnv` |
| `verify` | `bundle`, `expected`, `passEnv`, `[python]` |
| `restore` | `bundle`, `expected`, `passEnv`, `[python]` |

The maintained [Node acquisition guide](../node/ACQUISITIONS.md),
[original runbook workspace](../../buyer-runbook/WORKSPACE.md), and
[original recovery guide](../../buyer-runbook/RECOVERY.md) describe the same native
engines. This PHP package uses the repository's MIT license.
