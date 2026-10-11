# Operate retained MySQL merchants

A prepared MySQL merchant can use the existing SF82 release store, local console
and merchant MCP. Prepare the merchant with the original MySQL
CLI or browser, then review and operate its retained source through these shared
controls. The same original MySQL query reader and SF30 seller execute each run.

## Prepare and retain a merchant

Install the suite's original MySQL runtime group, including its pinned `mysql2`
dependency. Native payment mode also uses the suite's original x402 dependencies.
Keep merchant packages, release stores and credential configuration outside the
replaceable installed software directory.

The original browser command is `starforge mysql-workspace`. Its saved release
contains a `package` directory with `manifest.json`, `source.json`,
`merchant-plan.json`, `service.json`, `openapi.json` and the original customer
client. The original CLI prepares the same artifact:

```sh
starforge mysql prepare --source /srv/merchant/source.json \
  --plan /srv/merchant/merchant-plan.json --directory /srv/merchant/packages/current

starforge releases init --store /srv/merchant/releases
starforge releases stage --store /srv/merchant/releases --id first \
  --mysql-package /srv/merchant/packages/current --port 8423 \
  --facilitator https://facilitator.example
starforge releases inspect --store /srv/merchant/releases --id first
starforge releases diff --store /srv/merchant/releases --to first
```

Use the prepared package directory as `--mysql-package`. Source-checkout users
can replace `starforge releases` with `node
stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs`, and `starforge
mysql` with the original `sf30-seller-sdk/mysql/cli.mjs` entrypoint.

Staging verifies the original manifest, recompiles the retained merchant plan
with the original contract compiler, and checks that the service and query
bindings match. It copies the declared package files into the private release,
including the original client and optional `database-ca.pem`. It reads no
credential value and opens no database connection. A prepared source's CA must
be the package-local file produced by the original preparation command.

The release exposes its public routes and exact payment alternatives, together
with these identities for operator review:

| Identity | What a change means |
| --- | --- |
| `packageManifestSha256` | A different original prepared artifact |
| `sourceConfigSha256` | A change to retained connection, query, binding or source limits |
| `planSha256` | A change to the reviewed merchant plan |
| `queryDefinitionSha256` | A change to named SQL, projection, parameters or query limits |
| `connectionProfileSha256` | A change to the database connection or credential reference |
| `databaseCaSha256` | A change to the retained database trust certificate |
| `executionSha256` | The combined retained MySQL execution identity |

The existing comparison also shows exact route, request contract and atomic
payment changes. Connection locations and SQL stay in the host's private source
files. Credential reference names identify the environment entries required by
the existing reader. Credential values are resolved afresh when a seller starts.

## Select, run, change and roll back

```sh
starforge releases activate --store /srv/merchant/releases --id first \
  --expect 0 --reason 'Reviewed MySQL source and customer terms'
starforge releases console --store /srv/merchant/releases --port 8425
```

Open the private URL returned by the console. Its existing controls show the
selected release and the actual running release separately. Start the seller,
inspect its original offers, and export the generated customer client through
the existing merchant tools. For a foreground service without a browser, use
`starforge releases run --store /srv/merchant/releases --expect 1`.

Create a new original prepared package for a changed query, projection, public
endpoint, price or connection selection. Give it a new release ID:

```sh
starforge releases stage --store /srv/merchant/releases --id second \
  --mysql-package /srv/merchant/packages/next --port 8423 \
  --facilitator https://facilitator.example
starforge releases diff --store /srv/merchant/releases --from first --to second
starforge releases activate --store /srv/merchant/releases --id second \
  --expect 1 --reason 'Reviewed revised query and exact price'
```

The running seller keeps its current release until the owning console, MCP
session or foreground manager restarts it. The original HTTP drain completes
before the original MySQL reader closes. A new process then verifies the retained
package and opens the database using the current credential environment.

The console can select a retained version and restart it. The equivalent
selection command is:

```sh
starforge releases rollback --store /srv/merchant/releases --to first \
  --expect 2 --reason 'Restore the reviewed original merchant configuration'
```

Read the actual generation from status before each selection. Existing source
digests, generation checks and owned process controls govern the operation.
Original authoring directories may move after staging; the retained package
continues to provide the plan, service, query definitions, CA and customer client.

These releases retain the merchant configuration. Queries read the current
database contents when the buyer's request is admitted. A rollback restores the
retained query and commercial contract; the database continues under its own
transaction and backup lifecycle. For a versioned dataset whose rows must remain
fixed, use the original `mysql-publisher` workflow and its retained dataset buyer
export.

## Use the same merchant MCP tools

```sh
starforge merchant-mcp init --dir /srv/merchant/operator \
  --mysql-package /srv/merchant/packages/current --seller-port 8423 \
  --facilitator https://facilitator.example
```

The resulting private `merchant-mcp.json` selects a fixed source alias. Add
reviewed future source aliases in that host configuration:

```json
{
  "label": "Revised customer catalog",
  "mysqlPackage": "/srv/merchant/packages/next",
  "runtime": {
    "port": 8423,
    "facilitator": "https://facilitator.example"
  }
}
```

Use `merchant_sources` to inspect an alias, `merchant_stage` to retain it,
`merchant_compare` to review it, and the existing
`merchant_activate`/`merchant_start`/`merchant_restart`/`merchant_rollback` tools
to operate it. The original `merchant_catalog` and `merchant_client_export` tools
read the actually running seller. Writes keep their existing exact release
digest, generation and owned instance arguments. The caller selects registered
aliases; the host configuration supplies package paths and runtime settings.

## Embedded source API

`release-mysql.mjs` exports `prepareMysqlRelease`, `stageMysqlRelease`,
`inspectMysqlRelease`, `startMysqlRelease` and the original child entry `launch`.
For the maintained store API, call:

```js
await stageRelease(store, {
  id: 'second',
  mysqlPackage: '/srv/merchant/packages/next',
  runtime: { port: 8423, facilitator: 'https://facilitator.example' }
});
```

The retained source kind is `MYSQL_MERCHANT_PACKAGE`; its source manifest schema
is `stellar-forge.mysql-seller-release-manifest.v1`. The `mysql/package` directory
is the original prepared merchant. `seller-service.json` and `offers.json` retain
the shared SF82 shape used by catalog publication and client discovery.
