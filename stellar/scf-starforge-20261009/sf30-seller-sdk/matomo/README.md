# Matomo report workbench and source receiving

This is the maintained Matomo operator and customer workflow inside the original SF30 SDK. It selects an existing Reporting API or Matomo for WordPress connection, retains a particular report and its native child tables, builds an immutable typed edition, reviews changes, and publishes through the original SQLite merchant, dataset publisher, SF82 release, and SF100 receiving paths.

The browser and CLI share one private workspace, action journal, source capture, and release history. A report can be inspected and delivered without recapturing it. Configuration and review are operator decisions; the adapter does not create a Matomo site, alter tracking, install a plugin, or issue management writes.

## Start the operator

Use the complete maintained SCF source or distribution. This folder imports the original SQLite workbench and publisher, SF82, SF100, PostgreSQL publisher file/lease utilities, and Python Buyer receiving package. Copying this directory alone omits required native modules.

Use the distribution's supported Node runtime, including `node:sqlite`, `JSON.rawJSON`, and source-aware `JSON.parse`. Python receiving uses the original Buyer package and the standard library. `MATOMO_PYTHON`, the CLI's `--python`, or the model's `python` option selects the interpreter.

Create an operator-owned source file. A standalone or hosted Matomo configuration is:

```json
{
  "schema": "stellar-forge.matomo-source.v1",
  "mode": "reporting-api",
  "endpoint": "https://analytics.example/index.php",
  "siteId": "1",
  "authorization": {"tokenEnv": "MATOMO_REPORT_TOKEN"},
  "label": "Selected analytics account",
  "timeoutMs": 30000,
  "maxResponseBytes": 1048576,
  "minIntervalMs": 750
}
```

The endpoint and site are the actual operator-selected deployment. Resolve the named credential in the launching environment. The source file stores its reference, not the token. Reporting API requests use the native POST form with `token_auth` in its private body. An anonymous deployment uses an empty `authorization` object.

Matomo for WordPress uses its own site context and WordPress authorization:

```json
{
  "schema": "stellar-forge.matomo-source.v1",
  "mode": "wordpress",
  "endpoint": "https://www.example/wp-json/matomo/v1",
  "authorization": {"headerEnv": "MATOMO_WORDPRESS_AUTHORIZATION"},
  "label": "Selected WordPress analytics"
}
```

The referenced environment value is the complete Authorization header appropriate to that WordPress deployment. Do not add `siteId` or a standalone Matomo token to this mode. The alternative native plain-permalink base is `https://www.example/?rest_route=/matomo/v1`; the adapter preserves that form.

An environment proxy is an explicit optional source setting:

```json
{"transport": {"mode": "environment-proxy", "proxyEnv": "HTTPS_PROXY"}}
```

Otherwise the original direct transport is used. Source credential values, authorization headers, and proxy credentials are excluded from source manifests and operator results.

From `stellar/scf-starforge-20261009`:

```sh
node sf30-seller-sdk/matomo/cli.mjs serve \
  --workspace /absolute/private/matomo-workspace \
  --create --source /absolute/private/source.json --port 0
```

The launcher prints the bound loopback URL with its private session token. Open that exact URL. The server uses the original workspace lease, host/origin checks, a session token, and external self-hosted scripts/styles. Closing it drains the active workspace operation and its owned merchant runtimes.

Reopen the same workspace by omitting `--create` and `--source`. A missing database under an existing initialized identity is an error; reopening does not create a replacement empty workspace. Keep the complete private directory and its original file permissions together.

## Complete operator journey

| Area | Operator action | Retained result |
| --- | --- | --- |
| Source and catalog | Choose the deployment, a literal period/date, language, and exact segment; discover report and segment metadata | Native catalog responses, site context, version outcome, report variants and parameter identities |
| Capture | Choose a report and its child-table rules; select page and population limits | Original accepted response bytes, request descriptions, outcomes, table hierarchy and coverage |
| Editions | Materialize and review the completed capture | Immutable SQLite database, exact typed rows, source inventory and edition digest |
| Comparisons | Select two editions, explicit row keys and field mappings; review findings | Source-linked changes, unmatched rows, duplicate/invalid keys and saved review decisions |
| Merchant and release | Review payment terms and named queries, preview, export, stage and select the native release | Original SQLite package, SF82 generation/history and owned runtime state |
| Publication | Choose report rows or the complete source-file projection; inspect, review and publish | Original SQLite extraction and immutable dataset target version |
| Receiving | Prepare the complete handover, receive into a new private directory, inspect and reopen | Original SF100 session/pages plus every source file and operator page record |

Forms retain their exact pending action ID and body across a lost browser response. Reloading checks the saved action before offering recovery. The activity view exposes the original action outcome and source-read attempts. A failed or interrupted action does not automatically become a newly identified operation.

### Source selection and coverage

The implemented selection accepts one literal day, week, month or year anchor date, or one `period=range` with two literal dates. A period is interpreted in the source site's timezone. The literal selection remains fixed while pages are read.

Select a report from the retained catalog, including its actual parameter variant. Fixed metadata parameters become native parameters; WordPress uses PHP bracket keys such as `apiParameters[idGoal]`. Paging and formatting filters remain outer request parameters. Native child-table actions are resolved from the selected metadata, including reports whose child action differs from the parent.

The adapter requests processed reports with unformatted metrics. Each accepted response retains its original `reportData`, aligned `reportMetadata`, report identity, column definitions, and totals. Short or empty offset pages finish the selected table. Summary rows, unsupported or unselected children, limits, and incomplete requests remain visible in coverage. `reportTotal` is a metric total, not an HTTP row count.

A completed traversal describes the retained processed archive. It does not reconstruct detail already aggregated or omitted by the source, and separate page requests are not an atomic source snapshot. Numeric zero, missing, null, and values supplied by Matomo's processed-report layer remain distinguishable in the retained source.

The defaults permit 250,000 rows, 5,000 requests, 128 MiB of accepted response bytes and depth32. The corresponding supported maxima are 1,000,000 rows, 10,000 requests, 512 MiB and depth128. A response is at most1 MiB; the page size is1–1,000. The selected limits are recorded. A controlled resume may increase limits or add an explicit unresolved child-report rule while keeping the original capture identity and already accepted pages.

## Typed editions and review

An edition contains the original JSON values and their source positions. JavaScript numeric lexemes are retained through the native-number representation, including inside arrays and objects. Python reads those numbers through exact decimal parsing. Native strings remain strings. Missing fields are distinct from present nulls.

The `matomo_rows` relation retains:

```text
row_id, table_id, parent_row_id, report_id, source_row, depth,
path_json, source_request, source_index, data_json, metadata_json,
cell_types_json
```

Selected native fields also receive deterministic SQL-safe column names. The field manifest maps each original name to that column, observed kinds and presence counts. A projected cell is not a replacement for its original `data_json` or kind map.

Source rows retain the capture table, parent row, hierarchy path, accepted source request and index within that response. The UI shows these references alongside typed cells. It renders provider text as text, not executable markup.

Comparisons require explicit keys and field mappings. A selector reads a named data field, named metadata field, native hierarchy path, or report identity. Native comparison retains value kinds; decimal mode deliberately permits exact numeric equivalence. Duplicate keys and absent/null/invalid keys are findings, not arbitrarily paired rows. Reviews bind to the immutable comparison manifest and either one finding or the overall comparison. A new capture or changed mapping produces a separate retained result.

## Original merchant and release

A merchant draft uses the unchanged SQLite query compiler and seller offer compiler. The full draft is compiled before a new merchant is retained. Native validation covers the public origin, service name, payment terms, SQL/parameters, columns, public example input, methods, paths and resource metadata.

The service name is1–32 printable ASCII characters. The descriptor origin is canonical public HTTPS. For an internal evaluation, an explicitly reserved name such as `https://matomo-evaluation.example` can identify the metadata scope. It is not evidence of a deployed HTTPS service. A separately launched development runtime can bind loopback; inspect the actual runtime URL for its local unpaid request.

`matomoMerchantDraft()` creates three editable native queries:

| Query | Default path | Content |
| --- | --- | --- |
| `reportRows` | `/matomo/rows` | Stable row-ID order, source identity/hierarchy, typed original JSON and selected fields |
| `reportRow` | `/matomo/row` | One immutable64-hex row ID |
| `sourceFiles` | `/matomo/source-files` | The complete retained file inventory in the maintained chunk protocol |

Payment network, asset, recipient, amount and timeout come from the operator's existing reviewed terms. Public examples contain explicit parameter values and empty response rows; private analytics are not copied into discovery metadata.

Draft correction uses the same native workbench revision. Export preserves its exact source and draft identities. SF82 owns staging, comparisons, selected-generation checks, runtime observation, stop and rollback. The Matomo layer retains its operation IDs and package pins; it does not implement a second release manager or settlement path.

A CLI `start-release` or `open-release-console` stays in the foreground until SIGINT/SIGTERM so its owned runtime has a real lifetime. Closing a short-lived command must not leave a purported running service behind.

## Publication and complete source handover

Publication uses the original SQLite publisher. The extraction has a declared stable order and an exact expected population derived from the selected edition. The operator can publish either `report-rows` or `source-files`; the latter is required to reconstruct all original source files.

The source-file rows are a compatible extension of the common SourceFiles protocol:

```text
capture_id, edition_id, report_capture_id, path, file_sha256,
file_bytes, chunk_index, chunk_count, chunk_sha256, content_base64
```

Chunks are49,152 bytes. Their integer geometry, per-chunk digest, complete-file digest, edition/report identities and ordered population are checked. `capture_id` binds the source-file manifest bytes. The manifest enumerates every restored original except its own file; it binds the original catalog, capture, scope and row population.

After inspecting the candidate, review either target initialization or the exact current target snapshot/revision. Publish with that native review identity. A source handover then reads the reviewed local dataset through the original SF30 dataset page producer and original SF100 append/finalize/scan.

This local producer path does not make an HTTP purchase. Its native payment status remains `NOT_INFERRED_FROM_SOURCE_HTTP_OR_LOCAL_HASHES`. Existing SF88 acquired deliveries remain accepted through the same customer SourceFiles helper. The adapter never creates a substitute acquisition or payment receipt.

The portable handover includes:

- The original finalized SF100 session, manifest, page archives, typed outputs and declared native files.
- Each exact local operator page request, response and receipt in a separate verified inventory.
- The evidence/source hash bindings linking those records to the native SF100 page chain.
- The full Matomo source-file projection, restored through the original DatasetDelivery and SourceFiles implementations.

If a response survived but its local receipt did not, recovery reconstructs a distinctly marked receipt from those retained bytes. It does not reread the producer just to fill that receipt.

Receiving creates a private staging directory, verifies the archive inventory and native scan, reconstructs all source bytes, and publishes the completed customer directory atomically. Reopen checks the same archive, pages, operator records and source inventory. No provider call occurs.

## Installed customer command

The same product contribution exposes `matomo-customer`. In an installed
cut that includes this command, inspect its registration and open the received
archive with the existing Python interpreter:

```sh
starforge registrations --command matomo-customer
starforge matomo-customer --help

starforge matomo-customer receive \
  --archive /absolute/private/matomo-handover.zip \
  --out /absolute/private/customer-matomo \
  --python /absolute/existing-python/bin/python

starforge matomo-customer reopen \
  --out /absolute/private/customer-matomo \
  --python /absolute/existing-python/bin/python

starforge matomo-customer rows \
  --out /absolute/private/customer-matomo \
  --python /absolute/existing-python/bin/python \
  > /absolute/private/matomo-report-rows.jsonl
```

The launcher supplies the original SDK and Buyer Python import directories from
that installed source. It uses `MATOMO_PYTHON` or `python3` when `--python`
is omitted. Its Node verifier defaults to the executable running the installed
command; `--node` can select the existing native verifier explicitly.
No interpreter or package is installed by this command.

Receive and reopen invoke the unchanged `matomo.customer` functions. They keep
the same archive, page-chain, operator-evidence, source-file and edition checks.
An existing customer destination must match the original archive; it is not
overwritten with a different handover. The native summary retains its payment
status. `rows` streams original JSONL bytes directly, including number text,
string/null/absence distinctions and source references, without parsing those
rows through JavaScript or collecting the output in memory.

Advanced operators can invoke `pack --scan … --operator-evidence … --out …`
or `from-scan --scan … --out …` through the same command. Those modes retain the
original Python semantics described below. Native error output, exit status and
interrupt/termination signals pass through the installed launcher. After an
interruption, inspect or reopen the same private destination before choosing a
new operation.

## Python customer use

Use the original Buyer package on `PYTHONPATH`, together with the SDK root. The maintained distribution may already supply these imports.

```python
from pathlib import Path
from matomo.customer import receive_archive, open_received

received = receive_archive(
    Path("/absolute/private/matomo-handover.zip"),
    Path("/absolute/private/customer-matomo"),
    node="node",
)
print(received.summary())

reopened = open_received("/absolute/private/customer-matomo", node="node")
for row in reopened.source.rows():
    # Exact retained JSONL bytes, including native number/string distinctions.
    consume_original_row(row.original)
```

For an existing verified native dataset delivery:

```python
from matomo.customer import MatomoSourceFiles

source = MatomoSourceFiles.from_dataset(
    delivery,
    "/absolute/private/restored-matomo-source",
    expected_capture_id=reviewed_source_manifest_sha256,
    edition_id=reviewed_edition_id,
    report_capture_id=reviewed_report_capture_id,
)
```

A finalized original SF100 scan becomes a delivery with the existing `DatasetDelivery.from_finalized_scan(scan)` classmethod. It retains `sourceFormat=SF100_SCAN` and the native payment status. A direct acquired SF88 delivery retains its own original state.

The same customer workflow is available from the command line:

```sh
python3 -m matomo.customer receive \
  --archive /absolute/private/matomo-handover.zip \
  --out /absolute/private/customer-matomo

python3 -m matomo.customer reopen \
  --out /absolute/private/customer-matomo

python3 -m matomo.customer rows \
  --out /absolute/private/customer-matomo
```

Packing an existing scan requires both `--scan` and `--operator-evidence`. Those operator records supply the exact bytes behind the native evidence hashes.

## Programmatic operator and recovery

```javascript
import {openMatomoWorkspace} from './sf30-seller-sdk/matomo/model.mjs';

const app = await openMatomoWorkspace({
  directory: '/absolute/private/matomo-workspace'
});
try {
  const state = app.state();
  const result = await app.perform('discover', {
    operationId: 'catalog-20261011',
    expectedRevision: state.revision,
    scope: {
      period: 'day',
      date: '2026-10-11',
      language: 'en',
      segment: ''
    }
  });
  console.log(result.catalog);
} finally {
  await app.close();
}
```

This example deliberately performs one source discovery when invoked; use `app.state()` and the retained catalog APIs to inspect an existing operation instead. Choose new source operations deliberately and keep their IDs with the intended fixed scope.

Every effect takes a stable `operationId` and the observed `expectedRevision`. The ID grammar is1–96 characters beginning with a letter or digit, followed by letters, digits, dots, underscores or hyphens. The same ID cannot be reused for a changed body. Inspect `store.action(id)` or the CLI `action --id` after a lost response.

| Operation family | Commands |
| --- | --- |
| Native source | `discover`, `resume-catalog`, `capture`, `resume-capture` |
| Editions and review | `edition`, `resume-edition`, `review-edition` |
| Comparison | `compare`, `resume-comparison`, `review-comparison` |
| Merchant | `configure-merchant`, `resume-merchant`, `save-merchant`, `preview`, `export-package`, `recover-package` |
| Release | `stage-release`, `select-release`, `start-release`, `stop-release`, `open-release-console` |
| Dataset | `prepare-delivery`, `recover-delivery`, `review-delivery`, `publish-delivery` |
| Customer | `prepare-handover`, `resume-handover`, `receive-handover`, `resume-receiving`, `reopen-receiving` |

The CLI passes one exact JSON request with `--input FILE` or `--input -`. Read-only commands include `state`, `action`, `catalog`, `capture-state`, `edition-state`, `merchant-state`, `delivery-state`, `handover-state`, `receiving-state` and `releases`.

The browser calls the same model through `POST /api/operation/:name`. It receives an action ID, then reads its saved result. Artifacts are downloaded from their native retained files; provider data is not stored in browser session state. `server.mjs` defines the exact read routes and `model.mjs` owns the supported operation map.

A resume names the original catalog, capture, edition, comparison, delivery, handover or receiving record. It consumes its accepted outputs and remaining work. Changes of source, report selection, or an already finalized edition are separate source decisions. Restoring an existing destination verifies its complete inventory instead of overwriting conflicting files.

## Recorded native source and receiving operation

The retained internal operation selected the official public demo's2026-10-11 Referrers search-engine report and its native keyword child reports. It completed:

| Result | Actual retained population |
| --- | --- |
| Processed report source | 89 rows,14 tables,15 accepted responses |
| Child coverage | 13 selected child-table references, including an empty child table |
| Typed edition | 89 rows with22 observed native fields |
| Source-file publication | 57 chunks restoring43 original files |
| Native delivery | Eight original SF100 pages |
| Customer | Complete Python archive receiving and native reopen |

The source retains the demo's returned site context and report definitions. These are private development inputs, excluded from source commits. This record describes the actual processed archive and native customer operation; a customer's own selected deployment and data remain separate inputs.

## Source map

| Module | Responsibility |
| --- | --- |
| `contract.mjs`, `values.mjs` | Explicit source/scope validation and exact native value representation |
| `provider.mjs` | Native Reporting API/WordPress requests through the original upstream transport |
| `store.mjs` | Workspace identity, source-read attempts, durable action results and recovery |
| `capture.mjs` | Catalog, report pagination, child-table traversal and source coverage |
| `editions.mjs`, `comparison.mjs` | Immutable typed source database, explicit mappings, findings and reviews |
| `merchant.mjs` | Original SQLite workbench/publisher and SF82 composition |
| `operator-handover.mjs`, `operator-scan.mjs` | Original local dataset producer and finalized SF100 handover |
| `customer.py` | Original dataset/source-file receiving plus Matomo identity and operator evidence |
| `model.mjs`, `server.mjs`, `cli.mjs`, `public/` | One operator API, authenticated browser and CLI |

## Native references

- [Matomo Reporting API](https://developer.matomo.org/guides/reporting-api): site timezone, literal periods, report parameters, formatting, paging, child reports and token handling.
- [Matomo report metadata](https://developer.matomo.org/api-reference/reporting-api-metadata): report variants, metric definitions and processed reports.
- [Matomo for WordPress REST API](https://developer.matomo.org/api-reference/wordpress/restapi-reference): native WordPress namespace and authentication context.
- The retained Matomo source review examined the original `ProcessedReport.php`, `API.php`, request/filter/JSON renderer implementation, and WordPress `WpMatomo/API.php`; its observed transformations and deployment-specific archive limits remain source semantics.
- The local maintained contracts are the original [SQLite workbench](../sqlite/workbench/model.mjs), [SQLite publisher](../sqlite/publisher/model.mjs), [SF82 releases](../../sf82-seller-pilot/releases.mjs), [SF100 delivery](../../sf100-buyer-dataset-delivery/deliver.mjs), and [common source-file receiving](../source_file_delivery.py).

## Saved Applications and native agent operation

The same original workspace can be selected by the maintained Applications loader and the merchant MCP host. The complete [Applications and agent guide](../../../../stellar-forge/mcp-merchant-operator/MATOMO_WORKSPACES.md) covers source-bound saved launch, exact operation/revision recovery, typed reviews, SF82 controls, full source publication and native customer receiving. The product-owned contribution preserves the original CLI and exposes the native provider through the existing shared registry; use a selected distribution that actually includes that contribution. The saved Application kind is `matomo-authoring`; the source-owned merchant provider is `matomo-workspaces`. Its initializer binds the original workspace and SF82 store, and the native agent owner cancels/drains the same model on close.
