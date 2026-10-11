# Set up the first managed fleet

The original setup command takes registered merchant sources and public hosts,
initializes their SF82 release stores, stages and selects the initial releases,
and publishes the ordinary fleet release plan. The resulting plan opens in the
existing terminal, browser workspace, and merchant MCP. Later releases use the
same operator's review, activation, drain, retirement, and rollback lifecycle.

Run these commands from `stellar/scf-starforge-20261009/merchant-fleet-gateway`.
Node and Linux `flock` are required by the existing fleet operator. Native source
types retain their original dependencies: prepared DuckDB packages use their
declared Python interpreter; Python applications use their original declaration.
SQLite uses the original Node `node:sqlite` capture worker. MySQL and MariaDB use
the original prepared package, installed `mysql2`, and connection environment
references available to the foreground process.

## Declare the merchants

Save `fleet-setup.json` beside the paths from which you want to resolve package
sources. This example registers a prepared data package and a Python merchant:

```json
{
  "schema": "stellar-forge.fleet-bootstrap.v1",
  "gateway": { "port": 8400, "adminPort": 8401 },
  "merchantPortStart": 8521,
  "slots": ["blue", "green"],
  "tenants": [
    {
      "id": "data",
      "host": "data.example.com",
      "packages": {
        "current": {
          "duckdbPackage": "./packages/data",
          "duckdbPython": "/opt/merchant-python/bin/python"
        },
        "next": {
          "duckdbPackage": "./packages/data-next",
          "duckdbPython": "/opt/merchant-python/bin/python"
        }
      },
      "initial": { "package": "current", "releaseId": "initial", "label": "Initial data release" }
    },
    {
      "id": "application",
      "host": "application.example.com",
      "packages": {
        "current": { "python": "./application/merchant.json", "pythonRoot": "./application" }
      },
      "initial": { "package": "current", "releaseId": "initial" }
    }
  ]
}
```

Use the actual host declared by each original package. Setup checks the staged
release's `publicOrigin` against `https://` plus that exact host before selection.
Package aliases use the original `normalizeFleetPackageSource` validator. An
existing API workspace is registered as `{ "workspace": "./saved-workspace" }`;
all supported native source selectors follow the same original registration
rules. Optional `runtime` settings belong inside each package registration, as
described in [RELEASE_OPERATOR.md](RELEASE_OPERATOR.md).

For SQLite, register `{ "sqlitePackage": "./exports/inventory" }` using the
original six-file workbench export. The database referenced by its `source.json`
must be readable during setup. Optional `sqliteSnapshotMaxBytes` and
`sqliteSnapshotTimeoutMs` fields belong beside `sqlitePackage`; the original
capture defaults are 1073741824 bytes and 120000 milliseconds. Setup captures
committed data, including committed WAL changes, in the initial retained release.
Later database edits enter the fleet through a new staged snapshot.

For a live MySQL or MariaDB merchant, register
`{ "mysqlPackage": "./packages/catalog" }`. The original prepared package retains
named queries, offers, connection references, and any package-local CA. Starting
the resulting fleet opens the configured live database using the host's declared
environment variables. Each package must declare its own exact merchant host.

The declaration accepts 2–32 distinct tenant IDs and hosts, 1–32 package aliases
per tenant, and 2–4 distinct common slots. The first slot is the startup slot.
Slot ports are assigned consecutively in tenant order, then slot order: the
example uses 8521/8522 for data and 8523/8524 for the application. Gateway, admin,
and every slot port must be distinct. The defaults shown above apply when
`gateway`, `merchantPortStart`, or `slots` is omitted. Optional tenant `limits`
use the existing fleet's `maxInFlight`, `maxRequestBytes`, `maxResponseBytes`, and
`timeoutMs` fields.

## Initialize, resume, and inspect

```sh
node release-cli.mjs setup --declaration ./fleet-setup.json --directory ./private-fleet
node release-cli.mjs setup-status --directory ./private-fleet
```

The directory may be absent or empty. Setup makes an empty directory private,
takes the original fleet lease, and retains its exact normalized intent before
creating any store. It probes and holds all declared loopback ports for the
duration of setup, releasing those temporary reservations before returning.
The fixed declarations remain in the published plan. Starting the original
operator acquires the actual listeners.

Progress is emitted as JSON events; the final JSON status includes `planFile`,
`directory`, `planDigest`, per-store native progress, and the exact `mcpFleet`
configuration. Output paths are:

| Path in the private directory | Purpose |
| --- | --- |
| `bootstrap.json` | Retained setup intent, native release digests, and progress |
| `fleet-plan.json` | Published original `stellar-forge.fleet-release-plan.v1` plan |
| `stores/TENANT/SLOT` | Separate original SF82 release store for each fixed slot |
| `bootstrap-plan.pending.json` | Original plan validated before publication |
| `recovery/` | Preserved setup-owned incomplete initializations, when needed |

Use `--plan /absolute/output/fleet-plan.json` to select another output file. The
file is created atomically with private permissions; a different existing plan
is preserved. The same setup declaration, directory, and output path resume the
same operation. After a port conflict, free the conflicting port and repeat the
command. After a process interruption, repeat it directly.
SIGINT, SIGTERM, or an embedding `AbortSignal` also reach a pending original
SQLite capture. The native worker closes and the incomplete stage is removed;
the retained setup intent permits the same command to resume. Successfully
committed releases remain available for the original checkpoint reconciliation.

Setup recovers an original immutable release committed before its progress
checkpoint by inspecting that release in its reserved store. It recovers an
already selected initial release from the native generation and history. These
steps use the retained source snapshot even if its input package has since
moved. An incomplete original initialization is preserved only when the journal
owns that exact store and it contains no releases or unrelated entries; setup
then invokes the original initializer again. A completed setup returns its
retained result and preserves subsequent release selections and fleet history.

Changing the initial declaration changes the operation. Use the published
operator for later releases; use a new private directory for a separate fleet.

## Open the same retained fleet

Terminal:

```sh
node release-cli.mjs start --plan ./private-fleet/fleet-plan.json --directory ./private-fleet
```

Browser:

```sh
node workspace/server.mjs --releases ./private-fleet/fleet-plan.json --release-state ./private-fleet --port 8402
```

Open the printed local workspace URL. Its normal catalog, staged release review,
activation, rollback, and retirement controls operate on the initialized stores.
Close the current foreground owner before opening another interface, so the
original lease and drain behavior continue to govern one retained fleet.

Initialize the existing merchant MCP with this same retained directory:

```sh
starforge merchant-mcp init-fleet --dir ./merchant-mcp --plan ./private-fleet/fleet-plan.json --fleet-directory ./private-fleet
```

The explicit `--fleet-directory` uses the setup's original manager state. When
adding the fleet to an existing host configuration, set its `fleet` field to the
exact `mcpFleet` object returned by setup:

```json
{
  "fleet": {
    "planFile": "/absolute/private-fleet/fleet-plan.json",
    "directory": "/absolute/private-fleet"
  }
}
```

Preserve the rest of that host configuration. Omitting `--fleet-directory` from
`init-fleet` chooses a new `./fleet` directory under its configuration directory;
the explicit option or field above reopens this setup. Call
`merchant_fleet_plan`, then `merchant_fleet_start` with its returned
`expectedPlanDigest`. All three interfaces use the same original release stores,
gateway state, and retained release mapping.

Host integrations can import `bootstrapFleet({ declarationFile, directory,
planFile, signal, onProgress })` or `readFleetBootstrapStatus({ directory })`
from `release-bootstrap.mjs`. `onProgress` is awaited between native operations;
an interruption leaves the matching intent available for the next call.
