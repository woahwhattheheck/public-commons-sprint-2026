# Native Stellar MPP through the merchant MCP operator

The merchant MCP operator can use an existing native MPP customer console for the complete customer workflow: receive a merchant contract, select a reviewed customer configuration, inspect exact request terms, prepare a native payment challenge, execute or recover the original purchase, reconcile accounting, and deliver the saved resource.

HTTP and stdio use the existing merchant operator and the same native MPP service. The private console keeps its original workspace lease, native payment jobs, and controlling terminal. Its original buyer performs SF36 approval/reservation, official MPP signing, response recovery, and SF86 reconciliation.

## 1. Open the original native console

Use Node 22.16 or newer, Python 3.11 or newer, and the existing native MPP runtime. The original runtime installer is:

~~~bash
starforge mpp runtime-template /srv/mpp/native-runtime
npm --prefix /srv/mpp/native-runtime ci \
  --ignore-scripts --omit=dev --no-audit --no-fund
~~~

The copied manifest and lockfile pin **@stellar/mpp 0.7.1**, **mppx 0.6.29**, and **@stellar/stellar-sdk 15.1.0**. Set the original merchant or customer configuration's absolute `dependencyRoot` to that directory. Keep this peer set separate from the distribution's other Stellar runtime.

Initialize the private workspace once:

~~~bash
starforge mpp init /srv/mpp/customer
~~~

The console supports an explicit token environment reference so the original console and the MCP host can share the same private session:

~~~bash
export MPP_CONSOLE_TOKEN="$(node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))")"
starforge mpp serve /srv/mpp/customer 8787 --token-env MPP_CONSOLE_TOKEN
~~~

Keep that original console running in its terminal. Supply the same selected environment value to the MCP host through the host's existing environment management. The token is exactly 64 lowercase hexadecimal characters. Without `--token-env`, the console generates its usual new private token for that launch.

The console prints its existing `Private operator workspace: URL` marker and then a schema-first JSON readiness record:

~~~json
{
  "schema": "stellar-forge.mpp-console-ready.v1",
  "pid": 412,
  "ppid": 390,
  "origin": "http://127.0.0.1:8787",
  "privateUrl": "http://127.0.0.1:8787/#<64-lowercase-hex-token>",
  "workspace": "/srv/mpp/customer",
  "createdAt": "<original-workspace-creation-time>",
  "versions": {
    "@stellar/mpp": "0.7.1",
    "mppx": "0.6.29",
    "@stellar/stellar-sdk": "15.1.0"
  },
  "tokenEnv": "MPP_CONSOLE_TOKEN"
}
~~~

The values above describe the shape; the live process supplies the actual IDs and original workspace creation time. Applications retain the private URL in their original private run state. The authenticated `/api/identity` response gives the original `pid`, `ppid`, `origin`, `workspace`, `createdAt`, and declared native versions. Actual merchant startup or customer preparation resolves and verifies the selected published packages through the original `loadNative`.

## 2. Declare the host connection and customer aliases

Use a customer configuration file from the native customer package. It contains the original workspace, dependency root, operator/ledger/policy paths, signer environment reference, and asset limits. For example, save the completed original `customer.example.json` as `/srv/mpp/customer-policy.json`. Its `workspace` must be exactly `/srv/mpp/customer`.

The MCP connection selects that file and the running console:

~~~json
{
  "schema": "stellar-forge.merchant-mpp-connection.v1",
  "consoles": {
    "research": {
      "label": "Research purchases",
      "origin": "http://127.0.0.1:8787",
      "tokenEnv": "MPP_CONSOLE_TOKEN",
      "workspace": "/srv/mpp/customer",
      "customers": {
        "standard": {
          "label": "Research budget",
          "configuration": "/srv/mpp/customer-policy.json"
        }
      }
    }
  }
}
~~~

Store this as `/srv/mpp/mcp-connection.json`. Relative host paths resolve against that file. The reader verifies the existing private workspace and retains its original creation identity. One connection may declare up to 16 consoles and 32 customer aliases per console.

Tool arguments select these aliases and supply merchant contracts, offer inputs and original operation IDs. Host files select filesystem paths, executable runtimes, credential environment references and customer spend limits. Tool results expose the public payer, actor/service names, reviewed limits, source digests and contract terms.

Initialize the maintained merchant operator:

~~~bash
starforge merchant-mcp init-mpp \
  --dir /srv/mpp/operator \
  --connection /srv/mpp/mcp-connection.json
~~~

Existing operators can add `mppConnection` to their private `merchant-mcp.json`. The ordinary merchant initializer also accepts `--mpp CONNECTION_JSON`.

Launch the existing merchant MCP HTTP server with its own MCP access-token environment:

~~~bash
starforge merchant-mcp serve \
  --config /srv/mpp/operator/merchant-mcp.json \
  --port 3211
~~~

Use the exact endpoint returned by the original startup JSON. The existing merchant stdio entrypoint opens this same operator factory and transport. `MPP_CONSOLE_TOKEN` authenticates the borrowed console; `MCP_ACCESS_TOKEN` authenticates the MCP endpoint.

## 3. Receive and review a customer contract

Start with `merchant_mpp_consoles` and `merchant_mpp_status`. The status exposes the active customer contract, profile ID, current revision and paged original purchase history.

For a public merchant, call:

~~~json
{
  "name": "merchant_mpp_contract",
  "arguments": {
    "console": "research",
    "customer": "standard",
    "origin": "https://merchant.example.com"
  }
}
~~~

This uses the original console's public-contract fetch and the host-selected customer transport. A received native contract or complete native bundle can also be passed directly into the next review.

Call `merchant_mpp_customer_review` with a stable `reviewId`, the customer alias and the complete contract or bundle in `document`. The service sends that document to the original console intake, validates the host configuration through the original native profile reviewer, and saves the complete normalized profile and revision before returning its review SHA256.

| Field | Meaning |
| --- | --- |
| `reviewId` | Durable review identity chosen by the caller |
| `reviewSha256` | Exact saved review, original configuration, contract and revision |
| `profileId` | Exact normalized native profile that will be configured |
| `configurationSha256` | Original host-selected customer file bytes |
| `revision` | Original console revision used by the reviewed selection |
| `profile.contract` | Merchant identity, offers, recipients, amounts, networks and input contract |
| `profile.configuration` | Public customer identity and reviewed asset/fee limits |
| `difference` | Changes from the previously selected customer contract |

Use `merchant_mpp_customer_configure` with the same console, review ID and `expectedReviewSha256`. The original console applies the saved revision through its existing compare-and-set configuration writer.

After a lost review reply, repeat the same review ID and document or read `merchant_mpp_customer_review_status`. After a lost configure reply, review status reports whether the exact profile is selected. A changed browser revision remains visible, allowing a new review against the current original state.

## 4. Preview, prepare and operate the original purchase

Select an offer from the active contract and call `merchant_mpp_preview` with its exact `profileId`, `offerId`, and optional `inputs.query` / `inputs.json`. The native preview returns the exact method, full URL, body, body hash, atomic price and matching customer cap.

Prepare with a stable purchase ID:

~~~json
{
  "name": "merchant_mpp_prepare",
  "arguments": {
    "console": "research",
    "profileId": "<current-native-profile-sha256>",
    "offerId": "report",
    "purchaseId": "research-report-001",
    "query": {"edition": "current"},
    "json": {"region": "north"}
  }
}
~~~

The original console returns a background job ID. Its original customer workbench saves the full profile, contract, request inputs and request binding before the native merchant call.

Use `merchant_mpp_job` with that job ID and purchase ID, or read `merchant_mpp_purchase` directly. The direct purchase read remains responsive while another original job waits on a merchant or terminal approval.

| Tool | Original operation |
| --- | --- |
| `merchant_mpp_execute` | Exact terminal approval and SF36 reservation, published native pull credential, delivery and reconciliation |
| `merchant_mpp_resume` | Recovery of the same original purchase and retained signed credential |
| `merchant_mpp_finalize` | Original SF86 transfer observation and SF36 accounting reconciliation |
| `merchant_mpp_retry_prepare` | Reopen the original saved preparation after a failed or interrupted initial merchant call |

Every operation uses the retained original purchase ID. The original console host presents terminal consent when the original buyer requires it. MCP returns the original background job immediately, leaving the operator able to read current history and job state.

Console job IDs are process-local observations. Purchase records and preparation records are durable. After a console restart, `merchant_mpp_job` with the original `purchaseId` returns that saved purchase when the earlier transient job is gone.

## 5. Deliver the actual response or native customer package

For a completed response, `merchant_mpp_response_preview` returns the original response SHA256, receipt, transaction, accounting outcome and text/binary preview. `merchant_mpp_response_file` reads bounded chunks from that same original purchase with `expectedSha256`, `offset` and `limit`.

For a merchant handoff, `merchant_mpp_catalog` returns the active or saved native merchant contract and profile ID. `merchant_mpp_handoff_file` reads `contract`, `openapi` or `package` for that exact profile. Retain the first returned file SHA256 for subsequent chunks.

For complete delivery through the maintained downloader, retain the original file with `merchant_mpp_export`:

~~~json
{
  "name": "merchant_mpp_export",
  "arguments": {
    "console": "research",
    "exportId": "customer-package-001",
    "kind": "package",
    "profileId": "<original-merchant-profile-sha256>",
    "expectedSha256": "<original-package-file-sha256>"
  }
}
~~~

For a paid response, choose `kind: "response"` and the original `purchaseId` instead of `profileId`.

The export is an atomic, private capture of those exact original bytes and a transport manifest. Its globally unique `exportId` binds the console workspace identity, original purchase or merchant profile, and file SHA256. File-read tools need only that original export ID.

The existing retained-file transport handles private snapshots, read IDs, byte offsets and digest checks. The existing receiver handles private directory leases, prefix verification, resumable checkpoints, create-only publication and the final whole-file digest:

~~~bash
starforge merchant-mcp inspect-mpp \
  --url http://127.0.0.1:3211 \
  --export-id customer-package-001

starforge merchant-mcp download-mpp \
  --url http://127.0.0.1:3211 \
  --export-id customer-package-001 \
  --out /srv/received/mpp-transport \
  --manifest-sha256 ORIGINAL_MANIFEST_SHA256
~~~

Run the same download command with the same endpoint, export ID and directory to resume. `merchant_mpp_export_list` and `merchant_mpp_export_manifest` reopen completed exports after MCP restart, including when the borrowed console is stopped.

A complete native customer bundle is transported as the original flat `mpp-package.json`. Feed it to the original native receiver to create all maintained files, including nested examples:

~~~bash
starforge mpp customer-receive \
  /srv/received/mpp-transport/mpp-package.json \
  /srv/received/native-customer

starforge mpp customer-inspect /srv/received/native-customer
~~~

The original receiver regenerates and compares the maintained companion sources and preserves its create-only/resumable receiving contract.

## Programmatic entrypoints

The distribution exports:

~~~js
import {readMppConfiguration, MerchantMppConsole}
  from '@tokenjunkielabs/starforge-merchant/merchant/mcp/mpp';
import {inspectMppDownload, downloadMppExport}
  from '@tokenjunkielabs/starforge-merchant/merchant/mcp/mpp-download';
~~~

Both have maintained TypeScript declarations. Use `openMerchantOperator` for the full existing MCP service. Embedded callers can construct `MerchantMppConsole` with the same host configuration and environment; `close()` drains this client's requests and temporary file reads while the original console keeps its workspace and jobs.

The original native customer export also exposes `inspectCustomerPurchase`, `customerResourceChunk`, and `MAX_CUSTOMER_CHUNK_BYTES`, plus workbench `review`, `inspect` and `resourceChunk` methods.

## Original private console API additions

| Endpoint | Purpose |
| --- | --- |
| `GET /api/identity` | Original process/parent and workspace creation identity |
| `GET /api/jobs/:id` | One original process-local job |
| `POST /api/customer-workbench/review` | Normalize an exact profile at the current revision |
| `GET /api/customer-workbench/purchases/:id` | Original purchase or preparation without waiting on the payment queue |
| `GET /api/customer-workbench/purchases/:id/file` | Original paid response chunks, bound to `expectedSha256` |

The existing loopback host, bearer and same-origin checks apply to these endpoints. Customer contract/request binding, native credential recovery, original governor accounting and the historical response store remain the authorities for their respective operations.
