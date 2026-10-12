# Frictionless Data Package merchant

Turn a retained [Frictionless Data Package](https://datapackage.org/standard/data-package/) into a reviewed, versioned dataset served by the existing Starforge merchant. The package reader retains the publisher's exact descriptor, CSV/TSV/JSON/Parquet data, external schemas and dialects, source references and licensing metadata. The original SF30 publisher owns extraction, review, publication, schedules and its browser; the original SF82 store owns merchant releases; the original SF88/SF100 customer workflow owns acquired pages.

## Run the product

Requires Linux, Python 3.10+, Node 22.16+ and util-linux `flock`. CSV, TSV and JSON use Python's standard library. Parquet uses the already maintained Wherobots PyArrow decoder and its optional installed runtime, described below. Set `SF_FRICTIONLESS_PYTHON` to a trusted installed Python executable when `python3` is not the selected runtime.

From the repository root:

~~~bash
node stellar/scf-starforge-20261009/sf30-seller-sdk/frictionless/cli.mjs --help
~~~

The maintained distribution exposes `starforge frictionless`. The original dataset command also accepts `node dataset-cli.mjs frictionless ...`. The examples below use the direct CLI from the `frictionless` directory.

Use canonical private directories and owner-only source/configuration files. The original publisher takes a writer lease: close its browser server before opening that same workspace through another CLI process.

## 1. Capture an original package edition

~~~bash
node cli.mjs capture --descriptor /private/source/datapackage.json --output /private/package-20261012
node cli.mjs inspect-capture --capture /private/package-20261012/capture.json
node cli.mjs suggest-source --capture /private/package-20261012/capture.json --output /private/package-source.json
~~~

The descriptor may be a local path or HTTPS URL. Local relative resource references resolve from the original descriptor; HTTPS references remain HTTPS through redirects. A package may contain multiple named tabular resources, multiple paths for one resource, or inline data. `--resource NAME` selects named resources; omit it to capture the whole package. Repeat `--reference PATH_OR_HTTPS_URL` to retain original documentation needed for a schema review.

A capture has a create-only directory, complete manifest and content-addressed original files. Each file is bound to its byte length and SHA-256, with original retrieval URL, redirect destination and available HTTP metadata. Descriptor, schema and dialect references remain attached to their original resource. Package and resource licensing metadata stays in inspection and in the release's retained source.

Inspection reads the complete selected tables and reports per-resource row counts, field metadata, declared missing markers, empty cells, keys and errors. A resource requiring review does not prevent the report from describing other resources.

## 2. Review the projection and source semantics

The suggested configuration preserves physical strings and literal missing markers. Review this source before creating the publication plan:

~~~json
{
  "schema": "stellar-forge.frictionless-source.v1",
  "connection": {
    "file": "/private/package-20261012/capture.json",
    "sha256": "THE_CAPTURE_SHA256_RETURNED_BY_CAPTURE"
  },
  "queries": {
    "monthly": {
      "resource": "co2-mm-mlo",
      "projection": {
        "Month": {
          "field": "Date",
          "type": "string",
          "missing": "literal",
          "representation": "physical"
        },
        "Average": {
          "field": "Average",
          "type": "string",
          "missing": "literal",
          "representation": "physical"
        }
      }
    }
  }
}
~~~

Use each resource's inspected field names. The example shows the configuration shape; the original NOAA monthly package described below needs its reviewed full schema before publication.

Each output alias must be a safe native dataset column name. Each projection explicitly chooses a source field, native type, representation and missing-value policy:

| Choice | Result |
| --- | --- |
| `type: string`, `representation: physical` | Preserves source scalar text for text formats; Parquet uses the exact typed representation described below. |
| `type: integer` | Requires a logical integer exactly representable by the native JavaScript integer range. |
| `type: number` | Requires a finite logical number whose decimal value survives the native JSON number representation exactly. |
| `type: boolean` | Uses the source schema's accepted boolean representation. |
| `missing: literal` | Preserves the original marker as text; use a string projection. |
| `missing: null` | Produces native null and marks the dataset column nullable. |
| `missing: reject` | Stops extraction when a declared missing value occurs. |

Field-level `missingValues` overrides the schema list. An absent list uses the standard empty-string marker. An empty string cannot simultaneously mean an actual string and null in the same native CSV column; choose a projection that keeps those meanings distinct.

Logical numbers use decimal parsing before conversion. Values outside the native integer range, extra decimal precision, numeric underflow and a changed negative-zero representation produce a useful projection error; preserving physical text keeps the original value available. Date, datetime, time, year and year-month metadata remain attached to their source fields. Original month strings remain month strings.

The reader supports the relevant [Table Schema](https://datapackage.org/standard/table-schema/) scalar types, required/unique/primary keys, supported field constraints, explicit field lists, and [Table Dialect](https://datapackage.org/standard/table-dialect/) CSV settings. Keys are checked over the complete selected resource using a private SQLite index. CSV parsing includes quoted/multiline values, declared encoding, delimiter/quote/escape settings, header rows and joins, comments and explicit no-header tables. Quoted values beginning with a comment character remain data.

Foreign keys, custom profiles, JSON Schema constraints and domain-specific structures such as GeoJSON retain their original definitions and review notes. Apply the source's additional domain checks when selecting those fields. The inspection result describes the reader's supported checks.

### Resolve stale source metadata explicitly

A query may include a reviewed `schemaOverride`, `schemaReview` and supported `dialect` overrides. The schema review must record a reason and exact original references already captured with `--reference`:

~~~json
{
  "schemaOverride": {
    "fields": [
      {"name": "Month", "type": "yearmonth"},
      {"name": "DecimalDate", "type": "number"},
      {"name": "Average", "type": "number"},
      {"name": "Deseasonalized", "type": "number"},
      {"name": "NumberOfDays", "type": "integer"},
      {"name": "StandardDeviation", "type": "number"},
      {"name": "Uncertainty", "type": "number"}
    ],
    "primaryKey": ["Month"]
  },
  "schemaReview": {
    "reason": "The package's monthly CSV has seven fields; its older header and schema have six. Use NOAA's retained current column definitions, accounting for the package's combined year-month field.",
    "sources": ["https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.csv"]
  },
  "dialect": {"header": false, "commentRows": [1]}
}
~~~

Place these properties inside the selected query, alongside `resource` and `projection`; the projection then names the reviewed fields. The complete original descriptor, original header and supporting NOAA file remain retained. An intentionally excluded blank record can be named in `commentRows`; blank rows are otherwise read.

~~~bash
node cli.mjs review-source --source /private/package-source.json
node cli.mjs plan --source /private/package-source.json --query monthly --out /private/monthly-plan.json
~~~

The plan carries the selected exact types and nullability into the original CSV schema. Review its exposed columns, enabled filters/ranges/sorts, complete extraction order and resource limits. Ordering has an explicit original-member/record tie breaker and nulls last. Exceeding row, byte, row-size or time limits stops the extraction; the published candidate must be complete.

## 3. Extract, inspect, review and publish

~~~bash
node cli.mjs init --workspace /private/monthly-publisher --source /private/package-source.json --state /private/monthly-dataset
node cli.mjs save --workspace /private/monthly-publisher --input /private/monthly-plan.json
node cli.mjs extract --workspace /private/monthly-publisher --plan 1
node cli.mjs inspect --workspace /private/monthly-publisher --run RETURNED_RUN_UUID --query 'limit=20'
node cli.mjs review --workspace /private/monthly-publisher --run RETURNED_RUN_UUID --reviewer 'Merchant operator' --note 'Reviewed original source fields and complete extraction.' --initialize
node cli.mjs publish --workspace /private/monthly-publisher --run RETURNED_RUN_UUID --review RETURNED_REVIEW_ID
~~~

The saved plan retains the complete capture and the exact original and portable source configurations. Extraction uses these retained inputs even if a public source later changes. Review is tied to that candidate's original digest; publication uses the original dataset version store.

For an existing target, replace `--initialize` with `--expect CURRENT_SNAPSHOT --expect-revision CURRENT_REVISION`. Read those values from the current target; a concurrent change requires reviewing the actual current edition.

The existing private browser exposes the same source, plans, extraction, review, publication and schedule operations:

~~~bash
node cli.mjs serve --workspace /private/monthly-publisher --port 8487
~~~

Open the exact private URL returned by the original server. `status` pages plans, runs and history. `recover` reconciles an interrupted original publication.

## 4. Prepare and operate the original merchant release

Retain the selected merchant's existing public payment terms in an owner-only JSON file. Its supported fields are `scheme`, `network`, `asset`, `amount`, `payTo` and `maxTimeoutSeconds`. Use the merchant's real HTTPS origin.

~~~bash
node cli.mjs release-prepare --workspace /private/monthly-publisher --run RETURNED_RUN_UUID --output /private/monthly-release-package --payment /private/merchant-payment.json --origin https://merchant.example
node cli.mjs release-stage --package /private/monthly-release-package --releases /private/merchant-releases --id monthly-20261012 --label 'Monthly source edition'
node ../../sf82-seller-pilot/release-cli.mjs status --store /private/merchant-releases
node ../../sf82-seller-pilot/release-cli.mjs inspect --store /private/merchant-releases --id monthly-20261012
node ../../sf82-seller-pilot/release-cli.mjs activate --store /private/merchant-releases --id monthly-20261012 --expect CURRENT_GENERATION
node ../../sf82-seller-pilot/release-cli.mjs run --store /private/merchant-releases --expect ACTIVATED_GENERATION
~~~

Preparation consumes the already published extraction. It retains the candidate CSV/configuration, original plan, original and portable source configurations, full capture manifest, every captured source/reference file, schema review, original extraction and review/publication records. The native seller exposes the dataset snapshot parameter so a customer can keep all acquired pages on the selected edition.

Staging uses the original SF82 dataset package and release store. A repeated package or release ID reopens only when the retained edition, seller terms and runtime still match. Optional `--runtime /private/runtime.json` selects the original runtime's `port`, `facilitator` and `allowLocalFacilitator`; omit it for the original local port selection.

Use the maintained [SF82 release guide](../../sf82-seller-pilot/README.md) and `release-cli.mjs` to inspect, compare, activate with the current generation, roll back, and run that release. The additive API exports `prepareFrictionlessRelease`, `stageFrictionlessRelease`, and direct original activation/rollback/run wrappers. The original dataset runtime owns the seller handler and version controller.

## 5. Receive original customer pages

With the original merchant running, inspect its actual offer and retain the selected option:

~~~bash
node cli.mjs buyer --workspace /private/monthly-publisher --run RETURNED_RUN_UUID --seller http://127.0.0.1:ACTUAL_PORT --resource https://merchant.example/data
node cli.mjs buyer --workspace /private/monthly-publisher --run RETURNED_RUN_UUID --seller http://127.0.0.1:ACTUAL_PORT --resource https://merchant.example/data --intent CUSTOMER_INTENT --option SELECTED_INDEX --offer-sha RETURNED_OFFER_SHA
~~~

The second command creates the original SF88 buyer configuration from the actual offer and retained snapshot. Continue that configuration through the existing [operator buyer](../../sf88-operator-buyer-cli/README.md) and [dataset delivery](../../sf88-operator-buyer-cli/python/DATASETS.md). Their acquired manifest and JSONL preserve the original response/page hashes and pinned edition. Applications can consume the original Python `DatasetDelivery`; the [PostgreSQL receiving guide](../../sf88-operator-buyer-cli/python/POSTGRESQL.md) describes transactional warehouse loading.

## 6. Refresh, export and reopen

Capture each new public edition into a new directory. Compare its retained metadata with the previous capture, review its schema/projection, and update the workspace's selected source configuration. Save a new original plan before extracting the new edition. Prior plans retain their own captures. Use the current dataset snapshot/revision when reviewing the new publication.

~~~bash
node cli.mjs compare --before /private/package-20261012/capture.json --after /private/package-20261013/capture.json
node cli.mjs source-export --source /private/package-source.json --output /private/package-source.tar.gz
node cli.mjs source-receive --archive /private/package-source.tar.gz --sha256 RETURNED_ARCHIVE_SHA --output /private/received-source
node cli.mjs review-source --source /private/received-source/source.json
~~~

Source export streams original files into an atomic create-only archive. The source remains portable alongside its complete capture; `original-source.json` preserves its earlier configuration. Receiving streams extraction, checks the whole archive identity and every declared file, rejects unsafe members, and reopens the retained source before committing the new directory. Hashing and transfer use bounded memory. Individual source members are limited to 256 MiB, the transfer archive to 256 MiB, and total extracted bundle bytes to 512 MiB.


### Publish the retained source at a receiving location

A source archive contains the complete capture and source mapping. Keep the original reviewed publication plan with the handover as well: its dataset contract, extraction order and limits are separate from the source mapping.

The SF82 dataset runtime opens the exact version-store path in its `binding.json` `datasetDirectory`. A prepared package or staged store may move while that version store remains at its configured path. To operate at a new version-store location, publish the received source into a new canonical target, then prepare and stage a release bound to that target through the original interfaces.

Create the receiving parent directories with owner-only access. After the source-receive and review-source commands above, generate a receiving plan:

~~~bash
node cli.mjs plan --source /private/received-source/source.json --query monthly --out /private/received-plan.json
~~~

The `plan` command accepts `--source`, `--query` and `--out`. It generates a starting plan ordered by the first projected column ascending, empty filters/ranges/sorts, 50 default rows per page and 250 maximum, plus the original extraction defaults. Review the generated JSON before saving it.

For a restored customer contract, carry over the original reviewed input fields while keeping the receiving plan's newly computed `sourceHash`. This example accepts either the original input plan or its retained `plans/PLAN_FOLDER/plan.json`; place that file at the first path below:

~~~bash
python3 - /private/original-reviewed-plan.json /private/received-plan.json <<'PY'
import json
import sys
from pathlib import Path

original = json.loads(Path(sys.argv[1]).read_text())
destination = Path(sys.argv[2])
received = json.loads(destination.read_text())
if original["query"] != received["query"]:
    raise SystemExit("Choose the original reviewed named query.")
dataset_fields = (
    "name", "columns", "filters", "ranges", "sorts",
    "maxCellChars", "defaultLimit", "maxLimit", "maxPageBytes",
)
received.update(
    title=original["title"],
    query=original["query"],
    input=original.get("input", {}),
    dataset={key: original["dataset"][key] for key in dataset_fields
             if key in original["dataset"]},
    extraction=original["extraction"],
)
destination.write_text(json.dumps(received, indent=2) + "\n")
PY
~~~

The received source hash stays tied to its actual local configuration. Derived saved-plan fields such as `digest`, `runtimeSourceHash`, and the generated dataset `schema`, `file`, `maxRows` and `maxBytes` are produced by the original publisher when it saves this input.

Run the full original publication and release workflow at the new paths:

~~~bash
node cli.mjs init --workspace /private/received-publisher --source /private/received-source/source.json --state /private/received-dataset
node cli.mjs save --workspace /private/received-publisher --input /private/received-plan.json
node cli.mjs extract --workspace /private/received-publisher --plan RETURNED_RECEIVING_PLAN_NUMBER
node cli.mjs inspect --workspace /private/received-publisher --run RETURNED_RECEIVING_RUN_UUID --query 'limit=20'
node cli.mjs review --workspace /private/received-publisher --run RETURNED_RECEIVING_RUN_UUID --reviewer 'Receiving operator' --note 'Reviewed the complete retained source and original publication contract at the receiving location.' --initialize
node cli.mjs publish --workspace /private/received-publisher --run RETURNED_RECEIVING_RUN_UUID --review RETURNED_RECEIVING_REVIEW_ID
node cli.mjs release-prepare --workspace /private/received-publisher --run RETURNED_RECEIVING_RUN_UUID --output /private/received-release-package --payment /private/merchant-payment.json --origin https://receiving-merchant.example
node cli.mjs release-stage --package /private/received-release-package --releases /private/received-releases --id received-monthly-20261012
node ../../sf82-seller-pilot/release-cli.mjs status --store /private/received-releases
node ../../sf82-seller-pilot/release-cli.mjs inspect --store /private/received-releases --id received-monthly-20261012
node ../../sf82-seller-pilot/release-cli.mjs activate --store /private/received-releases --id received-monthly-20261012 --expect CURRENT_GENERATION
node ../../sf82-seller-pilot/release-cli.mjs run --store /private/received-releases --expect ACTIVATED_GENERATION
~~~

Compare the original and receiving capture SHA-256, selected query/projection, reviewed schema, complete row count and published snapshot. The receiving plan, run, target directory, release digest and listener are its own results. Use that listener and public resource with the buyer commands in section 5. Stop the original foreground service with its normal signal, then run the same selected release again; check its actual health and offer after reopening. The original publisher, target and release remain independently operable through their existing interfaces.

The metadata comparison reports changes to source files, schema, dialect and fields. Use the original versioned dataset/customer comparison for row-level edition changes. The existing [publisher schedules](../postgres/publisher/SCHEDULES.md) operate reviewed saved plans. A saved Frictionless plan is a fixed capture; fetching a new HTTP source edition remains an explicit capture/review operation.

## Completed original source operation

The first complete operation used all six original resources from [datasets/co2-ppm at 8c409723](https://github.com/datasets/co2-ppm/tree/8c4097238570147adf6fa97ad357315528dac4c5), retaining its ODC-PDDL-1.0 metadata. The package contained seven original files. Two original NOAA CSV references brought the complete retained source to nine files and 138,772 bytes.

The monthly Mauna Loa resource had seven data columns and an older six-column header/schema. The monthly global resource had six data columns and an older four-column header/schema. The reviewed mappings used NOAA's original [Mauna Loa](https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_mlo.csv) and [global](https://gml.noaa.gov/webdata/ccgg/trends/co2/co2_mm_gl.csv) column definitions; the original package bytes and markers stayed retained. The Mauna Loa annual-growth file's blank second record was explicitly represented in the reviewed dialect.

| Original resource | Published rows |
| --- | ---: |
| co2-mm-mlo | 822 |
| co2-annmean-mlo | 67 |
| co2-gr-mlo | 67 |
| co2-mm-gl | 570 |
| co2-annmean-gl | 47 |
| co2-gr-gl | 67 |
| **Total** | **1,640** |

All six completed the original extract → inspect → review → publish sequence. A complete source archive was exported, received into a new private directory and reopened with the same capture SHA-256 and all six complete row counts. This operation used the original data and original publisher/version-store implementation.

### Merchant activation and independent receiving completed

The 822-row Mauna Loa monthly edition completed both the original merchant journey and an independent merchant created from the received source. The published snapshot is `345a7111117cccefad818c7714f8fa8ccbd7af0ebb5ee311eeea5c936090973f`.

| Original native operation | Publisher and merchant | Independent receiving merchant |
| --- | --- | --- |
| Complete publication | 822 rows | Same 822 rows and snapshot |
| Retained source/plan/candidate closure | 15 files, 204,725 bytes | 15 files, 204,660 bytes |
| Release ID | `co2-mm-mlo-20261012` | `received-co2-mm-mlo-20261012` |
| Activated generation | 1 | 1 |
| Actual health and data response | HTTP 200 / HTTP 402 | HTTP 200 / HTTP 402 |
| Original SF88 buyer configuration | Prepared from the live offer | Prepared from the live receiving offer |
| Stop and fresh-process reopen | HTTP 200, same selected release | HTTP 200, same selected receiving release |

Both used the original SF82 public testnet example terms from `examples/upstream-selections.json` and the original challenge-only merchant. The receiving journey used the streamed archive's retained source, the same reviewed monthly mapping and publication options, a new publisher and a new dataset version store. Its prepared binding points to that new store. Both completed services closed their owned listeners.

The original release digest is `b4cdc19f8de5164929c220966e1d7007653ccea927425e138f153ab6f2ed7394`; the independent receiving release digest is `04fa41fe829506fae2e7cc843c01eb41fa7b3419d0c04246b3815c6828f219b9`. The live offer retained SHA-256 `7338def7750903814f37d3ffe531813cc53276306a0d348e1e9f594352067961` across both merchants. Each buyer configuration contains its own new intent and operation identity.

The complete original source, streamed archive, native merchant/customer results and receiving instructions are attached to the [original Frictionless delivery thread](https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791764771161389). The received source supports another fresh publication through the steps above.

## Parquet resources and complete PUDL receiving

The same capture, source review, publication, merchant release and source-transfer commands accept a resource with `format: parquet`. When the resource omits `format`, a declared path or list of paths ending in `.parquet` selects that format. An explicit format remains authoritative. All declared members and every row group are read in their original order.

### Use the original installed Arrow runtime

The Parquet adapter imports the maintained [Wherobots output reader](../wherobots/source/wherobots_operator/editions.py). Keep that component beside Frictionless in the complete SF30 source or installed distribution. It owns the Arrow decoding and typed nested values. The adapter applies the existing Frictionless field mapping, schema checks and reviewed projection.

Use the trusted Python interpreter already configured with the Wherobots PyArrow requirement. The current original [requirements](../wherobots/source/requirements.txt) pin `pyarrow==26.0.0`. The local Parquet operation needs that Arrow dependency; it does not open a Wherobots account or submit a remote job.

~~~bash
export SF_FRICTIONLESS_PYTHON=/private/arrow-runtime/bin/python
"$SF_FRICTIONLESS_PYTHON" -c 'import pyarrow; print(pyarrow.__version__)'
node cli.mjs inspect-capture --capture /private/pudl-release/capture.json
~~~

Inspection records the actual installed PyArrow version, physical column types and nullability, complete metadata row count, row-group count, original geometry metadata when present, and each member's exact byte length and SHA-256. The original reader processes bounded batches with its threaded/prebuffered reads disabled. The normal private-file checks and a before/after file identity check cover the retained source while the native reader is open.

### Review typed values before publication

A Parquet file contains typed values rather than an original CSV spelling. Its complete binary bytes remain in the source capture. The physical string projection uses these representations:

| Original Parquet value | Retained projection representation |
| --- | --- |
| Null | Native null when the projection chooses `missing: null`; choose a missing policy explicitly. |
| String and dictionary string | The complete original string, including leading zeroes. |
| Signed or unsigned integer | Decimal integer text, without conversion through a floating-point value. |
| Decimal | Decimal text with the original value and scale represented by Arrow's Decimal value. |
| Finite floating-point number | Python's round-tripping representation of the original native value. The original binary file retains its bit representation. |
| Boolean | `true` or `false`. |
| Date | ISO calendar date. |
| Timestamp | Exact epoch ticks rendered as ISO datetime, keeping the original seconds/milliseconds/microseconds/nanoseconds and declared timezone. |
| Time | Exact clock time at the original unit precision. |
| Duration | Exact signed ISO seconds duration. |
| Binary, list, map or struct | The existing reader's lossless JSON representation, including its original typed markers. |

Logical schema validation still precedes projection. A native numeric publication requires an exact finite value; a reviewed physical string projection can retain declared NaN or infinity when the source constraints allow it. A typed structure that does not meet its declared scalar schema requires a source review. Schema constraints and required/unique/primary-key checks run over the complete resource. The native dataset's safe integer and number rules remain unchanged; a string representation retains larger integers and decimals when a native numeric column cannot represent them exactly.

A resource's Table Schema matches columns by the existing `fieldsMatch` contract, including exact, equal, subset, superset and partial matches. Physical column names and schema field names stay bound through that mapping. CSV dialect overrides are rejected for Parquet. The original descriptor and its declared dialect remain retained for source review.

### Select one complete PUDL edition

[PUDL's original access guide](https://docs.catalyst.coop/pudl/en/stable/data_access.html) publishes Parquet files and a full Frictionless descriptor. Its [2026.9.0 release notes](https://docs.catalyst.coop/pudl/en/stable/release_notes.html) describe `pudl.duckdb` built from processed Parquet and retirement of processed `pudl.sqlite` in 2027. Raw, minimally processed FERC SQLite is a separate source product.

Choose the actual published version or one retained nightly edition before capture. Use its original descriptor URL and declared resource paths. Record the descriptor's complete bytes/hash, package ID, created timestamp, git SHA/tags and source DOI/version metadata. A current documentation version or a guessed bucket prefix does not identify the downloaded dataset edition.

This coherent generator, plant and annual-operator workflow uses four complete original tables:

| Original resource | Primary key | Purpose |
| --- | --- | --- |
| `core_eia__entity_generators` | `plant_id_eia, generator_id` | Original harvested generator attributes. |
| `core_eia__entity_plants` | `plant_id_eia` | Original plant identity, name, geography and timezone. |
| `core_eia860__scd_plants` | `plant_id_eia, report_date` | Dated plant attributes and reported operator identity. |
| `core_eia__entity_utilities` | `utility_id_eia` | Utility identity and name. |

The selected original code definitions have 20, 12, 41 and 2 fields respectively. Inspect the captured descriptor as the authority for the selected release. Each table fits the existing 64-column native projection contract. Retain every field and row of each selected table; the full descriptor also preserves the declarations for resources outside this selection.

~~~bash
node cli.mjs capture \
  --descriptor "$PUDL_DESCRIPTOR_URL" \
  --resource core_eia__entity_generators \
  --resource core_eia__entity_plants \
  --resource core_eia860__scd_plants \
  --resource core_eia__entity_utilities \
  --output /private/pudl-release
node cli.mjs inspect-capture --capture /private/pudl-release/capture.json
node cli.mjs suggest-source --capture /private/pudl-release/capture.json --output /private/pudl-source.json
~~~

For each single-file resource, compare the descriptor's original `bytes` and `hash` with the captured member. Keep the original descriptor and retrieval results if the live source changes; complete a consistent edition before saving a publication plan. Do not edit a retained descriptor to conceal an edition mismatch.

Review all four suggested queries. Use the original ID/date/string fields and choose a null policy for every nullable field. A conservative full-column handover uses physical strings with `missing: null`; an explicit logical integer or boolean projection is also available where the complete source passes the original native type checks. Name and compare the same complete projection at both receiving locations.

Use section 3 to save, extract, inspect, review and publish each of the four queries into its own original version store. Choose the original primary-key fields as the extraction order when editing each generated plan. Raise a default row or byte ceiling only after reading the full source inspection and preserving a finite complete-table limit. A successful candidate contains the entire selected resource.

### Preserve relationships and customer query meaning

The reader checks the declared required/unique/primary keys. It retains all foreign-key declarations for the selected resources. The migration operator separately checks the concrete joins that the selected customer workflow uses:

- Generators' non-null `plant_id_eia` values resolve to the original plant table.
- Dated plant rows resolve to the plant entity table.
- Non-null dated `utility_id_eia` values resolve to the utility entity table.
- Annual `report_date` remains the original date; retain the source's annual/monthly relationship rules when comparing a different resource family.

Keep null counts, duplicate-key results, full row counts and unmatched-join results with the receiving package. These checks describe the selected tables and joins. PUDL's complete foreign-key validation remains in its original processing checks; the current processed DuckDB product does not install every declared foreign key.

The harvested entity tables and dated plant table have different time semantics. Join a generator to its plant using the source key, and join a dated operator record using its original `report_date`. An undated entity row is not evidence of annual generation or annual available capacity. Any customer report that depends on generation, ownership, fuel or operating capacity needs its corresponding original PUDL tables and an explicit source contract.

### Receive, reopen and move an existing SQLite consumer

Export the complete four-query source and retain all four reviewed publication plans with it:

~~~bash
node cli.mjs source-export --source /private/pudl-source.json --output /private/pudl-source.tar.gz
node cli.mjs source-receive --archive /private/pudl-source.tar.gz --sha256 RETURNED_ARCHIVE_SHA --output /private/pudl-received
node cli.mjs review-source --source /private/pudl-received/source.json
~~~

Follow section 6 to rebuild each plan at the receiving location while preserving its reviewed dataset contract, extraction order and limits. Run the complete original extract/review/publish operation again. Compare every selected query, source-member identity, row count, key and published scalar value. A new target's path belongs in its own freshly prepared merchant release.

For a customer migration, retain the current SQLite edition and the complete original queries first. Build the new DuckDB or Parquet-backed consumer from the same selected release and all required tables. Compare complete query results using original keys, explicit null/date handling and the same selected source edition. Keep the old consumer available until the receiving operator approves the matched reports and completes close/reopen and restore. A comparison against a differently dated public release describes a data update as well as an engine migration.

Direct DuckDB access to the public bucket follows PUDL's documented anonymous path-style S3 configuration. A retained local Parquet copy can be queried offline. The source archive, original descriptor, reviewed projections, source/member identities and complete native outputs travel together so the receiving operator can reproduce the selected edition without relying on a mutable public URL.

PUDL's published data and documentation use [CC-BY-4.0](https://github.com/catalyst-cooperative/pudl/blob/bb9eac77cd9c60e3139716c0b220afabdf569f26/README.md); preserve its attribution and source DOI metadata. Its software is MIT. Keep any customer's separate private-input and publication terms in that customer's agreed workshare.

## Complete installed source workbench

The [source workbench](workbench/README.md) adds host-declared input intake, full native resource inspection, immutable ordered query editions, complete review, atomic publisher source selection and original plan saving to this same Frictionless publisher. The installed **frictionless-agent** application borrows the original merchant publisher and scheduler. The **frictionless-source** client exposes the same retained operations and complete resumable source handover.

Use [FRICTIONLESS_WORKSPACE.md](../../../../stellar-forge/mcp-merchant-operator/FRICTIONLESS_WORKSPACE.md) for complete host configuration, operator screens, agent tools and installed launch. The source export includes [RECEIVING.md](workbench/RECEIVING.md), the exact native archive, query text, capture inspection, all then-retained edition reviews and original source-selection/saved-plan bindings. Dataset generations and customer warehouses keep their existing complete receiving paths described above.

Source selection advances an opting-in Frictionless publisher's workspace marker to v2 before committing its current source. Retained earlier plans keep their own original source captures. The maintained release/config readers recognize that marker; runtimes that only understand v1 must use the current complete source instead of reverting the original source selection.
