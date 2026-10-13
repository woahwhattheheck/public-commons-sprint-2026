# Shopify Payments capture, reconciliation and receiving

This adapter acquires the selected Shopify Payments source into a resumable working directory, prepares the existing retail reconciliation, and transfers the complete acquisition with its editable source. The installed Analysis workflow supplies the source editions, saved queries, published reports and full working-project archive. Use one existing customer operation throughout acquisition, preparation, execution and receiving.

The supported API selection is **2026-10**. The source contracts were reviewed against Shopify's official documentation on **13 October 2026**. The code compares the actual served version on every accepted response. The complete request and response history travels with the delivery.

## 1. Select the customer operation and installation

Run Node 20 or later from the installed `datasette-analysis/partner-workflows` directory. Keep these eight files together:

| File | Responsibility |
| --- | --- |
| `shopify_payments.mjs` | Selection, requests, retained connection state, ID partitions and complete-pass comparison |
| `shopify_payments_cli.mjs` | Authenticated read, durable files, retry, preparation and whole-directory receiving |
| `SHOPIFY_PAYMENTS.md` | This operator guide |
| `preparation.mjs` | Existing retail transformation, decimal arithmetic and exceptions |
| `profiles.mjs` | Existing complete-table Analysis configuration |
| `prepare_cli.mjs` | Existing preparation publication and receiver |
| `README.md` | Native workflow and complete project receiving |
| `SOURCE_CONTRACTS.md` | Original input fields, ownership and acceptance |

The full installation also supplies the maintained CSV parser at `products/conapi/supplier-report/supplier-report.mjs`, `workflow_cli.py`, the original Python Analysis runtime and the complete source archive selected by that installation. A capture retains the eight adapter files; the original installation archive supplies the wider product.

Bind the actual lowercase `myshopify.com` host, original operation ID, selected payout interval, reviewed currency precision and transaction-role policy. The acquisition traverses the account's balance transactions to find every observed row linked to the selected payouts. Raw traversals therefore retain account rows outside the final selected reconciliation. Place the complete capture in the customer's existing private working area and carry its ordinary access controls through receiving.

The installed token is read from the environment variable named by `--token-env`. Keep the token value in the existing secret configuration. The CLI retains the variable name only as an invocation argument; it writes its defined response-header allowlist and request body without an authorization header.

Shopify documents `read_shopify_payments_accounts` for the account and `read_shopify_payments_payouts` for payouts and balance transactions. Some account access also has the broader approved `read_shopify_payments` alternative. The associated payment objects require the applicable staff `view_payouts` permission. Bind the existing installation's actual granted scopes and staff access. [Scope reference](https://shopify.dev/docs/api/usage/access-scopes) · [Account reference](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/ShopifyPaymentsAccount).

## 2. Write the source selection

The following is a configuration example. Replace its shop, IDs, dates, title, publisher and policy with the existing customer's selections. The three displayed transaction types illustrate the exact case-sensitive policy format; the customer's reviewed policy determines which actual types are contributions or transfers.

```json
{
  "shop": "your-shop.myshopify.com",
  "apiVersion": "2026-10",
  "operationId": "YOUR-ORIGINAL-CAPTURE-OPERATION-ID",
  "title": "Selected Shopify Payments payout reconciliation",
  "payoutWindow": {
    "start": "2026-10-01T00:00:00Z",
    "end": "2026-10-08T00:00:00Z"
  },
  "unassignedWindow": null,
  "policy": {
    "currencyScale": {
      "USD": 2
    },
    "transactionRoles": {
      "CHARGE": "contribution",
      "REFUND": "contribution",
      "TRANSFER": "transfer"
    }
  },
  "expectedAccountId": "gid://shopify/ShopifyPaymentsAccount/REPLACE_WITH_ACTUAL_NUMERIC_ID",
  "pageSize": 100,
  "publisher": "Actual merchant or commissioned source operator"
}
```

`expectedAccountId` is optional. If supplied, its suffix must be the actual positive numeric account ID. Omit the property when the installation has yet to retain that account identity; the first actual response binds the account for all subsequent pages and resumes. The illustrative nonnumeric placeholder above deliberately requires replacement.

| Selection | Meaning and change handling |
| --- | --- |
| `shop` | Exact lowercase original `myshopify.com` hostname |
| `apiVersion` | Exactly `2026-10` for this source edition |
| `operationId` | Existing capture operation ID, 1–128 letters, digits or the permitted `._:-` characters; starts with a letter or digit |
| `title` | Actual source purpose, at most 300 characters |
| `payoutWindow` | Payout `issuedAt` interval, inclusive start and exclusive end |
| `unassignedWindow` | Optional independent transaction-date interval for rows whose associated payout ID is null; use null when this extra selection is absent |
| `policy.currencyScale` | Explicit integer precision from 0 to 8 for each selected currency |
| `policy.transactionRoles` | Exact original type string mapped to `contribution` or `transfer` |
| `expectedAccountId` | Optional previously known account identity |
| `pageSize` | Initial connection size, 1–250; defaults to 100 |
| `publisher` | Optional retained attribution; otherwise uses the actual shop name |

Dates include a timezone and normalize to UTC. Both intervals are end-exclusive. The payout interval selects payout issuance; transactions associated with those payouts can have older transaction dates. The adapter keeps those linked rows. The optional unassigned interval selects a separate, explicit set of transactions.

The configuration has no `schema` property and rejects unknown top-level keys. Its canonical selection is bound into retained state. A changed window, policy, shop, API version or operation belongs in a fresh capture directory and a successor business request.

Shopify transaction enums include many types beyond the three illustrative values. The preparation compares the original type strings exactly and keeps an unmapped type as an exception. Preserve that exception until its actual accounting treatment is reviewed. [Transaction-type reference](https://shopify.dev/docs/api/admin-graphql/2026-10/enums/ShopifyPaymentsTransactionType).

## 3. Capture and resume the complete selected source

Create the parent directory in the existing customer workspace, then invoke the installed CLI with the actual environment-variable name:

```sh
node shopify_payments_cli.mjs capture \
  --config /private/customer/shopify-selection.json \
  --out /private/customer/shopify-capture-20261013 \
  --token-env EXISTING_SHOPIFY_TOKEN_ENV \
  --max-attempts 8 \
  --timeout-seconds 60
```

The CLI creates the capture directory, retains all eight source files, binds the canonical configuration, and reads the actual shop and activated Payments account. Each accepted response checks the account identity and `X-Shopify-API-Version`. A selected version that falls forward to another served version requires a deliberate source selection update in a new edition. [Version behavior](https://shopify.dev/docs/api/usage/versioning).

The same command resumes the same directory, configuration, pending connection and retained source. Run a received or older capture through its own `source/shopify_payments_cli.mjs` so source-version checks continue to match. A completed capture is revalidated and returned with `replayed:true`.

The CLI prints structured progress records:

| Record | Operator meaning |
| --- | --- |
| `SHOPIFY_SOURCE_RESPONSE` | Actual request, HTTP status, attempt, body identity and returned query cost |
| `SHOPIFY_SOURCE_WAIT` | Retained wait deadline and provider or measured-cost reason |
| `SHOPIFY_SOURCE_PASS` | Full observed traversal summary, selected-body fingerprint and acceptance state |
| `SHOPIFY_CAPTURE_COMPLETE` | Complete immutable inventory, operation, result and capture-manifest hash |

`--max-attempts` applies to transient attempts for one pending request, with a range of 1–100. `--timeout-seconds` is the per-request timeout, 5–300 seconds. If attempts are exhausted, the retained directory contains the exact pending request and every response already obtained. Restore normal service and run the same command.

One capture lock protects the directory. A live same-host owner keeps its lease. A dead same-host owner can be reconciled by the CLI. When host identity or process existence is uncertain, the error gives the existing owner ID. After reconciling that original process, pass the returned ID with `--recover-lock ACTUAL_OWNER_ID` on the same capture command. Preserve the captured state and files during this recovery.

## 4. Understand what each completed pass contains

The implementation performs these source operations:

1. Select all observed payouts in the configured `issuedAt` interval, retaining every status and payout direction.
2. Observe the highest payout ID for that pass and traverse its selected ID range in ascending order.
3. Observe the highest balance-transaction ID and traverse the account range with `hideTransfers:false`.
4. Start a new disjoint ID partition after 10,000 accepted rows, using the last observed ID as an exclusive lower bound and the pass's observed high ID as an inclusive upper bound.
5. Select transactions locally by their actual `associatedPayout.id`, and add explicitly selected unassigned transactions.
6. Reconstruct the referenced order index and retain conflicting original order references.
7. Compare the complete selected payout, transaction, order and policy bodies with the preceding complete pass. Continue full passes until two consecutive selected-body fingerprints match.

Shopify limits ordinary connection pages to 250 objects and traversals to 25,000 objects. The adapter's smaller ID partitions keep each cursor traversal below that ceiling. Every page must advance with ascending original IDs inside the recorded bounds. [Pagination reference](https://shopify.dev/docs/api/usage/pagination-graphql).

The retained summary distinguishes selected transactions from scanned account transactions, selected payouts, unassigned rows, referenced orders, conflicting order references and both observed high IDs. A new pass obtains fresh anchors. Its successful comparison describes two complete observed traversals with the same selected bodies. Capture time and each original transaction or payout date remain distinct.

A completed capture preserves that observed edition. A later payout-status change, adjustment or reassignment is acquired into the next capture and successor business request. The retained first edition stays available for comparison and replay.

The actual source query uses documented `issued_at` and `id` filters with explicit ID sorting. It selects payout membership from the returned relationship. Search diagnostics are requested and any returned search warning stops acceptance of that page. This matters because Shopify can ignore an invalid search filter. Returned dates and ID bounds are also checked locally. [Search syntax](https://shopify.dev/docs/api/usage/search-syntax).

## 5. Preserve source values and inspect financial policy

The acquisition retains each selected original object and its raw response. The preparation receives the existing `retail-payout-reconciliation` input with `balanceTransactions`, `payouts`, `orders`, `policy`, `source` and `complete:true`.

| Source value | Retained treatment |
| --- | --- |
| Money | Original decimal string plus currency code; preparation uses exact integer arithmetic at the declared scale |
| Global IDs | Original strings; numeric suffixes use BigInt only for source traversal |
| `sourceId`, `sourceOrderTransactionId` | Original decimal strings, including values above JavaScript's safe integer range |
| `associatedOrder` | Actual lightweight `id` and `name` reference when present |
| `associatedPayout` | Actual nullable ID and status; null payout membership has its own explicit selection |
| `adjustmentsOrders` | Every original adjustment descriptor, including amount, fees, net, name, link and order-transaction ID |
| Payout state and direction | Preserved for the existing exception and reconciliation rules |
| Test transactions | Preserved and identified by the original preparation |

Shopify's adjustment-order object uses `fees` and `orderTransactionId`. Its actual fields flow into the original transaction's retained adjustment JSON. [Adjustment-order reference](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/ShopifyPaymentsAdjustmentOrder). Shopify represents BigInt as a string; keep that original encoding across acquisition and receiving. [BigInt reference](https://shopify.dev/docs/api/admin-graphql/2026-10/scalars/BigInt).

The existing preparation separates contribution net, transfer net and unclassified net. It retains each payout's original amount, currency, direction and status. Its source-total match also depends on complete parseable rows and absence of the identified review exceptions. Review duplicates, missing relationships, unknown roles, test activity, amount inconsistencies, incomplete money, non-PAID payouts and withdrawal cases in `Review.html` and `exceptions.csv`.

`MATCHED_SOURCE_TOTAL` is the existing preparation's result for the selected source arithmetic. Continue the merchant's bank-receipt reconciliation through its normal finance workflow. Preserve actual currency precision and role decisions in the source policy so a receiver can repeat the arithmetic exactly.

## 6. Cost, error and recovery behavior

The HTTP layer retains raw bodies for successful and unsuccessful responses, plus request identity, timestamps, permitted response headers, search diagnostics and returned cost metadata.

Shopify uses requested and actual GraphQL query cost with a restoring bucket. Queries can be rejected before execution when their requested cost exceeds 1,000. This adapter retains the provider's bucket figures, honors `Retry-After` when present and calculates a wait from returned cost and restore rate when available. A `MAX_COST_EXCEEDED` response reduces the page size and retains the adjustment while preserving selected fields and source bounds. [GraphQL rate limits](https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits).

GraphQL errors can arrive with HTTP 200. The CLI retries transient `INTERNAL_SERVER_ERROR`, throttling, transport errors and HTTP server errors against the same pending request and cursor. An accepted response requires a complete data object and no GraphQL errors. [Status and error codes](https://shopify.dev/docs/api/admin-graphql/latest#status-and-error-codes).

| Result | Continuation |
| --- | --- |
| Throttle, transient internal error, transport timeout or HTTP server error | Preserve response and wait; retry the identical pending request |
| Attempt limit reached | Resume the same command and directory when service is available |
| Requested query too expensive | Retain cost adjustment and reduce connection page size |
| Query too expensive at minimum size or identity query | Review the selected source query and current schema |
| Granted access insufficient | Resolve the actual installation's access; resume its retained pending request |
| Shop, account, served version, selection or retained source changed | Reconcile the concrete identity or create the appropriate successor edition |
| Search warning, invalid row shape, repeated cursor or out-of-range ID | Inspect the exact retained request and response before source correction |
| Retained member hash mismatch | Recover the original declared member from the complete handover |

These errors preserve the completed source pages and pending state. Use the actual response metadata to identify the request; access tokens remain in the existing environment.

## 7. Inspect and prepare through the original transformation

Inspect a partial or complete capture:

```sh
node shopify_payments_cli.mjs inspect \
  --input /private/customer/shopify-capture-20261013
```

This checks the retained source edition and accepted response identities. For a completed capture it also verifies the complete file inventory and selected-body fingerprint.

Prepare the complete capture:

```sh
node shopify_payments_cli.mjs prepare \
  --input /private/customer/shopify-capture-20261013 \
  --out /private/customer/shopify-prepared-20261013 \
  --installation /private/customer/installation.json
```

`--installation` is optional for preparation and supplies the actual native binding when requested. Its format is the existing partner workflow contract:

```json
{
  "analysisWorkspace": "/private/customer/analysis",
  "operationId": "REPLACE_WITH_EXISTING_32_LOWERCASE_HEXADECIMAL_ANALYSIS_ID",
  "parser": "/opt/merchant/products/conapi/supplier-report/supplier-report.mjs",
  "sourceArchive": "/private/customer/Complete_Datasette_Product.zip"
}
```

The capture operation ID and native Analysis operation ID have separate roles. Preserve both actual identities. The installation's Analysis ID must satisfy its existing 32-character lowercase hexadecimal format.

The original preparer produces all four retail tables: `transactions.csv`, `payouts.csv`, `orders.csv` and `exceptions.csv`. It also retains the complete original input, preparation JSON, source metadata, editable transformation files, review HTML and manifest. An installation binding adds `profile-template.json`.

A clean exception table keeps its original four columns and zero data rows. Preserve that header-only table through native import and full exports. The selected business-key declaration remains the original explicit empty key until an actual key is reviewed.

## 8. Run, export and receive the existing Analysis workflow

Use the maintained parent `workflow_cli.py` from this installed directory:

```sh
python3 -I ../workflow_cli.py configure \
  --template /private/customer/shopify-prepared-20261013/profile-template.json \
  --output /private/customer/workflow-profile.json
```

The configuration binds actual input files, metadata, parser, source archive and their hashes. It selects all four source aliases and the original retail report. Its selected-payout query uses an actual payout ID from this completed capture.

Create the customer's actual request using the existing contract:

```json
{
  "schema": "stellar-forge.source-workflow-request.v1",
  "requestId": "ORIGINAL_BUSINESS_REQUEST_ID",
  "correlationId": "ORIGINAL_BUSINESS_REQUEST_ID",
  "profile": "retail-payout-reconciliation",
  "parameters": {
    "payoutId": "gid://shopify/ShopifyPaymentsPayout/REPLACE_WITH_ACTUAL_NUMERIC_ID"
  }
}
```

```sh
python3 -I ../workflow_cli.py accept \
  --workspace /private/customer/workflow \
  --request /private/customer/business-request.json \
  --execution-id ORIGINAL_ORCHESTRATOR_EXECUTION_ID

python3 -I ../workflow_cli.py run \
  --workspace /private/customer/workflow \
  --request-id ORIGINAL_BUSINESS_REQUEST_ID \
  --configuration /private/customer/workflow-profile.json

python3 -I ../workflow_cli.py status \
  --workspace /private/customer/workflow \
  --request-id ORIGINAL_BUSINESS_REQUEST_ID \
  --history

python3 -I ../workflow_cli.py export \
  --workspace /private/customer/workflow \
  --request-id ORIGINAL_BUSINESS_REQUEST_ID \
  --destination /private/customer/Source_Workflow_Project.zip
```

The existing result retains every source table, selected-payout query, query version, report publication and business-request history. Query previews have their original 100,000-row cap; use actual complete export counts and truncation fields for whole-table receiving.

An interrupted request uses its original request and execution identities. A changed source or policy becomes a successor request with the existing `parentRequestId` relation. Keep the prior source, preparation and Analysis editions.

## 9. Transfer the whole source and native project

After preparation, create a fresh complete handover directory:

```sh
node shopify_payments_cli.mjs handover \
  --input /private/customer/shopify-capture-20261013 \
  --prepared /private/customer/shopify-prepared-20261013 \
  --native-delivery /private/customer/Source_Workflow_Project.zip \
  --out /private/customer/shopify-handover-20261013
```

Omit `--native-delivery` when the selected delivery is preparation-only. Its manifest records the actual included components. When supplied, the original native ZIP is copied byte-for-byte, with its complete bytes and SHA-256 retained.

| Handover member | Contents |
| --- | --- |
| `capture/` | Complete capture, all original requests and responses, passes, state and eight editable source files |
| `prepared/` | Original validated preparation, all tables and metadata |
| `native/delivery.zip` | Optional exact full working-project archive |
| `handover.json` | Complete member identities and capture/preparation/native relationships |

The output must be a fresh directory outside both inputs. Its parent must already exist. The implementation stages the complete copy, verifies it, and publishes the finished directory. It validates preparation through the existing receiver and checks that its original input matches this capture.

Receive the handover into the receiving operator's selected destination:

```sh
node shopify_payments_cli.mjs receive \
  --input /transfer/shopify-handover-20261013 \
  --out /private/receiver/shopify-handover-20261013
```

Receiving verifies the complete source inventory, every member hash and the original capture/preparation relation. It reconstructs preparation through the original receiver. An identical already-received handover returns its original result with `replayed:true`.

Use the exact received source for subsequent inspection:

```sh
node /private/receiver/shopify-handover-20261013/capture/source/shopify_payments_cli.mjs inspect \
  --input /private/receiver/shopify-handover-20261013/capture
```

The received preparation retains its original installation template. For a new installation, run the retained source's `prepare` command with the receiver's actual `--installation` file and a fresh preparation output, then bind that profile through the maintained `configure` command.

Receive the included native project using the original worker and the actual SHA recorded by `handover.json`:

```sh
python3 -I /opt/merchant/stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/workflow_cli.py receive \
  --workspace /private/receiver/workflow \
  --archive /private/receiver/shopify-handover-20261013/native/delivery.zip \
  --sha256 ACTUAL_NATIVE_DELIVERY_SHA256 \
  --analysis-workspace /private/receiver/analysis
```

Open the restored Analysis project through its maintained operator. Reopen the same source versions, payout query, report and request history. Inspect each actual query export, including the header-only CSV, empty JSONL and zero-row SQLite schema when the original exception table is empty. Make the customer's agreed successor source or policy correction in the retained workflow, then export and receive its next complete project.

## 10. Retained files and repeat operation

| Capture path | Purpose |
| --- | --- |
| `selection.json` | Canonical selected configuration |
| `state.json` | Current state plus its canonical SHA-256 |
| `source-edition.json` | All eight complete editable source identities |
| `source/` | Exact acquisition and preparation source edition |
| `requests/` | Immutable GraphQL requests and variables |
| `raw/` | Original HTTP response bodies, including provider errors |
| `responses/` | Request/body relationships, timestamps, response headers, costs and diagnostics |
| `passes/` | Each complete-pass summary and projected original input |
| `cost-adjustments/` | Actual page-size changes after cost rejection, when present |
| `wait.json` | Most recent retained wait deadline, when present |
| `original-input.json` | Accepted complete selected source for the existing retail preparation |
| `capture-manifest.json` | Immutable complete inventory and selected-body identity |

The same capture command resumes acquisition; the same completed source returns its original result. Use a new named output for a later observation or policy edition. Keep its predecessor and native parent-request relation so the customer can compare the actual change and rerun the complete delivery.

## Official source references

- [Payments account and connection arguments](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/ShopifyPaymentsAccount)
- [Balance transaction fields](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/ShopifyPaymentsBalanceTransaction)
- [Payout fields](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/ShopifyPaymentsPayout)
- [Balance-transaction sort keys](https://shopify.dev/docs/api/admin-graphql/2026-10/enums/BalanceTransactionSortKeys)
- [Payout sort keys](https://shopify.dev/docs/api/admin-graphql/2026-10/enums/PayoutSortKeys)
- [Associated order](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/ShopifyPaymentsAssociatedOrder)
- [Associated payout](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/ShopifyPaymentsBalanceTransactionAssociatedPayout)
- [Adjustment order](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/ShopifyPaymentsAdjustmentOrder)
- [Transaction types](https://shopify.dev/docs/api/admin-graphql/2026-10/enums/ShopifyPaymentsTransactionType)
- [BigInt scalar](https://shopify.dev/docs/api/admin-graphql/2026-10/scalars/BigInt)
- [Access scopes](https://shopify.dev/docs/api/usage/access-scopes)
- [GraphQL pagination](https://shopify.dev/docs/api/usage/pagination-graphql)
- [Search syntax and diagnostics](https://shopify.dev/docs/api/usage/search-syntax)
- [API versioning](https://shopify.dev/docs/api/usage/versioning)
- [GraphQL query cost and throttling](https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits)
- [GraphQL status and errors](https://shopify.dev/docs/api/admin-graphql/latest#status-and-error-codes)
