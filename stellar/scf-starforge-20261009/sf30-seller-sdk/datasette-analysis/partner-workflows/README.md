# Partner workflow preparation and native receiving

This component prepares a complete source-specific working bundle for the existing Datasette / Analysis workflow. It supplies two editable transformations: Shopify Payments payout reconciliation, and company/contact import preparation for Odoo. The original source worker remains responsible for native source editions, saved queries, published reports, business-request continuation and independent receiving.

## Files and runtime

- preparation.mjs: pure transformations, exact decimal arithmetic, source identities, exception tables, Odoo import CSV and a clean HTML review.
- profiles.mjs: complete prepared tables and configuration for the original Analysis worker.
- prepare_cli.mjs: Node 20+ command for complete preparation, immutable publication and full receiving.
- SOURCE_CONTRACTS.md: input, field ownership, native API correspondence and business acceptance.

Run these files together from the installed product's datasette-analysis/partner-workflows directory. They use the maintained CSV parser in products/conapi/supplier-report/supplier-report.mjs. The complete installed product supplies workflow_cli.py, Analysis and the source archive; a received preparation also retains these five editable files.

## Prepare a selected original input

The JSON input includes kind, source, complete and the complete records for the selected operation. SOURCE_CONTRACTS.md defines the two exact input forms. Preserve the original service responses and their page/selection history in source.originals or another explicit input field; the entire original input travels unchanged.

The source object records the actual publisher, authenticated service URL without credentials, title, exact selected scope and original retrieval time. complete=true records that the selected original source has been fully acquired; the preparer does not fetch more pages. The commissioned source adapter owns real pagination, native error handling and re-acquisition. Keep the installed customer's authorization and secret references in its existing execution environment.

Prepare directly:

    node prepare_cli.mjs prepare --input /private/customer/original-input.json --out /private/customer/prepared-20261013

This writes the exact original input, every prepared table, complete metadata, editable source, review HTML and manifest. A repeat with the identical input and resulting files returns the original complete delivery. A changed source or mapping gets a new output directory and retains its predecessor.

To also generate the original worker profile, create an installation JSON file with these actual selections:

    {
      "analysisWorkspace": "/private/customer/analysis",
      "operationId": "THE_EXISTING_32_HEXADECIMAL_ANALYSIS_OPERATION",
      "parser": "/opt/merchant/products/conapi/supplier-report/supplier-report.mjs",
      "sourceArchive": "/private/customer/Complete_Datasette_Product.zip"
    }

The operation ID comes from the customer's actual existing native Analysis operation. Replace the displayed example paths and ID with that installation's selections. The preparer validates absolute paths and the ID format; workflow configure verifies the selected files and hashes.

    node prepare_cli.mjs prepare --input /private/customer/original-input.json --installation /private/customer/installation.json --out /private/customer/prepared-20261013

The output includes profile-template.json. original-metadata.json embeds the complete original input bytes, source identity, all five editable transformation files and full table descriptors. The original CSV import retains that complete metadata in its native source edition and subsequent archive.

## Bind and run through the original workflow

First inspect Review.html and the exact exception records. Configuration is a source binding step; it does not mark financial or import exceptions accepted.

    python3 -I ../workflow_cli.py configure --template /private/customer/prepared-20261013/profile-template.json --output /private/customer/workflow-profile.json

configure retains actual CSV, parser, publisher metadata and source archive lengths and SHA-256 values. Every source table is already selected in the template, including empty exception tables. These local CSV inputs explicitly retain operator-file provenance. A complete header-only CSV imports its zero-row table with the original column schema; key=[] records that no business key has been approved. The main table is transactions for retail, or mapping for contacts; additional native source aliases retain all companion tables. The reusable Analysis source reference names the original HTTPS endpoint without its query, while the full selected URL and filters remain in the original input, handover, retained source-meaning document and report. For an operator-selected HTTP source, the native operator-file descriptor omits the optional public reference and retains that same complete original URL. Public-source descriptors continue to require the original HTTPS endpoint. Corrected source descriptors are content-addressed so a failed earlier descriptor remains available during the same edition's resume.

Save one actual business request:

    {
      "schema": "stellar-forge.source-workflow-request.v1",
      "requestId": "ORIGINAL_BUSINESS_REQUEST_ID",
      "correlationId": "ORIGINAL_BUSINESS_REQUEST_ID",
      "profile": "retail-payout-reconciliation",
      "parameters": {"payoutId": "ORIGINAL_SELECTED_PAYOUT_ID"}
    }

The contacts profile is odoo-contact-import-preparation and its parameters contain sourceId instead. The selected ID drives a useful focused query; the complete source and all other report tables remain in the same result.

    python3 -I ../workflow_cli.py accept --workspace /private/customer/workflow --request /private/customer/business-request.json --execution-id ORIGINAL_ORCHESTRATOR_EXECUTION_ID
    python3 -I ../workflow_cli.py run --workspace /private/customer/workflow --request-id ORIGINAL_BUSINESS_REQUEST_ID --configuration /private/customer/workflow-profile.json
    python3 -I ../workflow_cli.py status --workspace /private/customer/workflow --request-id ORIGINAL_BUSINESS_REQUEST_ID --history

A process interruption continues the same original request and native operation IDs. A changed input or mapping is a successor request with the original parentRequestId retained. The native result identifies actual source editions, query versions, report publication and each complete output.

The native Analysis reports preserve all four retail tables or five contacts tables, plus one selected-record query. Their preview cap is 100,000 rows; the original export manifest reports actual complete export rows and status. Operators read actual Analysis status and truncation fields before accepting the operation.

## Orchestrator handoff

The partner's existing Python/n8n/MCP worker can call the original CLI with an argument array and shell=false. Keep the actual execution ID in accept and the original request ID across retries. Do not interpolate source contents into a shell command.

A co-located service can use the original loopback gateway, with the current X-Workflow-Capability from its private operator launch:

1. POST /api/requests with {request: originalRequest, executionId: actualExecutionId}.
2. POST /api/requests/{encoded-request-id}/run.
3. GET /api/requests/{encoded-request-id}?history=true for the retained state.
4. GET /api/requests/{encoded-request-id}/envelope for the exact completed native result.
5. GET /api/requests/{encoded-request-id}/files/{encoded-name} for the selected full file.

The existing gateway applies its own public authentication and client routing. Preserve ordinary installation secret references. Native callback and Kestra/JMS receiving already live in the parent workflow; select those existing routes when the actual customer uses them. Their actual producer and receiver receipts remain separate from report completion.

## Review and acceptance: retail

- Retain the complete selected balance transactions, payouts and order index with the source window and real pagination.
- Review the explicit transactionRoles mapping. Only contribution and transfer are classified. An unconfigured transaction type remains visible and prevents a matched source-total status.
- Money arrives as decimal strings with explicit currency scales. Exact integer arithmetic keeps currencies separate and retains original gross, fee and net values.
- A payout summary compares contribution net to the original payout amount. Transfer rows are separate, preventing a payout movement from being counted as a sale. transaction_count retains the original selected row count; parsed_net_count shows how many net amounts could actually be read. A malformed linked transaction prevents the payout from receiving a clean match.
- Duplicate transaction/payout/order IDs, missing selected references, test activity, amount inconsistencies, unknown types, non-PAID statuses and withdrawal/direction cases remain explicit review items.
- MATCHED_SOURCE_TOTAL means the selected original net arithmetic matched with none of those exceptions. The operator reconciles the actual bank receipt through the customer's normal finance process.
- Resolve an issue in a retained successor source/mapping and re-run. Never silently drop a duplicate or force a difference to zero.

## Review and acceptance: Odoo

The input has complete original companies and people, the selected target baseline and explicit fields owned by this import. Every source record retains its original ID and mapped target External ID.

Generated IDs combine a stable migration namespace, record kind and SHA-256 of the original source ID. Once used, retain that same namespace and ID mapping for later imports. Explicit targetExternalId values resolve only against the selected target export. Names and email addresses are never implicit identity matches.

The selected target baseline must be complete for the namespace and records being imported. Otherwise every mapping remains review-only. Missing/duplicate original IDs, colliding target IDs, wrong target kind, missing parent companies and ambiguous parents stay in the exception report and are excluded from import files. Their dependent people are excluded too.

fields declares the target columns this operation owns. name is required. email and phone are optional. For an existing target, a source field omitted entirely preserves its baseline value. An explicit empty string that would clear a nonempty target value requires that field in the source record's clearFields list. An omitted companySourceId on an existing target likewise preserves its actual exported parentExternalId. An explicit blank relation requires parent in clearFields before it can detach an existing company; missing baseline relations remain review items. This implements Odoo's actual distinction between omitted columns and empty field values.

Import companies.csv first and people.csv second through the selected Odoo database's original Contacts importer. The files use the documented External ID, Name, Is a Company and Related Company/External ID headers, plus explicitly owned contact fields. Use Odoo's Test operation, inspect the actual resulting records, and retain its report. The same External IDs make a later import address the same records. Confirm that behavior and one real correction in the customer's selected staging database before its production cutover.

After the actual staging import, retain its complete selected target export and native result in targetAfter. The same preparation compares every planned External ID, owned field and parent relation, flags missing or unexpected records against the original target baseline, and adds reconciliation.csv. Use the same targetScope across the original and resulting export. Correct a real discrepancy, re-import through Odoo with the retained IDs, and receive the subsequent original target export. Native receiving includes the complete mapping, source, import files and actual target comparisons. The commissioning operator binds the actual Odoo version, installed modules, field labels and original database permissions. The source preparation never writes an Odoo database.

## Complete delivery and independent receiving

Preparation bundles can be received before native execution:

    node prepare_cli.mjs receive --input /private/customer/prepared-20261013 --out /private/customer/received-preparation

Receiving requires all five editable source files, every declared table, Review.html, metadata and both original/prepared JSON files in the manifest. It checks descriptor types, complete table content, source closure and the bound original/kind/preparation identities. This copy retains the original installation template. Bind its paths through the original configure command when the receiving installation selects a new location.

After an actual native workflow, export the complete editable project:

    python3 -I ../workflow_cli.py export --workspace /private/customer/workflow --request-id ORIGINAL_BUSINESS_REQUEST_ID --destination /private/customer/Source_Workflow_Project.zip
    python3 -I ../workflow_cli.py receive --workspace /private/customer/received-workflow --archive /private/customer/Source_Workflow_Project.zip --sha256 ACTUAL_ARCHIVE_SHA256 --analysis-workspace /private/customer/received-analysis

The original receiver restores full source, original metadata, table versions, saved queries, report, request history and output files. For a clean empty exception table or pre-import reconciliation table, inspect the actual zero-row source edition, retained columns, query exportRows=0, header-only CSV, empty JSONL and zero-row SQLite schema. Receiving and reopening must preserve that same source version and column order. A nonempty source with key=[] retains explicitly_reviewed.fields=[] and business_key_eligible=false. Open that project with the maintained operator, inspect the original source and report, make one agreed mapping or source correction, run the successor and export the updated complete project. That full working journey is the commissioned acceptance.

## Source references

- Maintained source worker: ../workflow_analysis.py, ../workflow_cli.py and ../WORKFLOW.md.
- Shopify current balance transaction object: https://shopify.dev/docs/api/admin-graphql/latest/objects/ShopifyPaymentsBalanceTransaction
- Shopify payout object: https://shopify.dev/docs/api/admin-graphql/latest/objects/ShopifyPaymentsPayout
- Shopify transaction types: https://shopify.dev/docs/api/admin-graphql/latest/enums/ShopifyPaymentsTransactionType
- Original Odoo 19 import documentation: https://github.com/odoo/documentation/blob/19.0/content/applications/essentials/export_import_data.rst

The installed customer records the selected product/API version and source contract during commissioning. The editable profiles preserve those selections in the complete original delivery.
