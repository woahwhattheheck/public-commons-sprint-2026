# Receive the original ETIM supplier delivery through the material MCP

This program takes the complete published ETIM supplier example through the maintained material and supplier tools. It begins with the original supplier delivery operation, keeps its catalog, review and correction identities, adds the publisher's unit, classification and GTIN fields to the catalog mapping, and delivers the updated workspace to a second customer workspace. The typed client, command line client, retained downloads and merchant host all use the original catalog, supplier and request stores.

The same command is a continuation after an interruption. Its private operation directory retains the original request IDs, input hashes, export manifests, file checkpoints and customer revisions. Keep that directory together with the original supplier directory.

## Run the complete receiving operation

Use the current complete product source, Node 24 with the original SQLite support, Python and the original supplier program's XML validation dependencies. The source tree must include the maintained merchant operator, seller SDK and the four original ETIM source files. The ordinary supplier delivery program performs its original source and official schema validation before this continuation begins.

From the repository root:

~~~sh
node stellar-forge/mcp-merchant-operator/receiving/opensearch-materials-native.mjs \
  --supplier-directory /private/receiving/supplier-etim \
  --directory /private/receiving/materials-mcp \
  --supplier-operation supplier-etim-2769 \
  --operation opensearch-materials-2769
~~~

The two directories must be separate canonical paths owned by the current operator. Their permissions must exclude other users. The program creates its own new directories with mode 0700. It does not accept a symlink in place of either selected directory or overlapping directories.

| Option | Meaning |
| --- | --- |
| --supplier-directory | Original supplier operation directory. An existing completed operation is reopened and its retained artifacts are verified. |
| --directory | Private material MCP receiving directory containing the control state, host configuration, customer workspace and downloads. |
| --supplier-operation | Original supplier operation ID; defaults to supplier-etim-2769. Preserve it on continuation. |
| --operation | Material receiving operation ID; defaults to opensearch-materials-2769. Preserve it on continuation. |
| --inputs | Optional directory containing the original supplier example inputs. Passed unchanged to the original supplier delivery program. |
| --python | Optional selected Python executable for the original supplier program. |
| --help | Print the command and continuation requirements. |

The JavaScript entry point is exported for a maintained native receiving runner:

~~~js
import { runOpenSearchMaterialsReceiving } from
  './stellar-forge/mcp-merchant-operator/receiving/opensearch-materials-native.mjs';

const report = await runOpenSearchMaterialsReceiving({
  supplierDirectory: '/private/receiving/supplier-etim',
  directory: '/private/receiving/materials-mcp',
  supplierOperationId: 'supplier-etim-2769',
  operationId: 'opensearch-materials-2769',
  inputsDirectory: '/private/receiving/original-etim-inputs',
  python: '/usr/bin/python3'
});
~~~

The program calls the original runSupplierDeliveryJourney. If that operation has already completed, its own retained report and output verification are used. The following material workflow continues the same receiver and original product; it does not initialize a second supplier producer.

## Original product and source selection

The source is ETIM International's published ETIM BMEcat sample and its original XSD. The original source program converts the complete product into the maintained supplier input while retaining the full original XML fields. This receiving program compares complete supplier product objects throughout the workflow and compares final XML bytes with the original supplier delivery.

Original publisher archive:

<https://www.etim-international.com/wp-content/uploads/2021/09/ETIM-BMEcat-Guideline-V5-0-2-2024-12-12.zip>

| Original value | Use in the received catalog |
| --- | --- |
| Product 411061 | Stable material and supplier product identity. |
| GTIN 03414970351821 | Original cross-reference, including its leading zero. |
| English short and long descriptions | Customer search and the saved material description. |
| ETIM class EC000905 | A real category facet from the original product. |
| Manufacturer name | The original manufacturer facet. |
| Order unit and content unit C62 | Exact quantity conversion using the original order ratio. |
| Content units per order unit 1 | Numerator from the original field; denominator 1 represents one order unit. |
| All 30 ETIM features | Retained and compared as part of the complete supplier product. |
| Original price, packaging, assets and related fields | Preserved through correction history, review, XML and portable receiving. |

The original operation demonstrates a published standard example. Its customer match and correction notes identify that example. The program keeps its original source provenance and does not turn the example's prices into a commercial receipt.

The useful mapping change is explicit and reviewed. It adds the publisher's long description, ETIM class, base and sales units, exact unit ratio and GTIN. It preserves the complete supplier and originalSource attributes. The resulting edition reports one changed existing material. The selected edition then makes the prior customer approval require review; the workflow renews that same decision against the changed material's current SHA-256.

## One host, two original workspace aliases

The maintained initializer produces the private merchant configuration. The program starts the original MCP HTTP host on loopback with a fresh process-local bearer token and invokes the original provider transport through the typed client. The token is not written into the receiving report or connection file.

| Workspace alias | Selected state |
| --- | --- |
| etim-original | The receiver created by the original supplier operation. |
| etim-received | The new customer workspace inside this receiving operation directory. |

The host connection declares original input aliases before the provider can open their files:

| Input alias | Complete source |
| --- | --- |
| etim-original-source | The original wrapped ETIM source, with its byte count and SHA-256. |
| etim-original-delivery | The original supplier program's final portable customer workspace bundle. |
| etim-mcp-delivery | The complete material bundle received through the original retained export and download protocol. |

These aliases are the tool inputs. Host file paths remain in the private connection configuration. The current bundle alias is added only after its full original download is verified and the host is closed. The saved configuration transition records its previous and selected digests so that a lost return can adopt the same update.

The receiving operation retains the actual selected HTTP port. After an intentional interruption it restarts the same host address and workspace aliases so that the original retained-download identity continues to match. The host's original close operation drains accepted work, releases file reads and closes the underlying workspaces.

The configured source profile has the original local OpenSearch endpoint declaration. This material and supplier receiving operation uses the saved catalog and source stores; it creates ordinary merchant query drafts through the maintained workspace. Indexing and scoring remain separate native query operations.

## Complete operating flow

The control report records the following complete phases under their stable names.

| Phase | Result retained by the original operation |
| --- | --- |
| original_receiver | Reopen the original supplier receiver; compare its catalog, selected edition, plan, correction, review, product and source identities. |
| original_match_and_query | Save a customer approval for the published description and create an ordinary merchant query draft from the selected catalog. |
| original_unit_and_classification | Stream the exact declared source, save the enriched mapping, review and select its edition, inspect changed fields, page real facets and convert 5.25 C62 to the exact rational value 21/4. |
| reviewed_supplier_and_customer_selection | Move the original supplier plan to the reviewed edition, clear the redundant earlier correction against exact revision and product pins, retain all original fields, review the product and renew the customer's original match. |
| complete_original_exports | Produce all ten material and four supplier formats through the original retained export operations, inspect their manifests and explicitly open and release a manifest file read. |
| interrupted_original_download | Receive a verified non-final portion of the actual portable bundle, record the original durable checkpoint, then interrupt and close the host. |
| resumed_complete_original_files | Restart the original host, continue the same verified prefix, finish every file and repeat the complete download to verify its retained contents. |
| complete_customer_receiving | Import the complete downloaded bundle into the second original workspace through its host-declared input alias; retain the original catalog, supplier and decision identities. |
| retained_customer_work_and_older_delivery | Save newer customer work, replay the original receive request and receive the older original supplier delivery while preserving the newer mapping, correction and decision. |
| customer_files_and_original_cli | Deliver the customer's updated workspace and supplier files, run the actual command line downloader and read every correction-history page through the maintained CLI. |
| closed_handles_and_original_reopen | Close and reopen both original workspace handles, read the saved operations and history, verify retained manifests and download the original files again. |

The received supplier correction remains part of the original correction history. The workflow clears a redundant earlier patch after the complete original product is available in the catalog mapping, then applies the original published price on the receiving side with an explicit source note. The effective supplier product and XML remain byte-equivalent to the original delivery while the newer customer review and correction revision are retained.

Draft replay uses its original request ID and request body after the catalog advances. It must return the original draft operation and saved draft, rather than selecting the newer mapping under an earlier request. A separate current request creates the merchant draft from the enriched edition.

## Complete files, bounded calls

The material export requests all of these original formats:

- catalog.csv
- catalog.jsonl
- approved-matches.csv
- index.json
- bulk.ndjson
- delta.ndjson
- facets.json
- search-client.ts
- source.json
- catalog-bundle.jsonl

The supplier export requests:

- review.json
- issues.csv
- products.jsonl
- bmecat.xml

The final customer delivery includes its complete portable catalog bundle, customer decisions, supplier review and XML. The original supplier XML hash must match after both the typed download and the command line download.

The server retains each complete file separately and publishes a manifest only through the original export operation. A typed call returns the operation and file identities. File bytes move through bounded retained-file reads. The receiving program uses 16 KiB chunks and checks the server manifest, complete length and SHA-256 of each local file.

Lists, histories, material rows, changes, suggestions and facets use the original paged methods. The program deliberately requests small pages and follows each returned continuation. It also exercises the actual CLI with --all-pages, recording the returned JSONL. Large complete product and catalog files remain available through their retained exports.

The final report records the observed native tool names. Completion requires all 37 material and supplier tools to have been used by the original transport. Repeated invocations merge these observations into the same private operation state.

## The actual interruption and continuation

The interruption is placed inside the original downloader's onProgress callback after it has saved a verified, non-final prefix of catalog-bundle.jsonl. It is not simulated by editing download state or replacing an exported file. The program records the actual export ID, filename, byte offset and total, throws its own receiving interruption, and closes the maintained host.

The following phase starts the same original host and calls the same download operation, directory and expected manifest SHA-256. Completion requires the downloader to report a resumed verified prefix. The finished download is repeated and every retained output is opened and hashed again.

Request bodies are written into control state before a mutation is sent. Exact retries use the original request body and request ID. Completed native operations are matched by their original operation identity and request digest. The program retains the current business state after a historical retry so that later customer work remains visible.

| Interruption boundary | Same-operation continuation |
| --- | --- |
| Before a mutation returns | Reuse its saved exact request and read the original returned operation. |
| After an export is sealed | Reopen its retained manifest and original complete files. |
| During an export before sealing | The maintained export adapter can recover its private unsealed operation while the explicit original selection still matches. |
| After a verified download prefix | Resume the original endpoint, workspace alias, export ID, manifest and directory. |
| After complete download but before phase state is saved | The original downloader verifies and adopts the exact existing files. |
| After customer import but before its response is retained | Replay the original receive request against the same customer workspace. |
| After newer customer work | Historical receive and correction requests preserve the original newer revisions. |
| After a completed phase | Reuse its saved result, then reconcile every final manifest and local artifact before returning completion. |
| After a control-state storage failure | Stop further effects and keep the same operation directory for the next continuation. |

If the selected port is still occupied, first reconcile the original host process associated with the retained operation. Starting another receiving directory or choosing a different request identity does not continue an existing file checkpoint.

If an exported file has been removed or changed, the program refuses to return its previous successful metadata as a new completion. It opens the actual retained regular file, streams its current contents, checks the original length and SHA-256, and compares file identity before and after the read. The same checks run when all earlier phases were already complete.

## Files to retain

The operation directory contains these useful outputs and control records:

| Path beneath --directory | Purpose |
| --- | --- |
| materials-receiving-native.json | Complete receiving report, written with state CLOSED after host and workspace lifetimes close. |
| control/receiving-state.json | Same-operation phase results, original requests and operations, exact input identities and continuation state. |
| control/opensearch-connection.json | Private host workspace and declared input selections. |
| merchant-*/ | Maintained host initialization, merchant configuration, release store and retained server exports. |
| customer-workspace/ | Original catalog and supplier stores received and edited by the customer workflow. |
| downloads/original-materials/ | All ten complete original material files and their manifest. |
| downloads/original-supplier/ | All four complete original supplier files and their manifest. |
| downloads/customer-workspace/ | Complete updated customer workspace and approved matches. |
| downloads/customer-supplier/ | Supplier review and XML downloaded by the maintained command line client. |

Use the actual directory names in the report as the final authority for generated output locations. Retain the original supplier directory and its supplier-delivery-native.json alongside these results.

The receiving report records:

- Actual module Git blob identities and SHA-256 values for the selected material operator source.
- Original supplier report, source and bundle identities.
- Original and received workspace IDs, catalog revision, selected edition, material hash and exact quantity.
- Original and received supplier correction revisions, review identity and complete product digest.
- Customer decision identity and revision.
- Original mutation operation IDs, request hashes and completed phases.
- Observed tool calls and the actual interrupted download prefix.
- Complete export and local artifact receipts.
- Closed host and workspace lifetimes.

A source-ready program is not a completed native report. The program emits the CLOSED report only after the real original operations, complete receiving, final artifact reads and lifecycle cleanup have succeeded.

## Relationship to the maintained clients

The general configuration, all tool arguments, typed declarations and command line operations are documented in the parent material operator guide. This receiving program imports those maintained implementations directly:

- opensearch-material-client.mjs and its companion declaration file.
- opensearch-material-cli.mjs.
- Original merchant initialization and HTTP serving.
- Original retained-download implementation and native file read/release tools.
- Original material catalog, supplier review, portable transfer and request stores.

When the product is upgraded, use one complete current source cohort for these imports. Preserve the original receiving directories and operation IDs while adopting the selected source. A fresh report includes the actual source identities used for that continuation.
