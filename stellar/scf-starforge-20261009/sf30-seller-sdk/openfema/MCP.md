# OpenFEMA merchant tools and complete-file receiving

This attachment operates the same Public Assistance workspace as the browser and native CLI. Its host-selected alias binds the original workspace UUID; the source, portfolio, review, dataset, release and buyer engines remain the original ones. The application does not infer a second source capture or a new payment from a client reconnect.

## Connect the existing workspace

Open **Public Assistance portfolios** in Applications, or start the native `openfema-workspace` command. Keep the printed session URL private. The installed Applications launcher retains that same URL and original startup identity in its normal `application-url.json` record.

Write an owned private UTF-8 JSON connection file. Replace the capitalized values below with the actual original values:

~~~json
{
  "schema": "stellar-forge.openfema-workspace-connection.v1",
  "workspaces": {
    "public-assistance": {
      "label": "Selected Public Assistance portfolio",
      "workspaceId": "ACTUAL_ORIGINAL_WORKSPACE_UUID",
      "applicationUrlFile": "/absolute/private/original-application-url.json"
    }
  }
}
~~~

The host can instead choose exactly one of `consoleUrlFile` (a private text file containing the original console URL) or `consoleUrlEnv` (the name of its existing environment variable). The adapter rereads this reference on each new request and checks the original UUID at the actual console. A changed listener port or refreshed session therefore preserves the workspace, while a different workspace cannot silently inherit the alias.

The host may declare up to 32 workspaces. Each may also declare up to 32 complete original source bundles:

~~~json
{
  "sourcePackages": {
    "retained-cohort": {
      "path": "/absolute/private/original-source-bundle.json",
      "sha256": "ACTUAL_COMPLETE_FILE_SHA256",
      "label": "Selected retained source edition"
    }
  }
}
~~~

Merge that object into the selected workspace entry. Paths and session credentials stay in host configuration. Model/tool arguments choose the existing alias. The native capture engine validates every response, source URL, scope, dataset version, byte digest and original page sequence when that bundle is imported.

The source-owned provider is registered as `openfema-workspaces`, with configuration input `openFemaWorkspaceConnection`. A new original merchant host can be initialized through:

~~~javascript
import { initializeOpenFemaWorkspaceMerchant }
  from '@tokenjunkielabs/starforge-merchant/merchant-mcp/openfema/setup';

const result = await initializeOpenFemaWorkspaceMerchant({
  directory: '/absolute/private/new-merchant-directory',
  connection: '/absolute/private/openfema-connection.json',
  name: 'Public Assistance operator'
});
~~~

This function creates the maintained merchant configuration, native release store and private export directory. It does not open another Public Assistance workspace, start a capture or execute a payment. An already configured merchant host uses the same source-owned configuration input through its existing setup workflow.

## Typed client and command line

~~~sh
starforge openfema-mcp tools --url ACTUAL_MCP_URL \
  --workspace public-assistance --token-env MCP_ACCESS_TOKEN

starforge openfema-mcp call --url ACTUAL_MCP_URL \
  --workspace public-assistance --token-env MCP_ACCESS_TOKEN \
  --request-file /absolute/private/read-request.json

starforge openfema-mcp action --url ACTUAL_MCP_URL \
  --workspace public-assistance --token-env MCP_ACCESS_TOKEN \
  --request-file /absolute/private/action-request.json
~~~

The source command is the same `mcp-client.mjs` file and may also be run with Node. A read request is `{tool,args}`; an action request is `{action,payload,operationId,expectedRevision}`. The client already binds the workspace alias, so do not repeat `workspace` inside args or payload. A private request file is at most 128 KiB. The merchant token is read from its existing environment variable, never from an action body or a source bundle.

~~~javascript
import { openOpenFemaClient }
  from '@tokenjunkielabs/starforge-merchant/merchant-mcp/openfema/client';

const client = await openOpenFemaClient({
  url: process.env.MCP_URL,
  workspace: 'public-assistance',
  tokenEnv: 'MCP_ACCESS_TOKEN'
});
const view = await client.call('view', {});
if (!view.ok) throw new Error('Read the original native error before proceeding.');
const page = await client.call('rows', {
  versionId: selectedOriginalVersionId,
  table: 'projects',
  sort: 'federalObligated',
  direction: 'desc',
  offset: 0,
  limit: 100
});
~~~

The adjacent TypeScript declaration supplies exact action payloads, table names, file selectors, archive pages and discriminated native replies. Runtime tool schemas validate the same fields. Dollar values stay decimal strings. There is no conversion of original financial amounts to binary floating point.

### The complete native tool surface

Names below have the prefix `merchant_openfema_`. The catalog contains 12 read/file tools and all 29 original native actions (41 tools in total).

| Tool or action group | What it operates |
| --- | --- |
| workspaces, schema, view | Host aliases, original UUID, source contract, revision and native capabilities. |
| operation | One retained operation without redispatch. Runtime context is not included in the tool result. |
| archive | Revision-bound pages of editions, portfolios, versions, reviews, acceptances, comparisons, datasets, releases, receipts, exports or captures. |
| edition, version | Complete immutable source manifest, or the original portfolio-version identity and summary. |
| rows, detail | Search/sort/page any of the six native tables and inspect the exact original record and review. |
| files, file_read, file_release | Original file metadata, held-file byte reads and release of temporary read handles. |
| source_capture/resume/pause/import | The existing complete cohort acquisition or original saved bundle. |
| portfolio_create/revise/select/compare | Versioned portfolio criteria, current-version edits and complete retained comparisons. |
| review_save/accept | Original analyst decisions and the exact accepted portfolio version. |
| dataset_prepare/query | Original SF30 table dataset, full source provenance and native query engine. |
| release_prepare/inspect/activate/start/stop/rollback | Existing SF82 release, generation and runtime operations. |
| buyer_inspect/receive | Existing completed SF88/SF100 buyer intents and native customer files. |
| export_create, source_export | Frozen table/portfolio/report and the whole original source bundle. |
| delivery_mapping_save/review | Complete host-declared destination mapping and named review of its exact SHA. |
| delivery_export/reconcile/review_apply/compare | Complete mapped projects, original customer CSV, selected analyst changes and full edition/delivery comparison. |
| workspace_export | Original native action followed by complete ZIP receiving in the existing merchant export directory; returns a stable workspace file selector. |

Rows select `projects`, `applicants`, `disasters`, `declarations`, `categories` or `issues`. Sorting uses an actual column from the running schema, including the original exact amount ordering. A row request accepts up to 1,000 rows. Continue the same immutable version, table, search, sort and direction with the returned `nextOffset`.

The archive also pages deliveryMappings, deliveryMappingReviews, projectDeliveries, deliveryReconciliations, deliveryReviewImports and deliveryComparisons. These records belong to the same original workspace and revision.

Archive pages accept up to 500 entries. Retain `expectedRevision` from the first result and send it on all later pages. If the original collection changes, restart that listing at its current revision. This does not change any source or portfolio edition.

Composite applicant and declaration IDs remain their returned strings; do not replace them with an isolated applicant ID or UUID. Detailed rows keep the complete native original record, source-page SHA/row and applicable analytical/analyst fields.

## Action identity and interruption

The review annotation accepts `applicantSourceId` for an explicit original applicant choice, up to 200 characters; the native engine requires an explanatory note for that choice. Buyer inspection and receiving accept 1–4,096 existing intent IDs, each at most 128 characters.

Save the full intended request before dispatch. The operation ID accepts the original core's printable identifier contract: an alphanumeric first character followed by alphanumerics, dot, underscore, colon or hyphen, up to 160 characters. Every new action carries the displayed workspace revision. A portfolio revision also carries its actual prior version; release changes carry the original generation.

If a response is interrupted, preserve the request and inspect its `operationId`. The native journal reconciles an existing ID and exact payload before checking the current revision. Repeat that same request when continuation is needed. `OUTCOME_UNCERTAIN` is an unknown reply, not a failed operation and not permission to invent another identity.

The merchant adapter validates its action field contract against the running console. It does not guess newly introduced fields or silently downgrade an old console. The source-owned protocol and original application should be installed from the same complete release.

`source.import` takes `{sourcePackage:'retained-cohort'}` in the typed client. The adapter reads the selected full file and verifies its declared SHA, then passes the original JSON bundle to the native engine. An import is bounded to 64 MiB; use the original complete source workflow for a larger edition, retaining its actual native limits and source identity.

## Original file selection

| Kind | Original ID | Complete files |
| --- | --- | --- |
| source | Source-edition ID | Every declarations/applicants/projects metadata, field, end-metadata and original page body. |
| portfolio | Portfolio-version ID | Its complete retained canonical portfolio JSON. |
| export | Export ID | The native frozen JSON, CSV, HTML report, complete portfolio comparison or full source bundle listed in the original exports manifest. |
| receipt | Native buyer receipt ID | dataset.csv, dataset.jsonl, review.html, delivery.json and manifest.json. |
| mapping | Mapping ID | Full canonical destination mapping, including the retained schema specification. |
| delivery | Delivery ID | Full manifest, all mapped rows, exact target CSV and complete original portfolio. |
| reconciliation | Reconciliation ID | Full original-file comparison and every proposed analyst row; its linked export ZIP includes original CSV bytes. |
| delivery-comparison | Delivery comparison ID | Complete before/after scope, source, amount and analyst comparisons; linked export ZIP includes both portfolios. |
| workspace | Stable ID from workspaceArchive.selection | Complete original native workspace ZIP, retained through application and merchant restarts. |

The source list preserves every occurrence with a deterministic filename and its original response receipt. Shared hashes do not erase distinct source URLs or positions. These are the original retained HTTP body bytes; a separately captured wire representation is not asserted.

~~~sh
starforge openfema-mcp inspect --url ACTUAL_MCP_URL \
  --workspace public-assistance --kind export --id ACTUAL_EXPORT_ID \
  --token-env MCP_ACCESS_TOKEN

starforge openfema-mcp download --url ACTUAL_MCP_URL \
  --workspace public-assistance --kind export --id ACTUAL_EXPORT_ID \
  --out /absolute/private/received-export \
  --workspace-id ACTUAL_ORIGINAL_UUID \
  --manifest-sha256 ACTUAL_INSPECTED_TRANSFER_SHA256 \
  --token-env MCP_ACCESS_TOKEN

starforge openfema-mcp reopen --out /absolute/private/received-export \
  --manifest-sha256 ACTUAL_INSPECTED_TRANSFER_SHA256
~~~

Use `--file EXACT_FILENAME` to select one member from the original list. Without it, download includes every file in that selection. Inspection returns the transfer manifest and its exact digest. Download saves that manifest and every selected full file. The original downloader owns prefix hashes, write progress, exclusive local file ownership, exact completion and interrupted receiving. Repeating the same command continues the same directory and same file identities.

The transfer's endpoint identity is the immutable workspace UUID, so a legitimate listener-port change does not invalidate it. Offline reopen rederives the transfer identity from its workspace, selection and complete file manifest, verifies every completed file, and checks the supplied manifest SHA256 when present, without opening a provider or payment connection. It proves those original saved bytes; it does not assert that a portable workspace has been restored or a merchant release is live. The original `workspace.export` action returns its native archive descriptor. The merchant adapter then receives that complete native ZIP, binds its actual revision, byte count and SHA, and returns `workspaceArchive.selection` with `kind: 'workspace'`. The exact received file lives under the original merchant export directory, so it remains available after the application or merchant process restarts. `workspaceArchive.state: 'RECEIVING'` means the native action completed while file receiving still needs continuation; repeat its exact original request. The saved pending identity prevents a changed workspace from being substituted for that archive. Completed archive files remain outside the source workspace, so later backups do not recursively contain earlier transport copies. After complete receiving, run the original `openfema restore` command into a new private directory.

### Bounded file reads

Direct reads return `readId`, `file:{name,contentType,bytes,sha256}`, offset, bytesRead, nextOffset, base64 data and its declared encoding. A new read validates the entire original HTTP file against the retained manifest using fixed-size writes, then gives the existing retained reader a held read-only descriptor. Subsequent chunks use that descriptor. The native maximum chunk is 196,608 bytes; default chunks are 65,536 bytes.

A retained reader can finish after the original console closes. If it expires, resume the same selected file SHA with a new read at the existing offset. Release closes only that temporary descriptor. The original workspace, source objects, completed exports and local received files remain.

Interrupted transport prefixes are retained privately and never advertised as complete originals. Only a complete, byte-matched temporary transport copy is unlinked after its read-only descriptor is held. The original downloader's completed files and journal are the receiving authority.

The file/transfer budget is 1 GiB. Transfer manifests use the existing 65,000-byte native manifest limit. If a large response inventory exceeds that limit, select an exact member or create the original complete `source.export` bundle and receive its single retained export. The client allows a bounded 64 MiB MCP response so complete manifests and source context are not truncated; binary files still travel in bounded chunks.

## Complete mapped project exchange

The browser's **Data integration** view, native CLI and merchant tools use the same mappings, explicit reviews, project deliveries and customer files. The operating contract and exact source/analyst fields are in [DATA_INTEGRATION.md](DATA_INTEGRATION.md). A destination mapping retains the full supplied schema, maps between 2 and 200 columns, and includes one required disaster identity and one required project identity. Writable analyst fields have one destination column each.

### Declare the complete inputs once

Prepare the original mapping JSON and the complete original UTF-8 customer CSV as owned private files. Inspect each file with the installed client:

~~~sh
starforge openfema-mcp input --kind mapping \
  --file /absolute/private/destination-mapping.json --label "Reviewed destination mapping"

starforge openfema-mcp input --kind customer_csv \
  --file /absolute/private/complete-customer-projects.csv --label "Current complete project register"
~~~

Each result contains an `entry` with the absolute host path, kind, original filename and whole-file SHA256. Merge those entries under `deliveryInputs` in the existing selected workspace connection:

~~~json
{
  "deliveryInputs": {
    "project-mapping-v1": {
      "path": "/absolute/private/destination-mapping.json",
      "kind": "mapping",
      "name": "destination-mapping.json",
      "label": "Reviewed destination mapping",
      "sha256": "ACTUAL_COMPLETE_MAPPING_FILE_SHA256"
    },
    "customer-register-20261012": {
      "path": "/absolute/private/complete-customer-projects.csv",
      "kind": "customer_csv",
      "name": "complete-customer-projects.csv",
      "label": "Current complete project register",
      "sha256": "ACTUAL_COMPLETE_CSV_FILE_SHA256"
    }
  }
}
~~~

Reload the original merchant connection after changing its host configuration. `workspaces` lists these aliases, input kinds, names and digests. It keeps private paths in the host. Save a later input under its own alias and digest; an existing action keeps its original full input.

The host accepts up to 128 delivery input aliases per workspace. Mapping JSON files are at most 16 MiB and their native schema evidence is at most 2 MiB of UTF-8. Customer CSV is at most 16 MiB of original UTF-8, including a retained byte-order mark if present. The HTTP action limits accommodate JSON escaping of these full files; native validation retains the original content limits. Merchant/tool requests remain small because they carry aliases.

### Run the entire operation

Use a retained original portfolio version and the actual reviewed mapping and customer-file aliases:

~~~sh
starforge openfema-merchant-exchange \
  --url ACTUAL_MCP_URL --workspace public-assistance \
  --version ACTUAL_ORIGINAL_PORTFOLIO_VERSION \
  --mapping-package project-mapping-v1 \
  --customer-file-package customer-register-20261012 \
  --operation ORIGINAL_EXCHANGE_OPERATION \
  --reviewer "Receiving analyst" \
  --mapping-note "Confirmed each destination column against the retained schema." \
  --rows 2,17 --review-note "Accepted these two original CSV analyst decisions." \
  --out /absolute/private/project-exchange \
  --token-env MCP_ACCESS_TOKEN
~~~

Select real CSV row numbers from the reconciliation; row 1 is the header. Omit `--rows` and `--review-note` when receiving and comparing without applying analyst decisions. The native engine checks each selected proposal against the exact current portfolio and earlier exported review baseline.

The maintained example [merchant-project-exchange.mjs](examples/merchant-project-exchange.mjs) saves and reviews the mapping, creates the complete first delivery, receives the entire customer CSV, applies the explicitly selected valid analyst rows, creates the complete reviewed delivery with its customer base, compares both deliveries, and receives the full original workspace ZIP. It downloads the complete mapping, exchange documents and all linked ZIPs through the existing downloader, then reopens every received file set offline. Its local operation lease and retained requests let the same command continue after an interrupted action or transfer.

The final `merchant-exchange-result.json` links the native mapping, reconciliation, delivery and comparison IDs to their complete receiving directories. The original customer file is inside `customer-reconciliation-files`; `reviewed-delivery-files` includes the selected customer base and full source portfolio. Restore `complete-workspace/OpenFEMA_Complete_Workspace.zip` through the original product command and open the restored directory in Applications.

### Typed action payloads

| Native action | Merchant client payload |
| --- | --- |
| delivery.mapping.save | mappingPackage; optional previousMappingId |
| delivery.mapping.review | mappingId, expectedMappingSha256, reviewer, note |
| delivery.export | mappingId, versionId; optional customerReconciliationId |
| delivery.reconcile | deliveryId, customerFilePackage |
| delivery.review.apply | reconciliationId, versionId, rowNumbers, reviewer, note |
| delivery.compare | beforeDeliveryId, afterDeliveryId |

`mappingPackage` and `customerFilePackage` are complete-file references supplied by this adapter; the original native API still receives its full mapping or customerFile object. Every action returns the native result and original operation identity. Reconciliation keeps customer-only/pre-obligation rows, duplicate source identities, official-source differences and invalid analyst values visible. It applies only explicitly selected valid analyst decisions.

The complete DR4724 example contains 195 actual source projects. Its unchanged full-file round trip matches all 195 rows; the retained TJLabs analyst example changes one review while leaving all source fields and four financial measures intact. A source edition with declarations and no funded projects retains its full declared cohort and header-only project projection. Use these source-native behaviors when commissioning a customer installation, with its actual source scope, supplied schema and receiving analyst.

## Preserve the source meaning

Keep the running source contract and retained dataset metadata with the result. Source dataset version, refresh observation, cohort and migration notes are part of its meaning. The native domain keeps project cost, federal share obligated, total obligated and mitigation separate, including negative adjustments and absent/null fields. Do not add these overlapping measures together or describe an application portfolio as an official federal financial report.

A changed portfolio may reflect source changes, changed criteria or analyst decisions. Its original comparison records those distinctions. Use those records in a handover rather than treating all added or absent projects as a source-system event.

The source-owned contribution registers this complete interface, client, launcher and guides with the maintained package. It creates no central registry edit, second publisher or buyer engine.
