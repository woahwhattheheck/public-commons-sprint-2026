# Wherobots in the shared merchant operator

The Wherobots provider attaches the original Python workspace to the existing Starforge merchant host. Its saved SQLite records, official SDK runtime, content objects, browser and portable handovers remain the same application. The installed package includes the complete Python source, browser files, original receiving fixtures, SDK source identity and source licenses.

## Prepare an existing workspace

Use the original operator to initialize or reopen the workspace and read its actual identity:

~~~sh
starforge wherobots --python /absolute/runtime/bin/python3 --workspace /absolute/customer-workspace init
starforge wherobots --python /absolute/runtime/bin/python3 --workspace /absolute/customer-workspace state --offset 0 --limit 20
~~~

The equivalent source command is `python3 operate.py --workspace /absolute/customer-workspace …`. Install the original dependencies from `requirements.txt` into the selected Python runtime. Keep the returned `workspace_id`; the merchant checks it on every Python operation.

The original `serve` command opens the same workspace in the browser. The native workflow form saves and reviews an existing account, region, runtime and original script. A retained-source collection opens its complete source manifest, script, four dataset definitions, editions, comparisons and original-file downloads.

## Declare the private connection

Save a private JSON file owned by the account running the host, using owner-only file permissions. Its containing workspace and host export directories must also be owner-only. Each alias selects one existing initialized workspace. Paths in this connection are resolved relative to the connection file.

~~~json
{
  "schema": "stellar-forge.wherobots-workspace-connection.v1",
  "workspaces": {
    "spatial": {
      "label": "Spatial receiving workspace",
      "directory": "/absolute/customer-workspace",
      "workspaceId": "COPY_THE_ORIGINAL_WORKSPACE_ID",
      "python": "/absolute/runtime/bin/python3",
      "inputs": {
        "customer-intake": {
          "kind": "intake",
          "file": "./inputs/customer-workflow.json",
          "sha256": "COPY_THE_COMPLETE_ORIGINAL_FILE_SHA256"
        },
        "source-script": {
          "kind": "script",
          "file": "./inputs/original-job.py",
          "sha256": "COPY_THE_COMPLETE_ORIGINAL_FILE_SHA256"
        },
        "received-handover": {
          "kind": "handover",
          "file": "./inputs/complete-handover.zip",
          "sha256": "COPY_THE_COMPLETE_ORIGINAL_FILE_SHA256"
        }
      }
    }
  }
}
~~~

Replace the identity markers with the actual original values. The connection accepts 1–32 distinct workspace aliases. Each workspace may declare up to 32 named inputs. Input kinds are `source`, `script`, `intake` and `handover`; each includes its original SHA256 and may additionally pin `bytes` and provide a `label`. The host inspects the complete input when it is used.

Optional `profile` selects the original private operator profile described in README.md. Optional `pythonPath` lists up to eight existing module directories for the selected runtime. The official SDK and AWS clients use that process's existing credential environment and profile chain. A native submission uses the reviewed original organization, region, script and runtime.

## Attach to the merchant host

For an existing host, add the connection path to its existing private configuration:

~~~json
{
  "wherobotsWorkspaceConnection": "/absolute/wherobots-connection.json"
}
~~~

For a new host attachment, save setup options:

~~~json
{
  "directory": "/absolute/new-wherobots-merchant",
  "connection": "/absolute/wherobots-connection.json",
  "name": "Spatial receiving operations"
}
~~~

Then use the maintained provider commands:

~~~sh
starforge merchant-providers inspect wherobots-workspaces
starforge merchant-providers init wherobots-workspaces --options /absolute/setup-options.json
~~~

The initializer creates the merchant configuration, the original SF82 release store and the private customer-export directory around the declared existing workspace. Use the returned configuration with the original merchant operator's stdio or local HTTP launch workflow.

The source contribution is `distribution/contributions/wherobots-workspaces.json`, relative to `stellar/scf-starforge-20261009`. Its `merchantProviders` entry loads this product's `merchant-definition.mjs`. Metadata discovery loads the tool declarations; the original runtime is attached when configured and used.

## Operations

All merchant tools use the prefix `merchant_wherobots_`. The workspace selector is the declared alias, such as `spatial`.

| Tools | Original application behavior |
| --- | --- |
| `status`, `open`, `close`, `inputs` | Inspect declared identities and input hashes; attach to the original workspace; drain accepted calls and file reads. |
| `state`, `get`, `list`, `events` | Read saved records, exact revisions and complete event history. |
| `runtime`, `logs` | Inspect the selected original SDK runtime and page any retained native log capture. |
| `import_source`, `adopt`, `save_workflow` | Retain the named original files, adopt unchanged customer intake and save the complete workflow definition. |
| `review`, `submit`, `recover`, `refresh`, `cancel`, `capture` | Operate the reviewed native job and receive all selected output parts into durable editions. |
| `rows`, `compare` | Page complete typed datasets and compare the full original and corrected editions. |
| `export`, `export_dataset`, `export_status` | Freeze a named complete workflow handover or source-bound SF30 dataset and reopen its exact manifest. |
| `file`, `file_release` | Receive exact export files or original content objects in resumable chunks and release the retained read. |
| `import` | Import a named complete original or corrected handover into the selected existing workspace. |

There are 27 merchant tools. The original Node/Python workspace exposes 21 operations, including `inspect_export` for a local complete export. `state` and `list` default to pages of 20 in the merchant. Follow `next_offset` for every requested record collection and row page, and use the original event cursor for history.

A customer intake maps each original source ID to its declared input alias. `adopt` also takes `input_sha256` and the original account selection. `import_source` and `import` require the selected named input's `expected_sha256`. Complete file bodies stay in the original content store.

## Review and run

Read the workflow and retain its `revision_sha256`. Supply that exact revision and a stable `operation_id` to `review`. Submit that reviewed operation and continue `recover`, `refresh`, `logs` and `capture` against the same saved ID.

The original SDK adapter saves the prepared submission before dispatch, retains the returned native run immediately, reconciles a lost reply through the original run listing and validates the original script, arguments, environment, account and runtime. Output receiving retains all original listing pages, selected versions or ETags, response metadata and complete objects. Each declared object and byte limit comes from the reviewed workflow.

Capture resumes its retained progress. A corrected refresh receives its own edition and can be compared against the earlier complete dataset.

## Durable complete exports

Create a stable export ID and use the saved workflow revision:

~~~js
const manifest = await merchant.call("merchant_wherobots_export", {
  workspace: "spatial",
  workflow_id: originalWorkflow.id,
  expected_revision: originalWorkflow.revision_sha256,
  export_id: "original-customer-handover"
});
~~~

A dataset export instead takes the actual `edition_id`, `dataset_id` and edition revision. It contains the complete CSV, dataset configuration, source manifest, package inventory and every retained original companion object. The maintained SF30 loader consumes `dataset.json`; SF82 reads the full original `sourceFiles` descriptors from `source.json`.

The export request is saved before the original exporter runs. Its named ID is bound to the selected workspace, operation, IDs and revision. A completed export keeps its own bytes after subsequent workspace edits. Reusing that export ID with a different selection reports a conflict. If the host stops after the native archive is installed, reopening the same request inspects the complete existing archive and publishes its original manifest.

`export_status` returns that complete manifest. Each file includes its exact path, byte count, SHA256 and content type. The manifest also retains the selected native package identity and its own canonical `manifest_sha256`.

Read each file using its exact inventory path and hash:

~~~js
const chunk = await merchant.call("merchant_wherobots_file", {
  workspace: "spatial",
  kind: "export",
  export_id: manifest.export_id,
  file: manifest.files[0].path,
  expected_sha256: manifest.files[0].sha256,
  offset: 0,
  limit: 65536
});
~~~

Continue using the returned `read_id` and `next_offset`. The response retains the shared reader's original fields as well as these aliases. After a process restart, reopen the same unchanged file and expected hash at the saved offset. Verify the final complete file digest and byte count against its original manifest.

The shared retained-file reader owns the original read-only file descriptor, enforces its full immutable identity and supports release, workspace closure and host shutdown. The host streams original files within its existing retained-file limits. Closing drains accepted Python calls and these read sessions; reopening attaches to the saved application.

## Local export recovery and receiving

The original CLI accepts the same saved revision and stable export selection:

~~~sh
python3 operate.py --workspace /absolute/customer-workspace export workflow-id /absolute/handover.zip \
  --expected-revision ORIGINAL_REVISION --export-id original-customer-handover --reuse-existing
python3 operate.py --workspace /absolute/customer-workspace inspect-export workflow /absolute/handover.zip
python3 operate.py --workspace /absolute/receiving-workspace import /absolute/handover.zip \
  --expected-sha256 ORIGINAL_COMPLETE_ARCHIVE_SHA256
~~~

Use `inspect-export dataset /absolute/dataset-directory` for a complete SF30 package. Original archive/member hashes, workflow identity and source binding are checked before recovery succeeds.

See README.md for the browser, native workflow and original runtime. OUTPUTS.md documents typed values, geometry, full comparisons, original source parts and customer receiving. `interoperability/native_receiving.py` operates the original retained GeoParquet and CSV fixtures through all four datasets, first and corrected editions, complete comparison, SF30 delivery and independent workspace reopening.
