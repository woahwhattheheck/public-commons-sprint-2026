# Source meanings in the Python customer workspace

The original SF88/SF100 dataset customer retains the reviewed source dictionary alongside the acquired rows. Python can open the dictionary, import the same complete delivery into the existing SQLite database, show definitions beside reviewed SQL aliases, and carry the original source meaning into saved analysis, complete query exports, reports and workbooks.

This is the customer continuation of [the CKAN semantic workflow](../../sf30-seller-sdk/ckan/SEMANTIC_WORKFLOW.md). The existing acquisition, dataset delivery, SQLite, query, report and workbook engines remain the operating path. The full maintained Python component supplies the new module; there is no new runtime dependency or database service.

## Receive the original complete delivery

A legacy delivery keeps its existing four public files:

- manifest.json
- dataset.jsonl
- dataset.csv
- review.html

When its original reviewed dataset has semantic definitions, it also carries semantics.json. The native manifest, output bytes, original status and semantic identity must agree. The Python loader accepts that optional fifth file only with the original semantic binding.

Use the original acquisition for an SF88 session:

```python
from stellar_forge_buyer.datasets import DatasetAcquisition

acquisition = DatasetAcquisition(
    checkout="/absolute/installed/stellar-forge",
    session="/absolute/private/original-session",
    node="/absolute/node",
)
delivery = acquisition.deliver("/absolute/private/original-data-room")
dictionary = delivery.read_semantics()
if dictionary is not None:
    for column in dictionary["columns"]:
        print(column["name"], column["projectedDefinition"])
```

For an already finalized direct SF100 delivery, use its original scan result. The scan must come from the original SF100 scan(directory, {retainPayload:false}) call. Retain its complete JSON unchanged.

```python
from pathlib import Path
from stellar_forge_buyer.datasets import DatasetDelivery
from stellar_forge_buyer.storage import parse, read

scan = parse(read(Path("/absolute/private/finalized-scan.json"),
                  16 * 1024 * 1024))
delivery = DatasetDelivery.from_finalized_scan(scan)
dictionary = delivery.read_semantics()
with delivery.file("semantics.json").open() as stream:
    exact_original_dictionary_bytes = stream.read()
```

This receiver uses the original manifest and all retained native page archives. It verifies the original page chain and typed JSONL rows, then binds the same semantic document on every page. A changed or missing dictionary cannot silently become a legacy delivery. A genuine legacy delivery returns None from read_semantics().

The original file reader verifies the full expected digest and size on its opened descriptor. It also preserves the private-file requirements. The semantic document is limited to 2 MiB, matching the original delivery reader.

## Import an immutable SQL edition

The same DatasetDatabase accepts the original SF88 delivery and a verified direct SF100 delivery. Supply the reviewed field-to-SQL mapping through its existing columns argument.

```python
from stellar_forge_buyer.sqlite_dataset import DatasetDatabase

database = DatasetDatabase("/absolute/private/customer-database")
edition = database.import_delivery(
    delivery,
    columns={"observation_id": "observation_key"},
)
version_id = edition["version_id"]
meaning = database.semantics(version_id)
current = database.current("observations")
selected = database.activate(
    "observations",
    version_id,
    expected_revision=current["revision"],
)
rows = database.query(
    'SELECT observation_key, COUNT(*) AS records '
    'FROM observations GROUP BY observation_key',
    max_rows=1000,
)
```

The original import transaction commits the typed rows, source manifest, SQL mapping and exact dictionary bytes together. It retains the dictionary in sf_dataset_semantics, keyed by the same immutable version ID. The existing schema version stays compatible; opening an older writable database adds this table. Existing editions without semantic definitions remain valid.

The same manifest and reviewed mapping produce the same version ID on reimport. Changing the source meaning changes the original delivery manifest and therefore its edition identity. A different SQL mapping creates a separately identified edition over the original retained input.

SQLite keeps the existing scalar rules: numeric strings remain text, original booleans are stored as integers with their observed JSON type retained, and timestamp strings keep their spelling and timezone representation. The source dictionary gives those values their reviewed meaning.

### Customer API

| API | Result |
| --- | --- |
| delivery.read_semantics() | Original checked semantic document, or None for legacy input. |
| delivery.file_names() | Original complete outputs, optional semantics.json, and any retained direct SF100 archives. |
| delivery.file("semantics.json") | Existing verified FileDelivery for the exact dictionary bytes. |
| database.version(version_id) | Existing edition metadata, plus semantics and checked semantic_dictionary when present. |
| database.semantics(version_id) | Checked source meaning, reviewed SQL mapping and original document; None for a legacy edition. |
| database.semantics_bytes(version_id) | Exact original dictionary bytes retained in the database; None for a legacy edition. |
| database.compare_semantics(before_id, after_id) | Definition, capture and SQL-mapping differences between two immutable editions. |
| database.backup(destination) | Existing consistent SQLite backup, including the retained dictionary table. |

The semantics result has this structure:

```python
{
    "schema": "stellar-forge.python-dataset-semantics.v1",
    "scope": "IMPORTED_SOURCE",
    "version_id": "...",
    "semantic_sha256": "...",
    "definition_sha256": "...",
    "capture_manifest_sha256": "...",
    "file": {"name": "semantics.json", "sha256": "...", "bytes": 24266},
    "columns": [
        {"source": "observation_id", "column": "observation_key"},
        # Every selected original field and its reviewed SQL alias.
    ],
    "primary_key": {
        "source": ["observation_id"],
        "columns": ["observation_key"],
        "complete": True,
        "enforced": False,
    },
    "document": {
        # Complete original stellar-forge.ckan-semantics.v1 document.
    },
}
```

The primary-key entry describes the reviewed source key and its selected SQL columns. The existing SQLite importer retains those definitions without adding a unique constraint. The original comparison workflow can use the selected keys and reports missing or duplicate identities through its existing row analysis.

Dictionary fields and URI templates keep their original published aliases. The explicit source-to-SQL mapping gives the corresponding database columns. SQL aliasing does not rewrite code-list or observation URI templates.

## Read meaning in the existing browser

Start the original customer analysis application on its configured private database:

```bash
PYTHONPATH=/absolute/checkout/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python \
python3 -B -m stellar_forge_buyer.analysis_workspace \
  --database /absolute/private/customer-database serve
```

Use its normal private launch URL. In Data, select an imported version. Its existing field table now shows the source definition beside each SQL column and stored JSON type. Source meaning displays the semantic, definition and capture identities, with the original dictionary file digest. The details include source attribution, primary key, observation URI, virtual definitions and review issues.

Download source dictionary returns the exact retained bytes. This uses the same application capability and local owner as the original manifest download.

When reviewing a candidate against a current view, the Changes panel shows whether the reviewed definitions, capture identity or SQL mapping changed. Download meaning comparison retains the full before/after dictionary and changed field mappings. The original row comparison and explicit view selection remain the comparison engine.

The same authenticated server exposes:

| HTTP read | Response |
| --- | --- |
| GET /api/semantics/VERSION_ID | Same database.semantics result. |
| GET /api/semantics-file/VERSION_ID | Exact dictionary JSON download. |
| GET /api/semantic-compare?before=VERSION_ID&after=VERSION_ID | Same database.compare_semantics result. |

These routes use the original X-Analysis-Capability and local-origin checks. The caller selects existing immutable version IDs. The server resolves retained bytes from its own database.

## Carry meaning into useful analysis outputs

The original source-version reader now attaches the verified dictionary to an edition when a query or report reads that edition's physical table. This connects the source definitions with the exact imported data and SQL mapping.

| Existing output | Retained meaning |
| --- | --- |
| Saved query result JSON | source_versions includes semantics and semantic_dictionary for each actual imported source. |
| Complete QueryExport | binding.sourceVersions includes the same checked context in the original manifest. |
| Published report JSON | report.sources contains the source definition and mapping, included in the existing result digest. |
| Printable report HTML | Data and methods shows reviewed definitions, SQL aliases, source identity and attribution. |
| Report CSV archive | Original report.json/report.html/section CSV files, plus sources/VERSION_ID-semantics.json with exact dictionary bytes. |
| Workbook handoff | Existing retained QueryExport/report source documents carry complete meaning into the workbook's original source package. |
| SQLite backup | Exact dictionary bytes and the immutable edition metadata remain readable with the stored rows. |

The source context identifies the meaning of input fields. Calculations, aggregation, joins and result aliases follow the saved SQL. A COUNT(*) result is a count; it does not inherit a price or energy unit merely because the query read a table containing those fields. For a direct projection, the saved expression and source-to-SQL mapping identify the corresponding definition.

Complete query exports continue to use their existing files, manifest schema, transfer reader and byte limits. Their original binding contains the source dictionary; adding it does not create another export format. Likewise, workbooks retain the original query/report source documents through their existing build and receiving path.

The report CSV archive has exact dictionary files because those original bytes are available from the stored edition. In report JSON and the query manifest, semantic_dictionary is a JSON value within the existing document. Its semantic identity and the separate original-file digest retain their distinct meanings.

## Understand the four identities

| Identity | What it identifies |
| --- | --- |
| semantic_sha256 | The original reviewed semantic payload, including its capture binding. |
| definition_sha256 | The reviewed meaning independent of the retained capture and raw schema-file digest. |
| capture_manifest_sha256 | The original retained source capture. |
| file.sha256 | Exact bytes of the original semantics.json file. |

The original SF100 engine verifies the semantic payload's canonical identities. The Python receiver verifies the exact dictionary file against the original output digests, manifest selection and native semantic identity. A direct scan also binds that same document to every retained original page. Python does not substitute its JSON serializer for the original semantic canonicalization.

The original published dictionary can describe more fields than a particular acquired query selected. Its manifest selectedFields identifies the actual delivered rows. The SQL mapping lists those imported fields. Source templates and keys stay available for review, and the primary-key mapping reports whether all required selected columns are present.

## Complete native receiving example

[examples/semantic_analysis.py](examples/semantic_analysis.py) operates a real existing semantic delivery from beginning to end. It creates the customer products in the existing application and returns a complete receiving directory.

```bash
PYTHONPATH=/absolute/checkout/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python \
python3 -B \
  /absolute/checkout/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/python/examples/semantic_analysis.py \
  --scan /absolute/private/finalized-scan.json \
  --database /absolute/private/semantic-analysis \
  --out /absolute/private/semantic-customer \
  --columns '{"observation_id":"observation_key"}'
```

Use --report instead of --scan for an existing original SF88 delivery report. Use --columns to supply the actual reviewed mapping for that delivery. The example's two saved queries retain all observations and count the same selected rows.

The complete operation:

1. Opens the original finalized delivery and verifies its dictionary and native page continuity.
2. Imports one immutable SQL edition, retains its reviewed aliases and selects the existing named-view mechanism.
3. Saves and runs the original SQL query, then exports every row through the existing JSONL, CSV and SQLite query exporter.
4. Publishes a two-section report, retaining source meaning in its JSON, readable definitions in HTML and exact dictionary bytes in the CSV archive.
5. Builds a two-sheet workbook through the original saved workbook API and copies its complete receiving package.
6. Uses the original authenticated HTTP application to read and download the dictionary and receive its actual UI assets.
7. Creates and reopens the original database backup, reading the same dictionary and retained row count.

The receiving directory contains semantics.json, the complete query-output directory, report.json/report.html/report.zip, the original workbook handoff, the database backup and receiving.json identifying the completed original products.

The example derives stable request IDs from the original source binding and its chosen customer database. Repeating the same original operation reuses the retained application requests. Existing receiving files are reused only when their bytes match. A changed source or mapping belongs to a reviewed new edition, using the existing application's normal revision rules.

The complete database backup preserves the SQL data and dictionary. Query and workbook handoffs preserve their own original receiving files. For continued operation of the whole application, use its existing Backups/WorkspaceArchives workflow to transfer the database together with retained query, report and workbook files.
