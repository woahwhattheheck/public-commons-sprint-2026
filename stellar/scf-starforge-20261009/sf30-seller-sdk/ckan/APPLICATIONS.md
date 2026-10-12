# CKAN in Applications

The **CKAN data merchant** application opens an existing CKAN project and its
merchant MCP service together. Source captures, saved mappings, field definitions,
publication reviews, merchant packages and customer requests remain in that project.
The application uses the same native CKAN browser and agent tools described in
[MCP_WORKFLOW.md](MCP_WORKFLOW.md) and
[SEMANTIC_WORKFLOW.md](SEMANTIC_WORKFLOW.md).

## Select the existing project

Use the merchant configuration already associated with the project. It contains
a `ckanWorkspaceConnection` path. That original connection file maps a workspace
alias to the private project directory containing `workbench.json`.

For a new project, first initialize it with the original CKAN command:

~~~sh
stellar-forge ckan init --project /absolute/private/ckan-project --origin https://data.svk.se
~~~

Create the connection file in a private directory, with mode 0600:

~~~json
{
  "schema": "stellar-forge.ckan-workbench-connection.v1",
  "workspaces": {
    "svk": {
      "directory": "/absolute/private/ckan-project"
    }
  }
}
~~~

The original merchant initializer creates a host whose release store is this
project's `seller-releases` directory:

~~~sh
node /absolute/source/stellar-forge/mcp-merchant-operator/serve.mjs \
  init-ckan-workspaces \
  --dir /absolute/private/ckan-merchant \
  --connection /absolute/private/ckan-connection.json \
  --workspace svk
~~~

An existing host can be selected directly. Its CKAN connection still defines the
authorized project aliases, retained input files, merchant defaults and original
source authentication environment name.

## Save and start the application

In the installed workspace, open **Applications**, create an entry and choose
**CKAN data merchant**. Select a runtime edition containing the CKAN launcher and
the Applications registration. Complete the fields below.

| Field | Value |
| --- | --- |
| Merchant configuration | The original private `merchant-mcp.json`. |
| CKAN project alias | The exact alias declared in its CKAN connection file. |
| MCP token environment name | The host variable containing the existing MCP token; the default is `MCP_ACCESS_TOKEN`. |
| Merchant MCP port | `0` selects a free loopback port. A fixed port applies to MCP. |
| Private environment JSON | The existing private host file containing environment names and string values, when required. |

The native CKAN browser selects a separate free loopback port. Its private link
contains the browser access capability; the application retains that link in its
existing private run record. The MCP endpoint uses the selected bearer token.

Choose **Review**, inspect the source and existing project selection, then
**Save**. Use the normal installed workflow to adopt the selected runtime, review
the start and **Start** the saved application. **Open** appears after the
original authenticated CKAN listener matches the reviewed project and owned
process.

A launch owns one original merchant operator. Its CKAN manager opens one
workbench under the native project lease and lends that same browser to
Applications and the agent. The displayed browser and MCP endpoint therefore
operate on the same original operation, source IDs and publication state.

## Work through the complete merchant workflow

The browser preserves the existing source workflow:

1. Search the configured CKAN catalogue, select a real package/resource and capture
   its DataStore pages into an edition.
2. Review the edition, select field aliases, types, primary key, time fields and
   optional CSVW observation identity. Preview the original source definitions
   alongside the selected output columns.
3. Save the source against that retained edition. Reopen its source meaning
   dictionary and original provider descriptions from the saved source.
4. Create and review the publication, then publish its complete dataset snapshot.
5. Export the merchant package, stage it into the project's bound release store,
   and use the existing merchant review/activation/start workflow.
6. Prepare the customer request and hand over its original files. Completed buyer
   pages, CSV/JSONL, source meanings and manifest continue into the Python or
   DuckDB customer workspace.

The original browser controls and MCP methods retain their current operation
handling. After an interrupted request, open the same project and inspect that
operation before continuing it. Collection pagination, complete file downloads
and resumable MCP file reads remain available.

A host configured with a different release store can still open and review its
selected project. The native CKAN status reports `releaseStoreMatches`.
Use the original project-bound merchant configuration for staging that project's
merchant package.

## Stop and reopen

**Stop** closes the same merchant host. It stops accepting browser requests,
drains accepted agent work and closes the original project. The native project
lease is released after shutdown. The source captures, field definitions,
publications, package directories and customer requests remain retained.

Start the saved entry again to reopen that same directory. A new process and
browser capability identify the new run; the project retains its original
creation identity, catalogue and item IDs. Opening an old private browser link
does not select the new run.

Changing merchant/connection declarations or installing different launch source
requires a new application review. Ordinary workbench edits update the original
project while preserving its stable identity, so a completed capture or
publication remains usable on the next start.

## CLI and host integration

Inspect the original selection without acquiring the project:

~~~sh
stellar-forge ckan-agent inspect \
  --config /absolute/private/ckan-merchant/merchant-mcp.json \
  --workspace svk
~~~

Open the same original host from a terminal:

~~~sh
stellar-forge ckan-agent serve \
  --config /absolute/private/ckan-merchant/merchant-mcp.json \
  --workspace svk \
  --port 0 \
  --token-env MCP_ACCESS_TOKEN
~~~

The first JSON line identifies the original project, selected native source,
actual process, owned instance, CKAN browser and MCP listener. The launch waits
for its authenticated `/api/launch` response before announcing readiness.
SIGINT or SIGTERM drains the original owner. Embedders can call
`startCkanAgentWorkspace` and await its idempotent `close()`.

The installed package exports the native launcher as
`./merchant/mcp/ckan-launcher`. The source-owned `ckan` contribution contains
the `ckan-agent` command alongside the existing `ckan`,
`ckan-publisher` and semantic exports.

### Applications provider contract

The original adapter is
`distribution/runtime-workspace/application-ckan.mjs`.

| Export | Contract |
| --- | --- |
| `ckanAgentApplication(common)` | Descriptor `id=ckan-agent`, `command=ckan-agent`, `terminal=false`; includes the existing common environment field and labels the common port for MCP. |
| `prepareCkanAgentApplication(settings,{inputPath,runtimeDirectory})` | Returns original argv, selected file/directory inputs, empty creation list and the common merchant-MCP resource key for the canonical configuration file. |
| `ckanAgentStartup(request,text,context)` | Matches the schema-first startup record, selected/adopted source and project, then reads the authenticated original listener. Returns `{url,original}`. The optional context carries the managed process PID. |

The selection travels in the existing private argv as
`--managed-selection JSON`, so the original request/serialized-startup workflow
retains it. The adapter uses the same common resource hash as the other merchant
applications. The shared provider registry remains the catalog/preparation/
startup dispatch owner.

The native selection binds both original configuration files, the stable project
identity and fourteen original launcher/merchant/CKAN/browser source files.
Installed runtime verification retains the complete dependency closure.
Selected and adopted copies may occupy different directories; their selected
source bytes must agree. The authenticated native listener returns its actual
instance and PID, allowing the existing observer to expose only the matching
browser.

## Complete receiving example

`examples/managed-receiving.mjs` consumes an initialized merchant host and an
existing completed CKAN project. It opens the actual browser and authenticated
MCP service, receives source definitions and a complete merchant archive,
stops the owned host, and reopens the same project with its saved source and
publication IDs. It uses the caller's existing environment for authentication.

~~~sh
node /absolute/source/stellar/scf-starforge-20261009/sf30-seller-sdk/ckan/examples/managed-receiving.mjs \
  --config /absolute/private/ckan-merchant/merchant-mcp.json \
  --workspace svk \
  --source SOURCE_UUID \
  --publication PUBLICATION_UUID \
  --export EXPORT_UUID \
  --out /absolute/private/ckan-managed-receiving
~~~

The output directory contains the selected source/project record, actual
receiving result, complete source-definition download and complete original
merchant archive. The original project stays in its selected directory and is
closed when receiving finishes. Use the ordinary installed Applications flow
above to retain its long-running operator entry.
