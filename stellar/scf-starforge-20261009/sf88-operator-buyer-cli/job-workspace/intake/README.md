# Request a merchant application job

The **Request** view takes a merchant's configured function from input form to original checkout. It saves your selected function, inputs, reference and private retrieval claim before sending the request. It then retains the merchant ticket and opens the same original paid-job checkout.

After checkout accepts the job, the existing **Jobs**, **Resource library** and **Collections** views follow execution, retrieve the verified output and keep it available for later work.

## Open the installed customer application

Use the maintained Starforge distribution and an existing original SF88 operator:

~~~sh
starforge job-workspace serve \
  --state /srv/starforge/customer-jobs \
  --operator-workspace /srv/starforge/operator
~~~

For an existing private operator profile, use --operator-profile /absolute/profile.json instead. The installed distribution supplies the original runtime. An explicit --runtime /absolute/sf88-operator-buyer-cli selects another retained original source runtime.

Open the printed intakeUrl, or choose **Request** from the customer navigation. This is /jobs/request/ in the same private HTTP host as Checkout, Jobs, Resource library and Collections. The startup record and private launch file include its complete URL.

The default server approval mode is browser. The original checkout presents its configured approval in the browser once the request has been reviewed. To use the original foreground terminal approval, start serve with --approval-mode terminal. Standalone checkout-execute commands use terminal approval.

For a source checkout, replace starforge job-workspace with:

~~~sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/job-workspace/cli.mjs
~~~

The running application owns its original workspace lease. Use its browser while it runs; stop it normally before opening standalone commands against the same directory.

## Choose a merchant and supply inputs

Enter the merchant's exact HTTPS origin, such as https://jobs.example.com, and select **Load functions**. The merchant must have enabled its [input-request catalog](../../../sf30-seller-sdk/jobs/intake/README.md). The page displays the service, selected function description, atomic payment amount, network, asset and recipient, output filename/type and execution limit.

Select a function. Its form comes from the actual configured input schema:

- String, numeric, integer, boolean and enumerated inputs use corresponding controls.
- Optional properties have an Include switch.
- Object, array and other complex inputs use a JSON field.
- The full JSON view lets you inspect or edit the whole request before applying it to the form.

The merchant's original schema validator makes the final input decision. The form shows constraints and examples to make authoring practical.

Add a useful label. A reference is created when you first save the draft; you can supply an original reference such as demand:2026.10. That reference identifies one exact set of inputs at one merchant. Save changed inputs under a new reference.

If the catalog requires an intake access token, enter the key supplied by that merchant. It is saved only in the private customer request state and sent to that merchant's request endpoint. The page clears the visible key field after saving.

Choose **Save draft** to keep the request locally, or **Prepare checkout** to save it and ask the merchant for its original ticket. The saved request appears in the left-hand list with its merchant, function, price and phase.

## Open the same original checkout

Preparation performs these durable steps:

1. Save the request reference, selected catalog/function, input, claim and canonical request digest.
2. Retain the fact that a merchant request is about to be sent.
3. Send that request through the original public HTTPS transport.
4. Verify the returned original job, function, input hash, label, URLs, payment and claim.
5. Save the exact response and private handoff.
6. Import that handoff into the original Checkout application.

Preparation stops at the imported checkout. Select **Open Checkout** to inspect the original request and terms, review it and continue its configured approval flow.

A settled native acceptance links to the existing customer job. **Open accepted job** then takes you to its execution status and result workflow. The original job buyer checks the completed result's hash, byte count, type and filename before the library takes in the delivered file.

The private request retains the checkout ID, so reopening Request can take you back to that same original operation and accepted job. It does not derive another purchase from the status or result URL.

## Recover a request

Saved requests survive a closed page, service restart or interrupted HTTP call. Reopen the original customer state and select the request. The detail view shows the original input, current phase, last activity, attempt counts and recent history.

| Phase | What is retained and how to continue |
| --- | --- |
| DRAFT | The input and claim are saved locally. Prepare checkout when ready. |
| RECOVERABLE | A request may have reached the merchant. Continue the saved request to recover that same reference. |
| READY | The merchant response and handoff are saved. Import that ticket into original Checkout. |
| IMPORTED | The original checkout ID is linked. Open it to review, execute or recover the native operation. |
| WITHDRAWN | The local draft or original unsubmitted merchant job has been withdrawn. |

If the merchant response was lost, **Prepare checkout** resends the saved request and original claim. The merchant's original createJob operation returns the existing matching job. A changed catalog selection or access-key rotation can still recover an existing job through that claim and unchanged original function.

If preparation saved a ticket but the customer application lacks an operator selection, reopen the workspace with its existing operator workspace or profile and use **Open in Checkout**. The retained handoff is imported from its saved bytes.

Once the original checkout has attempted a payment, its own **Recover original operation** action resumes the native state. The input-request record keeps pointing to that checkout. The checkout guide covers its original attempt, approval and result-recovery lifecycle.

Use **Stop** to abort an active local request. The application waits for the original HTTP operation to drain and records its result. A stopped or timed-out request retains its identity so its outcome can be resolved without inventing a second reference.

## Withdraw an unsubmitted request

Enter a reason and choose **Withdraw request** when a prepared job is no longer needed.

An unsent draft is withdrawn locally. If a prior request might have reached the merchant, the application first resolves that same request, then asks the original merchant to withdraw it. This preserves the real outcome of a lost reply.

The merchant accepts withdrawal while the job is still PREPARED and unsubmitted. It checks the original claim and revision in the same serialized state operation that native staging uses. Once submission has started, follow that job through its original checkout and merchant execution controls.

A repeated withdrawal of the same cancelled, unsubmitted job remains idempotent. A merchant access-key rotation does not invalidate the original job claim needed to withdraw it.

## Installed command workflow

Each command opens the same customer state, completes its local operation and closes it. Capture the current catalog into a new file:

~~~sh
starforge job-workspace request-catalog \
  --state /srv/starforge/customer-jobs \
  --origin https://jobs.example.com \
  --out /srv/starforge/request-inputs/catalog.json
~~~

Write the selected input as a JSON object, then save a draft:

~~~sh
starforge job-workspace request-draft \
  --state /srv/starforge/customer-jobs \
  --catalog-file /srv/starforge/request-inputs/catalog.json \
  --function analyze \
  --input /srv/starforge/request-inputs/series.json \
  --reference demand:2026.10 \
  --label "October demand report"
~~~

Use --origin instead of --catalog-file to discover the catalog during draft creation. If required, add --intake-key-file /absolute/private-key.txt; on Unix that regular file must have private permissions.

The draft response includes request.id and revision. Use those actual values to prepare:

~~~sh
starforge job-workspace request-prepare \
  --state /srv/starforge/customer-jobs \
  --request REQUEST_ID \
  --expected-revision CURRENT_REVISION \
  --operator-workspace /srv/starforge/operator
~~~

This command waits for its preparation/import task and prints the retained result. Subsequent revisions come from request-show, rather than a fixed number copied from an earlier response.

| Command | Required or useful options |
| --- | --- |
| request-list | --query, --phase, --offset, --limit |
| request-show | --request |
| request-import | --request, --expected-revision; original operator/runtime selection if needed |
| request-access | --request, --expected-revision, --intake-key-file |
| request-withdraw | --request, --expected-revision, --reason |
| request-ticket | --request, --out |

request-ticket writes the original private handoff to a new file and prints its path, byte count and SHA256. Keep that capability file with the original buyer. Existing output files are preserved.

Use the ordinary checkout-review, checkout-execute and checkout-recover commands with the linked checkout ID to continue the paid operation. Use the ordinary refresh, watch and fetch commands with the accepted job entry ID to receive and consume the output.

## JavaScript and application integration

The installed typed entry remains @tokenjunkielabs/starforge-merchant/buyer/job-workspace:

~~~js
import { openJobWorkspace } from '@tokenjunkielabs/starforge-merchant/buyer/job-workspace';

const workspace = await openJobWorkspace({
  directory: '/srv/starforge/customer-jobs',
  checkout: { operatorWorkspace: '/srv/starforge/operator' },
});
try {
  const catalog = await workspace.intake.discover({ origin: 'https://jobs.example.com' });
  const draft = await workspace.intake.draft({
    catalog,
    functionId: 'analyze',
    input: { values: [2, 4, 6, 8], window: 2 },
    reference: 'demand:2026.10',
    label: 'October demand report',
  });
  await workspace.intake.start(draft.request.id, {
    kind: 'prepare',
    expectedRevision: draft.request.revision,
  });
  const request = await workspace.intake.wait(draft.request.id);
  console.log(request.phase, request.checkoutId);
} finally {
  await workspace.close();
}
~~~

The intake controller borrows the original parent lease and checkout. Its requests live under the private workspace's requests directory; original accepted files remain in their existing intake directory. The owning model drains request work before closing checkout, library and lease. The owning HTTP host applies the same ordering when it closes.

Status and ordinary request reads expose summaries and digests. ticket(id) is the explicit API for the private handoff. get(id) also returns the selected function, saved input and recent history. setAccess updates the retained merchant access key with a revision guard.

The standalone openJobIntake and jobIntakeExtension exports are available for an existing application that already owns the original lease and checkout. The usual openJobWorkspace entry wires all of these lifecycles together.
