# Azure monthly source acquisition and receiving

Azure exports is part of the original Commons BI Operator. It takes an existing Cost Management export through native execution history, its exact partition manifest, resumable file acquisition, a staff mapping review, and the existing Agency billing engine. A source can also arrive as original files or portable receiving volumes.

Open **Azure exports** in the left navigation. The four views are **Sources & billing**, **Azure connection**, **Native runs**, and **Receiving & handoff**. Working edits and selected files stay in this browser's memory while using the application's Refresh control, switching views, or paging through native rows and partitions. Save a review or connection before reloading or closing the browser. The same operations are available through the original structured CLI and authenticated local HTTP API. Agency policies, usage inputs, allocation calculations, statement revisions and accounting workbooks remain in **Agency billing**.

## Start the complete product

Use the original installation steps in README.md, then:

~~~sh
python BI_OPERATOR.py --workspace ./agency-workspace serve
~~~

The launcher opens the selected private workspace on loopback and prints its access URL. The workspace token stays in the original browser session. Choose a persistent directory with enough space for the source objects and their backups. Reopen the same directory to continue an interrupted transfer.

For the complete authored operating example:

~~~sh
python examples/AZURE_EXPORTS_JOURNEY.py --output ./azure-example
python BI_OPERATOR.py --workspace ./azure-example/workspace serve
~~~

This journey uses the original 83-row cost CSV, 36-row usage CSV, 12 agencies and 16 allocation rules in examples/billing. It serves those exact authored inputs in the documented Azure manifest/Gzip/range protocol through an explicit loopback carrier, then operates the real product actions. The saved source marks its origin as local-protocol. Its output includes the original files, reviewed import, finalized statements, portable receiving volumes and a restored workspace. The generated OPEN_FIRST.md names the saved records and files. Azure account operations use the configured cloud connection below.

## Connect the existing Azure source

Save a connection containing:

| Field | Value |
| --- | --- |
| Existing Azure scope | The existing subscription, resource group, billing account/profile/invoice section, or management group resource path used by the export |
| Blob container URL | The selected public Azure Blob container, such as https://accountname.blob.core.windows.net/costexports |
| Native folder prefix | An optional exact folder prefix within that container |
| Authentication | Named environment references, or the operator machine's existing Azure CLI login |
| Management token variable | A variable containing an access token for https://management.azure.com/ |
| Storage token variable | A separate variable containing an access token for https://storage.azure.com/ |
| Container SAS variable | Optional alternative to the Storage OAuth token; keep the complete SAS query in this environment variable |
| Azure CLI subscription | Optional existing subscription selector for the CLI token request |
| Cost Management API version | The installed default is 2025-03-01; a different published edition can be saved explicitly |

The saved connection contains environment variable names, never their values. A SAS query is attached only when issuing the selected container request. Enter the container URL without query parameters. For an environment token refresh, restart the operator with the refreshed token values in the same named variables and reopen the same workspace. With Azure CLI authentication, renew the operator machine's existing login; each request asks that CLI for a current token. Source identities, saved connection revisions and retained file bytes stay stable.

Management and storage permissions are separate. Use the existing account's permissions for reading/exporting the selected Cost Management source and reading the selected Blob container. **Read exports** and **Read container files** give the original provider result, including an actionable native status if that account cannot perform the operation.

The advanced loopback origin is for an already equipped local protocol carrier. It must be an explicit HTTP loopback origin with a port, paired with its /storage/ container. Cloud connections use HTTPS public Azure endpoints.

## Select the complete monthly edition

**Read exports** retains the original definitions and pagination. **Read container files** retains the original Azure XML listing, exact blob names, byte counts, ETags and opaque continuation marker. Continue each selection until its native pages are complete. Discovery does not create or modify Azure exports.

There are two cloud paths:

1. Select an existing native manifest from the container listing and acquire it directly.
2. In **Native runs**, choose an existing export and billing month, then **Prepare monthly selection**. Review the retained definition and explicit time period. **Run selected month** makes one request to that existing export's /run endpoint. Refresh native execution history, choose the actual completed run ID, then acquire its returned manifestFile.

The run request is saved before the provider POST. If its response is lost, the record reopens in the uncertain state. Continue with **Refresh original run history**, select the actual provider run, and receive it. Refreshing history retains every native response and continuation. It never substitutes a guessed run ID or starts a second export execution.

Daily month-to-date exports with OverwritePreviousReport represent replacement editions. Select one complete manifest edition for billing. A new manifest produces a new source; do not add yesterday's and today's snapshots together. Microsoft documents the native partition manifest and this overwrite behavior in its [improved exports guide](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-improved-exports).

The product retains the manifest's own exportConfig, deliveryConfig, runInfo, dataset version and manifest version. Those values are not rewritten to the connector's request API version. Exact native file paths and order come from its blobs array.

## Receive and resume original files

**Transfer next range** commits one response of at most 4 MiB. **Continue all partitions** repeats these saved steps while the operator view remains open. **Stop after this transfer step** stops at the next committed boundary. Closing the browser also leaves the last completed checkpoint in the selected workspace.

The first request pins the manifest ETag. Each partition starts with its original length and ETag and continues with Range and If-Match. A committed chunk records its digest and byte count; the next request starts after those bytes. Completion joins all chunks into the original full file and checks the manifest again. The implementation follows the original [Get Blob range/conditional contract](https://learn.microsoft.com/en-us/rest/api/storageservices/get-blob).

If the provider requests a retry interval, the record saves the retry time. Reopen it after that time and continue. If a pinned manifest or file changes, select the provider's new complete edition. The earlier source and any billing statement made from it remain retained.

For offline originals, select a manifest JSON or a ZIP containing the manifest and every native partition. Enter the manifest's exact member path and any explicit archive prefix. The archive member for a blob must equal that prefix plus the complete native blob name. Individual original partitions can also be received into their selected manifest row. The file picker never guesses among same-named files from different folders.

Supported native file forms are CSV, CSV/Gzip, Parquet and Parquet/Snappy. The product retains the original compressed or columnar bytes. CSV/Gzip uses Python's standard library. Parquet decoding uses an installed pyarrow runtime and produces full CSV input while preserving Decimal and date text; install requirements-azure.txt only when that source is needed. Conversion does not change the retained original partition.

## Review the billing interpretation

Once every native partition is complete, select a partition and inspect its original headers and paginated rows. The review records:

- Billing month, actual or amortized basis, supplier or allocated view.
- Supplier invoice status and optional invoice ID.
- Billing-period date interpretation.
- Explicit billing amount, currency, resource, group, subscription, service, charge, tags, invoice and allocation-rule columns.
- Staff note and source revision.

Map fields to the actual header names. The amount and currency columns are required. The native ActualCost or AmortizedCost declaration must agree with the chosen basis. Other retained dataset types require their own native semantic mapping; they do not become billing amounts merely because they contain numeric columns.

The review reads every original row and validates the complete native row count and selected billing month. It preserves refunds, signed high-precision decimal amounts, separate duplicate-looking rows and original file/row order. The supplier view retains Azure's internal allocation rows as excluded records according to the original Billing engine.

If a partition contains several currencies, receiving creates separate complete inputs by currency and records their original row ordinals. Choose each currency's inputs in a separate billing period. For a single currency the original CSV bytes flow into the prepared input without row rewriting. The review processes native partitions in manifest order, flushing complete billing ZIPs as currency or the existing byte/row limits require. One capped batch remains in memory while saved batches are retained as workspace objects.

**Save complete source review** creates an immutable review. Correcting a mapping creates another review of the same acquired source. The earlier review remains available. **Prepare billing import** starts sending the reviewed inputs through billing.cost.import with stable operation identities. If that continuation stops, use **Import next input** or **Complete reviewed import** on the saved import. Retrying after response loss reopens the same original billing import.

## Allocate and issue the statements

Open **Agency billing**, select the acquired cost inputs and the existing usage inputs, agency directory and allocation policy, then prepare the month. The original billing workflow handles unresolved rows, policy revisions, review, finalization, adjustments, restatements and printable agency statements. BILLING_GUIDE.md explains those operations in full.

Each Azure-backed billing import freezes the exact source revision, review revision, manifest digest, selected native partition digests, native headers and batch mapping. Its original amount and currency selection must match the saved review. Ordinary CSV/ZIP imports without Azure origin keep their existing identity and replay behavior.

A finalized statement package carries:

- The original imported cost ZIP and normalized input.
- The exact native manifest under sources/azure/<manifest-digest>/manifest.json.
- Every selected native partition, including its original Gzip or Parquet bytes.
- The frozen review and currency/member-to-native-row mapping.
- Original policy, agencies, usage, allocation, accounting workbook and agency statements.

Refreshing a connection or acquiring a later Azure edition does not change these files. A correction goes through the original billing restatement workflow with explicitly selected replacement inputs.

## Send the source and reopen it

Use **Prepare portable source handoff** from a saved source review, or choose a complete source and optional saved review under **Receiving & handoff** and press **Prepare complete source handoff**. Preparation starts building ordinary numbered ZIPs. If the continuation stops, use **Build next volume** or **Build all source volumes** on the saved delivery. Each volume contains the complete receiving descriptor and its declared file segments. Download every numbered volume.

On the receiving operator, select the ZIPs in **Original receiving ZIP volumes**, then press **Receive selected volumes**. Volumes may arrive in any order; repeat delivery reopens the same saved receipt. The receiver checks every declared file hash/length, joins the complete objects, and matches the source partitions against the native manifest. The source keeps its manifest-derived ID and the sender's original source reference.

Open the received source and **Restore received mapping**. This re-runs the saved mapping through the installed native billing parser against the received original files and creates a local review. Then prepare/import the original billing inputs. The recipient chooses its existing agency and usage records in Agency billing.

For a complete workspace move, use **Handoff & recovery** or the original commands:

~~~sh
python BI_OPERATOR.py --workspace ./agency-workspace backup ./agency-workspace.bi-backup
python BI_OPERATOR.py restore ./agency-workspace.bi-backup ./restored-agency-workspace
python BI_OPERATOR.py --workspace ./restored-agency-workspace serve
~~~

The encrypted backup preserves every revision, source chunk, operation ID, billing statement and portable volume. Restoration uses a new destination and rotates browser access while retaining business identities.

## Structured operations

Use the original CLI, supplying a stable operation_id in each request JSON:

~~~sh
python BI_OPERATOR.py --workspace ./agency-workspace action azure.profile.save profile.json
python BI_OPERATOR.py --workspace ./agency-workspace action azure.source.advance next-range.json
python BI_OPERATOR.py --workspace ./agency-workspace state
~~~

Example next-range.json:

~~~json
{
  "operation_id": "azure-monthly-source-transfer-005",
  "id": "azure_source_<retained-manifest-id>",
  "expected": 7
}
~~~

Use the returned revision for the following step. Replay the same operation ID and body after a lost response; use a new operation ID for a new step. The optional chunk_bytes field chooses 256 bytes through 4 MiB for a slow-link transfer; the default is 4 MiB.

| Operation | Required selection |
| --- | --- |
| azure.profile.save | scope, container_url, credential references; id/expected for an edit |
| azure.discovery.start | profile_id, category exports/runs/blobs; export_id for runs, optional prefix |
| azure.discovery.advance | id, expected |
| azure.run.prepare | profile_id, export_id, period |
| azure.run.submit / azure.run.refresh | id, expected |
| azure.run.select | id, expected, native_run_id from retained history |
| azure.source.select | profile_id and manifest_path, or run_id/run_revision |
| azure.source.import | filename/base64, manifest_path, optional archive_prefix |
| azure.source.receive | id, expected, partition index, native_name, filename/base64 |
| azure.source.bind | id, expected, profile_id for the same native container |
| azure.source.advance / cancel / resume | id, expected |
| azure.source.review | source_id/source_revision, period, basis, allocation_view, invoice_status, date_format, columns, note |
| azure.import.prepare | review_id/review_revision |
| azure.import.advance | id, expected |
| azure.handoff.prepare | source_id/source_revision, optional review_id/review_revision |
| azure.handoff.advance | id, expected |
| azure.handoff.receive | filename/base64 of an original numbered volume |

Original authenticated GET /api/azure/preview accepts id, optional revision, partition, offset and limit. Entity/history/object downloads continue to use the original native host routes.

## Capacity and supported source boundaries

A manifest is at most 4 MiB, with up to 1,000 native partitions and 8 GiB declared total source bytes. Each original or decoded partition is at most 64 MiB and 250,000 rows. Individual billing input ZIPs retain the original engine's complete expanded-file and row limits. Portable volumes carry at most 40 MiB of segments, plus their descriptor and small opening files, and receive within a 48 MiB expanded limit.

Keep the provider's partitioning enabled for large exports. Choose a narrower native export when one source partition exceeds the installed per-file capacity. The source remains explicit about every file required for completeness.

## Native API sources

The installed Azure export path uses these original Microsoft contracts:

- [Exports — List, 2025-03-01](https://learn.microsoft.com/en-us/rest/api/cost-management/exports/list?view=rest-cost-management-2025-03-01)
- [Exports — Execute, 2025-03-01](https://learn.microsoft.com/en-us/rest/api/cost-management/exports/execute?view=rest-cost-management-2025-03-01)
- [Exports — Get Execution History, 2025-03-01](https://learn.microsoft.com/en-us/rest/api/cost-management/exports/get-execution-history?view=rest-cost-management-2025-03-01)
- [Azure Storage — List Blobs](https://learn.microsoft.com/en-us/rest/api/storageservices/list-blobs)
- [Azure Storage — Get Blob](https://learn.microsoft.com/en-us/rest/api/storageservices/get-blob)
- [Improve exports and native partition manifests](https://learn.microsoft.com/en-us/azure/cost-management-billing/costs/tutorial-improved-exports)

The Azure source path uses Python’s standard transport and the original billing engine. This release also includes the complete Cognos, Power BI, Report Server, SQL Server, support and full-workspace recovery flows.
