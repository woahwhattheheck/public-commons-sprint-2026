# Invoice and settlement operator

This application takes an invoice register through original ElementPay orders, contract events, customer notifications, payout records, settlement reconciliation and partner delivery. The browser, CLI and Applications entry open the same continuing workspace.

An operator can load and edit complete invoice and asset registers; collect an entire selected native history; prepare and dispatch the listener's original event bodies; review unresolved backend responses; reconcile amounts and references; apply explained corrections; issue partner reports; and hand over the complete application, workspace and decoding runtime.

The interface uses a neutral industrial layout. Registers, source captures, delivery queues, reconciliations, reports and receiving have dedicated work areas. Every displayed financial quantity comes from an exact decimal or integer string.

## Start the operator

Use Node.js 22 or later. From a source checkout:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/invoice-settlement/cli.mjs serve \
  --workspace /absolute/private/invoice-workspace \
  --connections-file /absolute/private/invoice-connections.json
~~~

Open the complete local URL returned by the command. Its fragment contains the access token for that operator. Applications opens the same URL through its maintained process lifecycle; see [APPLICATIONS.md](APPLICATIONS.md) for installation, the selected source package and retained runtime.

The installed command is:

~~~sh
stellar-invoice-settlement serve \
  --workspace /absolute/private/invoice-workspace \
  --connections-file /absolute/private/invoice-connections.json
~~~

The local interface listens on 127.0.0.1 or ::1. The separate customer notification receiver has its own command and endpoint.

Copy [connections.example.json](examples/connections.example.json) to a private file outside the workspace. Replace each explicit placeholder with the original endpoint, account scope and private credential, and remove connections the operator will not use. Named configuration lets a received workspace reconnect to the same source account without placing private credentials in its application or exported workspace.

### Connection selection

| Provider | Original connection and operation |
| --- | --- |
| ElementPay | Explicit base URL, network, merchant/account scope and X-API-Key. Reads the authenticated order list and original order or creation-transaction lookup. |
| EVM | Original RPC endpoint, chain ID, optional selected order contract, event profile and retained ethers runtime. Reads frozen log ranges, chain/head/block observations, transaction receipts, code, storage and read-only contract calls. |
| Horizon | Original network passphrase or supported alias and service URL. Captures original payment/operation history with joined transaction ledger information. |
| SDP | Original network, service URL, token, tenant and optional distribution wallet. Reads the provider's payment, disbursement, receiver, wallet and organization routes. |
| Listener backend | Original backend base URL, account scope, matching EVM network and listener webhook secret. Sends only the prepared lifecycle routes. |
| Customer webhook | Original network, merchant/account scope and the customer notification secret. Verifies the original notification headers and raw body before acknowledging receipt. |

The source catalogue exposes the actual route, fields, filter schema and pagination contract for each configured reader. The publisher’s [environment guide](https://devs.elementpay.net/guides/environments-and-keys) selects https://sandbox.elementpay.net/api/v1 for Sandbox and https://api.elementpay.net/api/v1 for Production, authenticated with X-API-Key. The example configuration names those environments separately. The reader preserves the selected path prefix. The internal listener backend has its own configured endpoint and secret.

EVM chain quantities are decimal strings in operator arguments. The RPC adapter encodes them as native hexadecimal quantities. Its private URL may include a provider query credential; retained public connection metadata contains the origin and hashed base path. Header values and private runtime locations remain in host configuration.

## Register invoices and exact assets

Start with [programme.template.json](examples/programme.template.json), or choose **New invoice programme**. Supply the merchant identifier and the original networks, assets and invoices for the settlement period.

The CSV templates contain headers for the original registers:

- [assets.csv](examples/assets.csv): stable asset ID, network, fiat/Stellar/EVM type, code, decimals, issuer or token contract.
- [invoices.csv](examples/invoices.csv): original invoice, partner/customer, asset, decimal amount, due date, order/reference links and optional explicit settlement asset and amount.

Keep invoice amounts as strings, including their original decimal precision. Asset decimals are explicit integers. Native Stellar payments have seven decimals. An issued Stellar asset requires its issuer; an EVM asset requires its token contract and exact eip155 network. The workspace keeps balances for each asset separately.

CSV order IDs and references accept semicolon-separated strings or a JSON array inside a correctly quoted CSV field. The browser preserves all imported columns in its editor and retains the complete original CSV when the programme is saved. The domain then selects its documented programme fields. The full JSON editor exposes fields such as original references that are not ordinary table columns.

Saving creates an immutable programme version. Following versions can correct the register while existing captures, reconciliations and reports continue to identify the version they used. The programme can have empty invoice and asset arrays while the operator collects original source records.

To save through the CLI:

~~~sh
stellar-invoice-settlement programme-save \
  --workspace /absolute/private/invoice-workspace \
  --file /absolute/private/programme.json
~~~

The returned programme ID and version identify the complete register.

## Collect the original source history

In **Sources**, choose a configured connection and one of its native reads. Enter its original selection fields or supply the complete request as JSON. **Collect complete selection** runs through all pages in that selection and retains each response independently.

ElementPay order pages use the published offset and limit protocol. Every page is a chronological observation; its request, full response bytes and native rows remain together. Repeated nonempty pages and cyclic cursors produce an actionable capture outcome.

For EVM logs, select explicit decimal-string fromBlock and throughBlock values. The selected page size is the block span per RPC request. The range stays frozen through continuation. The workspace retains the original chain observation before the log pages. Read **head**, **block**, **receipt**, **code**, **storage** or **call** when the reconciliation needs those original observations.

A complete native read argument has this shape:

~~~json
{
  "programmeId": "ORIGINAL_PROGRAMME_UUID",
  "programmeVersion": 1,
  "connectionAlias": "base",
  "name": "Original selected contract history",
  "read": {
    "kind": "logs",
    "pageSize": 100,
    "filters": {
      "fromBlock": "ORIGINAL_FIRST_BLOCK",
      "throughBlock": "ORIGINAL_FINAL_BLOCK",
      "events": ["OrderCreated", "OrderSettled", "OrderRefunded"]
    }
  }
}
~~~

Replace the labelled values with the actual programme and observed block range, then pass the complete file to the operator:

~~~sh
stellar-invoice-settlement invoke \
  --workspace /absolute/private/invoice-workspace \
  --connections-file /absolute/private/invoice-connections.json \
  --method capture.start \
  --input /absolute/private/original-capture.json

stellar-invoice-settlement capture-run \
  --workspace /absolute/private/invoice-workspace \
  --connections-file /absolute/private/invoice-connections.json \
  --capture-id ORIGINAL_CAPTURE_UUID \
  --resume-original
~~~

Horizon captures freeze their selected ledger bounds against the original root observation. Payment and operation records retain their joined original transaction information. SDP capture kinds preserve the provider's documented status, sort and cursor fields.

The original response and its normalized records are separate retained files. The JSON parser preserves every numeric token before interpretation. Import accepts complete response files and documents; a saved RPC scalar at /result follows the same projection path as its native read. A following projection selects the retained bytes and leaves its original interpretation available.

A capture can pause, resume, or recover its pending request. The original read selection, page arguments and response remain associated through continuation. Receiving a workspace pauses its captures for the receiving operator to select.

### Original contract profiles

The default EVM eventProfile is **all**, which selects the original lifecycle topics from both retained contract generations. A host can explicitly choose **listener-v2** or **elementflow-v1**.

| Published deployment source | Network and proxy | Event semantics |
| --- | --- | --- |
| Original ElementFlow Base deployment | eip155:8453; 0x55f2761afdD2bfBeDeE19D0439d686302CD2b150 | The retained production record identifies the legacy implementation. OrderSettled and OrderRefunded contain the order ID; amounts require their original order and receipt movements. |
| Original ElementFlow Base Sepolia deployment | eip155:84532; 0x5cB2B2b5f8E373bb9c44Cbc190FF103d2bd11716 | The later profile includes the settlement net amount and fee, and the refund amount, as described by the retained listener ABI. |

These are identities from the publisher's original source generation. Native code, proxy storage and read-only call captures can establish the implementation and version at the selected block. Their complete RPC responses are part of the same workspace.

The decoder uses the listener's original ethers **6.13.5** package. It retains and checks the complete installed dependency graph against the original package lock before importing it. EVM log and receipt projections carry that runtime's ID, manifest hash and version. See [APPLICATIONS.md](APPLICATIONS.md) for the complete installation and received-generation configuration.

## Customer notification receiving

The customer webhook and internal listener use different protocols.

Run the customer ingress with the selected programme and private customer connection:

~~~sh
stellar-invoice-settlement webhook-serve \
  --workspace /absolute/private/invoice-workspace \
  --connections-file /absolute/private/invoice-connections.json \
  --programme-id ORIGINAL_PROGRAMME_UUID \
  --programme-version 1 \
  --connection-alias customer-events \
  --host 127.0.0.1 \
  --port 8789
~~~

The endpoint is POST **/webhooks/elementpay**. Place a configured TLS reverse proxy in front of the native HTTP listener when exposing it to the publisher. The default loopback host supports that arrangement; an explicit listen host can select another private ingress.

The receiver checks X-Webhook-Id, X-Webhook-Event and X-Webhook-Signature. The signature is **t=seconds,v1=base64**, calculated over the exact timestamp text, a period, and the unchanged raw body. The published timestamp window is 300 seconds. Base64 padding is retained, and the MAC comparison uses decoded bytes.

Every authenticated attempt is retained before the receiver returns success. Repeated identical notification IDs and bodies join the original receipt. A repeated ID with a different body retains the conflicting attempt and returns a conflict response. The browser displays the receipt's source and all attempts.

## Original listener delivery

In **Listener & notifications**, select the original backend and prepare jobs from the programme's retained lifecycle events. Each job retains its native event occurrence, original request body and destination scope. Preparing the same event again reuses the existing job.

The three routes match the publisher's listener:

| Original event | Backend route | Original payload |
| --- | --- | --- |
| OrderCreated | POST /events/order-created | orderId, requester, token, amount, messageHash, orderType, transactionHash |
| OrderSettled | POST /events/order-settled | orderId, transactionHash |
| OrderRefunded | POST /events/order-refunded | orderId, transactionHash |

The sender uses X-EP-Timestamp, X-EP-Signature with a **v1=hex** HMAC, and X-EP-Client: listener. The body retains the publisher's field order and exact integer amount string.

**Deliver ready selection** freezes the selected jobs and processes every selected ready delivery. Each request has its own retained attempt and complete original response. The run can pause and continue; another ready job can complete even when an earlier job has a failed or uncertain outcome.

An interrupted dispatch is recovered from its original saved result when available. Otherwise it remains visible as uncertain, so the operator can inspect the original backend order or signed customer notification before choosing the outcome. Explicit **acknowledged**, **retry** and **cancel** decisions include the operator and reason. Acknowledgement from source records requires the same order and lifecycle transaction reference.

The interface downloads the original request, intent, full response bytes and attempt metadata. The CLI does the same:

~~~sh
stellar-invoice-settlement delivery-file \
  --workspace /absolute/private/invoice-workspace \
  --delivery-id ORIGINAL_DELIVERY_UUID \
  --attempt-id ORIGINAL_ATTEMPT_UUID \
  --part response \
  --output /absolute/private/original-backend-response.bin
~~~

## Reconciliation and partner reports

Create an edition from the selected programme version, source files and applicable decisions. The engine joins exact order/invoice references and network-qualified transaction hashes. It retains unmatched records and conflicting references for operator review.

The financial interpretation handles:

- ElementPay order status, original fiat/crypto values, creation/settlement/refund references and signed customer updates.
- Both EVM event profiles, original successful transaction receipts, observed canonical block hashes and configured confirmation counts.
- Rich settlement gross, net and fees without converting native uint256 quantities to floating point.
- Legacy settlement or refund movements only when a unique original ERC-20 Transfer matches the retained order token, requester, amount and successful receipt.
- On-ramp reservation releases separately from actual off-ramp token refunds.
- Original Horizon payments and explicitly attributed clawbacks, plus native SDP payment/disbursement status and references.
- Per-invoice, per-order and per-asset collection, settlement, refund, fee and net balances.

The default rules require successful chain transaction observations and reject settled_unverified as a completed settlement. Set the programme's explicit acceptance rules to match the commissioning agreement.

**Link / correct** appends a decision referencing an original record, invoice/order, role, operator and explanation. A following correction supersedes a specific earlier decision. Reconcile again to create a following immutable edition, then compare the original and corrected invoice/order outcomes and asset totals.

The complete edition records its programme version, source and decision selections, as-of time, unresolved observations and result. It can produce all three report formats in one operation:

- HTML for operator and partner review.
- JSON with complete structured results and original source references.
- CSV with exact values and spreadsheet formula protection.

A partner selection scopes invoices, orders, record references, decisions and totals to that partner. Report files are retained under their original manifest and can be downloaded, exported or received later.

## Export and continue independently

**Export complete workspace** produces the application source cohort, current original workspace selection, history, reports and every runtime generation referenced by a captured or imported EVM source. Export retains its selected revision and copies outside the active writer lock, so ongoing operator work can continue.

The application manifest contains the complete maintained files selected for this product. A runtime includes its original installed package files, modes, dependency graph and link targets. The receiver restores each runtime generation separately and returns its exact paths.

The browser can download the complete archive, upload and inspect a received archive, then receive it into an independent destination. **Export original report files** creates a smaller scoped partner report package using the same transfer mechanism.

CLI receiving uses the same implementation:

~~~sh
stellar-invoice-settlement workspace-export \
  --workspace /absolute/private/invoice-workspace \
  --connections-file /absolute/private/invoice-connections.json \
  --destination /absolute/private/invoice-delivery

stellar-invoice-settlement package-inspect \
  --source-directory /absolute/private/invoice-delivery

stellar-invoice-settlement package-receive \
  --source-directory /absolute/private/invoice-delivery \
  --destination /absolute/private/received-invoice-operator \
  --request-id ORIGINAL_RECEIVING_REQUEST_UUID
~~~

The receiving result contains the final workspace, application, runtime and report paths. Configure the original named private connections on that host. The returned application.runtimeConnections entries provide **id**, **version**, **runtimeDirectory** and **expectedManifestSha256** for each received generation. Put those complete entries into the EVM connection's **runtime.retained** array when the continuing workspace contains several generations. The current **runtimeDirectory** selects the generation for new projections.

The receiver pauses captures and outbound jobs while retaining their original pending arguments and attempts. Resume the original capture or delivery selection through the operator. A following export includes the receiving history and subsequent work.

## Continuation and complete operator access

Every changing operation has a UUID and expected workspace revision. The CLI prints automatically selected values before running when they were omitted. Retrying identical original arguments returns their original retained result. A genuinely new operation uses a new UUID and current revision.

The browser journals its original in-flight method arguments and upload files for reopening and recovery. Its retry control continues the same operation against the same workspace identity. HTTP mutations carry X-Invoice-Workspace-ID from the original bootstrap state. The CLI can read an original request result or continue a capture/delivery directly.

~~~sh
stellar-invoice-settlement methods

stellar-invoice-settlement request-status \
  --workspace /absolute/private/invoice-workspace \
  --request-id ORIGINAL_REQUEST_UUID

stellar-invoice-settlement history \
  --workspace /absolute/private/invoice-workspace \
  --offset 0 \
  --limit 100
~~~

All supported methods are also available through **Workspace history → Complete operator method** and the CLI invoke command. Use complete JSON arguments for the native request, selected sources, decisions or original run.

## Source and licenses

The implementation modules in this directory are provided under their MIT notices. The source manifest retains the maintained shared modules on which this application depends.

| Retained original source | Version or commit | Purpose and original notices |
| --- | --- | --- |
| [ElementPay listener](https://github.com/elementpayHQ/element-pay-listener/tree/5aa0f8db98fc348da4a6186d9299b21abe401201) | 5aa0f8db98fc348da4a6186d9299b21abe401201; full 14-file source | Original listener route, signature, ABI, package and lock. The source retains its ISC/MIT declarations as published. |
| [ElementFlow](https://github.com/elementpayHQ/ElementFlow/tree/834400cfead38c338917f1fbc9654dbb3f6093ce) | 834400cfead38c338917f1fbc9654dbb3f6093ce; full 59-file source | Original production and later contract definitions, deployments and token-flow semantics. Its original BSL-1.1 notices remain with the contract source. |
| [ElementPay API](https://devs.elementpay.net/api-reference/order-endpoints/list-orders-for-the-authenticated-user) and [signature guide](https://devs.elementpay.net/guides/webhooks/verify-signatures) | Retained contract edition in source/elementpay-contracts.json | Original authenticated order reads and customer notification protocol. |
| [Stellar SDP](https://github.com/stellar/stellar-disbursement-platform-backend/tree/4330f131e8a2638a10767ec8db50a98f22672a61) and [Stellar documentation](https://github.com/stellar/stellar-docs/tree/0886fb75182106bdd1b33c3aeae52bb5fe122b0a) | Maintained native source capsules in settlement-audit/source | Original SDP and Horizon routes, response schemas and provider behavior. |
| ethers | 6.13.5, selected through the retained original listener lock | Original installed decoder and complete dependency graph, with all included package notices. |

The operator executes its own source reader and the original ethers decoder. The retained contract source supplies the deployment, ABI and transfer semantics used to interpret actual chain observations.
