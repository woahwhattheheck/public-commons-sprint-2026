# Consume an original paid SSE or NDJSON response in Node

The existing `Buyer` prepares one original SF88 operation, retains its complete
configuration and executes the native approval/signing/accounting path. Add
`responseFile.stream` to capture a finite event response. The same operation's
`BuyerResult` reads its saved records and reopens after a process restart.

The package uses the shared parser from the selected original runtime. Install
the package with its matching SCF runtime source, as described in [README](README.md).

## Prepare, execute and read

```js
import { Buyer } from '@stellar-forge/native-buyer';

const buyer = new Buyer({
  runtimeDirectory: '/absolute/installed/source/sf88-operator-buyer-cli',
  stateDirectory: '/absolute/private/customer',
  operatorProfile: '/absolute/private/operator-profile.json',
});

const operation = await buyer.fromRequest({
  intentId: 'forecast-events-2026-10-11',
  url: 'https://seller.example/forecast-events',
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ region: 'northeast' }),
  expect: {
    scheme: 'exact', network: 'stellar:testnet',
    asset: 'THE_SELECTED_TOKEN_CONTRACT', payTo: 'THE_SELECTED_MERCHANT_ACCOUNT',
    maxAtomic: '50000', paymentFlow: 'upfront',
  },
}, {
  requestTimeoutMs: 180000,
  responseFile: {
    maxBytes: 67108864, timeoutMs: 120000,
    stream: { format: 'sse', maxRecordBytes: 1048576, maxRecords: 100000 },
  },
});

const result = await operation.execute({ review: await operation.review(), signal });
result.raiseForStatus();
for await (const event of result.events()) {
  console.log(event.index, event.event, event.data, event.id);
}
```

Use the actual observed merchant URL, asset, recipient, amount and intended flow.
An absent payment flow still means `authorization`. The selected `upfront` flow
must also be configured in the original operator workspace signer; initialize the
workspace from the reviewed operation using the maintained workspace command.
The native terminal and existing budget policy handle its approval.

The reviewed `requestTimeoutMs` bounds each complete merchant HTTP exchange,
including DNS, TLS, provider generation, response headers and body consumption.
Its range is 1–300000 milliseconds. `responseFile.timeoutMs` separately bounds
capture after the response returns. An omitted request deadline defaults to the
selected stream timeout; ordinary requests default to 30000 milliseconds. The
`Buyer` constructor's existing `timeoutMs` bounds the whole native subprocess,
including operator interaction and accounting.

`responseFile` options also work with `fromConfig`, `fromOperationHandoff`,
`prepare`, and `call(request, options)`. The Node application chooses the fixed
`response.bin` inside its private operation directory. Local expected byte count,
content type and SHA-256 survive into the original native writer. Callers cannot
replace the application's destination through these options.

For generated seller clients, compose the same `call` interface:

```js
const applicationBuyer = {
  call: request => buyer.call(request, {
    responseFile: {
      timeoutMs: 120000,
      stream: { format: 'ndjson', maxRecords: 50000 },
    },
  }),
};
// Pass applicationBuyer as the existing generated client's buyer option.
```

The original response is captured as it arrives. `execute()` resolves after the
native operation and capture complete. For live record callbacks during a trusted
embedded SF31 request, use the original
[`prepareBuyerResponseFile().save(..., { onRecord })` API](../../sf31-buyer-client/STREAMING.md).
The Node process API exposes the retained result after its original subprocess
has completed.

## Read NDJSON and reopen the same operation

Choose `stream: { format: 'ndjson' }` for an NDJSON response:

```js
const reopened = await buyer.operation('inventory-stream-2026-10-11').recover();
if (!reopened) throw new Error('The original operation has no retained result yet');
reopened.raiseForStatus();
for await (const row of reopened.ndjson()) {
  await consumeRow(row);
}
```

`events()` yields standard SSE records. `ndjson<T>()` yields each parsed JSON
value. JSON numbers use JavaScript's normal numeric semantics; a merchant should
encode identifiers and precision-sensitive amounts as strings. The raw original
bytes and digest remain available through inherited `chunks()`, `bytes()`,
`verify()` and `saveAs()`.

These readers verify the complete retained file before yielding any record, and
check the bytes again during consumption. Exhaust the iterator before committing
whole-response side effects. Changing the saved file, an invalid media type,
malformed framing or an unfinished final record returns a concrete reader error.
Reading a result never starts the native buyer.

## Inspect the completed prefix of a failed capture

Cancellation uses the same `AbortSignal` already accepted by `execute()`. The
native writer retains its private partial bytes, their SHA-256, record count and
last complete frame boundary in the original summary. Reopen the operation and
opt into partial inspection:

```js
const original = await buyer.operation('forecast-events-2026-10-11').recover();
if (original?.delivery.status === 'FAILED' && original.stream) {
  for await (const event of original.events({ allowPartial: true })) {
    await inspectRetainedEvent(event);
  }
}
```

The reader verifies the entire recorded partial-file digest, then exposes only
the original `lastCompleteByte` prefix. Incomplete UTF-8, half a JSON record and
an undispatched SSE event remain outside that prefix. The native result retains
its failure and accounting state. Reuse the same intent and original recovery
record when addressing the interruption.

## Exa Answer merchant application

[`examples/exa-answer.mjs`](examples/exa-answer.mjs) is a runnable customer for
the original [Exa Answer merchant](../../sf30-seller-sdk/EXA_ANSWER.md). The route
is `exa-answer`, `POST /research/answer`, with the single public JSON field
`query`. The application imports the merchant's original generated client so its
URL, offered asset, recipient, network and timeout come from that retained seller
snapshot. Select your own atomic cap and actual offered option. Its native signer
workspace must select the same upfront flow before execution.

From the Node package directory, prepare the immutable operation and review it:

```sh
node examples/exa-answer.mjs review \
  --runtime /srv/forge/sf88-operator-buyer-cli --state /srv/private/research \
  --profile /srv/private/operator-profile.json --client /srv/app/seller-client.mjs \
  --query-file /srv/private/question.txt --intent research-question-001 \
  --max-atomic 10000 --accept 0 --request-timeout-ms 180000
```

The example cap is 10000 atomic units; choose the cap authorized for your actual
merchant offer. The question file must contain 1–8000 UTF-8 bytes and some
non-whitespace content. Review retains that exact question, the generated request,
explicit `paymentFlow:'upfront'`, a 180-second HTTP deadline, and a 32 MiB SSE
capture with a 120-second capture deadline. The merchant uses its own Exa key.

Execute and later reopen that same intent:

```sh
node examples/exa-answer.mjs execute \
  --runtime /srv/forge/sf88-operator-buyer-cli --state /srv/private/research \
  --intent research-question-001 --out /srv/private/answer.json
node examples/exa-answer.mjs recover \
  --runtime /srv/forge/sf88-operator-buyer-cli --state /srv/private/research \
  --intent research-question-001
```

Execution enters the original terminal approval. The report contains its native
outcome, process status, assembled answer, citations, event count and capture
completion. `--out` creates a private new file exclusively. On an interrupted
capture, add `--partial` to `recover` to inspect its retained complete records.
The original attempt and accounting status remain in that report.

The exported application helper `readExaAnswer(result, {allowPartial, signal})`
reads `choices[0].delta.content` and top-level `citations`. It preserves every
citation field and combines subsequent details for the same source ID and URL.
The original SSE file remains available with its recorded hash. `[DONE]` sets
`providerDoneMarkerSeen`; the iterator continues through EOF and final byte
verification. `captureComplete` reports the original stream capture separately.

The payload mapping follows the [official Answer API](https://exa.ai/docs/reference/answer)
and [Exa's SDK at commit 443071918171](https://github.com/exa-labs/exa-js/blob/4430719181718117889247dc31bd5cd9e7ca459b/src/index.ts).
Only the original paid merchant operation acquires data; both recovery and the
application helper consume its retained response.

## Limits and record meaning

Defaults are 64 MiB for the whole capture, 1 MiB per record, 100000 records, and
30 seconds. Original native streaming transport accepts a selected total duration
up to five minutes. Use `maxRecordBytes` and `maxRecords` on the reader to choose
additional local consumption limits. None of these values changes the offered
price or the original spending reservation.

SSE preserves `event`, multiline `data`, persistent `id`, and numeric `retry`
metadata. It supports LF, CRLF and lone CR; comments and unknown fields are
ignored. NDJSON requires newline-terminated UTF-8 JSON values and ignores empty
lines. Both preserve the original raw file. IDs and retry metadata are exposed
for the application to inspect; these readers perform no automatic reconnect.
