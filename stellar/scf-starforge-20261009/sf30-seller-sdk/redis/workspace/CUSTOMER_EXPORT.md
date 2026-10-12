# Customer application response export

This application connects the original generated seller client to the customer's existing buyer and writes the complete returned JSON for the selected Valkey products. The example plan covers all six supported read patterns. The existing operator workspace remains the place to configure the merchant, inspect the source, generate the client and manage releases.

## Package files

- customer-export.mjs: runnable command and reusable runCustomerExport function.
- customer-export.plan.example.json: six example operation IDs, initial inputs and explicit customer call/payment limits.
- CUSTOMER_APPLICATION.md: this operating guide.

Use the original Starforge distribution containing sf30-seller-sdk/developer/client-export.mjs and sf31-buyer-client/response-file.mjs. The customer application was composed against the complete product edition 814bbfdb5651d50112c53e8f1cbc7b1f0f004d1f. It consumes the installed implementations.

## 1. Prepare the actual customer merchant

Complete the existing commissioning flow for the selected customer environment. Select its real client topology, TLS authorities, data-reader identity, namespace and the agreed payment/access configuration. The selected example merchant contains six operations:

| Operation ID | Redis kind | Initial input | Continuation |
| --- | --- | --- | --- |
| availability | get | {} | One selected value |
| catalog | hash | {"region":"north"} | One selected field projection |
| leaderboard | sorted-set | {"offset":"0"} | Returned nextInput |
| events | stream | {"after":"-"} | Returned nextInput |
| list_feed | list | {"offset":"0"} | Returned nextInput |
| member_catalog | set | {"cursor":"0"} | Returned nextInput until scanComplete |

Export the original seller customer client from the retained live release. Keep all six original files together: the JavaScript module, TypeScript declarations, OpenAPI, package metadata, README and client-export.json. The application reads the complete native export manifest, verifies all five payload identities through the original inspector and checks that the imported client names the same OpenAPI digest.

The endpoint, request method, payment network, asset, recipient and payment flow come from that generated client.

### Select the actual customer operations

The integration accepts 1–64 selected operations from that original client. For another commissioned application, select its agreed products in the same `products` array and use their actual operation IDs; repeated kinds are supported.

Each `id` must exactly match a generated operation. Its native Redis query defaults to the same name. If the route exposes a differently named query, set `query` explicitly to the name in the original source and commissioning manifest. Choose `kind` from `get`, `hash`, `sorted-set`, `stream`, `list` and `set`. For a set whose declared cursor parameter has another name, set `cursorParameter` to that exact name; its default is `cursor`.

For example, a reviewed customer route `CustomerMembers-v2` can expose source query `CustomerMembers` with cursor parameter `scan_token`:

~~~json
{
  "id": "CustomerMembers-v2",
  "query": "CustomerMembers",
  "kind": "set",
  "cursorParameter": "scan_token",
  "input": { "scan_token": "0" },
  "maxAtomic": "10000",
  "acceptIndex": 0,
  "paymentFlow": "authorization"
}
~~~

Copy the operation, query and cursor names from the selected original merchant. Review prints the complete mapping and the original client offer. The saved response must identify that exact query and kind, and each set continuation must retain the original returned cursor under the selected parameter. Initial and continuation inputs pass through the original generated request builder.

## 2. Choose the customer's budget and initial inputs

Copy customer-export.plan.example.json to a customer-owned working path. Choose a stable operationId for this one business export and inspect every selected product and initial input.

The included example selects a maximum of **60 buyer calls**, **10,000 atomic units per call**, and **600,000 atomic units in aggregate**, matching the supplied example merchant's advertised amount. Those numbers are configuration values to review against the actual selected asset and use case. Atomic amounts are decimal strings throughout.

maxCalls is the maximum number of original buyer delegations, from 1 to 100,000. A budget smaller than the selected product count intentionally permits only that many calls. The application visits each product once before continuing paginated products in rounds. Every delegation reserves its permitted atomic ceiling against the aggregate budget before it calls the buyer. This conservative total includes calls whose outcome later requires review. The manifest separately records amounts present in returned native requirements; that field describes the returned requirements.

Each product explicitly selects acceptIndex and paymentFlow. The original generated client enforces the selected advertised payment identity, and the original buyer reviews the fresh challenge. The application also requires the same network and asset across all selected products so an aggregate atomic budget has one meaning.

The response limit applies to the full bytes exposed by Fetch. The example permits 1 MiB per response and a 30-second response-file transfer. The original buyer/transport owns its request timeout and external cancellation policy.

## 3. Connect the existing customer buyer

The command accepts one local adapter module exporting:

~~~js
export async function createBuyerContext({ sdkRoot, source, plan }) {
  return {
    buyer: yourExistingBuyer,
    approve: yourExistingApproval,
    sign: yourExistingOfficialSchemeSigner,
    signal: yourExistingAbortSignal, // optional
    close: yourExistingCleanup,     // optional
  };
}
~~~

buyer.call(request) receives the original generated request. The supplied approval and signer are passed through to the buyer on each call. The buyer retains its own wallet configuration, operation journal, spend governor and receipt/reconciliation integration. The adapter should reuse that existing customer configuration.

For an application already holding those objects, invoke the exporter directly:

~~~js
import * as generated from '/customer/generated-client/seller-client.mjs';
import { inspectSellerClientExport } from '/installed/starforge/sf30-seller-sdk/developer/client-export.mjs';
import { prepareBuyerResponseFile } from '/installed/starforge/sf31-buyer-client/response-file.mjs';
import { runCustomerExport } from './customer-export.mjs';
import { readFile } from 'node:fs/promises';

const original = await inspectSellerClientExport({
  directory: '/customer/generated-client',
});
const plan = JSON.parse(await readFile('/customer/export-plan.json', 'utf8'));

const result = await runCustomerExport({
  generated,
  clientManifest: original.manifest,
  buyer: yourExistingBuyer,
  approve: yourExistingApproval,
  sign: yourExistingOfficialSchemeSigner,
  prepareBuyerResponseFile,
  plan,
  directory: '/customer/exports/receiving-001',
  signal: yourAbortController.signal,
});
~~~

The output parent must already exist and support the original response writer's hard-link reservation. Each export creates a private directory. One directory belongs to one business operation.

## 4. Review and run the application

The review command loads the saved generated client, validates the selected operation/query bindings and prints the selected source, offers, inputs, limits and output directory:

~~~sh
node customer-export.mjs review \
  --sdk-root /installed/starforge \
  --client /customer/generated-client \
  --plan /customer/export-plan.json \
  --out /customer/exports/receiving-001
~~~

The explicit run uses the existing buyer context:

~~~sh
node customer-export.mjs run \
  --sdk-root /installed/starforge \
  --client /customer/generated-client \
  --plan /customer/export-plan.json \
  --out /customer/exports/receiving-001 \
  --buyer-context /customer/existing-buyer-context.mjs
~~~

The application reserves each response filename with prepareBuyerResponseFile before delegating. It retains the exact input, original intent ID, URL, method, expectation and permitted ceiling before the call, then saves the unread original returned response with writer.save(result). It decodes the saved file only after its full size and SHA-256 match the original writer's receipt.

## 5. Read the delivered files

The output contains customer-export.json and one complete response JSON per returned successful HTTP body, such as:

- availability-000000.json
- catalog-000000.json
- leaderboard-000000.json
- events-000000.json
- list_feed-000000.json
- member_catalog-000000.json

Further pages increment the page suffix. The manifest retains each original buyer result, intent ID, any supplied native request ID, request/correlation response headers, payment receipt, response size/hash and the exact continuation. It records source identity and the complete reviewed export plan.

Large identifiers, decimals and stream IDs retain the original source's textual representation. Binary values retain their original {base64: ...} encoding and JSON null stays null. The full response files keep every row and all source metadata.

List and sorted-set pages follow the seller's returned nextInput without computing an offset. Stream pages use the exact returned exclusive stream ID. Set pages keep the native unsigned 64-bit cursor as text, including empty pages that still have a continuation. The application preserves repeated set members and their original ordering within every response. These are live native reads, and data changes between pages can affect the iteration.

## 6. Reopen an existing export

~~~sh
node customer-export.mjs status --out /customer/exports/receiving-001
~~~

This reads the original plan and verifies every retained complete response file. An explicit run exits 0 only when all selected products complete; a returned budget, source-limit or buyer-review status exits 2 with its complete JSON and retained files. A thrown input, call, file or cancellation error exits 1.

| Status | Meaning |
| --- | --- |
| COMPLETE | Every product reached its original completion condition. |
| CALL_BUDGET_REACHED | The selected call allocation was exhausted; remaining product inputs are retained. |
| PAYMENT_BUDGET_REACHED | The next advertised purchase would exceed the remaining explicit allocation. |
| SOURCE_LIMIT_REACHED | The original source returned a truncated result with no admissible continuation; its reason is retained. |
| BUYER_REVIEW | The buyer returned an outcome requiring review. Any returned complete 2xx body is saved before stopping. |
| REVIEW / CANCELLED_REVIEW | The original call, response transfer or saved payload needs reconciliation. Exact call identity and available partial-file details remain with this operation. |

For a budget-limited export, inspect the completed files and remaining exact inputs before authorizing another business export. The original buyer is responsible for any payment/intent reconciliation. Keep a partially received operation and its original identifiers; the status command is the receiving path for those files. Re-running run into the same directory fails before any call, so reopening an output cannot silently repeat a purchase.

## Integration into the customer handover

Retain these three files beside the operator guide and generated customer client. During customer receiving, bind this application to the customer's actual buyer context, run the reviewed selected-product plan, and retain the resulting full files and manifest with the operator's source/release handover.
