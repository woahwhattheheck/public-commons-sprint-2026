# Operate retained Redis merchants

A prepared Redis merchant runs through the existing SF82 release store and
operator console. Preparation joins the private named Redis read declarations
to the original SF30 public offers, payment alternatives, OpenAPI document and
generated buyer client. The release manager retains that complete package and
uses the original Redis seller for each selected run.

Install a distribution containing the Redis feature with the existing runtime
installer's `--native --feature redis --operator` options before opening the
merchant. The [Redis operator guide](../sf30-seller-sdk/redis/README.md#install-the-native-feature)
contains the prepare, install and inspection commands.

## Prepare and retain the package

Keep the merchant's source, packages and release store outside the replaceable
software installation. The private source selects the connection, database,
named commands, key templates, projections and execution limits. A password is
supplied through the environment entry named by `connection.passwordEnv`.
The public merchant plan describes the customer routes, typed inputs, examples
and exact payment terms.

```sh
mkdir -p /srv/merchant/packages
starforge redis prepare --source /srv/merchant/source.json \
  --plan /srv/merchant/merchant-plan.json \
  --directory /srv/merchant/packages/first

starforge redis verify --directory /srv/merchant/packages/first

starforge releases init --store /srv/merchant/releases
starforge releases stage --store /srv/merchant/releases --id first \
  --redis-package /srv/merchant/packages/first --port 8423 \
  --facilitator https://facilitator.example
starforge releases inspect --store /srv/merchant/releases --id first
starforge releases diff --store /srv/merchant/releases --to first
```

The prepared package contains `source.json`, `service.json`,
`merchant-plan.json`, `openapi.json`, the original generated `client` directory
and `manifest.json`. The client directory contains the five generated customer
files and their original `client-export.json` manifest; staging preserves all
six together. When the connection uses an explicit CA, preparation copies
it into the package as `database-ca.pem` and updates the package's private
connection reference. Each retained file has an exact byte length and SHA-256.

Preparation validates Redis declarations directly and passes their compiled
parameter contracts to `compileQueryMerchantPlan`. That shared compiler owns
the existing route, payment, public-origin, request-schema and example rules.
The Redis binder validates both the original example and its actual HTTP form.
Redis commands and key templates remain in `source.json`; public artifacts are
compiled from the reviewed merchant metadata and typed parameter contract.

Staging reopens the prepared package, verifies every declared file, regenerates
the public service from its retained plan and checks the source bindings. It
copies the package into the current release store. Credentials are resolved by
the source reader when the selected seller starts; staging remains an offline
package operation.

Source-checkout users can replace `starforge redis` with
`node stellar/scf-starforge-20261009/sf30-seller-sdk/redis/cli.mjs` and
`starforge releases` with
`node stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs`.

## Review the source and customer contract

The release inspection and comparison contain the normal route, request and
payment changes, plus the retained Redis execution identity:

| Identity | Meaning |
| --- | --- |
| `packageManifestSha256` | Complete original prepared package identity |
| `sourceConfigSha256` | Retained connection, command declarations, bindings and source limits |
| `planSha256` | Reviewed public merchant plan |
| `queryDefinitionSha256` | Named command, parameter, projection and limit definitions |
| `connectionProfileSha256` | Connection, database, TLS and credential-reference configuration |
| `databaseCaSha256` | Package-local CA certificate, when present |
| `executionSha256` | Combined retained Redis execution configuration |

Connection settings, key templates and credential reference names are retained
in the private source. The operator record exposes digests, required environment
variable names and the source's public query description. Public customer terms
continue to use the original
seller's exact atomic payment amounts and declared payment alternatives.

## Select and run

```sh
starforge releases activate --store /srv/merchant/releases --id first \
  --expect 0 --reason 'Reviewed Redis source and customer terms'
starforge releases console --store /srv/merchant/releases --port 8425
```

Open the private loopback URL printed by the console. The existing controls
show the selected release separately from the running release and provide
start, stop, restart, comparison and rollback. The original seller serves its
customer offers, documentation and OpenAPI from the selected retained package.

For a foreground service, run:

```sh
starforge releases run --store /srv/merchant/releases --expect 1
```

The release manager passes its ownership handshake to the existing child
launcher, then starts the retained Redis source and original SF30 seller. Its
readiness record identifies the actual listener, runtime mode and exact source
digests. Stopping uses the seller's HTTP drain and source close lifecycle.

## Change, reopen and roll back

Prepare a new package for a changed read declaration, key selection, connection,
route, example or price. Every version gets a new package directory and release
ID:

```sh
starforge redis prepare --source /srv/merchant/source-next.json \
  --plan /srv/merchant/merchant-plan-next.json \
  --directory /srv/merchant/packages/second
starforge releases stage --store /srv/merchant/releases --id second \
  --redis-package /srv/merchant/packages/second --port 8423 \
  --facilitator https://facilitator.example
starforge releases diff --store /srv/merchant/releases --from first --to second
starforge releases activate --store /srv/merchant/releases --id second \
  --expect 1 --reason 'Reviewed revised source and customer contract'
```

The running seller continues on its selected instance until the owning console
or foreground manager restarts it. Each new process checks the retained package
and opens Redis with the current runtime credential environment. The authoring
directory can move after staging because the original package, client, plan and
optional CA are copied into the release.

Read the current generation from `status` before changing selection. To restore
the earlier retained configuration:

```sh
starforge releases rollback --store /srv/merchant/releases --to first \
  --expect 2 --reason 'Restore the reviewed original Redis merchant'
```

Redis reads use the live database at request time. A release rollback restores
the retained command definitions and commercial contract; Redis data continues
under the database's own persistence and operational lifecycle.

## Embedded interfaces

`redis/prepare.mjs` exports `compileRedisMerchantPlan`, `prepareRedisSeller`
and `verifyPreparedRedisSeller`. The prepared schema is
`stellar-forge.redis-prepared.v1`; its plan schema is
`stellar-forge.redis-merchant-plan.v1`.

`release-redis.mjs` exports `prepareRedisRelease`, `stageRedisRelease`,
`inspectRedisRelease`, `startRedisRelease` and the child entrypoint `launch`.
The existing store API accepts the prepared package directly:

```js
await stageRelease(store, {
  id: 'second',
  redisPackage: '/srv/merchant/packages/second',
  runtime: { port: 8423, facilitator: 'https://facilitator.example' }
});
```

The source kind is `REDIS_MERCHANT_PACKAGE`, the retained source schema is
`stellar-forge.redis-seller-release-manifest.v1`, and `redis/package` contains
the original prepared merchant. The existing `seller-service.json`,
`offers.json`, release digests, generation changes and process ownership records
remain the shared interfaces for operator and customer discovery.
