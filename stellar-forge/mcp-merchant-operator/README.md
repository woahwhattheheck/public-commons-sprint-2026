# Starforge merchant operations through MCP

Operate the existing Starforge merchant release system from an MCP client. This
interface takes a prepared merchant API through staging, exact price and route
comparison, activation, original seller startup, customer SDK export, rollback
and graceful shutdown. The same operator opens retained merchant incidents and
support cases, records owner delivery terms, and exports the original workorder.
The tools use the original SF82 release store, SF61
OpenAPI compiler, original SF30 Python merchant, SF30 seller and customer SDK exporter. The MCP endpoint reuses
the same authenticated HTTP transport as the existing SF32 buyer bridge.

The seller runs on the operator's Linux or POSIX host. This starts the configured
merchant service; a reverse proxy or deployment remains the host's existing
configuration. Native payments use the original seller's configured facilitator
and trusted application. The MCP tools never request a paid resource or accept
wallet keys, handler paths, arbitrary file paths, target URLs or payment overrides
as tool arguments. Owner-entered support terms may reference their existing
consent and proposal records; those URLs are retained as text and never fetched.

## Operate a retained merchant fleet

The same provider also exposes the original multi-store fleet lifecycle. Use
`init-fleet --dir NEW_DIRECTORY --plan ORIGINAL_FLEET_PLAN.json`, connect the
existing MCP transport, inspect `merchant_fleet_plan`, and start with its digest.
Agents can then stage, compare, prepare and activate releases; observe draining
requests; retire exact owned child instances; review and restore a retained
revision; and stop or reopen the saved fleet. The original gateway, release
stores and sessions own these operations. See [FLEET.md](FLEET.md) for the full
host configuration, all 13 fleet tools, and recovery workflow. Existing merchant
initialization can include the same fleet with `--fleet-plan`.

## Prepare a merchant

For an existing S3 file product, initialize with
`--s3-package /private/packages/products-v1`. The same provider then retains,
compares, starts and rolls back the original pinned whole-file or chunk seller.
See [S3 releases](../../stellar/scf-starforge-20261009/sf82-seller-pilot/S3_RELEASES.md)
for private source handling, object version behavior and the original buyer handoff.

Use Node 22+ and the complete source checkout, or the installed Starforge package
containing the `merchant-mcp` command. The merchant's existing OpenAPI document,
payment selections and service bindings use the original SF61 formats. Initialize
a new operator directory:

```sh
node stellar-forge/mcp-merchant-operator/serve.mjs init \
  --dir /private/my-merchant \
  --spec /private/api/openapi.json \
  --selections /private/api/selections.json \
  --bindings /private/api/bindings.json \
  --name "My merchant" --seller-port 0
```

For the original native seller, add `--facilitator` with the existing HTTPS
facilitator URL. Application bindings use `--upstreams` for an existing HTTP API
or `--handlers` for an existing trusted module. These are host configuration at initialization,
never MCP tool inputs. The original native SDK packages must be installed for
native operation. An explicitly configured loopback facilitator uses the
original `--allow-local-facilitator` option.

Initialization creates the original private release store, a customer export
directory, and `merchant-mcp.json`. It refuses an existing directory and does
not copy or rewrite the original inputs. The configuration registers them under
the source alias `initial`. To add another candidate, edit the local file and
restart MCP:

```json
{
  "schema": "stellar-forge.merchant-mcp.v1",
  "name": "My merchant",
  "releaseStore": "./releases",
  "exportsDirectory": "./customer-exports",
  "sources": {
    "initial": {
      "label": "Reviewed merchant API",
      "spec": "/private/api/openapi.json",
      "selections": "/private/api/selections.json",
      "bindings": "/private/api/bindings.json",
      "runtime": { "port": 0 }
    }
  }
}
```

Up to 32 aliases can be configured. Relative paths resolve beside the host
configuration. The original importer snapshots static response files during
staging, and the original release system retains the trusted handler entry
hash. Executable module dependencies remain the operator's application.

### Use a saved API onboarding package

Save the merchant's selected routes, prices and backend authentication mappings
in the original SF61 API workspace. Point initialization to that saved package:

```sh
node stellar-forge/mcp-merchant-operator/serve.mjs init \
  --dir /private/my-merchant \
  --workspace /private/api-packages/merchant-v1 \
  --name "My merchant" --seller-port 0
```

The original package reader verifies its manifest and each input file.
Initialization returns the package identity, input digests and required
environment-variable names. It validates the source before creating the new
operator directory. Supply those variables through the host's existing service
environment before starting MCP; their values are resolved by the original
upstream launcher when the seller starts.

The configured source now has this shape:

```json
{
  "label": "Saved onboarding package",
  "workspace": "/private/api-packages/merchant-v1",
  "runtime": { "port": 0 }
}
```

Use `workspace` as the whole source selection. Its original facade, payment
selections, route bindings and upstream configuration travel together. Do not
combine it with separate source files or a handler module. A new saved package
can be registered as another alias for the next release; already staged releases
retain their original snapshots and do not depend on the source package at launch.

### Connect an existing HTTP backend

For explicit SF61 files, add `--upstreams /private/api/upstreams.json` to the
first initialization command. The file uses the original SF30
`stellar-forge.seller-upstreams.v1` format. Each service binding's `handler`
selects one upstream binding. The configuration stores its path as `upstreams`
alongside `spec`, `selections` and `bindings`.

An explicitly configured local development backend also needs
`--allow-loopback-upstream`; saved workspace packages retain their own original
choice. Public backends use the original HTTPS rules. Authentication maps header
names to environment-variable names through `headerEnv`. Keep values in the
host environment, including the complete `Bearer` or `Basic` prefix where needed.

`merchant_sources` displays the public route and complete payment choices next
to the original upstream review: origin, path, method, query mapping, header
names, credential variable names, response constraints and operation settings.
It uses the original compiler without reading credential values or contacting
the backend. `merchant_stage` retains the exact upstream bytes through the
original release store. `merchant_compare` then shows backend changes as well
as price and route changes. Activation, restart and rollback use the same tools
and generation checks below.

For credential rotation, replace the value through the host's deployment
mechanism, stop the owned seller, and relaunch MCP with the updated environment.
Start the same selected release. A new origin, path, header mapping or payment
term is a configuration change: stage, compare and select a new release.

### Use an existing Python merchant

The original SF30 Python declaration can use the same release workflow:

```sh
node stellar-forge/mcp-merchant-operator/serve.mjs init \
  --dir /private/python-merchant-operator \
  --python /private/python-project/merchant.json \
  --python-root /private/python-project \
  --name "Python merchant" --seller-port 0 \
  --facilitator https://YOUR_ACTUAL_FACILITATOR
```

The host configuration records `python` and optional `pythonRoot` under the
`initial` alias. These select the original `stellar-forge.python-merchant.v1`
declaration and the local source directory to retain. Choose Python as the whole
source selection. Each declaration keeps its original function input contracts,
output formats, atomic payment amounts, environment names and worker settings.

`merchant_sources` compiles the declaration and hashes the selected source without
importing Python or starting workers. It shows the retained file count, entry,
source and execution digests, worker limits, lifecycle hooks and public routes.
The interpreter is represented by its selection digest in MCP responses; its
host path stays in private configuration. Only environment names are exposed.

`merchant_stage` captures a private copy of the source. With `pythonRoot`, that
includes local helpers and assets using their relative directory structure.
Without it, only the declared entry module is copied. Place the operator directory
outside the source root. Version-control directories, virtual environments,
dependency caches and Python bytecode caches are excluded. Source symlinks and
special files are rejected. The retained source is limited to 512 files and
32 MiB, with an 8 MiB limit per asset and 2 MiB for the entry module.

Activate, start, export the customer SDK, change versions and roll back with the
same workflow below. Comparisons show payment changes and Python source, worker,
function or lifecycle changes. Once staged, a release uses its retained project
even if the input project changes or is removed. Helpers beside the entry import
normally; load adjacent assets relative to `__file__`. Python starts with bytecode
writes disabled to keep the retained source unchanged.

The interpreter and its installed packages remain on the host. A pathful relative
interpreter selector is anchored to the staging process's working directory;
a bare selector such as `python3` uses the launch environment's PATH. Provide
declared environment values through the existing host service. Restart and
rollback open a fresh original worker pool with that environment and the selected
lifecycle hooks. The original seller drains accepted requests before its worker
pool closes. A release with no facilitator remains challenge-only and starts no
Python workers.

The [Python release guide](../../stellar/scf-starforge-20261009/sf82-seller-pilot/RELEASES.md#release-a-python-project)
also describes direct terminal operation and the retained project layout.

## Connect an MCP client

Provide the existing operator bearer token through `MCP_ACCESS_TOKEN`, or select
its existing environment-variable name with `--token-env`. The token must contain
at least 24 characters. It is never written into the configuration or startup
output.

```sh
node stellar-forge/mcp-merchant-operator/serve.mjs serve \
  --config /private/my-merchant/merchant-mcp.json --port 3211
```

The startup JSON gives `http://127.0.0.1:3211`. Configure the MCP client's
Streamable HTTP connection at that URL with its `Authorization: Bearer` header.
The original transport uses MCP `2025-11-25`, JSON responses and the usual
`Accept: application/json, text/event-stream` request header. Clients sending an
`Origin` must have it listed in the host's comma-separated `MCP_CLIENT_ORIGINS`.
The endpoint has no SSE stream, server push, remote process takeover or periodic
polling. The host keeps the command running and closes it with SIGINT/SIGTERM.

The same command is available as `starforge merchant-mcp init ...` and
`starforge merchant-mcp serve ...` in the distribution. The original buyer MCP
workspace remains separate and uses its existing approval, budget and signer.

## Retained merchant support

Add the host's existing incident/case directories and retained input aliases through
`--support SUPPORT_CONNECTION_JSON` at initialization, or `supportConnection` in
the existing configuration. The original MCP provider then exposes incident
inspection/acknowledgment, case import/reopening/history, owner terms, workorder
preparation and private exports. These use the same original SF93/SF74/SF77 engines
and case directory as the support console. Follow the complete
[support and workorder workflow](./SUPPORT.md) for source/revision selection,
console interoperability, export recovery and host setup. It starts no watcher,
seller or payment run.

## Complete operator workflow

| Tool | Operation |
| --- | --- |
| `merchant_sources` | Inspect configured files or a saved API package, with public routes, payment choices, backend mappings and input hashes. |
| `merchant_stage` | Compile an alias to a new immutable release ID, retaining the original upstream snapshot when configured. |
| `merchant_inspect` | Verify the original retained release and inspect its exact digest and terms. |
| `merchant_compare` | Compare route, price and application changes with the active or specified previous release. |
| `merchant_activate` | Select a release using its digest and the current selection generation. |
| `merchant_start` | Start that selection through the original foreground seller launcher. |
| `merchant_status` | Inspect selected and running releases, history, readiness, and which process owns the seller. |
| `merchant_catalog` | Read actual seller health, offers and OpenAPI from that process-owned instance. |
| `merchant_client_export` | Export the original JS client, TypeScript declarations, OpenAPI and guide into a new named customer directory. |
| `merchant_rollback` | Select an exact retained release through original rollback history. |
| `merchant_restart` | Drain the owned instance and start the selected version. |
| `merchant_stop` | Gracefully drain only the instance owned by this MCP process. |
| `merchant_discovery_status` | Compare a retained release with current signed catalog listings and reconcile the original history. |
| `merchant_discovery_review` | Review publication of the running release or withdrawal of one listed route; no key access or signature. |
| `merchant_discovery_apply` | Apply this host's exact latest review through the original signed catalog batch or withdrawal. |
| `merchant_cache_status` | Inspect the current original per-route cache policy, occupancy and source counters. |
| `merchant_cache_invalidate` | Invalidate one route or all caches on the exact seller instance owned by this MCP host. |

For complete signed publication, updates, withdrawal and cache operation, follow
the [merchant operating workflow](./OPERATIONS.md). Initialization accepts
`--catalog CATALOG_CONNECTION_JSON`, or an existing host configuration can
reference that private connection with `catalogConnection`. The original
catalog directory and signing-key file stay on the host. These tools use both
the existing HTTP provider and its existing stdio entrypoint.

For example, call `merchant_sources` with `{"source":"initial"}`, then
`merchant_stage` with `{"source":"initial","id":"release-1"}`. Inspect and
compare `release-1`; use its returned `digest` as `expectedDigest`, and the
current status or comparison `generation` as `expectedGeneration` when
activating it. Supply a short reason. `merchant_start` takes the resulting
selection generation and the same release digest. It returns a status with
`operator.instanceId`; use that exact instance for catalog, client export, stop
or restart. Client export also takes a new ID such as `customer-1`.

Changing selection leaves the currently running seller on its original release.
Status reports `RESTART_REQUIRED`. Inspect the comparison and call
`merchant_restart` with the current generation, target digest and owned instance
to apply it. Rollback follows the same sequence and preserves the original
release history. If startup fails after a restart's stop, the seller stays
stopped; `merchant_status` records the failure and selected version.

Only one mutating tool runs at a time within this operator. The original release
store's generation and process locks preserve changes made by other consoles.
An existing process owned by another console is visible but cannot be stopped
or adopted through MCP. A request interrupted after a side effect is reconciled
by inspecting the original release ID, generation or instance; the server does
not automatically replay tools. Customer output publication is exclusive, so a
repeated export ID cannot replace an existing delivery.

Closing MCP waits for its accepted mutation and drains the original seller it
owns. A crash preserves the existing release store and original process record;
the original SF82 recovery behavior determines whether a seller is still alive.
Private response content and handler paths are omitted from normal release
results. Exact public payment terms, application hashes and original native or
challenge-only mode remain visible.

## Prepared DuckDB and Parquet merchants

The original prepared DuckDB package is a source alias for this same operator:

```sh
starforge merchant-mcp init --dir /private/data-merchant \
  --duckdb-package /private/duckdb-workspace/packages/PACKAGE_ID \
  --duckdb-python /private/duckdb-venv/bin/python --seller-port 8423
```

`merchant_sources` inspects exact package, query-declaration, plan and dataset
hashes with the public routes and terms. `merchant_stage` retains the complete
original package and copies its declared data into the existing release store.
Source aliases use `duckdbPackage` and optional `duckdbPython` fields; those
host-selected paths are hidden from MCP source and release views. The normal
inspect, compare, activate, start, restart, stop, rollback, customer-client and
discovery tools operate the same native merchant. Dataset-only changes are
visible in the release comparison.

The [DuckDB release guide](../../stellar/scf-starforge-20261009/sf82-seller-pilot/DUCKDB_RELEASES.md)
documents two-version operation, retained packages, the original reader and
facilitator, graceful worker shutdown, console use and reopen after the original
authoring workspace has moved.

## Source and focused integration exercise

`exercise.mjs` runs one complete loopback session using the original SF61
compiler, immutable SF82 release store, real SF30 challenge-only child process,
MCP HTTP transport and generated customer SDK. It stages two prices, handles a
stale generation, starts, exports the actual client, activates/restarts,
rolls back, rejects another process's stop attempt and gracefully closes.
It also checks the existing buyer MCP entrypoint after transport extraction.
No wallet, payment, hosted Actions or broad test suite is involved.

```sh
node stellar-forge/mcp-merchant-operator/exercise.mjs
```

Original integration sources:

- [SF82 releases](../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs)
- [SF61 importer](../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/README.md)
- [SF30 seller and SDK](../../stellar/scf-starforge-20261009/sf30-seller-sdk/README.md)
- [Shared authenticated MCP HTTP transport](../mcp-paid-agent/http-tools.mjs)
- [MCP tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [MCP transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)

## Retained merchant accounting

The same provider operates the original merchant accounting workspace, completed-receipt recovery, reconciliation tables, named exception reviews, comparison and exact retained response/report/TAR retrieval. Configure host-selected source aliases with `init-accounting --dir NEW_DIRECTORY --accounting ACCOUNTING_JSON`, attach `--accounting` to an existing source initializer, or add the optional accounting configuration to an existing private merchant host. The original workspace owns revisions, source capture, verification, reports and its lease; no new payment is required to recover a completed purchase.

See [ACCOUNTING.md](ACCOUNTING.md) for the complete installed and subprocess workflow, asynchronous job status, original source selection, SHA-pinned file chunks and durable reopening. Existing release, Python, DuckDB, discovery and fleet operations use the same provider.
