# 360Giving publisher in Applications

The saved publisher is available as **360Giving publisher workspace** in the existing Applications manager. Operators select an initialized publisher directory and its existing Python, save the application, and use its original review, grant queries, comparisons and full receiving workflow from the browser or command line.

The implementation is composed through `distribution/contributions/ndjson-360giving.json`. Its provider is `providers/ndjson-360giving.mjs`, its catalog kind is `publisher-360giving` and its command is `dataset-360giving-workspace`. The same distribution continues to expose the original standalone `dataset-360giving` publisher command.

## Open a saved publisher

Use a READY merchant runtime containing this contribution and the complete 360Giving profile. Python must be 3.11 or newer, with the profile's `requirements.txt` installed. The native dataset engine uses the original installed Node executable.

Initialize a new private publisher directory through the original command, or select a directory already created by the complete receiving workflow:

```sh
node /srv/starforge/source/stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/360giving/operator/cli.mjs \
  --python /srv/starforge/python/bin/python \
  --workspace /srv/starforge/work/publisher init
```

In Applications:

1. Select the READY runtime and **360Giving publisher workspace**.
2. Enter the publisher directory and the existing Python executable. Leave the local port at `0` to allocate an available loopback port.
3. Review and save the application. Connect its original runtime release if the saved application has a pending connection.
4. Review Start, start the saved application and open its browser console.
5. Use the console to retain source editions, save named reviews, build candidates, query full native grant datasets, compare editions and download complete handoffs.
6. Stop through Applications. Reopening the saved application retains the same publisher directory, datasets, reviews and accepted request IDs.

To change which publisher a stopped application opens, edit its workspace setting, review the change and save the new application revision. The next start writes the current connection for that reviewed publisher. A command already running against the former publisher keeps its original workspace guard; a subsequent command follows the newly saved connection.

The source review uses the existing 360Giving editor. Its source figures and proposed corrections remain attached to their original edition and named reviewer. The console uses neutral gray controls and tables.

The private environment file, when selected, uses the existing Applications environment mechanism. `SF30_XML_NODE` can select an existing native Node executable. The same environment is used during preparation and launch.

## Connect command-line work to the open application

Applications writes a private connection file at:

```text
<runtime-workspace>/applications/<application-id>/360giving-connection.json
```

The path remains stable across starts. Each successful start replaces its contents with the current loopback connection, original workspace ID, binding and managed run identity. The command reads that file again for each operation, so scripts can continue using the same file after an application reopens.

Use `--connection` to operate the open publisher:

```sh
node /srv/starforge/source/stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/360giving/operator/cli.mjs \
  --python /srv/starforge/python/bin/python \
  --connection /srv/starforge/manager/applications/APP_ID/360giving-connection.json state
```

The same connected command supports `upload`, `intake`, `review`, `decisions`, `candidate`, `build`, `query`, `native-state`, `compare`, `changes`, `changes-file`, `export`, `receive`, `request` and `resume`. Initialization, binding inspection and starting a standalone console use `--workspace`.

For a query, retain the exact dataset key and native build ID returned by the publisher:

```sh
node /srv/starforge/source/stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/360giving/operator/cli.mjs \
  --python /srv/starforge/python/bin/python \
  --connection /srv/starforge/manager/applications/APP_ID/360giving-connection.json \
  query --dataset fund-key --build BUILD_SHA256 --params '{"limit":"25"}'
```

Native query parameters are scalar strings. Follow the returned `response.body.page.nextCursor` while preserving the original build, filters and page limit. Each response includes the complete selected fields and returned rows.

For complete field changes, use the saved comparison ID:

```sh
node /srv/starforge/source/stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/360giving/operator/cli.mjs \
  --python /srv/starforge/python/bin/python \
  --connection /srv/starforge/manager/applications/APP_ID/360giving-connection.json \
  changes-file --dataset fund-key --comparison COMPARISON_SHA256 \
  --out /srv/starforge/delivery/complete-changes.jsonl
```

This command streams the complete original changes file, verifies its SHA-256 against the saved native comparison and installs the output atomically. An existing identical output is reused.

Mutations retain an operator-selected `--request` ID before execution. Reuse that ID with its original input when retrying. `request --id ID` reads the saved state; `resume --id ID` continues its retained input after an interruption. Accepted work remains in the saved publisher when the connected command closes.

A complete export selects an edition and, where applicable, its exact review and candidate:

```sh
node /srv/starforge/source/stellar/scf-starforge-20261009/sf30-seller-sdk/ndjson/360giving/operator/cli.mjs \
  --python /srv/starforge/python/bin/python \
  --connection /srv/starforge/manager/applications/APP_ID/360giving-connection.json \
  export --edition EDITION_SHA256 --decision DECISION_SHA256 --candidate CANDIDATE_SHA256 \
  --request delivery-fund-20261012 --out /srv/starforge/delivery/fund-complete-handoff.zip
```

Export streams the saved ZIP to the requested path and checks its complete byte count and SHA-256. Receive uploads the complete ZIP and submits the original saved receiving request. Both commands use the same writer and serialized job queue as the browser.

## Complete managed receiving

`360giving-receiving.mjs` operates the entire Applications lifecycle against an existing saved publisher. It is intended for the complete receiving operation and its continuing source record. Its source application and fresh receiving application run sequentially.

Create one private input JSON file. Replace the paths with the actual READY runtime, original completed publisher workspace, installed Python and retained receiving directory:

```json
{
  "schema": "stellar-forge.360giving-managed-receiving-input.v1",
  "runtimeDirectory": "/srv/starforge/runtime",
  "sourceWorkspace": "/srv/starforge/work/publisher",
  "pythonExecutable": "/srv/starforge/python/bin/python",
  "directory": "/srv/starforge/work/receiving/managed-publisher",
  "label": "360Giving complete publisher",
  "queryPageSize": 2,
  "timeoutMs": 180000,
  "pollMs": 500
}
```

The input file must belong to the operating user and be private. Its parent and each selected path must be real absolute paths. The receiving directory has its own private journal. It is separate from the source publisher and runtime. Its parent must already exist.

```sh
chmod 600 /srv/starforge/work/receiving/managed-publisher-input.json
node /srv/starforge/source/stellar/scf-starforge-20261009/distribution/runtime-workspace/360giving-receiving.mjs \
  --input /srv/starforge/work/receiving/managed-publisher-input.json
```

The original two retained SCVO funds can use `queryPageSize: 2` to exercise all cursor pages over their complete five- and seven-grant datasets. For a larger saved publisher, the default page size is `250`. The driver follows every cursor and verifies the reported total against the original native build's row count.

The driver performs these connected operations:

| Stage | Complete behavior |
| --- | --- |
| Runtime connection | Opens its retained manager, attaches the READY runtime, reviews and saves the source application, and connects the original release. |
| Original source | Starts the managed publisher and authenticates its current saved connection. It retains the full publisher state and an export plan covering every saved edition. |
| Full exports | Exports each original edition and every saved review/candidate selection. Each ZIP retains original source and registry inputs, the complete publisher package, native build packets, available full comparisons and the portable publisher source. |
| Complete source observation | Reads every native build through all query pages, writes all returned rows to complete JSONL files, checks an original grant filter and downloads every saved comparison's complete changes file. |
| Source cold reopening | Stops the source application, reopens the original manager and saved application, then compares all publisher metadata, native builds, full rows and full field changes. |
| Fresh receiving | Initializes an independent publisher, saves and starts its application, uploads every full export and adopts the original edition, review, candidate and native build identities. |
| Comparison reconstruction | Recreates every saved comparison, including comparisons between separate editions, from the received native builds. |
| Receiving cold reopening | Stops and reopens the saved receiver, then repeats the complete content comparison. |
| Completion | Stops its recorded application runs and writes the completed managed receiving result with original run, workspace and archive identities. |

Each edition receives an original-source archive. Every saved review is also included, with each candidate derived from that review. Thus the two original funds with one review and candidate each produce four complete archives. Multiple reviews and candidates remain separate selections tied to their original editions.

The driver writes full row files incrementally as it consumes pages. It retains complete changes files through the connected download command. Its comparison is based on source metadata, full native build identities, ordered complete query content and native comparison identities. Reconstructed receiving work keeps its own request history; the original publisher's full state is retained in the observations.

## Continue the same receiving operation

Run the same input file and receiving directory again. The journal retains application-save IDs, start reviews, managed run IDs, publisher mutation IDs, export selections and byte identities before their dependent work.

An interrupted managed run uses the original Applications recovery operation. A completed prior run remains in history; a later intentional start receives its own run ID. An interrupted publisher request resumes its original input. Complete saved exports are reused and checked against their retained SHA-256.

The receiving journal also preserves initial creation intent. If initialization stopped after creating only its own empty directories, the driver completes that initialization. Any retained publisher state remains in its original directory.

SIGINT and SIGTERM close the driver's connected command process and request Stop for its retained managed applications. The original manager owns worker shutdown and recovery. Continue using the same input after the original run has finished closing.

`timeoutMs` controls waiting for a managed lifecycle transition. Its saved identity survives a wait timeout. `pollMs` controls lifecycle observation. These wait settings can be adjusted when continuing; the selected runtime, workspaces, Python, label and query page size remain bound to the retained operation.

## Retained output

The receiving directory contains:

- `receiving-journal.json` — the original operation, complete stage history and saved IDs.
- `applications/` — its existing Applications manager and the source/receiver saved applications.
- `exports/` — every complete verified handoff ZIP.
- `observations/source-original/` and `source-reopened/` — full original state, native row JSONL and comparison files.
- `observations/receiver-original/` and `receiver-reopened/` — the matching complete received content.
- `publisher-received/` — the independently usable received publisher.
- `managed-publisher-result.json` — the final result written after both cold reopenings and Stop operations complete.

The final result records actual completion time, runtime source, original and receiving workspace IDs, saved applications, managed runs, archive identities and complete content SHA-256. The private stable connection files stay with their Applications records.

## Source and launch binding

Preparation invokes the original Python binding command without taking the publisher writer or changing its requests. The binding covers:

- The original private workspace and its immutable workspace marker.
- The selected Python executable, interpreter version and environment location.
- The original Node executable identity.
- The installed JSON Schema dependency version and module bytes.
- The entire portable 360Giving profile and its seven original shared SDK support files.

Applications retains these original source and file identities in its existing reviewed command. Source adoption can relocate the complete source tree while preserving those relative bytes. At launch, the original console checks the expected binding again after acquiring its writer.

The startup observer then authenticates `/api/launch` on the actual loopback console, compares that live record with the original startup announcement and writes the stable connection file for the same saved application revision and managed run.

The connected CLI uses that original private loopback endpoint directly. It verifies the current workspace identity before each operation and streams complete uploads and downloads. The shared Applications manager continues to own runtime adoption, resource exclusion, worker history, Stop and recovery.

## Complete publisher agent receiving

`dataset-360giving-agent-receiving` runs this original saved Applications
lifecycle with the direct typed publisher client, the source-owned publisher
merchant tools, and complete customer file receiving. It exercises the same
request IDs and archives through all four connected source/receiver stages,
including every native query and comparison page, a durable interrupted
download, merchant reopen, receiving with the source stopped, and both saved
publisher cold reopens.

Use the complete input and command in the
[publisher merchant guide](../../../../stellar-forge/mcp-merchant-operator/360GIVING.md).
The selected connected workflow is part of the original receiving journal's
input. A trusted native caller can supply `connectionWorkflow` and `onConnected`
to `runManagedPublisherReceiving`; the callback receives the current saved
connection, original applications, export IDs and receiver request IDs.
A callback completes before that parent stage commits. The CLI input accepts
the declared data fields and retains that same journal for continuation.
