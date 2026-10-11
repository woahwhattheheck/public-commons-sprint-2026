# Durable purchased application jobs

A merchant can sell a report, export, or other long-running application function through the existing SF30 seller. The original paid POST returns a job ticket after settlement. The buyer can then inspect progress and retrieve the retained result through the customer endpoint. The merchant workspace prepares jobs, runs workers, handles cancellation and explicit retries, and retains the input, payment association, execution attempts, and complete output.

[INSTALL.md](./INSTALL.md) covers installed commands, the four service ports, HTTPS routing, and the customer handoff. [BUYER.md](./BUYER.md) covers retaining the actual native purchase response and downloading its result.

## Use the original payment path

`config.mjs` compiles each configured function into an original SF30 route. Original SF89 admission validates both the complete prepared input and the subsequent job purchase request. The purchased request carries exactly `{ "jobId": "..." }`, the prepared claim capability in `x-sfjobs-token`, and the same identifier in `x-sf98-order-id` and the approved URL's `sf98_order` query. The purchase handoff also supplies orderReference for original SF88 preparation.

The route handler durably records AWAITING_SETTLEMENT and returns a 202 ticket. Original SF30 then invokes its native settlement path. Original SF98 derives and journals the successful native settlement event. The job model matches that event to the prepared job, route, method, amount, network, asset, and recipient before it becomes QUEUED. The worker executes the configured application only after this association exists.

Each function has one complete payment option. The job fixes its function, canonical input digest, configured application digest, and selected payment terms at preparation. The model keeps the native event and the SF98 outbox in the same private merchant directory. Opening the model and the explicit reconcile action read that original outbox to recover an interrupted activation.

A failed or interrupted settlement can leave the job AWAITING_SETTLEMENT. Inspect the original seller operations and reconcile its original native journal before deciding how to handle the purchase. Repeating a paid POST does not automatically purchase or execute the job again.

## Application contract

The provided [example-merchant.json](./example-merchant.json), [example-application.mjs](./example-application.mjs), and [example-input.json](./example-input.json) implement descriptive statistics and a numeric-series CSV export. Copy these three files together. Configure the actual public origin, Stellar asset, recipient, and price before starting a native seller. The example asset and recipient strings explicitly identify values that need merchant configuration.

The module exports the configured function names:

```js
export async function analyze(input, { jobId, attemptId, signal }) {
  signal.throwIfAborted();
  return { count: input.values.length };
}
```

JSON functions return a JSON value. Byte functions return a string or Uint8Array. Configure each function's timeout, maximum input and output bytes, output content type, and fixed download filename. Output is limited to 64 MiB. The input schema is an object schema with explicit properties and `additionalProperties: false`.

A job runs in its own native Node Worker with its application module digest checked immediately before import. The worker receives only the environment variable names listed in the merchant configuration. Those variables are supplied by the operator's process; their values are not placed in the configuration or job handoff. Imported application dependencies remain part of the operator's deployment.

The application receives an AbortSignal. Cancellation first signals the running function, then retires its Worker if it does not stop. Timeouts also retire the Worker, and success waits for retirement before the retained attempt completes. Use the stable jobId to make any application side effect idempotent across explicit retries; attemptId identifies one execution. A Worker provides a separate lifetime and resource controls for trusted merchant code.

## Embed one merchant model

```js
import { openJobMerchant } from './model.mjs';
import { startJobSeller } from './merchant.mjs';
import { startCustomerServer } from './customer.mjs';
import { startJobsWorkspace } from './workspace/server.mjs';
import nativeFactory from './native-runtime.example.mjs';

const model = await openJobMerchant({
  configPath: '/srv/jobs/merchant.json',
  directory: '/srv/jobs/state',
});
const seller = await startJobSeller(model, {
  port: 8423, operationsPort: 8465, nativeFactory,
});
const customer = await startCustomerServer({ model, port: 8477 });
const workspace = await startJobsWorkspace({ model, port: 8478 });
await model.startWorker();

// During shutdown, close the HTTP services before closing their shared model.
try {
  await Promise.all([seller.close(), customer.close(), workspace.close()]);
} finally {
  await model.close();
}
```

The state directory must be absolute and private. The original Linux fleet lease gives one process ownership. The seller, customer server, operator workspace, and worker share that process and model. The installed CLI performs the lifecycle management; stop its serve process before opening the same state directory from a separate offline CLI command.

| Model method | Result or action |
| --- | --- |
| `createJob({functionId,input,label,reference,claimToken})` | Private handoff with job identity, claim token, original purchase request and expected ticket |
| `snapshot()`, `get(id)` | Operator state, configured functions, attempts, settlement association and history |
| `startWorker()` | Reconcile and execute paid queued jobs up to configured concurrency |
| `stopWorker({cancelRunning})` | Stop scheduling, optionally interrupt running jobs, and wait for actual worker retirement |
| `cancel({id,expectedRevision,reason})` | Cancel pending work or signal its active Worker |
| `retry({id,expectedRevision,reason})` | Queue an already-paid failed, interrupted or cancelled job for a new attempt |
| `reconcile()` | Apply matching original SF98 events to retained jobs |
| `result(id)` | Read and verify the complete retained output bytes |

The optional reference is the merchant's stable job identifier. Reusing it requires the original claim token and the same function and input. The token is returned in the private handoff and retained as a hash in merchant state. The operator should preserve the handoff when preparing the customer's purchase.

## Customer contract and recovery

The actual 202 acceptance has schema `stellar-forge.job-accepted.v1`, jobId, functionId, inputSha256, state, statusUrl and resultUrl. Its AWAITING_SETTLEMENT state describes the durable staging point; the customer status endpoint reports current progress. Retain the actual original purchase result with the private handoff using the buyer client.

Route HTTPS `/jobs/*` to the loopback customer server. A customer authenticates GET or HEAD with `x-sfjobs-token`. Status includes the job state, minimal native settlement identity, and complete result metadata when available. Result responses carry their exact Content-Length, Content-Type, quoted SHA-256 ETag and X-Content-SHA256. Results are downloaded as whole immutable artifacts; subsequent downloads remain available for the same job.

The state sequence is PREPARED, AWAITING_SETTLEMENT, QUEUED, RUNNING, then COMPLETED or FAILED. Active cancellation passes through CANCELLING to CANCELLED. Reopening a process records unfinished execution as INTERRUPTED; an operator can explicitly retry the same paid job with a revision and reason. Paid QUEUED jobs survive reopening and resume when the worker starts.

Complete output bytes are synced before their immutable digest filename is published. Startup recovers a remaining private temporary link under the original directory lease. Reading a result verifies its digest and byte length. Retained configuration and application source snapshots identify the source that admitted the job, and a changed source configuration requires its own state directory.

## Source seams

- [Original SF30 seller launcher](../serve.mjs) and [native factory](../native-factory.mjs)
- [Original SF89 request admission](../../sf89-live-request-admission/index.mjs)
- [Original SF98 native settlement outbox](../../sf98-merchant-delivery/outbox.mjs)
- [Original fleet directory lease](../../merchant-fleet-gateway/state-lease.mjs)
- [Native Node Worker lifecycle](https://nodejs.org/api/worker_threads.html)

`execution.mjs` exports `executeJob(source,row,attempt,{env,signal}) -> Promise<Buffer>` for other trusted application workflows. The source supplies compiled function output limits, timeout, environment references and memory limit, together with the application path and SHA-256. The row supplies id, functionId and input; the attempt supplies id. A caller using its own quota or subscription admission keeps that admission and durable execution record in its own domain.
