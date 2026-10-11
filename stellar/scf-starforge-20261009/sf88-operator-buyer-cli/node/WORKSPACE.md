# Native operator workspace customer

Use `Buyer.fromWorkspace` when the original SF88 operator has already been initialized.
The native workspace owns the signer, payer, policy, ledger, private evidence,
transport and approved payment limits. The Node application owns its prepared
request, response destination and single permanent attempt. Existing
`fromConfig` and `fromRequest` applications keep their original behavior.

The package calls the installed original application bridge. Its historical
`ORIGINAL_PYTHON_WORKSPACE` mode name is retained for compatibility; the same
bridge now serves both customer languages. No workspace keys are returned to the
application, copied into its metadata or passed through public command arguments.
The signer still uses the operator process's existing wallet environment.

## Prepare from the existing operator

Initialize an operator using the original `cli.mjs --init-workspace`
instructions and exact reviewed request. For a partially initialized
runbook-owned operator, use the original [runbook recovery workflow](../../buyer-runbook/WORKSPACE.md)
and its explicit resume action. `Buyer.fromWorkspace` requires an initialized
workspace and preserves its wallet, policy and ledger. The original
`--review-workspace` and `--diagnose-workspace` commands remain the setup view.

```js
import { Buyer } from '@stellar-forge/native-buyer';

const buyer = new Buyer({
  runtimeDirectory: '/srv/starforge/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli',
  stateDirectory: '/srv/private/customer-app',
});
const operation = await buyer.fromWorkspace('/srv/private/operator');
const review = await operation.review();
console.log(review.native, review.nativeWorkspace);
```

Preparation reads the original private manifest and configuration. It validates
their existing bindings without loading the operator-key file or signer. Request
bodies and tickets are retained using the ordinary Node SDK path and original
native checks. The workspace evidence directory stays beside its policy and
ledger; the response destination remains in this Node application's operation.

The explicit workspace takes precedence over a Buyer constructor's default
operator profile. `operatorProfile` is not a `fromWorkspace` option. Supply
`responseFile`, `requestTimeoutMs` or `body` through the existing import options
when the request requires them; original review validates their limits.

## Adopt a separately authored request

To use an original generated client request or an explicitly selected next page,
pass its ordinary native configuration:

```js
const page = await buyer.fromWorkspace('/srv/private/operator', {
  configuration: '/srv/private/next-page.json',
  responseFile: {
    maxBytes: 1048576,
    timeoutMs: 30000,
    expectedContentType: 'application/json',
  },
  requestTimeoutMs: 90000,
});
console.log(await page.review());
```

`configuration` may also be a bounded JSON object. The original native workspace
helper composes it over the workspace configuration, then uses the same binding
checks as the durable inbox. Explicit operator, signer, evidence, payer or
transport changes must still match. The scheme, network, asset, recipient and
payment flow must match; the requested atomic ceiling must fit both the current
workspace and generated signer limits. A different wallet request remains an
explicit reviewed operation subject to the original service policy and ledger.

The authored intent is preserved. An optional `intentId` changes it only when the
caller explicitly selects a new identity during preparation. A duplicate
application intent is refused; it is never renamed to avoid a previous attempt.
No new page is selected or executed automatically.

## Execute once, then reopen the same result

```js
const review = await operation.review();
// Explicit operator action; requires the original controlling terminal.
const result = await operation.execute({ review });
console.log(result.native, result.record.runtimeError);
```

Before publishing this operation's permanent attempt, the original bridge
validates the current workspace, original ticket fingerprint, signer
prerequisites and controlling terminal. The SDK checks that the reviewed input
and workspace did not change during that preparation. Missing local setup leaves
this application's operation unattempted. Resolve the actual setup and review
the same operation again.

After an attempt is recorded, normal original terminal consent, native signing,
SF36 policy/reservation and SF31/SF82 execution apply. Only the three workspace
operator keys enter the native approval component. The manifest's selected
evidence RPC remains attached to its native execution options. Cancellation and
timeouts remain the existing subprocess and native execution behavior.

```js
// A new process using the SAME stateDirectory and exact intent.
const saved = buyer.operation(operation.intentId);
console.log(await saved.inspect());
const result = await saved.recover();
if (result === null) {
  console.log('Original result is not recorded; no automatic retry.');
} else {
  console.log(result.native, result.record.runtimeError);
}
```

Recovery reads the saved input/result and does not reopen the signer or require
the operator workspace to be mounted. Keep both original directories when
moving or recovering a customer installation. A successful native result and a
later saved-data interpretation failure are separate facts. Use the result's
original verified-file methods to read its returned bytes.

## Original inbox and accounting

Instead of direct execution, assign the prepared operation to an existing inbox:

```js
const inbox = buyer.inbox('/srv/private/buyer-inbox');
await inbox.enqueue(operation);
const inboxReview = await inbox.review(operation.intentId);
// Separate explicit action; the inbox owns this operation after delegation.
await inbox.execute(operation.intentId, {
  review: inboxReview,
  workspaceDirectory: '/srv/private/operator',
});
```

Delegation records the original nonreplaceable Node attempt marker. Direct
`operation.execute` then points back to that inbox; it cannot create a second
purchase. Use the existing inbox `recover`, `response`, `finalize` and
`exportReport` APIs with that original workspace. These keep the original
ledger, finality and output identities. Do not enqueue an already executed
direct operation.

Use `buyer.workspaceRecovery()` for the existing single-operator encrypted
backup and authenticated original-root restore, including this application and
any selected inbox. Its [recovery guide](RECOVERY.md) and maintained
`examples/recover_workspace.mjs` remain the implementations. The separate
runbook acquisitions API owns its multi-request workflow.

## Runnable customer stages

The complete [workspace_customer.mjs](examples/workspace_customer.mjs) example
provides explicit `prepare`, `review`, `inspect`, `execute`, `recover` and
`enqueue` stages. Run `--help` for all flags:

```sh
node examples/workspace_customer.mjs prepare \
  --runtime /srv/starforge/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli \
  --state /srv/private/customer-app --workspace /srv/private/operator \
  --config /srv/private/reviewed-request.json
node examples/workspace_customer.mjs review \
  --runtime /srv/starforge/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli \
  --state /srv/private/customer-app --intent original-request-id
```

Only its explicit `execute` stage can start a buyer attempt. Operator credentials
remain in the existing private environment, never in the example arguments.
