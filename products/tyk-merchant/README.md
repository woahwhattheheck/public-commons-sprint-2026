# Tyk API operations product

Manage a complete Tyk API portfolio through the original Gateway or Dashboard,
retain its exact source definitions, review native changes, and hand the full
workspace to another operator.

The installed product opens one saved Tyk workspace and browser. The same
workspace supplies the typed SDK, command-line operations and merchant MCP
provider. It retains target revisions, complete captures, named API cohorts,
native request reviews, original responses, active-state reconciliation and
complete source/history deliveries.

The command is `starforge tyk-product`. The selected package also provides the
`tyk-merchant` executable. In the Runtime workspace, select
**Applications → Tyk API operations**.

## Open the product

Use the complete [installation guide](../../stellar/scf-starforge-20261009/distribution/selections/TYK_MERCHANT.md)
to build and receive the selected source and runtime. The product requires
Node 24 and the original Linux `flock` lease support. Its workspace and native
Tyk transport use Node built-ins; the optional merchant agent uses the selected
MCP runtime.

~~~sh
umask 077
mkdir -p /srv/private
chmod 700 /srv/private

starforge tyk-product init --dir /srv/private/tyk-product \
  --name "API operations"
starforge tyk-product review --dir /srv/private/tyk-product
starforge tyk-product open --dir /srv/private/tyk-product --port 0
~~~

Open the private URL returned by `open`. Add the existing Gateway or Dashboard
base URL and a credential environment-variable name. Supply that variable
through the original host environment or the Runtime workspace's private
environment file. Target records retain the variable name; its value stays in
the native process environment.

To continue an existing native Tyk workspace, pass its original path to
`init --workspace /srv/private/original-tyk-workspace`. Initial connection
declarations may also be supplied through a private `--connections` JSON file.
Saved native target revisions stay authoritative on later Open operations.

## Work through the same saved records

1. Capture the target's complete inventory and original definitions.
2. Save an explicit API cohort from one immutable capture revision.
3. Prepare the native Gateway create/import/update or Dashboard migration
   request. Review the target preimage, selected IDs and original payload.
4. Execute the saved request, then read the retained native response and
   affected active definitions.
5. Export the full workspace and receive the complete original handover.

Gateway writes and Gateway activation have separate native states.
**ACCEPTED** means an original save receipt exists while active configuration
still needs a reload. Prepare and execute an explicit node or group reload to
activate it. **CONFIRMED** means the corresponding active definition was
observed. Dashboard migration uses its original dry-run, stage, promote and
direct modes.

The [operating guide](OPERATING.md) covers target selection, captured-source
adaptation, cohort revisions, reviewed dispatch and recovery. The
[receiving guide](RECEIVING.md) covers the full NDJSON file, exact-byte download,
inspection, adoption and restart.

## SDK and CLI

~~~sh
starforge tyk-product actions
starforge tyk-product status --dir /srv/private/tyk-product
starforge tyk-product records --dir /srv/private/tyk-product \
  --kind rollout --offset 0 --limit 50
~~~

The public `./products/tyk-merchant/client` export includes the
[typed client](client.d.mts). `TykProductClient` rereads the original private
connection record after a restart, delegates each operation to the same HTTP
workspace, and streams native deliveries to complete private files.

A normal Stop drains the original workspace and closes its writer. A later
Open keeps its workspace UUID, source histories, saved requests and completed
receiving records.

## Complete cohort commissioning

The same installed workspace now carries a saved Dashboard cohort through native
conversion, source review, staging, per-API operational acceptance, promotion and
complete final handover. Its original rollout dispatcher and native journal remain
the write owners. The maintained OperatingPlan stores complete manuscript editions
and supporting files in that same workspace. See [OPERATING.md](OPERATING.md) for
the seven-step browser and typed SDK/CLI course, and [RECEIVING.md](RECEIVING.md) for
the complete source and native receiving path.

The original shared catalogue exposes 22 workspace actions and 28 Tyk MCP tools.
Actual native and rendered results remain attached to the original receiving
operation; source availability alone does not establish customer-facing readiness.
