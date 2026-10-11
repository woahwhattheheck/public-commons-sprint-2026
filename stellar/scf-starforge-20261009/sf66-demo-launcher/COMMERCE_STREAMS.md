# Streamed purchases in the commerce workspace

Use the existing commerce browser to review a finite SSE or NDJSON purchase,
watch the original buyer capture its response, and reopen the saved records.
An interrupted capture stays attached to the same intent, payment result and
private response file. The merchant and other prepared purchases can continue
in the same session.

This workflow uses the [original commerce session](./COMMERCE.md), SF88's
immutable inbox and terminal approval, SF31's response writer, and the
[Node customer's retained stream readers](../sf88-operator-buyer-cli/node/STREAMS.md).
The browser presents the actual saved response and original buyer outcome.

## Prepare the merchant and the buyer

Use the merchant's original [streaming response contract](../sf30-seller-sdk/STREAMING.md).
The route advertises its actual response format and payment flow:

| Selected flow | Original merchant operation |
| --- | --- |
| `authorization` | Generate the complete finite resource, settle through the native facilitator, then transfer the retained response. |
| `upfront` | Settle through the native upfront flow before starting the response source, then transfer generated records as they arrive. |

The buyer's `operation.expect.paymentFlow` defaults to `authorization`.
Choose `upfront` explicitly when purchasing a route that advertises it. The
original signer configuration must permit that same flow, network, asset,
recipient and spending limit. The original accepted terms remain part of the
terminal approval.

In the original SF88 buyer configuration, include these fields before preparing
its signer or importing the request into the commerce session:

```json
{
  "operation": {
    "intentId": "research-answer-001",
    "url": "https://your-merchant.example/research/answer",
    "method": "POST",
    "headers": {"Content-Type": "application/json", "Accept": "text/event-stream"},
    "bodyFile": "/private/buyer/research-question.json",
    "expect": {
      "scheme": "exact",
      "network": "stellar:testnet",
      "asset": "YOUR_SELECTED_STELLAR_ASSET",
      "payTo": "YOUR_SELECTED_MERCHANT_RECIPIENT",
      "maxAtomic": "10000",
      "maxTimeoutSeconds": 180,
      "paymentFlow": "upfront"
    }
  },
  "captureBody": false,
  "requestTimeoutMs": 180000,
  "responseFile": {
    "destination": "/private/buyer/responses/research-answer-001.sse",
    "maxBytes": 33554432,
    "timeoutMs": 120000,
    "stream": {"format": "sse", "maxRecordBytes": 1048576, "maxRecords": 100000}
  }
}
```

These fields belong alongside the existing `operator`, `signerModule`,
`evidenceDir` and optional `buyerTransport` settings. Replace the origin,
network, asset, recipient, amount and paths with the selected merchant and
operator settings. Choose the spending ceiling independently of a sample
merchant price. The private body file for the Exa route contains only
`{"query":"Your research question"}`. The merchant owns its Exa credentials.

`requestTimeoutMs` is the original HTTP exchange deadline, including connection,
headers and response consumption. Its supported range is 1–300,000 ms for both
direct HTTPS and the original explicit CONNECT transport. `responseFile.timeoutMs`
is the capture deadline once saving begins. Configure enough time in both for
the chosen service. When no request deadline is selected, a stream uses its
capture timeout as the HTTP deadline; an ordinary response retains the
30,000 ms default. `maxBytes` limits the retained response. The original parser
enforces the selected UTF-8 format, per-record byte limit and record count.

The existing session plan imports each original buyer configuration, with its
original `workspace` or `signerConfig`, as described in [COMMERCE.md](./COMMERCE.md).
Use a new stable intent and unused destination for a distinct purchase.

### Use the existing setup command

For a merchant prepared through `commerce-setup.mjs`, add the same selections
to the original `purchases` entry:

```json
{
  "routeId": "exa-answer",
  "acceptIndex": 0,
  "intentId": "research-answer-001",
  "method": "POST",
  "bodyFile": "/private/buyer/research-question.json",
  "paymentFlow": "upfront",
  "saveResponse": true,
  "requestTimeoutMs": 180000,
  "responseMaxBytes": 33554432,
  "responseTimeoutMs": 120000,
  "responseStream": {"format": "sse", "maxRecordBytes": 1048576, "maxRecords": 100000}
}
```

Run the original setup review, then prepare the reviewed merchant/operator plan:

```sh
node sf66-demo-launcher/commerce-setup.mjs review \
  --config /private/commerce-setup.json --directory /private/research-commerce
node sf66-demo-launcher/commerce-setup.mjs prepare \
  --config /private/commerce-setup.json --directory /private/research-commerce
node sf66-demo-launcher/commerce-console.mjs start \
  --directory /private/research-commerce/session --port 8426
```

Run these commands from `stellar/scf-starforge-20261009` or the corresponding
maintained runtime directory. The setup uses the existing testnet facilitator,
operator and merchant inputs from [UPSTREAM_COMMERCE.md](./UPSTREAM_COMMERCE.md).
It allocates each private response destination inside the prepared directory,
shows that path and all effective limits in review, and uses the original
configuration validator. All selections in that one generated signer workspace
must share a network, asset, recipient and selected payment flow. An original
commerce plan can import separately prepared buyer workspaces when those
settings differ.

## Review, execute and watch the response

Open the complete local operator URL printed by `commerce-console.mjs` and
keep its terminal open.

1. Select the prepared intent. **Review the operation** shows the exact merchant
   route, payment option, amount and ceiling, selected payment flow, HTTP
   deadline and response destination.
2. Click **Review operation**, read the original offline review, and click
   **Execute operation**. Complete the original SF81 approval in the terminal.
3. In **Delivery → Streamed response**, watch the original capture's byte count
   and last write time. The meter compares observed bytes with the configured
   byte ceiling; it is not an estimate of the provider's remaining work.
4. When capture finishes, use **Open saved records**, **Preview result** or
   **Download result**. Expand **Reviewed capture settings** for the effective
   limits, retained digest and last complete record boundary.

The original payment section presents the native buyer status, merchant
settlement receipt and original reservation. A complete capture and a payment
receipt remain separate facts. For example, an upfront purchase can retain a
successful merchant receipt together with an interrupted response. The full
native summary stays in the existing **Operation details** disclosure.

The console polls the actual original writer reservation and private partial
file while the selected buyer is active. It presents completed record counts
from the final retained writer metadata. It does not create a second progress
file or alter the captured response bytes.

## Use records and cited answers

**Open saved records** reads the actual saved file through the original Node
reader. SSE rows show their original event type and ID alongside the data;
NDJSON rows show each original parsed JSON value. Search matches record
content and SSE event/ID fields. Pages show 25 records; the HTTP reader accepts
1–100 per page. A record preview contains up to 8,192 characters. The original
download contains the full bytes.

Each read consumes and verifies the full retained source before publishing its
page. Opening another page, searching, refreshing or changing the selected
intent reads existing local content. The original inbox keeps the purchase's
single attempt. Switching intents cancels an unfinished browser read and clears
the previous intent's content before displaying its replacement.

For the original [`exa-answer` merchant route](../sf30-seller-sdk/EXA_ANSWER.md),
**Read answer and citations** uses the maintained
[`readExaAnswer`](../sf88-operator-buyer-cli/node/examples/exa-answer.mjs)
customer function. It joins `choices[0].delta.content`, preserves top-level
citation objects and merges later details for the same source. Source links
open separately; **Source details** retains the provider's citation fields.
The browser displays up to 262,144 answer characters and 200 sources; its
message identifies a shortened preview. The retained file and original Node
example provide the complete result.

The provider's `[DONE]` data is an application marker. The reader continues to
the original stream EOF and final digest check, and shows provider completion
and capture completion separately.

## Interrupt and reopen the same purchase

**Interrupt this buyer** signals the original active inbox command for that
exact intent. Its native execution and writer handle the interruption and
retain their outcome, reservation, response prefix and digest. The session's
merchant remains available. Use **Stop session** when the entire owned
merchant/buyer session should drain.

If the original writer retained a partial stream, select **Open the complete
records retained from this interrupted capture**, then open its records or
answer. Only the completed record prefix is parsed; a trailing unfinished
record remains in the raw retained bytes. **Download retained partial bytes**
returns the complete saved prefix after checking its recorded size and digest.
Its filename ends in `.partial` and its state remains **Partial**.

Reloading the browser or restarting the original console with the same session
directory reopens the same inbox attempt and output. If a process stopped
before the inbox stored its result, use **Recover recorded result** to read its
existing original evidence first. The result's capture state then determines
which content can be opened. Keep the original session, ledger, evidence and
response files together at their prepared private paths.

## Existing host API

An embedding host may use the same session methods as the browser:

```js
const view = await session.status();
const rows = await session.streamRecords(intentId, {offset: 0, limit: 25, query: 'source'});
const partialRows = await session.streamRecords(intentId, {allowPartial: true});
const answer = await session.streamAnswer(intentId, {allowPartial: true});
// During this exact original buyer's active execution:
await session.interrupt(intentId);
```

`streamRecords`, `streamAnswer` and `streamFile` read the exact frozen intent
and original retained result. Content readers accept an `AbortSignal` and
remain available after the owned session stops. `streamFile` returns its
original descriptor for the host's existing verified download operation.
The browser exposes those reads through its private authenticated local
routes; it accepts an intent selection and fixed reader options.

Include `commerce-stream.mjs`, this guide and the complete `commerce-ui/`
directory with the existing maintained runtime. The reader uses the original
SF88 Node source, including its Exa customer example. There is no additional
dependency or browser build step.
