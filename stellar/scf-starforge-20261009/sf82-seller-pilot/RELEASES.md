# Seller configuration releases

Prepare a changed API, inspect its exact payment and application changes, select
it for the next start, and return to a retained version when needed. This is an
extension of the original SF82 seller launcher. It uses the original SF61
OpenAPI compiler or SF30 Python merchant compiler and starts the original SF30
seller through the source's original launcher.

The release store keeps the OpenAPI-derived offers, service configuration and
JSON response snapshots together. Selecting a release does not rewrite a
running seller. Status and the operator console show the selected and running
release separately, including when a restart is needed.

For a facilitator change on an already prepared merchant, use
[Retained facilitator review](FACILITATORS.md). It reads actual native capabilities,
retains every generated payment alternative with the same source, and checks that
review at native startup. The original console, CLI and MCP complete selection,
restart and rollback through this release store.

## First release

From the repository root, with Node.js 22 or later:

```sh
node stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs init \
  --store /tmp/merchant-releases

node stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs stage \
  --store /tmp/merchant-releases --id first --label "Initial weather API" \
  --spec stellar/scf-starforge-20261009/sf61-openapi-seller-import/openapi.example.json \
  --config stellar/scf-starforge-20261009/sf61-openapi-seller-import/service-selections.example.json \
  --bindings stellar/scf-starforge-20261009/sf61-openapi-seller-import/service-bindings.example.json \
  --port 0

node stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs diff \
  --store /tmp/merchant-releases --to first

node stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs activate \
  --store /tmp/merchant-releases --id first --expect 0 --reason "Initial local pilot"

node stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs run \
  --store /tmp/merchant-releases --expect 1
```

The example uses the original deliberately nonpayable terms. Its real seller
responds with HTTP 402 in `CHALLENGE_ONLY` mode. Port 0 selects an available
local port; the command prints the actual listener. Ctrl-C stops that seller.

Use a directory that does not exist for `init`. Each staged release needs a
new ID. Failed compilation leaves existing releases and active selection intact.
Incomplete staging directories are removed by the staging command.

## Prepare and roll out a change

Copy or edit your original OpenAPI document, payment selections and bindings.
Stage them under another ID using the same command, then compare:

```sh
node stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs diff \
  --store /tmp/merchant-releases --to second
```

The comparison defaults to the currently selected release. `--from first`
compares any two retained releases. It reports:

- added, removed and changed method/path pairs;
- the exact original payment alternatives, including atomic amount strings,
  asset, recipient, network, scheme and timeout;
- changed request metadata and input contracts;
- handler/admission bindings, input-validation settings and response digests;
- facilitator, port and handler-entry changes;
- backend origin/path/query, credential environment references, response-contract
  digest, availability, durable-operation configuration, shared-result policy and
  source limits for upstream routes.

OAuth API releases retain the original declared token endpoint, client environment
references, scope and lifecycle settings. Staging and inspection use the original
credential-reference reader with syntax-only values; they do not read merchant
credentials or call the token endpoint. The original provider resolves current
credentials when the retained release starts. Releases without OAuth retain their
previous metadata shape.

It does not print static customer response contents. Amounts remain their
original atomic strings. The tool does not infer token decimals or convert
prices to dollars.

The comparison includes the current selection generation. Supply that value
to `activate --expect GENERATION`. If another operator changed the selection
after your comparison, the write reports `RELEASE_CONFLICT` and preserves that
operator's work. Refresh the comparison to act on the new state.

Selecting a release changes only the durable selection. The original seller
continues serving its current configuration until its manager stops it. In a
terminal, stop the foreground seller and run the selected release again.
The console offers the same sequence with its **Restart selected** action.
Restarting briefly interrupts service.

## Retained rollback

```sh
node stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs status \
  --store /tmp/merchant-releases

node stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs rollback \
  --store /tmp/merchant-releases --expect 2 --reason "Return to previous configuration"
```

By default rollback selects the previous release. Use `--to RELEASE` to
select another retained version. As with activation, stop and start the seller
to apply it. Every selection records its generation, time, reason, previous
release and selected release. Failed startup never deletes a retained version
or silently changes the selection. If a restart fails, select the known
configuration and start it.

The store does not delete old releases. It is a local deployment workspace;
the separate seller-recovery workflow handles moving or restoring a deployment
between machines.

## Operator console

```sh
node stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs console \
  --store /tmp/merchant-releases --port 8425
```

Open the exact operator URL printed by the command. The interface includes
prepared releases, a before/after change review, selection and rollback,
process start/stop/restart, live original health/offers readback and retained
selection history. Its restrained layout uses no external fonts, scripts,
services or CDNs.

The console binds to loopback. Each invocation generates an in-memory operator
token, placed in the printed URL fragment and retained in that browser tab's
session storage. Private reads require that token. Writes additionally require
the exact local browser origin. The server rejects cross-origin requests and
unexpected Host values. Do not expose or reverse-proxy this local control
surface as a public merchant endpoint.

The console can stop only the seller it started, and its actions bind to that
specific instance. A seller owned by another terminal remains visible, with
instructions to stop it there. Closing the console command stops its own
seller; closing the browser tab leaves the command running. A separate
`run` process can be used when the operator UI is not needed.

## Release a prepared MySQL merchant

The original MySQL CLI and browser produce a complete merchant package accepted by
`stage --mysql-package PREPARED_DIRECTORY`. Its retained query declarations, exact
parameter rules, public payment choices, connection profile, optional database CA
and original client enter this same release store. The console compares source and
price changes, operates the original native seller, and restores a reviewed version
through its existing rollback controls.

See [Operate retained MySQL merchants](MYSQL_RELEASES.md) for the complete
CLI and merchant MCP workflow. Queries use current database rows; release rollback
restores the selected query and customer terms. For immutable rows, use the original
MySQL dataset publisher.

## Release an existing API merchant

An API package saved by the original SF61 workspace can now become a retained
release directly:

```sh
node stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs stage \
  --store /private/merchant-releases --id api-first \
  --workspace /private/api-project --port 0
```

The original workspace reader verifies its saved package before staging. The
release records the package identity and original OpenAPI digest, and checks the
actual staged compiler inputs against those saved hashes. Its original loopback
choice is retained. This command does not reopen or import the package's backend.

For separately prepared inputs, use the original files together:

```sh
node stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs stage \
  --store /private/merchant-releases --id api-first \
  --spec /private/api-project/facade-openapi.json \
  --config /private/api-project/selections.json \
  --bindings /private/api-project/route-bindings.json \
  --upstreams /private/api-project/upstreams.json --port 0
```

Supply the existing facilitator to stage a native runtime. The same command
also accepts an original `seller-upstreams.v1` file prepared outside the workspace.
`--handlers` and `--upstreams` select distinct original runtime configurations;
choose one. A development source on `http://127.0.0.1` additionally requires
`--allow-loopback-upstream`, which is retained with that release.

Staging validates the original upstream schema and route bindings, then retains
the exact JSON bytes in a private digest-named snapshot. Environment names are
validated without reading credential values. The snapshot includes the source's
configured response contract, availability, original POST idempotency references
and optional GET/HEAD cache policy.
Inspect, comparison, selection and startup verify the retained digest. Editing
the input file later has no effect on an existing release; stage a new version
to change its origin, policy, mapping or limits. Existing response files and
handler-based releases keep their original workflow.

Each start resumes the original SF82 pilot using that exact upstream snapshot
and fresh launch environment. Update the manager's environment and restart to
apply a credential rotation; change a credential reference by staging a new
release. An upgrade or rollback starts an empty process cache with the selected
policy and current credentials. It does not restore prior cached data or secret
values. Original payment terms and every request's native lifecycle remain in
the seller.

## Release a Python project

Use the original SF30 `stellar-forge.python-merchant.v1` declaration to stage a
Python merchant in the same release store:

```sh
node stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs stage \
  --store /private/merchant-releases --id python-first \
  --python /private/python-project/merchant.json \
  --python-root /private/python-project --port 0 \
  --facilitator https://YOUR_ACTUAL_FACILITATOR
```

Choose `--python` as the source selector. The declaration defines functions,
typed inputs, JSON or byte output, native payment terms, worker concurrency,
pending capacity, timeouts, lifecycle hooks and required environment names using
the original [Python merchant format](../sf30-seller-sdk/python/README.md).
Staging invokes its original compiler without importing the application,
starting Python or making a network request.

The release retains the exact declaration, a runtime declaration that points to
the retained entry, and a private source snapshot. By default the snapshot
contains only the entry module. With `--python-root`, it contains the selected
project tree, including local helpers and assets. That directory must contain
the entry; the release store must be outside it. Helpers beside the entry use the
original worker's import path. Resolve adjacent assets from `__file__`, since the
worker preserves its original working-directory behavior.

The snapshot excludes `.git`, `.hg`, `.svn`, `.venv`, `venv`, `__pycache__`,
`.pytest_cache`, `.mypy_cache`, `.ruff_cache` and `node_modules` directories, plus
`.pyc` and `.pyo` files. It rejects symlinks and special files. At most 512 source
files and 32 MiB are retained, with 8 MiB per asset and 2 MiB for the entry.
Inspection verifies the complete retained set, including additions and removals,
then recompiles the exact original offers and service configuration.

Use the existing `diff`, `activate`, `run`, `status`, `rollback` and console
commands for this release. Comparison reports entry/helper/asset changes through
the source and execution digests and shows worker, environment-name, function
contract, lifecycle and payment changes. A price-only change remains visible in
the original payment comparison. Already staged releases continue to run after
the original project is edited or removed.

The selected Python executable and its installed third-party packages remain
external to the snapshot. An absolute executable path is retained. A relative
selector containing a path separator, such as `.venv/bin/python`, is anchored to
the staging process's working directory, matching the original spawn semantics.
A bare executable name such as `python3` is selected through the launch PATH.
Keep an interpreter environment available for each retained version that needs
it. Environment values are read afresh at launch and are never bundled.

At startup the existing release child launches the original Python merchant with
the retained application hash. The real seller's health and complete offer
digest must match the release before it becomes ready. The original worker pool
uses `-B` so helper imports do not add bytecode files to the source snapshot.
Restart and rollback create a new pool and invoke the selected original startup
and shutdown hooks. Closing drains the original seller first, then closes its
workers. On POSIX hosts, a forced shutdown or failed seller leader terminates the
specifically owned process group so its Python children cannot be left behind.
The default manager deadline allows the seller's 60-second drain and the
configured Python shutdown interval to finish.

Without a facilitator, the original seller runs in `CHALLENGE_ONLY` mode and
starts no Python workers. Native operation uses the installed official x402 SDK
and the configured facilitator. No release command performs a buyer request.

The same source is available through [merchant MCP](../../../stellar-forge/mcp-merchant-operator/README.md#use-an-existing-python-merchant)
as a host-configured `python` alias with optional `pythonRoot`; all twelve tools
and the original customer SDK export apply.

## Operate the running source cache

For upstream routes with an explicit shared-read policy, the existing release
console shows the actual running instance's configured TTL, source capacity,
retained bytes and original source counters. Invalidate one route after its
content changes, or all cached routes. Routes using the same upstream binding
share its cache; the result reports every affected route.

The console can invalidate only its own running seller instance. Terminal
operators can use the same private control transport explicitly:

```sh
node stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs cache-status \
  --store /private/merchant-releases

node stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs cache-invalidate \
  --store /private/merchant-releases --instance INSTANCE_FROM_STATUS --route ROUTE_ID
```

Use `--all` instead of `--route` for all cached routes. A stale instance ID is
refused, so a control saved before restart cannot affect the replacement seller.
Status and invalidation use the already shipped response-cache control module:
a fresh mode-0600 descriptor for each process, an authenticated loopback channel
and a private operator directory. No cache-control command is mounted on the
public seller. Startup reports readiness after the original seller and its
required controls are ready; shutdown drains the original seller and closes its
control transport. Process memory is discarded, while immutable configurations
and the existing selection history remain.

## Publish and retire catalog listings

The existing console includes first-run discovery setup from the selected retained
release: review its exact public enrollment, create the private identity once,
start the original writer, publish, download public enrollment, and reopen the
same key and journal. `console --store DIR` selects `DIR.discovery` as its fixed
setup destination; `--discovery-setup DIRECTORY` chooses another host destination.
Closing the console drains its own seller and writer. See the complete
[discovery setup workflow](./DISCOVERY_SETUP.md#complete-setup-in-the-merchant-console).

For an existing catalog managed by another process, supply
`console --catalog CONFIG_JSON` to review exact current
offer differences, publish with the merchant's existing seller-proof key, and
withdraw a selected listing. The original SF50/SF60/SF95 implementations retain
signing, pinned admission, atomic publication and withdrawal. See the complete
[merchant catalog workflow](./CATALOG.md) for configuration and CLI commands.

## Application code and native payment runtime

For handler or admission exports, supply `--handlers /absolute/application.mjs`
when staging. Staging reads and pins that entry module without importing it.
Activation and startup verify its original hash. Use immutable versioned
application paths if older releases must remain runnable. The entry module is
not bundled: its imported files, package dependencies and environment variables
remain operator-managed. A release is not a snapshot of the entire application
or its secrets.

For native x402, stage the real existing facilitator with
`--facilitator https://YOUR_ACTUAL_FACILITATOR`. The original runtime loads its
installed official x402 packages. For an explicitly local facilitator, use
`--allow-local-facilitator` with a `http://127.0.0.1:PORT` URL. No signing,
payment verification, settlement, request routing or payment retry engine is
added by the release manager.

Each start launches the original foreground pilot in a fresh Node process, so
trusted handler imports do not reuse a prior release's module cache. Startup
checks the original source identities, actual local health and original
offered payment terms. Those observations show which configuration is running;
they do not establish a payment or a customer's delivery.

The manager owns one seller process per store. It gives that process a normal
shutdown interval, then terminates that owned child if needed. A surviving
child after a manager crash is shown as an orphan rather than permitting a
second seller to start over it. Use the recorded process and original terminal
to recover it; the console does not kill arbitrary local PIDs.

An embedding fleet manager can call `runActiveRelease(store, { handleSignals:
false })` to own its shutdown order: close gateway ingress, drain accepted
gateway work, then await the returned session's `close()`. The default remains
`true` for the existing terminal and console workflows. The seller's original
drain and the release manager's process ownership still apply in either mode.
For a replacement staged in a separate store, use
`compareReleases(nextStore, currentId, nextId, { beforeRoot: currentStore })`.
Both releases undergo the same original source checks and produce the same
route, payment and runtime comparison as releases in one store.

## Store layout

| Path | Content |
| --- | --- |
| `state.json` | Selected release, previous release, generation and selection history |
| `releases/ID/manifest.json` | Original SF61 export manifest or Python source manifest |
| `releases/ID/offers.json` | Original compiled seller offers |
| `releases/ID/seller-service.json` | Original SF30 service configuration |
| `releases/ID/responses/` | Original SF61 JSON response-file snapshots, when used |
| `releases/ID/python/declaration.json` | Exact original Python merchant declaration, when used |
| `releases/ID/python/merchant.json` | Original declaration with retained application and interpreter selection |
| `releases/ID/python/source/` | Retained Python entry, helpers and assets |
| `releases/ID/release.json` | Source/file digests, exact route summary and pinned runtime settings |
| `releases/ID/pilot-runtime.json` | Original mutable pilot runtime options |
| `releases/ID/runtime-readiness.json` | Original pilot's most recent startup observation |
| `runtime.json` | Release-manager process identity, listener and exit observation |
| `state.lock`, `run.lock` | Local operation/process ownership |

New directories use mode 0700 and files use 0600 where supported. Selection
and runtime records use flushed temporary writes and atomic replacement.
Digests detect source drift within the operator's controlled store; they are
not an independent signature from another party. Keep the store private and
operate it on one host.

## Focused local exercise

```sh
node stellar/scf-starforge-20261009/sf82-seller-pilot/release-acceptance.mjs
```

This uses the real original compiler and foreground seller in the cloud/local
Linux runtime. It prepares two releases, compares price/application changes,
starts actual challenge endpoints, changes selection while the first release
is running, rejects a stale selection write and duplicate process, upgrades,
then rolls back through the real local operator HTTP interface. It also checks
operator-token/origin behavior and preserves the source snapshot after its
input file changes. It starts no hosted Actions and submits no payment.

## Customer SDK handover

The same release console now generates, reviews and retains the original customer
SDK, including every original payment option and its completion receipt. Use
`console --store DIR --client-exports PRIVATE_CUSTOMER_DIRECTORY` to share an
existing MCP merchant's `exportsDirectory`; the default is `DIR.clients`.
The retained list, exact-file inspection, reviewed legacy adoption, complete
client archive and individual byte-range downloads remain available after seller
shutdown and console reopening. See [CLIENT_HANDOVER.md](CLIENT_HANDOVER.md) for
the complete operator, customer, recovery and original MCP workflow.
