# n8n automation merchant

Sell a selected n8n automation through the original Stellar Forge paid-job flow. The merchant prepares a job and its private customer handoff, the original SF30 seller processes the purchase, and the original SF98 settlement event admits that job to its worker. The worker dispatches the configured production n8n webhook, follows the original execution ID, and retains the selected JSON output for the customer.

The browser workspace provides preparation, job monitoring, native settlement details, execution recovery, result downloads, and private state export. The command line and JavaScript API use the same merchant, original job model, and dispatch records.

## Included files and native runtime

| File | Purpose |
| --- | --- |
| [example-merchant.json](example-merchant.json) | One invoice-summary automation, its input schema, selected result fields, execution limits, and payment configuration markers. |
| [example-input.json](example-input.json) | Example invoice lines and integer minor-unit amounts. |
| [example-child-workflow.json](example-child-workflow.json) | Importable native child workflow: Execute Workflow Trigger followed by Code version 2. |
| [cli.mjs](cli.mjs) | Configuration review, wrapper export, merchant preparation, service ownership, and recovery. |
| [index.mjs](index.mjs), [index.d.ts](index.d.ts) | Public JavaScript API and declarations. |
| [workspace/public](workspace/public) | Responsive grayscale merchant operator UI. |

The native integration target is **n8n 2.42.6 with Node 24.19**. The child uses the original `n8n-nodes-base.executeWorkflowTrigger` version 1.1 with `inputSource: "passthrough"` and `n8n-nodes-base.code` version 2 with `mode: "runOnceForAllItems"`. The generated wrapper uses the native Webhook, Respond to Webhook, Code, and Execute Workflow nodes.

Run the merchant from its complete original source/runtime on Linux with Node, Python 3, and `flock`. The existing paid-job schema and native payment dependencies must be available in that runtime; [the maintained job installation guide](../jobs/INSTALL.md) covers those dependencies and the original installer. Keep the adjacent source tree intact so the generated application can import its selected runtime. The commands below use the actual source entrypoint, `node n8n/cli.mjs`.

The example is invoice arithmetic with explicit sample input. Configure the actual payment asset, recipient, amount, public origin, n8n API address, webhook address, and workflow IDs for a merchant deployment.

## 1. Select the source and private application paths

Set `SF_MERCHANT_SOURCE` to the retained `sf30-seller-sdk` directory in the original runtime. Use application and state paths owned by the service account:

```sh
SF_MERCHANT_SOURCE=/srv/starforge/runtime/package/source/stellar/scf-starforge-20261009/sf30-seller-sdk
SF_N8N_APP=/srv/starforge/applications/invoice-automation
SF_N8N_STATE=/srv/starforge/workspaces/invoice-automation
SF_N8N_HANDOFFS=/srv/starforge/handoffs

umask 077
install -d -m 700 "$SF_N8N_APP" /srv/starforge/workspaces "$SF_N8N_HANDOFFS"

cp "$SF_MERCHANT_SOURCE/n8n/example-merchant.json" "$SF_N8N_APP/merchant.json"
cp "$SF_MERCHANT_SOURCE/n8n/example-input.json" "$SF_N8N_APP/input.json"
cp "$SF_MERCHANT_SOURCE/n8n/example-child-workflow.json" "$SF_N8N_APP/child-workflow.json"
```

Preparation creates `SF_N8N_STATE` itself. Its parent must already exist at its canonical absolute path, and the destination must be new. Choose new application paths when retaining a separate merchant.

## 2. Import the child and configure the n8n connection

Import `child-workflow.json` into the selected n8n instance and save the child. Record its actual workflow ID. Its **When Executed by Another Workflow** trigger accepts all data and passes one original invoice object to **Summarize Invoice**.

Create an n8n Header Auth credential with header name `x-starforge-webhook-token`. Supply the same credential value to the merchant process through `SF_N8N_WEBHOOK_TOKEN`. Create an API key for the n8n account/project that can read the selected executions and provide it through `SF_N8N_API_KEY`. Use the existing service environment or secret store for both values.

Edit `merchant.json`:

| Setting | Required selection |
| --- | --- |
| `publicOrigin` | The actual merchant HTTPS origin, with no path, query, or fragment. |
| `n8n.apiBaseUrl` | The selected n8n API base ending in `/api/v1`. |
| `n8n.apiKeyEnvironment` | Environment variable containing the native API key; the example uses `SF_N8N_API_KEY`. |
| `automations.invoiceSummary.webhookUrl` | The production webhook address for the wrapper to be created, such as `https://your-n8n-host/webhook/starforge-invoice-summary`. |
| `webhookHeader` | The header name and environment reference matching the n8n Header Auth credential. |
| `payment` | The original seller's configured Stellar network, asset, recipient, atomic price, and payment timeout. |
| `inputSchema` and `example` | The complete input contract presented before purchase. |
| `webhookNode` and `resultNode` | The original saved node names used to bind input and select output. Keep the example names when using the generated wrapper. |

The sample `workflowId` marker can remain while exporting the wrapper. Replace it with the wrapper's actual native ID before preparing the merchant.

The API and webhook addresses accept HTTPS, or HTTP on `127.0.0.1`, `localhost`, or `[::1]` for a local deployment. Their URLs carry no username, password, query, or fragment. The merchant rejects `webhook-test` URLs. API credentials are used for execution reads; the separate configured webhook credential authenticates the production dispatch.

## 3. Generate and publish the production wrapper

Use the child workflow ID and the n8n Header Auth credential ID from the original instance:

```sh
node "$SF_MERCHANT_SOURCE/n8n/cli.mjs" workflow \
  --input "$SF_N8N_APP/merchant.json" \
  --function invoiceSummary \
  --child-workflow REPLACE_WITH_CHILD_WORKFLOW_ID \
  --header-credential REPLACE_WITH_HEADER_CREDENTIAL_ID \
  --header-credential-name "Starforge merchant webhook" \
  --out "$SF_N8N_APP/invoice-wrapper.json"
```

Choose an output file that does not already exist. Import the generated wrapper into n8n, confirm its selected child and Header Auth credential, and publish/activate its production webhook. Allow the wrapper to call the child through n8n's existing workflow caller and sharing settings.

The wrapper performs this sequence:

1. **Starforge Request** receives the original dispatch envelope through the production Webhook.
2. **Starforge Accepted** returns HTTP 202 immediately with the actual n8n workflow and execution IDs and the echoed dispatch identity.
3. **Starforge Input** extracts the original prepared input object.
4. **Run selected automation** invokes the selected child and waits for its result.
5. **Starforge Public Result** projects the explicitly configured public fields.

Put the wrapper's actual workflow ID and exact production webhook URL into `merchant.json`. The `workflowId` belongs to this wrapper; `--child-workflow` selects the workflow the wrapper calls.

The exported settings retain successful and failed execution data and execution progress. Keep the original Webhook input and final result node available through `GET /api/v1/executions/<executionId>?includeData=true` for the full job recovery period. The merchant verifies the saved input against the original dispatch before associating an execution or retaining a terminal result.

Future dispatches execute n8n's published version of the selected wrapper and child. Manage publication changes through the existing automation deployment process.

## 4. Review and prepare the merchant

```sh
node "$SF_MERCHANT_SOURCE/n8n/cli.mjs" review \
  --input "$SF_N8N_APP/merchant.json"

node "$SF_MERCHANT_SOURCE/n8n/cli.mjs" prepare \
  --input "$SF_N8N_APP/merchant.json" \
  --directory "$SF_N8N_STATE"

node "$SF_MERCHANT_SOURCE/n8n/cli.mjs" inspect \
  --directory "$SF_N8N_STATE"
```

`review` compiles the selected automation and original paid-job configuration. `prepare` writes the private original input, compiled merchant declaration, generated application, runtime source identities, and prepared record. `inspect` reads these identities and reports environment reference availability.

The prepared source fixes the merchant's job contract and runtime paths. Retain that source with the state, and restore it at the same canonical paths. Use a new prepared merchant for changed source or job configuration; finish or recover existing jobs through their original prepared merchant.

## 5. Serve the original seller, worker, and workspaces

Provide `SF_N8N_API_KEY` and `SF_N8N_WEBHOOK_TOKEN` in the service environment. For native paid operation, use the merchant's configured original native factory. The adjacent [native-runtime.example.mjs](../jobs/native-runtime.example.mjs) composes the original SF30 factory with `HTTPFacilitatorClient` and reads `SF_JOBS_FACILITATOR_URL` from the environment.

```sh
node "$SF_MERCHANT_SOURCE/n8n/cli.mjs" serve \
  --directory "$SF_N8N_STATE" \
  --native-factory "$SF_MERCHANT_SOURCE/jobs/native-runtime.example.mjs" \
  --seller-port 8423 \
  --customer-port 8477 \
  --operator-port 8480 \
  --operations-port 8479 \
  --jobs-operator-port 8478 \
  --start-worker
```

Set `SF_JOBS_FACILITATOR_URL` to the existing merchant facilitator's HTTPS endpoint when selecting that factory. A custom `--native-factory` module exports `nativeFactory` or its default function, which receives the original compiled seller and returns the original native SDK server.

The foreground process owns the original paid-job directory, seller, settlement journal, workers, customer endpoint, and both operator consoles. The n8n console's complete private launch URL is printed as `operator`. Its fragment capability is consumed into the current tab's session storage and stripped from the displayed URL.

Use the running browser workspace for live operations. Offline CLI commands that open the job model use the same directory lease; close the owning service before running those commands and restart it afterward. `SIGINT` or `SIGTERM` closes the service and retains interrupted local job state for recovery.

### Public and private routes

| Address | Destination and use |
| --- | --- |
| Configured public `/invoice-summary` route | Original seller at `127.0.0.1:8423`. |
| Public `/jobs/<jobId>` and `/jobs/<jobId>/result` | Original customer service at `127.0.0.1:8477`. |
| Printed `operator` URL | n8n merchant workspace at the private operator port. |
| Printed `jobsOperator` URL | Original paid-job operator workspace. |
| Printed `operations` URL | Original seller operations. |

Terminate the configured HTTPS public origin at the existing proxy. Preserve the paid request's method, query, body, payment headers, order header, and claim header. For customer requests, preserve the configured public host or use the exact loopback upstream host/port; forward the customer capability once. [The original routing guide](../jobs/INSTALL.md#route-the-public-origin) defines the customer host and origin behavior.

## 6. Prepare the customer's job and perform the original purchase

In the n8n workspace, choose **invoiceSummary**, enter the input and a useful label/reference, and select **Prepare job & download handoff**. The merchant validates and retains the complete input before purchase. The downloaded `stellar-forge.job-handoff.v1` contains the original job, private claim capability, purchase request, and expected acceptance identity.

For offline preparation while the service lease is available:

```sh
node "$SF_MERCHANT_SOURCE/n8n/cli.mjs" jobs \
  --directory "$SF_N8N_STATE" -- create \
  --function invoiceSummary \
  --input "$SF_N8N_APP/input.json" \
  --label "Example invoice summary" \
  --reference invoice-example-001 \
  --out "$SF_N8N_HANDOFFS/invoice-example-001.json"
```

Start the owning service with the same prepared directory before the buyer purchases. Give the private handoff to the intended customer through the existing delivery route.

The original paid request uses:

- `handoff.purchase.url`, including its exact `sf98_order` query.
- POST body `{"jobId":"<original-job-id>"}`.
- `x-sf98-order-id` and `x-sfjobs-token` from the handoff.
- The same `handoff.purchase.orderReference` in original SF88 buyer preparation.
- The configured original payment terms and signer/facilitator workflow.

The original route durably stages `AWAITING_SETTLEMENT` and returns its HTTP 202 acceptance. The original native settlement path produces the SF98 event. The job model matches that event's order, route, method, network, asset, amount, and recipient before moving the job to `QUEUED`. Only this settled job reaches the application worker and n8n.

An embedding using an already configured original [SF88 Buyer](../../sf88-operator-buyer-cli/node/README.md) can retain the actual purchase and retrieve its result as follows. This module example uses imports relative to this directory:

```js
import { createJobBuyer } from '../jobs/buyer.mjs';

export async function purchaseAutomation(originalBuyer, handoff, {
  customerDirectory, destination,
}) {
  const payment = handoff.purchase.payment;
  const operation = await originalBuyer.fromRequest({
    intentId: 'automation:' + handoff.job.id,
    url: handoff.purchase.url,
    method: 'POST',
    orderReference: handoff.purchase.orderReference,
    headers: { 'content-type': 'application/json', ...handoff.purchase.headers },
    body: JSON.stringify(handoff.purchase.body),
    expect: {
      scheme: payment.scheme, network: payment.network,
      asset: payment.asset, payTo: payment.payTo,
      maxAtomic: payment.amount,
      maxTimeoutSeconds: payment.maxTimeoutSeconds,
    },
  }, { responseFile: { maxBytes: 65536, timeoutMs: 30000 } });

  const review = await operation.review();
  const result = await operation.execute({ review });
  result.raiseForStatus();

  const customer = await createJobBuyer({
    directory: customerDirectory,
    result,
    handoff,
  });
  await customer.wait({ deadlineMs: 900000, pollMs: 2000 });
  const delivery = await customer.download({
    destination,
    deadlineMs: 120000,
  });
  return { delivery, receipt: await customer.receipt() };
}
```

`createJobBuyer` retains the actual original native purchase result and its private handoff. It checks the original 202 acceptance and follows its saved HTTPS status/result URLs. The existing original buyer's operator, signer, and payment configuration remain the purchase authority.

For customers who retain the actual response as an acceptance file, the original buyer CLI provides the equivalent continuation:

```sh
node "$SF_MERCHANT_SOURCE/jobs/buyer.mjs" retain \
  --state /srv/starforge/customer-jobs/invoice-example-001 \
  --acceptance-file /srv/starforge/customer-inbox/invoice-example-001-accepted.json \
  --handoff-file /srv/starforge/customer-inbox/invoice-example-001-handoff.json

node "$SF_MERCHANT_SOURCE/jobs/buyer.mjs" wait \
  --state /srv/starforge/customer-jobs/invoice-example-001 \
  --deadline-ms 900000 --poll-ms 2000

node "$SF_MERCHANT_SOURCE/jobs/buyer.mjs" fetch \
  --state /srv/starforge/customer-jobs/invoice-example-001 \
  --out /srv/starforge/customer-results/invoice-example-001.json \
  --deadline-ms 120000
```

Create the private customer parent directories first. Preserve the buyer state and final file together. The customer retrieves the original completed bytes with their native length, content type, ETag, and SHA-256 association. [The buyer guide](../jobs/BUYER.md) covers reopening an accepted job and the original explicit CONNECT transport.

## Invoice example contract

All monetary input and output values are **integer minor units** for the supplied currency label. The child accepts 1–200 lines, whole-unit quantities from 1–10,000, nonnegative safe-integer unit prices, an optional fixed discount, and an optional tax rate from 0–10,000 basis points. The discount and tax rate default to zero.

The calculation is:

```text
lineTotalMinor = quantity × unitPriceMinor
subtotalMinor = sum of line totals
taxableMinor = subtotalMinor − discountMinor
taxMinor = floor((taxableMinor × taxBasisPoints + 5000) / 10000)
totalMinor = taxableMinor + taxMinor
```

Tax is computed once at the invoice level after discount and rounded half up to the nearest minor unit. The child uses BigInt intermediates and converts the final public values to JSON numbers only after checking their safe-integer bounds. It rejects a discount above subtotal, invalid lines, and overflowing public totals.

For the included input:

| Field | Expected value |
| --- | ---: |
| First line total | 37,500 |
| Second line total | 9,000 |
| `lineCount` / `totalQuantity` | 2 / 5 |
| `subtotalMinor` | 46,500 |
| `discountMinor` | 1,500 |
| `taxableMinor` | 45,000 |
| `taxBasisPoints` | 750 |
| `taxMinor` | 3,375 |
| `totalMinor` | 48,375 |

The output includes invoice ID, currency label, each original line with its calculated total, the totals above, and `rounding: "invoice-tax-half-up"`. Select a business-specific child when the required invoicing rules differ from this declared example calculation.

## Native workflow and output contract

The dispatched JSON envelope has schema `stellar-forge.n8n-dispatch.v1` and contains `jobId`, `functionId`, `dispatchId`, `attemptId`, `inputSha256`, `configurationSha256`, and the original `input` object. The merchant also sends the dispatch ID as `Idempotency-Key` and includes the original job/dispatch headers.

The native HTTP 202 acknowledgment has schema `stellar-forge.n8n-accepted.v1`. It echoes those six identity/hash fields and supplies the actual `workflowId` and `executionId`. The native wrapper's response uses `$workflow.id` and `$execution.id`.

The worker retains dispatch intent before sending the webhook. Ordinary local retries use the existing dispatch and execution ID. n8n's original saved Webhook body must match the entire original envelope, and the execution must belong to the configured workflow in production webhook mode.

`resultFields` selects literal top-level JSON field names from the configured result node's original first output. Use `resultMode: "single"` for exactly one original item, or `"items"` for an array. The original input, workflow identity, selected output fields, item limit, and byte limit all participate in retaining the customer result. The local dispatch journal retains the projected result and execution observation; n8n retains its complete original execution data.

## Monitoring and recovery

The UI displays local job state, n8n dispatch state, and native settlement separately. A completed n8n result becomes available to the customer when the original local job has retained it as `COMPLETED`.

| Retained state | Operator operation |
| --- | --- |
| Unsubmitted `PREPARED` job with a lost handoff | **Renew & download purchase handoff**, using the current job revision and a reason. |
| `AWAITING_SETTLEMENT` | Inspect the original seller operations and reconcile the original native settlement journal. |
| Local `FAILED`, `INTERRUPTED`, or `CANCELLED` with a `READY` dispatch | Correct the reported local configuration problem and **Retry local job**. |
| Local stopped job with an existing `PENDING` execution | **Resume local monitoring** for the same execution. |
| `DISPATCHING` or `UNRESOLVED` after a lost acknowledgment | Find the original execution in n8n, enter that exact execution ID and reason, and **Verify & associate original execution**. |
| Original `SUCCEEDED` dispatch with a stopped local job | **Finish local job from retained result**. |
| Original `FAILED` execution | **Recheck & authorize new workflow run**, with current dispatch/job revisions and a reason. |
| `REJECTED` dispatch from webhook HTTP 401, 403, or 404 | Correct the native connection/rejection, then **Authorize new workflow run** for the same paid job. |
| Retained `nextPollAt` | Resume provider reads after that time. GET 429 cooldowns are shared by monitoring, association, and rerun rechecks. |

**Drain local worker** pauses new local work and lets current jobs finish. **Stop local job** stops the selected local attempt. An already-dispatched n8n workflow retains its own execution and continues under n8n. An active local attempt owns its dispatch lease; stop that local job before a manual execution association or reconciliation.

A local execution timeout also leaves the original remote execution available for reconciliation. Reopen the existing job, associate or recheck its original execution, and resume its monitor as appropriate.

Rerun authorization rechecks a previously failed execution through the original n8n API before recording a new dispatch. A successful recheck can expose a retained result for local completion. A new dispatch keeps the same job and its native settlement; the earlier dispatch and decision remain in history. If authorization was retained before a local queue change was interrupted, the latest `READY` dispatch can continue through the original paid job's local retry.

### Offline CLI recovery

Obtain current records while the merchant process is closed:

```sh
node "$SF_MERCHANT_SOURCE/n8n/cli.mjs" jobs \
  --directory "$SF_N8N_STATE" -- show --id invoice-example-001
```

The live n8n UI and `merchant.get(id)` provide both job and dispatch revisions. `readDispatch` or `listDispatches` read retained dispatch records for an offline embedding. Replace the revision markers below with those observed integers.

```sh
node "$SF_MERCHANT_SOURCE/n8n/cli.mjs" reconcile \
  --directory "$SF_N8N_STATE" \
  --job invoice-example-001 \
  --revision CURRENT_DISPATCH_REVISION \
  --execution ORIGINAL_N8N_EXECUTION_ID \
  --reason "Recover the original execution after its acknowledgment was lost"

node "$SF_MERCHANT_SOURCE/n8n/cli.mjs" jobs \
  --directory "$SF_N8N_STATE" -- retry \
  --id invoice-example-001 \
  --revision CURRENT_JOB_REVISION \
  --reason "Resume the associated original execution"

node "$SF_MERCHANT_SOURCE/n8n/cli.mjs" rerun \
  --directory "$SF_N8N_STATE" \
  --job invoice-example-001 \
  --revision CURRENT_DISPATCH_REVISION \
  --job-revision CURRENT_JOB_REVISION \
  --reason "Run the corrected automation after the original failed execution"
```

Omit `--execution` when reconciling the execution already associated with the dispatch. The `jobs` passthrough also exposes the original `status`, `renew-claim`, `cancel`, `result`, `reconcile`, and `work` commands; it supplies this merchant's configuration and job state automatically.

## Embedding and private operator API

`index.mjs` exports compilation, wrapper creation, preparation, inspection, merchant ownership, service launch, the browser workspace, dispatch readers, and the CLI entrypoint. `index.d.ts` describes the native job, dispatch, settlement, handoff, service, and recovery values.

```js
import { openN8nMerchant } from './index.mjs';

const merchant = await openN8nMerchant('/srv/starforge/workspaces/invoice-automation');
try {
  const ticket = await merchant.model.createJob({
    functionId: 'invoiceSummary',
    input: originalInvoiceInput,
    label: 'Invoice summary',
    reference: originalJobReference,
  });
  await retainPrivateHandoff(ticket);
  const records = await merchant.exportState();
  await retainPrivateRecords(records);
} finally {
  await merchant.close();
}
```

The application supplies `originalInvoiceInput`, `originalJobReference`, and its private retention functions. `serveN8nMerchant(options)` owns the original seller, customer service, both consoles, and their shared job model. Its returned `close()` completes their shutdown. `startN8nWorkspace({merchant})` borrows an existing owner and closes its own listener.

The loopback n8n console uses its printed fragment token as Bearer authorization. Requests carry exact paths and JSON bodies:

| Endpoint | Contract |
| --- | --- |
| `GET /api/state` | Configuration, environment reference availability, original job summaries, full dispatch records, service addresses. |
| `GET /api/jobs/:id` | Original full job and its dispatch record. |
| `POST /api/jobs` | `{functionId,input,label?,reference?}` → original private handoff. |
| `POST /api/jobs/:id/retry`, `/cancel`, `/renew-claim` | `{expectedRevision,reason}` using the original job revision. |
| `POST /api/jobs/:id/reconcile` | `{expectedRevision,executionId?,reason?}` using the dispatch revision; association requires a reason. |
| `POST /api/jobs/:id/authorize-rerun` | `{expectedRevision,jobRevision,reason}`. |
| `GET /api/jobs/:id/result` | Original completed result bytes and metadata headers. |
| `POST /api/worker/start` | Empty JSON object; starts the original local worker. |
| `POST /api/worker/stop` | Empty JSON object; initiates graceful local drain and returns current state. |
| `GET /api/export` | Full sanitized original job and dispatch records, configuration, source identities, and private service addresses. |

A stale revision returns a conflict and the operator refreshes the same original records. The UI preserves drafts, selections, and reasons while visible-page refresh updates state. Private export includes job input, attempts, histories, settlement records, and result metadata; download the original result separately for its complete bytes. Keep the exported records in the merchant's private operational storage.

## Native receiving on an existing n8n engine

Run the included receiving command from the same host as a current n8n engine. It uses the engine's native public API to import and publish the provided invoice child and generated wrapper, prepares this original merchant, runs its original SF30 application Worker, and verifies the real result and saved execution.

```sh
node "$SF_MERCHANT_SOURCE/n8n/examples/native-receiving.mjs" \
  --api-base http://127.0.0.1:5678/api/v1 \
  --api-key-file /srv/starforge/private/n8n-api-key \
  --directory /srv/starforge/receiving/invoice-automation-001
```

Select a new absolute directory under an existing canonical parent. The key is read from the named private file and requires the existing n8n account's workflow read/create/publish/unpublish and execution read permissions. The command uses the canonical `/publish` and `/unpublish` public endpoints and requires a same-host loopback engine because its temporary receiving wrapper uses no webhook credential.

The same operation creates the original private job through the authenticated operator API, verifies the invoice result against its declared integer-minor-unit calculation, retains both original native executions, closes and reopens the same merchant, and invokes another original Worker. Recovery must return identical retained bytes with unchanged dispatch and execution IDs. It also renews the original purchase handoff and exports the complete original job history. The original SF30 buyer and settlement operation remains the receiving path for paid customer delivery.

`native-receiving.json` records the actual phase, source identities, workflow/execution IDs, result hashes and outcome. The private directory also retains the exact imports, configuration, execution data, results and operator export. At completion the two workflows remain in the selected n8n instance, unpublished, with their original executions available. If a response is interrupted, reconcile the recorded workflow IDs and phase in that same directory before continuing.

## Execution limits and retained source

| Setting | Default | Supported range |
| --- | ---: | ---: |
| n8n request timeout | 30,000 ms | 1,000–90,000 ms |
| n8n poll interval | 2,000 ms | 250–60,000 ms |
| n8n execution response bytes | 16 MiB | 1 KiB–64 MiB |
| Local function timeout | 300,000 ms | 100–3,600,000 ms |
| Input bytes | 256 KiB | 1 byte–1 MiB |
| Output bytes | 8 MiB | 1 byte–64 MiB |
| Result items | 10,000 | 1–100,000 |
| Local workers | 2 | 1–16 |

The invoice configuration selects one result item and a 1 MiB output limit. HTTP redirects are rejected; use the final original API/webhook addresses. Provider execution bodies must remain available within the configured read limit. The original job retains up to 100 local attempts; each dispatch store retains up to 128 dispatches and 2,048 history events.

The implementation is in [config.mjs](config.mjs), [prepare.mjs](prepare.mjs), [client.mjs](client.mjs), [runtime.mjs](runtime.mjs), [merchant.mjs](merchant.mjs), and [store.mjs](store.mjs). The payment and customer lifecycle is defined by the original [job model](../jobs/model.mjs), [seller](../jobs/merchant.mjs), and [buyer](../jobs/buyer.mjs). The original [n8n 2.42.6 trigger source](https://github.com/n8n-io/n8n/blob/n8n%402.42.6/packages/nodes-base/nodes/ExecuteWorkflow/ExecuteWorkflowTrigger/ExecuteWorkflowTrigger.node.ts) defines the child trigger's passthrough behavior.

