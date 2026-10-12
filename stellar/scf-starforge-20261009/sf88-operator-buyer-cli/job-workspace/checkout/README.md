# Paid job checkout

Checkout brings the merchant’s prepared application job into the existing customer workspace. Import the private handoff, review its exact request with the original SF88 buyer, approve the purchase through the original terminal, then open the accepted job. Execution status, verified output, research notes and collections continue in the same customer application.

The original merchant owns job admission and settlement. The original SF88 operation owns the request, operator binding, permanent attempt and native result. Checkout retains that operation and joins its accepted response to the original paid-job buyer.

## Open with the existing operator

Use the maintained Starforge installation containing the job customer workspace and the original Node buyer’s signal-aware creation and review API. Provision the selected runtime with the original native, schema and operator components using the [merchant installation guide](../../../sf30-seller-sdk/jobs/INSTALL.md).

The usual launch uses an already initialized SF88 operator workspace:

~~~sh
starforge job-workspace serve --state /srv/private/customer-jobs --operator-workspace /srv/private/operator
~~~

An application already using an original Node buyer operator profile can keep that profile:

~~~sh
starforge job-workspace serve --state /srv/private/customer-jobs --operator-profile /srv/private/operator-profile.json
~~~

Choose one operator source. The workspace path identifies the original initialized operator, with its existing signer, policy, ledger and wallet environment. The profile path identifies an ordinary private JSON file with the original SDK’s operator, signer-module and optional transport settings. The original SDK validates and uses those settings.

The CLI derives its native runtime from the installed source containing this command. For an explicit source checkout, add the absolute SF88 runtime path:

~~~sh
node /srv/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/cli.mjs serve --state /srv/private/customer-jobs --operator-workspace /srv/private/operator --runtime /srv/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli
~~~

Keep this foreground process attached to its terminal. When a purchase reaches approval, the original operator asks for input there. In the maintained Applications console, the existing managed PTY supplies that terminal. The [Applications join](APPLICATIONS.md) describes its catalog, input and startup bindings.

The launch prints one JSON record containing private links for **Checkout**, **Jobs**, **Resource library** and **Collections**. Open the supplied Checkout URL. These views share the existing local server and its session token.

Each imported ticket keeps the selected native runtime and operator source. A profile’s exact configuration bytes are saved privately at intake; its original signer and policy remain referenced. A native workspace stays at its original absolute directory. Reopening the application with a different selection affects subsequent imports. Existing checkouts continue with their saved selection.

## Import and inspect the ticket

The merchant’s original jobs command or operator browser provides a private handoff for a prepared job. It contains the job identifier, application function, input digest, exact payment option, purchase URL and claim capability.

In Checkout, choose that handoff JSON file, add an optional label, then select **Import ticket**. Intake retains the exact bytes before any native preparation. The browser displays the merchant, application, network, asset, recipient, maximum atomic amount, timeout and request identity.

The accepted payment amount is displayed in its original atomic unit. The workspace keeps the asset identifier alongside it; no fiat conversion or guessed decimal scale is introduced.

Intake requires the original prepared handoff. The same job identifier must appear in the request body, order reference, header and the single sf98_order URL query. The anticipated status and result URLs must belong to the same merchant. The existing SF88 operation validator checks the exact Stellar terms and header policy.

The checkout ID is stable for the merchant’s job status URL. Importing identical ticket bytes again reopens the same checkout. A newer ticket for that job goes through the explicit replacement action described below.

## Review, purchase and open the job

Select **Review request**. Checkout creates one original SF88 operation with its stable intent, original operator configuration, exact job body and a 64 KiB JSON response destination. The original offline review appears in the detail view, including its operator, service, request/body binding and review time.

Select **Start checkout** when the displayed request is ready. Continue in the original connected terminal. The native buyer performs its existing approval, signing, policy/reservation and HTTP purchase flow. Checkout holds one active native preparation, review or purchase operation at a time, so terminal prompts stay associated with one selected job.

After an original settled HTTP 202 response, the application passes the actual BuyerResult and matching handoff to createJobBuyer. That original buyer verifies and retains the accepted bytes and native purchase record. **Open accepted job** then selects the same retained entry in Jobs.

The job’s execution state progresses independently of purchase acceptance. Use **Refresh status**, **Monitor job** or **Retrieve result** in Jobs. The original customer transport reads the job status and result; the existing library verifies the delivered file, supports preview and download, and preserves notes and collections. [The customer guide](../README.md) covers those operations.

If that same accepted identity is already registered, the workspace reuses its original entry and receipt. Checkout keeps its native operation and result beside that entry.

## Stop and recover

**Stop local operation** aborts the original preparation, review or checkout process through the original SDK’s AbortSignal. The task remains active until its native child finishes cleanup. A result returned during shutdown is retained and adopted before the customer lease is released.

Checkout saves its task before starting the original operation. If the browser disconnects, reopen the same checkout and read its state. If the customer process restarts, interrupted tasks appear in the retained history. Select **Recover original operation** to inspect the original request, permanent attempt and saved result.

| Checkout stage | Meaning and available operation |
| --- | --- |
| IMPORTED | The private ticket is retained. Review prepares its original request. |
| REVIEWED | The original offline review is retained. Start checkout uses that exact review. |
| RECOVERABLE | An original attempt is recorded. Recover reads the same operation and any returned result. |
| FINISHED | The original buyer returned an outcome. Its status and response-file state appear in Purchase outcome. |
| ACCEPTED | The checked 202 response is retained in the original job buyer. Open the accepted job to use its result workflow. |

The permanent original attempt survives errors, timeouts, missing response files and customer restarts. A missing native directory does not erase that fact. Restore the original directory shown under **Request and recovery location**, then recover it. The saved runtime path, request configuration, body, attempt, stdout/result and response bytes are the recovery inputs.

A crash during preparation can leave an original operation in PREPARING before it has an attempt. Checkout preserves that incomplete preparation in its private archive and prepares the same intent from its exact retained ticket. It checks the original attempt and result files before this recovery. Once an attempt exists, the workflow continues through the original recovery API.

Recovery can finish accepted-result intake after a local file or library error. The original settled response remains in the native operation throughout that process. Jobs and the resource library continue to use their existing retained buyer and delivery files.

## Use a renewed merchant ticket

The merchant can renew a prepared, unsubmitted job’s claim capability through its original operator. This keeps the merchant job and application input and increments the merchant revision. It provides a new private handoff.

Select the existing checkout, open **Use a renewed merchant ticket**, choose that newer handoff and enter the reason. Replacement requires the same merchant/job/function, input digest, purchase URL and payment terms, with a newer merchant revision. It is available before an original purchase attempt.

The new ticket is retained first. Checkout then saves the replacement intent, archives its original unattempted preparation, and selects the new ticket for the same stable intent. History keeps the prior/new handoff hashes, merchant revision, reason and preparation archive. A restart during that transition exposes recovery on the same checkout.

Run **Review request** again to prepare and review the updated capability. The operator workspace, profile and native runtime selection remain attached to the existing checkout.

## Command line

Stop the running customer server before using standalone commands on its state. The browser uses the already held customer lease; standalone commands acquire that same original lease.

~~~sh
starforge job-workspace checkout-import --state /srv/private/customer-jobs --operator-workspace /srv/private/operator --handoff-file /srv/private/intake/report-handoff.json --label "October demand report"
starforge job-workspace checkout-list --state /srv/private/customer-jobs
starforge job-workspace checkout-show --state /srv/private/customer-jobs --checkout CHECKOUT_ID
~~~

Each action accepts the current checkout revision. Read it from the preceding command:

~~~sh
starforge job-workspace checkout-review --state /srv/private/customer-jobs --checkout CHECKOUT_ID --expected-revision 0
~~~

Use the newly returned revision for the purchase action:

~~~sh
starforge job-workspace checkout-execute --state /srv/private/customer-jobs --checkout CHECKOUT_ID --expected-revision REVIEWED_REVISION
~~~

These commands wait for the actual operation and print its retained outcome. Native approval uses the controlling terminal. Ctrl-C requests cancellation and retains the operation before closing.

~~~sh
starforge job-workspace checkout-recover --state /srv/private/customer-jobs --checkout CHECKOUT_ID --expected-revision CURRENT_REVISION
starforge job-workspace checkout-replace --state /srv/private/customer-jobs --checkout CHECKOUT_ID --expected-revision CURRENT_REVISION --handoff-file /srv/private/intake/renewed-report.json --reason "Merchant renewed the prepared job capability"
~~~

For installed source review and execution, the default native timeout is six minutes. Serve and standalone native checkout actions accept --native-timeout-ms between 1000 and 3600000. The original native request and response timeouts still apply.

## JavaScript application

The existing typed package entry exposes model.checkout:

~~~js
import { readFile } from 'node:fs/promises';
import { openJobWorkspace } from '@tokenjunkielabs/starforge-merchant/buyer/job-workspace';

const model = await openJobWorkspace({
  directory: '/srv/private/customer-jobs',
  checkout: { operatorWorkspace: '/srv/private/operator' },
});
try {
  const imported = await model.checkout.import({
    handoffBytes: await readFile('/srv/private/intake/report-handoff.json'),
    label: 'October demand report',
  });
  await model.checkout.start(imported.checkout.id, {
    kind: 'review',
    expectedRevision: imported.checkout.revision,
  });
  const reviewed = await model.checkout.wait(imported.checkout.id);
  console.log(reviewed.review, reviewed.phase, reviewed.revision);
} finally {
  await model.close();
}
~~~

Use the same start/wait interface with kind execute or recover for explicit application actions. The action returns promptly after durable task creation; wait resolves after the actual original operation and accepted-result adoption finish. get, list and status expose safe customer state. cancel requests cancellation of the active original task.

The controller borrows the customer workspace’s existing kernel lease. It owns checkout records and its original Node buyer directories under checkout/; the original paid-job buyers remain in buyers/, output remains in artifacts/, and research remains in library/. A complete installation backup retains the whole customer state and the original absolute operator/runtime locations required by its saved operations.

## Native checkout continuation

The complete source includes one retained operation driver at
[native-continuation.py](./native-continuation.py), with the Node application
flow in [native-continuation.mjs](./native-continuation.mjs). It continues the
application retained by the original paid-jobs journey and exercises the
checkout through the original Node SDK child, native operator console, merchant
settlement callback, customer workspace and resource library.

Run it from the complete source cut with the existing native dependencies:

~~~sh
python3 stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/checkout/native-continuation.py \
  --retained /absolute/original/sf30-paid-jobs-directory
~~~

The host needs Node 24, Python 3.11 or later, OpenSSL, the installed x402 2.28
dependencies, RE2JS, and the complete original SF88/SF81/SF62/SF54/SF59/SF36
source. Use --node with the absolute installed Node executable when it is
outside PATH. --out selects an additional absolute result file in an existing
directory. The launcher caps each Node process's old-generation heap at 256 MiB;
allow 512 MiB for the two Node processes plus 256 MiB for native/Python/TLS
overhead and the application worker.

The original retained configuration uses a demonstration asset label. The
driver saves a named checkout configuration beneath checkout-continuation/
with a disposable contract-shaped asset accepted by the original SF36
validator. It uses the exact retained application module and records both
configuration hashes and that module's hash. The original merchant records
are read before and after the continuation. The new job has the stable
reference checkout:2026.10 and its own source-pinned merchant directory.

The transport uses the original explicit CONNECT configuration and actual TLS
verification against a local, scoped certificate. The configured signer and
facilitator supply the local protocol envelope. A controlling PTY displays the
original SF62 review and answers its exact digest only when the job, request,
body, actor, service and payment terms match this disposable fixture. SF36
creates and audits its ordinary SQLite reservation. These fixture selections
are written explicitly into the result.

The driver follows the browser's private API: import the saved merchant ticket,
review and execute its original operation, retain the actual 202 BuyerResult,
fetch the completed application output, preview/download it from the library,
annotate it, export and receive a collection, and reopen the original checkout
and customer state. Reopening verifies that the original attempt and settlement
identity stay attached to the same job.

Use the same --retained path for continuation. The private capability is saved
before merchant creation, and the exact ticket is saved before buyer
preparation. Existing checkouts recover their original operation. All state,
the original native stdout/stderr, private terminal log, certificate, fixture
keys and ledger remain in checkout-continuation/. The complete result is
checkout-continuation/native-complete.json; its source identities, actual
native outcome, delivered artifact hash, received collection and ledger audit
describe the completed flow.
