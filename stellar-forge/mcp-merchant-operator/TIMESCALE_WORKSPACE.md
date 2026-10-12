# Timescale agent workspace and complete receiving

This entry connects the existing Timescale operations project to the merchant MCP host and installed Applications. A configured project has one Timescale model, its original PostgreSQL publisher and one publisher scheduler. The agent, browser, saved refresh plans, publication review and customer downloads use those same owners.

The native implementation remains in [postgres/timescale](../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/README.md). It captures full native editions, compares changes, operates reviewed refresh/job plans, verifies complete aggregate results and publishes the selected projection. This guide covers the usable host, agent and receiving path.

## Install and bind an existing project

Use a current Node runtime with node:sqlite, the original PostgreSQL driver declared in the retained package, and Linux util-linux flock. The selected database must already have its native TimescaleDB extension. The maintained operations use TimescaleDB 2.30.2’s actual refresh options and job API. Source and maintenance connection values stay in the host environment; the project retains only their original environment references and public CA files.

Choose a writable private directory under your own account:

~~~sh
umask 077
mkdir -p "$HOME/timescale-operations"
cd "$HOME/timescale-operations"
~~~

Prepare the source and, when native maintenance is needed, the maintenance declaration with the existing PostgreSQL source schema. The complete native guide describes the required information-view permissions, original TLS modes and role separation. Initialize the original project once:

~~~sh
starforge dataset-timescale init \
  --directory "$PWD/project" \
  --source "$PWD/read-source.json" \
  --maintenance-source "$PWD/maintenance-source.json" \
  --target "$PWD/dataset" \
  --title "Usage operations"
~~~

An already initialized project is reused directly. Stop a separately running native project CLI/browser before opening that same project through its merchant host. The installed agent becomes its one owner; it does not attach to a second concurrently opened publisher.

Create a private publisher connection file, replacing the example directory with the exact absolute project directory:

~~~json
{
  "schema": "stellar-forge.merchant-publisher-connection.v1",
  "workspaces": {
    "usage": {
      "label": "Usage publisher",
      "kind": "timescale",
      "directory": "/home/operator/timescale-operations/project"
    }
  }
}
~~~

Create a separate private Timescale connection file:

~~~json
{
  "schema": "stellar-forge.timescale-workspace-connection.v1",
  "workspaces": {
    "usage": {
      "label": "Usage operations",
      "publisher": "usage"
    }
  }
}
~~~

The Timescale alias points to an existing publisher alias. Its normalized configuration binds the project’s persistent UUID and canonical original directory. A project and its nested PostgreSQL publisher cannot also be registered as two independent publisher owners. Up to 32 distinct projects can be declared.

Initialize the merchant through the original source-owned provider registry. The JSON options file uses absolute paths:

~~~json
{
  "directory": "/home/operator/timescale-operations/merchant",
  "publishers": "/home/operator/timescale-operations/publishers.json",
  "connection": "/home/operator/timescale-operations/timescale.json",
  "name": "Usage operations"
}
~~~

~~~sh
starforge merchant-providers init timescale-workspaces \
  --options "$PWD/merchant-setup.json"
~~~

The initializer validates both declarations before creating the merchant directory, its original release store and private customer-export directory. It writes merchant-mcp.json containing publisherConnection and timescaleWorkspaceConnection. You can pass an already initialized releaseStore in the setup options to reuse that original store. Keep the merchant directory beside the project so full project exports cannot recursively include their own output.

For an existing merchant, add the two original connection references to its maintained host configuration through that host’s normal setup workflow. Do not overwrite another provider’s settings. The generic provider reader resolves the Timescale declaration after its publisher declaration.

## Open one browser and agent host

Set the existing MCP_ACCESS_TOKEN environment variable to a private host token of at least 24 printable ASCII characters. Do not put its value in command arguments, project files, tool calls or shared messages. A private Applications environment JSON can supply the same host environment.

~~~sh
starforge timescale-agent inspect \
  --config "$PWD/merchant/merchant-mcp.json" --workspace usage

starforge timescale-agent serve \
  --config "$PWD/merchant/merchant-mcp.json" --workspace usage \
  --port 0 --mcp-port 0 --token-env MCP_ACCESS_TOKEN
~~~

Inspection opens no publisher or scheduler. It returns the exact three configuration-file identities, persistent workspace identity and bindingSha256. Serve accepts --expected-binding-sha256 to enforce a previously inspected selection. It rereads the declarations around startup, opens the original MerchantPublisher once and borrows that same model and scheduler for the browser.

The single startup line contains schema stellar-forge.timescale-agent-workspace-startup.v1 and status TIMESCALE_AGENT_READY. It includes the original configuration binding, workspace UUID, adapter/publisher process instance IDs, browser URL and MCP URL. It contains no credential values. Port 0 selects an available loopback listener.

In installed Applications, select **Timescale merchant workspace**. Choose the existing merchant configuration, Timescale alias, optional MCP port, token environment name and private environment file. Review and save the actual input fingerprints, then use the original Start/Open/Stop/reopen controls. Applications retains its normal command resource lock; the dedicated entry runs the same timescale-agent command. Its startup observer checks the original command, configuration digest, persistent/project process identities and the two selected local listeners.

The browser shows the native Timescale workflow above the original PostgreSQL publisher. An enabled saved publisher schedule belongs to that same owner. Closing only the browser or borrowed Timescale adapter leaves the publisher and scheduler open; closing the merchant owner drains them and releases the project lease.

## Agent workflow

There are 21 Timescale tools, grouped below. Original merchant_publisher tools remain available for the publication workflow.

| Tools | Native operation |
| --- | --- |
| merchant_timescale_status, open, close | Declared project selection, current process identity and borrowed lifetime |
| merchant_timescale_capture, edition | Complete source capture and paged exact native catalog/table inspection |
| merchant_timescale_compare, review | Complete edition comparison and one decision for every native change |
| merchant_timescale_refresh, verify | Prepare/run exact native refresh plans and compare complete original aggregate results |
| merchant_timescale_job | Prepare/apply the original job settings |
| merchant_timescale_publication | Select a retained aggregate projection and start its original publisher extraction |
| merchant_timescale_operation, plan, record | Continue by original request/plan identity and inspect retained native results |
| merchant_timescale_file, file_release | Complete source-edition and result-file bytes |
| merchant_timescale_browser | The same original browser listener |
| merchant_timescale_export, export_manifest, export_file, export_file_release | Complete native project export and original retained-file receiving |

Open with the host alias:

~~~json
{"workspace":"usage"}
~~~

merchant_timescale_open returns the persistent workspaceId and current instanceId/publisherInstanceId. Every subsequent selected Timescale call carries workspace and workspaceId. Process IDs are additionally required when closing that exact borrowed resource.

Status without a workspace lists configured projects and does not open them. Status with the alias returns the original current version and paged editions, operations, plans, reviews and events. Native database counters, decimal text and timestamps remain strings in source tables. The browser and agent do not reinterpret them as JavaScript numbers or dates.

### Capture and inspect complete editions

Call merchant_timescale_capture with one retained UUID, the current expectedVersion, title and purpose:

~~~json
{
  "workspace": "usage",
  "workspaceId": "11111111-1111-4111-8111-111111111111",
  "requestId": "22222222-2222-4222-8222-222222222222",
  "expectedVersion": 0,
  "title": "Before the usage refresh",
  "note": "Retain the original aggregate, source and job configuration."
}
~~~

The UUIDs and version above illustrate the shape; use the actual open/status values and your own saved request UUID. The call acknowledges the original durable operation immediately. Read merchant_timescale_operation with action inspect and the same requestId until its retained state returns. A COMPLETE capture exposes editionId, original file digest, byte count and aggregate count.

Use merchant_timescale_edition with editionId to page its aggregate catalog. Select table to page one original native table instead. offset and limit retain normal positional paging; the result includes total and nextOffset. Each aggregate exposes its key, exact definition digest, columns and source time dimensions. Source tables include their original column descriptors and string/null row cells.

The complete edition file is independently readable through merchant_timescale_file with kind edition, id equal to the capture UUID and expectedSha256 equal to the original edition digest. Paging the catalog never substitutes a small sample for the retained full source.

### Prepare, execute and inspect native plans

merchant_timescale_refresh uses action prepare with requestId, expectedVersion and plan. The plan selects the exact editionId/editionDigest, aggregateKey, timeColumn, native timeType, start and exclusive end, optional timezone, title, owner and note. Native values are explicit strings.

Its optional native settings are force, bucketsPerBatch, maxBatches and newestFirst. The original model validates the current database procedure and exact target/definition. Timescale’s batched refresh runs outside an explicit transaction; bucketsPerBatch 0 requests the supported single atomic window. No wrapper changes those semantics.

After the prepared operation completes, read merchant_timescale_plan with its planId and inspect the entire plan and digest. Execute action run with a new retained requestId, current expectedVersion, planId and planDigest. Acknowledgement means that the native operation was accepted into its original journal. Inspect the same operation for its actual outcome.

merchant_timescale_verify uses that saved refresh or projection plan. Its native read-only repeatable-read transaction locks the selected view before metadata reads and checks the current definition, target and complete row differences. Both directions use EXCEPT ALL, preserving duplicate rows. Exact text uses C collation. The result retains counts, matches and its complete native file; it is not a sampled comparison.

Job changes use merchant_timescale_job with action prepare, exact source edition and native string jobId, changes, title, owner and reason. Supported original fields are schedule_interval, max_runtime, max_retries, retry_period, scheduled, config, next_start, fixed_schedule, initial_start and timezone. Intervals/timestamps stay native strings; config is the exact intended JSON text; omitted fields remain unchanged. Read the saved plan before action apply. A source read role and maintenance role may differ, while the mandatory database identity must match and any available native cluster identifiers must agree.

### Compare editions and assign all changes

Capture an after edition, then use merchant_timescale_compare with beforeId and afterId. The returned comparisonDigest binds the complete comparison, including changes outside the current page. Read every page before assembling the review.

merchant_timescale_review retains requestId, expectedVersion, both edition IDs, comparisonDigest, reviewer, purpose and decisions. Each decision has changeKey, decision ACCEPT/REMEDIATE/DEFER, owner and note. The native model requires exactly one decision for every complete comparison change. The wrapper does not turn a partial page into a complete review.

### Publish through the existing publisher

merchant_timescale_publication action select takes a retained selection with the exact edition, aggregate, time column/type/window and ordered columns. The original model saves that declaration into its PostgreSQL publisher and returns a retained projection plan plus publisherPlanId.

Read the projection plan, then call action extract with its planId/planDigest, a new request UUID and the current version. The native extraction uses that UUID as the original publisher run ID. On a retained response recovery, the same existing run is reused.

Continue through the original merchant tools:

1. merchant_publisher_inspect selects publisher, runId and an optional original query string.
2. merchant_publisher_review requires the exact inspected candidateDigest, reviewer and note. initialize:true applies only to the original absent target; a refresh retains its current snapshot/revision contract.
3. merchant_publisher_publish uses that runId and the exact reviewId returned by review.
4. merchant_publisher_recover resolves an original uncertain publication before another explicit publication attempt.
5. The original buyer-offer, buyer-prepare, buyer-read and scheduler tools use the same publisher alias and retained run.

There is no second seller, source capture engine or payment protocol. Buyer preparation produces the existing handoff. It does not itself sign or settle a payment.

## Retained outcomes and interruption

Keep the original request UUID and full input together before sending a mutation. Use the same UUID and unchanged input for an explicit continuation. expectedVersion is a current selection guard; the native request binding excludes it so the original known request can be recovered after the project’s version advances.

The model’s saved states are RUNNING, DISPATCHING, COMPLETE, FAILED, INTERRUPTED and OUTCOME_UNKNOWN. A read/export interrupted before completion can be explicitly continued under its original request and input. A native maintenance call whose dispatch outcome is unknown is retained as OUTCOME_UNKNOWN; repeating that UUID returns that same original outcome. Inspect current native state and the retained pre-dispatch/result evidence before choosing any genuinely new operation.

merchant_timescale_operation action cancel targets only the original currently active request. It does not start a new call. A lost response is resolved with action inspect, not by inventing another UUID. Browser control and agent control share that journal and the same model admission.

Use merchant_timescale_record to inspect a saved native result or before-dispatch record. It reports the exact file descriptor and named native tables; table pages preserve all original string/null cells. merchant_timescale_file selects kind result or before for the complete bytes. It takes the known source digest, exact offset and an optional retained readId. The original reader hashes the opened immutable descriptor, closes it on EOF/error/release/idle/owner shutdown and rejects changed bytes.

## Receive every original project file

Start merchant_timescale_export with the alias, persistent UUID, original requestId and current version. The host chooses its own output path under the configured private customer-export directory. Agents cannot supply an arbitrary output path. The original model exports under its own admission lock, preserving all source editions, native records, plans, reviews, events, publisher history and referenced dataset generations. SQLite databases use the original consistent native export, while ordinary retained files keep their exact bytes.

After that operation is COMPLETE, merchant_timescale_export_manifest returns the complete download manifest’s SHA256 and the original native manifest SHA256. This is a file view over the already completed native export. It creates no second database snapshot.

~~~sh
starforge timescale-download inspect \
  --url http://127.0.0.1:8447/ \
  --workspace usage --workspace-id ORIGINAL_WORKSPACE_UUID \
  --export-id ORIGINAL_EXPORT_UUID

starforge timescale-download receive \
  --url http://127.0.0.1:8447/ \
  --workspace usage --workspace-id ORIGINAL_WORKSPACE_UUID \
  --export-id ORIGINAL_EXPORT_UUID \
  --expected-manifest-sha256 ORIGINAL_DOWNLOAD_MANIFEST_SHA256 \
  --directory "$HOME/timescale-operations/received-package"
~~~

Use the actual printed MCP endpoint. HTTPS endpoints and the original HTTP loopback listener are supported by the maintained client. The bearer token stays in the selected host environment. The client initializes the existing MCP session and calls only retained manifest/file/release tools.

The download includes native manifest.json and every original file in its manifest, with the original nested paths and empty directory inventory. It uses the existing immutable descriptor reader, file-size/hash checks, chunk offsets, directory lease and durable checkpoint. Repeating the same endpoint/workspace/export/digest/directory continues that original receiver. A changed identity or digest fails explicitly; existing completed files are not relabeled.

The complete download manifest supports the native package’s 64 MiB ceiling. Its original checkpoint allowance is sized for the complete file inventory. Individual files use the maintained immutable reader’s 8 GiB ceiling; larger files fail without a partial “complete” result. Current publisher CSV extraction is bounded by its native 256 MiB contract. There is no silent truncation of files, directories or data. Cancellation remains available during original checksum/transfer operations, and all final files are verified against their complete original digests.

For an in-process client, import downloadTimescaleExport or inspectTimescaleExport from the installed ./merchant/mcp/timescale/download export. Pass the same options plus client:{endpoint,call} instead of url. The existing trusted client’s call returns the native structured tool result. The wrapper retains workspace identity while the original receiver owns transfer, prefix verification, manifest validation and file publication.

## Reopen the portable native project

After download completion, inspect the original native package with its native manifest digest, not the derivative download-manifest digest:

~~~sh
starforge dataset-timescale inspect-package \
  --package "$HOME/timescale-operations/received-package" \
  --digest ORIGINAL_NATIVE_MANIFEST_SHA256
~~~

Write the original receive request in a private JSON file:

~~~json
{
  "requestId": "33333333-3333-4333-8333-333333333333",
  "packageDirectory": "/home/operator/timescale-operations/received-package",
  "expectedDigest": "ORIGINAL_NATIVE_MANIFEST_SHA256",
  "directory": "/home/operator/timescale-operations/reopened"
}
~~~

~~~sh
starforge dataset-timescale receive --input "$PWD/receive.json"
~~~

The original receiver validates every declared file and creates a separate working project. It rewrites only the current workspace/publisher runtime bindings to the new project/dataset paths. Original source declarations, edition/result bytes, retained plans and history stay in the package and original records. Supply the existing environment values on the receiving host.

The receive result identifies the new workspace directory and target directory while retaining the original persistent workspace UUID. Repeating its completed request UUID/digest returns that same receiving outcome even after the old input package is unavailable. Point a new private publisher connection at the returned project directory, initialize or select its merchant host and reopen through timescale-agent or Applications.

The immutable received package and reopened working copy have different roles. Preserve the package as the exact handoff; subsequent captures, plans and publications occur in the working project through its native owner.

## Source and native operation

The source-owned distribution contribution is distribution/contributions/timescale.json. It registers dataset-timescale, timescale-agent, timescale-download, the native demonstration command, complete SDK exports, the original PostgreSQL dependency manifest, browser assets and both source-owned provider declarations. It does not add central catalog/observer branches or a new installer.

The [native demonstration](../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/native-demo.mjs) operates one explicitly isolated original Timescale2.30.2 namespace with retained input rows. It performs native hypertable/aggregate/policy creation, refreshes, complete comparisons, a job change, exact large-decimal extraction/publication and native export/receive/reopen. Its HTTP read is explicitly labeled separately from browser DOM execution. Completed native results are reported by their actual retained operation and source pin; merely installing the source or opening an agent host is not a claim that a database operation or payment occurred.

Native protocol sources: [Timescale2.30.2 refresh API](https://github.com/timescale/timescaledb/blob/2.30.2/sql/ddl_api.sql), [job API](https://github.com/timescale/timescaledb/blob/2.30.2/sql/job_api.sql), [PostgreSQL repeatable-read locking](https://www.postgresql.org/docs/17/sql-lock.html) and [collation semantics](https://www.postgresql.org/docs/17/collation.html).
