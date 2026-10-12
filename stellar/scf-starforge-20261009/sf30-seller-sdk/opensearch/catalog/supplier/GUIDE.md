# Supplier submission and BMEcat delivery

**Supplier delivery** turns a retained material catalog edition into a supplier submission, a product correction queue, and a BMEcat delivery. It uses the same private workspace, original source files, catalog editions and request journal as [Material catalogs](../GUIDE.md).

## Prepare a submission

Open the maintained workspace with its existing source and private directory, choose **Material catalogs**, open a catalog, then choose **Supplier delivery**. A submission selects one retained edition and records a numbered revision. The edition can be reviewed before or after becoming the active customer catalog.

Choose the applicable targets, delivery languages, markets, supplier role, and catalog envelope. **Sonepar** selects the April 2026 Product Data Guidelines, release 3.1. **ETIM BMEcat 5.0** selects the ETIM exchange rules and the published 5.0.2 XML schema. Selecting both combines their applicable requirements.

Review the complete **Profile JSON** when specifying category-dependent assets, market languages, the ETIM class dictionary, update transactions, party identifiers, localized catalog names or receiver-specific rules. The template exposes these choices. Save actual receiving requirements in this profile; the saved revision accompanies every review and handover.

Map product fields explicitly. A mapping's left side is a JSON Pointer in the supplier product; its right side selects a field in the retained material. The material includes its original named attributes, so nested supplier data can be retained and mapped without flattening it.

| Supplier field | Example original material field |
| --- | --- |
| /supplierProductId | /materialId |
| /manufacturerProductId | /partNumber |
| /brand | /attributes/brand |
| /descriptions/eng/short | /title |
| /classification | /attributes/supplier/classification |
| /prices | /attributes/supplier/prices |
| /packaging | /attributes/supplier/packaging |

A declared value uses an explicit constant and reason:

~~~json
{
  "/segment": {
    "constant": "longtail",
    "reason": "Scope selected in the receiving team's supplier specification"
  }
}
~~~

Map an entire object or array when the source already supplies it, or map its individual fields. Overlapping mappings are reported before save. JSON Pointer escaping uses ~0 for a tilde and ~1 for a slash. Product identifiers and original decimals remain text.

**Save and review** records the submission and reviews every material in its selected edition. The review includes the complete product set, finding counts, mapping, selected profile, original edition identity and exact applied corrections.

## Work through the correction queue

Delivery-wide findings appear above the product queue. A price-only update compares its complete supplier identifier set with the profile's original product IDs before downloading XML.

Filter the reviewed products by errors, warnings, ready products or all products. Search by original material or supplier product identifier. Open a product to read its findings, rule references, original material, mapped product and existing corrections.

A correction specifies the exact supplier field path, its replacement value and the operator's reason. Use **Text** for identifiers, codes and decimal text; use **JSON** for an array, object, boolean or explicit null. Several field corrections can be saved together. Replacing /prices, for example, preserves the original array's currency, territories, dates, price quantities and lexical decimal values.

**Save corrections and review** records another correction revision and reviews the entire edition again. The original material remains available alongside the corrected product. Earlier reviews retain their original product values and corrections.

Corrections bind to both the original material and the product produced by the selected mapping. When either changes, the review identifies the existing correction for reconsideration. Open it against the current material, confirm its replacement values or remove redundant patches, then save and review. A historical review can be inspected and exported; its product inspector directs editing through the current saved submission.

An optional previous review supplies the earlier product values for rules about changed identifiers, brands and sequential delivery. Choose an earlier review of this same submission when saving a later plan revision.

## Deliver the reviewed result

The selected immutable review provides:

| Download | Contents |
| --- | --- |
| Review summary | Selected profile, edition, mapping, correction identities and complete finding totals. |
| Correction findings CSV | Material and supplier IDs, severity, field, rule code, explanation and original rule reference. |
| Reviewed products JSONL | Every product, applied correction identity and its findings. |
| BMEcat XML | The selected delivery envelope and complete reviewed product set. |

BMEcat export is available after a nonempty review has resolved its errors. Warnings remain in the review data. Downloads identify the exact review selected by the operator.

The writer preserves XML element order and lexical values according to the actual ETIM schema. It escapes supplied text and distinguishes descriptions, classification features, prices, packaging, assets, relations and variant groups. Unit and net/order-basis conversions require explicit profile permission and the needed conversion values.

The source requirements contain distinctions that affect delivery:

- Sonepar's supplier product ID limit is 50 characters; ETIM BMEcat's SUPPLIER_PID limit is 32. A submission targeting both uses the applicable smaller limit.
- Sonepar dimensions describe an unpacked product; ETIM net dimensions describe an order unit. Original units and basis remain explicit.
- Product branch numbers and supplier branch identifiers have different ETIM elements. The profile records Sonepar's inconsistent source label while preserving both actual roles.
- Asset requirements depend on product category and channel. The published ETIM example itself contains two MD01 images; the Sonepar target's primary-image requirement is applied separately.
- Update transactions require the corresponding receiving agreement and previous delivery state. A complete new catalog and a price-only update have different required content.

Consult [Sonepar's original release](https://www.sonepar.com/resource/blob/85322/d6950a910363f19c4fdc060017186082/sonepar-product-data-guidelines-data.pdf), the [ETIM guideline](https://etim.ch/de/downloads/downloads/2-bmecat?download=12:etim-bmecat-guideline-v5-0-en), and the [publisher's current 5.0.2 example/schema archive](https://www.etim-international.com/wp-content/uploads/2021/09/ETIM-BMEcat-Guideline-V5-0-2-2024-12-12.zip). Source identities and the field conversion are retained with the included [publisher example](../../examples/supplier-etim/SOURCES.md).

## Reopen a complete customer handover

The catalog's existing **Complete portable handover** now includes supplier submissions, every plan and correction revision, every reviewed product and all original source files. A catalog containing supplier submissions exports bundle v2. A catalog with no supplier submissions keeps bundle v1; this workspace reads both versions.

Receive the bundle through the original catalog import. The receiver restores original identities and reconstructs the reviewed products from their original material, mapping and corrections. When an earlier handover from the same history is received again, newer local submission and correction revisions remain current. Conflicting changes to the same historical revision require reconciliation.

Keep the receiving workspace directory and selected source configuration when reopening. The browser, HTTP routes and batch commands all use those same stored records.

## Batch and application interfaces

Use the existing installed command:

~~~sh
starforge opensearch-catalog catalog-supplier-profile \
  --source /private/materials/source.json \
  --workspace /private/materials/workspace

starforge opensearch-catalog catalog-supplier-save \
  --source /private/materials/source.json \
  --workspace /private/materials/workspace \
  --request /private/materials/submission-request.json

starforge opensearch-catalog catalog-supplier-rows \
  --source /private/materials/source.json \
  --workspace /private/materials/workspace \
  --review REVIEW_ID --status errors

starforge opensearch-catalog catalog-supplier-export \
  --source /private/materials/source.json \
  --workspace /private/materials/workspace \
  --review REVIEW_ID --review-sha256 REVIEW_SHA256 \
  --format bmecat.xml --output /private/materials/delivery.xml
~~~

The CLI also supplies supplier state, plan, plan history, current product, individual reviewed row, correction save and complete review. Mutations read the full original JSON request from --request. Use --submission to select a supplier plan; --plan remains the OpenSearch merchant-plan file. --output - streams only export bytes to standard output and sends the receipt to standard error.

Application callers use the maintained workspace's catalog.supplierSave(), catalog.supplierCorrection() and catalog.supplierReview(), plus catalog.supplier for reads and exports. Mutations carry a stable requestId and the currently opened revisions. A repeated request with the original values returns its original journal outcome.

HTTP reads are under /api/catalog/supplier/. The original authenticated POST /api/catalog accepts supplier-save, supplier-correction and supplier-review actions. Existing local session and origin requirements apply.

## Run the complete published example

The [supplier delivery journey](../../receiving/supplier-delivery-journey.mjs) operates the actual published ETIM10 product. It retains all original XML nodes, resolves an unmapped published price, creates XML, closes and reopens the workspace, receives v1/v2 handovers, changes the mapping, reconfirms its correction, replays an earlier handover, and uses the actual CLI and HTTP correction/export routes.

Run it from a prepared source checkout with Node 24 and Python's lxml available:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/receiving/supplier-delivery-journey.mjs \
  --directory /absolute/private/supplier-delivery \
  --operation supplier-etim-original
~~~

The stable operation and directory allow continuation using the saved journal. The output directory contains the supplier XML, findings, reviewed data, complete customer workspace bundle and native completion report. The official XSD checks both the publisher's original XML and the generated deliveries.
