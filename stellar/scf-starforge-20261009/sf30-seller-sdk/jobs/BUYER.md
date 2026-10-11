# Retrieve a paid application job

`buyer.mjs` follows an accepted application job from its saved HTTP 202 response to the completed output file. It retains the original purchase response, observes the same job after restarts, and publishes the result only after its byte count and SHA-256 match the completed merchant record.

The original SF30 purchase remains the entry point. Its response identifies the job; the original SF98 settlement activates execution. This client uses the resulting job identity and private capability for status and output retrieval.

## Retain the accepted purchase

Keep the private handoff returned by the merchant's create operation and the actual saved response from the original paid POST. The handoff supplies the claim token and anticipated job identity. The response supplies the accepted job body. Both must refer to the same job, function, input hash, and URLs.

Run these commands from `stellar/scf-starforge-20261009/sf30-seller-sdk`. All state and output paths are absolute:

```sh
node jobs/buyer.mjs retain \
  --state /srv/buyer/jobs/monthly-report \
  --acceptance-file /srv/buyer/operations/monthly-report/accepted.json \
  --handoff-file /srv/buyer/handoffs/monthly-report.json
```

An existing token file can replace `--handoff-file`: use `--claim-token-file /srv/buyer/handoffs/monthly-report.token`. The file contains the token and an optional final newline. Retention creates the buyer state directory with mode `0700` and its files with mode `0600`; the token stays in that private state. Repeating retention with the same accepted bytes and token reopens the existing state.

The handoff alone is preparatory. `retain` also requires the saved accepted response. Keep the state directory and the original operation together when moving a running customer to another host.

## Check progress and retrieve the output

```sh
node jobs/buyer.mjs inspect --state /srv/buyer/jobs/monthly-report

node jobs/buyer.mjs wait \
  --state /srv/buyer/jobs/monthly-report \
  --deadline-ms 900000 \
  --poll-ms 2000

node jobs/buyer.mjs fetch \
  --state /srv/buyer/jobs/monthly-report \
  --out /srv/buyer/results/monthly-report.json \
  --deadline-ms 300000
```

`inspect` returns one authenticated status observation. `wait` observes progress until `COMPLETED`, a terminal application state, cancellation, or its deadline. `fetch` retrieves a completed output. Its parent directory must already exist. Commands emit JSON containing job/status/delivery metadata, with the claim token omitted.

| Merchant state | Customer behavior |
| --- | --- |
| `PREPARED`, `AWAITING_SETTLEMENT` | Keep observing the same job while the merchant finishes admission or native settlement recovery. |
| `QUEUED`, `RUNNING`, `CANCELLING` | Continue progress observations. |
| `COMPLETED` | Stream and verify the immutable result, then publish the requested output file. |
| `FAILED`, `INTERRUPTED`, `CANCELLED` | Return the application state and recorded error. After the merchant explicitly retries or recovers the same paid job, reopen this buyer state and observe it again. |

Deadline values are elapsed budgets in milliseconds, not Unix timestamps. `inspect` defaults to 30 seconds; `wait` and `fetch` default to five minutes. The accepted range is 1 millisecond through 24 hours. Polling defaults to one second and accepts 100–30,000 milliseconds.

## Use the original SF88 operation from Node

An original `Operation.recover()` returns its retained `BuyerResult`. Pass that result directly to preserve its original native record and verified acceptance bytes:

```js
import { createJobBuyer, openJobBuyer } from './jobs/buyer.mjs';

export async function retrieveAcceptedReport(originalOperation, handoff) {
  const result = await originalOperation.recover();
  const buyer = await createJobBuyer({
    directory: '/srv/buyer/jobs/monthly-report',
    result,
    handoff,
  });

  const controller = new AbortController();
  // Connect controller.abort() to the application's existing cancellation control.
  await buyer.wait({ signal: controller.signal, deadlineMs: 900000, pollMs: 2000 });
  const delivery = await buyer.download({
    destination: '/srv/buyer/results/monthly-report.json',
    signal: controller.signal,
    deadlineMs: 300000,
  });
  return { delivery, receipt: await buyer.receipt() };
}

// A later process resumes from the retained purchase:
const resumed = await openJobBuyer({ directory: '/srv/buyer/jobs/monthly-report' });
const progress = await resumed.inspect();
```

`createJobBuyer` accepts exactly one acceptance source: `result` or `acceptanceFile`. It accepts either the private `handoff` object or `claimToken`. Native result imports require the original saved HTTP 202 delivery reported as settled; the result's saved-byte reader performs its own integrity checks. File imports retain the exact supplied bytes and record their source path.

`createJobBuyer` and `openJobBuyer` return a handle exposing `jobId`, `acceptance`, `directory`, `inspect(options)`, `wait(options)`, `download(options)`, and `receipt()`. The receipt is an offline summary of the accepted purchase, last observed status, and delivery metadata. `runJobBuyerCommand(argv)` exposes the same CLI operations to an embedding command.

## Restart, cancellation, and file behavior

Reopen the same state directory after a process restart. The saved job ID, input SHA-256, original response, and capability remain bound together. Every follow-up request is a GET to the exact saved status or result URL.

Cancellation or a deadline during a transfer removes that transfer's temporary file. Run `fetch` again for the same job to retrieve its final output. The first protocol version transfers the complete result on each attempt; its result limit is 64 MiB.

The completed result is written to a private temporary file beside the destination, checked for exact bytes, digest, response hash, ETag, and content type, then published with create-only filesystem linking. An unrelated existing file produces `JOB_DESTINATION_EXISTS` and remains intact. An existing file matching the completed result is verified and reused. When completed status has already been retained, this reuse works offline and also repairs a missing delivery record after a crash between file publication and metadata persistence.

`delivery.json` binds the final path and content hash to the original acceptance, job, input hash, native settlement event, and completion revision. `acceptance.json` retains the original response bytes; `purchase.json` retains their source and, for a native import, the original SF88 result record. `status.json` retains the latest validated progress observation. `buyer.json` contains the private capability and the hashes binding the retained purchase files.

## Transport and embedding

The default network path is the original SF31 `createPublicHttpsFetch`. Status and result requests send `x-sfjobs-token` and use manual redirect handling. The client binds both URLs to the same HTTPS origin and job path retained at purchase time.

For an existing explicit CONNECT setup, pass its original SF31 profile as `transport` to `createJobBuyer` or `openJobBuyer`, or provide `--transport-file /absolute/profile.json` to the CLI. A profile selects its exact origin and either a proxy URL or an environment variable reference. Transport settings are supplied by the calling application and are not read from the merchant acceptance. An API caller can set `requestTimeoutMs` from 1 through 300,000; the default per-request timeout is 60 seconds.

A trusted embedding can supply `fetchImpl(url, init)` for its existing transport or an original native local journey. It must honor the passed AbortSignal and manual redirects and return a standard streamed Response. This hook is a constructor argument; it is never loaded from saved merchant data.

## Error handling

API failures use `JobBuyerError` with a stable `code`; `toJSON()` supplies the safe fields used by the CLI. Application terminal errors include the job/state and the recorded application error code. HTTP failures include the response status. A follow-up 402 yields `JOB_FOLLOW_UP_PAYMENT_REQUESTED`; redirects yield `JOB_BUYER_REDIRECT_REFUSED`.

`JOB_BUYER_ABORTED` and `JOB_BUYER_DEADLINE_EXCEEDED` preserve the retained job for another attempt. `JOB_DELIVERY_RECORD_WRITE_FAILED` includes the destination and `destinationPublished: true`; reopening and fetching that same path verifies the completed file and records its delivery.
