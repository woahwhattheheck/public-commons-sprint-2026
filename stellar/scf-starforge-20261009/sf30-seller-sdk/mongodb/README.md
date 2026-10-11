# MongoDB merchant reports

Publish approved MongoDB aggregation reports through the existing SF30 seller.
The merchant chooses collections, fixed pipelines, output fields, typed request
parameters and public payment options. The original seller still owns HTTP,
input admission, x402 verification and settlement, OpenAPI, generated clients,
operations and graceful shutdown. The MongoDB adapter supplies the native read.

Use Node 22.16 or newer, the pinned official MongoDB Node driver 7.7.0 and MongoDB
5.0 or newer. The default `snapshot` report requires a replica set or sharded
deployment. The native reference journey uses MongoDB 8.0.15.

## Install and connect

From this directory in a complete Starforge checkout or maintained distribution:

```sh
npm ci --omit=dev --ignore-scripts
node cli.mjs init --directory /private/mongo-inputs
```

The existing native seller additionally uses its maintained x402 and Stellar SDK
installation. Follow the original SF30 installation instructions when enabling a
facilitator. The dependency lock here includes only the MongoDB driver and its
public runtime dependencies.

Edit `/private/mongo-inputs/source.json` to select the database and reports. Set
the URI variable through the host's existing secret manager or private launcher:

```sh
export MONGODB_URI='mongodb+srv://USER:PASSWORD@YOUR_CLUSTER/'
node cli.mjs catalog --source /private/mongo-inputs/source.json \
  --collection hpd_production --sample-size 200
node cli.mjs describe --source /private/mongo-inputs/source.json
node cli.mjs preflight --source /private/mongo-inputs/source.json
```

Replace the illustrative connection values with the merchant's own account. Use
a MongoDB account restricted to the required database's `read` role. A source
profile stores `connection.uriEnv`, `database`, `tls` and an optional `caFile`;
it never stores a connection URI or password. TLS certificate and hostname
verification are enabled by default. `tls: "local-plaintext"` is an explicit
loopback-only development option for a single local MongoDB endpoint.

`describe` validates declarations offline. `preflight` opens the configured
database, checks server/session compatibility and describes reports.
`catalog` reads the actual collection/view definition, validator, available
indexes and a limited sample sorted by `_id`. It reports observed BSON field
types, missing fields and up to five small document examples. Sampled types are
observations; the collection validator is a separate retained source of schema
constraints. Select a collection explicitly when a database has more than 64.

## Define a fixed report

This report accepts a minimum count while its collection and aggregation remain
merchant-authored:

```json
{
  "schema": "stellar-forge.mongodb-source.v1",
  "connection": {
    "uriEnv": "MONGODB_URI",
    "database": "merchant",
    "tls": "required"
  },
  "queries": {
    "housing_events": {
      "collection": "hpd_production",
      "pipeline": [
        {"$match": {"$expr": {"$gte": ["$all_counted_units", "$$sf30_minimumUnits"]}}},
        {"$sort": {"project_id": 1, "building_id": 1, "_id": 1}}
      ],
      "parameters": {
        "minimumUnits": {"type": "integer", "minimum": "0", "default": "20"}
      },
      "columns": ["project_id", "building_id", "bbl", "all_counted_units"],
      "readConcern": "snapshot",
      "maxRows": 100,
      "maxBytes": 524288,
      "timeoutMs": 5000
    }
  }
}
```

Use `$$sf30_NAME` for each declared parameter. The driver sends these as
aggregation `let` variables wrapped in `$literal`; even a submitted string
beginning with `$` remains a value. MongoDB requires `$expr` when using those
variables in `$match`. Names start with a lowercase ASCII letter and may then
contain letters, digits and underscores. All declared parameters must appear in
the pipeline. This follows the native [aggregate command's `let` interface](https://www.mongodb.com/docs/manual/reference/command/aggregate/).

The pipeline supports ordinary read stages, including projection, grouping,
sorting, facets, windows, fixed collection lookups and fixed collection unions.
It rejects write stages, change streams, administrative streams and server-side
JavaScript. The final projection exposes only the declared top-level columns;
rename nested values in the merchant's pipeline when needed. `_id` is excluded
unless explicitly listed. A final limit retrieves at most `maxRows + 1` documents
so the response can report truncation. Use an explicit stable sort with a unique
tie breaker when order matters.

Use canonical Extended JSON for exact BSON constants in a pipeline. An integer
literal beyond JavaScript's safe range is rejected; represent it as, for example,
`{"$numberLong":"9007199254740993"}`. Invalid Extended JSON is rejected during
configuration compilation, before the source can be exported.

### Parameter types

| Type | Accepted value and native binding |
| --- | --- |
| `string` | Exact string, with optional length, enum, null and default constraints. |
| `integer` | Canonical signed 64-bit integer text; safe integer JSON numbers also work for body requests. Bound as BSON `Long`. |
| `decimal` | Exact decimal text using the original SF30 decimal bounds, scale and enum rules. Bound as `Decimal128`; values requiring rounding are rejected. |
| `number` | Finite binary floating point number or accepted numeric text. Bound as BSON `Double`. |
| `boolean` | JSON booleans or the strings `true` and `false`. |
| `objectId` | Exactly 24 hexadecimal characters, bound as BSON `ObjectId`. |
| `date` | Canonical UTC `YYYY-MM-DDTHH:mm:ss.sssZ`, bound as BSON `Date`. |

An omitted value uses a configured default. A nullable field without a default
is still required. URL query parameters cannot transmit JSON null; use a body
route or omit a field with a null default. Unknown parameters, repeated HTTP
parameters, invalid bounds and malformed scalar values use the original seller's
input/admission path before payment verification. Integer and decimal examples
remain strings in the advertised contract, preserving large values.

The source accepts 1–64 named reports, 1–64 projected columns, 1–1,000 returned
rows per execution, 1–896 KiB complete JSON responses and 50–30,000 ms per report.
Defaults are 100 rows, 512 KiB and 1,500 ms. The source connection pool defaults
to four concurrent reads and 32 admitted/pending reads. An execution's deadline
includes waiting for a slot, database work and result consumption. Native cursor
batching, explicit cursor/session cleanup and the original request abort signal
keep active reads attached to the caller. `allowDiskUse` is disabled for reports.

## Inspect exact results

```sh
node cli.mjs query --source /private/mongo-inputs/source.json \
  --query hpd_projects --input /private/mongo-inputs/input.json \
  --output /private/first-records.json
```

`rows` contain [canonical Extended JSON](https://www.mongodb.com/docs/manual/reference/mongodb-extended-json/):
`{"$numberLong":"..."}`, `{"$numberDecimal":"..."}`, `{"$oid":"..."}`
and canonical dates preserve their BSON types. Ordinary BSON integer/double
values also keep their canonical type wrappers. A missing projected property is
omitted; an explicit null remains null. `columnTypes` reports the types actually
returned for each column. `rowCount` is the number returned, and `truncated`
means at least one additional matching result existed within that execution.

Read metadata states the configured concern and the actual session:

| Concern | Result interpretation |
| --- | --- |
| `snapshot` | One majority-committed point in time for the request, using a native snapshot session. |
| `majority` | Majority-committed read; it does not assert a single point in time across every document. |
| `local` | Local read without a majority-commit or point-in-time guarantee. |

The adapter always selects the primary. It retains observed `operationTime` and
`clusterTime` when the server returns them, without relabeling those fields as
a snapshot identifier. Each report call opens its own session. Repeated calls
read live data; a retained package freezes report/configuration bytes, not future
database contents. MongoDB describes the point-in-time behavior in its
[snapshot read concern documentation](https://www.mongodb.com/docs/manual/reference/read-concern-snapshot/).

## Retain reports and payment terms together

Edit the copied `merchant-plan.json` with the merchant's public HTTPS origin,
routes and actual payment requirements. Each route selects a named query,
HTTP method, fixed public path, service name, description, parameter descriptions
and an explicit example. Payment terms may be inherited or specified per route.
Use either `payment` or the original `paymentOptions` array. The original seller
validates option identity, atomic amount strings, native networks and offer
limits. The supplied examples contain visibly illustrative payment identifiers.

```sh
node cli.mjs create --source /private/mongo-inputs/source.json \
  --plan /private/mongo-inputs/merchant-plan.json --directory /private/mongo-workspace
node cli.mjs workspace --state /private/mongo-workspace
node cli.mjs inspect --directory /private/mongo-workspace
node cli.mjs history --directory /private/mongo-workspace
node cli.mjs preview --directory /private/mongo-workspace \
  --query hpd_projects --input /private/mongo-inputs/input.json --expected-revision 1
```

The browser and CLI consume the same native store. Every revision retains the
whole source and whole merchant plan together, plus the CA bytes when supplied.
Each has a profile identity and exact file hashes. Saving requires the revision
the operator reviewed; another saved edit produces a conflict. A retained Linux
file lock serializes cross-process authors. No stale lock file needs deletion
after an ordinary process exit.

```sh
node cli.mjs save --directory /private/mongo-workspace \
  --source /private/mongo-inputs/source.json \
  --plan /private/mongo-inputs/merchant-plan.json --expected-revision 1
node cli.mjs inspect --directory /private/mongo-workspace --revision 1
node cli.mjs export --directory /private/mongo-workspace \
  --destination /private/mongo-release --expected-revision 2
```

An older revision can be opened and reviewed, then saved as a new current
revision. Export reads one reviewed revision and creates a new destination.
Original source files and prior revisions remain available. Replacing a CA
requires importing a new source profile rather than pointing a browser edit at
another host file.

## Run the prepared merchant

The complete package contains `source.json`, `merchant-plan.json`, `service.json`,
`openapi.json`, optional `database-ca.pem`, `manifest.json`, and the original
generated client files in `client/`. Its manifest records each file's exact bytes
and SHA-256, route methods/resources/payment option counts and required URI
environment variables. Verification also recompiles the source/plan and compares
the generated service and bindings. Move the directory between approved hosts,
provide the declared environment variable there, then verify and launch it:

```sh
node cli.mjs verify --directory /private/mongo-release
node cli.mjs run --directory /private/mongo-release \
  --port 8423 --operations-port 8424
```

This uses the original challenge-only seller. Add the merchant's existing
`--facilitator https://FACILITATOR` to use the original native payment factory.
The CLI prints the actual loopback seller, docs, OpenAPI and operations URLs.
The original reverse proxy can expose the intended public resources. Keep
merchant authoring and operations on the private side of that deployment.
`--availability-dir` attaches the original retained availability controls.
SIGINT/SIGTERM drains the original seller and closes operations, MongoDB cursors,
sessions and connections.

The browser can start and stop an exported package, inspect its actual offers
and prepare a buyer handoff. `buyer.mjs` reads the same running seller's
`/_seller/health` and `/_seller/offers`, verifies the selected route and current
payment options, then calls original SF88 `prepareReview`. A buyer chooses one
explicit payment alternative. Body routes export the exact JSON body alongside
the prepared configuration. The native SF88 operator supplies its existing
policy, signer, response destination and execution environment.

## Native interfaces

| Module | Entry points |
| --- | --- |
| `config.mjs` | `readMongoSourceFile`, `openMongoSourceFile`, `describeMongoFile` |
| `catalog.mjs` | `inspectMongoDatabase`, `inspectMongoSourceFile` |
| `source.mjs` | `createMongoQuerySource`; returned `query`, `validate`, `route`, `inspect`, `describe`, `status`, `close` |
| `prepare.mjs` | `compileMongoMerchantPlan`, `prepareMongoSeller`, `verifyPreparedMongoSeller` |
| `onboarding.mjs` | `createMongoWorkspace`, `openMongoWorkspace`, `saveMongoWorkspacePlan`, `listMongoWorkspaceRevisions`, `inspectMongoWorkspace`, `previewMongoWorkspace`, `prepareMongoWorkspace` |
| `merchant.mjs` | `startMongoSeller`, `createMongoNativeFactory`; original seller/operations session |
| `buyer.mjs` | `readMongoBuyerOffer`, `prepareMongoBuyer`; original live offer and SF88 configuration |

Back up the entire private workspace directory and exported packages while the
authoring process is stopped, preserving owner-only permissions. Database backup
and point-in-time recovery remain with the MongoDB deployment. The source
connection URI belongs in the existing secret manager and is restored separately.

## Public HPD reference data

The two report examples target the official NYC HPD
[Affordable Housing Production by Building dataset](https://data.cityofnewyork.us/Housing-Development/Affordable-Housing-Production-by-Building/hg8x-zxpr),
endorsed by [HPD Open Data](https://www.nyc.gov/site/hpd/about/open-data.page).
The retained native run uses the complete 1,342-row Queens selection captured on
October 11, 2026, from the dataset updated September 30, 2026. Records represent
a building in a production project; summed counted unit events are production
history. Distinct recorded BBLs are reported separately from event totals.

The native importer retains original row hashes and source identifiers. BBL and
building/project identifiers use BSON `Long`; original decimal coordinate text
uses `Decimal128`. `dataset_updated_at` is the actual provider update instant.
`source_hash_prefix64` is a signed 64-bit identifier derived from the first eight
bytes of the retained original-row SHA-256, making values beyond JavaScript's
safe integer range reproducible from the actual public source. Project start
dates retain their original source strings and are not assigned an invented
timezone.

The original native journey returned 100 matching preservation records with the
truncation flag set, retaining all declared BSON types. The aggregate report
returned 796 new construction events with 22,019 counted unit events and 445
distinct recorded BBLs, plus 546 preservation events with 20,933 counted unit
events and 163 distinct recorded BBLs. The buyer received the same native rows
through the original two-request seller flow, and the moved package and revision
2 reopened successfully. Its payment adapter was a disposable local signer and
facilitator supplied through the original factory; the database and report
execution used the actual MongoDB server and the captured public records.
