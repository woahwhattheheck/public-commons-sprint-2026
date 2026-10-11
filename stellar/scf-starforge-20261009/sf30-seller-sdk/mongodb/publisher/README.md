# Publish MongoDB reports as retained buyer datasets

Select a reviewed MongoDB report and fixed typed inputs, inspect its complete
CSV projection, publish through the original dataset version store, and enable
the original refresh policy. Buyers can continue using a retained snapshot as
later editions become available.

The [MongoDB merchant workspace](../workspace/README.md) provides this complete
flow in **Dataset publisher**. It retains the selected source revision and
merchant route's full payment alternatives, starts the versioned dataset
seller, manages its publication policy, and prepares original SF88 buyer
requests. The same merchant keeps its live queries and portable seller exports.

## Install and open

Use Linux, Node 22.16 or newer, util-linux `flock`, and the original pinned
MongoDB driver 7.7.0. The maintained distribution includes this component and
its runtime dependency group. In a source checkout, install the MongoDB
package and the original seller dependencies in the [merchant guide](../README.md):

```sh
npm ci --prefix stellar/scf-starforge-20261009/sf30-seller-sdk/mongodb \
  --ignore-scripts --no-audit --no-fund
node stellar/scf-starforge-20261009/sf30-seller-sdk/mongodb/cli.mjs publisher --help
```

Use a reviewed `stellar-forge.mongodb-source.v1` file. It names a URI environment
variable, database/TLS settings, fixed collections and pipelines, typed inputs,
and projected columns. Supply the credential URI through the launch environment.
A database read role is sufficient. Snapshot reads need MongoDB 5 or newer on a
replica set or sharded server. The existing connection reader enforces TLS and
supports the explicit loopback-only plaintext option for a local database.

In the merchant workspace, select a saved revision and report, choose a dataset
resource path, and create its publication. Source and payment choices remain
bound to that revision. A later merchant edit creates a new revision.

The standalone original publisher browser is also available:

```sh
starforge mongodb-publisher serve --workspace /private/housing-publications \
  --create --source /private/mongodb-source/source.json \
  --state /private/housing-dataset --port 8452
```

From a checkout, replace `starforge mongodb-publisher` with `node
stellar/scf-starforge-20261009/sf30-seller-sdk/mongodb/publisher/cli.mjs`. The
browser shows the actual collection, pipeline and read concern. Private files
use mode 0600; the original kernel lease gives one owner per publisher. Close
its browser or MCP session before opening that same workspace from another
process. Its separate versioned dataset seller can continue serving buyers.

## Save a reviewed plan

The form and CLI use the same original plan. A create-only template comes from
the selected source's actual declared columns and parameters:

```sh
starforge mongodb-publisher template --workspace /private/housing-publications \
  --query hpd_projects --out /private/housing-plan.json
starforge mongodb-publisher save --workspace /private/housing-publications \
  --input /private/housing-plan.json
```

Review the template's fixed inputs, public columns/types, allowed filters,
ranges/sorts, extraction order and budgets before saving. Its `sourceHash` binds
the source review. Each saved plan retains exact `original-source.json` bytes,
portable `source.json`, optional CA, `plan.json`, and hashes. Subsequent
extractions use those saved bytes and inputs.

CSV column names begin with a letter and contain at most 48 letters, digits or
underscores. Keep `_id` as a private extraction ordering field or alias it in
the reviewed pipeline to a declared field such as `document_id`. Public columns
may be a subset of the report's source columns.

Handle optional fields explicitly. A reviewed stage can turn an absent
coordinate into a nullable public field:

```json
{ "$set": { "latitude": { "$ifNull": ["$latitude", null] } } }
```

Otherwise, a missing public field fails extraction. This preserves the
merchant's distinction between missing and null.

## Extract, review and publish

The MongoDB source uses its existing pool, admission queue, cancellation and
close lifetime. It streams one aggregation/session and awaits each original
CSV writer call. Authored stages, including an authored `$limit`, remain part
of the query. The extraction ceiling is independent of the live report's
`maxRows`; exceeding it fails the complete candidate.

```sh
starforge mongodb-publisher extract --workspace /private/housing-publications --plan 1
starforge mongodb-publisher inspect --workspace /private/housing-publications --run RUN_UUID
starforge mongodb-publisher review --workspace /private/housing-publications \
  --run RUN_UUID --reviewer 'Merchant operator' \
  --note 'Reviewed complete source selection and public fields' --initialize
starforge mongodb-publisher publish --workspace /private/housing-publications \
  --run RUN_UUID --review REVIEW_UUID
```

Use the returned native run and review IDs. First publication initializes an
absent target. For refresh, replace `--initialize` with the displayed
`--expect SNAPSHOT --expect-revision NUMBER`. The original writer checks this
exact target revision and dataset contract, then atomically promotes the
candidate under its configured retention and capacity rules.

Candidate files include `data.csv`, `dataset.json` and `candidate.json`. Their
manifest binds source, plan, query, CSV and configuration hashes; row count;
observed BSON types; ordering/limits; native server/driver identity; database,
collection and read concern. Preview uses the original dataset parser.
History retains unsuccessful attempts alongside complete and published runs.
An interrupted acknowledgement can be reconciled with the original recovery
operation while the last published edition remains available.

## BSON values and source consistency

| Public type | Accepted native values |
| --- | --- |
| `string` | Native text; exact Int32/Int64/Decimal128 decimal text; ObjectId hex; Boolean text. Dates, Double values, binary, arrays and documents use canonical Extended JSON v2 serialized as a string. |
| `integer` | Native Int32/Int64 within JavaScript's safe integer range. Larger integers require Text. |
| `number` | Finite native Double. Decimal128 requires Text. |
| `boolean` | Native BSON Boolean. |
| Nullable column | Native null becomes the original CSV format's empty nullable cell. |

Large identifiers such as `9007199254740993` and exact decimals remain strings.
Nested BSON scalar types remain explicit in canonical Extended JSON. A Date
Text cell retains `{"$date":{"$numberLong":"..."}}`. String filters/sorts use
the dataset's existing text comparisons. Add a separately reviewed projection
when another public comparison semantics is required.

A real empty string in a nullable column is refused because the existing CSV
format uses that representation for null. Non-nullable Text preserves empty
strings. Every actual column type is counted during extraction; an empty result
has empty observed type counts rather than an invented static schema.

| Declared read concern | Native source observation |
| --- | --- |
| `snapshot` | One majority-committed point in time using the original driver snapshot session. |
| `majority` | Majority-committed data without a point-in-time guarantee across the complete read. |
| `local` | The source's local read semantics, without majority or point-in-time guarantees. |

Each completed CSV is an immutable edition whose manifest states the database
read that produced it. Public session `operationTime` and `clusterTime`, when
available, retain their original meanings; neither substitutes for the driver's
internal snapshot timestamp.

Default extraction limits: 250,000 rows, 64 MiB canonical source/output bytes,
1 MiB per projected row, and 30 seconds. Maximums: 1,000,000 rows, 256 MiB,
8 MiB per row, and 300 seconds. The server suppresses oversized BSON rows before
delivery; the stream checks canonical JSON row size too. The original writer
independently counts full CSV bytes, including escaping and header. Queueing,
database work and awaited writes share the deadline.

Choose one to sixteen sort fields, with a unique final tiebreaker when order
must be repeatable between editions. The wrapper places null/missing values
last and preserves MongoDB's source collation and native value ordering. The
outer ceiling reads one sentinel row to distinguish complete from excessive
results. A sentinel, cancellation or conversion error leaves the active
published edition unchanged.

## Seller, buyer and recurring operation

The integrated merchant tab starts the original versioned seller with every
retained route payment alternative, links its native documentation, and offers
the exact snapshot-bound buyer download. The standalone flow uses the original
dataset commands:

```sh
starforge dataset-refresh configure --state /private/housing-dataset \
  --payment /private/payment.json --origin https://merchant.example \
  --path /housing --snapshot-selection --out /private/housing-seller.json
starforge dataset-refresh serve --state /private/housing-dataset \
  --seller /private/housing-seller.json --port 8423
starforge mongodb-publisher serve --workspace /private/housing-publications \
  --seller http://127.0.0.1:8423 --resource https://merchant.example/housing
```

Read the original seller offer for a retained extraction and first-page query.
Select an advertised alternative, exact offer digest and buyer intent ID. The
original SF88 configuration contains the resource and snapshot selection.
Continue with [SF88 dataset acquisition](../../../sf88-operator-buyer-cli/DATASETS.md)
and the [native signer](../../../sf103-native-buyer-signer/README.md).

The original policy records the published baseline, cadence, row bounds,
permitted percentage decrease, error behavior, reviewer and note. Enable it
against the current target. **Run refresh now** and later intervals use that
same retained source plan. Each occurrence retains its native run, candidate,
review and publication; unchanged data retains its snapshot. The
[schedule guide](../../postgres/publisher/SCHEDULES.md) describes exact CLI
fields, recovery and restart behavior.

For agent operation, declare `kind: "mongodb"` in the original
[merchant MCP publisher connection](../../../../../stellar-forge/mcp-merchant-operator/PUBLISHERS.md).
Its existing publication, schedule and buyer tools use the same workspace.

Stop the owner process before backing up the complete merchant workspace or
standalone publisher with its source/CA and dataset target. Preserve native
absolute source/target bindings; keep credentials in the launcher environment.
Reopen the existing paths without `--create`. The integrated tab retains the
dataset seller's requested running state and resumes its original scheduler.

## Native API and primary references

`openMongoPublisher(options)` in `model.mjs` delegates to the maintained
`openSourceDatasetPublisher(options, mongoPublisherDriver)`. The original
Mongo source adds `exportDataset(name, input, {signal, onRow, ...extraction})`.
The original publisher owns candidate/review/version state; the original
scheduler owns recurring work.

- [Snapshot read concern](https://www.mongodb.com/docs/manual/reference/read-concern-snapshot/)
- [Node cursor iteration and cancellation](https://www.mongodb.com/docs/drivers/node/current/crud/query/cursor/)
- [Canonical Extended JSON](https://www.mongodb.com/docs/manual/reference/mongodb-extended-json/)
- [Aggregation sort behavior](https://www.mongodb.com/docs/manual/reference/operator/aggregation/sort/)
- [Original CSV dataset API](../../DATASET_API.md)
