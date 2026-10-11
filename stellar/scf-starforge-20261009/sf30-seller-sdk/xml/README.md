# XML source editions → original Stellar Forge datasets

A complete local onboarding workspace for supplier inventories, research feeds,
public records and other operator-owned XML. It retains exact source bytes,
inspects the whole document, saves explicit namespace-aware mappings, projects
all selected records, and loads the **original SF30 CSV dataset engine**. Review
and query typed rows, compare complete keyed editions, export an original native
dataset, or send a portable project that another operator can reconstruct.

The browser and CLI use the same retained workspace. They do not introduce a
second query engine, seller, payment implementation, scheduler or hosted service.

## Start the installed product

Requirements: Node 22+, Python 3.11+ built with Expat 2.6+. No pip/npm dependency
installation is needed by this XML application. `python3 -c "import pyexpat; print(pyexpat.EXPAT_VERSION)"`
reports the parser version. Set `SF30_XML_PYTHON` to a Python executable when
needed; the Node dispatcher passes its own executable to the native engine.

The existing maintained `dataset` command exposes the whole XML workspace:

```sh
starforge dataset xml --workspace /private/inventory-workspace init
starforge dataset xml --workspace /private/inventory-workspace serve --port 0
```

From the original SF30 source directory, the identical commands are:

```sh
node dataset-cli.mjs xml --workspace /private/inventory-workspace init
node dataset-cli.mjs xml --workspace /private/inventory-workspace serve --port 0
```

Open the process's printed private console URL on that computer. It contains a
per-process capability in the fragment. Closing and reopening the server prints
a new capability; all retained source, mappings, builds and comparisons remain.
One process owns a workspace at a time. Use the open console, or close it before
operating the same workspace from another CLI process.

In **Source**, choose a file and retain it, then inspect the complete path and
attribute inventory. Select the exact repeating record. In **Mapping**, either
suggest string columns and review them, add explicit columns, or apply the JSON
mapping. Save and build the complete edition. **Native query** runs the original
filter/range/sort/pagination API. **Compare** joins two complete builds by their
explicit unique keys and retains every added, removed and changed record.

The UI uses neutral desktop/mobile layouts. Wide tables scroll rather than
squeezing their values into unreadable columns; mobile source controls collapse
while operating a result. Source values render as text, never HTML.

## A complete command-line journey

The included `examples/inventory.xml` and `examples/mapping.json` are fictional
product examples with a large exact identifier, exact decimal text, nullable
integer, repeated tags and mixed text.

```sh
node dataset-cli.mjs xml --workspace /private/inventory-workspace \
  source --file xml/examples/inventory.xml --label 'Inventory edition 1'
node dataset-cli.mjs xml --workspace /private/inventory-workspace \
  plan --file xml/examples/mapping.json
node dataset-cli.mjs xml --workspace /private/inventory-workspace list
```

Use the complete source and mapping IDs printed by those commands:

```sh
node dataset-cli.mjs xml --workspace /private/inventory-workspace \
  build --source SOURCE_ID --plan PLAN_ID
node dataset-cli.mjs xml --workspace /private/inventory-workspace \
  query --build BUILD_ID --params '{"gte_units":"5","sort":"-units","limit":"25"}'
node dataset-cli.mjs xml --workspace /private/inventory-workspace \
  dataset --build BUILD_ID --out /private/native-inventory
```

The create-only dataset directory contains `data.csv`, `dataset.json`, and
`xml-lineage.json`. **It excludes the original XML**. Its native configuration
works directly with the original dataset query workspace, seller configuration
compiler and version publisher:

```sh
node dataset-cli.mjs --dataset /private/native-inventory/dataset.json
node dataset-workspace.mjs --dataset /private/native-inventory/dataset.json
node dataset-cli.mjs --dataset /private/native-inventory/dataset.json \
  --payment /private/your-public-terms.json --origin https://your-api.example \
  --path /inventory --out /private/inventory-seller.json
```

The public terms and merchant runtime remain the original workflow documented in
[DATASET_API.md](../DATASET_API.md). Start the original seller with its original
`examples/dataset-application.mjs` handlers and `SF30_DATASET_CONFIG` pointing at
that exported native configuration. Use the operator's existing facilitator for
paid operation. The XML application never chooses a facilitator, signs a payment
or decides public pricing.

Import a subsequent XML source and build it with the **same saved mapping ID**.
Then compare all records, rather than only the currently displayed query page:

```sh
node dataset-cli.mjs xml --workspace /private/inventory-workspace \
  compare --before FIRST_BUILD_ID --after SECOND_BUILD_ID
node dataset-cli.mjs xml --workspace /private/inventory-workspace \
  changes --comparison COMPARISON_ID --offset 0 --limit 50
```

The browser's complete changes download is `changes.jsonl`; the retained file is
also available under `comparisons/COMPARISON_ID/changes.jsonl`. Each record carries
kind, key, before/after source ordinals, before/after projected cells and changed
column names. Row reordering alone is unchanged. Comparisons use exact projected
CSV cells, not locale collation, numeric tolerance or schema-diff heuristics.

## Mapping semantics

Selectors are **arrays of exact expanded XML names**, not XPath. A default
namespace is significant. For `<i:item xmlns:i="urn:inventory">`, use
`"{urn:inventory}item"`; changing the prefix does not change selection. A namespace
URI containing slashes stays one array element. Unprefixed attributes normally
have no namespace. `recordPath` is absolute from the root; each column's `path`
is relative to the selected record, with `[]` selecting that record itself.

A column names a native output identifier, selector, type and optional attribute.
`single` rejects repeated matches; `first` and `last` deliberately choose one;
`join` requires an explicit separator; `json` preserves matches as a JSON array
in a string column. Missing values require `error`, `empty`, or an explicit
string `default`. Trimming is opt-in. `leaf` rejects nested element content,
`direct` retains direct text only, and `descendant` retains all descendant text
in document order. This is extraction, not XML Schema validation.

`nil: "xsi"` interprets `xsi:nil="true"` or `"1"` as null, rejecting content on a
nil element and requiring nullable scalar output. JSON-array mode preserves a
nil member as JSON null. Join mode rejects nil members rather than losing them.
`nil: "literal"` leaves XML attributes uninterpreted. `allowEmpty: true` explicitly
permits a zero-record edition; otherwise a selector matching nothing is an error.

Native types are `string`, safe `integer`, finite IEEE-754 `number`, and literal
`true`/`false` `boolean`. Empty CSV cells map to null only for nullable columns.
Consequently native nullable strings do not distinguish empty string from null.
Keep exact decimal money, large identifiers and leading-zero codes as strings.
The example retains `9007199254740993` and `1234.5000000000000000001` exactly.

`filters`, `ranges` and `sorts` opt into original native query capabilities. `keys`
is the set of up to eight unique, nonempty, nonnullable string/integer/boolean
columns identifying an edition record. Capability/key sets are canonicalized;
output column order is preserved. Duplicate keys fail the build instead of
silently selecting a record. Floating-point numbers cannot be edition keys.

## Retention and portable reconstruction

Sources are SHA-256 identities of the exact input bytes. Mapping IDs identify the
normalized explicit choices. Build IDs bind source and mapping; the original
SF30 engine supplies the native snapshot. Completed builds retain CSV, native
configuration, a local SQLite comparison index and the review including the
actual original engine Git blob. Earlier editions and mappings are never edited.

```sh
node dataset-cli.mjs xml --workspace /private/inventory-workspace \
  export --build BUILD_ID --out /private/inventory-project.zip
node dataset-cli.mjs xml --workspace /private/receiving-workspace init
node dataset-cli.mjs xml --workspace /private/receiving-workspace \
  import --file /private/inventory-project.zip
```

**A portable project includes the original XML**, which may contain fields omitted
from the dataset. Review its intended recipient accordingly. It contains exactly
six root files: manifest, original XML, mapping, CSV, native configuration and
review. The receiving workspace verifies member names, lengths and digests,
reconstructs the projection through the original native engine, and matches the
CSV, configuration and snapshot before admitting the completed build. It does
not trust or extract an arbitrary ZIP path. A project transfers one complete
edition and mapping; import both projects to compare editions on another host.

The workspace directory is private (0700; files 0600 on POSIX) and protected by an
OS writer lease. Builds and exports are create-only. A crash between immutable
file publication and database commit can reuse matching bytes; a conflicting
unfinished record remains for inspection rather than being overwritten. Complete
your operation, close the workspace, then copy the whole directory for a backup.
Project export is the portable receiving route and avoids copying SQLite state.

## Runtime boundaries

XML is streamed through Expat. Only one selected record tree is held during
projection; the complete source is not built as an XML DOM. Maximum source size
is 256 MiB, selected record working text is 16 MiB/100,000 nodes, depth is 128,
shape inventory is 4,096 paths/8 MiB of metadata. Native defaults are 250,000 rows,
64 MiB CSV, 65,536 UTF-16 code units per cell, and 250 rows per page. Explicit
native ceilings allow one million rows and 256 MiB CSV. The original engine
still uses an in-memory immutable dataset and indexes; adequate memory is needed.
One reused Node engine retains only the selected dataset, not every edition.

DTD and entity declarations are rejected. There is no network entity loader,
XInclude expansion, XPath evaluator, XSLT executor or remote-file fetch. The
runtime requires Expat 2.6+ for large-token protections; see the official
[Python XML security documentation](https://docs.python.org/3/library/xml.html)
and [Expat callback documentation](https://docs.python.org/3/library/pyexpat.html).
Normal XML declaration, entity-reference and line-ending normalization follows
the XML parser; original bytes remain separate and unchanged.

The console binds only 127.0.0.1 and enforces its exact Host, Origin and bearer
capability. It accepts source bytes, never an arbitrary host path, over HTTP.
No-store responses and a restrictive content policy protect the local browser
interface. It is a single-operator local application, not a public multi-tenant
server or a boundary against a hostile OS user. Do not reverse-proxy it publicly.

## Run the complete native journey

```sh
python3 xml/acceptance.py --out /private/new-xml-journey --rows 100000
```

This one journey covers exact typed values, mixed/repeated/null content, original
pagination and stale-cursor behavior, keyed additions/removals/changes, an explicit
empty edition, portable reconstruction, a fresh-process recipient, and a real
local original SF30 HTTP 402/docs/OpenAPI handoff with fictional public terms.
The optional generated full-volume arm projects two complete editions, compares
them, exports one, and reconstructs it independently. It uses the real XML/CSV
engines throughout. Its results remain in the requested private output directory;
it does not invoke GitHub Actions or contact an external provider.
