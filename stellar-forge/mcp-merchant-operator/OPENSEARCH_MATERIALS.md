# Material catalogues and supplier deliveries through MCP

The OpenSearch merchant operator exposes the original material catalogue and supplier submission workspace to agents, scripts and the operator CLI. It retains input files, exact material identifiers and units, mapping revisions, edition changes, customer decisions, supplier corrections and delivered files in the same workspace used by the browser and source CLI.

Use this interface to complete a supplier intake, review and correct its recipient submission, deliver the original BMEcat or native ETIM xChange files and source bundle, and reopen that delivery at the receiving operator. The retained request journal also supports interrupted calls and later receiving of the same result.

## Configure the existing host

Follow [the existing OpenSearch host configuration](OPENSEARCH_WORKSPACE.md#host-configuration) and keep its original workspace directory, source declaration, optional plan, credentials and runtime settings. Add host-owned `materialInputs` selections inside the corresponding alias:

~~~json
{"schema":"stellar-forge.opensearch-workspace-connection.v1","workspaces":{"catalog":{
  "label":"Supplier catalogue",
  "directory":"./workspaces/product-search",
  "sourceFile":"./sources/opensearch-source.json",
  "planFile":"./sources/opensearch-merchant-plan.json",
  "materialInputs":{
    "etim-products":{
      "path":"./inputs/etim-products.jsonl",
      "name":"etim-products.jsonl",
      "bytes":5123,
      "sha256":"e8903a41da5ddbaef6bbaa9b6a585aef051488400c02ff5538d364bba0f72903"
    }
  }
}}}
~~~

The example selection identifies the complete published product JSONL retained under `sf30-seller-sdk/opensearch/examples/supplier-etim/`. Select the actual local copy in the host connection file. A delivery receiver similarly declares its complete downloaded `catalog-bundle.jsonl` as an input, using its actual byte count and SHA-256. The name passed to a tool is the configured input alias.

Each input declares `path`, a flat `name`, positive `bytes` and lowercase `sha256`; up to 128 inputs are supported per workspace. Paths resolve relative to the private connection file. Input contents open lazily during the original upload or bundle receive. The original importer checks the complete bytes and hash. Configuration and `material_inputs` expose the selected name, byte count and hash without returning host paths. Completed original requests remain replayable after an input copy is retired.

Run the maintained merchant MCP host with its existing bearer-token environment. `merchant_opensearch_status` and `merchant_opensearch_open` select a configured alias. Configuration does not contact OpenSearch. Material mapping, supplier review and file exports operate the retained catalogue; native query capture, ranking evaluation and merchant serving continue through the existing OpenSearch query and deployment tools.

## Complete operating workflow

1. Read `material_inputs`, then `material_upload` the selected original file with a retained `requestId`, `inputId`, complete source format and provenance. Retain the returned source ID. Supported original formats are CSV, TSV, JSONL, JSON and native ETIM xChange JSON. JSON may select its original `rowsPath`; xChange uses `format:{"kind":"xchange-json"}` and retains its complete nested message.
2. Save the complete catalogue mapping with `material_save`: `title`, `tenantId`, `mapping` and a retained request ID. A new catalogue omits both `catalogId` and `expectedRevision`; an update supplies both. Mapping expressions, joins and lookups use the existing catalogue schema. Material identifiers remain text, and unit ratios remain exact decimal/rational data.
3. `material_preview` binds the source to the current catalogue revision. Full and delta modes retain the original edition and changes. Read `material_edition`, every `material_rows` and `material_changes` page, and any individual `material_get` record needed for a decision. `material_select` supplies the exact catalogue revision, edition ID and its `reviewSha256`.
4. For customer matching, use `material_suggest` with the actual description and customer. Inspect the complete returned material, then save `material_decision` with its `expectedMaterialSha256`, current catalogue revision and `APPROVED` or `REJECTED`. Updates also identify the existing decision and revision. The raw decision history retains what was decided; current suggestions expose whether that decision still matches the selected material. `material_quantity` takes an exact decimal string, the original unit and current material hash.
5. Read `supplier_templates` with the intended native `target` when applicable and the complete original product schema, then `supplier_save` a submission with the selected catalogue/edition, complete recipient `profile` and `bindings`. A new plan omits both `planId` and `expectedRevision`; an update supplies both. Read the exact plan and `supplier_product` projection before correcting it.
6. `supplier_correction` includes the plan revision, material hash, base-product hash, current correction revision and the complete reasoned patch list. A new correction uses `expectedRevision:0`. An empty patch list clears that existing correction while keeping its history. Save changed source mappings as new catalogue revisions and review their actual edition; obsolete correction bases must be reconciled against the updated product.
7. `supplier_review` freezes the submission at its selected plan revision. Read the full review and all `supplier_rows` pages, including global findings and individual `supplier_row` records. `supplier_export` selects the review's original SHA-256 and required delivery formats. For native xChange, read every `supplier_recipient_rows` page as well. The original recipient/product validators determine whether the selected native delivery is ready to export.
8. `material_export` retains the complete selected material formats and `catalog-bundle.jsonl`. The bundle carries the original source bytes, catalogue history, mappings, editions, customer decisions and supplier records. Download the complete export into a private receiving directory, declare the bundle as a host input, and call `material_receive` on the receiving alias.
9. Reopen the receiver's catalogues, supplier plan/review/corrections and customer decisions. Continue using the same original IDs and request IDs. Receiving an earlier complete bundle follows the maintained catalogue import rules and preserves newer receiving work.
10. Use `material_draft` to turn the selected catalogue into an original OpenSearch query draft. Its variants are `baseline` and `identifiers`. Continue actual query capture, evaluation and paid merchant preparation through the existing tools in [OPENSEARCH_WORKSPACE.md](OPENSEARCH_WORKSPACE.md). Close the original workspace handle when the caller has finished its work.

### Original request outcomes

Mutations return the existing operation with `id`, `kind`, `state`, timestamps and `requestSha256`. Read `state` before consuming a result. `COMPLETE` identifies committed work; `FAILED`, `INTERRUPTED` and `RUNNING` retain their original outcomes. After a connection interruption inspect `merchant_opensearch_operation` with the same request ID and continue the same complete input. A changed request under an existing ID is rejected by the original journal.

Saved catalogue, customer-decision, supplier-plan and correction reads accept an explicit historical revision. The current head still supplies the expected revision for a new edit. Draft replay consults the saved original request before a later catalogue revision, so receiving the same draft request does not create another draft.

A committed operation whose full result exceeds the one MiB tool budget retains `result.fullResultRetained:true`, `result.resultSummary` and a complete-result hint. Its full original journal and complete file exports retain the records. Do not treat the explicit summary as a full mapping, product or source record.

## Complete exports and resumable receiving

Material formats: `catalog.csv`, `catalog.jsonl`, `approved-matches.csv`, `index.json`, `bulk.ndjson`, `delta.ndjson`, `facets.json`, `search-client.ts`, `source.json`, `catalog-bundle.jsonl`.

Supplier formats: `review.json`, `issues.csv`, `products.jsonl`, `bmecat.xml`, `xchange.json`, `recipient.jsonl`, `impact.csv`. BMEcat belongs to the original BMEcat profile; the three native xChange formats belong to a native xChange review.

Supply a nonempty selection without repeated formats. The request order is preserved. Match a format to the same index in `manifest.selection.formats` and `manifest.files`: the original descriptor controls the filename, such as `ETIM_XCHANGE_<review>_FULL.json` or `material-catalog-<id>-r<revision>.jsonl`. Each completed export has an original `exportId`, `manifestSha256`, manifest-file identity and manifest with the exact selection and every delivered filename, media type, byte count and SHA-256. Format-order prefixes keep filenames distinct. The manifest identifies the original workspace, request hash and immutable review/edition pins.

Export generation reads a single transaction on the original catalogue database. Before constructing file bodies, it pins the complete selected records, including customer decisions and supplier/history records used by bundle exports, on the original operation. New manifests carry this `sourceSnapshotSha256`. An unsealed retry uses the same request and requires the same complete source pin; sealed files remain adoptable after later edits. It streams full source/export bodies into private files and seals their complete manifest before publication. If publication is interrupted, replay the original export request to finish those same staged files. Downloading uses the maintained retained-file reader owned by the original workspace host.

`material_export_manifest` returns the original `manifest.json` identity (`name`, `bytes`, `sha256`). `material_export_file` requires `exportId`, `file`, `expectedManifestSha256`, `expectedSha256`, `offset` and `limit`; it returns a base64 chunk, original file identity, `readId` and `nextOffset`. Continue until `nextOffset:null`. A file read lease can be released explicitly with `material_export_file_release`.

The typed client and CLI perform this receiving protocol for every file. They lock the private output directory, verify retained partial prefixes, resume the original offsets, verify the full file hashes and retain completion. Keep the same directory, endpoint, alias and manifest. An expired read lease can be reopened at the original file hash and offset; it does not change the selected export. Output files have private permissions. Each complete file is limited to 8 GiB, the manifest to 64 KiB and each retained chunk to 196,608 bytes.

## Typed client

Source import: `stellar-forge/mcp-merchant-operator/opensearch-material-client.mjs`. The installed distribution exposes `./clients/opensearch-material`, with the adjacent `.d.mts` declarations, and `./clients/opensearch-material/contracts`.

~~~js
import { readFile } from 'node:fs/promises';
import { createOpenSearchMaterialClient } from './opensearch-material-client.mjs';

const client = await createOpenSearchMaterialClient({
  url: process.env.STARFORGE_MCP_URL,
  workspace: 'catalog',
  tokenEnv: 'MCP_ACCESS_TOKEN',
  callOptions: { timeoutMs: 120000 }
});

await client.open();
try {
  const configured = await client.materialInputs();
  for await (const page of client.pages('materialList', { collection: 'catalogs', limit: 50 })) {
    for (const summary of page.items) {
      const catalog = await client.materialCatalog({ catalogId: summary.id });
      // Use the complete current catalogue before preparing an edit.
    }
  }

  // Persist this complete request with your business operation before calling it.
  const exportRequest = JSON.parse(await readFile('material-export-request.json', 'utf8'));
  const operation = await client.materialExport(exportRequest);
  if (operation.state !== 'COMPLETE') throw new Error(JSON.stringify(operation));
  if (operation.result.fullResultRetained === true) throw new Error(operation.result.fullResultHint);
  const result = await client.downloadExport({
    exportId: operation.result.exportId,
    expectedManifestSha256: operation.result.manifestSha256,
    directory: './private-catalogue-delivery',
    onProgress: progress => process.stderr.write(JSON.stringify(progress) + '\n')
  });
} finally {
  await client.close();
}
~~~

A material export request supplies its original `requestId`, `catalogId`, `expectedCatalogRevision` and selected `formats`; optional `editionId` and `index` bind the intended edition and index. Every tool method takes the original fields except `workspace`, which the client binds once. It validates complete JSON before transmission and preserves exact decimal strings. `callOptions` applies to ordinary calls, export inspection and download chunks; an individual method may override it.

`createOpenSearchMaterialClient({workspace,client})` reuses an existing maintained native client with `endpoint` and `call`. `new OpenSearchMaterialClient(client,workspace,callOptions)` uses the same interface. Constructing a client initializes transport; opening and closing the original workspace remain explicit.

`pages(method,args)` supports material/supplier lists and histories, material rows/changes/facets/suggestions and supplier product/recipient rows. It yields every full page, follows the original continuation, and rejects repeated or nonadvancing positions. `inspectExport(exportId)` reads and verifies the selected original manifest. `downloadExport` receives the complete export into the given directory.

## Operator CLI

Run the source CLI with Node, or use the distribution's `opensearch-materials-client` command. The host endpoint is `--url` or `STARFORGE_MCP_URL`; `MCP_ACCESS_TOKEN` is the default existing bearer-token environment variable.

~~~sh
node stellar-forge/mcp-merchant-operator/opensearch-material-cli.mjs tools
node stellar-forge/mcp-merchant-operator/opensearch-material-cli.mjs open --workspace catalog
node stellar-forge/mcp-merchant-operator/opensearch-material-cli.mjs material-list --workspace catalog --input catalog-list.json --all-pages
node stellar-forge/mcp-merchant-operator/opensearch-material-cli.mjs supplier-review --workspace catalog --input original-review-request.json
node stellar-forge/mcp-merchant-operator/opensearch-material-cli.mjs inspect-export --workspace catalog --export-id ORIGINAL_EXPORT_ID
node stellar-forge/mcp-merchant-operator/opensearch-material-cli.mjs download-export --workspace catalog --export-id ORIGINAL_EXPORT_ID --directory ./private-catalogue-delivery
node stellar-forge/mcp-merchant-operator/opensearch-material-cli.mjs close --workspace catalog
~~~

Each tool suffix is a CLI command with underscores changed to hyphens; `call --tool merchant_opensearch_NAME` selects the exact name. Requests omit `workspace` and come from `--input FILE` or `--input -` for stdin, up to two MiB. `tools` emits complete tool schemas without connecting. Single results are JSON; `--all-pages` emits one complete page per JSON line. Download progress goes to stderr. `--expected-manifest-sha256` pins a previously reviewed manifest; `--chunk-size` selects the original chunk limit and `--timeout-ms` controls individual tool calls without automatically retrying a mutation.

## Pages, full records and ownership

Lists return `items`, `total` and `nextCursor`; histories return `items`, `total` and `nextRevision`; record pages return `rows`, `total` and `nextOffset`. Facets use `items`, and suggestions use `candidates`. Continue to a null continuation, including a byte-limited page with fewer records than the requested limit. Page size is 1–100. Every returned row is complete for its declared view.

List/history views summarize large definitions: catalogue mappings, source samples/column lists, supplier profiles/bindings, correction patches and embedded review definitions belong to their direct records or complete exports. Lists page the current mutable heads; histories page retained revisions. Immutable edition and review pages retain those exact IDs. A single complete record exceeding the one MiB tool budget produces an explicit file-export direction.

The provider shares the original pending-call drain, workspace lifetime and retained-reader owner. Closing waits for accepted material/supplier calls and releases its snapshots and native file descriptors before closing the workspace. A failed close retains its owned resources for the same close continuation.

## Tool reference

All tools below require a configured `workspace`. The SDK offers matching camelCase methods and the CLI offers matching hyphenated commands.

| Tool suffix | Original required request fields after workspace |
| --- | --- |
| `material_inputs` | None |
| `material_list` | `collection` |
| `material_catalog` | `catalogId` |
| `material_history` | `kind`, `id` |
| `material_decision_get` | `decisionId` |
| `material_source` | `sourceId` |
| `material_edition` | `editionId` |
| `material_rows` | `editionId` |
| `material_changes` | `editionId` |
| `material_get` | `editionId`, `materialKey` |
| `material_facets` | `catalogId`, `facet` |
| `material_suggest` | `catalogId`, `text` |
| `material_quantity` | `catalogId`, `materialKey`, `expectedMaterialSha256`, `quantity`, `unit` |
| `material_save` | `requestId`, `title`, `tenantId`, `mapping` |
| `material_upload` | `requestId`, `inputId`, `format` |
| `material_preview` | `requestId`, `catalogId`, `expectedRevision`, `sourceId` |
| `material_select` | `requestId`, `catalogId`, `expectedRevision`, `editionId`, `reviewSha256` |
| `material_decision` | `requestId`, `catalogId`, `expectedCatalogRevision`, `customerId`, `description`, `materialKey`, `expectedMaterialSha256`, `status` |
| `material_draft` | `requestId`, `catalogId`, `expectedRevision`, `index` |
| `material_receive` | `requestId`, `inputId` |
| `material_export` | `requestId`, `catalogId`, `expectedCatalogRevision`, `formats` |
| `supplier_templates` | Optional `target`: `xchange-2.0` or `2ba-xchange-2.0`; omission selects the original BMEcat template |
| `supplier_list` | `collection` |
| `supplier_plan` | `planId` |
| `supplier_history` | `kind`, `id` |
| `supplier_product` | `planId`, `materialKey` |
| `supplier_correction_get` | `correctionId` |
| `supplier_review_get` | `reviewId` |
| `supplier_rows` | `reviewId` |
| `supplier_recipient_rows` | `reviewId`; optional `kind`, `change`, `search`, `offset`, `limit` |
| `supplier_row` | `reviewId`, `materialKey` |
| `supplier_save` | `requestId`, `catalogId`, `editionId`, `title`, `profile`, `bindings` |
| `supplier_correction` | `requestId`, `planId`, `expectedPlanRevision`, `materialKey`, `expectedMaterialSha256`, `expectedBaseProductSha256`, `expectedRevision`, `patches` |
| `supplier_review` | `requestId`, `planId`, `expectedRevision` |
| `supplier_export` | `requestId`, `reviewId`, `expectedReviewSha256`, `formats` |
| `material_export_manifest` | `exportId` |
| `material_export_file` | `exportId`, `file`, `expectedManifestSha256`, `expectedSha256`, `offset`, `limit` |
| `material_export_file_release` | `exportId`, `readId` |

## Native ETIM xChange recipient workflow

Select the native template before material mapping:

~~~js
const template = await client.supplierTemplates({ target: 'xchange-2.0' });
// template.catalogMapping retains the complete source context.
const rows = client.pages('supplierRecipientRows', {
  reviewId: selectedReview.id,
  kind: 'all',
  change: 'all',
  search: '',
  limit: 50
});
for await (const page of rows) {
  // page.reviewSha256 and page.recipient identify this immutable target state.
  for (const row of page.rows) {
    // Inspect the complete original supplier/product/trade identity and before/after values.
  }
}
~~~

A recipient page returns the original review ID/hash, complete recipient summary, total and continuation. Its kinds are all/product/tradeItem; actions are all/added/changed/unchanged/expired/deleted. Search uses original identifier, supplier key or supplier name.

A native profile retains whole catalogue-header and supplier-header overrides with reasons. Product patches address original `/xChange/product/...` paths. Actual numeric JSON fields retain string lexemes with their JSON Pointer map in `/xChange/numberTokens`; decimal strings already defined as strings in the ETIM schema stay ordinary strings. The typed definitions distinguish the profile, header overrides, exact token map and full recipient records.

CHANGE selects a previous review in the same catalog, tenant and target, with the exact original reference version. Supplied product and trade-item bodies are complete records; unlisted CHANGE records remain in the recipient state. FULL marks missing products expired and removes absent trade items. The native message, complete recipient JSONL and impact CSV describe those distinct outputs. The original source-bound 2BA status mapping and modelling-class selections travel with its explicit profile.

Read the [full operator and source-rule guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/catalog/supplier/xchange/GUIDE.md) for original fields and the current recipient requirements. The full bundle carries the source bytes and every prior review; import rederives complete recipient state and findings before adopting it.

## Full native receiving

The [native receiving guide](receiving/OPENSEARCH_MATERIALS_NATIVE.md) runs the complete published ETIM source through its original supplier delivery, this merchant MCP, the typed client and CLI, full exports, interrupted download, bundle receiving and closed/reopened records. It uses the original public supplier source and original request IDs across continuation. Read the guide for the original directory, operation and final receipt.

The [xChange receiving operation](../../stellar/scf-starforge-20261009/sf30-seller-sdk/opensearch/receiving/XCHANGE_NATIVE.md) adds the complete original xChange publisher example, precise numeric corrections, cross-plan FULL/CHANGE, recipient pages and the same host-restart/full-bundle receiving lifecycle.
