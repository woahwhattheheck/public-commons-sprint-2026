# Source workspaces through the merchant MCP

The source-workspace adapter operates the same private XML or NDJSON console that
an operator uses in the browser. Source intake, mapping, native queries, edition
comparisons and exports run through that console's original HTTP handlers and
retained workspace. An agent can finish a browser-started dataset, and a browser
can inspect an agent's saved source and mapping immediately.

The installed module is `@tokenjunkielabs/starforge-merchant/merchant/mcp/source-workspaces`.
It contributes 18 tools to the existing merchant MCP and uses its current HTTP or
stdio transport. The underlying source console owns the workspace lock, native
dataset worker and application lifecycle.

## Start the original console

Create a private directory for the work and start its original NDJSON console.
Use an existing initialized workspace when continuing a dataset.

~~~sh
mkdir -m 700 ./private
starforge dataset-ndjson --workspace ./private/source init
starforge dataset-ndjson --workspace ./private/source serve \
  --connection-file ./private/source-console.url
~~~

The console writes its original private URL into a 0600 file. Keep the console
running. The browser uses the printed URL; the adapter reads that same URL from
the declared file. Graceful console shutdown removes its connection file only
when the file still identifies that process. A restart can reuse the path and
the MCP reads the new connection on the next call.

For an original XML console, use its existing `dataset xml` source entry and
declare `"format": "xml"`. The environment form below accepts its printed URL,
including the fragment. For either format, a crashed console may leave a stale
connection file: inspect the original process, remove its stale file after it
stops, then restart the same workspace.

## Declare the existing workspaces

Save this connection document as a private file, such as
`./private/source-workspaces.json`, with mode 0600:

~~~json
{
  "schema": "stellar-forge.source-workspace-connection.v1",
  "workspaces": {
    "publisher": {
      "label": "Supplier editions",
      "format": "ndjson",
      "consoleUrlFile": "./source-console.url",
      "files": {
        "current": {
          "kind": "source",
          "path": "./supplier-current.ndjson",
          "label": "Current supplier edition",
          "name": "supplier-current.ndjson"
        },
        "received": {
          "kind": "packet",
          "path": "./received-source-project.zip"
        }
      }
    }
  }
}
~~~

Paths are relative to this connection document. File handles select complete
host-declared source or project files. A source handle can include a reviewed
`sha256`; the adapter verifies the complete file before intake.

Use exactly one `consoleUrlFile` or `consoleUrlEnv` for each alias. The environment
form names an environment variable containing the original private console URL;
the value stays in the MCP host environment. The adapter forwards the console's
existing bearer capability to its exact loopback origin. Tool arguments use
workspace aliases and source handles.

Configure and start the existing merchant MCP:

~~~sh
starforge merchant-mcp init-source-workspaces \
  --dir ./private/source-mcp --connection ./private/source-workspaces.json
starforge merchant-mcp serve --config ./private/source-mcp/merchant-mcp.json
~~~

Set the transport's existing `MCP_ACCESS_TOKEN` environment value before serving.
The ordinary merchant `init` command also accepts
`--source-workspaces CONNECTION_JSON`. To attach consoles to a saved merchant,
add `sourceWorkspaceConnection` to that merchant's configuration with the
connection document's path.

## Operate a complete dataset

1. Call `merchant_source_workspaces`, then `merchant_source_status` for the selected
   alias. The status gives original retained counts. Use
   `merchant_source_inventory` to page sources, plans, builds or comparisons.
2. Ingest a complete declared file with `merchant_source_ingest` and its `file`
   handle. For small documents, `merchant_source_ingest_text` accepts up to
   128 KiB of complete text. The returned `native.id` identifies the original
   source bytes. `merchant_source_inspect` reads its complete field inventory.
3. Save the complete native mapping with `merchant_source_plan_save`. Its
   `definition` is the original XML or NDJSON mapping document, including explicit
   exposed columns, types, source paths, filters, sorts and comparison keys.
   `merchant_source_plan` retrieves the exact saved definition.
4. Call `merchant_source_build` with that source and plan. The original engine
   validates the complete source, produces the native dataset and retains its
   lineage and review. Save the returned build ID.
5. Use `merchant_source_query` with that build and the native query parameter
   object. Parameter values are strings, for example
   `{"limit":"25"}`; use the dataset's declared filter and sort names, then continue its returned
   `page.nextCursor` as `cursor` with the same query selection.
6. Ingest a later edition and build it with the same saved mapping. Call
   `merchant_source_compare` with `before` and `after` build IDs. The original
   mapping's unique keys determine added, removed, changed and unchanged rows.
   Page the complete retained changes with `merchant_source_changes`, following
   `nextOffset` until null.

Every source, mapping, build and comparison comes from the original workspace.
After an interrupted mutation reply, read status and inventory to recover its
content-addressed ID before repeating the change. Inventory pagination returns a
snapshot; repeat it as `expectedSnapshot` on later pages. If another operator
changes the inventory, resume from a fresh page-zero snapshot.

## Deliver and receive the original work

`merchant_source_export` retains one complete native export. Choose:

| Kind | Selection | Contents |
| --- | --- | --- |
| `project` | `build` | Original source, mapping, native dataset and reconstruction metadata |
| `dataset` | `build` | Native data.csv, dataset.json and source lineage |
| `changes` | `comparison` | Complete original edition-changes JSON Lines file |

For an NDJSON product, `merchant_source_merchant_prepare` takes the exact
`build`, reviewed public `payment` object, public `origin` and route `path`.
The original merchant preparation returns a complete ZIP containing the source,
mapping, native dataset, seller configuration, OpenAPI, generated customer SDK
and merchant manifest. The NDJSON operator guide explains the native payment
configuration and `dataset-ndjson-merchant` launch command.

The adapter streams each native export into the existing private customer export
directory. Completed files have SHA256 identities and atomic metadata records;
`merchant_source_exports` recovers them after a lost reply or process restart.
Each retained export can be read up to the existing 256,000,000-byte delivery
capacity. Larger originals remain available through the native console.

Call `merchant_source_file_read` with `workspace`, `exportId`, optional `offset`
and `limit` (up to 196608 bytes). Decode each returned base64 `data` chunk. Continue
with its `readId` and `nextOffset` until null, and verify the assembled file
against `exportId`. A read uses the original retained bytes. It does not ask the
console to regenerate the package for each chunk. Completed reads release their
temporary snapshot; `merchant_source_file_release` releases an unfinished one.
After a read expires or the MCP restarts, reopen the same `exportId` at the saved
byte offset.

To receive the complete project, start an original console for the receiving
workspace and add its alias to the connection document. Call
`merchant_source_import` with the receiving alias, `exportId`, and the original
`fromWorkspace`. Both aliases must use the same source format. The native import
reconstructs and verifies the original source, mapping and dataset in the
receiving workspace. Alternatively, import a configured `packet` file handle.

Closing the MCP drains its active calls and temporary file reads. The original
source consoles continue to own their workspaces and browser sessions; complete
retained export files are available to the next MCP process.
