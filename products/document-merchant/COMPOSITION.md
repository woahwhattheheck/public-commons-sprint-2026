# Generate customer documents from CSV or JSON

Use a saved dataset and reusable templates to produce complete invoices, greetings, reports or other customer documents. The composition workflow groups line items, selects the appropriate templates for each record, preserves the full editable source, and passes every generated document to the existing document merchant batch.

The original customer Request, Checkout, Jobs and Resource library own preparation, native payment, receiving and export. One order can produce an invoice and a greeting under the same parent task reference. Each generated PDF is its own document request and has the actual price returned by the selected merchant.

The installed command is:

~~~sh
starforge document-merchant compose --help
~~~

The same command can run from the repository:

~~~sh
node /absolute/merchant-repository/products/document-merchant/composition-cli.mjs --help
~~~

## Use Document production in the browser

The browser operates the same saved source, native batch, customer Request, Checkout, Jobs and Resource library as the CLI. Its starting page lists existing document sets and opens their original source and receiving state. Closing a tab leaves the running local service available; stopping the service drains its current work and releases the original customer directory.

Use the complete private options JSON that already selects this customer. The native checkout configuration is nested under `checkout`; for example:

~~~json
{
  "directory": "/absolute/existing-customer-workspace",
  "checkout": {
    "operatorWorkspace": "/absolute/existing-operator-workspace",
    "runtimeDirectory": "/absolute/merchant-repository/stellar/scf-starforge-20261009/sf88-operator-buyer-cli"
  }
}
~~~

An original Node buyer profile uses `checkout.operatorProfile` in place of `checkout.operatorWorkspace`. Retain the customer's other configuration, including any existing buyer roots, file roots, native timeout settings or input storage. The options file and standalone buyer profile are private files. The customer and operator directories remain the original private directories.

The service opens this complete options object through the original customer model. Keep one running owner of that customer directory. If the existing general Jobs application is open, stop that original application before opening Document production; its already saved requests and results remain in the same directory.

Start the browser:

~~~sh
starforge document-merchant compose serve \
  --workspace-options /absolute/private/customer-options.json \
  --provider snaplab \
  --merchant-origin https://your-commissioned-merchant.example
~~~

Replace the example origin with the actual document merchant's HTTPS origin. The command prints one complete startup JSON line containing `documentUrl`. Open that private local URL. The same startup record links to original Request, Checkout, Jobs, Collections, Resource library and job resolutions. All links use one local host and customer token.

Repository execution uses the same CLI leaf:

~~~sh
node /absolute/merchant-repository/products/document-merchant/composition-cli.mjs serve \
  --workspace-options /absolute/private/customer-options.json \
  --provider snaplab \
  --merchant-origin https://your-commissioned-merchant.example
~~~

The saved composition root defaults to:

~~~text
<original customer directory>/artifacts/document-compositions
~~~

Use `--source-root /absolute/allowed/private/compositions` to select another root inside that customer's existing allowed file roots. The controller validates this against the original customer, and it creates a private child directory for each document set. The default customer artifact root is already accepted by the original file intake.

| Service option | Meaning |
| --- | --- |
| `--workspace-options FILE` | Complete private original customer JSON; required |
| `--provider mintpdf|snaplab|pdfmint` | Initial renderer selection; defaults to `mintpdf` |
| `--merchant-origin HTTPS_ORIGIN` | Initial actual merchant origin; each document set retains its own selected origin |
| `--source-root DIR` | Existing allowed input root containing this customer's saved compositions |
| `--intake-key-env NAME` | Name of the original intake key in the private process environment |
| `--deadline-ms N` | Receiving wait per operation, 1000–3600000 milliseconds; default 300000 |
| `--poll-ms N` | Receiving poll interval, 250–30000 milliseconds; default 1500 |
| `--port N` | Local port; `0` selects an available port |
| `--expected-selection SHA` | Optional exact service selection returned by `inspect-service` |

Provider API keys remain with the original merchant's provider configuration. The optional intake environment name selects this customer's existing intake access. Credential values are kept in their private files or process environment.

### Prepare a complete saved document set

Select **New document set**. **Starting example** offers the complete JSON order, grouped CSV order line and Markdown report recipes. Choose **Load example** to load the matching dataset, templates and mappings; replace the example data with the actual complete customer files.

Choose the document set ID, name, renderer and **Commissioned merchant HTTPS origin**. The source form accepts a complete CSV or JSON file and the selected HTML or Markdown templates. Its complete recipe editor controls record grouping, JSON pointers, task references, optional templates and provider settings. **Apply mapping** reconciles the selected recipe with the source form.

Select **Prepare and save documents** to retain the complete dataset, configuration, templates, generated document source, source review and portable plan. This creates the source edition before any merchant quote or checkout. The saved page shows the source SHA256, document count and parent task count. **Download complete source plan** returns the full portable JSON; **Download source review** returns the whole readable source review.

A changed dataset or template becomes a new document set ID. Reopening a saved set selects its original source and batch. Selecting **Refresh** reloads the current saved state, including work completed through another ordinary CLI lifetime after this service stopped.

### Price, render and receive on the original customer

Select **Prepare merchant price** to stage the saved document source into the original file intake and prepare each native request. The page shows the aggregate price and the document requests behind it. **Exact saved quote** exposes the original batch SHA; **Download complete native plan** returns that saved plan.

Select **Render at this saved price** to use the displayed exact native plan. The original checkout and payment controls operate on their original intent, review, attempt and result records. The browser's Checkout link opens the same customer's existing approval interface.

The document table follows each source through its actual request, checkout, job and file receiving. **Receive existing jobs** continues original accepted jobs without replacing their request or checkout. The current operation can be stopped through **Stop current operation**. The controller aborts and drains its active work; the saved source, native records and any received outputs remain available for continuation.

Each received PDF and source file is a complete download through the original verified resource transfer route. A PDF becomes available when its actual native output receiver reports it received. The browser does not require copying resource bytes into a separate delivery store.

### Export complete customer editions

Select **Export received documents** to create an explicit customer export edition through the original Resource library Collection. It includes the actual received documents, original source and document metadata together with the full composition plan.

The saved page lists completed export editions and any partial export directory. **Continue this export** resumes the exact incomplete edition. A later newly requested export has its own edition ID, preserving earlier customer files while allowing updated Collection notes or annotations to be included.

Downloads use the original verified file descriptor and complete transfer route. Source plans, source reviews, native plans, PDFs and exported Collections retain their full bytes. Use the downloaded artifact when reviewing or delivering large content.

### Receive a complete portable source plan

The **Receive source plan** form accepts the original composition ID, complete source-plan SHA256 and one source location:

| Source location | Supported size and handling |
| --- | --- |
| **Complete source plan** browser file | One complete UTF-8 JSON file up to 28 MiB, received within the existing authenticated request body |
| **Or full local source file path** | One complete local plan up to 192 MiB, selected from the original customer's allowed file roots |

Choose one location for the operation. Supply the SHA from the original saved source, preserving its composition ID. The receiver restores the full dataset, configuration, templates, generated sources and source review. It checks the saved source against those bytes before reopening the native batch. A restored source plan can be priced by its selected original customer; an existing native batch continues using the already staged inputs.

For larger plans, place the complete original file inside an allowed local input root and use its physical path in the form. The full file remains a native file read; it does not pass through a partial browser upload. The CLI `receive-source` command below provides the same source receiving operation.

### Save Document production in Applications

Choose **Document production** in the installed Applications catalog. Its application kind is `document-composition`, and its original command is `document-merchant compose serve`.

Select the **Private customer options JSON**, optional saved composition root, initial renderer and actual merchant origin. Optional receiving settings use the same values as the CLI. **Private environment JSON** is the existing Applications environment file for the original intake credential; the catalog stores the file selection and hash.

Review and save this complete selection through the original Applications flow, then start it. The application opens the document browser and links to the same customer Request, Checkout, Jobs, library and Collections. Stop and reopen it through that same saved application.

The managed application shares the original `job-checkout` resource identity for the actual customer directory, so two saved application kinds cannot open simultaneous customer owners. It retains the existing customer's `job-workspace-launch.json` and verifies the actual running process, instance, checkout selection, private launch path and complete original URLs. The document page is an extension of that original host.

Applications binds the selected product modules, browser manifest and assets, imported implementation, native checkout runtime and private configuration files. Saved datasets, generated source editions and growing customer journals can change during ordinary operation without changing the launch selection. Updating the actual service source or customer checkout configuration is reviewed through the existing Applications selection process.

### Inspect the service before opening it

This command reads the complete source/configuration selection without opening the customer or starting HTTP:

~~~sh
starforge document-merchant compose inspect-service \
  --workspace-options /absolute/private/customer-options.json \
  --provider snaplab \
  --merchant-origin https://your-commissioned-merchant.example \
  --out /absolute/private/document-service-selection.json
~~~

It prints a compact review with the exact selection SHA, customer/checkout paths, saved composition root, configuration file pins and implementation counts. The optional new output file retains the complete selection, including every source file pin. Supply that selection SHA with `serve --expected-selection` to reopen the reviewed configuration.

The managed `--managed-source` argument is supplied by the original Applications launcher. Normal CLI operation uses the installed command's own source. Both paths compare the selected implementation and the original running customer's launch.

Ctrl-C or the original Applications Stop action closes host admission, drains document HTTP and background operations, closes the original native controllers and releases the customer. Reopening the same customer lists its saved document sets and resumes their original work.


## Choose the existing merchant and customer

Use the original commissioned document merchant and the existing private customer options JSON. That customer configuration selects its original Request and Checkout stores, Resource library, native operator and allowed input-file roots. Keep the same customer directory through preparation, payment continuation and receiving.

The original customer always accepts files within its own `artifacts` directory, alongside any other roots explicitly selected in its catalog. Put the composition output under that existing directory so the generated source is available to the original whole-file intake. Keep source inputs and the generated composition in separate private directories.

The command examples below use these names. Replace the absolute paths with the actual installed repository, merchant and original customer paths:

~~~sh
DOCUMENT_REPOSITORY=/absolute/merchant-repository
DOCUMENT_CUSTOMER=/absolute/existing-customer-workspace
DOCUMENT_WORKSPACE_OPTIONS=/absolute/private/customer-options.json
DOCUMENT_MERCHANT=/absolute/existing-document-merchant
DOCUMENT_INPUT=/absolute/private/order-input
DOCUMENT_COMPOSITION="$DOCUMENT_CUSTOMER/artifacts/orders-20261013"
DOCUMENT_CLI="$DOCUMENT_REPOSITORY/products/document-merchant/composition-cli.mjs"
~~~

Use a different composition directory and configuration ID for a newly selected dataset or changed templates. The original source files and accepted jobs remain available in the earlier composition.

### Copy the complete examples into a private input directory

The source reader requires a physical, private directory. The complete examples are shipped with the product:

~~~sh
mkdir -p "$DOCUMENT_INPUT"
chmod 700 "$DOCUMENT_INPUT"
cp "$DOCUMENT_REPOSITORY/products/document-merchant/examples/composition/"* "$DOCUMENT_INPUT/"
~~~

| Example family | Configuration | Dataset and templates | Generated example |
| --- | --- | --- | --- |
| JSON orders | `order-documents.json` | `orders.json`, `invoice.html`, `greeting.html` | Two orders and three documents |
| CSV line items | `grouped-order-documents.json` | `order-lines.csv`, the same invoice and greeting HTML | Three line items grouped into two orders and three documents |
| Markdown reports | `report-documents.json` | `reports.csv`, `report.md` | Two records and two reports |

The supplied configuration files contain `merchantOrigin: null`. Select the actual commissioned merchant before preparing requests.

For an HTML-capable merchant, this command writes a complete order configuration with its real origin and provider:

~~~sh
node "$DOCUMENT_CLI" template \
  --merchant-directory "$DOCUMENT_MERCHANT" \
  --out "$DOCUMENT_INPUT/selected-document-request.json"
~~~

It selects the default `orders.json`, `invoice.html` and `greeting.html` source paths. Edit its ID, name, field mappings, source paths and template choices to match the real customer data.

A merchant configured only for Markdown receives the complete shipped report configuration instead: `reports.csv` and `report.md`, with the actual installed provider, merchant origin and provider settings. Those source files are included in the same example directory.

To draft configuration before selecting an installed merchant:

~~~sh
node "$DOCUMENT_CLI" template \
  --provider mintpdf \
  --out "$DOCUMENT_INPUT/draft-document-request.json"
~~~

The supported provider selections are `mintpdf`, `snaplab` and `pdfmint`. Snaplab accepts HTML. MintPDF and PDFMint also accept Markdown. A provider-only template starts with the HTML order example; its origin is completed from the actual merchant before review.

## Review the source and stage the full composition

Review reads the complete configuration, dataset and templates, then returns the actual record/document counts, source sizes and hashes. It applies the same mapping and template renderer used by preparation.

~~~sh
node "$DOCUMENT_CLI" review \
  --request "$DOCUMENT_INPUT/selected-document-request.json" \
  --source-root "$DOCUMENT_INPUT"
~~~

Check the number of grouped records, selected records, documents and parent task references. For example, an order receiving both an invoice and greeting contributes two documents and one parent reference.

Stage the reviewed source into its selected composition directory:

~~~sh
node "$DOCUMENT_CLI" stage \
  --request "$DOCUMENT_INPUT/selected-document-request.json" \
  --source-root "$DOCUMENT_INPUT" \
  --directory "$DOCUMENT_COMPOSITION"
~~~

The response returns the complete source artifact path and SHA256, source preview path, native batch directory, and full counts. Open `preview.html` to search every generated document and open its complete HTML or Markdown source. Its table keeps the record key, template, original task reference, byte size and source SHA together.

The source directory contains:

| Path | Content |
| --- | --- |
| `composition-plan.json` | Complete original configuration, data, templates and every generated document, with their identities |
| `inputs/composition-request.json` | The selected editable configuration |
| `inputs/dataset.json` or `inputs/dataset.csv` | The whole original dataset |
| `inputs/template-ID.html` or `inputs/template-ID.md` | Complete original templates |
| `documents/doc-ID.html` or `documents/doc-ID.md` | Complete generated source for each selected record/template |
| `batch-input.json` | The original native batch request over the generated files |
| `preview.html` | Searchable source and record review |
| `batch/` | The original native batch plan, created by quote preparation |

The composition source and native batch have their own original create-once directories. Every composition command accepts the outer `DOCUMENT_COMPOSITION` directory and opens its retained `batch/` child automatically.

Reopen or complete an interrupted source stage using its original plan:

~~~sh
node "$DOCUMENT_CLI" stage --directory "$DOCUMENT_COMPOSITION"
~~~

This restores the exact retained source files. It preserves the original configuration even after the input folder has changed. Inspect the staged files and verify a previously returned full source SHA with:

~~~sh
node "$DOCUMENT_CLI" source \
  --directory "$DOCUMENT_COMPOSITION" \
  --sha256 EXACT_RETURNED_SOURCE_SHA256
~~~

## Prepare the original native price

Preparation stages every complete generated source through the original customer intake and returns the merchant’s actual batch quote.

~~~sh
node "$DOCUMENT_CLI" prepare \
  --directory "$DOCUMENT_COMPOSITION" \
  --workspace-options "$DOCUMENT_WORKSPACE_OPTIONS"
~~~

You can combine first staging and quote preparation:

~~~sh
node "$DOCUMENT_CLI" prepare \
  --directory "$DOCUMENT_COMPOSITION" \
  --workspace-options "$DOCUMENT_WORKSPACE_OPTIONS" \
  --request "$DOCUMENT_INPUT/selected-document-request.json" \
  --source-root "$DOCUMENT_INPUT"
~~~

The response includes:

| Field | Meaning |
| --- | --- |
| `composition.sha256` | Complete retained dataset/template source-plan identity |
| `composition.counts` | Actual source, grouped, selected and document counts |
| `batch.directory` | The original native batch directory |
| `batch.planSha256` | Exact saved native plan required for Run |
| `batch.workspaceDirectory` | Original customer owning requests, checkout and receiving |
| `batch.totals` | Document count and maximum atomic amount for each native payment term group |
| `batch.unitMeaning` | Document requests, output packages and parent task references |

Payment totals retain the original scheme, network, asset, recipient and payment flow. Keep atomic-unit amounts as their returned decimal strings. The same complete saved plan is available in `batch/batch-plan.json`.

An intake endpoint requiring access can use its original environment reference:

~~~sh
node "$DOCUMENT_CLI" prepare \
  --directory "$DOCUMENT_COMPOSITION" \
  --workspace-options "$DOCUMENT_WORKSPACE_OPTIONS" \
  --intake-key-env DOCUMENT_CUSTOMER_INTAKE_TOKEN
~~~

The command reads the environment variable locally and passes its value to the original intake. The prepared result contains the original source and native request identities.

## Render, receive and continue the same jobs

Run uses the exact `batch.planSha256` returned by preparation. Review the actual total, source counts, recipient and payment terms before passing that saved value:

~~~sh
node "$DOCUMENT_CLI" run \
  --directory "$DOCUMENT_COMPOSITION" \
  --workspace-options "$DOCUMENT_WORKSPACE_OPTIONS" \
  --approve-plan EXACT_RETURNED_BATCH_PLAN_SHA256
~~~

The original Checkout broker checks each actual native intent and budget. Run continues existing checkout attempts and accepted jobs. Its progress stream carries the current document and original request identity. The final summary reports states, complete output counts, parent document sets, and any document-specific errors.

Save the complete original results alongside a run:

~~~sh
DOCUMENT_REVIEW=/absolute/private/orders-review-20261013

node "$DOCUMENT_CLI" run \
  --directory "$DOCUMENT_COMPOSITION" \
  --workspace-options "$DOCUMENT_WORKSPACE_OPTIONS" \
  --approve-plan EXACT_RETURNED_BATCH_PLAN_SHA256 \
  --out "$DOCUMENT_REVIEW"
~~~

The original report contains `batch-plan.json`, `batch-results.json`, `batch-results.csv` and `batch-review.html`. It retains all request, checkout, job, settlement, resource and output identities. The console keeps a concise summary while those complete records stay in the files.

Run/receive exits with code 2 when some documents need continuation. The complete result is printed before that exit. Inspect the actual returned supplier, payment or file state and continue the same operation.

For already accepted jobs, receive through the original customer:

~~~sh
node "$DOCUMENT_CLI" receive \
  --directory "$DOCUMENT_COMPOSITION" \
  --workspace-options "$DOCUMENT_WORKSPACE_OPTIONS" \
  --out /absolute/private/orders-receiving-20261013
~~~

Both commands accept `--deadline-ms` from 1,000 to 3,600,000 and `--poll-ms` from 250 to 30,000. Defaults are 300,000 ms and 1,500 ms for each original document receiving operation.

A supplier allowance or account failure is retained against its original job. Run can leave later original requests ready for continuation. Inspect the merchant’s actual `document-merchant price` and `document-merchant usage` outputs and resume using the same plan when the selected supplier account can fulfill the work.

### Inspect every original customer record

Read a compact current summary:

~~~sh
node "$DOCUMENT_CLI" show \
  --directory "$DOCUMENT_COMPOSITION" \
  --workspace-options "$DOCUMENT_WORKSPACE_OPTIONS"
~~~

Save a complete readable report without running further documents:

~~~sh
node "$DOCUMENT_CLI" review-batch \
  --directory "$DOCUMENT_COMPOSITION" \
  --workspace-options "$DOCUMENT_WORKSPACE_OPTIONS" \
  --out /absolute/private/orders-current-review
~~~

Open the original Request, Checkout, Jobs, Resource library and Collections application:

~~~sh
node "$DOCUMENT_CLI" open \
  --directory "$DOCUMENT_COMPOSITION" \
  --workspace-options "$DOCUMENT_WORKSPACE_OPTIONS" \
  --port 0
~~~

Use the returned private URL. This process holds the original customer workspace until it closes. Close it at the ordinary command boundary before another command opens that same customer. Ctrl-C drains its original host and customer handles.

### Continuation table

| Saved work | Command |
| --- | --- |
| Complete inputs ready for a first source review | `review --request … --source-root …` |
| Interrupted source materialization | `stage --directory …` |
| Retained source, quote preparation unfinished | `prepare --directory … --workspace-options …` |
| Reviewed original quote or interrupted payment | `run … --approve-plan ORIGINAL_SHA` |
| Accepted jobs awaiting complete outputs | `receive …` |
| Current aggregate state | `show …` |
| Complete per-document current records | `review-batch … --out NEW_DIR` |
| Full received customer handover | `export … --out NEW_DIR` |

Run, receive and export read the retained composition-to-batch binding. They continue the originally staged native files even if a materialized preview or editable source file was removed. Use `stage --directory …` to restore the saved editable source when needed.

## Configure real customer data

The configuration schema is `stellar-forge.document-composition.v1`. Dataset paths and template paths are relative to the chosen input root. Their complete content is saved in the composition plan.

### JSON orders and nested arrays

A JSON dataset can be an array:

~~~json
[
  {
    "order_id": "ORD-1042",
    "customer": {"name": "North Workshop"},
    "invoice_date": "2026-10-13",
    "currency": "USD",
    "total": "129.00",
    "gift_message": "Thank you for your order.",
    "items": [
      {"description": "Workshop kit", "quantity": "2", "line_total": "100.00"},
      {"description": "Delivery", "quantity": "1", "line_total": "29.00"}
    ]
  }
]
~~~

A minimal configuration for an HTML invoice is:

~~~json
{
  "schema": "stellar-forge.document-composition.v1",
  "id": "orders-20261013",
  "name": "Customer order documents",
  "provider": "mintpdf",
  "merchantOrigin": "https://your-actual-commissioned-merchant.example",
  "dataset": {
    "source": "orders.json",
    "format": "json",
    "recordsPointer": ""
  },
  "recordKey": "/order_id",
  "taskReference": "order-{{order_id}}",
  "bindings": {},
  "templates": [
    {
      "id": "invoice",
      "source": "invoice.html",
      "format": "html",
      "title": "Invoice {{order_id}}",
      "label": "Invoice {{order_id}}"
    }
  ],
  "maxGeneratedBytes": 16777216
}
~~~

Replace the illustrative origin with the actual installed merchant. The template command fills that value from the existing merchant directory.

For an API response such as `{"data":{"orders":[…]}}`, set `recordsPointer` to `/data/orders`. JSON Pointer uses `~1` for a slash in a key and `~0` for a tilde. Set `recordKey` to the stable identifier within each selected record.

Keep long numeric identifiers as strings. The reader rejects integers outside JavaScript’s exact integer range so source IDs and amounts retain their intended values.

### CSV rows and grouped line items

CSV accepts comma, semicolon or tab delimiters, including quoted delimiters, doubled quotes and quoted line breaks. Header names remain exact. Source cells retain their supplied text.

A grouped dataset can look like this:

~~~csv
Order ID,Customer Name,Invoice Date,Currency,Total,Gift Message,sku,description,quantity,unit_price,line_total
ORD-1042,North Workshop,2026-10-13,USD,129.00,Thank you.,KIT-1,Workshop kit,2,50.00,100.00
ORD-1042,North Workshop,2026-10-13,USD,129.00,Thank you.,SHIP,Delivery,1,29.00,29.00
~~~

Use this dataset and mapping selection:

~~~json
{
  "dataset": {
    "source": "order-lines.csv",
    "format": "csv",
    "delimiter": ",",
    "group": {
      "key": "Order ID",
      "itemsAs": "items",
      "itemFields": ["sku", "description", "quantity", "unit_price", "line_total"]
    }
  },
  "recordKey": "/Order ID",
  "taskReference": "order-{{order_id}}",
  "bindings": {
    "order_id": "/Order ID",
    "customer_name": "/Customer Name",
    "invoice_date": "/Invoice Date",
    "currency": "/Currency",
    "total": "/Total",
    "gift_message": "/Gift Message",
    "items": "/items"
  }
}
~~~

Merge those fields into the full request produced by `template`. Grouping preserves the first-seen order of groups and source rows. Fields selected in `itemFields` become array entries; every other field remains the order header and must agree across rows with the same group key. This catches conflicting customer names, totals or dates within one order.

With empty `bindings`, templates read the entire selected record. With named bindings, templates read only that mapped context. Map any values used by the title, label and task reference as well as the body.

### Conditional template selection

Add a greeting for records with a gift message:

~~~json
{
  "id": "greeting",
  "source": "greeting.html",
  "format": "html",
  "title": "Greeting {{order_id}}",
  "label": "Greeting {{order_id}}",
  "when": {"pointer": "/Gift Message", "notEmpty": true}
}
~~~

The `when.pointer` addresses the original selected or grouped record before bindings. In a JSON order using a `gift_message` property, use `/gift_message` instead.

An equality condition is explicit:

~~~json
"when": {"pointer": "/selected", "equals": "yes"}
~~~

Choose either `equals` or `notEmpty`. JSON scalar types are preserved: the string `"yes"`, number `1` and boolean `true` are distinct values. An order for which no template is selected is included in `excludedRecords`.

## Write reusable templates

Keep document markup and layout in the template; insert customer data with two braces. HTML values are escaped for HTML, Markdown values for Markdown, and text fields such as the native title and task reference preserve their supplied text.

~~~html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Invoice {{order_id}}</title>
  <style>
    body { font: 14px system-ui, sans-serif; color: #222; margin: 32px; }
    h1 { font-size: 24px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
  </style>
</head>
<body>
  <h1>Invoice {{order_id}}</h1>
  <p>{{customer_name}} · {{invoice_date}}</p>
  <table>
    <thead><tr><th>Item</th><th>Quantity</th><th>Amount</th></tr></thead>
    <tbody>
    {{#each items}}
      <tr><td>{{description}}</td><td>{{quantity}}</td><td>{{line_total}}</td></tr>
    {{else}}
      <tr><td colspan="3">No line items supplied.</td></tr>
    {{/each}}
    </tbody>
  </table>
  <p>Total: {{currency}} {{total}}</p>
  {{#if gift_message}}<p>{{gift_message}}</p>{{/if}}
</body>
</html>
~~~

This example uses the CSV alias mapping above. For the JSON order example, either bind `customer_name` to `/customer/name` or use `{{customer.name}}` in the body.

| Syntax | Meaning |
| --- | --- |
| `{{field}}`, `{{customer.name}}` | Required scalar value in the current context |
| `{{#each items}}…{{/each}}` | Each array item becomes the current context |
| `{{#each items}}…{{else}}…{{/each}}` | Alternate content for an empty or missing list |
| `{{#if optional}}…{{else}}…{{/if}}` | Conditional content using the current context |
| `{{@root.order_id}}` | Root record context inside a nested list |
| `{{@index}}` | Zero-based current array index |
| `{{@number}}` | One-based current array position |
| `{{.}}` | Current scalar array item |

Put optional values inside a conditional block. A required missing value returns its field name for correction. The renderer accepts field paths and blocks; all computations, money formatting and business totals belong in the supplied source data. It renders the exact declared values.

Template-specific `settings` select original provider options. Omitting settings uses the provider’s documented defaults. An explicitly supplied settings object is preserved. Select only formats supported by the commissioned provider.

## Export the complete customer result

Export uses the original Resource library Collection over the received job packages and their complete named files. It also includes the complete source composition plan:

~~~sh
DOCUMENT_EXPORT=/absolute/private/orders-delivery-20261013

node "$DOCUMENT_CLI" export \
  --directory "$DOCUMENT_COMPOSITION" \
  --workspace-options "$DOCUMENT_WORKSPACE_OPTIONS" \
  --out "$DOCUMENT_EXPORT"
~~~

| Exported file | Content |
| --- | --- |
| `documents.tar` | Original portable Collection with received packages, PDFs, editable sources and metadata |
| `batch-export.json` | Original Collection identity, revision, received count and archive SHA |
| `batch-plan.json` | Saved native requests and reviewed payment terms |
| `batch-results.json` | Complete request, checkout, job, settlement and output mapping |
| `batch-results.csv` | Per-document and parent-reference mapping |
| `batch-review.html` | Readable original batch results |
| `composition-plan.json` | Complete dataset, configuration, templates and generated documents |
| `composition-export.json` | Composition source identity joined to the original Collection export |

The export response returns the actual received count. The original Collection can contain the received portion of a continuing batch; its report retains every pending request. A new export directory captures a later receiving edition while earlier files remain readable.

Copy the complete archive to a receiving host and import it through the original Collection receiver:

~~~sh
node "$DOCUMENT_CLI" receive-collection \
  --archive /absolute/received/documents.tar \
  --destination /absolute/private/received-document-collection \
  --library-state /absolute/private/received-resource-library \
  --sha256 EXACT_RETURNED_ARCHIVE_SHA256
~~~

Restore the complete editable source artifact independently:

~~~sh
node "$DOCUMENT_CLI" receive-source \
  --source /absolute/received/composition-plan.json \
  --directory /absolute/private/received-composition \
  --sha256 EXACT_RETURNED_SOURCE_SHA256
~~~

Source receiving materializes every original dataset, template and generated document from the selected plan. It preserves their bytes and original parent references. Completed PDFs and accepted native jobs travel through the original Collection and customer workspaces. Continue an existing payment or job from its original customer and saved native plan.

The export allowance can be selected with `--max-bytes` on export and Collection receiving. It is passed to the original whole-archive implementation.

## Operating limits and result units

| Quantity | Current source limit |
| --- | --- |
| Dataset | 16 MiB |
| Each template | 1 MiB |
| Templates per composition | 8 |
| Source records | 100,000 |
| Generated documents | 2,000 |
| Generated source allowance | 16 MiB by default; up to 64 MiB through `maxGeneratedBytes` |
| Complete portable plan | 192 MiB |
| Each generated document | Selected provider’s original source-size limit |
| Nested template blocks | 16 |
| Template iterations | 100,000 per rendered document by default |

Source limits are checked before native batch preparation. The merchant’s actual provider account, worker limits, catalog, native payment terms and original customer budget govern fulfillment.

A parent order containing an invoice and greeting is one parent task reference and two document requests. The received complete document set describes its delivered files. Customer acceptance and commercial completion continue in the original business workflow.

| Exit code | Meaning |
| --- | --- |
| 0 | Command or requested source/report/export operation completed |
| 1 | Input, source, filesystem or native operation returned an error |
| 2 | Run/receive returned original documents needing continuation |
| 130 | An interrupted active command drained its original customer |

The full original interfaces are documented in [BATCHES.md](BATCHES.md), [OPERATING.md](OPERATING.md), [composition.mjs](composition.mjs), and [composition-cli.mjs](composition-cli.mjs). The typed API is in [composition.d.mts](composition.d.mts).


## Ordered invoice and report bundles

After receiving the original PDFs, use the same Document production browser's Ordered PDF bundle step or `document-merchant assemble` to prepare exact customer order, review the original assembly price, fulfill and receive every volume, and export one complete customer archive. The PDFMint-backed `assemblePdfs` function is enabled explicitly with its own native payment terms. Single-PDF volumes retain their original bytes without a merge purchase. See [ASSEMBLY.md](./ASSEMBLY.md) for complete merchant setup, local/batch source intake, CLI commands, continuation, output units and independent customer receiving.

## Assemble PDFs that already exist

Use **Bundle existing PDFs** in the same Document production application to upload complete invoices or reports, choose their order, review the original assembly price, receive the paid volumes and export the complete customer bundle. It also receives the original whole assembly source plan from an upload or a declared local file. [Existing PDF intake](ASSEMBLY.md#existing-pdf-intake-in-the-customer-browser) covers complete source and export continuation, limits, original payment units and the installed API. The same customer owner and Resource library remain in use.


## Correct selected documents or order an unchanged repeat

A saved source set can contain many customer records and several documents per record. Use the selected-document workflow when a customer needs a corrected invoice, updated report or another unchanged rendering. It creates a new source set for only the chosen documents. The original source, merchant requests, paid jobs and PDFs retain their existing identities.

### Browser workflow

Open the original saved set in **Document production**. Select the affected documents using the checkboxes in **Documents and receiving**. **Select this page** selects every document on the current page; selection is retained when you move through further pages of that same source. **Clear selection** clears the whole selection. The selected count covers all pages.

Choose **Edit selected documents** or **Repeat selected documents**. The editor loads complete original records and the selected template bodies. CSV line items have already been grouped by the original recipe, so the selected record includes all its original line items. Selecting an invoice for one order and a greeting for another produces those two documents; it does not render the other record/template combinations.

Give the new set a distinct ID, name and reason. For a correction, edit the fields under **Selected record**. Numeric fields retain their numeric type, and CSV strings remain strings. **Complete record JSON** includes every nested field and line item; use **Apply complete record** after editing that view. Each selected template has its full editable source. Keep the selected record keys and original business task references. A different order or business task belongs in a new document set.

An unchanged repeat loads the same source with record/template editing disabled. It preserves every selected generated-source hash. Repeat is an explicit new rendering request; its provider response and resulting PDF may reflect the provider's current rendering environment.

Choose **Download editable draft** whenever work needs to continue later. This file includes all selected editable records and templates, the original source SHA256, exact selected document IDs, mode, new ID/name and reason. Open the original source set and use **Continue a saved correction draft** to reload it. The original source is checked again when the derived source is saved. A draft is limited to 32 MiB.

Choose **Prepare selected source documents**. The resulting saved set includes the complete edited records, templates, generated HTML/Markdown, original task references and parent source relationship. Its heading identifies the original set and reason, with **Open original document set** returning to the earlier results. Download the generated source documents or the complete source review before purchasing.

The remaining controls are the original production workflow:

1. **Prepare merchant price** prepares only the new set's selected document requests.
2. Review the exact network, asset, recipient, payment flow, document count and amount.
3. **Render at this saved price** purchases those requests through the original customer checkout.
4. **Receive existing jobs** continues accepted requests and receives their complete PDF/source/request/render files.
5. **Export received documents** produces the complete original Collection and source plan.

A selected replacement remains under its original business task reference and has a new document-set ID, native request and reviewed price. The operator retains the original and replacement files in their respective saved sets.

### CLI workflow

First read the original saved source and record its exact returned SHA256:

~~~sh
starforge document-merchant compose source \
  --directory /absolute/private/documents/original-orders
~~~

The complete source plan lists each document's ID, record key, template and original task reference. Write a selection file using the actual IDs from that plan:

~~~json
{
  "id": "orders-corrected-20261013",
  "name": "Corrected customer invoices",
  "mode": "correction",
  "reason": "Correct the line-item description requested by the customer.",
  "documentIds": ["ACTUAL_ORIGINAL_DOCUMENT_ID"]
}
~~~

Create the complete editable draft:

~~~sh
starforge document-merchant compose correction-draft \
  --directory /absolute/private/documents/original-orders \
  --sha256 ACTUAL_ORIGINAL_SOURCE_SHA256 \
  --selection /absolute/private/correction-selection.json \
  --out /absolute/private/correction-draft.json
~~~

The command returns the full draft's path, byte count and SHA256. Edit its complete `records` and `templates` fields. Retain its original `parent` and selected `documentIds`. Set `mode` to `repeat` for an unchanged repeat and retain the original records and template contents.

Review the generated result and optionally save the complete portable plan:

~~~sh
starforge document-merchant compose review-correction \
  --parent-directory /absolute/private/documents/original-orders \
  --draft /absolute/private/correction-draft.json \
  --out /absolute/private/correction-plan.json
~~~

Save and materialize the corrected source using the original receiver:

~~~sh
starforge document-merchant compose correct \
  --parent-directory /absolute/private/documents/original-orders \
  --draft /absolute/private/correction-draft.json \
  --directory /absolute/private/documents/orders-corrected-20261013
~~~

The returned source receipt includes the exact source SHA256, generated document counts, full source/preview paths and the original batch directory. Repeating the command with identical source reopens the same saved result. Changed bytes cannot replace an already saved derived source under that ID.

Continue with the original commands:

~~~sh
starforge document-merchant compose prepare \
  --directory /absolute/private/documents/orders-corrected-20261013 \
  --workspace-options /absolute/private/customer-options.json

starforge document-merchant compose run \
  --directory /absolute/private/documents/orders-corrected-20261013 \
  --workspace-options /absolute/private/customer-options.json \
  --approve-plan ACTUAL_RETURNED_NATIVE_PLAN_SHA256 \
  --out /absolute/private/corrected-orders-receiving
~~~

The original `receive`, `review-batch`, `open`, `export`, `receive-source` and `receive-collection` commands operate on that same saved derived set. A partial native run keeps its original requests and can be continued with the original saved price. The full exported source retains the exact parent source ID/SHA and each selected original document's ID, source SHA and business task reference.

### Source contract

The optional `correction` member of a composition request carries `stellar-forge.document-correction.v1`, mode, reason, parent source ID/SHA and the exact selected record/template pairs. Older requests omit it and retain their previous normalization and source bytes. The source compiler requires every selected pair to generate exactly one document; a changed condition cannot silently remove a selected replacement. It also requires the original task reference to remain equal. An unchanged repeat must preserve every selected generated-source hash.

The helper `documentCorrectionDraft` loads complete grouped records and templates from a saved composition receipt. `composeDocumentCorrection` regenerates selected source without touching native requests. `stageDocumentCorrection` reads the original saved source and saves the derived plan through the existing composition receiver. Browser operations use the original authenticated host and its background-operation lifetime. Payment and complete file receiving stay in the original batch.

## Connect an agent to this same customer

The original running host also provides `/api/document-composition/mcp`. Use `document-merchant agent config --launch /actual/customer/job-workspace-launch.json --out /private/document-agent.json` to create a private HTTP client entry, or connect through the typed `agent-client.mjs` interface. The complete [agent guide](AGENT.md) covers dataset/template intake, original price review, an explicit exact-plan execution call, original-job continuation, selected corrections, PDF bundles and full customer exports. The original customer model, source directories, payment journals and service lifetime remain authoritative.
