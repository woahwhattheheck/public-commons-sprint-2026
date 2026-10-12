# NWS merchant tools and complete customer receiving

The NWS adapter connects the existing Site Weather Operations workspace to the
shared merchant MCP server. The browser and agent use one workspace UUID,
revision, capture history and operation journal. Weather acquisition, source
interpretation, dataset preparation, release control and buyer receiving remain
with the original NWS, SF30, SF82, SF88 and SF100 implementations.

The installed entrypoints are `nws-workspace` for the operator browser,
`nws` for the original action CLI, `nws-mcp` for the agent client and
file receiver, and the existing `merchant-mcp` server. See [README.md](README.md)
for provider acquisition and site operations, and [MANAGED.md](MANAGED.md) for
the Applications lifecycle.

## Connect the original workspace

The host selects an existing workspace UUID and exactly one private session
reference per alias:

| Field | Source |
| --- | --- |
| `consoleUrlEnv` | Environment variable containing the original loopback URL and bearer fragment |
| `consoleUrlFile` | Private regular UTF-8 file containing that original URL |
| `applicationUrlFile` | Original managed Applications `application-url.json` for this workspace |

The session reference can change when the original workspace restarts. Its
configured UUID remains the same. The adapter reads the current reference and
checks the running workspace schema before an operation. It accepts the native
canonical loopback origin, including HTTP port 80. Bearer values stay in the
host's private session reference.

Use the private original startup JSON or Applications URL record to construct
a connection. The following script creates a private connection beside a
selected original record. Its optional third argument is an original source capture or exported
source package to make available as the `weather_source` alias.

```sh
python3 - /absolute/original-launch.json /absolute/private-nws-agent /absolute/original-source-package.json <<'PY'
import hashlib, json, os, pathlib, shutil, sys
launch_path = pathlib.Path(sys.argv[1]).resolve()
root = pathlib.Path(sys.argv[2]).resolve()
root.mkdir(mode=0o700, parents=False, exist_ok=True)
launch = json.loads(launch_path.read_text())
identity = launch.get("original", launch)
assert identity["schema"] == "stellar-forge.nws-workspace-startup.v1"
entry = {"label": "Site weather operations", "workspaceId": identity["workspaceId"]}
if launch.get("schema") == "stellar-forge.application-url.v1":
    entry["applicationUrlFile"] = str(launch_path)
else:
    url_path = root / "original-console-url"
    url_path.write_text(launch["url"] + "\n")
    os.chmod(url_path, 0o600)
    entry["consoleUrlFile"] = str(url_path)
if len(sys.argv) == 4:
    source = pathlib.Path(sys.argv[3]).resolve()
    selected = root / "original-source-package.json"
    if source != selected:
        shutil.copyfile(source, selected)
    os.chmod(selected, 0o600)
    digest = hashlib.sha256(selected.read_bytes()).hexdigest()
    entry["sourcePackages"] = {"weather_source": {
        "label": "Original received weather capture",
        "path": str(selected), "sha256": digest
    }}
connection = root / "connection.json"
connection.write_text(json.dumps({
    "schema": "stellar-forge.nws-workspace-connection.v1",
    "workspaces": {"operations": entry}
}, indent=2) + "\n")
os.chmod(connection, 0o600)
print(connection)
PY
```

The private files must be owned regular files. Choose a new private destination
for the merchant, then save its original setup selection:

```json
{
  "directory": "/absolute/private-nws-merchant",
  "connection": "/absolute/private-nws-agent/connection.json",
  "name": "Site weather operations"
}
```

Save that JSON as `/absolute/private-nws-setup.json` with mode 0600. The installed
source contribution declares the complete `nws-workspaces` merchant provider:

```sh
starforge merchant-providers inspect nws-workspaces
starforge merchant-providers init nws-workspaces --options /absolute/private-nws-setup.json
starforge merchant-mcp serve \
  --config /absolute/private-nws-merchant/merchant-mcp.json \
  --token-env MCP_ACCESS_TOKEN --port 3211
```

The provider's setup calls the original merchant configuration reader and
SF82 release-store initializer. It attaches the declared running NWS workspace.
The source API is `initializeNwsWorkspaceMerchant(options)` from
`./merchant-mcp/nws/setup`; the same options are accepted by
`merchant-mcp init-provider nws-workspaces --options FILE`.

An existing merchant configuration can declare
`"nwsWorkspaceConnection": "/absolute/private-nws-agent/connection.json"`
alongside its existing sources and provider connections, then restart its
original server. Incoming MCP authentication uses the original merchant bearer
or OAuth configuration.

The NWS contribution owns its descriptor, pure metadata, original connection
reader, setup, request limit and instructions. Catalog inspection imports the
metadata only. The native adapter loads when selected; it shares the original
workspace HTTP actions and operation journal with the browser. Its own
concurrency keeps pause and read operations available during native work, while
the journal retains revision and operation identity. Shutdown drains accepted
calls before closing retained files. An unsuccessful file close leaves the
adapter closed to new calls and permits another close on the same instance.

## Operate the original domain

There are 30 tools with the prefix `merchant_nws_`. The source schema remains
available through `schema`; the following table groups the complete tool set.

| Tools | Operation |
| --- | --- |
| `workspaces`, `schema`, `view` | Discover host aliases, selected package hashes, actual provider contract and current operator state |
| `editions`, `edition`, `rows` | Read the full archive, one immutable edition and its selected normalized table |
| `site_save`, `site_archive` | Maintain named sites, explicit coordinates, station choices and responsible operators |
| `capture_start`, `capture_resume`, `capture_pause`, `capture_station`, `capture_import` | Collect, continue, pause, select an actual catalog station or import original source |
| `edition_select`, `edition_compare`, `annotation_save` | Review exact editions, complete changes and source-linked notes |
| `dataset_prepare`, `dataset_query` | Prepare and query the selected original weather table |
| `release_prepare`, `release_inspect`, `release_activate`, `release_start`, `release_stop`, `release_rollback` | Operate the original merchant publisher and its generation |
| `buyer_inspect`, `buyer_receive` | Inspect ordered original page intents and receive the completed customer files |
| `export_create`, `files`, `file_read`, `file_release` | Create original exports and transfer complete retained files |

Every native action requires the current `expectedRevision` and a saved
`operationId`. Save the complete action request before invoking it. A reply
contains `ok`, the original `native` response, and the exact small request
needed for recovery. A completed native action returns its result and current
view; a still-running operation retains its original identity.

For an interrupted reply, keep that request and use the current view to inspect
the original operation. Repeating the identical request reuses the native
journal entry before revision comparison. A new request after a concurrent
change returns HTTP 409 and the current revision, allowing the caller to retain
its draft and review the changed workspace.

A source import uses `payload.sourcePackage`, the host-declared package alias.
The adapter reads and hashes that exact private file, then submits its complete
bundle to the original `capture.import` action. The returned
`sourcePackage` metadata records the selected file SHA256 and byte count.
The browser's inline source importer and the agent use the same native importer.
The original source package supplies provider response bodies, source times,
coverage and source-linked annotations.

### Client and original requests

```sh
starforge nws-mcp tools --url http://127.0.0.1:3211/mcp --workspace operations
starforge nws-mcp action --url http://127.0.0.1:3211/mcp \
  --workspace operations --request-file /absolute/private/request.json
```

An action file contains `{action,payload,operationId,expectedRevision}`.
For example, prepare `site.save` with a real label, latitude and longitude;
use the returned site ID for `capture.start`. Original products are
`forecast`, `hourly`, `grid`, `observations` and `alerts`.
Select `us` or `si` forecast units and explicit ISO 8601 observation times
when overriding the native defaults. Site coordinates and the current provider
point response determine the actual forecast office and grid.

Use `capture_station` with a station ID from the retained capture catalog.
Use `view` to read capture completion, partial coverage and retry times.
Each source task preserves its completed responses when another task requires
continuation.

For read tools, `call` accepts a private file containing
`{tool,args}`; the tool name may omit `merchant_nws_`.
The client already binds the workspace alias. The JavaScript API is exported
at `@tokenjunkielabs/starforge-merchant/merchant-mcp/nws/client`:

```js
import { openNwsClient } from '@tokenjunkielabs/starforge-merchant/merchant-mcp/nws/client';
const client = await openNwsClient({
  url: 'http://127.0.0.1:3211/mcp',
  workspace: 'operations',
  tokenEnv: 'MCP_ACCESS_TOKEN'
});
const current = await client.call('view');
const reply = await client.action(request.action, request.payload, {
  operationId: request.operationId,
  expectedRevision: request.expectedRevision
});
```

Available normalized tables are `forecast`, `hourly`, `grid`,
`observations`, `latest`, `active-alerts`, `alerts` and `stations`.
Rows retain original nulls, unit codes, quality metadata, geometry, source
record references and distinct provider times. Dataset queries use the original
URL-encoded string, such as `limit=50`, and the dataset's declared fields,
filters, sorts and cursor. Continue its returned cursor unchanged.

Archive pages return a revision and `nextOffset`. Retain the revision and
optional site ID for subsequent pages. Row pages continue the same immutable
edition and table. Complete comparison changes are available as their original
downloadable export, including changes beyond the displayed preview.

## Receive complete original files

Inspect and download an original export, source edition or customer receipt:

```sh
starforge nws-mcp inspect --url http://127.0.0.1:3211/mcp \
  --workspace operations --kind receipt --id ORIGINAL_BUYER_RECEIPT_ID
starforge nws-mcp download --url http://127.0.0.1:3211/mcp \
  --workspace operations --kind receipt --id ORIGINAL_BUYER_RECEIPT_ID \
  --out /absolute/private/received-weather \
  --manifest-sha256 REVIEWED_TRANSFER_INDEX_SHA256
starforge nws-mcp reopen --out /absolute/private/received-weather \
  --manifest-sha256 REVIEWED_TRANSFER_INDEX_SHA256
```

The transfer index is `nws-transfer.json`; the original customer
`manifest.json` keeps its name and bytes. A customer receipt contains
`dataset.csv`, `dataset.jsonl`, `review.html`, `delivery.json` and
`manifest.json`, with the original ordered page intents and dataset identity.

Original export formats are `json`, `csv`, `report` and
`source-package`. A source-package export is the complete portable input for
the original importer. Source-file receiving can instead select every retained
body, or one `--page`; `--wire true` selects actual transport response
bodies, including the empty body of a 304 response. The corresponding retained
source body remains separately accessible. The original response SHA256 and
byte count distinguish those two selections.

Downloads use the maintained retained-file engine: verified byte offsets,
original hashes, a private directory lock, saved partial files and atomic
completion. Repeat the same command and destination to continue its saved
transfer. Preserve the MCP endpoint and selected manifest identity during that
continuation. A named temporary read can finish after the operator console
closes; completed receiving can be verified offline with `reopen`.

Each file is checked against its original SHA256 and byte count. The maintained
download budget is 256 MiB (268,435,456 bytes); source indexes above 65 KB use an individual page
selection or the original complete source-package export. Page names carry
their original index and body/wire identity, so repeated provider filenames
remain distinct.

## Source interfaces

The shared merchant catalog imports the pure `mcp-protocol.mjs` tool
contract. It advertises the 30 NWS tools only when this host has an NWS
connection; the provider runtime loads when that configured family is first
used. The browser and full acquisition engine remain in their original
process. The shared merchant close drains accepted calls and closes the
adapter's temporary file reads.

`mcp.mjs` exports `NWS_CONNECTION_SCHEMA`,
`readNwsWorkspaceConfiguration`, `nwsWorkspaceTools` and
`MerchantNwsWorkspaces`. The constructor accepts the normalized
`nwsWorkspaces` connection, the original merchant exports directory and
optional host environment/fetch implementation.

`mcp-client.mjs` exports `openNwsClient`, `inspectNwsFiles`,
`downloadNwsFiles`, `reopenNwsFiles` and `main`.
The original browser owns the sole NWS workspace writer; the MCP adapter
connects to its authenticated loopback API and uses the shared retained-file
transport for receiving.
