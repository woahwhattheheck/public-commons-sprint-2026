# Retained DuckDB merchant releases

An original prepared DuckDB or Parquet merchant can enter the existing SF82
release manager. Each release retains the complete generated package and copies
only its declared datasets. The same release store, comparison, generation,
activation, rollback, foreground child, browser console, merchant MCP, discovery
and customer-client operations continue to operate that native seller.

Use Node 22.16+ and a Python executable with the original DuckDB dependency.
Prepare the source using `starforge duckdb-workspace` (also available under
`duckdb-workbench`) or the original `duckdb/prepare-cli.mjs`. Select the complete
package directory displayed after **Prepare package**. Its original manifest,
source declaration, public plan, service, bindings, data, API and client files
remain together. The release store must be outside that package.

## Stage and compare two versions

Create the release store in an existing private parent, then stage a package:

```sh
starforge releases init --store /private/merchant-releases
starforge releases stage --store /private/merchant-releases --id october-11 \
  --duckdb-package /private/duckdb-workspace/packages/FIRST_PACKAGE_ID \
  --duckdb-python /private/duckdb-venv/bin/python --port 8423 \
  --label 'October 11 data and terms'
```

For the next dataset or merchant-plan revision, prepare a new package in the
same native workspace and stage it under another release ID:

```sh
starforge releases stage --store /private/merchant-releases --id october-12 \
  --duckdb-package /private/duckdb-workspace/packages/SECOND_PACKAGE_ID \
  --duckdb-python /private/duckdb-venv/bin/python --port 8423 \
  --label 'October 12 data and terms'
starforge releases diff --store /private/merchant-releases \
  --from october-11 --to october-12
```

Staging streams and checks the copied dataset bytes; it neither loads arbitrary
application modules nor opens a seller listener. The original package verifier
checks generated files and reuses the original merchant-plan compiler. The
release adapter retains those outputs rather than compiling an alternative SQL
or payment implementation. A new ID is required for each retained release.

Comparison includes the original public request contracts and exact atomic
payment strings. DuckDB execution metadata separately identifies the source
declaration, plan, dataset set, package manifest, native engine version and
configured interpreter. Dataset-only changes therefore remain visible even
when public routes and payment terms are unchanged. SQL and dataset rows stay
inside the private retained package.

## Select, run and roll back

Read the current generation from `status` or `diff` and supply it to the normal
selection command:

```sh
starforge releases status --store /private/merchant-releases
starforge releases activate --store /private/merchant-releases \
  --id october-11 --expect CURRENT_GENERATION --reason 'Initial data release'
starforge releases run --store /private/merchant-releases
```

The foreground process uses the original DuckDB prepared launcher, reader,
admission, SF30 seller and facilitator client. The printed loopback address
serves the original health, offers, OpenAPI and developer endpoints. With no
facilitator selected during staging, the original seller returns HTTP 402
offers. For the existing merchant payment service, include
`--facilitator HTTPS_URL` in the stage command. The explicit
`--allow-local-facilitator` option supports the original loopback configuration.

Activation selects the next run; an already running process retains its current
package. Stop it with Ctrl-C, then run the selected release. Alternatively, open
the existing console to compare, select, start, stop and roll back in one place:

```sh
starforge releases console --store /private/merchant-releases --port 8425
```

The original manager owns the child and its DuckDB query-worker group. Graceful
shutdown drains the original seller before closing the source; the existing
hard-stop deadline covers that owned worker group as well. A restarted manager
reopens its release state and copied packages independently of the original
authoring workspace. Keep the configured Python environment available.

To select the retained previous version, use its current generation:

```sh
starforge releases rollback --store /private/merchant-releases \
  --expect CURRENT_GENERATION --reason 'Restore the previous data release'
```

The original comparison and selection checks verify the complete retained
package, including dataset bytes. A changed, removed or corrupt retained file
requires restoring that file or staging the corrected data as a new release.
The catalog commands and the existing release-console discovery panel consume
the same original `seller-service.json` and native offers for this source type.

## Operate the same release from MCP

Initialize the existing merchant MCP host with the prepared package:

```sh
starforge merchant-mcp init --dir /private/duckdb-merchant-operator \
  --duckdb-package /private/duckdb-workspace/packages/FIRST_PACKAGE_ID \
  --duckdb-python /private/duckdb-venv/bin/python --seller-port 8423 \
  --name 'Product data merchant'
```

The configuration records a host-selected source alias. Add later package
aliases to the same `sources` object in `merchant-mcp.json`:

```json
{
  "october-12": {
    "label": "October 12 prepared data",
    "duckdbPackage": "/private/duckdb-workspace/packages/SECOND_PACKAGE_ID",
    "duckdbPython": "/private/duckdb-venv/bin/python",
    "runtime": { "port": 8423 }
  }
}
```

Use the existing stdio or authenticated HTTP merchant host. `merchant_sources`
inspects a configured alias, exposing exact data/configuration hashes and public
terms while keeping local data locations, SQL and interpreter paths private.
`merchant_stage` retains that alias in the existing release store.
`merchant_inspect` and `merchant_compare` return the current digest and generation
for activation. `merchant_start`, `merchant_restart`, `merchant_stop` and
`merchant_rollback` preserve their original ownership checks and retained
history. An explicit restart follows a changed selection.

`merchant_catalog` reads the actual running seller's health, offers and OpenAPI;
`merchant_client_export` writes its original JavaScript client and TypeScript
declarations. The existing discovery tools publish and retire these original
offers through the configured catalog connection. MCP requests select aliases
and release IDs; host configuration owns filesystem and executable selections.
