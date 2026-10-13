# Business Central and Dynaway source preparation

This module prepares complete, already-received native asset-master responses for the existing fixed-asset migration workspace. It preserves each original response, the actual company and native record IDs, the business-number crosswalk, the observed page chain, and the distinction between maintenance and financial assets.

The installed product remains `services/fixed-asset-migration/`. Its six-domain engine, supporting-file journal, mappings, corrections, financial basis, handover and reopen functions are unchanged. Work-order costs and reviewed allocations use the product's separate work-order contribution.

## What is implemented

- A pure JavaScript `prepareMasterCapture(capture)` function for standard Business Central `fixedAssets` and Dynaway `assets` responses.
- A command-line preparer that publishes complete immutable output files. An interrupted retry reuses exact completed files; a different edition cannot overwrite them.
- Machine-readable provider contracts, source references and field mapping.
- The original `assets.csv` format, native GUID/business-number crosswalk, maintenance-to-fixed-asset links, exact raw pages and a manifest.

This module makes no network request, holds no credentials, changes no tenant record and invokes no posting action. A prepared master is not financial reconciliation. The source index records the actual public documentation inspected on 13 October 2026; current customer settings and the full issued procurement remain separate inputs.

## Run the preparer

Use the same Node runtime as the existing workspace. No new package is required.

~~~sh
node services/fixed-asset-migration/integrations/business-central/prepare-master-cli.mjs \
  --capture /absolute/native-master-capture.json \
  --out /absolute/prepared-native-master
~~~

For an existing browser or source receiver, import the pure function:

~~~js
import {prepareMasterCapture}
  from './integrations/business-central/prepare-master.mjs';

const prepared = prepareMasterCapture(capture);
for (const file of prepared.files) {
  // file.path, file.mimeType, file.text, file.bytes, file.sha256
  // Retain complete files through the original supporting-file/import workflow.
}
~~~

The included `capture-example.json` is an explicitly illustrative two-page maintenance response. Its GUIDs, tenant name and records are examples, not a customer export. It exercises punctuation, an embedded newline and two maintenance assets linked to one fixed asset. Replace the entire capture with the original selected provider responses; do not relabel the example as received source.

## Capture contract

`schema` is `tjlabs.business-central-master-capture.v1`. Supply:

| Field | Meaning |
| --- | --- |
| kind | `fixedAssets` or `maintenanceAssets` |
| tenantId / environment | Actual selected tenant and environment, retained literally |
| companyId | Actual native company GUID |
| canonicalCompanyId | Explicit company key used by the original migration workspace |
| collectionUrl | Exact HTTPS company collection, with no query, credentials or fragment |
| observedAt | Actual ISO capture time; the preparer does not generate an observation |
| population.complete | Operator declaration of the full selected master population |
| population.description | Selection, exclusions, filters, snapshot/export basis and observation limitations |
| pages | Ordered complete HTTP 200 responses with `url` and exact UTF-8 `bodyText` |
| pages[].sha256 | Optional prior hash, checked against complete response text |
| pages[].requestId / etag | Optional original text metadata; never an authorization header dump |

Each body must contain its native `value` array. The next page URL must exactly match the previous `@odata.nextLink`; every continuation must be received. A terminal page ends the capture. Repeated URLs, native record IDs or business numbers fail preparation. Continuations must retain the selected company collection and contain no authentication query value. A declaration of a complete population cannot begin with a filter, search, apply, top, skip or skip-token selection.

Only the original literal URLs are retained; this module does not follow them. Complete pagination proves a received page chain. It does not establish a transactionally consistent export if records changed during capture. Retain the actual provider snapshot/export basis and capture interval in the source description. An intentionally filtered complete chain must declare `population.complete:false`.

The original engine limits apply: 100,000 master rows, 32 MiB per raw supporting file and CSV, 128 supporting files, and a 128 MiB portable workspace. Raw page text is limited to 128 MiB in aggregate and at most 124 pages, reserving four supporting-file slots for this module's crosswalks, scope and manifest. The whole workspace also includes base64 overhead, other sources and journal history, so its original import/export limit remains authoritative. Preserve a complete independent source scope when an existing workspace has insufficient room; do not truncate source pages.

## Output and original workspace adoption

| File | Purpose |
| --- | --- |
| assets.csv | Exact original asset domain: company_id, asset_id, parent_asset_id, class_code, description |
| native-identities.csv | Native API kind, GUID, literal business number, ETag, original page and zero-based array index |
| maintenance-fixed-asset-links.csv | Every native maintenance-to-financial link, with its original record location |
| originals/page-NNNN.json | Byte-identical UTF-8 response text, including additional unprojected fields |
| capture-scope.json | Selected tenant/company, actual source scope, native page chain and limitations |
| manifest.json | Full file lengths/hashes and the same source scope |

Import the complete original pages, crosswalks, scope and manifest through the existing `supporting` action. Import the selected prepared CSV through the original `import` action with domain `assets`, then use the existing `map` action. The five column indexes are 0 through 4; amount_multiplier is 1. Every action keeps its own original operationId and expectedRevision. A request retry uses its saved original body and operation ID.

A minimal saved asset import request, after selecting the actual current workspace revision, is:

~~~json
{
  "operationId": "bc-master-import-selected-edition",
  "expectedRevision": 6,
  "role": "source",
  "domain": "assets",
  "filename": "assets.csv",
  "observedAt": "2026-10-13T16:00:00Z"
}
~~~

The revision and timestamp above are illustrative. Use the actual saved workspace values and capture time.

~~~sh
node services/fixed-asset-migration/cli.mjs import \
  --workspace /absolute/migration-workspace.json \
  --request /absolute/saved-import-request.json \
  --csv /absolute/prepared-native-master/assets.csv
~~~

The command returns the source ID for the separately saved mapping request. For each retained supporting file, the original `supporting` command takes `--file`, plus a saved request containing operationId, expectedRevision, filename, mimeType and purpose. The existing browser performs the same original journal actions.

**Choose the financial master deliberately.** Standard `fixedAssets.number` is the fixed-asset business key used to join financial exports. Dynaway `assetNo` is a maintenance identity. Keep the maintenance capture as work-order context/supporting source when the financial workspace already uses fixed-asset numbers. Do not replace that financial master with maintenance assets or union the two identity spaces. Several maintenance assets can link to one fixed asset; preserve all those links while counting its financial balance once.

For a maintenance-only master review, the adapter preserves `parentAssetNo` and `categoryCode`; the original engine detects missing parents and cycles. A maintenance category is not automatically a financial fixed-asset class. Standard fixed-asset parent hierarchy is left blank because the documented card projection does not establish it.

## Complete the financial and work-order delivery

`FIELD_MAPPING.csv` and `PROVIDER_CONTRACTS.json` carry the exact source-to-workspace distinctions. The preparer creates no books, balances, movements, journals or control totals. Obtain those complete exports from the actual source and target, preserving company, book, currency, dates, posting identity, amount scale and exact decimal strings.

Use the existing work-order contribution to retain original order/cost CSVs, reviewed field mappings, corrections, allocation decisions and actual-return matches. Expected cost, actual posted cost, budget and capitalization are different bases. A quantity is not a currency amount. An expense's expected unit cost multiplied by its quantity does not prove an actual posting. A missing native amount stays missing.

Native resource, item and expense line records retain their `id` and `documentId`. The analytics ledger `id` is a ledger-entry identity. Its published `planNo` is a maintenance-plan number and cannot be substituted for a work-order GUID. The documented ledger sample does not establish all resource/item actual costs or an order-header link. Obtain a supported actual export/metadata field or record an explicitly reviewed source-to-target match; do not pair by description, sequence or amount alone.

For allocations, retain each source cost's signed decimal amount and separate currency/cost basis. Explicit destination amounts must sum to the original amount. A company is not inferred from a division or dimension. Keep the actual project/task references and original dimension setup. Dynaway's project integration requires the selected project and receiving project line to be marked for maintenance, and applies its configured dimension priorities. Inspect those actual settings before using that path. [Dynaway project integration](https://help.dynaway.com/eam-bc/work-orders/integration-with-projects/) · [dimension setup](https://help.dynaway.com/eam-bc/dynaway-eam/dimension-setup/)

The original financial engine then compares complete source/target rows, movement roll-forwards, journal balance and declared carrying equations. It requires the actual financial basis and population declarations; a master-only capture remains financially incomplete. Export the full original handover, receive it at a new location and compare the exact source files, mapping/correction history, supporting bytes and financial result.

## Native target selection and recovery

An authorized native receiver should retain tenant, environment, company GUID and LCY, installed Business Central/Dynaway versions, actual API metadata, selected import template, filters and account permissions. Reuse the existing approved application/account route. Microsoft's existing S2S route distinguishes API and automation permissions and applies Business Central object permissions. This module does not create an application or request tenant-wide authority. [Microsoft S2S contract](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/administration/automation-apis-using-s2s-authentication)

Native import and posting are separate operator actions. Download the selected installed assisted-setup template and validate the complete prepared workbook against it; template availability does not establish that arbitrary historical posted entries can be imported. Native fixed-asset journal choice depends on the selected depreciation book's G/L integration. [Dynaway assisted setup](https://help.dynaway.com/eam-bc/dynaway-eam/use-the-assisted-setup-wizard/) · [Microsoft fixed-asset setup](https://learn.microsoft.com/en-us/dynamics365/business-central/fa-setup)

Before a target edit, preserve its current native ID and ETag where supported. Preserve request bytes/hash, provider status, request/correlation ID, complete response and returned ledger IDs. Microsoft fixed-asset PATCH requires If-Match. Posting and closing have distinct native meanings; an uncertain post must be reconciled against the original native operation and resulting entries before retrying. No provider idempotency guarantee is asserted here. Follow actual provider 429/timeout instructions and continuation tokens. [Microsoft fixed-asset PATCH](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/api/dynamics_fixedasset_update) · [API limits](https://learn.microsoft.com/en-us/dynamics365/business-central/dev-itpro/api-reference/v2.0/dynamics-rate-limits)

Two documentation discrepancies remain explicit: Microsoft's fixed-asset update example uses business-number-looking IDs despite GUID resource typing and includes extra financial fields; Dynaway's example posting URI omits a closing company parenthesis. The preparer requires actual GUID master identities and never constructs a posting URL. Resolve installed metadata instead of treating these examples as tenant facts.

## Receiving and review status

The exact adapter and original engine were executed together in V8 using an illustrative interface fixture. The run retained complete raw pages, two maintenance links to one financial asset, original supporting/import/mapping receipts, unchanged replay, and exact portable export/reopen. It confirmed that master-only data remains financially incomplete and rejected missing/different-company continuations, an encoded limited full-population request, duplicate native identity and an invalid date.

That is a source-level producer/consumer check. It is not a customer tenant run, a native Node CLI run or a rendered browser review. The whole joined product's original receiving operation must run the command, import actual selected sources, operate the important browser controls at desktop and narrow widths, and inspect real exported/reopened files. Preserve that single receiving operation and its original source/target identities.
