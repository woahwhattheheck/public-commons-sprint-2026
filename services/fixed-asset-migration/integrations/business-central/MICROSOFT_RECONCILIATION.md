# Business Central accounting context and migration readback

This companion configures the existing fixed-asset migration workspace and its Business Central/Dynaway source preparers. It preserves actual source identity and accounting meaning before any destination import. It does not discover a customer tenant, authenticate, modify records, post journals or replace the supplier's import process.

Use `MICROSOFT_CONTEXT_CONTRACT.json` as the reusable acquisition/review configuration and `MICROSOFT_SOURCE_INDEX.json` for the official documentation reviewed on 13 October 2026. Unconfigured deployment values are deliberately null. The documentation describes a product capability, not proof that a particular customer has that API, version, permission or accounting policy.

## 1. Bind the actual company before preparing rows

Keep tenant, environment and company GUID together. Retain the original company response with its business name and system version; a display name is not a durable record key. Preserve native GUIDs and business numbers in separate columns. Microsoft distinguishes immutable SystemId from business fields; a record timestamp/rowversion must not be treated as an observation time. [Microsoft company resource](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/resources/dynamics_company) · [System fields](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/developer/devenv-table-system-fields).

For Business Central Online, the environment route and the API version are separate path components:

```text
https://api.businesscentral.dynamics.com/v2.0/{tenantId}/{environment}/api/v2.0
https://api.businesscentral.dynamics.com/v2.0/{tenantId}/{environment}/api/dynaway/eam/v1.0
https://api.businesscentral.dynamics.com/v2.0/{tenantId}/{environment}/api/dynaway/eamAnalytics/v1.0
```

Use the actual installed service root for on-premises deployments. The preparers retain the exact company path and source URL; they do not convert alternate routes or infer an environment from a business name. Capture the installed service document/metadata and its observation time before selecting fields. [Microsoft endpoint structure](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/webservices/api-endpoint-structure).

## 2. Supply real LCY evidence to the work-order preparer

When `selection.expenseLineCostField` selects a documented posted expense line amount, include `capture.companyContext` with the **original single-record General Ledger Setup response**:

```text
GET {actualApiRoot}/companies({actualCompanyId})/generalLedgerSetup({actualSetupId})
```

The documented GET returns an object. Use the setup GUID actually returned by that tenant; the example GUID in Microsoft's documentation is not a discovery mechanism. The selected company, response `id` and `localCurrencyCode` must match the captured URL and `selection.lcyCode`. Preserve complete `bodyText`, HTTP status, original URL and its computed bytes/SHA. The source preparer retains it as `originals/general-ledger-setup.json`; its `/localCurrencyCode` pointer supplies the source binding. Retain the reviewer's `lcySourceReference` alongside that computed evidence. [GET contract](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/api/dynamics_generalledgersetup_get) · [Setup fields](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/resources/dynamics_generalledgersetup).

Company Information's `currencyCode` is documented as a default currency. It is not a substitute for the direct accounting setup in this adapter. [Company Information](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/resources/dynamics_companyinformation).

Business Central uses a blank transaction currency for LCY and does not require a duplicate LCY record in the currency list. Its general ledger is recorded in LCY; original foreign-currency provenance requires the underlying documents. Additional reporting currency remains a different quantity. Do not infer USD from a dollar symbol or aggregate the two bases. [Currency semantics](https://learn.microsoft.com/en-us/dynamics365/business-central/finance-currencies).

## 3. Preserve exact money and quantity independently

The source preparer parses numeric tokens without a JavaScript floating-point round-trip. The original response and `native:*` columns retain those spellings; canonical decimal fields use the existing engine's exact arithmetic. Selecting `quantity`, `qtyToConsume` or `qtyConsumed` is an explicit review decision. A unit price is not a posted line cost; missing cost stays missing.

The current canonical engine accepts three uppercase currency letters. That is an engine constraint, not a claim that every Business Central code has that shape. An unsupported original code needs an attributed, source-backed mapping; do not silently truncate or uppercase it.

For each relevant currency, retain `id`, `code`, `amountDecimalPlaces` and `amountRoundingPrecision`. The first precision field is a **string**, the second a **decimal**; display precision and rounding interval are separate settings. Preserve them lexically and never assume two decimals. The standard General Ledger Setup resource does not list LCY amount-rounding fields, so obtain an actual supported setup export if those settings are needed. [Currency API](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/resources/dynamics_currency).

## 4. Keep dimensions as original relationships

| Original record | Preserve | Canonical use |
| --- | --- | --- |
| Dimension | Company, dimension GUID and code | Identifies the accounting axis. |
| Dimension value | Company, dimension GUID, value GUID and code | Resolves a value within its own dimension. |
| Dimension-set line | Company, parent type/GUID, line GUID, dimension code and value GUID/code | Retains the actual parent-bound classification. |
| Default dimension | Original parent, dimension/value and postingValidation | Retains proposed/default policy; it is not evidence of a posted value. |

The configuration uses documented parent-scoped G/L dimension reads. It does not assert that a Dynaway work order automatically shares that parent identity. Capture the actual original order/ledger link before mapping the classification. [Dimension](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/resources/dynamics_dimension) · [Values](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/resources/dynamics_dimensionvalue) · [Set lines](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/resources/dynamics_dimensionsetline).

The API's `dimensionSetLine.id` is the line GUID, **not** the internal numeric Dimension Set ID. The listed fields do not expose that numeric key. Leave canonical `dimension_set_id` unpopulated until an actual export or supported API establishes it. Do not substitute `parentId`, `dimensionId` or a synthesized concatenation. [Parent-scoped GET](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/api/dynamics_dimensionsetline_get).

Map canonical `dimension_1`/`dimension_2` only after matching the captured shortcut-dimension codes and the exact original parent. Retain every other dimension line as source evidence. Two global or eight shortcut positions do not exhaust possible dimension sets. Defaults, priority conflicts and blocked combinations can change posting behavior; retain their actual policy where relevant. [Dimension policy](https://learn.microsoft.com/en-us/dynamics365/business-central/finance-dimensions) · [Default-dimension fields](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/resources/dynamics_defaultdimension).

A department or project code does not supply an allocation percentage. Existing work-order allocation review still conserves signed amount and original quantity independently within the original company, currency, basis, kind and unit. Never manufacture a division split from labels.

## 5. Separate master, maintenance history and financial opening state

The standard `fixedAssets` property list describes the asset master. It does not establish a complete acquisition-cost, depreciation-book or opening-balance dataset. Dynaway maintenance identities and their financial-asset links stay distinct; several maintenance assets can reference one financial asset without duplicating its balance. [Fixed-asset resource](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/resources/dynamics_fixedasset).

The current fixed-asset PATCH documentation contains illustrative business-number IDs and extra financial fields that conflict with its resource table. Resolve that discrepancy using installed metadata and actual source responses. Do not create a guessed financial import endpoint from the example. Standard API fields cannot simply be extended in place; a supported custom API/export needs its own retained contract. [PATCH example](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/api/dynamics_fixedasset_update) · [API overview](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/).

For the original six domains, obtain the actual books, balances, events, journals and controls in addition to assets. Preserve asset/book/date/currency/measure and the source's sign convention. Acquisition cost, accumulated depreciation, write-downs and net book value are different measures.

Microsoft's initial FA setup treats acquisition and accumulated-depreciation opening entries separately and makes depreciation-book G/L integration relevant to the transition. The supplier must choose a reviewed opening-balance or detailed-history strategy; this adapter does not change that setup or post it. Retain the existing G/L state so imported history is not posted a second time. [FA opening setup](https://learn.microsoft.com/en-us/dynamics365/business-central/fa-how-setup-general).

Maintenance costs are not automatically capitalized acquisition cost. Preserve their actual expected/actual classification and explicit original financial linkage. A historical ledger read API does not establish a supported historical write operation.

## 6. Read back actual target effects

For reviewed master updates, preserve the exact original `@odata.etag`/ETag and use the supplier's supported `If-Match` contract. A changed tag calls for a fresh read and reconciliation; replacing it with a wildcard would discard the concurrency protection. A successful PATCH can also recalculate omitted fields, so retain the actual returned object and independent readback of relevant relationships. [Fixed-asset update](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/api/dynamics_fixedasset_update).

Record source and target identities separately, actual request/payload hash, before/after ETags, HTTP and request/correlation IDs, response hash, observed time, reviewed fields and any original posted-entry IDs. A matching count or HTTP200 is not financial acceptance.

The standard G/L entry exposes separate debit/credit and additional-currency debit/credit values. Keep them within their declared currency basis; retain account/document/date/native IDs and parent dimension lines. It is a GET resource, not a journal import contract. [G/L entries](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/resources/dynamics_generalledgerentry).

Reconcile the supplier's actual FA Book Value, Register and G/L Analysis populations against the selected books and cutoff. Those reports answer different questions; none substitutes for all original six-domain controls. [FA report catalogue](https://learn.microsoft.com/en-us/dynamics365/business-central/fa-reports).

## 7. Use the existing workspace and preserve the complete delivery

1. Retain complete authorized original pages and the exact page chain; document population/filter and snapshot basis. Paging completeness does not establish a transactionally consistent snapshot.
2. Prepare master data with `prepareMasterCapture` and work-order source data with `prepareWorkOrderCapture`. Select quantity/cost basis and supply original company context when required.
3. Import the resulting source CSV into the existing Work orders and costs desk. Use its current mapping, attributed corrections, allocation review, target readback and acceptance operations. Missing headers, cost, units or target links stay visible.
4. Retain every original response, capture, scope, mapping and findings file through the original supporting-file API. Original limits apply to every member and the complete portable workspace; split a genuinely separate scope explicitly rather than truncate a response.
5. Reopen the delivered workspace and handover through the existing receiver. The original financial and work-order acceptance results remain separate and require their actual source populations.

Before presenting the outgoing app or attachments as ready, the responsible receiver must open and visually inspect the exact delivered version, operate its important controls and reopen all attachments in their normal viewer. Source review alone is not rendered acceptance. This work uses isolated/cloud execution only while the owner's local browser is reserved.

## Current evidence boundary

This contract was checked against Microsoft's official documentation and the maintained workspace source. It does not assert access to a Port of Bellingham tenant, current database, supplier import template or operational accounting approvals. Actual supplier records, full issuer package and destination configuration remain separate intake inputs. Missing evidence remains named rather than filled with sample IDs, zero amounts or assumed policies.
