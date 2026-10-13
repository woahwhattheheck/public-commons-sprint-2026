# Supplier feed review: receiving and operation

This package turns a baseline supplier edition and an incoming edition into a reviewable comparison. Review decisions stay with the original source editions, mapping rules, and request ID. The command-line export produces a complete delivery folder for downstream ingestion.

## Package

| File | Purpose |
| --- | --- |
| supplier-report.mjs | Source editions, reconciliation, decisions, workspace persistence, and exports |
| supplier-report-cli.mjs | Compare, native source intake, inspect, decide, export, independent receiving, and local browser launch |
| review.html | Browser entry point for CSV, complete source JSON, native source archives, and saved workspaces |
| source-editions.mjs | Reopen complete source JSON while preserving original edition identities and digests |
| datasette-bridge.mjs | Apply the original approved native Datasette projection to supplier source rows |
| native-source-io.mjs | Original native archive receiving, complete delivery source retention, and local browser intake |
| native-runtime.json | Complete unchanged Datasette reader, capture, exact JSON, and file modules for independent receiving |
| NATIVE_EDITION_BRIDGE.md | Complete native source operation, exact values, archives, and workflow source bindings |
| review-ui.mjs | Change review and decision interface |
| review-ui.css | Review interface stylesheet |
| catalogue-coverage.mjs | Original pricing-to-catalogue source coverage |
| supplier_attachments.py | Native Analysis delivery attachments and original filenames |
| FIELD_GUIDE.md | Complete operator and receiving workflow |
| SOURCE_NOTES.md | Publisher identity, source semantics and included mapping |

Keep these files together. The package uses standard JavaScript modules and Node built-ins. There is no dependency installation or build step.

## Open the review screen

Use a current Node.js installation with native ES modules, then run the following from this directory:

    node supplier-report-cli.mjs serve

Open the address printed by the command, normally http://127.0.0.1:8765/. To choose another local port:

    node supplier-report-cli.mjs serve --port 8876

The server serves the complete review and workbook interfaces from this package. CSV, complete source JSON, and saved workspaces are read in the browser. Native archive input and XLSX conversion use this same loopback server and the installed original native/Python modules.

To start a new comparison:

1. Enter the request ID used by the supplier-feed job.
2. Choose each side's format and select its source file plus the mapping-rules JSON. Supported browser inputs are CSV, complete exported source JSON, and a complete native Datasette source archive.
3. Supply source IDs when the upstream system has them. CSV defaults to its file name; a native archive defaults to its original source-selection identity. Complete source JSON keeps its retained source ID and edition ID.
4. Supply known capture times in ISO format. A blank CSV time uses actual import time. A native source uses its retained capture time, and complete source JSON preserves its original time.
5. Create the comparison and resolve the changes in the review interface.
6. Save the workspace JSON to preserve the complete source editions and decision history.

“Open workspace” restores a saved comparison. “Save workspace” downloads the current revision, including the full source editions. The page prompts before replacing an unsaved comparison.

## Command-line comparison

    node supplier-report-cli.mjs compare \
      --baseline ./inputs/baseline.csv \
      --candidate ./inputs/candidate.csv \
      --rules ./inputs/rules.json \
      --request SUPPLIER-2026-10-12 \
      --baseline-source supplier-catalogue:previous \
      --candidate-source supplier-catalogue:incoming \
      --out ./work/supplier.workspace.json

Source IDs are optional on the command line. Their default is the absolute local file URI. The edition also records the file name, byte count, SHA-256 of the input bytes, file modified time, and import time.

When an upstream capture time is known, include it explicitly:

    --baseline-captured-at 2026-10-11T09:00:00Z
    --candidate-captured-at 2026-10-12T09:00:00Z

Inputs must be valid UTF-8. CSV text, including its original line endings and optional UTF-8 BOM, is retained as source text. Invalid UTF-8 is rejected so an import cannot silently substitute replacement characters. A BOM at the start of a JSON file is accepted.

Both interfaces use the same rules JSON and domain module. A side mapping may select a source field by its string name, provide a constant using {"constant":"EUR"}, or provide explicit null. Use the receiving project's agreed rule set so the same canonical fields and identifiers are compared on both sides.


## Native source files and saved editions

Choose each side's format independently. The default is csv.

| Format | Input | Identity used |
| --- | --- | --- |
| csv | Complete original UTF-8 CSV | Request ID plus side, caller source ID, retained local file provenance |
| source-json | Complete baseline-source.json or candidate-source.json from an earlier export | Original source and edition IDs, capture time, rows, metadata and digests |
| native-edition | Original reviewed edition.json beside its full capture/review members | Original native edition/capture/review identities and approved projection |
| native-archive | Complete original .datasette.json.gz source package | The same native identities after the original receiver restores all members |

For example, compare an earlier exported source with an incoming native source archive:

    node supplier-report-cli.mjs compare \
      --baseline ./received/baseline-source.json --baseline-format source-json \
      --candidate ./incoming/source.datasette.json.gz --candidate-format native-archive \
      --rules ./inputs/rules.json --request ORIGINAL_REQUEST_ID \
      --out ./work/native.workspace.json

Use the actual retained request ID and selected original source files. Supply --candidate-native-sha256 and --candidate-archive-sha256 when those hashes are already recorded by the native operation. Both are verified against the original bytes. Source JSON retains its own identity and accepts no source-ID, capture-time or native-hash replacement.

A native projection preserves exact string values and explicit null. The default --numeric-format source keeps the original numeric spelling. Select --numeric-format plain-decimal when the agreed decimal rules require an exponent such as 1.25e2 to become the exact string 125. The original numeric token and every conversion remain in the source metadata. Text identifiers keep their original spelling in both modes.

To prepare one complete source independently:

    node supplier-report-cli.mjs native-source \
      --input ./original/edition.json --format native-edition \
      --out ./work/candidate-source.json

The command prints the exact retained archive path and hash. Preserve that archive with the new source JSON. The complete export command finds adjacent side archives, their recorded local paths, or explicit --baseline-native-archive / --candidate-native-archive paths. NATIVE_EDITION_BRIDGE.md gives the full native operation and adapter contract.

## Included publisher edition

The installed source package includes the retained source at sources/published-pricing.csv and its mapping at examples/published-pricing.rules.json. Open that edition as an unchanged starting comparison:

    node supplier-report-cli.mjs compare \
      --baseline ./sources/published-pricing.csv \
      --candidate ./sources/published-pricing.csv \
      --rules ./examples/published-pricing.rules.json \
      --request published-pricing-intake \
      --out ./work/published-pricing.workspace.json

This command compares the same publisher edition on both sides. When a new supplier edition arrives, use that file as the candidate and keep the earlier file as baseline.

The complete initial-intake example at examples/published-pricing-intake.workspace.json retains an empty target and all 23 original incoming price rows. Its 23 recorded intake decisions preserve every original price, the 17 unpublished charity rates as null, the five explicit free zero amounts, GBP, billing period, displayed wording, source URLs and capture dates. Open that JSON to inspect the completed review and its source lineage. The mapping explicitly distinguishes the publisher's starting-price wording from its other displayed prices; a new unrecognized display value requires an explicit rule choice. SOURCE_NOTES.md describes that mapping.

A delivered comparison keeps its own original baseline-source.csv or baseline-source.json, candidate-source.csv or candidate-source.json, rules.json and workspace.json beside the editor. Open workspace.json to continue that delivery. The sources/ and examples/ directories above belong to the full installed source package; the delivered workspace already carries the complete sources for its own comparison.

A minimal rules file has this shape:

    {
      "keyFields": ["sku"],
      "fields": [
        {
          "name": "sku", "type": "text",
          "baseline": "item_code", "candidate": "sku", "required": true
        },
        {
          "name": "price", "type": "decimal",
          "baseline": "price", "candidate": "unit_price", "required": true,
          "min": "0", "contextFields": ["currency", "unit"]
        },
        {
          "name": "currency", "type": "text",
          "baseline": "currency", "candidate": "currency", "required": true
        },
        {
          "name": "unit", "type": "text",
          "baseline": "unit", "candidate": "unit", "required": true
        }
      ]
    }

Mapping strings select exact source columns. Constants use an object such as {"constant":"GBP"}. Decimal tolerance, minimum, and maximum settings are strings; date values use YYYY-MM-DD. Canonical field names in contextFields refer to other fields in the same mapping. The included published-pricing rules map the retained publisher columns and their GBP currency context.

## Inspect and decide

Inspect the current revision before preparing an offline decision batch:

    node supplier-report-cli.mjs inspect \
      --workspace ./work/supplier.workspace.json

The result includes the request ID, comparison ID, status, revision, review summary, and both source-edition identities.

The decisions file is a JSON array. Each entry names an item from the comparison:

    [
      {
        "itemId": "EXACT_ITEM_ID_FROM_THE_COMPARISON",
        "action": "use_candidate",
        "reason": "The incoming supplier edition has the agreed value."
      }
    ]

Supported decision actions are:

| Action | Additional input | Effect |
| --- | --- | --- |
| use_candidate | reason | Retain the candidate value for the item |
| keep_baseline | reason | Retain the baseline value for the item |
| exclude | reason | Exclude the item from the finalized output |
| replace | reason, values | Supply an explicit replacement containing all canonical fields |
| choose_source | reason, side, rowNumber | Select the exact source row for an ambiguous item |

Use the exact item IDs, source side, row number, and canonical fields shown by the comparison. The domain module checks their validity.

Apply the complete batch with the revision you inspected:

    node supplier-report-cli.mjs decide \
      --workspace ./work/supplier.workspace.json \
      --decisions ./work/decisions.json \
      --reviewer "Supplier operations" \
      --expected-revision 0 \
      --out ./work/supplier.reviewed.json \
      --finalize

The expected revision must match the loaded workspace. A batch uses one domain operation and retains an individual decision-history event and revision increment for each decision. The original workspace stays available when the output path is different.

The optional --finalize flag requires a complete, conflict-free result before the output workspace is written. Omit it when saving an intermediate review. An empty decision array is permitted only with --finalize, to require that an existing review can be finalized.

Ordinary output writes refuse an existing file. If replacing a regular output file is intentional, add --force. Writing back to the input workspace also checks that its contents have not changed since loading. Files are written through a temporary sibling and committed atomically.

## Export the complete delivery

    node supplier-report-cli.mjs export \
      --workspace ./work/supplier.reviewed.json \
      --out-dir ./deliveries/SUPPLIER-2026-10-12 \
      --table-name supplier_feed_accepted

Choose a new output directory. An existing directory is refused. All export content is generated before the directory is created; each output file is written atomically. Completion is marked by manifest.json, which is written last.

The export also retains the full installed editor: `review.html`, `review-ui.mjs`, `review-ui.css`, `supplier-report.mjs` and the same `supplier-report-cli.mjs`. The operator and source guides, catalogue coverage module and guide, and native attachment helper and guide travel beside them. Every one of these original source files is declared in the same manifest. All selected source is read before output begins, so a missing component cannot produce a completed delivery.

Every completed export contains:

| File | Content |
| --- | --- |
| workspace.json | Reopenable, checksummed workspace with both source editions, rules, and decision history |
| report.json | Complete in-memory report representation |
| rules.json | The exact rules used by the comparison |
| baseline-source.csv | Retained baseline CSV text, when the edition came from CSV |
| candidate-source.csv | Retained incoming CSV text, when the edition came from CSV |
| changes.csv | Review change table |
| report.html | Standalone human-readable report |
| manifest.json | Request, comparison, revision, status, and byte hashes for all preceding files |

An edition created from structured data uses baseline-source.json or candidate-source.json instead of CSV. The JSON retains the complete source edition: schema version, original edition and source IDs, capture time, column order, every original row, metadata, source digest and edition digest. Select source-json to reopen it directly.

Each native side additionally exports baseline-native-source.datasette.json.gz or candidate-native-source.datasette.json.gz. These are the complete original source packages. Their exact byte hashes, edition hashes and capture hashes are recorded in manifest.nativeSources. The original native runtime capsule and its IO/bridge modules travel beside the editor, so the received delivery can reopen its source archives independently.

A reviewed workspace additionally exports:

| File | Content |
| --- | --- |
| accepted.csv | Finalized accepted rows |
| accepted.sql | SQL text for the selected destination table |
| lineage.json | Finalized rows, provenance, source-edition IDs, revision, and result digest |

Finalized outputs are generated together. If finalization detects unresolved review or output conflicts, the requested finalized export fails before any destination files are written. A review still in progress produces its source and review artifacts; its manifest status remains review_required.

The CLI writes SQL as an artifact. The receiving system chooses how to ingest the reviewed data.


## Receive and reopen a complete delivery

Use the CLI supplied with the original delivery to receive every original member into a new directory:

    node ./downloaded/supplier-report-cli.mjs receive \
      --delivery ./downloaded --out-dir ./received/supplier

Receiving verifies the complete manifest, every original file byte hash, the workspace's source/rule/decision replay, original request/comparison/revision, both complete source editions, and the reviewed accepted rows and lineage. For each native side it invokes the original archive receiver and reproduces the approved projection from the complete original source pages. The same manifest and source files are then copied unchanged into the new directory.

Continue the same comparison:

    node ./received/supplier/supplier-report-cli.mjs inspect \
      --workspace ./received/supplier/workspace.json

    node ./received/supplier/supplier-report-cli.mjs serve --port 8765

Choose **Open workspace** and select the received workspace.json. **Save baseline source** and **Save candidate source** retain their complete original representations. The archive buttons download the complete native source packages. Keep the workspace and the side archives together when moving an updated review.

A directory produced by the outer native workflow may use Supplier_Report_ attachment names. Its retained supplier file mapping associates those attachment names with the original filenames. Restore that mapping into one supplier directory, including manifest.json, before running receive. NATIVE_ATTACHMENTS.md describes the same existing attachment convention.

## Attach the export to an existing workflow delivery

The export manifest format is:

    {
      "format": "conapi-supplier-delivery",
      "version": 1,
      "requestId": "SUPPLIER-2026-10-12",
      "comparisonId": "...",
      "revision": 3,
      "status": "reviewed",
      "exportedAt": "2026-10-12T16:00:00.000Z",
      "files": [
        {
          "filename": "workspace.json",
          "bytes": 12345,
          "sha256": "64 lowercase hexadecimal characters"
        }
      ]
    }

The values above illustrate the schema; the CLI records the actual IDs, time, counts, and SHA-256 values. Manifest entries use simple file names relative to the export directory and exclude manifest.json itself.

The receiver should read the completed manifest and verify each named file's actual bytes before attaching it to the original workflow result. Keep the existing workflow archive, native IDs, and artifact identities. Add the supplier files as sibling artifacts so a recipient can follow accepted output back to its original editions and decisions.

### Reopen the delivered editor

Start the supplied CLI directly in the received directory:

```sh
node /absolute/received/delivery/supplier/supplier-report-cli.mjs serve --port 8765
```

Use the localhost address printed by that command, choose **Open workspace**, and load the adjacent `workspace.json`. Keep that file with the manifest and the original baseline/candidate sources. The browser loads the original ES modules through this local server; a `file://` page cannot reliably load them. The server exposes the component assets and its local workbook/native-source operations. CSV, complete source JSON, and workspace inputs stay in the browser; native archive and XLSX processing use this same local host. Choose another available port when running multiple editors.

Save the updated workspace under a new filename, then use the supplied `decide`, `inspect` or `export` commands for the next review and complete handover. The received directory carries every source asset and guide needed for the next export.

A saved workspace can be reopened in either the browser or CLI. JSON-transport values, source identifiers, and explicit nulls remain in their original representation when entering through the native bridge.

## Useful failure messages

| Error | Resolution |
| --- | --- |
| INVALID_UTF8 | Convert the original input to valid UTF-8 and import that file |
| INVALID_JSON | Correct the named JSON file at the reported parse location |
| SOURCE_JSON_CHANGED | Select the complete original source JSON with its matching source and edition digests |
| NATIVE_ARCHIVE_REQUIRED | Keep the original archive beside the workspace or pass its actual file with the side's native-archive option |
| NATIVE_SOURCE_CHANGED | Select the archive for the original retained native edition and approved projection |
| DELIVERY_MEMBER_CHANGED | Restore the named file from the same completed original delivery |
| REVISION_CONFLICT | Inspect the current workspace and prepare decisions against that revision |
| WORKSPACE_CHANGED | Reload the updated workspace before replacing it |
| OUTPUT_EXISTS | Choose a new output file or export directory; --force is available for regular workspace files |
| REVIEW_PENDING | Complete the remaining review decisions |
| OUTPUT_CONFLICT | Resolve the conflicting final output rows or identifiers before exporting |

A nonzero CLI exit code means the operation failed. For a filesystem interruption during export, the new directory may contain partial files; a valid manifest written after the other artifacts marks a completed export.
