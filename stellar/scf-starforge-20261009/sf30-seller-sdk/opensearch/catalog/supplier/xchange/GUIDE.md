# ETIM xChange supplier receiving and recipient history

The original material catalog can receive a complete ETIM xChange 2.0 JSON message, retain its supplier/product/trade hierarchy, review an explicitly selected recipient profile, and deliver the resulting native message with its full recipient history. The supplier workspace, catalog editions, correction revisions, operator, CLI, MCP tools and portable catalog bundle share the same stored state.

## Select the format and target

Use the catalog source format `{kind:"xchange-json"}`. The ordinary upload and preview path consumes the complete source before it exposes the first preview row. The returned rows carry native product data and the complete root/supplier headers. Mapping uses the template returned by `supplier.templates({target:"xchange-2.0"})`.

Choose one of two profile targets:

| Target | Review and materialization |
| --- | --- |
| `xchange-2.0` | The pinned ETIM 2.0 schema, original field values, complete hierarchy, explicit previous-version selection and local FULL/CHANGE recipient history. |
| `2ba-xchange-2.0` | The same native message plus the source-bound 2BA recipient requirements, status mapping, recipient projection and FULL/CHANGE actions. |

The existing Sonepar/BMEcat templates remain selectable through the original supplier workflow. Each saved plan records its own target. Target changes require a newly reviewed plan; an earlier review remains immutable.

## Complete operator workflow

1. Upload the original JSON file with the xChange source format. Retain the returned source ID, byte count and digest.
2. Get the selected supplier target's template and use its complete `catalogMapping` for the existing catalog preview. The material identity binds supplier, manufacturer and product identifiers. Supplier and product local array indices are retained as source context.
3. Review and select the complete catalog edition using the original catalog workflow.
4. Save a supplier plan for that edition with the returned `profile` and `bindings`. Select an explicit earlier recipient review when continuing an already delivered catalogue.
5. Run the complete supplier review. Product findings identify their exact native JSON pointer; catalogue and supplier header findings identify the saved profile context.
6. Save reasoned product corrections against the current material, mapped product and correction revision. Save header corrections as a versioned catalogue/supplier override in the profile.
7. Run a new immutable review. Browse product findings and the separate recipient impact table before selecting its exports.
8. Export `xchange.json`, `recipient.jsonl` and `impact.csv` with the selected review SHA. The original `review.json`, `issues.csv` and `products.jsonl` exports remain available.
9. Export the complete catalog bundle through the original handover operation. Importing that bundle recreates the source, editions, profile revisions, corrections, reviews and recipient before/after state. The recipient can reopen the workspace and create its next delivery from the same earlier review.

Every mutation retains the original catalog request ID and expected revision/hash checks. Resume an uncertain original operation with its existing request ID. A different requested change uses a new request ID.

## Source-native intake

The incremental reader accepts a regular file, immutable byte sequence or byte iterator. It rejects duplicate object keys, malformed UTF-8/JSON, unsupported incomplete structures, trailing data, missing or empty Supplier/Product arrays and a changed original file. The complete receipt is emitted only after the source reaches EOF, its expected size/hash matches and its original descriptor is closed.

Numeric JSON tokens are held as their exact original strings with a separate JSON-pointer token map. A quoted decimal string stays a string. A genuine JSON number stays a genuine number on native export, including its exponent and supplied precision. Product/header token maps are relative to their own object.

The parser emits a product before its containing supplier closes, because valid JSON may put header fields after Product. The original catalog reader stages those events in its own database TEMP tables and joins the completed root and supplier contexts before exposing material rows. Staging is bounded by row/byte batches and is removed on exhaustion, cancellation, early iterator return or failure.

Each retained product includes:

```json
{
  "xChange": {
    "schema": "stellar-forge.xchange-product.v1",
    "catalogue": {
      "header": {},
      "numberTokens": {},
      "fieldOrder": []
    },
    "supplier": {
      "key": "original source supplier identity",
      "index": 0,
      "header": {},
      "numberTokens": {},
      "fieldOrder": []
    },
    "product": {},
    "numberTokens": {},
    "identity": {
      "strategy": "native or source-index fallback",
      "missing": [],
      "fields": {}
    },
    "source": {
      "path": "/Supplier/0/Product/0",
      "byteStart": 0,
      "byteEnd": 1,
      "bytes": 1,
      "sha256": "original product range digest",
      "document": {
        "bytes": 1,
        "sha256": "original complete file digest"
      }
    }
  }
}
```

This shape is explanatory; the ordinary reader supplies its actual indices, identifiers, byte ranges, source digests and field-selection descriptor. A missing native identity gets an explicitly marked source-index fallback for review; it does not become an invented supplier/manufacturer identifier.

## Profiles and explicit source mappings

The native profile schema is `stellar-forge.supplier-xchange-profile.v1`.

`header` is either null or `{value,numberTokens,reason}`, where value is the root object without Supplier. Each `supplierHeaders` row is `{supplierKey,value,numberTokens,reason}`, where value is the supplier object without Product and supplierKey selects the retained original source group.

Overrides retain complete values, a reason and exact numeric-token metadata. They do not rewrite the original uploaded file, material ID, source identity or previous review.

For the 2BA target, a selected status mapping has this shape:

```json
{
  "source": {
    "url": "https://my.2ba.nl/ModelMan/UnitMapping?Unitlist=TradeItemStatusCode&format=ETIM_XCHANGE_V2_0",
    "sha256": "the actual acquired mapping-source SHA-256",
    "revision": "the original mapping version"
  },
  "product": {},
  "tradeItem": {}
}
```

Map only native PRE-LAUNCH, ACTIVE, ON HOLD, PLANNED WITHDRAWAL or OBSOLETE tokens to codes from the actual selected mapping. The public 2BA rule defines actions for recipient125/126/94E/130; it does not itself provide the complete native-token translation table. The profile therefore retains an explicit source-bound mapping instead of creating that table from similarly named statuses.

A released modelling class row is `{code:"MC000023",version:"5",source:{url,sha256,revision}}`. Select the original release source for each code/version used by the delivery. `attachmentPolicy.keepMimeUrlCodes` records original MDX URL-retention selections. An explicit 2BA processing selection carries them into the recipient's `parameters.xml`; see [2BA upload packages](./2BA_UPLOAD.md).

## Correct exact product values

The existing correction operation accepts patches below `/xChange/product` and an optional replacement of the whole `/xChange/numberTokens` map. Retain the original material SHA, mapped base-product SHA, plan revision and correction revision in the request.

For an exact numeric correction, provide the native value as its original numeric text and update the one whole token map. Remove previous token entries below a replaced subtree and add only the numeric leaves in the corrected subtree. For a quoted decimal-string field, keep it outside the token map.

The normalizer reconciles explicit numeric-subtree corrections against the selected original schema. An untracked JavaScript fractional or unsafe integer value becomes an actionable review finding before native export. A nonempty token map must point to matching exact values.

Source byte ranges, document digests, supplier group indices and native custody fields are immutable through product patches. Root/supplier headers use the versioned profile overrides.

## Recipient FULL and CHANGE behavior

Each immutable review derives a separate product and trade-item recipient record set. Product identity includes the explicitly selected supplier identifier field/value, manufacturer identifier field/value and ManufacturerProductNumber. A trade item is keyed by the supplier and its original SupplierItemNumber.

The selected prior review can belong to another plan of the same catalog, tenant and target. This supports a new recipient plan that begins from the preceding delivered edition. The prior graph must be acyclic and the complete original reviews must be present in a portable handover.

A CHANGE message must identify the exact preceding CatalogueVersion through ChangeReferenceCatalogueVersion. CatalogueId remains the same. The local materialization policy replaces each complete supplied product body, excludes its independently tracked TradeItem array from that product record, and replaces each complete supplied trade item. Unlisted CHANGE records persist. The ETIM guideline describes changed products/trade items; it does not define a field-by-field patch protocol. This complete-record policy is explicit in every recipient review.

| Selected message | Supplied record | Previous record absent from message |
| --- | --- | --- |
| FULL | Add, change or retain the supplied complete product/trade record. | Keep product history and mark the product expired; delete the active trade-item state. The 2BA target marks the product with recipient130. |
| CHANGE | Replace the complete supplied native record. A 2BA trade-item status mapped to130 produces deletion. | Retain the prior active record unchanged. |

The generic ETIM target preserves supplied native statuses. It marks a supplied product OBSOLETE as expired in its local recipient state. The 2BA target derives its product status from the selected original status mapping. The native message always retains the original native status token.

A recipient record contains `kind`, `key`, `supplierKey`, `productKey`, `materialKey`, `identifier`, `action`, `before`, `after`, both value hashes and its sealed record SHA. Deleted records have a null after value. Source provenance remains attached to the retained values.

The operator's recipient search accepts an original identifier, supplier key or original supplier name. The same filter applies to product and trade-item rows.

## Programmatic interfaces

`SupplierWorkspace` is the existing supplier workspace attached to the original catalog database.

```js
const template = supplier.templates({ target: 'xchange-2.0' });
const saved = supplier.save({
  requestId,
  catalogId,
  editionId,
  title,
  profile: template.profile,
  bindings: template.bindings,
  previousReviewId
});
if (saved.state !== 'COMPLETE') {
  throw new Error('Continue the retained save operation before selecting its result.');
}
const plan = saved.result.supplierPlan;
const reviewed = supplier.runReview({
  requestId: reviewRequestId,
  planId: plan.id,
  expectedRevision: plan.revision
});
if (reviewed.state !== 'COMPLETE') {
  throw new Error('Continue the retained review operation before selecting its result.');
}
const review = reviewed.result.supplierReview;
const impacts = supplier.recipientRows({
  reviewId: review.id,
  kind: 'all',
  change: 'all',
  search: '',
  offset: 0,
  limit: 50
});
const exported = supplier.export({
  reviewId: review.id,
  expectedReviewSha256: review.sha256,
  format: 'xchange.json'
});
for (const chunk of exported.body) {
  // Write through the original streamed, atomic export operation.
}
```

The recipient page returns `{reviewId,reviewSha256,recipient,offset,limit,total,nextOffset,rows}`. Its supported kind values are all/product/tradeItem; actions are all/added/changed/unchanged/expired/deleted. Page sizes are1–200.

The schema module exports `validateXChange(value,{schema,numberTokens,path,schemaPath,omit})` and the complete/product/supplier/trade schemas. For parser events, validate each product with its product-relative map, each supplier header with Product omitted, and the complete root header with Supplier omitted. The original reader's complete EOF/hash result closes the document.

`exactJSON(value,{numberTokens,schema,fieldOrder})` yields exact native JSON chunks. Native review export uses the pinned schema order and groups products by original document SHA, supplier key and supplier index, so supplier index0 in two source files is not silently conflated.

## Full handover and reopen

The original catalog v2 handover includes the additional immutable `catalog_supplier_recipient` table. Snapshot fingerprints include its review/kind/key and row SHA. Source files, all supplier plan/correction revisions, original review rows and each complete prior recipient state remain in the bundle.

Import reconstructs native products from their original materials, mappings and applicable corrections. It re-runs the original schema and recipient product checks, current/prior product lookup and duplicate/stale findings. It rederives every recipient before/after record and global finding, then checks the review totals, source roots and original sealed hashes. Removing a finding and merely rehashing the supplied record does not produce an accepted valid review.

This uses bounded SQL staging for the source population and duplicate lookup. Complete review work is synchronous inside the original catalog mutation, so an interrupted review rolls back as a unit and can resume with its same request ID.

## Original publisher example

The adjacent source directory contains the unchanged ETIM2.0 schema and27,705-byte original publisher sample. Its full raw source includes one supplier, one product, one trade item, two packaging units,36 ETIM features, two modelling ports, two LCA stages and38 genuine JSON numeric tokens.

The sample's `/Supplier/0/Product/0/LcaEnvironmental/ProductSpecificRulesUri` ends with U+0020 after the PDF URL. The pinned schema requires a URI. The first review exposes that original source finding; a reasoned product correction removes only that trailing space before producing the corrected demonstration export. The original uploaded file and bundled publisher example remain unchanged.

`source/RULES.json` binds each implemented source rule to its exact original document/section and records this sample observation. `source/NOTICE.txt` and `source/LICENSE-ETIM.txt` accompany the retained original schema. The receiving program uses the original example and all original operator/CLI/MCP/handover APIs to exercise the complete workflow.

## Complete 2BA upload package

A 2BA submission can include an explicit, reasoned `processing` selection.
Its original case-sensitive parameter names and values are saved in the profile.
The immutable review applies effective FULL/CHANGE handling, skipped records,
and selected price/attachment retention before the package is created.

Export `parameters.xml` to inspect that selection, or `2ba.zip` from a ready
nonempty review to receive it together with the complete native message. The
same formats are available through the original browser, installed CLI, native
MCP and retained-file typed client. The complete [2BA upload guide](./2BA_UPLOAD.md)
covers operator controls, exact field shapes, archive identity and receiving.

The original published MC000023/v5 selection used by the following receiving
program is retained with its source attribution under
[source/2BA_RECEIVING_REFERENCES.json](./source/2BA_RECEIVING_REFERENCES.json).

## Primary references

- ETIM original archive: https://etim.de/wp-content/uploads/2025/12/ETIM-xChange_V2.0-2025-11-27.zip
- Schema identifier: https://www.etim-international.com/xChange/20
- ETIM2.0 guideline, sections3.2 and5.1: https://etim.org.pl/wp-content/uploads/2026/05/ETIM-xChange_Guideline_V2.0-2025-11-27.pdf
- Current2BA v2 recipient rules: https://www.2ba.nl/en/documentation/file-exchange/etim-xchange-v2-0/
- Generic URI grammar: https://www.rfc-editor.org/rfc/rfc3986#appendix-A
