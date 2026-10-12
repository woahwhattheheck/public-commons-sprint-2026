# Connector sources and ERP mapping changes

Open **WooCommerce → Order ERP delivery → Connector sources**. Retain actual configuration/schema exports, freeze reviewed source editions, compile explicit source rules into the existing ERP map, and keep source changes and order impact available for the next operator.

Inputs are actual JSON exports from installed configuration/schema/data screens, or explicitly delimited CSV files. The source is never treated as a discovered vendor HTTP endpoint. The existing Acumatica **25.200.001** order delivery, approval, exact-decimal calculation, tax receiving and owned-line correction remain the execution path in [ERP.md](ERP.md).

## Install the complete source

Keep the complete merchant plugin folder together. In addition to its existing ERP files, the entry loads:

| Files | Purpose |
|---|---|
| merchant-kcf.php | Authenticated routes and the source workspace lifecycle |
| merchant-kcf-source.php | Lossless JSON/CSV inspection, scopes, projections and exact value rules |
| merchant-kcf-store.php | Immutable source objects, installation revisions and operation results |
| merchant-kcf-mapping.php | Native map compilation, source comparisons and guarded application |
| merchant-kcf-project.php | Complete private export/import and original ERP companions |
| merchant-kcf-console.php, merchant-kcf.js, merchant-kcf.css | Integrated operator view |

The desktop toolkit also needs `merchant-kcf-client.mjs`, loaded by the original merchant client, and the updated `merchant-erp-cli.mjs`. Keep this guide, [kcf-receipt.example.json](kcf-receipt.example.json) and [kcf-source.example.json](kcf-source.example.json). The examples are illustrative documentation, not customer records or a KCF response schema.

The extension uses PHP 8+, the existing WordPress database and manager permission, the original checkout lock, and the existing Node 22+ merchant transport. It adds no package dependency or hosted task. Its private tables are `<prefix>sf104_kcf_objects`, `<prefix>sf104_kcf_heads` and `<prefix>sf104_kcf_operations`. Copy all source files when upgrading: the old ERP-only inventory no longer supplies the complete plugin.

## 1. Identify the installed application

Create or open an installation using the complete tuple:

| Field | Meaning |
|---|---|
| Application URL | Actual Acumatica URL, including its virtual-directory path |
| Tenant | Exact installed tenant text |
| Company | Exact company text |
| Connector ID | Exact configured connector identity |

Applications sharing a host remain distinct when their paths differ. IDs retain case and leading zeros. Plugin identity/version, framework version, package name/hash, environment label and credential parameter references belong to each immutable source edition. A changed plugin or version appears in its comparison. Credential references contain environment **names**; source intake resolves no live secret.

Save this create request privately, replacing the example tuple:

```json
{
  "operationId": "connector-installation-20261012-001",
  "name": "Reviewed commerce installation",
  "identity": {
    "applicationUrl": "https://erp.example.com/Commerce",
    "tenant": "Tenant-A",
    "company": "001",
    "connectorId": "WEB-01"
  }
}
```

```sh
node merchant-erp-cli.mjs kcf-create --config /private/operator.json --input /private/installation-request.json
node merchant-erp-cli.mjs kcf-status --config /private/operator.json --page 1 --limit 50
```

Use actual returned references in subsequent commands. INSTALLATION_SHA, RECEIPT_SHA and similar names below are placeholders.

## 2. Retain the original file and its scope

On **Sources**, select the exact file, source screen/export command, reference, optional recorded extraction time and actual scope. The raw file is retained by SHA-256; every intake creates a distinct observation receipt. Identical bytes can legitimately be observed again. A changed filename or receipt does not imply changed content.

An edition selects one receipt per named logical slot. Use stable slots such as product-schema, product-data, country-substitutions and state-substitutions. Separate scoped captures belong in separate named slots. Selecting a newer receipt never erases its predecessor.

| Scope | Interpretation |
|---|---|
| Family | Configuration; product/customer/category schema or data; countries; states; logs; installed contract; or explicit other source |
| Coverage | COMPLETE, PARTIAL, SINGLE_ENTITY or UNKNOWN according to the extraction |
| Selection | ALL, exact IDS, or the original FILTER |
| IDs | Exact selected IDs; SINGLE_ENTITY requires one ID |
| Filter | Exact extraction filter when FILTER is selected |
| Window / active selection | Actual time/version window and active/inactive selection, where present |

COMPLETE describes only the declared selection. A single-record lookup is not a complete catalog. Scope is a retained operator statement about the extraction; the app does not crawl the vendor or independently certify completeness.

### Project actual rows and fields

The projection selects comparison rows without rewriting the original file:

- **Row pointer** selects an array or one record. Empty means the original root.
- **Identity pointers** select exact fields relative to each row. Include the real country, company or parent key where necessary.
- **Comparison fields** select row-relative fields with stable labels. An empty list compares the complete projected record.
- Label the actual boolean activation field **active** when deliberate use of disabled rows should require a reason.

Pointers use RFC 6901: `/products/0/inventory_id`. Escape a source slash as `~1` and a tilde as `~0`. CSV root rows use `/0/Exact Header`; headers and all cell values remain strings.

The paged source browser shows actual typed values. JSON numbers retain their exact lexemes, including decimal precision. String "00017", number 17, null, false, zero and an absent value remain different. Repeated JSON keys, repeated projected identities, malformed UTF-8 and unequal CSV row widths produce an INVALID receipt whose complete original remains downloadable. Correct the source or retain another observation with an accurate projection.

The CLI completes the metadata file with actual bytes and SHA:

```sh
node merchant-erp-cli.mjs kcf-source-add --config /private/operator.json --installation INSTALLATION_SHA --input /private/receipt-request.json --file /private/actual-product-export.json
node merchant-erp-cli.mjs kcf-browse --config /private/operator.json --installation INSTALLATION_SHA --receipt RECEIPT_SHA --pointer /products --page 1 --limit 50
node merchant-erp-cli.mjs kcf-source-download --config /private/operator.json --installation INSTALLATION_SHA --receipt RECEIPT_SHA --out /private/retained-original.json
```

[kcf-receipt.example.json](kcf-receipt.example.json) supplies the full metadata shape. Match its row/field pointers to the actual file. Its file metadata is completed by `--file`; direct client/API requests supply contentBase64 and sha256. To observe the same retained bytes again, omit file and use reuseReceiptId with a new operation ID and actual scope/observation.

## 3. Freeze the source edition

Select one receipt per slot, review installation metadata, name the edition and record a reason. Save with the current workspace revision. The edition retains all receipt IDs, the preceding selected edition, metadata and operator. A new edition clears the selected recipe; historical recipes remain available.

```json
{
  "operationId": "connector-edition-20261012-001",
  "expectedRevision": 0,
  "label": "Reviewed source before mapping change",
  "receiptIds": ["RECEIPT_SHA"],
  "metadata": {
    "pluginId": "Actual plugin identity",
    "pluginVersion": "",
    "frameworkVersion": "",
    "packageName": "",
    "packageSha256": "",
    "environment": "Reviewed environment",
    "credentialReferences": [
      {"name": "Configured parameter", "environmentVariable": "ACTUAL_CREDENTIAL_ENV"}
    ]
  },
  "reason": "Describe the actual source selection and review."
}
```

Use `kcf-edition-save --installation INSTALLATION_SHA --input /private/edition-request.json` with the original --config. Source selection is separate from the current ERP map selection. Opening an old edition or keeping a new receipt draft does not send an ERP request.

## 4. Compile the reviewed source into the existing map

Create the original ERP map first through its Mapping page or map-save. A source recipe starts from that immutable map. It can assign supported header/target values, customer/product/fee bindings, the original shipping binding and reviewed address substitutions.

For each assignment select the original ERP destination, exact Woo source key, actual receipt/field pointer or reviewed typed constant, explicit conversion and any typed value translations. Using a row whose projected active flag is false requires a deliberate selection and reason.

Missing/null values and containers do not become empty strings. A JSON number requires explicit number-to-text or integer conversion. Exact translations compare the original typed value; when translations are supplied, an unmatched value is an error. Text trimming/case conversion is explicit.

The original ERP compiler still validates field sizes, precision, binding shape and installed target contract. If it would trim an unreviewed captured string, preview requires the explicit transformation. Customer ID precedes billing email; variation/product ID precedes SKU. Recipes using those fallback keys require review of their native priority.

An assignment inside the complete recipe looks like:

```json
{
  "target": {"table": "productBindings", "sourceKey": "product:42", "field": "inventoryId"},
  "rule": {
    "receiptId": "RECEIPT_SHA",
    "pointer": "/products/0/inventory_id",
    "conversion": "preserve",
    "values": []
  }
}
```

The Woo ID is an actual selected source ID, never an array position or inferred ERP key. [kcf-recipe.example.json](kcf-recipe.example.json) provides the complete request shape with distinct product/country/state receipt references. Replace its placeholders with actual returned IDs; all referenced receipts must belong to the selected edition. The full recipe has sourceEditionId, baseMapId, label, assignments, removals, substitutions, acknowledgeLookupPriority and reason. Its save request additionally names operationId and expectedRevision.

A deliberate removal names the binding table, exact original key and reason. A source omission never removes a binding. A recipe cannot remove and assign the same binding in one operation.

Review every assignment, the complete resulting map and all issues. Save the recipe, then apply its retained preview SHA using the current original map ID and reason:

```sh
node merchant-erp-cli.mjs kcf-recipe-save --config /private/operator.json --installation INSTALLATION_SHA --input /private/recipe-request.json
node merchant-erp-cli.mjs kcf-preview --config /private/operator.json --installation INSTALLATION_SHA --recipe RECIPE_SHA --out /private/map-preview.json
node merchant-erp-cli.mjs kcf-map-apply --config /private/operator.json --installation INSTALLATION_SHA --recipe RECIPE_SHA --input /private/apply-request.json
```

The apply request is {operationId, expectedCurrentMapId, previewSha256, reason}. Optional allowHistoricalSource=true records deliberate use of a historical source edition. Its base must still be the current ERP map, preventing an old recipe from discarding another operator's edits. Apply calls the original map store and returns its actual ID plus source/recipe lineage. It does not prepare, approve or deliver orders.

### Country and state substitutions

For Woo → ERP, explicitly map **Connector Country/State to Acumatica Country/State**. A state row retains connectorCountry, acumaticaCountry, connectorState and acumaticaState. Country rows retain both country identities. Every value is a typed source rule, as above.

State matching uses the original connector country/state before country translation. If the Acumatica country differs, include the explicit country rule. Duplicate incoming country keys or country-scoped state keys are rejected. Reverse lookup is not guessed from a possibly many-to-one list.

The compiled map retains sourceEditionId, countries, states, unmappedCountries and unmappedStates. Choose preserve or error for unmatched nonblank values. Empty optional states remain empty.

Substitutions apply only to `addressMode=order_override`. Original separate billing/shipping addresses and the shipping-to-billing fallback are preserved; each resulting address is mapped once. Customer_default continues using existing ERP customer addresses with both override flags false. Raw Woo source and source SHA stay unchanged; the map digest and resulting plan retain the substitution revision.

The ERP Mapping page shows the source edition, rule counts and unmatched policies. Complete mapping JSON export includes every rule.

## 5. Compare the next actual extraction

Retain the new files and freeze another edition. **Changes** compares selected immutable editions, with complete paged/searchable results and on-demand before/after values.

| Result | Meaning |
|---|---|
| UNCHANGED / CHANGED | Same observed identity and projection on both sides |
| ADDED_TO_COMPLETE_SCOPE / REMOVED_FROM_COMPLETE_SCOPE | Same declared complete family/IDs/filter/window/active-selection, and same explicit identity projection |
| NEW_OBSERVATION / NOT_OBSERVED_AFTER | Presence differs without establishing a complete common census |
| SCOPE_CHANGED | Declared scope, coverage or projection changed |
| SCOPE_ADDED / SCOPE_NOT_SELECTED | Logical slot selected on only one side |
| INSTALLATION_CHANGED | Captured plugin/version/package/environment or credential-reference metadata changed |
| SOURCE_INVALID | Original file cannot support its declared projection |

Different families or projections do not have their row IDs joined as if they were the same entity. Without explicit identity fields this is a path projection, and absence is never a catalog removal. Missing/null/zero/false and exact scalar types remain distinct.

Record RETAIN_MAPPING, REVISE_MAPPING or RECAPTURE_SCOPE with a reason and exact comparison SHA. The review retains complete counts/scopes and an optional next recipe. It does not alter results or apply a map.

**Related original order editions** shows every edition using the recipe's base or source-linked map, with links to the real order journal. Existing orders retain their prior maps. Follow the normal prepare/review/receiving flow for a selected change.

## 6. Recover interrupted saves and complete the handoff

Every mutation has a stable operation ID and exact request digest. Source selections/recipes require the current installation revision; applying a map requires its original current ID.

After a lost response, use **Check retained result** or kcf-operation. Retry only the same original request. Map application records PENDING before the native save, so retry can finalize an already-saved map without selecting another revision. A subsequently selected different map is never overwritten by the pending request.

The UI retains an unresolved request in memory and can download its exact private JSON for reopening after browser restart. It does not store credentials or source drafts in local storage. Save or download unfinished work before closing the page.

The complete private connector package contains every original file, observation/scope/projection, source edition, recipe, native map lineage, review, operation history and earlier receiving receipt. It includes every related original ERP order project when includeOrders is selected. Original ERP exports also carry source companions for applied maps with source lineage.

Import merges exact immutable objects and preserves a newer local source selection/current map. Original order imports retain native behavior: no divergent live journal is replaced, and original Woo binding plus actual target reconciliation precede another delivery. Source-only import retains maps without selecting them. Pending full imports resume with the same operation ID, retaining already-completed source work.

Private packages may contain customer/order data and sensitive original configuration. Credential-reference fields contain names, but raw uploaded exports are unredacted originals. Configure live secrets separately. This package does not recreate the WordPress database, Woo order keys or installed source; retain them through the store's normal backup process.

```sh
node merchant-erp-cli.mjs kcf-export --config /private/operator.json --installation INSTALLATION_SHA --include-orders yes --out /private/complete-connector.json
node merchant-erp-cli.mjs kcf-import --config /private/receiving-operator.json --input /private/complete-connector.json --operation-id receive-connector-original-001
node merchant-erp-cli.mjs kcf-operation --config /private/receiving-operator.json --installation INSTALLATION_SHA --operation-id receive-connector-original-001
```

## Client and routes

`createMerchantClient(config)` exposes these methods on the original authenticated transport. GET methods return native objects; mutations return {httpStatus,response}. File output is mode 0600, create-only with exact equal-content reuse.

| Area | Methods |
|---|---|
| Installation | kcfStatus, kcfCreateInstallation, kcfInstallation, kcfSelect |
| Source | kcfList, kcfRetainSource, kcfReceipt, kcfBrowse, kcfOriginal |
| Edition | kcfSaveEdition, kcfEdition |
| Mapping | kcfSaveRecipe, kcfRecipe, kcfPreview, kcfPreviewDraft, kcfApply, kcfImpacts |
| Review | kcfCompare, kcfReview, kcfReviewRecord |
| Recovery | kcfOperation, kcfExport, kcfImport |

`connectorSourceFile(bytes,{name,format,delimiter})` creates the exact file carrier. `verifyConnectorProject(project)` checks project/object/file digests.

Routes are under the store's own `/wp-json/stellar-forge/v1/merchant-kcf`, not a vendor API. Installation routes use /installations/I with /receipts, /editions, /recipes, /compare, /reviews, /operations/ID and /export; complete receiving uses POST /import. CLI help lists every command.

## Limits and interpretation

Each receipt supports 4 MiB, 50,000 rows, 120,000 typed values and 64 JSON nesting levels. CSV supports 512 headers; profiles support eight identity fields and 100 comparison fields. An edition has at most 100 slots. Recipes support 10,000 assignments and 5,000 deliberate removals. Original native map/order limits still apply.

Complete connector JSON is limited to 32 MiB; original per-order ERP exports remain limited to 16 MiB. An over-limit request fails without truncating history. Where orders account for the excess, retain source-only plus each listed order separately. If source/history itself exceeds the portable limit, retain the full original WordPress database and this source version. Export does not purge records.

This workspace records source review and compiles native maps. It does not install licensed packages, refresh remote schemas, start synchronization, reprocess logs, create ERP catalog records, infer a vendor credential protocol or claim a customer integration was operated. Live transport requires the actual installed contract to be selected separately.

## Primary source semantics

The following first-party material informed the source model. Actual retained installation files remain authoritative for fields and versions:

- [Connector configuration](https://productdocs.kensium.com/docs/kensium-commerce-framework/installation-guide/configuring-the-connector-in-acumatica/).
- [Product schema](https://productdocs.kensium.com/docs/kensium-commerce-framework/usage-instructions/establishing-product-sync-schema/).
- [Customer schema](https://productdocs.kensium.com/docs/kensium-commerce-framework/usage-instructions/establishing-customer-sync-schema/).
- [Schema API screens](https://productdocs.kensium.com/docs/kensium-commerce-framework/usage-instructions/viewing-schema-apis/).
- [Entity API screens](https://productdocs.kensium.com/docs/kensium-commerce-framework/usage-instructions/viewing-product-data-apis/).
- [Country/state substitutions](https://productdocs.kensium.com/docs/kensium-commerce-framework/usage-instructions/creating-substitute-lists-in-acumatica/).

Reviewed on 2026-10-12. These pages describe configuration and JSON screens; they do not establish a normative generic KCF HTTP API, selected package compatibility or completed customer run.
