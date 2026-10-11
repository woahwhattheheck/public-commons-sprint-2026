# Operate a paid Exa Answer merchant

Offer one cited research answer as a fixed-price Stellar resource. The buyer
sends `POST /research/answer` with `{"query":"..."}`. The original SF30 seller
reviews and settles its advertised native upfront payment, then invokes Exa
through the merchant's private API key and forwards the original SSE bytes.
The buyer retains the answer fragments, source citations and original payment
record in its existing operator workspace.

This is a customer-operated merchant integration. Its two accounts have
separate roles:

| Connection | Operator configuration | Accounting |
| --- | --- | --- |
| Buyer → this merchant | Original Stellar network, asset, recipient and fixed atomic price | Original SF30 settlement and buyer ledger |
| This merchant → Exa Answer | Server-held `EXA_API_KEY` for the normal Exa API account | That Exa account's ordinary API usage |

Exa's [published x402 integration](https://exa.ai/docs/integrations/payments/x402/quickstart)
covers `/search` and `/contents` on Arc, Base, World Chain and Solana. Its
API-key requests use normal account billing. This deployment uses that API-key
path for `/answer` and the existing SF30 native Stellar implementation for its
own customer-facing resource.

## Included product

The original seller's `examples/` directory contains:

| File | Purpose |
| --- | --- |
| `exa-answer-service.json` | One original seller route, named input admission and explicit upfront terms |
| `exa-answer-upstreams.json` | Original fixed-origin SSE binding and private credential reference |
| `exa-answer-handlers.mjs` | Query validation and four-field request composition over `createUpstreamHandlers()` |

The handler uses the existing upstream implementation for HTTPS, public DNS
resolution, credentials, connection admission, decompression, stream limits,
backpressure, cancellation and sanitized errors. The original seller owns the
payment gate, receipt, public response and graceful drain.

### Exact request and response

Public input is one JSON object with a nonblank `query` string, up to 8,000 UTF-8
bytes, at the fixed `POST /research/answer` route. Extra body fields, multipart
input and URL query parameters return `INVALID_EXA_QUERY` from the original
admission stage before payment. The same validation runs again in the original
verified application handler.

The merchant creates this exact source request:

```http
POST https://api.exa.ai/answer
Content-Type: application/json
Accept: text/event-stream
x-api-key: <resolved only from the seller's EXA_API_KEY>
```

```json
{
  "query": "the buyer's unchanged query",
  "stream": true,
  "text": false,
  "model": "exa"
}
```

These options follow the official [Answer reference](https://exa.ai/docs/reference/answer)
and the pinned [Exa JavaScript SDK](https://github.com/exa-labs/exa-js/blob/4430719181718117889247dc31bd5cd9e7ca459b/src/index.ts).
The buyer supplies its query; model, streaming and text choices belong to this
product's server implementation.

The derived source context sets the JSON object, exact serialized raw bytes,
JSON body type and body-presence descriptor together. This preserves the
original multipart-capable upstream's byte forwarding while keeping the
buyer's original request and intent in its existing payment and operator record.

The source's SSE data carries answer text at `choices[0].delta.content` and
citations in a top-level `citations` array. The pinned SDK describes citation
`id` and `url`, with optional `title`, `publishedDate`, `author` and `text`.
Citations can be delivered separately from answer fragments. The merchant
preserves all original event bytes, including metadata and any `[DONE]` data
marker, and completes delivery at the actual stream EOF. Consumers can retain
unknown fields and use the original raw capture when examining a provider
response. The same pinned SDK's `streamAnswer`, `streamChatCompletions` and
`processChunk` methods supply this source contract.

## Configure the merchant's price and receiving account

Copy the two JSON files into your existing private merchant configuration
directory. The service example carries `amount: "10000"`, testnet and visibly
nonpayable `UNVERIFIED_DEMO_*` markers. Set the actual deployment values before
enabling native payments:

| Setting in `service.json` | Operator decision |
| --- | --- |
| `publicOrigin` | The canonical HTTPS origin of this merchant, with no path |
| `routes[0].definition.payment.network` | The supported Stellar network for this deployment |
| `routes[0].definition.payment.asset` | Its exact asset contract |
| `routes[0].definition.payment.payTo` | The original merchant recipient |
| `routes[0].definition.payment.amount` | A positive integer string in that asset's atomic units |
| `routes[0].definition.payment.maxTimeoutSeconds` | The offered payment authorization window |
| `routes[0].definition.payment.extra.paymentFlow` | `"upfront"` for this live-stream product |

The merchant sets its customer price independently of upstream billing. On
2026-10-11, Exa's [public pricing table](https://exa.ai/pricing) listed Answer at
$5 per 1,000 requests. Use the actual account plan and current price when setting
the merchant's fixed amount, together with its deployment, payment and support
costs. The example's 10,000 atomic units acquire meaning only after an operator
selects the real asset and price. The buyer supplies its own explicit spending
ceiling when reviewing the live merchant offer.

Preserve the `POST /research/answer` route, `handler: "exaAnswer"` and
`admit: "admitExaAnswer"` together. Preserve
the source binding's fixed `https://api.exa.ai`, `/answer`, `POST`, SSE mode and
`x-api-key` environment reference. The module validates that operation at
startup. Adjust the existing time, byte and concurrency limits to the intended
service; the model and request policy stay in the product composition.

Upfront payment succeeds before the original application starts. A later Exa
error, timeout or buyer disconnect can therefore leave a charged payment with a
failed or partial delivery. The existing buyer record keeps both outcomes for
the merchant's support and recovery workflow. Selecting default authorization
instead makes the original seller generate and validate the complete response
before settlement and transfer, as described in [STREAMING.md](STREAMING.md).

## Start through the original seller and operations launcher

Run from the repository root. Set `EXA_ANSWER_HOME` to the absolute path of your
private merchant directory and configure its `service.json` and `upstreams.json`
as above. Inject `EXA_API_KEY` into this server's environment through your
existing secret configuration. Set `EXA_FACILITATOR_URL` to the original HTTPS
facilitator for the chosen Stellar terms.

The original optional native SDK dependencies and receiving setup are described
in [the seller guide](README.md#enable-the-native-x402-runtime). The Exa transport
uses Node's native HTTP stack and the existing upstream components.

```sh
S=stellar/scf-starforge-20261009/sf30-seller-sdk
EXA_ANSWER_UPSTREAMS="$EXA_ANSWER_HOME/upstreams.json" \
node "$S/operations/launch.mjs" \
  --operations-port 8424 \
  --history-dir "$EXA_ANSWER_HOME/history" -- \
  --config "$EXA_ANSWER_HOME/service.json" \
  --handlers "$PWD/$S/examples/exa-answer-handlers.mjs" \
  --facilitator "$EXA_FACILITATOR_URL" \
  --port 8423 --max-in-flight 16 --drain-grace-ms 180000
```

This uses the regular original seller launcher so both named handler exports
are loaded. The product module reads the private upstream path from
`EXA_ANSWER_UPSTREAMS`; when omitted, it reads its adjacent example binding.
The original upstream environment resolver captures the server's key. Keep
that key in the merchant environment when restarting or rotating credentials.

Both local listeners bind to `127.0.0.1`. Route the configured public HTTPS
origin to the original seller listener using your existing host. Preserve the
SSE response without proxy buffering and configure the host's request timeout
for this product's stream lifetime. The operations listener remains private.
The launcher prints the merchant's current mode and private operations URL.
For a challenge-only configuration preview, omit `--facilitator` and inspect
the original developer page and offer; ordinary unpaid requests do not invoke
the upstream operation.

Use the original developer portal at `/_seller/docs` to export this merchant's
OpenAPI and typed customer client. The `exa-answer` operation advertises
`text/event-stream` and the selected upfront terms. Its generated request
preserves the merchant's actual public origin and requires explicit buyer
`paymentFlow: "upfront"` when selecting those terms.

## Operate one retained purchase

The complete customer example is
[`node/examples/exa-answer.mjs`](../sf88-operator-buyer-cli/node/examples/exa-answer.mjs).
Its original Node buyer workflow prepares the merchant request, reviews the
fresh offer and explicit spending ceiling, executes the approved configuration,
and consumes the retained SSE file. The customer uses its existing signer,
ledger and private output directory. Only the merchant needs an Exa API key.

The [Node streaming guide](../sf88-operator-buyer-cli/node/STREAMS.md) explains
complete-file readers, explicit partial-prefix recovery and the original saved
attempt. Answer fragments and citations can be read again from that same file
without purchasing another answer. Keep the original stable intent and result
when reconciling a disconnected request before deciding on another purchase.

| Included limit | Setting |
| --- | --- |
| Public JSON request | 64 KiB; the product query itself is capped at 8,000 UTF-8 bytes |
| Exa response headers | 20 seconds |
| Active upstream requests | 8 |
| Source and decoded response | 32 MiB each, within the seller's 32 MiB stream cap |
| Source lifetime | 120 seconds |
| Outstanding source-read idle time | 30 seconds |
| Original application handler | 60 seconds for opening and priming the upfront stream |
| Original complete request | 180 seconds |

The original availability controller observes the stream's final validated
outcome. It keeps one recovery call when the circuit is recovering, and
releases actual source resources on cancellation. Ordinary backend status
errors use the existing sanitized upstream response; Exa error bodies and the
API key are not retained in traffic diagnostics. The private operations console
and history retain the original merchant request and delivery counters.

Embedded hosts may import the same named handlers, call `snapshotExaAnswer()`
for the original source's sanitized counters, and call `closeExaAnswer()` after
draining their original seller. The public embedded SDK also exports
`streamingResponse()` and its stream types for directly produced resources.

## Source contract and delivery handoff

The API contract was read on 2026-10-11 from the official Answer reference and
official Exa SDK commit `4430719181718117889247dc31bd5cd9e7ca459b`.
The SDK's original `src/index.ts` Git blob is
`3980ad3d18184b68dda5e71eccb06c4bb53884b2`.

The deployment handoff consists of the configured original service and binding,
the named handler module, the original native seller and private operations
launcher, the generated merchant-specific client, and the customer's retained
answer/citation purchase workflow. Record the deployed source revision and
configured receiving terms with that merchant's existing release so subsequent
price, limit and source updates follow the same operating workflow.
