# Prepare supplier document tables for the material catalog

**Prepare document tables** lives in **Material catalogs → Sources and mapping**. Open a complete source-observation JSON or a saved preparation working record, inspect its products and original cells, and apply any intended product decisions. Preparing the source selects the complete generated JSON in the existing source-upload control and fills the existing mapping editor. **Save mapping**, **Retain source file**, and **Build edition for review** continue through the catalog's original request journal.

The preparation supports supplier PDF or document tables that have already been read into structured observations. The included WAGO example contains actual AutomationDirect source tables and supplier product pages. The original extracted tables, cell spans, technical ratings, observations, and public URLs travel inside the uploaded source.

## Included operating example

Open [wago221-observations.json](../examples/material-catalog/document-preparation/wago221-observations.json). Its source is AutomationDirect's [221 Series LEVER-NUTS catalogue](https://cdn.automationdirect.com/static/specs/221serieslevernuts.pdf), with the exact supplier product pages and four full-SKU product cut sheets listed in the record.

The complete example contains:

- 17 separate product rows: 11 connector sales packages and six Gelbox sales packages.
- Four slash-suffixed package identifiers retained without collapsing them to a base part.
- 17 supplier-page-supported package quantities and exact printed decimal prices.
- 240 technical observations, including separately contextualized UL and IEC nominal currents.
- 120 original compatibility cells, 29 positive observations, and 18 distinct connector-capacity relationships.
- Both repeated compatibility observations retained, along with every original dash or other nonnumeric cell.

The product pages were read on 13 October 2026. All 17 page prices agreed with the retained printed observations at that reading. The PDF directs readers to the supplier for its latest prices; its file metadata dates are not a price-validity declaration.

The original source describes 207-1373 as 41.70 mm wide and 1.61 in wide. Those published values remain separate original observations. The 207-1431 product page lists a shorter connector set than the PDF matrix; omission from that description does not establish incompatibility. Source notes stay attached for the receiving operator.

## Product and quantity decisions

A supplier SKU remains the material identifier. The preparation does not derive a manufacturer part number by truncating a slash-suffixed supplier SKU. A source can supply an explicit manufacturer_part_number when that identity is available.

The included quantity basis comes from each exact supplier page's package declaration. For example, 221-412/K007-0000 has ten each per pack, while 221-412 has 100 each per pack. The mapping selects base unit each, sales unit pack, and the original numerator and denominator as decimal strings. The native catalog quantity calculator uses its existing exact rational arithmetic.

The source Qty field remains a published package observation. Compatibility counts describe connector capacity inside an enclosure. Neither field populates inventory availability.

The product editor can include or exclude a product and change its title, description, quantity basis or selected price fields. Each decision requires an operator note. Source values, supplier-page observations and selected values remain separate. **Restore source** clears the current decision and retains that restoration in the preparation's history.

## Complete files

| File | Contents and use |
| --- | --- |
| Prepared_Catalogue.json | Prepared product rows plus the complete original source, decisions and revision history; upload as JSON with rowsPath /products |
| Mapping.json | The native stellar-forge.material-catalog-mapping.v1 declaration |
| Working_Record.json | Reopenable source and complete operator decision history |
| Source_Observations.json | Original source tables, source products, technical observations and URLs |
| Products.csv | Operator review sheet, including selected quantity and price fields |
| Compatibility.csv | All original compatibility cells, including nonnumeric values |

JSON is the interchange source. CSV is a spreadsheet review view and protects formula-leading text. Exact identifiers, original decimal tokens, source-cell origins and structured attributes remain in JSON.

## Batch preparation

Run these commands from the seller SDK's opensearch directory:

    node catalog/document-cli.mjs inspect \
      --input examples/material-catalog/document-preparation/wago221-observations.json

    node catalog/document-cli.mjs export \
      --input examples/material-catalog/document-preparation/wago221-observations.json \
      --output /private/materials/wago221-prepared

An existing output file is accepted only when its complete content is identical. Different working editions should use different output paths.

A decision file is a JSON object, for example:

    {
      "include": false,
      "note": "This customer edition omits the ten-piece package."
    }

Apply it to the exact supplier SKU:

    node catalog/document-cli.mjs decide \
      --input /private/materials/wago221-prepared/Working_Record.json \
      --sku 221-412/K007-0000 \
      --decision /private/materials/omit-ten-pack.json \
      --output /private/materials/wago221-customer-working.json

The restore-source command takes the same input, sku and output options and restores that row's source selection while keeping the complete decision history.

## Native workspace intake

The intake command uses the original installed catalog workspace:

    node catalog/document-cli.mjs intake \
      --input examples/material-catalog/document-preparation/wago221-observations.json \
      --source /private/materials/source.json \
      --workspace /private/materials/workspace \
      --request-id wago221-document-20261013 \
      --title "AutomationDirect WAGO 221 and Gelbox" \
      --tenant automationdirect-published-wago221 \
      --select yes

Use the existing source declaration and workspace directory. Optional --plan supplies the same merchant plan used by the workspace. To revise an existing catalog, supply both --catalog and its original --revision. Without --select yes, intake creates the complete edition for review in the original UI. With it, the exact generated review is selected through the native catalog select operation.

The command retains four related original requests, with suffixes -mapping, -source, -edition and, when selected, -select. Repeating the same command and exact input returns the recorded outcomes. A changed input belongs to a new intended operation; an existing request is never changed to mean different content. If an operation reports a pending or failed result, inspect that original request through catalog-operation before advancing it.

The uploaded Prepared_Catalogue.json contains the full source bundle and preparation history under preparation, so complete catalog export/import carries those bytes into a receiving workspace. Continue with the normal [catalog guide](GUIDE.md): edition comparison, customer matching, exact quantities, search export, supplier delivery, and complete catalog handover.

## Source format for another supplier

The engine accepts commons.supplier-document-observations.v1. It requires source_document with id, title, publisher and original HTTP(S) URL, and a products array with unique supplier_sku strings and original raw text cells.

Products can carry cell_origins, source_page, source_row, table_id, family, observed_price, product_page_price_observation, specification_observations and source-backed quantity_basis. A quantity_basis supplies unit, salesUnit, numerator, denominator, source_url and source_text. Keep technical contexts as separate observations when a label occurs under different standards.

Complete extracted tables belong in tables. Compatibility observations belong in compatibility_cells, with from_supplier_sku, to_part_number, raw, published_capacity and source coordinates. A nonnumeric source cell keeps null published_capacity; it is not changed to zero. Contradictory positive capacities retain all observations and require an explicit receiving decision.

The shared engine is catalog/document-preparation.mjs. It has no Node-only imports; the CLI and existing browser use the same preparation, decision and export functions.
