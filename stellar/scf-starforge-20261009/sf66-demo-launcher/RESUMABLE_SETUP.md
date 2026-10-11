# Resume an interrupted commerce preparation

The original commerce preparer can finish the same private directory after its
process stops between creating the operator, staging a merchant, and enqueuing
the selected buyer requests. It reuses the original SF88 workspace, SF36 spend
ledger, and SF88 inbox. The saved intent IDs continue to identify the same work.

## Operator workflow

Keep the original setup configuration and its referenced seller, buyer-body,
ticket, provider, and handler files at their reviewed paths. Use the same private
destination directory:

```sh
node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-setup.mjs review \
  --config /private/setup.json --directory /private/commerce

node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-setup.mjs resume \
  --config /private/setup.json --directory /private/commerce

node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-setup.mjs inspect \
  --directory /private/commerce
```

`prepare` remains an exclusive creation command. `resume` also creates the
directory when it is absent, and retains incomplete preparation if an operation
fails so the same directory can be resumed. A complete matching preparation
returns its original inspection and commands.

The RPC authoring workspace uses this same API when a saved commerce review is
prepared or resumed. It retains the selected buyer actions and checks the
original prepared source and summary before making the session available. A
named existing paid session remains an explicit attachment to that original
preparation.

After the result is `PREPARED`, use its returned `commands.console` to open the
original private commerce console. Native review, approval, payment, response
download, and payment recovery continue through that console and its original
operator APIs.

## What the initializer retains

| Original state | Resume behavior |
| --- | --- |
| Reviewed setup and request sources | Existing staged bytes must match. The initialization record pins the reviewed source, operator settings, merchant configuration, body, ticket, and source digests. |
| Operator key file | The same three SF36 keys are loaded. If those key variables are explicitly supplied again, all three must match the retained file. |
| Policy, payer, signer and transport configuration | The newly derived original configuration must match its retained bytes before missing files are added. |
| Original spend ledger | The original Governor reopens and authenticates its journal. Existing reservations and outcomes remain in that ledger. |
| Inbox membership | The original queue accepts an already published identical intent and preserves its request, attempt, terminal result, and recovery history. |
| Completed workspace and session records | Their original creation timestamps remain. A completed session reopens through its native readers without enqueuing requests. |
| Python, HTTP upstream, JSON-RPC and paid-file declarations | Their original retainers accept identical existing bytes under explicit resume. |

Each private constructor holds an operating-system lock through the configured
Python executable. A concurrent initializer reports
`INITIALIZATION_ALREADY_RUNNING`. When the parent process exits, the lock is
released by the operating system; restarting uses the same directory.

New retained files are written completely, synchronized, and published with an
exclusive link. `workspace.json`, `session.json`, and the enclosing
`prepared.json` are published after their respective initialization stages are
complete. Existing files are checked before missing inputs are filled.

## Recover a source mismatch

`INITIALIZATION_SOURCE_CHANGED`, `COMMERCE_SETUP_RESUME_SOURCE_CHANGED`, or
`COMMERCE_INITIALIZATION_BUYER_CHANGED` means the incoming preparation differs
from retained work. Restore the original reviewed configuration or referenced
file and repeat `resume` in the same directory. The comparison covers the
original payer, budgets, signer, merchant, operation body, and request identity.

`WORKSPACE_RESTORE_ORIGINAL_OPERATOR_KEYS`,
`WORKSPACE_RESTORE_ORIGINAL_LEDGER`,
`WORKSPACE_RESTORE_ORIGINAL_INITIALIZATION_INPUTS`, and
`COMMERCE_SETUP_RESTORE_ORIGINAL_INPUTS` identify an original file that must be
restored. Restore it from the operator's retained backup before resuming. A
completed workspace's missing ledger cannot be replaced with an empty ledger.
The original completed session similarly requires its retained inbox history.

For directories created by an older release without an initialization record,
resume first compares the staged original files and authenticates the operator
state. It records the complete incoming source after those native initialization
steps succeed. Keep the original configuration used for that directory.

An original operation ticket must still satisfy its own validity rules. Resume
uses the original ticket reader and preserves the retained ticket bytes.

## Embedding contract

```js
import { prepareCommerceSetup } from './commerce-setup.mjs';

const prepared = await prepareCommerceSetup(
  { configFile: '/private/setup.json', directory: '/private/commerce' },
  { environment: retainedEnvironment, resume: true },
);
```

Lower-level callers use the same original functions:

```js
await initializeWorkspace(originalArguments, { environment, resume: true });
await initializeCommerce({ planFile, directory }, { resume: true });
await initializeQueue(inboxDirectory, { resume: true });
```

The default for each function is `resume: false`. These operations require the
original trusted Python 3.11+ executable and a POSIX system with `fcntl.flock`.
Private directories belong to the current operator and have mode `0700`;
retained private files have mode `0600`. Canonical absolute paths keep the
original operator, signer, queue, and source bindings stable across restarts.

For the configured native RPC merchant and its separately timed response
recovery workflow, see [JSONRPC_COMMERCE.md](JSONRPC_COMMERCE.md).
