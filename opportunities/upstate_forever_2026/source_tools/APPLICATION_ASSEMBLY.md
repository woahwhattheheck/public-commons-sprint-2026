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

Paths prefixed by the document's declared application prefix are normalized to the same application root as relative paths. A second entry that resolves to an existing member remains a duplicate error. Original binary companions supplied in `binary_files[]` enter the same validated file inventory. This directly receives the original 1,906-byte Oconee metadata asset in recovered source F0C8RS4F0Q1, together with its 101 text files. A separate companion overlay remains accepted when supplied alone; choose one representation of each original path.

Every supplied Git blob identity is checked, including `git_blob`, `git_blob_sha` and `git_sha`. Each component can supply `base_sha256` or `replaces_sha256` to identify the exact file it updates. An already-installed postimage with the same requested SHA-256 is also accepted, so repeating a selected overlay reuses its current file. A different intermediate body still requires the declared predecessor.

## Binary companions and installed snapshots

Base64 file records carry either text or original binary bytes. The received directory and ZIP contain those original bytes. A binary companion is represented in the assembled source map as a Base64 string with `file_metadata[path].encoding = "base64"`; ordinary source keeps `"utf-8"`. The byte count, SHA-256 and Git identity always describe the original file.

Use this assembler to reopen maps containing binary members. All-text maps also remain readable by the earlier application receiver. The accompanying JavaScript carrier codec understands the same member encodings.

When the base is an installed application directory, the snapshot captures current root files and the `model`, `operator`, `source_tools` and `source` directories. Existing installer joins are preserved. Small binary assets of up to 8 MiB each are included directly; larger native inputs keep their full size, hash and retained local path in the existing external-source declarations. Application source is capped at 256 MiB. Keep the complete scientific workspace, its original inputs and model outputs on the established workspace backup/restore route.

```sh
python3 -B source_tools/application_assembly.py /owned/current-application \
  --edition upper-savannah-installed \
  --output /owned/upper-savannah-installed \
  --source-map /owned/upper-savannah-installed.json.gz \
  --zip /owned/upper-savannah-installed.zip
```

Receiving always targets a new directory. An identical invocation verifies and reuses its existing result. Changed files and other editions produce a concrete conflict and remain in place. File publication and final directory creation use the existing atomic Linux receiver, including its concurrent-writer protection.

## Continue the original study

Keep the scientific workspace outside the application directory. Set `UPSTATE_PYTHON` to the existing scientific interpreter on the accepting worker:

```sh
cd /owned/upper-savannah-complete
"$UPSTATE_PYTHON" -B operator/server.py --workspace /owned/current-study
```

Open the loopback URL printed by the original operator. Continue the retained source imports, parameter profiles, grids, scenarios, native runs, comparisons, maps and export workflow. Use the application's installed runtime view to select the existing GIS and InVEST environment.

For component integration, the unchanged APIs are `read_layer`, `layer_from_document`, `compose`, `source_receipt`, `receive_directory`, `write_archive`, `local_dependencies` and `snapshot_application`. `compose(..., include_receiver=False)` is available for consumers that explicitly supply their receiver source. The CLI includes the receiver when it is absent from the selected layers.

The source package retains source identity and composition. Native model execution and scientific workspace transfer remain operations of the existing application.

## Connected source results and retained transport

The receiver accepts the complete Markdown returned by a Canvas read, or the complete saved JSON result of the source connector. Its provider adapter reads the documented MCP fields `structuredContent`, `markdown_content`, `text_content`, `section_id_mapping` and text blocks in `content`. It recursively unwraps JSON and gzip while retaining the original outer carrier name, byte count and SHA-256 in the layer receipt. A source JSON string retains its original serialization, allowing the original payload pin to remain meaningful.

Explicit provider errors remain errors during intake. Nested responses are inspected before choosing the preferred source content. Arrays of text blocks are handled through the same entrypoint. Source files always pass through the original path, byte-count, SHA-256, Git-identity and mode checks before composition.

The current source-bank and source-bundle envelopes use the same complete file contract. In this sprint, the root operator component is F0C8TDW58G4, selected-model engine and schema are F0C9J455NP2 and F0C8JDNF02Z, and the complete regional soil component is F0C88M55E79. Read their current full bodies and include the selected files through the existing source workflow. The source normalization leaves the current operator and model installers in charge of their owned host joins.

The recovered application transport in F0C8RS4F0Q1 declares `upstate.original-source-transport/v1` beside its ordered Base64 blocks. The reader now checks its exact part count, compressed bytes/SHA-256 and decoded bytes/SHA-256 before normalizing the declared product prefix. The current conservation addon and conservation source part decoders retain their own complete packet identity and numbering rules.

For example, a receiving host with an actual saved connector result and a retained full application can run:

```sh
python3 -B source_tools/application_assembly.py /owned/current-application \
  --overlay /owned/receiving/root-operator-result.json \
  --overlay /owned/receiving/selected-model-engine.md \
  --overlay /owned/receiving/selected-model-guide.md \
  --overlay /owned/receiving/regional-soil.md \
  --edition upper-savannah-joined-source \
  --operation-id UPSTATE-SOIL-ENSEMBLES-A74F-20261012 \
  --output /owned/upper-savannah-joined-source \
  --source-map /owned/upper-savannah-joined-source.json.gz \
  --zip /owned/upper-savannah-joined-source.zip
```

The files in this example are the actual saved complete responses or Markdown carriers. The first input is the already-installed application after its selected original host and model installers. Run any newly selected component installer against the receiving output using its included guide, then snapshot that installed output to capture the resulting host source. The assembler preserves the current `ecsa_runs`, `integration`, `tools`, `receiving` and `eco_intelligence` source directories.

## Source lineage of this complete receiver

This edition continues RECOVERY-SCIENCE-2329's complete v4 source F0C8N63K2LE. Its assembler is 46,710 bytes, SHA-256 `cb9ee04d17a115cd0b463840083e24193dc588d567ff80cb94114459214f4be5`. That source already composes E7A1's conservation formats, the current installed source inventory, prefixed recovered source and binary-member support. Its updated JavaScript carrier codec remains byte-identical: 12,202 bytes, SHA-256 `7056cce99cc9501fa2f4753a8bf06e55f4ed936c9193cc879a55ce05882c5461`.

The preceding cumulative application F0C8JNZTURK has 252 files and 3,892,300 source bytes. Its retained source payload SHA-256 is `49d32e6b7f5c3a764054076c65059cc6856f33d7b7cef5d6408adbd0de7d5c67`. Its assembler was 42,009 bytes, SHA-256 `a8e5ec19d01e9ff3bf68f57874cc15464db73645a8b555900521ddb33d666531`.

The additional provider adapter is composed from the original root F0C88HK2SCX source, preserving v4's `is_source_document`, `document_schema`, source normalization and member encodings. The original root full-file SHA-256 is `4d6ce68001ba2b9659c2ec8c40063b90b2f5cf7cfae4db00fa5aafe3de8469d3`. The joined source also accepts the original recovered bank's explicit binary list and repeated identical postimages. These are complete source files for the maintained receiver and its operating guide.
