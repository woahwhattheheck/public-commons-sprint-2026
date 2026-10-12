# Upstash customer data merchant

Use an existing Upstash Redis database as the source for the original Starforge
merchant. The operator declares the permitted keys, inputs, projected columns
and response limits. The original seller publishes those named products through
its payment challenge, developer documentation and generated customer client.

The Upstash transport sends the existing read-only Lua script through the
[documented REST interface](https://upstash.com/docs/redis/features/restapi).
It requests binary RESP2, keeping the same byte, decimal, null and cursor handling
as the native Redis connection. The query engine, seller, buyer and retained
release workflow are shared with the [Redis product](README.md).

## Create the merchant

Install a release containing this transport with the original runtime installer.
Select the original native payment dependencies with `--native` when running
payment mode. This HTTP source uses Node's native HTTPS fetch and introduces no
extra package dependency. An existing native Redis runtime can use it directly.

```sh
starforge redis init --directory /srv/merchant/upstash --transport upstash-rest
```

The command creates the original source, merchant plan and input files in a new
private directory. Replace the example endpoint in `source.json`:

```json
{
  "transport": "upstash-rest",
  "endpoint": "https://your-database.upstash.io",
  "tokenEnv": "UPSTASH_REDIS_REST_TOKEN"
}
```

This object is the source's `connection`. Obtain the database's HTTPS endpoint
and token from the operator's existing Upstash account. Supply the token through
the named environment variable or the original host's private environment file.
Keep the environment available to both the current merchant and its retained
release children. The source stores the variable name; prepared customer
documentation contains the public query contract.

The endpoint must be a root HTTPS URL under `upstash.io`, without credentials,
query parameters, fragments or an alternate port. Redirects are rejected before
a token can be forwarded elsewhere. HTTP and TCP connection fields are distinct;
a partial pair is rejected during the original source validation.

For production, use the database's read-only token or an appropriately restricted
ACL user's REST token. Upstash documents both token types and
[ACL token generation](https://upstash.com/docs/redis/features/restapi#rest-token-for-acl-users).
Its current [security guide](https://upstash.com/docs/redis/features/security)
places custom ACLs on paid databases. Select the account's existing access model
with its operator; an ordinary source connection never creates or upgrades a
database.

## Map the customer's data

The supplied source demonstrates four named products: a string value, selected
hash fields, a sorted ranking and a stream projection. Replace those fixed keys
and field mappings with the agreed customer schema. Typed parameters select only
the alternatives declared in the source. Keep atomic amounts as strings.

Each query runs the existing `EVAL_RO` script once. Its read and encoded-output
limits remain active. The transport also limits the downloaded RESP2 frame before
decoding it. A cancelled or expired query aborts its owned HTTP request; queued
work and concurrent requests use the existing source limits. Quota and rate
responses reach the original operator/customer error path, with a provider
`Retry-After` value when supplied.

```sh
starforge redis describe --source /srv/merchant/upstash/source.json
starforge redis preflight --source /srv/merchant/upstash/source.json
starforge redis query --source /srv/merchant/upstash/source.json \
  --query catalog --input /srv/merchant/upstash/input.json \
  --output /srv/merchant/upstash/catalog-first.json
```

Preflight executes the real provider's read-only scripting capability check.
Inspection identifies `Upstash REST` and `HTTPS_RESP2`. The same inspection
continues to identify the native driver and RESP2 for a TCP source.

Read the retained output and confirm its source fields with the customer before
publishing the product. Set the merchant plan's actual origin, recipient, asset,
atomic amount and accepted payment alternatives. Prepare and inspect the
original complete customer package:

```sh
starforge redis prepare --source /srv/merchant/upstash/source.json \
  --plan /srv/merchant/upstash/merchant-plan.json \
  --directory /srv/merchant/upstash/prepared-first
starforge redis verify --directory /srv/merchant/upstash/prepared-first
starforge redis start --directory /srv/merchant/upstash/prepared-first \
  --port 8423 --operations-port 8424
```

The existing start command accepts the reviewed facilitator configuration.
Its developer portal includes the original OpenAPI document and generated
client. The original release console stages the prepared source and service
together. Use that console to review changed data mappings or prices, activate
the next version, restart the child and roll back to the retained previous
version. The credential environment stays with the original operating host.

## Complete an isolated provider operation

The original `native-journey.mjs` supports both the native Redis server and
Upstash. Its Upstash mode requires a dedicated ephemeral database because it
writes its own demonstration inputs. The operator supplies that newly created
database's endpoint and standard token; an optional
`UPSTASH_REDIS_REST_READ_TOKEN` selects a separate merchant read credential.

Upstash publishes an explicitly free, 72-hour
[agent database endpoint](https://upstash.com/blog/redis-database-for-agents).
Retain its returned credentials privately with this one operation. Use an
existing installed Starforge source and the original native payment peers:

```sh
export SF30_REDIS_JOURNEY_PROVIDER=upstash-rest
export SF30_UPSTASH_JOURNEY_ALLOW_SEED=owned-ephemeral-database
export SF30_REDIS_JOURNEY_OUTPUT=/srv/operations/upstash-native-result.json
node /srv/starforge/source/stellar/scf-starforge-20261009/sf30-seller-sdk/redis/native-journey.mjs
```

The source and all customer reads use a fresh random key namespace. The operation
checks authentication and the provider's read-only Lua behavior, seeds real
binary/hash/rank/stream records, serves the original paid products, reopens six
saved buyer responses, changes source and price, removes the authoring folder,
then completes native child upgrade and rollback. Its facilitator remains the
original local protocol fixture. Successful completion deletes the operation's
seed keys and retains the complete result at the requested output path.

Keep the installed source, dependency lock and original output with the delivery.
The ordinary Redis mode retains its existing server, authenticated database 2
and native ACL operation.
