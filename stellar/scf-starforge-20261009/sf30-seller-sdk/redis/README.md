# Redis / Valkey merchant

Publish reviewed Redis records as paid HTTP products through the original SF30
seller. A private source declares the connection, fixed keys, typed inputs,
projected fields and execution limits. A merchant plan supplies the public
routes, examples and exact native payment alternatives. Preparation creates the
original seller service, OpenAPI document and generated buyer client together.

The source supports Redis 7 or later and Valkey 7.2 or later with `EVAL_RO`.
Native profiles select standalone Redis, Redis Cluster or Redis Sentinel. They
use the maintained `@redis/client` 6.2.1 implementation and the existing SF30
developer portal, operations interface and request lifecycle.

## Connect an Upstash source

The same merchant supports Upstash's native HTTPS/RESP2 transport. Start with
`starforge redis init --directory NEW_DIRECTORY --transport upstash-rest`.
The [Upstash customer guide](UPSTASH.md) covers credentials, original-source
preflight, customer preparation, retained releases and the complete native
provider operation. The existing read-only query engine and exact value handling
are shared by both connection types.

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
of six native read shapes:

| Kind | Selection and public result |
| --- | --- |
| `get` | One declared string key and one public column |
| `hash` | One key and an explicit public-column to Redis-field mapping |
| `sorted-set` | One key, ordered member and score columns, and optional rank-offset input |
| `stream` | One key, stream ID plus explicitly projected fields, and optional exclusive-ID input |
| `list` | One key, zero-based index and value columns, and optional bounded offset input |
| `set` | One key, one member column, a native cursor input and a complete SSCAN batch |

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

For a sorted set or list, `offset` names an integer parameter with an inclusive minimum
of at least zero and maximum at most 10,000,000. For a stream, `after` names a
string parameter with `maxLength` at most 41. Its value is `-` for the first page
or a canonical `milliseconds-sequence` ID with two unsigned 64-bit components.
The stream selection begins strictly after that ID.

For a set, `cursor` names a string parameter with `maxLength` at most 20. Start
with the exact string `"0"`; later inputs are the native unsigned 64-bit cursor
as canonical decimal text. `scanCount` is a declared work hint from 1 to
`maxRows`. See [List and Set products](COLLECTIONS.md) for complete examples,
iteration behavior, native ACL permissions and customer continuation.

The plan schema is `stellar-forge.redis-merchant-plan.v1`. Every public route
selects a configured query and supplies method, path, service name, description,
parameter descriptions, example and payment terms. The shared public compiler
checks both the original example and its actual HTTP representation using the
Redis binder. The original example plan contains four ready-to-edit routes. The complete
`example-collections-source.json` and `example-collections-plan.json` pair adds
List and Set products through the same compiler, editor and customer client.

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

Declare `offset`, `after` or the set's required `cursor` to expose continuation for a paged product. Use the
returned `nextInput` as the next request's input. It retains the current
key-selection values and advances the declared
rank, list index, stream ID or native set cursor. A continuation is emitted only when it passes the same
input contract as a new request. If the next rank exceeds the declared offset
maximum, the response reports `continuationUnavailable: "OFFSET_LIMIT"`. A
cursor excluded by an enum or another declared input constraint reports
`continuationUnavailable: "INPUT_LIMIT"`. In either case `truncated` may still
be true because more source rows exist. The merchant can revise the reviewed
declaration to expose a wider range.

Each page is an individual live read. Changes to a sorted set or list between
requests can change positions; the stream cursor follows native stream IDs.
Set results expose `scanCursor`, `scanComplete`, `scanCount` and
`duplicatesPossible`. Follow `nextInput` even for an empty set page; native
ordering is unspecified and repeated members may occur across pages.
An oversized complete native scan batch returns HTTP 413 with
`QUERY_SCAN_PAGE_TOO_LARGE`. The reader preserves the native batch boundary;
use the selected source and cursor again after adjusting the declaration.
Release retention pins the reader configuration, while the Redis dataset
continues under its own operational lifecycle.

## Configure the native connection

The private `connection` selects one deployment. Omitted `topology` keeps the
original standalone profile. All native profiles accept `username`,
`passwordEnv`, `tls` and `caFile`. The host environment supplies the password
when a preview or seller starts. TLS defaults to `verify-full`, which validates
the server certificate and hostname. An explicit CA is relative to the source
file and is copied into prepared packages and retained releases.

| Deployment | Required connection fields | Database |
| --- | --- | --- |
| Standalone | `host`; optional `port` defaults to 6379 | `database` defaults to 0 |
| Cluster | `topology: "cluster"`, `rootNodes` | Database 0 |
| Sentinel | `topology: "sentinel"`, `name`, `sentinelRootNodes` | `database` defaults to 0 on the data server |

Start from the corresponding complete source and merchant-plan templates:

```sh
starforge redis init --directory /srv/merchant/cluster --topology cluster
starforge redis init --directory /srv/merchant/sentinel --topology sentinel
```

Each seed list contains 1–16 distinct `{ "host": "...", "port": 6379 }`
endpoints. Cluster seeds default to port 6379; Sentinel seeds default to 26379.
Use several independently reachable seeds so the driver can discover the
deployment when one seed is unavailable. `describe` reports the topology and
seed count without exposing hosts or credential values.

### Cluster

A Cluster connection uses the same merchant credentials and TLS settings for
seed discovery and every discovered data node:

```json
{
  "topology": "cluster",
  "rootNodes": [
    { "host": "redis-1.example", "port": 6379 },
    { "host": "redis-2.example", "port": 6379 },
    { "host": "redis-3.example", "port": 6379 }
  ],
  "username": "merchant",
  "passwordEnv": "REDIS_MERCHANT_PASSWORD",
  "tls": "verify-full"
}
```

Every declared product reads one selected Redis key. The driver receives that
key with the original `EVAL_RO` invocation, routes it to the slot's primary and
handles native `MOVED` and `ASK` redirects. The reader uses primary nodes.
Different products and enum-selected keys can occupy different slots. A Cluster
profile rejects nonzero databases before opening a connection.

### Sentinel

A Sentinel profile names the monitored primary and separates discovery
credentials and TLS from data credentials and TLS:

```json
{
  "topology": "sentinel",
  "name": "merchant-primary",
  "sentinelRootNodes": [
    { "host": "sentinel-1.example", "port": 26379 },
    { "host": "sentinel-2.example", "port": 26379 },
    { "host": "sentinel-3.example", "port": 26379 }
  ],
  "database": 0,
  "username": "merchant",
  "passwordEnv": "REDIS_MERCHANT_PASSWORD",
  "tls": "verify-full",
  "sentinelUsername": "merchant-monitor",
  "sentinelPasswordEnv": "REDIS_SENTINEL_PASSWORD",
  "sentinelTls": "verify-full"
}
```

`sentinelTls` also defaults to `verify-full`. Set `caFile` for a private
data-server CA and `sentinelCaFile` for a private Sentinel CA. Preparation
retains them independently as `database-ca.pem` and `sentinel-ca.pem` and
lists both required environment names in the manifest. The saved workspace
retains the original certificate bytes and environment references through
reopen, customer preparation and release staging.

The native Sentinel client discovers and reads the current primary. Its
existing topology refresh handles a promoted primary; this reader does not
select replicas. Supply monitor credentials for the Sentinel service and data
credentials for the database nodes. Configure each service through its own
existing administration interface.

### Advertised addresses and local receiving

Cluster and Sentinel deployments may advertise addresses that differ from the
host's reachable addresses. An optional `nodeAddressMap` translates exact
advertised `host:port` strings to explicit endpoints:

```json
{
  "nodeAddressMap": {
    "10.20.0.12:6379": { "host": "redis-2.internal.example", "port": 6379 }
  }
}
```

The map permits at most 256 entries. Each destination specifies its port.
Sentinel applies the same map to discovered monitor and data endpoints. Keep the
mapped endpoint compatible with its server certificate and the host's existing
network access.

For a local development deployment, explicitly choose `local-plaintext`.
If either the data or Sentinel connection uses this mode, every seed, mapped
endpoint and discovered destination must be `127.0.0.1`, `::1` or
`localhost`. The source checks discovered destinations as well as the initial
profile. Use verified TLS for a directly reachable remote deployment. A complete
SSH deployment instead owns explicit loopback forwards on the application host,
as described below.

An optional `nodeAddressPolicy: "mapped-only"` requires every discovered address
to appear in `nodeAddressMap`. The SSH compiler enables this policy and retains
both announced endpoints and the corresponding local forwards. Unreviewed
addresses fail with `REDIS_NODE_ADDRESS_UNMAPPED`, including unknown loopback
addresses. Profiles that omit the policy keep their existing discovery behavior.

### Connection lifetime

The source has explicit `maxConnections`, `maxPending`, `connectTimeoutMs`,
`idleTimeoutMs` and `startupTimeoutMs`. For Cluster and Sentinel,
`maxConnections` counts owned logical clients; the native driver opens the
sockets needed for discovery and data nodes inside each client. Size this limit
alongside the deployment's socket capacity. The default is four logical clients.

The source reuses ready clients and keeps requests within the configured queue
and lifetime. On cancellation or deadline it retires the affected client and
joins its connection and command work before releasing its pool slot. Closing
the source joins all retiring clients as well as active work. A failed seed can
fall through to another configured seed using the native driver.

A client deadline ends the reader's request; a script already executing on
Redis continues according to the server's script lifecycle. Stopping a seller
uses the existing HTTP drain before closing its source.

## Operate an application through SSH

The installed `redis-ssh` command owns the complete database access inventory and
the application using it. It supports standalone, Cluster and Sentinel hosts
that provide SSH access to the database's own loopback interface. Each data node
and Sentinel monitor has an explicit host identity, credential reference, local
port and announced-address mapping. The customer application runs on its own
application host.

Start with the appropriate `deployment/example-*.json` and the full
[SSH deployment guide](deployment/SSH_DEPLOYMENT.md). Review its semantic digest,
prepare the original commissioning input, and run that same customer workflow:

~~~sh
starforge redis-ssh profile --deployment /srv/customer/ssh-deployment.json
starforge redis-ssh prepare --deployment /srv/customer/ssh-deployment.json --input /srv/customer/commissioning-input.json --output /srv/customer/commissioning-via-ssh.json
starforge redis-ssh run --deployment /srv/customer/ssh-deployment.json --sha256 REVIEWED_DEPLOYMENT_SHA256 -- starforge redis-commission receive --input /srv/customer/commissioning-via-ssh.json --workspace /srv/customer/commission
~~~

The original commissioning input retains its selected products, operation IDs,
prices, customer expectations and release controls. The SSH preparation changes
only its connection to the reviewed forwards. Set the required environment
references on the application host before receiving. The complete guide covers
the original CLI arguments, saved workspace, customer export, managed runtime,
host-key files, restart behavior and the full native operating journey.

All forwards authenticate before the application starts. A lost connection ends
that application and its child process group, then closes the remaining
forwards. The next start opens a fresh group from the same reviewed input. The
manager pins the exact known-host bytes it uses, retains private-key references
and uses OpenSSH's existing public-key and host-verification implementation.

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

List products additionally require `+lrange` and `+llen`; Set products require
`+sscan`. Add the declared collection keys to the same merchant key rules. The
[collection guide](COLLECTIONS.md#native-access) gives the complete permission
fragment for its example source.

For Cluster, add `+cluster|slots` for native discovery and `+asking` for a
read redirected during a slot migration. Apply the merchant identity and its
key permissions consistently to the Cluster's data nodes.

For Sentinel, configure the separate monitor reader with `+ping`,
`+sentinel|master`, `+sentinel|replicas`, `+sentinel|sentinels`,
`+psubscribe` and `+punsubscribe`, together with channel access for native
topology notifications. The integration fixture uses `&*` for that monitor
identity. The data-server merchant retains the read permissions above. Sentinel
administration and failover use the deployment's existing administrator identity.

Apply the equivalent settings through the database's existing administration
interface. Native script execution respects the user's command and key
permissions. Redis-compatible hosted providers must expose the same read-only
script capability for this source.

Primary command and access-control references:

- [Redis EVAL_RO](https://redis.io/docs/latest/commands/eval_ro/)
- [Valkey EVAL_RO](https://valkey.io/commands/eval_ro/)
- [Redis ACL](https://redis.io/docs/latest/operate/oss_and_stack/management/security/acl/)
- [node-redis 6.2.1 Cluster](https://github.com/redis/node-redis/blob/redis%406.2.1/docs/clustering.md)
- [node-redis 6.2.1 Sentinel](https://github.com/redis/node-redis/blob/redis%406.2.1/docs/sentinel.md)

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

Set `SF30_REDIS_JOURNEY_TOPOLOGY=cluster` for three native primaries, live slot
routing and a slot migration, or `SF30_REDIS_JOURNEY_TOPOLOGY=sentinel` for an
authenticated primary/replica deployment and three Sentinel monitors with an
actual primary promotion. These modes continue through the same declared
products, merchant, buyer, customer files and retained release journey. Add
`SF30_REDIS_JOURNEY_WORKSPACE=1` and `SF30_REDIS_WORKSPACE_BROWSER=1` to include
the existing saved editor and browser flow on the selected deployment. The
native journey owns and closes the ephemeral Redis processes it starts.

Add `SF30_REDIS_JOURNEY_TLS=1` to the Sentinel run to generate separate data
and monitor CAs and real SAN certificates through the installed `openssl`
executable. That run uses verified TLS on both planes, retains both CA files
through the original workspace and package, removes the original merchant CA
source copies, and continues through the retained seller's actual customer
deliveries and release changes. The selected Redis executable must include TLS.

The integrated run on Redis 7.0.15 and `@redis/client` 6.2.1 completed six buyer
deliveries, retained every original response file, and restored the original
ranking result after rollback. It also exercised authenticated database
selection, binary values, exact decimal text, missing projected fields, stream
duplicate fields, pagination boundaries, and both native and encoded result
size limits.

Set `SF30_REDIS_JOURNEY_COLLECTIONS=1` to append the two collection products
to that same native operation. The collection continuation reads complete lists
and sets, preserves binary and large decimal values, follows an actual
nonterminal empty SSCAN batch, exercises whole-batch limits, edits and reopens
saved previews, and downloads every page through the original generated client.
Use `SF30_REDIS_JOURNEY_SETUP=1` for the [connection setup](SETUP.md) browser
operation before the original source CA copies are removed.

## Saved authoring workspace

The [connection setup](SETUP.md) imports or configures the original source and
creates the saved workspace. The [Redis merchant workspace](workspace/README.md) combines named-product editing, complete saved revisions, live source previews, original customer packages and retained release controls. Use `starforge-merchant redis workspace create --directory NEW --source SOURCE --plan PLAN`, then `starforge-merchant redis workspace open --directory WORKSPACE`. The browser and CLI share the same private workspace; the host-selected connection and environment credential references carry through to the original merchant.
