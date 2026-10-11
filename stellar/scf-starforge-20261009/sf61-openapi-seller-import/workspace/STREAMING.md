# OpenAPI merchant streams and customer sessions

The original API merchant workspace can turn a declared finite SSE or NDJSON endpoint into a native paid resource, retain its merchant package, and prepare the original commerce console for a concrete customer purchase. The same request then uses SF88 review and terminal approval, SF31 response capture, and the existing saved-output reader.

## Start with the maintained workspace

From the installed source distribution, use the existing `openapi-workspace` command. From a source checkout:

```sh
mkdir -m 700 /private/merchant-projects
node stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/server.mjs \
  --out-parent /private/merchant-projects --port 0
```

Open the complete local URL printed by the process. Keep this terminal open for customer approval and managed runtime shutdown.

**Load stream example** loads [streaming-openapi.json](examples/streaming-openapi.json) and [streaming-plan.json](examples/streaming-plan.json). The matching finite backend is runnable separately:

```sh
node stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/examples/streaming-backend.mjs
```

It listens on `http://127.0.0.1:9041`, emits five NDJSON records for `/records?topic=merchant-operations`, and streams demonstration text for a JSON question at `/answer`. Replace the example asset, recipient, seller HTTPS address and price with the actual pilot terms. Keep the original backend running while the merchant uses it. For your own API, load its description and select its declared server and credential environment references.

## Declare the actual response and payment flow

The source operation must declare an explicit successful HTTP `200` response containing `text/event-stream` for SSE, or `application/x-ndjson` / `application/ndjson` for NDJSON. A local referenced Response Object works through the original OpenAPI resolver. UTF-8 is the supported encoding. The unchanged original document and the selected facade remain separate files in the same merchant package.

Choose **SSE stream** or **NDJSON stream** in the route's response settings. These choices appear for the formats declared by that operation. The importer puts the selected media type in the actual native resource offer, and the upstream compiler checks the same format before launch. Whole-response JSON validation remains available for JSON routes. Streaming uses the original media and framing checks.

The **Payment flow** choice applies to every selected offer:

| Workspace choice | Native behavior |
| --- | --- |
| `authorization` | Generate the finite resource, complete native settlement, then transfer its retained stream bytes. |
| `upfront` | Complete native settlement first, then open the backend source and transfer records as they arrive. |

The merchant plan uses `payment.paymentFlow`. The generated requirement carries the exact native key `accepts[0].extra.paymentFlow`; buyer review receives that same value. Existing plans with no flow keep authorization behavior. For the locally owned facilitator, the reviewed profile's `payments.paymentFlows` must include the selected flow. Its default is authorization. The original setup checks this compatibility before customer initialization.

For direct use of the existing OpenAPI importer, add `responseFormat: "sse"` or `responseFormat: "ndjson"` to the selected operation. Its source must contain the corresponding declared response. The original `accepts` object supplies the payment flow through `extra.paymentFlow`.

## Review source limits before saving

| Merchant field | Meaning |
| --- | --- |
| `timeoutMs` | Original backend request timeout; for streaming, the response-header deadline. |
| `stream.maxBytes` | Maximum stream payload, up to the workspace's 64 MiB merchant limit. |
| `stream.maxDurationMs` | Maximum backend source duration. |
| `stream.idleTimeoutMs` | Maximum interval without source bytes. |
| `maxRequestBytes` | Existing request-body limit, including multipart framing. |

Native input admission runs before payment verification. Each stream uses one backend source for its original paid request. Select complete JSON or byte responses when configuring shared read caching or durable POST response replay. Header environment references, OAuth references, availability policy, original request schemas and normal source capacity remain in the existing binding.

Choose **Validate configuration**, inspect the public route, backend target, atomic price, flow, media type and stream limits, then **Save new package**. Reopening the saved package restores these choices. `RUN.md` retains the ordinary seller launch command; `upstreams.json` retains the stream policy. Start challenge preview and use **Check unpaid routes** to inspect the actual native offers before customer preparation.

## Prepare the customer in the same workspace

The **Prepare a streaming customer** section works from a saved merchant package. Select a route, a new customer name and an intent ID. Use the actual path/query values and JSON body, an exact private body file, or an original private request packet. A packet provides its own intent, URL, headers, ticket and body through the original SF88 reader. For multipart bodies, retain their exact bytes and `Content-Type` boundary using the existing [file input workflow](FILE_INPUT.md).

Enter the original native facilitator configuration path, public buyer account, Python executable, operator actor/service, and buyer key source reference. Choose total and daily atomic budgets independently. An optional HTTPS proxy environment name uses the original buyer transport. Set the seller loopback port to the port routed by your HTTPS gateway; zero assigns a port displayed when the customer console starts.

The buyer's **whole request deadline** and **response capture deadline** are separate reviewed values, each at most 300,000 ms for streaming. Choose deadlines that cover the intended generation and transfer. The customer also selects its byte, record-size and record-count limits. These values become the original `requestTimeoutMs` and `responseFile` configuration.

**Save customer review** retains the exact input body or original packet and writes `setup.json` beneath `stream-customers/<customer-name>/`. Its review shows the concrete request, original terms, public payer, customer budget, request-byte digest, output destination and configuration digest. The source files and configuration shown there are checked again before preparation.

**Prepare customer workspace** invokes the original Stellar testnet `prepareCommerceSetup` and retains its operator workspace, ledger, buyer configuration and commerce session. Interrupted initialization uses that same setup's explicit resume path. Each customer workspace owns its displayed budget and purchase intent. Save an additional customer review when intentionally creating a separate customer workspace.

**Start original customer console** transfers this package from its separate preview seller to that prepared commerce session. Open the console link, run its original review and signer check, and approve the exact purchase in the workspace terminal. The existing console presents original payment status separately from complete or interrupted output. Its retained records, download and same-purchase reopen controls are described in [COMMERCE_STREAMS.md](../../sf66-demo-launcher/COMMERCE_STREAMS.md).

The merchant workspace lists retained customer sessions. Reopen the saved customer to use the original intent and retained output. Closing the console drains its owned native session and preserves its files. The saved review also prints the original `commerce-setup.mjs` and `commerce-console.mjs` commands for terminal use.

## Stream content and continuation

SSE is dispatched according to its actual framing; an unfinished event at EOF remains incomplete. NDJSON requires a newline after each JSON value. Application markers such as `[DONE]` remain content within the actual response. The buyer's original saved bytes and metadata determine completion. Use the existing retained records and partial recovery controls to inspect an interrupted response under the same purchase.

For installed Node consumers, use the maintained [stream readers](../../sf88-operator-buyer-cli/node/STREAMS.md). The existing [Exa Answer merchant](../../sf30-seller-sdk/EXA_ANSWER.md) supplies its own server-side request shaping and retains Answer deltas and top-level citations through the same SSE transport and buyer reader.
