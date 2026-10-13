# Receive a complete Upper Savannah application

The source assembler combines a retained application and selected component packages into one directory, one complete source map and one portable ZIP. It runs on Linux with Python 3.10 or later and uses the standard library. Use the same scientific workspace and its existing source, scenario and run identifiers after receiving the application.

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

Paths prefixed by the document's declared application prefix are normalized to the same application root as relative paths. A second entry that resolves to an existing member remains a duplicate error. Every supplied Git blob identity is checked, including `git_blob`, `git_blob_sha` and `git_sha`. Each component can supply `base_sha256` or `replaces_sha256` to identify the exact file it updates. Reapplying an already installed postimage with that same requested SHA-256 also succeeds. A different intermediate body still requires the declared predecessor.

## Binary companions and installed snapshots

Base64 file records carry either text or original binary bytes. The received directory and ZIP contain those original bytes. A binary companion is represented in the assembled source map as a Base64 string with `file_metadata[path].encoding = "base64"`; ordinary source keeps `"utf-8"`. The byte count, SHA-256 and Git identity always describe the original file.

Use this assembler to reopen maps containing binary members. All-text maps also remain readable by the earlier application receiver. The accompanying JavaScript carrier codec understands the same member encodings.

When the base is an installed application directory, the snapshot captures current root files and the `model`, `operator`, `source_tools`, `source`, `ecsa_runs`, `integration`, `integrations`, `tools`, `receiving` and `eco_intelligence` directories. Existing installer joins are preserved. Small binary assets of up to 8 MiB each are included directly; larger native inputs keep their full size, hash and retained local path in the existing external-source declarations. Application source is capped at 256 MiB. Keep the complete scientific workspace, its original inputs and model outputs on the established workspace backup/restore route.

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

## Use the maintained native receiving workflow with local source

`receive_upstate_local.py` runs a retained original receiver using local or shared source and output files. It verifies the selected receiver, retains its original source ZIP validation, and forwards its runtime, browser, workspace and restore arguments after `--`.

Supply `--receiver` with the retained receiver file and `--source-zip` with that receiver's matching original full archive. The default receiver SHA-256 identifies the 24,364-byte edition. `--receiver-sha256` selects another retained compatible edition explicitly. Add `--source-cache-directory` for retained source trees and `--source-bundle` for complete source banks; either option can repeat.

The receiving outputs include the original result in `NATIVE_RESULT.json`, source use in `LOCAL_RECEIVING_SOURCE.json`, a full file inventory in `NATIVE_FILES.json`, the streaming `Upstate_Communities_Native_Workspace.zip`, and `PRESERVED_RESULT.json`. Use `--preserve-directory` to copy those completed artifacts to the chosen shared destination, where the result manifest is installed after artifact copy and readback.

The original receiving workflow uses its matched source edition first. Apply the selected current application components through the application assembler and their maintained installers before continuing the current operator study.
