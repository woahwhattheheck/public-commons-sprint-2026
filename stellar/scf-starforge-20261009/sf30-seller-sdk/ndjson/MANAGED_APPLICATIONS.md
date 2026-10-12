# JSON Lines datasets in Applications

Applications can reopen the original NDJSON source console from a retained runtime.
The same workspace keeps the uploaded JSON Lines files, exact field mappings, native
dataset builds, keyed edition comparisons, merchant packages and portable customer
projects. Browser and merchant MCP users operate that original console.

## Open the retained workspace

Choose **Applications → New application → JSON Lines datasets** in the runtime
workspace and select:

| Field | Meaning |
| --- | --- |
| Original JSON Lines workspace | The existing private directory initialized or received by the original NDJSON command. |
| Existing Python executable | An absolute Python 3.11+ executable. An existing virtual environment remains selected. |
| Console connection file | Optional new private file containing the original console URL for the merchant MCP connection. |
| Local port | Use 0 for an available local port, or select the required existing host configuration. |
| Private environment JSON | The existing Applications environment file, when the original host needs one. |

The chosen runtime must contain the maintained `dataset-ndjson` command and
`ndjson/managed.py`. The catalog checks the selected installation before offering
the application.

For a new workspace, use the original initializer once:

~~~bash
starforge dataset-ndjson --python /usr/bin/python3 \
  --workspace /srv/starforge/json-lines init
~~~

A customer can also initialize that workspace and import an existing complete
project with the original `import --file` command. The retained source, mapping,
native snapshot and build identity are reconstructed by that original receiver.

## Review, save, start and reopen

1. **Review application** reads the original workspace marker and SQLite identity,
   selected Python and fourteen source/console files. This read leaves the
   original workspace writer available.
2. **Save application** uses the existing managed adoption for that selected
   runtime. Its original release and operation stay visible in Applications.
3. **Review start** checks the saved inputs and selected release.
4. **Start reviewed application** invokes the original `dataset-ndjson` command.
   The command checks its selected workspace, Python and source before and after
   acquiring the original workspace lease.
5. **Open application** appears after the managed observer receives the original
   JSON startup record and reads the same live authenticated `/api/launch` record.
   The observed source directory must be the actual adopted release.
6. Work in the original source console. Closing the Applications browser preserves
   its managed operation. Open that saved application again to continue.
7. **Stop** clears the console's launch readiness, closes its listener, drains
   existing requests and closes the original native engine, SQLite connection and
   workspace lease. A later Start reopens the same retained sources and editions.

Use the operation already shown in Applications after an interrupted save or
start. The existing managed recovery controls retain its request and operation
IDs.

Changing sources, mappings, builds or comparisons inside the console does not
invalidate the application selection. The binding retains the database's original
identity; it does not freeze its changing rows. A different Python environment,
replaced workspace or changed selected source requires a fresh application review.

## Complete source and customer work

The running application is the original industrial source console. It supports:

- Retaining complete JSON Lines exports with their original bytes and source IDs.
- Inspecting nested values and saving explicit field mappings.
- Building and querying original SF30 datasets with native filters, ordering and
  continuation cursors.
- Comparing keyed editions and downloading the complete original change file.
- Exporting native CSV, dataset configuration and source lineage.
- Preparing the original merchant, its reviewed payment terms and generated
  customer SDK from a selected saved build.
- Exporting and receiving the complete original project in another source console.

Large integer identifiers, decimal text, nested JSON and missing/null/empty values
keep the original NDJSON implementation's behavior throughout these operations.
The [source workflow](README.md) describes the commands and native data model.

## Share the console with the merchant MCP

The optional **Console connection file** uses the original `--connection-file`
mechanism. Its existing parent must be private. The source command atomically
creates the new file with mode 0600 and writes the actual private console URL.
The same process removes its own connection when it stops.

Select that file through the original merchant
[source-workspace connection](../../../../stellar-forge/mcp-merchant-operator/SOURCE_WORKSPACES.md).
The existing eighteen source-workspace tools then use this same running console
for source intake, mapping, query, comparison, merchant preparation and retained
file delivery. Applications keeps the console process; the merchant MCP borrows
its connection.

If a connection file already exists, use the original running console or choose
a new file. After a terminated host has been reconciled, the host operator can
remove its retained stale connection before reopening the same selection.

## Native launch interface

The forwarding command accepts an explicit Python before the existing arguments:

~~~bash
starforge dataset-ndjson --python /srv/python/bin/python3 \
  --workspace /srv/starforge/json-lines binding
~~~

`binding` returns `stellar-forge.ndjson-managed-binding.v1`. It reads the original
marker, database identity, Python environment and exact console source without
opening SQLite or acquiring its writer.

The managed host retains its returned digest and invokes:

~~~bash
starforge dataset-ndjson --python /srv/python/bin/python3 \
  --workspace /srv/starforge/json-lines serve \
  --expected-binding DIGEST_FROM_THE_ORIGINAL_BINDING \
  --startup-format json --port 0
~~~

It may also pass the original `--connection-file /private/new-console-url` option.
Ordinary commands retain `SF30_NDJSON_PYTHON` support.

Managed startup emits `stellar-forge.ndjson-workspace-launch.v1` with status
`NDJSON_WORKSPACE_READY`, the original workspace and binding, actual source root,
Python identity, process ID and console URL. An optional `connectionFile` identifies
the file created by that process. The private authenticated `/api/launch` endpoint
returns that same record while the console is available.

The Applications producer is
`distribution/runtime-workspace/application-ndjson.mjs`. It supplies
`ndjsonApplication(common)`, `prepareNdjsonApplication(settings, context)` and
`ndjsonStartup(request, line)` to the existing catalog, preparation and serialized
startup observer. The ordinary application resource key already selects this
NDJSON workspace; the original SQLite lease remains the source writer.
