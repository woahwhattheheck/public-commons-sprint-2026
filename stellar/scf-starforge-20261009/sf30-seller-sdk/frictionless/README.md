# Frictionless Data Package merchant

Turn a retained [Frictionless Data Package](https://datapackage.org/standard/data-package/) into a reviewed, versioned dataset served by the existing Starforge merchant. The package reader retains the publisher's exact descriptor, CSV/JSON data, external schemas and dialects, source references and licensing metadata. The original SF30 publisher owns extraction, review, publication, schedules and its browser; the original SF82 store owns merchant releases; the original SF88/SF100 customer workflow owns acquired pages.

## Run the product

Requires Linux, Python 3.10+, Node 22.16+ and util-linux `flock`. Python uses only its standard library. Set `SF_FRICTIONLESS_PYTHON` to a trusted installed Python executable when `python3` is not the selected runtime.

From the repository root:

~~~bash
node stellar/scf-starforge-20261009/sf30-seller-sdk/frictionless/cli.mjs --help
~~~

The maintained distribution exposes `stellar-forge frictionless`. The original dataset command also accepts `node dataset-cli.mjs frictionless ...`. The examples below use the direct CLI from the `frictionless` directory.

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
| `type: string`, `representation: physical` | Preserves the source's scalar text, including zero padding, decimal spelling and literal markers. |
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

The second command creates the original SF88 buyer configuration from the actual offer and retained snapshot. Continue that configuration through the existing [operator buyer](../../sf88-operator-buyer-cli/README.md) and [dataset delivery](../../sf100-buyer-dataset-delivery/README.md). Their acquired manifest and JSONL preserve the original response/page hashes and pinned edition. Applications can consume the original Python `DatasetDelivery`; the [PostgreSQL receiving guide](../../sf88-operator-buyer-cli/python/POSTGRESQL.md) describes transactional warehouse loading.

## 6. Refresh, export and reopen

Capture each new public edition into a new directory. Compare its retained metadata with the previous capture, review its schema/projection, and update the workspace's selected source configuration. Save a new original plan before extracting the new edition. Prior plans retain their own captures. Use the current dataset snapshot/revision when reviewing the new publication.

~~~bash
node cli.mjs compare --before /private/package-20261012/capture.json --after /private/package-20261013/capture.json
node cli.mjs source-export --source /private/package-source.json --output /private/package-source.tar.gz
node cli.mjs source-receive --archive /private/package-source.tar.gz --sha256 RETURNED_ARCHIVE_SHA --output /private/received-source
node cli.mjs review-source --source /private/received-source/source.json
~~~

Source export streams original files into an atomic create-only archive. The source remains portable alongside its complete capture; `original-source.json` preserves its earlier configuration. Receiving streams extraction, checks the whole archive identity and every declared file, rejects unsafe members, and reopens the retained source before committing the new directory. Hashing and transfer use bounded memory. Individual source members are limited to 256 MiB, the transfer archive to 256 MiB, and total extracted bundle bytes to 512 MiB.

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
