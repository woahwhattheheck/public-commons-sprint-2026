## Document processing and complete customer receiving

A report publisher, agency or analyst can commission a document service that carries the customer's editable input through a paid rendering job into a complete reusable delivery. The maintained Document merchant joins supplier configuration, Stellar payment terms, customer Requests, Jobs, document output and receiving in the original application. The customer receives the PDF together with the source and the information needed to relate it to the original request.

### Configure and operate the saved merchant

The [Document merchant Applications guide](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/ae86e3bcaedd1ee65309cda455984f8102948905/products/document-merchant/APPLICATIONS.md) describes the installed workflow available in [public PR3004](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/3004). Select the actual MintPDF, snaplab or PDFMint supplier, its account plan, supported source formats, queue and worker limits. The editable setup retains the merchant's public HTTPS origin, native asset, recipient and amount. The operating host's private environment supplies the actual provider key and payment-factory configuration.

In the existing Runtime Workspace, open **Applications**, select **Document merchant**, and choose the original document directory, complete setup, native payment factory and private environment. Review the seller, customer and private operator listeners, the original worker and any configured completed-result delivery. Use **Review**, **Save**, **Review Start** and **Start**. The saved application receives the original authenticated Jobs announcement and opens the selected Jobs, Input receiving, Job resolution or Result delivery page.

The document directory retains its original setup and merchant state. A newly reviewed directory is prepared on first start; an existing directory reopens its retained merchant. The generic Paid-job merchant application and Document merchant refer to that same underlying resource when they select the same merchant-state directory. The published HTTPS origin remains the customer entry point.

### Fulfill and receive the whole customer document

Export the merchant's complete customer setup:

```sh
document-merchant customer-setup \
  --directory /absolute/private/document-service \
  --out /absolute/private/document-customer-setup.json
```

The customer opens its existing **Request** application, loads that origin, selects `renderHtml` or the supported `renderMarkdown` function, and supplies the complete editable source file, title and original task reference. The request and native checkout retain that exact input and advertised one-document price. After the original purchase settles, the configured worker calls the selected supplier and produces the complete delivery.

|Delivered slot|What the receiving customer gets|
|  ---  |  ---  |
|PDF|The complete binary document.pdf.|
|Source|The unchanged UTF-8 HTML or Markdown submitted for that document.|
|Request|Complete source and rendering-request metadata, including the original task reference.|
|Render|The actual supplier response metadata and resulting document identity.|


The customer's existing resource library receives all four files. Multi-document batches use the same original Requests, checkouts, Jobs and complete Collection export. Their saved batch operation continues an accepted request through recovery and receiving. In the Commons customer workflow, the rendered Lead Pack uses the saved HTML edition and attaches its PDF to the original Case Desk delivery, preserving that case and edition.

### Prepare complete customer data and templates

The installed composition workflow starts from the customer's entire CSV or JSON dataset and editable HTML or Markdown templates. It maps named fields, groups line items where the source represents an order across several rows, and can generate an invoice plus an optional greeting card under one parent task reference. A reporting recipe can produce a complete report for each selected customer or period. The [composition operating guide](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/ae86e3bcaedd1ee65309cda455984f8102948905/products/document-merchant/COMPOSITION.md) includes complete JSON orders, grouped CSV orders and Markdown reports with their original input files and mappings.

The saved source plan retains the complete dataset, templates, recipe and every generated document. The customer can inspect a working page and download the full original files. Exact source selection continues into the [original document batch](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/ae86e3bcaedd1ee65309cda455984f8102948905/products/document-merchant/batch.mjs), whose existing Request preparation obtains the merchant's actual native price before execution. The plan groups amounts by their network, asset, recipient and payment flow. One selected parent task can contain several independently priced document requests.

### Operate Document production in the original customer workspace

In the installed Applications catalogue, **Document production** opens that same customer's existing Request, Checkout, Jobs and Resource library, adding the complete document workspace at `/documents/`. Its selection retains the original private customer-options file, nested Checkout/operator configuration, allowed source directory, provider and actual merchant origin. The [managed service](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/ae86e3bcaedd1ee65309cda455984f8102948905/products/document-merchant/composition-service.mjs) reads the original customer's launch and owns the same customer lifetime as the generic Job checkout application.

The customer uploads every complete dataset and template file, reviews the generated document and parent-task counts, and chooses **Prepare merchant price**. **Render at this saved price** executes the exact original native plan. **Receive existing jobs** continues already accepted work. The [document customer workspace](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/ae86e3bcaedd1ee65309cda455984f8102948905/products/document-merchant/composition-workspace.mjs) keeps source preparation, original paid execution, full receiving and customer export connected to those same saved records. A reopened browser resumes from the original source plan and native batch.

The original resource download route returns the full binary PDF for each received document. A portable Collection includes the PDFs, unchanged sources, original requests and renderer results; the composition handover adds the full dataset, templates and recipe. An interrupted export continues its original destination, and a later customer edition retains its own complete output. Stopping the application closes admission, drains document work, and then closes the customer's original controllers and state owner.

### Run complete paid document work from an agent

The existing Document production customer also exposes its complete saved workflow through an authenticated MCP interface. An agent can supply the original CSV/JSON dataset and HTML/Markdown templates, inspect generated sources and task references, prepare the original native quote, and execute only the explicitly approved saved plan. The same interface supports selected corrections and unchanged repeats, existing-job receiving, ordered volumes and existing-PDF bundles. Its fixed tool catalog borrows the original customer controller and payment journals; the browser, installed CLI and agent retain the same sources, account and service lifetime. The [complete operating guide](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/d0d677d4a9f9819c79758385f896c9e388eab99c/products/document-merchant/AGENT.md) and [source-owned adapter](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/d0d677d4a9f9819c79758385f896c9e388eab99c/products/document-merchant/agent.mjs) carry the exact customer workflow.

Accepted rendering returns the original operation ID, which the agent can poll or continue through the existing saved customer. The complete native result rows and receiving reports retain actual request, payment and parent-task identity. The [typed remote client](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/d0d677d4a9f9819c79758385f896c9e388eab99c/products/document-merchant/agent-client.mjs) receives full PDF, source and Collection files through the original verified reader, checks the entire byte count and SHA256, and saves each complete destination without replacing an existing customer file. Closing a client or reaching a wait deadline leaves the original admitted work available for receiving. Customer acceptance, native purchases, supplier usage, PDF pages and prepaid allowance retain their existing separate units and funded scope.

### Correct selected customer documents and fulfill the replacements

A customer can reopen a saved production set and select the individual invoices or reports that need correction. The [selected-document workflow](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/2bb65304417732a9d910301790cc59ac4beb2de7/products/document-merchant/COMPOSITION.md#correct-selected-documents-or-order-an-unchanged-repeat) loads complete original records, grouped line items and template bodies into an editable browser form. The customer can save a portable draft, continue it later, and prepare a new source set containing only the selected documents. Selecting an invoice for one order and a greeting for another produces those two replacements.

Each derived set retains its exact original source relationship, selected document identities, reason and business task references. An unchanged repeat uses the same selected source. The [correction implementation](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/2bb65304417732a9d910301790cc59ac4beb2de7/products/document-merchant/corrections.mjs) requires every selected document to remain represented, including when a recipe has conditional templates. The new set then uses the existing merchant price review, original customer checkout, complete PDF/source receiving and Collection export. The earlier source and results remain available from the same workspace.

### Deliver ordered invoice and report bundles

A merchant's customer can require both the individual documents and a complete nightly bundle. The same document product now carries that remaining fulfillment step: select the fully received PDFs in the required business order, preserve every original file, review the assembly merchant's actual native price, receive all merged volumes and hand over one complete customer archive. The [installed ordered-bundle workflow](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/ae86e3bcaedd1ee65309cda455984f8102948905/products/document-merchant/ASSEMBLY.md) is available through the existing Document production browser and `document-merchant assemble`.

PDFMint's optional `assemblePdfs` function uses its [original merge endpoint](https://pdf.mintapis.com/docs#merge), checked on 13 October 2026. The merchant selects a complete native price for one merged volume. The [source and original batch integration](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/ae86e3bcaedd1ee65309cda455984f8102948905/products/document-merchant/assembly.mjs) divides the complete ordered source by the documented 50-file and measured encoded-request limits. A volume with one PDF retains its exact original bytes without a supplier merge or new native purchase. For a nightly invoice task, individual render requests and any assembly requests remain separately priced operations under that same parent task.

The customer archive contains every final PDF volume, a readable index, CSV results, every original PDF in the editable source plan and the unchanged original paid-job Resource Collection. Receiving and interruption recovery continue the original customer requests and jobs. The supplier's one successful merge credit, number of source PDFs, PDF pages, native purchase count and whole customer-task acceptance retain distinct units. This extends the document service's existing customer commissioning and maintenance work within the same six funded packages.

### Maintain the service and continue customer work

Supplier consumption and the merchant's customer price have their own recorded basis. **Price** review uses the saved supplier plan and native payment terms; **Usage** reads the supplier's actual account endpoint and saves its complete response. A 25-document planning review can use `document-merchant price --directory /absolute/private/document-service --documents 25 --supplier-units 25`. The selected account plan and returned usage determine the operating allowance.

**Stop** closes admission on the original listeners, drains the worker and configured delivery dispatcher, and releases the merchant state. **Review Start** and **Start** then reopen the same saved application, retained requests, completed files and eligible jobs. Interrupted setup continues from its retained setup and generated files. A supplier authentication or allowance failure remains attached to its original job; after the account issue is corrected, the operator uses that job's existing resolution or retry action.

Receive the completed immutable document-product distribution into the existing Runtime Workspace and reopen Applications to load its current catalogue. For customer commissioning, operate the actual merchant factory and customer workspace: start the managed service, fulfill the selected original HTML or Markdown through the existing batch, receive all four files, attach the output to its original task, and reopen the same completed job after stopping and restarting the application.

### Receive PDFs from existing customer systems

The same customer browser accepts complete invoices, reports and other PDFs that already exist. The operator selects their business order, saves every original byte, reviews the assembly merchant’s actual native quote and receives each resulting volume through the original paid batch. This supports nightly invoice packs and customer report bundles even when another application produced the documents. Complete source plans can also be received from the customer’s declared local file roots, and interrupted saving or export resumes its original source and destination.

The delivered bundle includes every final PDF, all original sources, the readable volume index and the original native Collection. One-file volumes remain unchanged. Original documents, paid merge requests, supplier credits, PDF pages and accepted parent tasks continue to have separate counts. This is an additional customer intake of the same document service within the existing service-adaptation packages and merchant adoption targets.

### Continue an existing merchant installation

An existing native buyer account can commission the document service using its original operator profile and facilitator policy, or an HTTP commerce installation can use its retained original setup. The [complete commissioning workflow](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/ae86e3bcaedd1ee65309cda455984f8102948905/products/document-merchant/COMMISSIONING.md) selects the complete document payment terms within the actual account policy, preserves the configured asset, recipient and payment flow, and reuses the original payer, operator budget and native facilitator. The original profile retains the payer, signer and spending-ledger identity. When commissioning from a prepared commerce installation, its selected native offer supplies the service configuration. Each new customer document has its own original Request, Checkout and Jobs identity under the actual business task.

For a PDFMint service, that same commissioning can include an explicit assembly payment within the original account policy. It preserves the separate rendering and merge-volume prices while sharing one original facilitator and managed service. The customer browser can render new documents and assemble existing PDFs against that commissioned origin; each batch still uses its actual original quote.

The same preparation creates the complete document application and private customer options, including the existing nested operator configuration and allowed source roots. In the existing Document merchant Applications entry, the operator selects this complete private commissioning setup, reviews its original account and source, then uses Start, Open, Stop and reopen on that same saved merchant. First Start prepares the reviewed installation; its native service and facilitator share the original lifetime. It also supplies the direct settings for the installed customer browser and the existing Case Desk PDF receiving flow. A saved customer HTML edition can therefore proceed through its actual merchant quote, native payment, complete PDF/source receipt and attachment to the original case item while retaining its source link. Closing the service drains the original Jobs owner before releasing the native facilitator's signer ownership. Subsequent service starts reuse that merchant state and customer history.

This commissioning arm connects the delivered document product to an existing merchant's operating setup within the same funded service-adaptation work. Completed customer operations retain the original parent-task, native-purchase, supplier-unit and PDF-page distinctions.

### Commissioning within the existing funded work

The workorder specifies the paying organization, allowed input formats, required document output, actual supplier account, native merchant resource and price, receiving application, delivery destination and support responsibility. Initial implementation configures that useful service and hands it to a second operator. A subsequent customer document or explicitly selected batch creates the next billable task under its advertised terms.

T1 maps the customer's input, supplier, merchant output and receiving application and completes operator handover. T2 carries the agreed original document through buyer intent, facilitator and ledger operations and resolves an interrupted paid delivery in that same customer task. T3 commissions the production service, returning customer work, retained editable source, complete receiving and independent maintenance. These adaptations use the original six funded packages, hours and customer-use windows.

### Customer acceptance and source units

Stellar's [x402 Exact payment flow](https://developers.stellar.org/docs/build/agentic-payments/x402/built-on-stellar) supplies native authorization and settlement for the selected token transfer. The application separately binds the customer's full source, approved native plan, original request and complete received result. That retained operation supports payment recovery and original result receiving in the customer's existing application.

Customer acceptance follows the whole requested business task. An invoice and greeting card can be two paid requests for one order, while a multipage report remains one document request. Supplier render credits, cache behaviour, PDF pages, native purchases and parent-task completion retain separate units. The [installed supplier contract](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/ae86e3bcaedd1ee65309cda455984f8102948905/products/document-merchant/contracts.mjs) preserves each provider's original inputs, settings and usage definitions. Prepaid allowance consumption retains the application's existing counting rules.

The funded outcome remains two independent merchants and two independent buyers. T2 requires at least 10 useful testnet purchases in total across both buyers during seven consecutive days ending by day 90. T3 requires at least 30 useful mainnet purchases in total during fourteen consecutive days ending by day 150, with both buyers returning on another UTC day for a distinct completed purchase. Both merchants receive independent use. Document commissioning, onboarding and ongoing operation fit the same USD 38,000, 400 prospective hours at USD 95 per hour, and 150-day schedule.

Provider documentation was checked on 12 October 2026: [MintPDF OpenAPI](https://mintpdf.dev/openapi.json), [snaplab documentation](https://snaplab.dev/docs) and [PDFMint documentation](https://pdf.mintapis.com/docs). These are distinct provider accounts and contracts; their actual account responses govern allowance and capacity when the merchant fulfils the customer's document request.
