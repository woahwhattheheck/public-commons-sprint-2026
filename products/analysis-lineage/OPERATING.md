# Operate Analysis lineage and complete handover

This product makes a completed analytical result traceable to its retained source and original operations. The operator selects a completed import, query, full query export or workbook in the existing Analysis database. Analysis reviews its actual dependency closure, freezes an exact plan and sends its event source through the original OpenLineage client. The browser and native agent then read the same plan, publication and complete delivery.

## Install the selected product

Choose **Analysis lineage and complete handover** in the Runtime workspace's existing source-build view, or build its committed recipe:

~~~sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/merchant-checkout \
  --ref SELECTED_COMMIT \
  --selection analysis-lineage \
  --out /private/analysis-lineage-release
~~~

Retain the returned archive, full source commit, source manifest and archive SHA256. Continue an interrupted build through that same output and its original `--resume` operation.

Install the actual returned archive through the maintained runtime:

~~~sh
node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs prepare \
  --dir /private/analysis-lineage-runtime \
  --archive /private/analysis-lineage-release/RETURNED_ARCHIVE.tgz \
  --sha256 RETURNED_ARCHIVE_SHA256 \
  --native --feature schema --feature openapi --feature mcp --operator

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs install \
  --dir /private/analysis-lineage-runtime

node stellar/scf-starforge-20261009/distribution/runtime-install-cli.mjs inspect \
  --dir /private/analysis-lineage-runtime --load --source
~~~

The original dependency lock determines the selected package versions. Reuse the installer's existing dependency adoption or offline transfer when that complete runtime is already available. [Runtime installation](../../stellar/scf-starforge-20261009/distribution/RUNTIME_INSTALL.md) documents those operations.

The recipe selects the original Python and OpenLineage Applications providers. It also selects the native MCP commands and the source-owned `mcp-analysis-lineage-download` command. Check these installed registrations with `starforge registrations --source analysis-lineage`. If `starforge` is not on PATH, use the original `runtime-install-cli.mjs run --dir /private/analysis-lineage-runtime --` prefix followed by the same command.

Use an existing private Runtime workspace. For a new one, initialize it once and attach the selected installation:

~~~sh
node /private/analysis-lineage-runtime/package/source/stellar/scf-starforge-20261009/distribution/runtime-workspace/cli.mjs init \
  --workspace /private/runtime-workspace

node /private/analysis-lineage-runtime/package/source/stellar/scf-starforge-20261009/distribution/runtime-workspace/cli.mjs attach \
  --workspace /private/runtime-workspace --runtime /private/analysis-lineage-runtime

node /private/analysis-lineage-runtime/package/source/stellar/scf-starforge-20261009/distribution/runtime-workspace/cli.mjs serve \
  --workspace /private/runtime-workspace
~~~

In **Runtime workspace → Python**, select the actual Python 3.12+ interpreter and this source release, then use the original review, resolution, installation and activation workflow. The complete `stellar_forge_buyer` package and native bridge are part of this selected source. Its standard-library lineage projection and offline reader reuse the already completed analytical files. Select the original extras when the customer also needs to build new workbooks or other analytical outputs.

## Select the original customer database

For an existing Analysis workspace, retain its current private database directory and completed job IDs. If the customer has a complete project ZIP, first use **Applications → Open Analysis project** with its exact archive and the chosen private database. The [project operating guide](../analysis-project/OPERATING.md) covers complete source verification and same-destination receiving.

Stop the project listener through its original Applications operation before opening the same database with **Analysis and workbook workspace**. This entry uses the current installed Analysis implementation, including Lineage. The project receiver continues to preserve the source embedded in the delivered project. Both applications share the original database resource and lease.

Add or edit **Analysis and workbook workspace** with:

| Setting | Original selection |
| --- | --- |
| Installed Python environment | Installation of this selected complete source |
| Analysis database directory | The existing or already received customer database |
| Lineage collector connections | Optional private named configuration described below |
| Original Node executable | Actual compatible Node executable; defaults to the current managed worker's Node |
| Local port | 0 for the original available loopback port |
| Private environment JSON | Existing host environment, when needed |

The selected configuration file is part of the reviewed managed command. Its original `--lineage-connections` argument is passed to Analysis before `serve`. The Analysis module reads its own connection schema and resolves the named collector at use time. The original Applications command binding, release identity, input checks, startup observation and Stop/drain behavior remain in effect.

Read-only plans, receipts and handovers are available when the optional collector configuration is absent. Publication requires the selected complete native runtime and a configured collector.

## Configure the existing OpenLineage collector

Open or continue the customer's original collector through its existing Applications entry or the maintained CLI. For the direct operator command:

~~~sh
starforge openlineage serve \
  --workspace /private/collector --port 0 \
  --token-file /private/collector-operator.token \
  --producer-token-file /private/collector-producer.token
~~~

Use the actual returned `commons.openlineage.startup.v1` record at the collector's `connection.json`. It contains the original workspace UUID, current instance and URL. Keep the original collector directory and producer credential.

Create a private connection file for Analysis:

~~~json
{
  "schema": "stellar-forge.analysis-lineage-connections.v1",
  "connections": [
    {
      "name": "operations",
      "label": "Operations lineage",
      "connection_file": "/private/collector/connection.json",
      "expected_workspace_id": "COPY_THE_ACTUAL_COLLECTOR_UUID",
      "token_file": "/private/collector-producer.token",
      "request_timeout_ms": 30000
    }
  ]
}
~~~

Replace the UUID with the exact canonical value from the current startup record. All selected paths are absolute. The file is caller-owned and private; producer-token contents stay in their original private file. The browser and agent see the configured alias, label, collector identity and availability.

The original bridge rereads the startup file for each attempt and pins the reviewed collector workspace and origin. A restart can change the port on the same numeric-loopback host and protocol. A different destination needs its own review. Follow an uncertain earlier publication at its original destination with the retained source and operation key.

The [original collector guide](../openlineage/OPERATING.md) covers native producers, editions, review, complete customer export and receiving.

## Review, save and publish in the browser

Open the active Analysis application and choose **Lineage**. Select an original completed job from its paged history, or enter that exact job ID. Review the jobs, immutable datasets, native source/output digests, actual recorded timestamps and known dependency boundaries.

A query preview retains its row limit and truncated flag. A full query export uses its complete original files and actual read tables. A workbook keeps its retained query-export or report-publication source. The reviewer chooses whether original SQL text belongs in the outbound source; parameter values and result rows remain outside that event projection.

Choose the existing collector alias, enter a title and review note, and save the plan. Analysis recaptures the original records and checks the reviewed snapshot digest. It stores the exact event bytes, target workspace, source name and producer idempotency key in the same database.

Publish that saved plan. The original Analysis publication job owns the attempt and its result. Preserve its job ID after a lost response; the browser can read the saved plan/job and continue the same request. A collector acknowledgement lost after commit is resolved by the original collector's replay result for that same source and key.

**Stop this local attempt** cancels the actual owned worker. The original plan and any completed native receipt remain in its history. Reopen the same plan to review the observed status and explicitly continue when appropriate.

## Use the same plan through native MCP

Attach the active Analysis database to an existing original native MCP workspace:

~~~sh
starforge mcp-native analysis-register \
  --dir /private/native-mcp --name analysis \
  --database /private/customer/analysis
~~~

Use the original MCP workspace's existing operator binding. If it has not yet been initialized, use `mcp-native init --dir ABS --workspace EXISTING_SF88` with the already configured original SF88 workspace. Keep that same private MCP directory for continuation.

Serve it through its maintained native command and configured access-token environment:

~~~sh
starforge mcp-native serve --dir /private/native-mcp --port 0
~~~

The actual startup result supplies the MCP URL. The existing server requires its `MCP_ACCESS_TOKEN`; the configured client can select the same value from an environment variable. Application capability files and producer credentials stay with their existing hosts.

Every Lineage call uses the original native Analysis envelope:

~~~json
{
  "action": "analysis",
  "analysisWorkspace": "analysis",
  "analysisOperation": "lineage-configuration",
  "analysisRequest": {}
}
~~~

The complete [MCP guide](../../stellar-forge/mcp-paid-agent/ANALYSIS_LINEAGE.md) gives request schemas and examples. The operating sequence is:

| Operation | Result or retained decision |
| --- | --- |
| `lineage-configuration` | Actual configured collector aliases and workspace IDs |
| `lineage-jobs` | Paged original completed jobs |
| `lineage-review` | Snapshot/event digests and paged native dependency metadata |
| `lineage-save-plan` | Exact reviewed source and selected original collector |
| `lineage-plan` / `lineage-plans` | The same saved request and publication state |
| `lineage-publish` / `lineage-publication` | Original publication request, actual progress and native receipt |
| `lineage-cancel` | Cancellation request for that original worker |
| `lineage-downloads` / `lineage-file` | Original file index and complete selected bytes |

Retain the plan ID and SHA, publication job ID and producer operation key separately. Metadata pages preserve their pagination/omission markers. Full SQL, native source documents, event facets and receipt history travel in the complete delivery files.

## Download and reopen the complete handover

Review the exact `lineage-downloads` index. It binds the Analysis workspace, saved plan, event source and seven file descriptors. Use the actual plan and index digests:

~~~sh
starforge mcp-analysis-lineage-download inspect \
  --url "$MCP_URL" --workspace analysis --plan "$PLAN_ID" \
  --token-env MCP_ACCESS_TOKEN

starforge mcp-analysis-lineage-download download \
  --url "$MCP_URL" --workspace analysis --plan "$PLAN_ID" \
  --token-env MCP_ACCESS_TOKEN \
  --dir /private/lineage-delivery \
  --plan-sha256 "$PLAN_SHA256" --index-sha256 "$INDEX_SHA256"

starforge mcp-analysis-lineage-download reopen \
  --plan "$PLAN_ID" --dir /private/lineage-delivery \
  --plan-sha256 "$PLAN_SHA256" --index-sha256 "$INDEX_SHA256"
~~~

The original retained-download engine owns complete byte verification, its durable prefix and exclusive final publication. After an interruption, reuse the same directory and plan/index identities. A saved older file remains bound to its reviewed index after a newer publication observation changes the live index.

The output contains `events.json`, `plan.json`, `native-bindings.json`, `receipts.json`, `report.html`, `manifest.json`, `handover.zip` and the exact `lineage-download-index.json`. The offline reader verifies the handover and exposes its original source records:

~~~python
from stellar_forge_buyer.analysis_lineage_reports import LineagePublication

publication = LineagePublication(
    "/private/lineage-delivery/handover.zip",
    expected_sha256=actual_handover_sha256,
)
print(publication.inspect())
original_record = publication.native_document(original_record_sha256)
~~~

A Lineage handover contains the complete publication source and provenance. Use the original Analysis **Backups** export and receiver to give another operator the editable database, source documents, tables, query exports, workbooks, plans and receipts. The current installed source includes that receiver. Preserve the actual workspace archive and its SHA alongside the Lineage handover, then select the recipient's launcher-side collector references separately.

[RECEIVING.md](RECEIVING.md) identifies the original whole customer journey that composes browser review, actual collector response recovery, MCP prefix continuation, complete export and independent reopen.
