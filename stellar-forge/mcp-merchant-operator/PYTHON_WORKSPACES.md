# Python workspace authoring through merchant MCP

This adapter opens the original saved Python merchant workspace. An agent can inspect and edit retained source, run explicit Python previews, manage native SF82 releases, and deliver the complete saved application or its original customer SDK. The browser, CLI and MCP tools share the same immutable revisions, SQLite history, preview records, release store and customer files.

The host selects existing workspaces and runtime settings. Tool callers select configured aliases and retained record IDs. Opening a workspace does not execute its Python application or start a seller.

## Install and attach an application

Use Node 22.13 or later, the original Starforge package dependencies and the Python interpreter selected by the application's merchant declaration. Create a workspace with the original Python workspace CLI, or import a previously exported portable workspace into a new directory:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/python/workspace/cli.mjs create \
  --workspace /srv/starforge/python/analytics \
  --config /srv/analytics/merchant.json \
  --python-root /srv/analytics \
  --label "Analytics merchant"

node stellar/scf-starforge-20261009/sf30-seller-sdk/python/workspace/cli.mjs import \
  --workspace /srv/starforge/python/imported-analytics \
  --bundle /srv/handoffs/workspace.python-workspace.json
~~~

Creation and import are create-only. Choose one command and a new destination. Import preserves the original revisions, source bytes, preview outputs, release history and customer files. It does not execute old previews or start a seller.

Write an owned private connection file with mode 0600. Each workspace directory must already be an owned private directory with mode 0700 and contain its original workspace.sqlite3. Relative paths resolve against the connection file:

~~~json
{
  "schema": "stellar-forge.python-workspace-connection.v1",
  "workspaces": {
    "analytics": {
      "label": "Analytics merchant",
      "directory": "/srv/starforge/python/analytics",
      "runtime": {
        "port": 8423
      }
    }
  }
}
~~~

The connection accepts 1–32 aliases. Aliases use lowercase letters, numbers, underscores and hyphens, start with a letter or number, and are at most 64 characters. Two aliases cannot attach the same canonical directory. The optional runtime fields are facilitator and allowLocalFacilitator. The facilitator is a host-configured HTTP(S) URL without credentials, query or fragment. Port 0 requests an available local port. Omitting the facilitator retains the original challenge-only seller behavior.

Create a dedicated MCP host:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs init-python-workspaces \
  --dir /srv/starforge/python-agent \
  --python-workspaces /srv/starforge/python-connection.json \
  --name "Python application operator"
~~~

An ordinary merchant initialization can attach the same connection with --python-workspaces. A preexisting configuration can name the private connection in pythonWorkspaceConnection; restart that MCP host to read the changed configuration. Other merchant source forms and attached accounting, receiving, fleet and support work remain available.

Start the authenticated local MCP endpoint. Supply the bearer through the existing environment-variable mechanism:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs serve \
  --config /srv/starforge/python-agent/merchant-mcp.json \
  --port 3211 \
  --token-env MCP_ACCESS_TOKEN
~~~

The listener binds to 127.0.0.1. The token is not written to the merchant configuration, exported application, download checkpoint or console output. The existing stdio transport uses the same operator and tool definitions. Follow STDIO.md when connecting a local desktop agent through stdio.

## Inspect, edit and preview

Call merchant_python_status without workspace to list configured aliases. It reports which are open. Call merchant_python_open with {"workspace":"analytics"} to attach the native model, then merchant_python_revision to inspect its current head, declaration digest, validation, declared functions and source-file page.

Use merchant_python_read to retrieve exact source or declaration bytes. A declaration read selects kind "declaration" and the revision ID. A source read selects kind "source", the revision ID and a file path copied from the revision's retained file list. The response uses the common base64 chunk contract described below; it is not a rendered or reconstructed version of the file.

Save a complete logical change through merchant_python_save. Supply the observed expectedHead and the retained baseRevision, with changed source files, any removed paths and an optional declarationText or entry:

~~~json
{
  "workspace": "analytics",
  "expectedHead": "RETAINED_CURRENT_HEAD",
  "baseRevision": "RETAINED_BASE_REVISION",
  "note": "Add the customer's regional rollup",
  "files": [
    {
      "path": "regional_rollup.py",
      "text": "def total(rows):\n    return sum(row['amount'] for row in rows)\n"
    }
  ],
  "remove": []
}
~~~

Each changed file supplies exactly one of text or base64. Relative source paths must stay inside the saved application. The original model validates and retains the complete revision, including unchanged helpers. A stale expectedHead returns the original conflict; read the new head and compose the intended source change. Saving does not run Python.

merchant_python_restore creates a new head from an older revision and preserves both histories. merchant_python_refresh captures the workspace's originally selected host source as a new revision. A portable import has no invented replacement source directory; inspect refreshAvailable before choosing refresh.

Run an explicit preview by supplying the saved revision, a function declared by that revision, its original JSON input and a durable operationId:

~~~json
{
  "workspace": "analytics",
  "revisionId": "RETAINED_REVISION",
  "function": "regional_rollup",
  "input": { "region": "north" },
  "operationId": "regional-rollup-2026-10-11-01"
}
~~~

merchant_python_preview starts the original model's Python worker. Save the returned preview record ID, then inspect it with merchant_python_history using kind "previews" and that id until it reaches its retained terminal status. Read kind "preview" for its exact output and kind "preview-input" for its retained original input. An equal operationId retry returns the same original operation; it does not rerun the source. A conflicting reuse remains a native operation conflict.

merchant_python_cancel cancels and drains a preview owned by this model handle. Completed records stay completed. Another model handle's live workers are not acquired by opening the same workspace.

## Review and manage a release

1. Call merchant_python_stage with the saved revisionId and a durable release id. The original Python/SF82 implementation retains that exact source and the host-selected runtime settings.
2. Call merchant_python_release_review for that id. The result includes the complete original candidate terms, source/runtime comparison, candidate digest and current release generation. An optional from compares a specific retained release; null compares from no release.
3. Activate with merchant_python_activate, the same id, expectedDigest, expectedGeneration and a concrete reason.
4. Call merchant_python_start with the selected digest and current generation to start the original seller. It does not purchase an endpoint.
5. Inspect status for the owned instanceId. To apply a newly activated version to that running seller, call merchant_python_restart with that instanceId and the freshly reviewed selection digest/generation.
6. To roll back, review the retained target and call merchant_python_rollback with to, expectedDigest, expectedGeneration and reason. Explicitly restart an already running seller to serve the new selection.
7. Call merchant_python_stop with the owned instanceId to drain that seller.

Selection and running version are separate native states. Activation preserves an already running version until restart. Source revisions remain available after rollback. Runtime conflicts and native seller leases remain owned by the original model and SF82 store.

Call merchant_python_customer_export while this handle owns the running seller. Supply a durable id and its instanceId. It generates the original five-file JavaScript, TypeScript and OpenAPI customer handoff. Reusing the same id returns its original retained export. Inspect kind "customers" through history, and read each declared file with kind "customer". No Python preview or paid request runs merely to retrieve those files.

## Deliver the whole saved application

Inspect merchant_python_status for identity.head and release.state.generation. Call merchant_python_export with those values and a durable export id:

~~~json
{
  "workspace": "analytics",
  "id": "customer-handoff-01",
  "expectedHead": "RETAINED_CURRENT_HEAD",
  "expectedGeneration": 3
}
~~~

The provider publishes the original portable bundle once. It retains immutable source, saved histories, native release state and original customer files using the native exporter. The result is:

~~~json
{
  "schema": "stellar-forge.python-mcp-export.v1",
  "workspace": "analytics",
  "workspaceId": "ORIGINAL_WORKSPACE_ID",
  "id": "customer-handoff-01",
  "head": "RETAINED_CURRENT_HEAD",
  "generation": 3,
  "createdAt": "ORIGINAL_EXPORT_TIME",
  "file": {
    "name": "workspace.python-workspace.json",
    "bytes": 123456,
    "sha256": "EXACT_64_CHARACTER_SHA256"
  }
}
~~~

A retry with that export id and its original head/generation returns the same retained bytes, including after later edits. A different head/generation under that id is a conflict; use a new id for a new handoff. merchant_python_export_status verifies the existing manifest and exact archive without reopening the model or rebuilding an export.

Download the original complete export:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs download-python \
  --url http://127.0.0.1:3211/mcp \
  --workspace analytics \
  --export-id customer-handoff-01 \
  --out /srv/handoffs/analytics-01
~~~

The URL must be the actual authenticated MCP endpoint. Use --token-env for a different bearer variable. The bearer never enters the checkpoint or file metadata. The output directory is owned and private (0700); files are private (0600). A Linux flock lease admits one downloader writer at a time.

The downloader fixes the original endpoint, workspace, export id and file digest in its retained metadata. It verifies already completed files and rehashes a checkpointed partial prefix once on continuation. Each accepted chunk is synced before its checkpoint advances. Only an uncheckpointed suffix can be removed during recovery; verified bytes remain. An interrupted command resumes through the same command and directory. Copy the entire directory, including the download-state directory, when moving the handoff between machines.

Provider restarts can retire an in-memory reader. On PYTHON_READ_NOT_FOUND, the downloader requests the same original file with the same SHA-256 and exact offset. Changed files are rejected. A completion manifest is installed atomically and synced; interruption during installation cannot leave a partially written canonical manifest.

--chunk-bytes accepts 1–196608 and defaults to 196608. The shared provider reader permits four concurrent retained reads and a combined 256,000,000-byte snapshot budget. A capacity response leaves the resumable checkpoint intact. The native workspace exporter can retain larger files up to its own 256 MiB limit; use its local export path when the archive exceeds the MCP reader budget.

Download an already-created customer SDK instead by adding --kind customer. This reads the five files declared by the original customer record. The model must be open for customer-history/file access. A later source-head change does not change an existing customer's immutable file metadata or invalidate its completed download.

## Reopen offline

The original portable import is available without a provider connection, bearer or Python execution:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs reopen-python \
  --dir /srv/handoffs/analytics-01 \
  --workspace-dir /srv/starforge/python/customer-analytics
~~~

The destination must be new. The command checks the completed original file and invokes the original create-only importWorkspace implementation. It preserves the workspace's original identity, source head, revision/preview/stage/customer histories, native release selection and original customer files. It reports REOPENED with the original identity and retained counts. The native browser or another MCP host can then open that workspace. Customer-only SDK downloads are complete client files; they are not portable authoring workspaces.

A completed download reports COMPLETE with exact file names, byte counts, digests and resumedBytes. It does not report a new preview, purchase, deployment or remote customer acceptance.

## Tool reference

Every tool accepts workspace except the optional alias listing in merchant_python_status.

| Tool | Core arguments | Original operation |
| --- | --- | --- |
| merchant_python_status | workspace optional | Alias/model/selection/runtime and read status |
| merchant_python_open | workspace | Attach original workspace |
| merchant_python_close | workspace | Drain owned preview/seller and close the model |
| merchant_python_revision | id optional, offset, limit | Revision, declaration metadata and source page |
| merchant_python_save | baseRevision, expectedHead, files/remove, entry/declarationText/note optional | Save immutable source revision |
| merchant_python_restore | revisionId, expectedHead, note optional | Restore as a new head |
| merchant_python_refresh | expectedHead, note optional | Capture original host source |
| merchant_python_history | kind, id or offset/limit | Original revisions/previews/stages/customers |
| merchant_python_preview | operationId, revisionId, function, input | Start or recover one native preview |
| merchant_python_cancel | id | Cancel this handle's preview |
| merchant_python_stage | revisionId, id, label optional | Stage original SF82 release |
| merchant_python_release_review | id, from optional | Inspect complete candidate and comparison |
| merchant_python_activate | id, expectedDigest, expectedGeneration, reason | Select reviewed release |
| merchant_python_rollback | to, expectedDigest, expectedGeneration, reason | Select reviewed retained release |
| merchant_python_start | expectedDigest, expectedGeneration | Start selected original seller |
| merchant_python_stop | instanceId | Stop owned original seller |
| merchant_python_restart | instanceId, expectedDigest, expectedGeneration | Drain and restart owned seller |
| merchant_python_customer_export | id, instanceId | Original five-file customer SDK |
| merchant_python_export | id, expectedHead, expectedGeneration | One complete native portable export |
| merchant_python_export_status | id | Verify existing export |
| merchant_python_read | kind, id, file when applicable, readId/expectedSha256/offset/limit optional | Read exact retained file bytes |
| merchant_python_read_release | readId | Release an owned snapshot |

History/source pages default to 20 entries and allow at most 50. File reads return readId, file metadata, offset, bytesRead, nextOffset, encoding "base64" and data. Source/customer reads also select file; other kinds reject it. Preserve expectedSha256 when supplying a previous readId or nonzero offset. Reads expire after two idle minutes and can be explicitly released.

Closing the MCP provider drains its opened models and original retained readers. It does not install a second workspace lease, take ownership of another browser handle's work, reconstruct exported customer bytes or add another Python execution engine. Parallel handles use the native SQLite compare-and-swap and SF82 lifecycle rules.
