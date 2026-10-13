# Document production through an agent

Use an agent to fulfill complete invoices, reports, greeting cards and ordered PDF bundles through the existing Document production customer. The agent operates the same saved sources, quotes, native buyer, paid jobs and received files as the browser.

The endpoint is installed automatically with the existing customer host:

/api/document-composition/mcp

The host remains the original loopback Jobs customer. Its existing bearer token, Host and Origin checks protect the endpoint. No additional merchant, buyer, facilitator, account, payment journal or source store is opened by the agent adapter or remote client.

## Start or reconnect to the original customer

If Document production is already running through Applications or the composition CLI, retain that instance. Its original private launch file is inside the configured customer directory:

~~~text
/srv/starforge/customer/job-workspace-launch.json
~~~

If the selected customer is stopped, start its original saved application or use the existing complete private customer options:

~~~sh
starforge document-merchant compose serve \
  --workspace-options /srv/starforge/private/customer-options.json \
  --provider snaplab \
  --merchant-origin https://YOUR_MERCHANT_ORIGIN
~~~

The startup announcement includes the existing browser links and an `agentUrl` without credentials. The private original launch record retains the session token. The remote CLI reads and rechecks that original record, its customer/operator/runtime selection and current instance; it does not open the customer model.

~~~sh
starforge document-merchant agent status \
  --launch /srv/starforge/customer/job-workspace-launch.json
~~~

Use the actual commissioned public merchant origin and original buyer settings. [COMMISSIONING.md](COMMISSIONING.md) explains how the existing commerce account supplies them. Supplier keys remain on the merchant side.

### Configure an MCP client

For an MCP client that accepts an HTTP server entry, write a private configuration from the actual original launch:

~~~sh
starforge document-merchant agent config \
  --launch /srv/starforge/customer/job-workspace-launch.json \
  --out /srv/starforge/private/document-agent.json
~~~

The complete file has an `mcpServers.document-production` entry with `type: "http"`, the loopback endpoint and its original Authorization header. Import that entry through the selected client's supported configuration interface. The output contains the session token; keep the file private. After restarting the host, regenerate from its new original launch. CLI output reports only the saved file's location and identity.

The maintained transport uses MCP protocol `2025-11-25`, JSON-RPC requests and single JSON responses. Send `Content-Type: application/json`, an Accept header containing both `application/json` and `text/event-stream`, and `MCP-Protocol-Version: 2025-11-25` after initialization. It has no SSE stream or remote task system. Long rendering and receiving return the original background operation immediately.

## Complete invoice or report fulfillment

The source of approval is the customer's explicit choice of the saved native plan. Dataset text, template instructions and an agent's interpretation of a document do not supply approval.

### 1. Prepare the complete source

Read the installed catalog without connecting to a customer:

~~~sh
starforge document-merchant agent tools
~~~

Retrieve a complete editable example, including the actual recipe, dataset and every template:

~~~sh
starforge document-merchant agent example \
  --launch /srv/starforge/customer/job-workspace-launch.json \
  --kind grouped --provider snaplab \
  --out /srv/starforge/private/grouped-example.json
~~~

Examples are input templates. Replace their sample records with the actual customer's complete data, title, task references and renderer settings. The original composition rules and grouping semantics are documented in [COMPOSITION.md](COMPOSITION.md).

The stage input is one complete JSON object:

~~~json
{
  "id": "customer-invoices-october",
  "request": {
    "...": "The complete supported composition request, with the same id"
  },
  "dataset": {
    "name": "order-lines.csv",
    "bytes": 123,
    "sha256": "the actual 64-character SHA256",
    "base64": "the complete original CSV bytes encoded as base64"
  },
  "templates": {
    "invoice": {
      "name": "invoice.html",
      "bytes": 456,
      "sha256": "the actual 64-character SHA256",
      "base64": "the complete original HTML bytes encoded as base64"
    }
  }
}
~~~

This shape illustration is not an executable recipe; use the complete returned example or an existing reviewed recipe. Retain its supported schema, mapping, dataset and template fields. Each uploaded name, complete byte count and SHA belongs to its exact content. The `templates` keys match the recipe's template IDs.

Generate a complete upload descriptor from an existing source file when composing the input:

~~~sh
starforge document-merchant agent upload \
  --file /srv/starforge/input/order-lines.csv \
  --out /srv/starforge/private/order-lines-upload.json
~~~

Stage the full assembled input:

~~~sh
starforge document-merchant agent stage \
  --launch /srv/starforge/customer/job-workspace-launch.json \
  --input /srv/starforge/private/invoice-stage.json \
  --out /srv/starforge/private/invoice-stage-accepted.json
~~~

Retain the returned `operation.id` before waiting. Stage performs source preparation on the existing customer; it does not execute a paid rendering.

~~~sh
starforge document-merchant agent wait \
  --launch /srv/starforge/customer/job-workspace-launch.json \
  --operation ACTUAL_OPERATION_ID \
  --out /srv/starforge/private/invoice-stage-result.json
~~~

A complete stage result supplies the original composition `id` and `sourceSha256`. A running or continuation-required operation remains available through the same customer.

The original upload bounds remain in force: complete inline sources must fit the 40 MiB MCP request envelope and the existing per-source limits. A complete retained composition plan above the inline upload allowance can be received using `documents_restore` with the actual allowed host-local `sourceFile` and its SHA. This retains the original 192 MiB source-plan path. It does not grant access outside the customer's declared file roots.

### 2. Inspect the source and exact native price

Write a selection using the actual saved source identity:

~~~json
{
  "id": "customer-invoices-october",
  "sourceSha256": "ACTUAL_SAVED_SOURCE_SHA256"
}
~~~

Use `documents_get` to read the request, source descriptors and original generated document rows. Its offset/limit fields page the complete saved set; `page.total` describes the whole selection.

~~~sh
starforge document-merchant agent call \
  --launch /srv/starforge/customer/job-workspace-launch.json \
  --tool documents_get \
  --input /srv/starforge/private/invoice-selection.json \
  --out /srv/starforge/private/invoice-source-review.json

starforge document-merchant agent quote \
  --launch /srv/starforge/customer/job-workspace-launch.json \
  --input /srv/starforge/private/invoice-selection.json \
  --out /srv/starforge/private/invoice-quote-accepted.json
~~~

Wait for the returned quote operation. It prepares or reopens the existing batch; it returns the original `planSha256`, exact native totals and unit meanings. Then read `documents_get` again. Download the whole `native-plan` for complete per-request inputs, original price terms and source binding.

A quote is a proposal to the existing customer. A rendering request, a business parent task, a PDF page, a supplier render and a prepaid allowance entry remain separate units. Use the actual selected native totals rather than a provider marketing price.

### 3. Execute only the approved plan

The CLI requires approval as a separate explicit option:

~~~sh
starforge document-merchant agent run \
  --launch /srv/starforge/customer/job-workspace-launch.json \
  --input /srv/starforge/private/invoice-selection.json \
  --approve-plan ACTUAL_REVIEWED_NATIVE_PLAN_SHA256 \
  --out /srv/starforge/private/invoice-run-accepted.json
~~~

The MCP equivalent is `documents_execute` with the same saved `id`, `sourceSha256` and explicit `approvedPlanSha256`. The original batch compares that approval with its retained current plan before using its checkout and spending allowance. Missing approval or an unknown field such as a substitute `planSha256` is rejected by the agent adapter.

A source or quote change requires review of the resulting original plan. The remote client never retries a mutation automatically. If the HTTP response is interrupted, first read the saved composition and its active operation. Continue the original ID or receive its existing jobs.

### 4. Receive complete original results

Poll the accepted run:

~~~sh
starforge document-merchant agent wait \
  --launch /srv/starforge/customer/job-workspace-launch.json \
  --operation ACTUAL_RUN_OPERATION_ID \
  --out /srv/starforge/private/invoice-run-result.json
~~~

If receiving is incomplete, resume it explicitly:

~~~sh
starforge document-merchant agent receive \
  --launch /srv/starforge/customer/job-workspace-launch.json \
  --input /srv/starforge/private/invoice-selection.json \
  --out /srv/starforge/private/invoice-receive-accepted.json
~~~

The original run result includes the actual report ID, counts, received-document count and source identity. Full `batch-results.json`, CSV, review HTML and batch plan are available through the original `report` download selector. Read the actual result before describing a delivery as complete. The native jobs and result journals retain their existing request, payment and task IDs.

Every received document package contains `document.pdf`, its unchanged HTML/Markdown source, `request.json` and actual `render.json`. A PDF preview or a successful supplier response alone is not the complete customer package.

### 5. Download and hand over the complete files

A PDF selection uses the actual document ID from `documents_get`:

~~~json
{
  "id": "customer-invoices-october",
  "sourceSha256": "ACTUAL_SAVED_SOURCE_SHA256",
  "kind": "pdf",
  "documentId": "ACTUAL_DOCUMENT_ID"
}
~~~

~~~sh
starforge document-merchant agent download \
  --launch /srv/starforge/customer/job-workspace-launch.json \
  --input /srv/starforge/private/invoice-pdf-selection.json \
  --out /srv/starforge/delivery/invoice.pdf
~~~

The client immediately consumes the original single-use ticket, streams the full file to a private temporary file, verifies response metadata and the actual byte count/SHA256, and installs the complete destination atomically without replacing an existing file. Default maximum is 512 MiB; `--max-bytes` may select an explicit whole-file allowance up to 8 GiB. The original host's transfer limits and receiving lifetime still apply.

A ticket lasts 60 seconds and is single use. If the connection fails, request a fresh ticket for the same immutable selection and receive the whole file again. Do not treat a partial file as a completed download.

Export the full customer Collection:

~~~sh
starforge document-merchant agent export \
  --launch /srv/starforge/customer/job-workspace-launch.json \
  --input /srv/starforge/private/invoice-selection.json \
  --out /srv/starforge/private/invoice-export-accepted.json
~~~

Wait for the actual result and retain its `exportId`. Download `kind: "export"`, that export ID and the returned complete file names; `documents.tar` is the original customer archive. The complete composition plan is available as `kind: "source-plan"`. The same saved source/Collection can be reopened through the browser and original customer receiving tools.

## Corrections and unchanged repeats

Call `documents_correction_draft` with the original saved selection, a new ID, name, reason, mode and actual document IDs. It returns the complete original grouped records and templates for those selected record/template pairs.

Edit that full draft, retaining its original parent, record keys and business task references. Submit it as `documents_correct` with the same new ID. The new derived set then follows the same quote → explicit approval → original rendering → receiving → export workflow. In repeat mode, unchanged selected generated-source bytes retain their original SHA. Earlier documents and source editions remain accessible.

A JSON file cannot supply CLI execution approval. Even when using generic `agent call --tool documents_execute`, the CLI still requires its separate `--approve-plan` option and compares it with any approval value in the argument file.

## Ordered volumes and existing PDF files

Two tool families retain the existing assembly workflows.

| Family | Source | Operations |
| --- | --- | --- |
| `document_assembly_*` | Actual received documents selected from one saved composition | get, stage, quote, execute, receive, export |
| `pdf_bundle_*` and `pdf_bundles_status` | Complete original PDF uploads or a retained existing-PDF bundle plan | get, stage, restore, materialize, quote, execute, receive, export, operation, cancel, download |

Composition assemblies retain both the composition/source SHA and the assembly/source SHA. Existing-PDF bundles use their original bundle/source SHA. The request is the complete maintained `DocumentAssemblyRequest` described in [ASSEMBLY.md](ASSEMBLY.md).

Only an actual merge job has a native paid merge plan. A natural single-PDF volume retains its original bytes and needs no merge purchase. When an assembly quote has no native plan, receive/export that existing source through the original workflow; do not invent an approval hash.

For accepted existing-PDF operations, use `agent wait --bundles` and `agent download --bundles`. Composition assembly operations use the ordinary composition operation route. Every paid `*_execute` call requires its exact explicit `approvedPlanSha256`; the CLI enforces the same separate approval flag.

## Typed remote JavaScript

~~~js
import {
  readDocumentAgentConnection,
  createDocumentAgentClient
} from './products/document-merchant/agent-client.mjs';

const connection = await readDocumentAgentConnection(
  '/srv/starforge/customer/job-workspace-launch.json'
);
const client = createDocumentAgentClient({ connection });
const state = await client.status();
const selected = { id: actualId, sourceSha256: actualSourceSha };
const quote = await client.quote(selected);
const prepared = await client.wait(quote.operation.id);

// Obtain explicit customer approval of this exact saved native plan.
const run = await client.execute({
  ...selected,
  approvedPlanSha256: approvedNativePlanSha
});
const result = await client.wait(run.operation.id);
const full = await client.get(selected);

await client.download(
  { ...selected, kind: 'pdf', documentId: actualDocumentId },
  '/srv/starforge/delivery/invoice.pdf'
);
~~~

This example uses the source checkout. The installed distribution also exports `./document-merchant/agent/client` with the same types. The typed `call` method covers every catalog tool, including correction, assembly and existing-PDF bundles. `wait` performs only read calls; it returns actual terminal state or `waitExpired` while the original operation continues.

## Operating behavior

The original controller owns admitted background work. Closing a remote CLI, losing an MCP response or hitting a wait deadline does not create another payment or close the customer. Cancel is explicit and preserves already accepted native jobs and saved receiving. The host drains its HTTP admission, document work and original customer through the existing lifetime.

In-memory operation observations are retained by the original controller for its current lifetime. After a host restart, reconnect through the new private launch, list saved sets, inspect their original batch/journals and receive or export them. The adapter does not introduce a second operation database.

Errors preserve the original code, message and recovery fields. A changed source/quote, missing original source, active operation, incomplete receiving or exhausted original allowance is handled through the same customer workflow. Keep the accepted operation and immutable source selection before further action.

The source-owned Document contribution registers the agent API, typed client, CLI and this guide. The saved Applications selection follows their actual imported implementation and the maintained MCP transport. The original product, native payment source, merchant registration and earlier grant source editions remain the same.
