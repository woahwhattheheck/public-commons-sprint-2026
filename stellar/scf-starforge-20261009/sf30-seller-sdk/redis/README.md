# Redis / Valkey merchant

Publish reviewed Redis records as paid HTTP products through the original SF30
seller. A private source declares the connection, fixed keys, typed inputs,
projected fields and execution limits. A merchant plan supplies the public
routes, examples and exact native payment alternatives. Preparation creates the
original seller service, OpenAPI document and generated buyer client together.

The source supports Redis 7 or later and Valkey 7.2 or later with `EVAL_RO`.
It uses the maintained `@redis/client` 6.2.1 connection implementation and the
existing SF30 developer portal, operations interface and request lifecycle.

## Install the native feature

Select a distribution archive that includes the Redis command and its runtime
dependency manifest. Use that archive's published SHA-256 in place of
`ARCHIVE_SHA256` below. The maintained installer prepares the original native
payment SDK and the Redis driver together:

```sh
starforge runtime-install prepare --dir /srv/starforge/redis-runtime \
  --archive /srv/releases/starforge.tgz --sha256 ARCHIVE_SHA256 \
  --native --feature redis --operator
starforge runtime-install install --dir /srv/starforge/redis-runtime
starforge runtime-install inspect --dir /srv/starforge/redis-runtime --load --source
```

`--operator` checks the existing Linux release and host requirements, including
Python 3.11 or later and `flock`. The package source remains under
`/srv/starforge/redis-runtime/package/source`, and the selected dependencies live
under `/srv/starforge/redis-runtime/node_modules`. Run the original command from
that installed source:

```sh
starforge runtime-install run --dir /srv/starforge/redis-runtime -- \
  doctor --native --feature redis
```

For the remaining examples, replace the `starforge` prefix with
`starforge runtime-install run --dir /srv/starforge/redis-runtime --` when using
this retained runtime. The original [runtime installation guide](../../distribution/RUNTIME_INSTALL.md)
also covers upgrades and recovery. `doctor --feature redis` checks the declared
driver import, and `--native` includes the native SDK dependencies.

## Start from the supplied examples

```sh
mkdir -p /srv/merchant
starforge redis init --directory /srv/merchant/redis
starforge redis describe --source /srv/merchant/redis/source.json
```

`init` creates source, plan and input files in a new private directory. Edit the
connection and map the example keys to the existing merchant data. All supplied
query inputs have defaults, so the initial `input.json` is `{}`. Replace the
example public origin, asset and recipient with the merchant's reviewed payment
terms before starting native payment mode. Then inspect the live source and
prepare the merchant:

```sh
starforge redis preflight --source /srv/merchant/redis/source.json
starforge redis query --source /srv/merchant/redis/source.json \
  --query catalog --input /srv/merchant/redis/input.json
starforge redis prepare --source /srv/merchant/redis/source.json \
  --plan /srv/merchant/redis/merchant-plan.json \
  --directory /srv/merchant/redis/packages-first
starforge redis verify --directory /srv/merchant/redis/packages-first
starforge redis start --directory /srv/merchant/redis/packages-first \
  --port 8423 --operations-port 8424
```

`describe` and its `inspect` alias show public query contracts offline.
`preflight` opens the configured source and returns its native inspection and
current connection status. `query` reads one named product directly and closes
its owned source afterward. Add `--output NEW_FILE` to retain the complete JSON
result in a create-only private file.

Omitting `--facilitator` starts the seller in `CHALLENGE_ONLY` mode. Native
payment mode uses the existing explicit facilitator configuration. Use Ctrl-C
to stop a foreground run; the seller drains before closing its source.

```sh
starforge redis start --directory /srv/merchant/redis/packages-first \
  --facilitator https://facilitator.example --port 8423 --operations-port 8424
```

The printed result includes the actual seller URL, developer documentation,
OpenAPI and operations URLs. `run` is an alias for `start`. To operate an already
reviewed source and service directly, use `serve --source source.json --config
service.json` with the same launch options. Source-checkout users can replace
`starforge redis` with `node
stellar/scf-starforge-20261009/sf30-seller-sdk/redis/cli.mjs`.

## Declare the product

The source schema is `stellar-forge.redis-source.v1`. Each named product uses one
of four native read shapes:

| Kind | Selection and public result |
| --- | --- |
| `get` | One declared string key and one public column |
| `hash` | One key and an explicit public-column to Redis-field mapping |
| `sorted-set` | One key, ordered member and score columns, and optional rank-offset input |
| `stream` | One key, stream ID plus explicitly projected fields, and optional exclusive-ID input |

Keys are either fixed literal strings or `{ "prefix": "merchant:catalog:",
"parameter": "region" }`. A key parameter must be a declared string with an
explicit enum. The examples permit the reviewed `north` and `south` catalog
keys. Public descriptions include parameter contracts, columns, kinds and
limits; the private source retains the actual keys and Redis field names.

The source shares the seller's scalar declaration compiler. Redis inputs use
non-null strings and signed 64-bit integer values. Strings must be well-formed
Unicode and reject NUL. Integer
JSON numbers must be safe integers; decimal integer strings retain the full
supported range. Every declared input has a purpose in key selection or paging.
Defaults, enums and declared bounds are applied before native execution.

For a sorted set, `offset` names an integer parameter with an inclusive minimum
of at least zero and maximum at most 10,000,000. For a stream, `after` names a
string parameter with `maxLength` at most 41. Its value is `-` for the first page
or a canonical `milliseconds-sequence` ID with two unsigned 64-bit components.
The stream selection begins strictly after that ID.

The plan schema is `stellar-forge.redis-merchant-plan.v1`. Every public route
selects a configured query and supplies method, path, service name, description,
parameter descriptions, example and payment terms. The shared public compiler
checks both the original example and its actual HTTP representation using the
Redis binder. The example plan contains four ready-to-edit routes matching the
four product kinds.

## Read pages and preserve values

Results provide the declared columns, rows, row count and truncation state.
Redis text, stream IDs and score replies remain strings. Missing values use JSON
null. Binary values that are not valid UTF-8 use a `{ "base64": "..." }` object.
Redis sorted-set numeric representation and ordering continue to apply to score
values; the reader preserves their native textual reply.

When a stream entry repeats a field name, its projection uses that entry's last
value for the field. Stream results expose
`duplicateFieldProjection: "last-value"` with the returned rows.

Each request runs the fixed read-only projection script once. Projection and
native byte accounting happen inside Redis before selected values are returned
to the client. The declared `maxRows` is 1 for string and hash products and up to
1,000 for paged products. `maxBytes` is 1,024–917,504 bytes, and `timeoutMs` is
50–30,000 milliseconds. The complete JSON response also remains within the
selected byte limit. A result that exceeds either byte check returns
`QUERY_RESULT_TOO_LARGE`; the HTTP route uses status 413. Adjust the reviewed
projection or page size, or the declared byte limit, before requesting it again.

Declare `offset` or `after` to expose continuation for a paged product. Use the
returned `nextInput` as the next request's input. It retains the current
key-selection values and advances the declared
rank or stream cursor. A continuation is emitted only when it passes the same
input contract as a new request. If the next rank exceeds the declared offset
maximum, the response reports `continuationUnavailable: "OFFSET_LIMIT"`. A
cursor excluded by an enum or another declared input constraint reports
`continuationUnavailable: "INPUT_LIMIT"`. In either case `truncated` may still
be true because more source rows exist. The merchant can revise the reviewed
declaration to expose a wider range.

Each page is an individual live read. Changes to a sorted
set between requests can change rank positions; the stream cursor follows
native stream IDs. Release retention pins the reader configuration, while the
Redis dataset continues under its own operational lifecycle.

## Configure the native connection

`connection` accepts `host`, `port`, `database`, optional `username` and
`passwordEnv`, `tls` and optional `caFile`. The defaults are port 6379, database 0
and `tls: "verify-full"`. TLS validates the server certificate and hostname;
`caFile` is resolved relative to the source file. A local development connection
can explicitly choose `local-plaintext` for `127.0.0.1`, `::1` or `localhost`.

For an authenticated service, set the connection's `username` and the name of its
existing password environment entry, for example
`"passwordEnv": "REDIS_MERCHANT_PASSWORD"`. The private host environment supplies
the value when the reader starts. Preparation copies an explicit CA into the
package and records required environment names in the manifest.

The source has explicit `maxConnections`, `maxPending`, `connectTimeoutMs`,
`idleTimeoutMs` and `startupTimeoutMs`. It reuses its owned connections across
queries and keeps the queue and request lifetime within the configured limits.
On a deadline, it retires the affected connection. The deadline bounds the
client's wait; an already executing remote script continues according to the
Redis server's script lifecycle. Stopping closes the source through the existing
seller HTTP drain.

## Grant the command and key permissions

The merchant identity needs `+eval_ro` and `+ping`, plus the commands used by its
declared products: `+get`, `+strlen`, `+hmget`, `+hstrlen`, `+zrange`, and
`+xrange`. Selecting a nonzero database also requires `+select`. Restrict its key
permissions to the fixed merchant keys represented by the source declarations.

For an existing dedicated merchant user whose password is already configured,
the example source uses this ACL permission fragment:

```text
ACL SETUSER merchant on resetkeys -@all ~merchant:availability:catalog ~merchant:catalog:north ~merchant:catalog:south ~merchant:rankings:daily ~merchant:events +eval_ro +ping +get +strlen +hmget +hstrlen +zrange +xrange
```

Apply the equivalent settings through the database's existing administration
interface. Native script execution respects the user's command and key
permissions. Redis-compatible hosted providers must expose the same read-only
script capability for this source.

Primary command and access-control references:

- [Redis EVAL_RO](https://redis.io/docs/latest/commands/eval_ro/)
- [Valkey EVAL_RO](https://valkey.io/commands/eval_ro/)
- [Redis ACL](https://redis.io/docs/latest/operate/oss_and_stack/management/security/acl/)

## Operate the service and retained releases

`start` and `serve` accept `--max-in-flight`, `--drain-grace-ms`, and
`--availability-dir` for the existing seller controls. `--no-operations` runs
only the seller listener. An explicitly selected loopback HTTP facilitator uses
`--allow-local-facilitator`; normal facilitator URLs use HTTPS.

The same prepared package can be retained, compared, activated and rolled back
through `starforge releases stage --redis-package PREPARED_DIRECTORY`. The
existing release console operates the actual retained source and original
seller. See [Redis releases](../../sf82-seller-pilot/REDIS_RELEASES.md) for the
complete package-to-release workflow.

The retained generated client includes its original `client-export.json`
manifest alongside the JavaScript, TypeScript, OpenAPI, package and README
files. Preparation hashes all six client files, and release staging carries
them together for the original client inspection and download flow.

Embedded consumers can use `openRedisSourceFile`, `prepareRedisSeller`,
`verifyPreparedRedisSeller`, `startRedisSeller`, `bindRedisSeller` and
`createRedisNativeFactory`. The source owns Redis queries and connection
lifetime; the existing SF30 seller and SF82 manager own payment, service and
release operation.

## Native integration journey

Run `node native-journey.mjs` from this directory after installing the selected
native runtime. `REDIS_SERVER` selects an installed Redis 7+ executable; its
shared libraries must already be available to the process. The journey creates
an isolated loopback Redis database, exercises the four read products through
an ACL user, exports the original customer client, and uses the original buyer
and SF82 child process for upgrade and rollback. Its facilitator is the existing
local x402 protocol fixture. `SF30_REDIS_JOURNEY_OUTPUT` optionally saves the
result to a selected file.

The integrated run on Redis 7.0.15 and `@redis/client` 6.2.1 completed six buyer
deliveries, retained every original response file, and restored the original
ranking result after rollback. It also exercised authenticated database
selection, binary values, exact decimal text, missing projected fields, stream
duplicate fields, pagination boundaries, and both native and encoded result
size limits.
