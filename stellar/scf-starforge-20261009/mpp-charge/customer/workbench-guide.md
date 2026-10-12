# Native customer workbench

The **Customer workbench** tab in the private MPP console receives a merchant contract, saves the customer's own limits, prepares an offer, and operates the original purchase through settlement, recovery, accounting, and resource download.

Start the existing workspace on the operator host:

```sh
starforge mpp serve /private/mpp-workspace
```

Open the private URL printed by the command. The console uses the existing workspace lease. Its customer sessions borrow that open workspace; they do not launch a second workspace process. Node clients, Python clients and the console share the same retained customer contracts and purchases when opened against that workspace at different times.

## Receive and configure

Open **Customer workbench → Receive a merchant contract**. Import either the merchant's public contract JSON or its complete customer package. The package's companion files are regenerated from the maintained client templates before acceptance. Alternatively, enter the merchant HTTPS origin and choose **Fetch public contract**. An explicit CONNECT proxy uses either a URL without credentials or a named environment variable on the operator host.

Review the merchant name, origin, offer count and changes from the saved contract. Enter the payer account, signer environment variable, exact native runtime dependency directory, original spending governor ledger and policy, actor, service and Python executable. The host supplies the actual keys in the named environment variables.

Each asset has its own network, contract, decimals, maximum amount and maximum fee. Limits use positive integer atomic units. For example, a token with seven decimals represents 0.0000007 tokens as seven atomic units. Selecting an offer cannot raise that limit; its actual declared price must fit the saved asset limit. The original SF36 governor also enforces its account and service policy when the operator approves execution.

Save the contract and customer configuration. Saves use the workspace revision captured when the draft was loaded, so a concurrent configuration edit produces a revision conflict. Reload the saved configuration or review the imported contract again to make the next edit against the current revision.

**Check current merchant contract** loads a new draft and describes changed prices, recipients, assets, routes and input contracts. Saving that draft selects the new contract for future preparations. Previous purchases remain attached to their original contract and buyer profile.

## Prepare and execute

Choose an offer and a stable purchase ID. Enter query parameters as a JSON object of strings or arrays of strings. POST offers also accept an optional JSON body. Leaving the body empty sends no body; entering JSON `null` sends the original bytes for a JSON null value.

**Preview exact request** shows the URL after deterministic query construction, method, original body length and hash, offer terms and selected limits. **Prepare purchase** requests the actual native HTTP 402 challenge using the maintained customer API and published runtime. The original buyer captures that challenge and the original request before the workbench presents it as ready for review.

Each preparation binds the selected contract, offer, configuration, purchase ID and exact request. Repeating a preparation under that ID reopens its original challenge. To buy another request, use **New purchase ID**.

Choose **Execute** in the customer purchase row. The controlling terminal on the operator host presents the exact purchase for the original spending governor. The original buyer creates one reservation, signs one native MPP pull credential, retains it before sending, and uses the original transfer reconciliation flow. The workbench's job list and purchase history remain readable while that operation waits for approval or a network response.

## Recover and retrieve

The workbench includes purchases prepared by the maintained generated Node and Python clients. The history also covers older merchant contracts and offers which are no longer selected in the editor.

| Control | Uses |
| --- | --- |
| Retry preparation | The workbench's retained original profile, offer, query, body and purchase ID |
| Execute | The captured original native challenge and original spending governor |
| Recover | The already retained signed credential and original request |
| Reconcile | The original transaction, transfer verification and accounting record |
| View resource | The saved completed response, shown as text or a binary descriptor |
| Download | The original saved resource bytes |

A failed preparation remains visible even if the merchant request failed before a complete purchase row was written. Its **Retry preparation** control reopens the stored original preparation after a contract change or console restart. Preparations initiated in a generated external client retain that client's existing retry interface.

A changed native contract produces `CONTRACT_REVIEW_REQUIRED` before approval. Receive the current contract and prepare a new purchase ID. Existing valid purchases retain their original scope and remain recoverable.

The workbench exposes a resource after it has a successful completed response and a native payment receipt for that purchase's transaction. Response content is displayed as text and downloaded as bytes. The resource panel also shows its original content type, byte count, SHA-256, receipt and accounting state. Text previews are limited to 16,384 characters; download contains the complete saved response.

## Command-line receiving

The maintained `mpp` command provides the same workflow when a terminal is more convenient:

```sh
starforge mpp customer-draft /private/mpp-workspace merchant-contract.json > reviewed-customer.json
# Edit reviewed-customer.json: keep its revision and edit draft.configuration.
starforge mpp customer-configure /private/mpp-workspace reviewed-customer.json
starforge mpp customer-preview /private/mpp-workspace data purchase-inputs.json
starforge mpp customer-prepare /private/mpp-workspace data purchase-inputs.json
starforge mpp execute /private/mpp-workspace customer-purchase-001
starforge mpp resume /private/mpp-workspace customer-purchase-001
starforge mpp finalize /private/mpp-workspace customer-purchase-001
starforge mpp export /private/mpp-workspace purchases customer-purchase-001 /private/resource.json
starforge mpp customer-status /private/mpp-workspace
```

Example `purchase-inputs.json`:

```json
{
  "purchaseId": "customer-purchase-001",
  "query": {"edition": "latest", "region": ["north", "south"]},
  "json": {"fields": ["value", "observed_at"]}
}
```

Omit `json` for a GET offer. The preview command reads the same input file and uses its request fields. `customer-retry WORKSPACE PURCHASE_ID` retries the retained workbench preparation. `customer-status WORKSPACE OFFSET` pages through customer history in groups of 50.

Run these workspace-owning commands after stopping the console. The in-process API below is the integration path for a host which already owns the workspace.

## Embed in an existing operator application

```js
import {createCustomerWorkbench} from '@tokenjunkielabs/starforge-merchant/mpp/customer';

const workbench = createCustomerWorkbench({workspace, environment: process.env});
const received = await workbench.intake(customerContractOrBundle);
// Apply the operator's selected paths, payer, governor and limits to received.draft.configuration.
const selected = await workbench.configure({profile: received.draft, revision: received.revision});
const purchase = await workbench.prepare({
  profileId: selected.profileId,
  offerId: 'data',
  options: {purchaseId: 'customer-purchase-001', query: {edition: 'latest'}}
});
await workbench.action(purchase.id, 'execute');
const result = await workbench.resource(purchase.id);
// result.response contains the saved bytes; result.receipt and result.accounting retain their native records.
```

`attachCustomer({workspace, contract, configuration, environment})` provides the lower-level generated-client interface over a host-owned workspace. Its `close()` waits for that session's queued work and leaves the host workspace open. Borrowed customer sessions on the same workspace share one operation queue. The host drains all active operations before closing the workspace.

Workbench snapshots read atomic retained records directly, so a long purchase does not prevent observing its current stage. Preparation and execution preserve their original identities across queueing. The existing Activity actions and command-line purchase actions use the same customer identity checks when a purchase has a customer binding.

## Private console API

Every workbench endpoint uses the existing bearer session and same-origin protection.

| Endpoint | Request or response |
| --- | --- |
| GET /api/customer-workbench?offset=0&limit=50 | Saved profile and paginated original customer purchases |
| POST /api/customer-workbench/intake | `{document}` → contract draft, difference, workspace revision |
| POST /api/customer-workbench/fetch | `{origin, transport?}` → current public contract draft |
| POST /api/customer-workbench/configure | `{profile, revision}` → selected profile ID and revision |
| POST /api/customer-workbench/preview | `{profileId, offerId, inputs}` → exact request and limits |
| POST /api/customer-workbench/prepare | `{profileId, offerId, options}` → background job |
| POST /api/customer-workbench/retry-prepare | `{id}` → retry the original preparation |
| POST /api/customer-workbench/execute | `{id}` → original approved purchase job |
| POST /api/customer-workbench/resume | `{id}` → original credential recovery job |
| POST /api/customer-workbench/finalize | `{id}` → original transfer/accounting reconciliation |
| POST /api/customer-workbench/refresh | `{profileId}` → contract update draft |
| GET /api/customer-workbench/purchases/ID/preview | Read-only resource preview and original metadata |
| GET /api/customer-workbench/purchases/ID/response | Original resource download |

Native runtime versions remain isolated and pinned to `@stellar/mpp@0.7.1`, `mppx@0.6.29` and `@stellar/stellar-sdk@15.1.0`. The customer workbench is included in the existing MPP component and typed `./mpp/customer` export.

## Native MCP and Applications integration

The [native merchant MCP guide](../../../../stellar-forge/mcp-merchant-operator/MPP.md) connects the existing customer console to the maintained merchant operator. The same workspace now exposes direct original purchase inspection, original job lookup, exact configuration review and SHA-pinned paid-response chunks. These reads remain available while a purchase waits on its native merchant or original terminal governor. Applications can bind the schema-first `stellar-forge.mpp-console-ready.v1` startup record to authenticated `/api/identity` using the original process/parent IDs, workspace and creation time.
