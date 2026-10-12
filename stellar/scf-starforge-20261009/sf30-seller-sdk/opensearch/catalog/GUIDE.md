# Material catalog operating guide

The **Material catalogs** view carries an original product file through field mapping, edition comparison, customer material decisions, exact quantity review and OpenSearch handover. It runs inside the maintained [OpenSearch merchant workspace](../workspace/README.md), using its original source selection, private SQLite store, request journal and local session.

## Open the installed workspace

Use the selected OpenSearch source declaration and existing credential environment:

```sh
starforge opensearch-workspace \
  --source /private/materials/source.json \
  --plan /private/materials/merchant-plan.json \
  --workspace /private/materials/workspace \
  --port 8447
```

The printed URL opens the original workspace. Choose **Material catalogs**. From a source checkout, the equivalent entry is `node opensearch/workspace/server.mjs` with the same flags, run from the seller SDK directory.

The optional merchant plan supplies the intended payment and receiving terms when the catalog creates a query draft. The catalog editor, retained sources and local customer matching use the selected workspace directly. Native source inspection, search capture, relevance evaluation and merchant preparation continue through their existing views.

Keep the same source selection and workspace directory when reopening. The browser and batch command share the same stored catalogs and request outcomes.

Completed imports automatically release their closed receiving stages while retaining the original bundle, canonical source files and customer history. Use **Search and handover → Receiving-stage storage** to inspect older imports or finish an interrupted retirement. The [receiving-stage storage guide](./IMPORT_STORAGE.md) gives the original import selection, CLI commands, receipt meanings and recovery steps.

## 1. Retain the source and map the material

Choose **New catalog**, enter its title and original tenant identifier, then declare the material fields. A saved catalog retains its tenant identity. Later mapping changes create a numbered catalog revision.

**Retain source file** accepts CSV, TSV, JSON Lines or a JSON document. Select the format explicitly. CSV and TSV can use their first row as field names or a declared array of headerless column names. JSON documents use the selected JSON Pointer to their rows array; leave that value empty when the document itself is the array. Record the original source URL, publisher and revision when available.

The browser reads bounded file slices and computes the selected file's exact size and incremental SHA-256 before transmission. The original bytes stream into the workspace with that metadata. Source records retain their format and provenance; a mapping references the retained source ID. For large batch inputs, use the installed CLI's file stream described below.

Each field editor accepts the following original mapping forms:

| Form | Meaning |
| --- | --- |
| `PRODUCTID` | The exact tabular header or property name |
| `/material/identifier` | A JSON Pointer into the original record |
| An empty field | This source does not supply that optional value |
| `{"constant":"EA","reason":"Unit declared in supplier specification"}` | An explicit operator declaration with its reason |
| `{"join":["NAME","DESCRIPTION"],"separator":" — "}` | A declared text join |
| `{"lookup":{...}}` | An exact lookup against another retained source |

The material identifier is required. The other mapped fields are title, description, manufacturer part number, manufacturer, category, base unit, sales unit and the original sales-to-base numerator and denominator. **Exact original identifiers** retains exact lookup spelling; the case-insensitive option makes that choice explicit in the mapping.

Material reference mappings declare a reference kind and source field, with an optional delimiter. Retain supplier accounts, prices, currency, dimensions and other source fields as named attributes. The material's own key derives from its original tenant and material ID. Leading zeros and original decimal text remain part of the input representation.

### Use the included SAP editions

The [source bundle](../examples/material-catalog/SOURCES.md) includes `sap-shine-sps11.csv`, `sap-shine-sps12.csv` and `mapping-sap-shine.json`. Each CSV contains all 106 published product rows and the exact joined English name and description. The source index records the original SAP commits, files, byte identities and join.

The **Map SAP product columns** button selects:

| Material field | Original source field |
| --- | --- |
| Material identifier | `PRODUCTID` |
| Title | `NAME` |
| Description | `DESCRIPTION` |
| Category | `CATEGORY` |
| Base quantity unit | `QUANTITYUNIT` |
| Supplier attribute | `SUPPLIER.PARTNERID` |
| Price and currency attributes | `PRICE`, `CURRENCY` |
| Weight attributes | `WEIGHTMEASURE`, `WEIGHTUNIT` |
| Dimension attributes | `WIDTH`, `DEPTH`, `HEIGHT`, `DIMENSIONUNIT` |

The period in `SUPPLIER.PARTNERID` is part of the original flat column name. The two real releases change that supplier value for all 106 products while preserving material IDs and the other product fields. Capture the first as a full edition, select it, then capture the second with the first as its comparison base to review that complete change.

### Join original text and unit dictionaries

Upload the dictionary as another source. Open **Join retained text or unit dictionaries**, select its retained ID, declare its key columns and the corresponding product columns, then select the value and equality filters.

For SAP's original English text file, a title lookup can use `TEXTID` from product `NAMEID`, take `TEXT`, and filter the actual original `ISOLANGUAGE` field to `en`. The included joined CSVs already contain the resulting `NAME` and `DESCRIPTION`. Other source editions can use different original language fields; select those literal fields and values from the retained file.

A compound lookup lists its keys in corresponding order. Unit dictionaries that distinguish client and internal unit need both original keys or an explicit client filter. The SAP product file has no client column, so select the intended dictionary client explicitly. Save the mapping after reviewing the retained lookup declaration. Ambiguous or missing required lookup keys must be corrected in the source selection or mapping.

**Unit aliases** relabel explicitly selected original units. Quantity conversion uses the declared ratio; a unit label alone supplies no conversion factor.

## 2. Build and select the complete edition

Open **Edition review**, choose a retained source and select one of the two interpretations:

- **Full catalog replacement** defines the complete resulting material set. With a comparison base, absent materials become removals.
- **Declared upserts and deletes** applies the mapping's original delta operation values to an explicit base edition.

For a delta, declare a source operation field plus its accepted upsert and delete values under **References, attributes, unit aliases and deltas**. The delta's base and operation mapping remain attached to its edition.

**Build edition for review** freezes the source, mapping, lookup dependencies and chosen base. Review the counts for total, added, removed, changed, unchanged and missing-unit materials. The table pages through the full result or the exact changes. **Inspect** opens the complete original material, or the before/after values and changed fields of a change.

**Select reviewed edition** requires the open catalog revision and that edition's review checksum. It records the active edition while retaining the other editions. A later mapping save does not silently select a newly interpreted catalog.

To return to an older edition, open it and inspect its retained mapping. If the current mapping differs, choose **Use this edition's mapping**, save that mapping revision, then select the reviewed old edition. The selection uses the original review identity and records the new catalog revision.

**Refresh catalogs** updates the retained lists without discarding mapping edits. **Reload saved catalog** explicitly reopens the current saved revision and asks before discarding an edited mapping.

## 3. Resolve customer material descriptions

Select **Customer matches**, enter the original customer identifier and description, and choose **Find candidate materials**. Optional category, manufacturer and quantity-unit filters come from the currently selected edition's actual values.

Candidate order distinguishes an unchanged approved customer match, an exact original identifier or reference match, retained catalog text matches, and an empty-text catalog browse. The local candidate list pages through the selected edition. Each row shows its matching reason.

Select a candidate and inspect the complete material, including its manufacturer references, original units and attributes. Enter the operator note and choose **Approve selected match** or **Reject selected match**. Saving requires the catalog revision, exact material key and checksum, and the previous decision revision when that customer context already exists.

The decision retains the original customer description, material, edition and note. A later selected edition that changes or removes the material shows **NEEDS_REVIEW** for that decision. **Review** reopens the original customer context and current candidate selection. A new approval records a new decision revision; its previous revision remains retained.

Changing the customer, description or facet filters clears the prior candidate selection. Find candidates again before saving against the new context.

### Review the exact quantity

Within **Selected original material**, enter the quantity as plain decimal text and choose one of its declared base or convertible sales units. **Calculate base quantity** rechecks the current selected material checksum and applies its original ratio using exact integer arithmetic.

For example, an unchanged base unit and original quantity `5.25` returns base numerator `21`, denominator `4` and decimal `5.25`. A nonterminating conversion keeps its exact numerator and denominator with a null decimal. The result includes the original quantity, requested unit, base unit, material ID and edition.

**Download reviewed quantity JSON** retains that complete returned conversion. Editing the amount or unit clears the previous download until it is calculated again.

## 4. Continue into native search and the merchant workflow

Open **Search and handover**, enter the explicit OpenSearch index name, and choose the description/title baseline or identifier-aware query variant. **Create search draft** saves a real query draft in the original workspace and opens the existing Draft view.

The generated query fixes the catalog and tenant in its filter. The customer input supplies the search term. The identifier-aware variant combines exact material, manufacturer part and reference matches with material text. The baseline uses the title and description fields.

The draft carries a complete original `GET /materials/search` merchant route and the selected workspace's merchant-plan terms. Review its price, asset, receiving account and source declaration, then use the maintained actions:

1. Save and validate the intended query and merchant plan.
2. Inspect the actual native source and capture its result edition.
3. Use **Search relevance** to attach the original judgments, run native evaluation and select the desired variant.
4. Prepare the original merchant package.
5. Continue through **Deployment** and its retained generated customer client.

The exported source declaration includes `material_search` and category, manufacturer or unit query templates when the selected edition contains actual values for those facets. Those templates accept the declared facet as a typed input. The browser's create-draft control selects the baseline or identifier-aware `material_search` variant.

The [WANDS source cohort](../examples/material-catalog/SOURCES.md) supplies the original product, query and human-judgment identities for relevance work. Iterate its actual query IDs, including the original noncontiguous values. Keep native ranking output with the original query, judged document IDs and selected evaluation metric.

## 5. Export the retained business result

Downloads stream directly from the retained edition or decision state.

| Download | Retained contents |
| --- | --- |
| Catalog CSV | All selected material fields, references, attributes and checksums |
| Catalog JSON Lines | Complete canonical material records |
| Approved customer matches CSV | Current unchanged approvals with decision revision, material, unit and ratio |
| OpenSearch index definition | Original identifier/text/unit mapping and catalog identity |
| OpenSearch bulk input | Stable document IDs and the complete selected material documents |
| Reviewed OpenSearch change operations | Original base-to-edition additions, changes and deletions |
| Original search source declaration | The selected connection references and generated typed catalog queries |
| Typed search client | Catalog-scoped input/result types and the original injected buyer call |
| Retained facets | Actual category, manufacturer and unit counts |
| Complete catalog bundle | Catalog histories, source metadata and original source bytes, editions and customer decisions |

The selected edition in **Edition review** determines edition-specific downloads. Current approved matches use the catalog's active edition so a changed material is sent back for review.

Catalog CSV preserves exact interchange text with CSV quoting. When opening identifiers or decimals in a spreadsheet, select text import types or use the complete JSON Lines file. The browser table is a preview of the retained records.

Bulk and delta files are ready for the existing controlled OpenSearch ingestion path. Selecting a local catalog edition records the reviewed operator state. Apply its chosen index and data files through that original ingestion path before native search capture. Stable document IDs bind catalog and original material identity; the delta file includes the reviewed removals as well as changed or added documents.

## 6. Receive a complete catalog in another workspace

Download **Complete catalog bundle** from the sending workspace. Open the receiving workspace under its intended original source connection and choose **Import retained catalog** with the unchanged JSONL file.

The receiver validates the declared byte count, checksum, complete catalog identity and retained record content before accepting the imported catalog. Source IDs and hashes, mapping revisions, edition histories and customer decisions travel with the bundle. The imported catalog is then available through the same review, matching and export views.

Use the same original import request when recovering a lost reply. A new receiving catalog should preserve its retained identity; inspect any reported identity conflict before choosing a different operation.

## Recover an upload or operation

The browser saves the request ID and exact metadata before sending a catalog mutation. The original workspace journal records its outcome. Open **Requests** or the catalog's retained-request banner and choose **Read saved outcome** after a lost reply.

For an upload or import retry, reselect the original file. The browser compares its exact size and SHA-256 with the retained request, then transmits the same ID and metadata. Selecting different bytes does not alter that original request. The browser stores file metadata; file bytes stay in the original selected file and the retained server source.

A terminal failed or interrupted operation keeps its original outcome in the journal. Read that outcome, correct the source or mapping if needed, then create the intended new operation. If validation confirms that no operation was recorded, the browser releases the pending request and preserves the editor for correction.

Close the original server normally before moving its complete workspace directory. Its close path drains admitted HTTP work and closes the existing store. Preserve `workspace.sqlite3`, its complete retained catalog source area and the original source profile together.

## Installed batch work

The installed command is `starforge opensearch-catalog`. Every operating command uses the original `--source SOURCE.json --workspace PRIVATE_DIR` selection and optional `--plan PLAN.json`. `--help` lists the complete action and field contract.

Read the current state and original catalog history:

```sh
starforge opensearch-catalog catalog-state \
  --source /private/materials/source.json \
  --workspace /private/materials/workspace

starforge opensearch-catalog catalog-history \
  --source /private/materials/source.json \
  --workspace /private/materials/workspace \
  --catalog CATALOG_ID
```

Use actual IDs from the returned original records in place of the capitalized selection values. `catalog-show` opens a catalog; its optional `--revision` guards the expected current revision. `catalog-source`, `catalog-edition` and `catalog-material` inspect complete retained records. `catalog-materials`, `catalog-changes` and `catalog-decisions` expose their original page offsets and next offsets.

Mutations read one original JSON object from `--request REQUEST.json`, or from stdin with `--request -`. The command preserves the supplied request ID and revisions. These are method request objects; omit the browser HTTP envelope's `action` field.

| Command | Required business request fields |
| --- | --- |
| `catalog-save` | `requestId,title,tenantId,mapping`; existing `catalogId,expectedRevision` for an edit |
| `catalog-preview` | `requestId,catalogId,expectedRevision,sourceId,mode,baseEditionId` |
| `catalog-select` | `requestId,catalogId,expectedRevision,editionId,reviewSha256` |
| `catalog-decision` | `requestId,catalogId,expectedCatalogRevision,customerId,description,materialKey,expectedMaterialSha256,status,note`; previous `decisionId,expectedRevision` when revising |
| `catalog-create-draft` | `requestId,catalogId,expectedRevision,index,variant`; optional title |
| `catalog-upload` | `requestId,format`; optional original name, provenance and expected bytes/SHA |
| `catalog-import` | `requestId`; optional original name and expected bytes/SHA |

For an original source upload, a request file can contain:

```json
{
  "requestId": "sap-sps11-source-1",
  "format": { "kind": "csv", "hasHeader": true, "delimiter": "," },
  "provenance": {
    "publisher": "SAP",
    "revision": "c8ef4bef064bc4b22e777e01ad5e469d070652f8",
    "kind": "published-product-catalog"
  }
}
```

Pass it with the actual original CSV:

```sh
starforge opensearch-catalog catalog-upload \
  --source /private/materials/source.json \
  --workspace /private/materials/workspace \
  --file /private/materials/inputs/sap-shine-sps11.csv \
  --request /private/materials/requests/sap-sps11-source-1.json
```

The CLI opens the selected regular file once, hashes its complete original bytes, and streams the body from that same descriptor. It supplies omitted name, length and checksum fields from the file. A declared length or checksum must match before transmission; source changes during hashing or transfer are detected.

`catalog-suggest` accepts `--catalog`, the original `--customer`, `--text` or `--text-file`, optional category/manufacturer/unit, and page controls. `catalog-facets` supplies the stored values. `catalog-quantity` requires `--catalog --material-key --material-sha256 --quantity --unit` and returns the exact original conversion.

Export a complete catalog for receiving:

```sh
starforge opensearch-catalog catalog-export \
  --source /private/materials/source.json \
  --workspace /private/materials/workspace \
  --catalog CATALOG_ID \
  --format catalog-bundle.jsonl \
  --output /private/materials/handover/catalog-bundle.jsonl
```

The command streams to a private temporary file, completes its checksum and file sync, then publishes the requested output. An existing output is accepted only if its complete bytes and checksum match. `--output -` sends only the original export body to stdout and the JSON receipt to stderr, so downstream file consumers receive the complete unchanged body.

For a lost mutation reply, repeat the original command and request file or use `catalog-operation --request-id ORIGINAL_ID`. The original journal returns that request's state. A pending, failed or interrupted mutation emits the saved operation and exits nonzero. Every command closes its opened original workspace after its operation or export stream has finished.

## Shared service and HTTP contract

Programmatic operators use `createOpenSearchWorkspace({directory,sourceFile,planFile,env})` from `../workspace/service.mjs`, then call its `catalog` member. Close the original workspace after admitted work has finished.

| Method | Purpose |
| --- | --- |
| `state()`, `catalog(id)`, `source(id)`, `edition(id)` | Read the retained model |
| `save(request)` | Create or revise an explicit mapping |
| `upload(metadata, bytes)` | Retain the exact original byte stream |
| `preview(request)` | Build a full or delta edition with its review identity |
| `materials({editionId,offset,limit,search})` | Page complete resulting materials |
| `changes({editionId,offset,limit})` | Page original before/after changes |
| `select(request)` | Select the exact reviewed edition at the expected catalog revision |
| `suggest(input)`, `facets(input)` | Read current candidate matches and original facet values |
| `quantity(input)` | Recheck the material checksum and calculate its exact quantity |
| `saveDecision(request)`, `decisions(input)` | Save and review contextual customer decisions |
| `createDraft(request)` | Continue through the original saved query workflow |
| `export(catalogId,format,options)` | Stream an edition, business handover or complete bundle |
| `importBundle(metadata,bytes)` | Validate and receive a complete retained catalog |

Mutations use the original `requestId` journal. A saved catalog requires `expectedRevision`; a decision requires `expectedCatalogRevision`, `expectedMaterialSha256` and any original `decisionId/expectedRevision`. The original operation result contains the created catalog, source, edition, decision or saved draft.

The browser API retains the original loopback Host/Origin gate. POST calls additionally require the current `x-workspace-token`, obtained from `GET /api/session` for that same workspace identity.

| HTTP route | Model operation |
| --- | --- |
| `GET /api/catalog/state` | Catalog state |
| `GET /api/catalog/catalogs/:id`, `sources/:id`, `editions/:id` | Full retained record |
| `GET /api/catalog/materials`, `changes`, `decisions` | Paged result or decision records |
| `GET /api/catalog/facets`, `quantity` | Original facet values or exact quantity review |
| `POST /api/catalog/suggest` | Candidate search with complete original customer text and optional facets |
| `GET /api/catalog/suggest` | The same search through declared query parameters |
| `POST /api/catalog` | Action `save`, `preview`, `select`, `decision` or `create-draft` |
| `POST /api/catalog/upload` | Stream `upload(metadata, request)` |
| `POST /api/catalog/import` | Stream `importBundle(metadata, request)` |
| `GET /api/catalog/export` | Download the requested catalog/edition format |
| `GET /api/operations/:requestId` | Read the original recorded outcome |

Upload/import requests use `application/octet-stream` and the `x-catalog-metadata` JSON header, limited to 12 KiB. Metadata includes `requestId`, `name`, exact `bytes` and `sha256`; source upload also supplies `format` and optional `provenance`. Encode non-ASCII metadata characters with JSON Unicode escapes when transmitting an HTTP header. A supplied Content-Length must match the selected size.

Catalog export responses consume the original synchronous or asynchronous byte iterable with backpressure. Large file content remains outside request JSON and catalog operation records. The byte stream, source metadata and original retained request identify the delivered source together.

## Supplier submission and BMEcat delivery

Open **Supplier delivery** to map a retained catalog edition to supplier requirements, resolve product findings, create BMEcat XML and carry the complete submission history into a customer handover. The [supplier operating guide](supplier/GUIDE.md) covers receiving profiles, reasoned corrections, CLI/HTTP use and the published ETIM example.
