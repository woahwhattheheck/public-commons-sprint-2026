# Receive a complete Upper Savannah application

The source assembler combines a retained application and selected component packages into one directory, one complete source map and one portable ZIP. It runs on Linux with Python 3.10 or later and uses the standard library. Use the same scientific workspace and its existing source, scenario and run identifiers after receiving the application.

## Selected complete edition and original source closure

The maintained assembler uses the complete `integration/application_components.json`
supplied by the selected application or an explicit guarded overlay. Its
`required_components` and transitive `requires` determine that edition. The
current full application's declared component selection stays strict.

An older complete source bank can predate component catalogues. The receiver keeps
that bank's original edition, source reference and selected overlay payloads, then
retains a catalogue whose single `retained-source` component contains those actual
source members. The same Python import, operator declaration and web-resource
closure inspection runs against that original selection. Later components in the
receiving tool's own catalogue are not silently added to the requested edition.
Original external scientific inputs retain their separate source declarations.

The receiver includes its assembly module and `source_tools/application_components.py`
helper when absent. Transport both source modules beside the selected catalogue;
the helper uses only the Python standard library. An explicitly supplied catalogue
is never replaced by an inferred selection, and the generated original selection
travels with subsequent snapshots and receiving.

A component may declare `source_manifests` alongside its source `paths`. Each
selected manifest uses the native `upstate.sources/v1` format. Closure follows
every entry's primary `path` and each `companions[].path`, retains the native
manifest-parent boundary, and checks any declared original SHA256 and byte count.
The same checks apply to JSON/base64 source maps, embedded original input banks,
installed directories and repeated receiving. A manifest self-companion is retained
once as a file and remains a reference of each source entry that declares it.

Use the original complete edition source, its complete component overlays and their
declared predecessor hashes in the normal receiving command. Before publication,
inspect the same composition to obtain exact missing source identities:

```sh
python3 -B source_tools/application_assembly.py /owned/current-application \
  --overlay /owned/current-component-source.json \
  --edition upper-savannah-complete \
  --inspect
```

The component inventory report includes `source_manifests`, original source IDs and
all source-primary/source-companion dependency edges. Missing files, invalid native
paths and changed original bodies prevent complete-edition publication. Scientific
inputs supplied as external datasets remain explicit external references unless the
selected component declares their native manifest as part of this application.

For an intentional partial edition, publish a catalogue with its own edition name
and the desired `required_components`, retaining the available component definitions
and dependency declarations. Compose that catalogue as an ordinary guarded source
overlay. Its explicit selection travels with the resulting source; an older
selection is never inferred from a later catalogue. Read-only `--inspect` remains
available while a source family is being completed.

## Receive source and components

Save the complete source carriers to ordinary files, retaining every numbered block. Read the application source first and apply the chosen overlays in source order:

```sh
python3 -B source_tools/application_assembly.py recovered-application.md \
  --overlay communities.md \
  --overlay conservation.md \
  --edition upper-savannah-complete \
  --output /owned/upper-savannah-complete \
  --source-map /owned/upper-savannah-complete.json.gz \
  --zip /owned/upper-savannah-complete.zip
```

The first input can be the original complete application map, a recovered `upstate.source-map/v1` containing the model workspace and operator server, or the actual installed application directory. The command prints the resulting paths, source inventory, selected replacements and local import findings. Each optional `--expect INDEX:SHA256` pins the decoded payload; input zero is the base and subsequent indices are overlays.

Original gzip source parts, bare Base64/gzip carriers, declared plain Base64 parts, conservation source/addon parts, source-bank cohorts and complete source documents are accepted. Source documents must declare a schema and supply complete file bodies with their byte lengths and SHA-256. A new document schema can use those existing complete-body structures. Numbered transports retain their own explicit envelope rules.

Original binary companions supplied in `binary_files[]` enter the same validated file inventory as regular source members. Each path has one complete original body.

Paths prefixed by the document's declared application prefix are normalized to the same application root as relative paths. A second entry that resolves to an existing member remains a duplicate error. Every supplied Git blob identity is checked, including `git_blob`, `git_blob_sha` and `git_sha`. Each changed existing member must identify the actual file it updates with `before_sha256`, `base_sha256`, `replaces_sha256`, nested `before.sha256`, or object `base.sha256`. Declared aliases must agree. A string `base` is retained as its source-ref label. Added members and identical postimages compose directly; an already installed postimage remains idempotent even when its declaration names the earlier predecessor. Source-bank fragments preserve the original before/base declarations in the assembled change inventory. Completed snapshot member metadata remains suitable for reopening as the next base.


## Join a changed module into current source

A full carrier records the source it captured. A later-arriving carrier may still contain an older application module. When two selected layers contain different bodies at the same path, the assembler reports the current, incoming and declared predecessor SHA-256 values. Join the intended change into the actual current source, then publish the complete resulting body with the hash of the source used for that join. Keep a complete current snapshot as the first layer when adding selected components.

The actual PR2714 component `F0C8Q6C81U2` contains 23 files and an older `operator/web/app.mjs` with SHA-256 `96ccc710c6cfe4c223153ccc9c4e394c12ffc4d1d0b6069e43899a179aa0806a`. Its retained revision already declares `base_sha256 = 75d0670f5b1d00e1871f033d55b9ca5834bdc051f37f0b025f8fbc67483ae204`; the original composer correctly rejects that declaration against a different current host. Keep this component's predecessor metadata intact. In the source replay, the [pinned resolved host](https://raw.githubusercontent.com/woahwhattheheck/public-commons-sprint-2026/f5e5d676357031429fbec3a7adc65b3589a6308b/opportunities/upstate_forever_2026/operator/web/app.mjs) retains the corrected stage detection, multi-element selectors and water-designation source lineage. For an installed complete application whose host is the stated stale body, save the pinned resolved file and produce its explicit source join:

```sh
python3 -B - /retained/current-app.mjs /owned/resolved-host.json <<'PY'
import hashlib, json, sys
from pathlib import Path

body = Path(sys.argv[1]).read_bytes()
expected = "f64d7b3ab7fd42d99bdc8a4b5c8e609a634e84246b6c36dd1443e5f479c5282e"
if len(body) != 113843 or hashlib.sha256(body).hexdigest() != expected:
    raise ValueError("Choose the complete resolved host from the linked immutable source")
document = {
    "schema": "commons.source-bank/v1",
    "source_ref": "f5e5d676357031429fbec3a7adc65b3589a6308b",
    "files": [{
        "path": "operator/web/app.mjs",
        "bytes": len(body), "sha256": expected,
        "base": "11342de9d7b59d379c7cbe45244b896854b2e1a0",
        "before_sha256": "96ccc710c6cfe4c223153ccc9c4e394c12ffc4d1d0b6069e43899a179aa0806a",
        "content": body.decode("utf-8"),
    }],
}
with Path(sys.argv[2]).open("x", encoding="utf-8") as stream:
    json.dump(document, stream, ensure_ascii=False)
    stream.write("\n")
PY
python3 -B source_tools/application_assembly.py /owned/current-application \
  --overlay /owned/resolved-host.json --edition resolved-current-host \
  --source-map /owned/resolved-current-host.json
```

The component itself is an overlay, so use the complete installed application as the first input. This selected module join preserves every other member from that complete base. Receive other maintained components and their installers through the normal application workflow. Reusing the resolved host overlay against its installed postimage succeeds as an identical replay. A different newer host receives the intended source changes against its own actual beforeimage. The separately exercised `before.sha256` interface case preserves the original predecessor value while changing only its declared spelling; it is distinct from replaying the unmodified component.

## Binary companions and installed snapshots

Base64 file records carry either text or original binary bytes. The received directory and ZIP contain those original bytes. A binary companion is represented in the assembled source map as a Base64 string with `file_metadata[path].encoding = "base64"`; ordinary source keeps `"utf-8"`. The byte count, SHA-256 and Git identity always describe the original file.

Use this assembler to reopen maps containing binary members. All-text maps also remain readable by the earlier application receiver. The accompanying JavaScript carrier codec understands the same member encodings.

When the base is an installed application directory, the snapshot captures current root files and the `model`, `operator`, `source_tools`, `source`, `ecsa_runs`, `integration`, `integrations`, `tools`, `receiving` and `eco_intelligence` directories. Existing installer joins are preserved. The snapshot also reads the installed `model/portable.py` declaration of `APPLICATION_DIRECTORIES` as data and includes its current component roots, including literal declarations and ordered installer extensions. This keeps the application source archive aligned with the installed portable inventory as components are added. Declared nested component directories retain their relative paths, with the same alias checks on every parent directory. Observations are included among the standard roots. The application module is never imported or executed to discover these directories; generated caches and runtime environments remain excluded. Small binary assets of up to 8 MiB each are included directly; larger native inputs keep their full size, hash and retained local path in the existing external-source declarations. Application source is capped at 256 MiB. Keep the complete scientific workspace, its original inputs and model outputs on the established workspace backup/restore route.

The selected catalogue's explicit `paths` and `source_manifests` also enter the
snapshot wherever they live inside the application. This preserves selected
scientific reports under `outputs/`, including the original watershed-connectivity
report, complete CSV and manifests. Each selected native manifest brings its exact
primary and companion files into the same source inventory. Explicitly selected
binary members retain their complete bodies beyond the ordinary 8 MiB asset
threshold, within the 256 MiB assembly limit. File and parent-directory aliases
remain rejected, and repeated snapshotting compares the full selected inventory
before publishing. Missing selected files remain named in the component report.

```sh
python3 -B source_tools/application_assembly.py /owned/current-application \
  --edition upper-savannah-installed \
  --output /owned/upper-savannah-installed \
  --source-map /owned/upper-savannah-installed.json.gz \
  --zip /owned/upper-savannah-installed.zip
```

Receiving always targets a new directory. An identical invocation verifies and reuses its existing result. Changed files and other editions produce a concrete conflict and remain in place. File publication and final directory creation use the existing atomic Linux receiver, including its concurrent-writer protection.

## Continue the original study

Keep the scientific workspace outside the application directory:

```sh
cd /owned/upper-savannah-complete
python3 -B operator/server.py --workspace /owned/current-study
```

Open the loopback URL printed by the original operator. Continue the retained source imports, parameter profiles, grids, scenarios, native runs, comparisons, maps and export workflow. Use the application's installed runtime view to select the existing GIS and InVEST environment.

For component integration, the unchanged APIs are `read_layer`, `layer_from_document`, `compose`, `source_receipt`, `receive_directory`, `write_archive`, `local_dependencies` and `snapshot_application`. `compose(..., include_receiver=False)` is available for consumers that explicitly supply their receiver source. The CLI includes the receiver when it is absent from the selected layers.

The source package retains source identity and composition. Native model execution and scientific workspace transfer remain operations of the existing application.

## Receive saved connector results and complete text exports

The same entrypoint accepts complete Markdown or the saved JSON result of its source connector. It reads the documented `structuredContent`, `markdown_content`, `text_content`, `section_id_mapping` and text blocks in `content`. JSON and gzip wrappers are decoded recursively. The original outer carrier name, byte count and SHA-256 remain in the layer record, while a source JSON string retains its original serialization for payload pins. Explicit provider errors are reported before source selection.

Complete text exports marked `SOURCE_TRANSPORT_METADATA` and `BEGIN_UPSTATE_SOURCE_GZIP_BASE64` are selected before companion bootstrap JSON. Their complete gzip and JSON identities are checked. For numbered text exports, concatenate the original text parts into one input file; every part must have its original length and hash and appear exactly once. Their declared numbering determines reconstruction order. Ordinary numbered JSON and conservation carriers retain their existing formats.

After applying a component, run its maintained installer against the receiving application according to its own guide, then snapshot that installed application. This preserves its actual server, workspace and browser joins in the next application archive.

## Transfer complete source through native documents

The existing JavaScript codec prepares and reads complete native source documents accepted by the maintained `source_tools/application_assembly.py`. The original exported documents also retain their historical `source_tools/receive_drive_source.py` bootstrap. It runs without Node, filesystem, browser or network APIs. `decodeNativeSourceDocuments(texts)` accepts a complete original document or an array of exported parts. It validates part membership and order, each whitespace-free Base64 fragment, the complete gzip and JSON, every UTF-8 source body and every original binary companion. Google Docs UTF-8 BOM, CRLF and paragraph whitespace remain compatible with the native receiver.

`encodeNativeSourceDocuments(source, options)` accepts those retained document strings, a decoded `upstate.complete-application-transport/v1` bank, or a complete `commons.source-map/1` with kind `upstate.complete-application-source/v1`. When its input is an existing transport, it reuses the exact original compressed payload and JSON bytes. A decoded bank or source map creates a newly declared transport with its own complete payload hashes; source-map provenance and every original member identity remain retained. Base64 members from a complete source map become the native receiver's `binary_files` records. Installed application snapshots declare `edition` and `source_ref`; if the map has no `operation_id`, conversion uses its retained `source_ref` as the new transport operation identity. Supply `operationId` to name that new transfer explicitly. Existing complete native banks and original document transports retain their own operation and edition identities.

```js
import {decodeNativeSourceDocuments, encodeNativeSourceDocuments} from "./carrier_codec.mjs";

const original = decodeNativeSourceDocuments(originalExportTexts);
const transfer = encodeNativeSourceDocuments(originalExportTexts, {
  sourceReference: "retained complete source edition",
  maxDocumentChars: 900000
});
// Each transfer.documents entry has text, chars, UTF-8 bytes/SHA256,
// part number, total parts and original Base64 fragment length/SHA256.
const received = decodeNativeSourceDocuments(transfer.documents.map(part => part.text));
if (received.metadata.json_sha256 !== original.metadata.json_sha256)
  throw new Error("The received application differs from its original source");
```

The default document budget is 900,000 UTF-16 characters, including metadata and any retained bootstrap. The encoder calculates a fitting fragment size, wraps Base64 at 120 columns and emits as many numbered parts as needed. `maxBase64Chars`, `lineWidth`, `title` and `sourceReference` are configurable. When the bank contains the original `source_tools/receive_drive_source.py`, each part includes that exact body by default. Current installed application snapshots can omit that historical receiver and use the maintained assembler directly. Set `includeBootstrap: true` to require and include the retained receiver, or `false` to omit it.

Use the existing authorized source documents as the receiving surface. Read their actual tab IDs and current revision IDs, reconcile any existing content, then write each complete `text` with a native Google Docs `insertText` request and `write_control.requiredRevisionId`. Keep writes sequential. A timeout requires reading that same document before retrying; a revision conflict requires composing with the current content. Read back the completed documents and pass their entire text through `decodeNativeSourceDocuments`.

Large source transfers use exact-sized byte buffers for UTF-8, Base64 and decompressed gzip data. Compression retains only DEFLATE's 32 KiB match history, and SHA-256 reads complete input blocks directly with a reusable schedule. Gzip decoding checks the declared output size against the existing 64 MiB source limit before allocation and verifies its length and CRC afterward. These allocation changes preserve source hashes, the original retained gzip and JSON, and deterministic output from the compressor.

Export each completed native document as `text/plain`. Pass the returned opaque `file_uri` unchanged to the connected Drive uploader; this moves the actual provider export into an ordinary downloadable file. Fetch that complete file back and verify its fragment and full transport. Exported text may carry a BOM, CRLF and extra paragraph whitespace, so its file hash is recorded separately from the original fragment, gzip and JSON hashes. Verify the receiving account's permission on every part. Keep the completed exported files and their IDs as the stable inputs while source successors are applied to the installed application.

On the equipped receiving host, mount every complete source file and use the maintained assembler from the current public application. Join the unchanged exported parts in their original order:

```sh
cat -- "$UPSTATE_SOURCE_PART1" "$UPSTATE_SOURCE_PART2" > "$UPSTATE_JOINED_SOURCE"
"$UPSTATE_PYTHON" -B source_tools/application_assembly.py "$UPSTATE_JOINED_SOURCE" \
  --edition "$UPSTATE_RECEIVING_EDITION" \
  --output "$UPSTATE_NEW_APPLICATION" \
  --source-map "$UPSTATE_RECEIVED_SOURCE_MAP"
```

Include every exported part in the join. The assembler validates the numbered transport, full gzip/JSON and every member before accepting the complete native bank as its base. Its `model/workspace.py` and `operator/server.py` core members establish that complete application boundary; selected component overlays retain their ordinary predecessor checks. Continue the current component installers and the same scientific Workspace from the received application.

For an original document whose embedded receiver is already the chosen receiving route, decode the bootstrap JSON row's `content_base64` into an actual local `receive_drive_source.py` and verify its declared byte length and SHA256. That historical file is supplied inside the document, rather than installed at that path in current public source. Then invoke the saved file with repeated `--document` arguments:

```sh
"$UPSTATE_PYTHON" -B "$UPSTATE_SAVED_RECEIVER" \
  --document "$UPSTATE_SOURCE_PART1" \
  --document "$UPSTATE_SOURCE_PART2" \
  --application "$UPSTATE_NEW_APPLICATION"
```

This retained receiver verifies the complete original bank, installs its Conservation component and writes `source-receiving.json`. Choose this route for its matched original source bank and embedded bootstrap; use the maintained assembler for current installed source maps.

This path was exercised with the actual two native Google Docs exports, each 903,205 bytes. The codec decoded, re-encoded and reopened all 257 original members, including the 1,906-byte Oconee binary, without changing the original 4,214,540-byte JSON (`1e941a72de169958428af36667f0106eaac9f8a1b91fe418ac7916e17bf7dbeb`) or 1,308,402-byte gzip (`26360fd3941d817b4a437d2a165106416c2e12a0aeb1b2f361bb272bfe4bcd95`).


## Use the maintained native receiving workflow with local source

`receive_upstate_local.py` runs a retained original receiver using local or shared source and output files. It verifies the selected receiver, retains its original source ZIP validation, and forwards its runtime, browser, workspace and restore arguments after `--`.

Supply `--receiver` with the retained receiver file and `--source-zip` with that receiver's matching original full archive. The default receiver SHA-256 identifies the 24,364-byte edition. `--receiver-sha256` selects another retained compatible edition explicitly. Add `--source-cache-directory` for retained source trees and `--source-bundle` for complete source banks; either option can repeat.

The receiving outputs include the original result in `NATIVE_RESULT.json`, source use in `LOCAL_RECEIVING_SOURCE.json`, a full file inventory in `NATIVE_FILES.json`, the streaming `Upstate_Communities_Native_Workspace.zip`, and `PRESERVED_RESULT.json`. Use `--preserve-directory` to copy those completed artifacts to the chosen shared destination, where the result manifest is installed after artifact copy and readback.

The original receiving workflow uses its matched source edition first. Apply the selected current application components through the application assembler and their maintained installers before continuing the current operator study.


## Export one maintained component family

The complete application snapshot and the component checker both compose the
baseline catalogue with the original direct files in
`integration/component_fragments/*.json`.
This includes fragment-only native manifests and their original primary and
companion bodies, even when a declared binary exceeds the ordinary 8 MiB inline
threshold. The existing source inventory checks still detect changes during
capture.

Use the same assembler to export a focused family from a current source or
installed application directory:

```bash
python -B source_tools/application_assembly.py CURRENT_APPLICATION \
  --family-component station-assessment \
  --family-component utility-microbial-study \
  --family-component observed-station-wbd \
  --edition upper-savannah-station-family-20261013 \
  --operation-id ECO-GEO-0D0F \
  --source-map station-family.json.gz
```

Repeat `--family-component` to select the actual entry points. The selection
includes their declared `requires` dependencies, component fragment additions,
native `source_manifests`, and transitive local Python imports, package
initializers, extension providers and binding modules, JavaScript imports,
stylesheets and mapped HTML resources. It does not run the application, install
scientific packages, or discover data by sweeping unrelated scientific archives.
Data loaded dynamically by a model remains the responsibility of its maintained
component paths or native source manifests.

`--inspect` returns the same component inventory and exact missing-member
diagnostics without publishing a bank. Whole-application inspection and
publication retain their existing behavior when no family is selected.

The output is an ordinary `commons.source-bank/v1` source overlay. Every selected
file carries its original bytes, SHA-256, encoding and executable mode. The
complete original catalogue and fragment bodies travel in
`family_selection.declaration_sources` as source provenance; they do not overwrite
the receiver's maintained catalogue with a partial replacement. The receiving
application must already carry the selected families' original runtime and data
declarations. The assembler verifies those declarations and the family's closure
again after composing all source layers.

When updating an older application, include its actual retained directory to
record exact predecessor hashes:

```bash
python -B source_tools/application_assembly.py CURRENT_SOURCE \
  --family-component station-assessment \
  --family-component utility-microbial-study \
  --family-component observed-station-wbd \
  --family-against RETAINED_RECEIVING_APPLICATION \
  --edition upper-savannah-station-family-20261013 \
  --source-map station-family.json.gz

python -B source_tools/application_assembly.py RETAINED_RECEIVING_APPLICATION \
  --overlay station-family.json.gz \
  --edition ecosystem-with-current-station-family \
  --output NEW_COMPOSED_APPLICATION \
  --source-map ecosystem-with-current-station-family.json.gz
```

The existing source join rejects a changed predecessor. If the receiver's selected
component declarations differ, receive the current original declaration layer
from its author in the same operation before the family overlay. Shared host
modules are retained through the same local dependency closure and original
source guards; neither the installed source nor the scientific Workspace is
changed during export.

For integrations, `application_components.inspect(..., selected_components=[...])`
uses the same resolver with explicit reachability, and
`application_components.read_directory(..., selected_components=[...])`
returns the original bodies used for inspection. `application_assembly.export_family`
captures and verifies those selected bodies, while its regular `compose` API
validates selected-family overlays before any directory, archive or source-map
publication.
