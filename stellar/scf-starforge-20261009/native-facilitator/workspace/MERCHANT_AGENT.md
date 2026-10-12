# Native facilitator agent operations

Operate the existing native Stellar facilitator from the merchant MCP host.
The agent selects a host-declared operator alias, reviews and saves immutable
payment profiles, starts or drains their original backend, reads actual Bazaar
pages, and captures complete profile/catalog files for reliable receiving.

The `native-facilitator-operators` provider uses the original native operator
client and its authenticated management API. The native controller keeps its
runtime, signing-account ownership and durable catalog journal. The merchant
host owns its connection and export receiving files. An agent session can end
and reopen those same files through the same merchant configuration.

## Install the complete source

The installed `native-facilitator-operator` selection includes this provider,
its native operator, original merchant MCP transports, source-owned provider
setup and `native-facilitator-receive`. Install that selected runtime with its
native Stellar peers and the `schema` feature, following the installed native
operator guide.

On a full product source installation these contributions are composed through
the same original distribution registry. `merchant-providers inspect
native-facilitator-operators` lists the source declaration and all 17 tools
without connecting to a native listener.

## Declare original host connections

Start or open the native operator through its saved Runtime Workspace
Application or the existing `native-facilitator-operator` command. Retain the
original private Applications `application-url.json`, its complete native
startup JSON, or the complete operator URL in a private host file. Native
Applications receipts include the selected original process and host-directory
identity; attachment compares that identity with the authenticated listener.

Create a private connection JSON, for example
`/srv/starforge/private/native-operators.json`:

```json
{
  "schema": "stellar-forge.native-operator-connection.v1",
  "operators": {
    "main": {
      "label": "Original Stellar operator",
      "operatorUrlFile": "/absolute/original/application-url.json",
      "timeoutMs": 120000,
      "maxResponseBytes": 33554432
    }
  }
}
```

Use the actual existing receipt path. Relative `operatorUrlFile` paths resolve
against this connection file. The file can instead contain the original native
startup JSON or complete local operator URL. Keep these private regular files
at mode 0600 with their canonical paths and the current host user's ownership.
The original operator URL contains its session token.

For a foreground operator managed through its existing host environment, replace
`operatorUrlFile` with `"operatorUrlEnv": "STARFORGE_NATIVE_OPERATOR_URL"`.
Set that environment variable to the complete original local URL in the process
which launches the merchant host. The two connection methods are alternatives
for the same alias. An optional `instanceId` pins an explicitly selected native
management process. Otherwise the first successful attachment pins the current
original instance for that merchant host session.

Aliases accept 1–64 lowercase letters, digits, underscores or hyphens and the
connection supports up to 128 aliases. Profiles retain the original native
profile naming rules, including uppercase characters. The native client
response ceiling is per page; `timeoutMs` sets the deadline for an agent call's
native request or complete catalog capture, from 1 ms through 30 minutes.
A large complete export can use a longer configured deadline while retaining
the same original runtime and resource version.

## Initialize and attach the merchant host

Use an existing canonical private parent, for example
`/srv/starforge/private` at mode 0700. Create a setup JSON:

```json
{
  "directory": "/srv/starforge/private/native-agent",
  "connection": "/srv/starforge/private/native-operators.json",
  "name": "Starforge native facilitator"
}
```

Run the original source-owned initializer:

```sh
starforge merchant-providers init native-facilitator-operators \
  --options /srv/starforge/private/native-agent-setup.json
```

It retains `merchant-mcp.json`, the existing empty SF82 merchant release store,
and private `customer-exports` under that directory. Use the returned
configuration path on later launches. The equivalent original entry is
`starforge merchant-mcp init-provider native-facilitator-operators --options
/absolute/setup.json`.

To attach an existing merchant host, add
`"nativeFacilitatorOperatorConnection": "/absolute/native-operators.json"`
to that host's original `merchant-mcp.json`, retaining its existing release
store, exports and source declarations.

Generate the existing subprocess MCP host configuration on this installed
machine:

```sh
starforge merchant-mcp-client-config \
  --config /srv/starforge/private/native-agent/merchant-mcp.json \
  --name starforge-native \
  --output /srv/starforge/private/starforge-native-mcp.json
```

The resulting configuration selects the original installed
`merchant-mcp-stdio` entry and exact merchant configuration. Use the host's
existing configuration import or `--merge` option for its current settings.

For an authenticated HTTP MCP listener and complete remote file receiving, use
the existing bearer-token environment selected by that host:

```sh
starforge merchant-mcp serve \
  --config /srv/starforge/private/native-agent/merchant-mcp.json \
  --port 3211 --token-env MCP_ACCESS_TOKEN
```

The original merchant listener binds to loopback and prints its endpoint.
Use that actual endpoint for receiving. Native management authentication and
the merchant MCP bearer token belong to their respective existing listeners.

## Agent workflow

Every tool below starts with `merchant_native_facilitator_`.

| Tool | Work and retained selection |
| --- | --- |
| `operators` | List the configured aliases and human labels |
| `status` | Read the authenticated original instance, current backend, catalog queue and retained file reads |
| `profiles` / `profile` | Page original immutable profiles or inspect one complete file |
| `review` / `save` | Normalize a full native configuration, then retain the exact reviewed config and SHA256 under its original name |
| `probe` | Check a saved profile by name/SHA256 or the actual running runtimeId |
| `start` / `stop` | Start a saved profile by exact file SHA256 or drain the selected runtimeId |
| `catalog` | Read one complete list/search page at the original runtime and resource version |
| `profile_export` / `catalog_export` | Capture exact original profile bytes, or all matching catalog resources plus their profile |
| `exports` / `manifest` | Page retained receiving IDs or inspect one completed original manifest |
| `file` / `file_release` | Receive the original declared bytes by manifest SHA256, file SHA256, readId and offset |
| `disconnect` | Drain accepted calls and retained reads for one alias before attaching its current original host connection |

Begin with `operators`, then `status`. Read the actual profile and runtime.
For profile edits, send the complete configuration to `review`; pass its
returned normalized configuration and `sha256` as `expectedSha256` to
`save`. The save response supplies the exact original file SHA256 used by
`start`. Existing legacy profile files retain their original bytes and hash.

The original native controller reconciles an identical running selection.
After a disconnected start or stop, read `status` on that same attached alias
and reconcile its runtimeId before the next change. `probe` accepts either a
running runtimeId alone or the saved profile's name and SHA256.

`profiles` and `exports` accept `after` and `limit` (1–100, default 30).
Continue with their returned `next` value until null. For large catalog pages,
choose a smaller original list/search limit or receive the complete export.
An individual agent result has a 1 MiB ceiling.

## Capture and receive complete files

Choose a stable export ID for each intended receiving operation. For a profile,
call `profile_export` with `operator`, `exportId`, `name` and its original
file `sha256`.

For a catalog, first read `status` or `catalog` and select the actual
runtimeId and resource version. Then call:

```json
{
  "operator": "main",
  "exportId": "catalog-review-oct12",
  "runtimeId": "ACTUAL_NATIVE_RUNTIME_ID",
  "expectedVersion": 42,
  "query": "type=http"
}
```

Use the actual returned runtime ID and resource version instead of the example.
`catalog_export` starts at the first matching resource, reads each original
100-resource page and writes it directly into its receiving file. List pages
retain exact offsets and totals; search uses the original catalog cursor.
The first actual profile/network/catalog/queue observation remains fixed.
The same runtime and resource version bind every subsequent page. Completion
records the original resource objects, final resource count and page count.

The completion response contains the exact `manifestSha256` and manifest.
Receive it through the installed original client:

```sh
starforge native-facilitator-receive inspect \
  --operator main --url http://127.0.0.1:3211 \
  --export catalog-review-oct12

starforge native-facilitator-receive download \
  --operator main --url http://127.0.0.1:3211 \
  --export catalog-review-oct12 \
  --manifest-sha256 ORIGINAL_MANIFEST_SHA256 \
  --directory /srv/starforge/private/received/catalog-review-oct12
```

Select the actual merchant endpoint and retained manifest hash. The client uses
`MCP_ACCESS_TOKEN` by default; `--token-env` selects its original host variable.
The destination's parent must exist and be private. Continue with the same
command and directory after an interrupted transfer.

A completed profile export contains `profile.json` and
`native-operator-export.json`. A completed catalog export also contains
`catalog.json`. The completion manifest binds its stable request, original
operator instance, native profile name/hash, Stellar network and every exact
file size/hash. The downloaded profile is the original file, including its
existing legacy form.

The merchant host captures under an original Linux `flock` lease for
`customer-exports/native-operator-exports/ALIAS/EXPORT_ID`. It retains
`request.json` before reading the source. A completed capture retains its own
`capture.json` before publishing the final files and completion manifest.
A continuation of that same request finishes the retained capture. Completed
same-ID calls reopen that original manifest after an agent or merchant restart.

If interruption precedes complete capture, the same request can read its
original selection again. A changed runtime or catalog version requires the
new actual selection and a new export ID. Once the completion manifest exists,
receiving reads its original files independently of the current native runtime.
The original receiver hashes every file, retains resumable progress and
publishes the received completion manifest after the files finish.

Programmatic receiving uses the same implementation:

```js
import {downloadNativeOperatorExport} from
  '@tokenjunkielabs/starforge-merchant/facilitator/operator/download';

const result = await downloadNativeOperatorExport({
  operator: 'main',
  url: process.env.STARFORGE_MERCHANT_MCP_URL,
  exportId: 'catalog-review-oct12',
  expectedManifestSha256: process.env.STARFORGE_NATIVE_EXPORT_SHA256,
  directory: '/srv/starforge/private/received/catalog-review-oct12',
  onProgress({file, bytes, total}) {
    process.stderr.write(file + ': ' + bytes + '/' + total + '\n');
  },
});
```

The adjacent TypeScript declaration covers source manifests, trusted existing
merchant clients, receiving progress and completion. A supplied native merchant
client can replace `url`; its stable endpoint identity and selected alias
remain in the same original download checkpoint.

For direct local streaming, `createNativeOperatorClient().streamCatalog`
accepts an awaited `write(part)` callback and returns completion metadata after
all original pages finish. Its collector methods `receiveCatalog` and
`exportCatalog` keep the same interface for browser and in-memory callers.
Publish a streaming destination after that method completes.

## Reopen the same operation

On merchant restart, use the same `merchant-mcp.json` and exports directory.
List `exports`, inspect the retained manifest, and resume receiving by the
same alias, export ID and manifest SHA256. Existing complete exports remain
available while the native operator is offline.

To use a newly opened native management process, update the original private
connection receipt or environment, then call `disconnect` for that alias.
The next native operation attaches its current authenticated listener. A
receipt with an original instance binding or an explicit configured instanceId
must match that selected process. Environment changes take effect in the
merchant process that actually owns the connection.

Use native `stop` to drain the backend. Closing the merchant agent host drains
its accepted calls and file readers; the saved native Application or original
foreground process continues to own its native operator lifetime.
