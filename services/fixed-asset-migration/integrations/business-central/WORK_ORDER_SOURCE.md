# Native work-order source preparation

This addition connects original Dynaway responses to the existing **Work orders and costs** desk. It runs offline, uses the current fixed-asset engine's CSV, decimal and hash functions, and leaves its mapping, corrections, allocations, target matching, rehearsal, handover and reopen operations unchanged.

It prepares **retained source**, not a target import or accounting posting. Current Port of Bellingham tenant records and the complete issued RFP have not been received by this adapter. The companion fixture is expressly illustrative.

## Business Central metadata and readback companion

Use [MICROSOFT_CONTEXT_CONTRACT.json](MICROSOFT_CONTEXT_CONTRACT.json) for the source-bound company, currency, dimensions and readback capture plan. [MICROSOFT_SOURCE_INDEX.json](MICROSOFT_SOURCE_INDEX.json) retains the 21 official Microsoft references and their resource scope. [MICROSOFT_RECONCILIATION.md](MICROSOFT_RECONCILIATION.md) explains how those original records join the existing work-order and financial journals without inferring historical balances, target IDs, dimension allocations or currency conversion.

The required `companyContext` below is the contract's actual single `generalLedgerSetup` response. Currency decimal-place settings and rounding precision remain distinct original values; the preparer does not round amounts to two decimals. Dimension-set line GUIDs, default dimensions and posted dimensions remain distinct identities and evidence.

## Use the original application

From the complete existing application source, run:

```sh
node services/fixed-asset-migration/integrations/business-central/prepare-work-orders-cli.mjs \
  --capture /absolute/retained-work-order-capture.json \
  --out /absolute/prepared-original-work-orders
```

The output directory is immutable. Repeating the same capture reuses identical files; conflicting members fail preflight instead of overwriting an earlier edition. This is the same create-only publication pattern as the installed master preparer. Use a different explicit directory for another source edition.

For the existing browser/engine integration:

```js
import {prepareWorkOrderCapture}
  from './integrations/business-central/prepare-work-orders.mjs';

const prepared = prepareWorkOrderCapture(capture);
// prepared.scope describes original selection and missing fields.
// prepared.files contains every complete {path,mimeType,text,bytes,sha256}.
```

No additional npm package, server, account or credential is required.

## What can be prepared

| kind | Retained response | Identity and usable result |
| --- | --- | --- |
| resourceLines | One or more individually requested native resource line objects | Actual company + documentId + id; labor kind; explicitly selected quantity state. Actual line cost remains missing. |
| itemLines | Individually requested item line objects | Actual company + documentId + id; material kind and selected quantity. Actual cost remains missing. |
| expenseLines | Individually requested expense line objects | Actual expense/vendor/document/line identities. expectedUnitCostLCY remains a unit price, so no total cost is invented. |
| postedLedger | Complete ordered Analytics woLedgerEntries response pages | Actual company + ledger id; posted quantity; optionally selected actual or expected expense **line** cost. The documented projection does not establish the order header link. |

The individual GET routes are documented by Dynaway: [resource line](https://help.dynaway.com/eam-bc/api/v1/work-orders/get-res-line/), [item line](https://help.dynaway.com/eam-bc/api/v1/work-orders/get-item-line/), [expense line](https://help.dynaway.com/eam-bc/api/v1/work-orders/get-exp-line/). An individually selected set must declare population.complete=false; it does not prove the complete work-order population.

The [Analytics ledger response](https://help.dynaway.com/eam-bc/api/v1/ledger-entries/get-work-order-entries/) retains planNo separately. It is not substituted for a work-order number or document GUID. Resource, Item and Expense are mapped explicitly to the existing labor, material and expense kinds. Other native types remain unmapped.

## Complete capture contract

The schema is `tjlabs.business-central-work-order-capture.v1`. Supply actual tenantId, environment, companyId GUID, canonicalCompanyId, collectionUrl, observedAt, population, selection and pages. companyId identifies the original API company; canonicalCompanyId is the reviewed original workspace key. A division, location, project or dimension does not create a legal company.

For individual lines, supply the actual workOrderId GUID. collectionUrl ends in the corresponding workOrders(orderId)/workOrderResourceLines, workOrderItemLines or workOrderExpenseLines collection. Each pages[].url includes the individually requested line GUID in parentheses. The original response id must match that URI, and its documentId must match the selected order. These are documented single-record GETs; no undocumented collection-list capability is assumed.

For postedLedger, collectionUrl ends in `/api/dynaway/eamAnalytics/v1.0/companies(companyId)/woLedgerEntries`. Each pages[] entry has status 200, its literal requested url and complete bodyText; optional sha256 is verified. Optional requestId and etag stay attached to the original page. The first page and every @odata.nextLink must be retained in exact order. Repeated URLs, duplicate native IDs, missing continuations, another company/collection or a page after the terminal response fail.

A complete ledger population cannot start with a filtered, searched, limited or resumed URL. A selected subset must say complete=false and describe its selection. Even a complete page chain does not prove a transactionally consistent snapshot; retain the provider's actual export/observation basis. The adapter performs no HTTP request and follows no URL.

`selection` contains:

- quantityField: exactly quantity, qtyToConsume or qtyConsumed for individual lines; exactly quantity for posted ledger.
- actor and reason: the explicit reviewer and the selected quantity/cost basis.
- Optional expenseLineCostField: expenseActualLineCostLCY or expenseExpectedLineCostLCY, permitted only for postedLedger and applied only to literal Expense rows.
- For that LCY selection, lcyCode and lcySourceReference identify the actual company currency and reviewed source reference.

Selecting expenseLineCostField also requires **companyContext** with status=200, exact url and complete bodyText for the original single generalLedgerSetup record. Its actual returned id must match the URL key, its tenant/environment/company prefix must match the selected Dynaway capture, and localCurrencyCode must equal selection.lcyCode. Optional sha256 is verified. The complete company response is retained alongside the ledger originals.

Microsoft documents this [generalLedgerSetup GET](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/api/dynamics_generalledgersetup_get). Its example setup GUID is illustrative; obtain the real installed record. A currency symbol, another company's setting, or additional reporting currency cannot establish LCY. The existing workspace accepts three uppercase-letter currency codes; other actual codes require an explicitly reviewed supported mapping or product extension, never silent substitution.

## Exact output and deliberate missing values

| File | Original application use |
| --- | --- |
| work-order-source.csv | Import into the existing source/costs or target/costs selection and map the canonical columns explicitly. |
| source-findings.csv | Original rows whose required header link, amount, quantity or native kind remains unresolved. |
| originals/page-NNNN.json | Byte-identical full provider responses, preserving all unprojected fields. |
| originals/general-ledger-setup.json | Required original company LCY evidence when LCY line costs were selected. |
| capture.json | Complete selected capture and review inputs, including all original responses. |
| capture-scope.json | Native identities, row locations, page chain, exact mapping indexes, field types, review and limitations. |
| manifest.json | Complete prepared member paths, lengths and hashes. |

The canonical columns follow the installed work-orders.mjs FIELDS.costs order. capture-scope.json includes mappingColumns with the actual zero-based column indexes. The remaining columns preserve every native top-level field as `native:<field>`, paired with `native-type:<field>`. Scalar strings are directly readable/mappable, numbers retain their exact original lexical spelling, and objects/arrays stay complete JSON. The type column distinguishes absent members, null, empty strings, numbers and other JSON types.

Selected numeric values never pass through JavaScript Number. Exponents are expanded exactly; the original engine then validates its supported decimal range without rounding. Native numeric spellings—including trailing zeroes—and full response bytes stay retained. Repeated JSON member names are rejected so a second value cannot silently replace the mapped source.

The staging file does not insert an actual cost of zero when the source lacks one. An explicitly present numeric zero remains zero. Expected unit cost is never multiplied by quantity to manufacture a posted total. The selected line-cost basis remains actual or expected; no exchange conversion, tax adjustment, capitalization, or unit conversion is inferred.

The original Analytics example lacks an order header ID. That row therefore remains missing work_order_id even if its planNo is populated. Resolve it using the supplier's real additional export or an attributed original correction and supporting bridge, then preserve that review in the existing workspace. Do not pair records by similar descriptions, sequence numbers or amounts.

## Adopt through the existing journal and continue

1. Retain every supporting original and the prepared scope/manifest through the original `supporting` command. Each saved request supplies its original operationId, expectedRevision, filename, mimeType and purpose. Preserve returned receipts.
2. Import work-order-source.csv using the existing `wo-import` command, with the intended source or target role and domain costs. Save the complete request before invoking it; a retry uses that same operation ID and body.
3. Read the actual returned source ID. Use it in the separately saved `wo-map` request; copy the reviewed capture-scope mappingColumns. Do not invent a source ID or current revision.
4. Import the real order headers separately. Use source findings and the existing correction/column-mapping controls to resolve missing links and amounts from actual source evidence.
5. Continue the installed allocation, header readback, target cost matching, two rehearsals and original financial basis. A prepared API file cannot satisfy those outcomes by itself.
6. Export the original complete handover. At the independent receiving location, reopen the same workspace and inspect its original API files, exact numeric values, source rows, review operations and reconciliation.

```sh
node services/fixed-asset-migration/cli.mjs wo-import \
  --workspace /absolute/migration/workspace.json \
  --request /absolute/requests/import-native-costs.json \
  --csv /absolute/prepared-original-work-orders/work-order-source.csv

node services/fixed-asset-migration/cli.mjs wo-map \
  --workspace /absolute/migration/workspace.json \
  --request /absolute/requests/map-native-costs.json

node services/fixed-asset-migration/cli.mjs wo-report \
  --workspace /absolute/migration/workspace.json \
  --out /absolute/results/native-cost-readback.json

node services/fixed-asset-migration/cli.mjs handover \
  --workspace /absolute/migration/workspace.json \
  --out /absolute/results/complete-handover
```

The existing financial and work-order journals retain the operation history, original source and current basis. A source change does not replace the earlier receipt or turn an old rehearsal into a current acceptance.

All generated members are preflighted against the original file limit. The preparer also checks the aggregate and minimum base64 payload against the original workspace budget. Existing sources, operations, JSON escaping and later edits consume additional space; the original workspace's complete serialized limit remains authoritative. Select a smaller explicit complete scope when needed. Never truncate a page or discard historical originals to force import.

## Native posting and dimensions

[Posted work orders](https://help.dynaway.com/eam-bc/reporting-history/posted-work-orders/) are read-only history. Current line GET/POST/PATCH interfaces do not establish a supported migration route for arbitrary historical posted entries. Obtain the installed supplier import contract before any target load.

The [ledger UI documentation](https://help.dynaway.com/eam-bc/reporting-history/work-order-ledger-entries/) names links to original work orders, connected ledger entries, dimensions and fixed assets. Those UI labels do not prove equivalent API JSON fields. Bind actual installed metadata and preserve the full supported export.

[Project integration](https://help.dynaway.com/eam-bc/work-orders/integration-with-projects/) requires the relevant project and project line to be maintenance-marked. [Dimension setup](https://help.dynaway.com/eam-bc/dynaway-eam/dimension-setup/) describes EAM_MAINT priorities and creation-time inheritance. Neither fact defines the Port's multi-division percentage split. Preserve actual dimension sets, project/task links, source costs and the existing explicit allocation decisions separately.

## Receiving state

A focused exercise used the actual adapter and original engine/work-order module: a signed decimal beyond the safe JS integer range stayed exact; complete native numeric spelling and nested values survived; import/mapping/reopen retained a missing order link as an unresolved finding. This is an illustrative source-level exercise, not Port data or a tenant/native browser run.

The producing owner must run the exact installed CLI and existing application, open and LOOK at the real desktop/narrow result, use the mapping/correction/source controls, download all actual outputs and reopen the complete handover before calling it recipient ready. The current application owner's receiving operation remains the sole product/visual course. Do not use Bryce's personal browser during his reserved period.
