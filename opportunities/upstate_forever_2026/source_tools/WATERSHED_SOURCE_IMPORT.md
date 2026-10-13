# Import original watershed context into the operator

The source bridge connects the retained watershed calculation to the existing
Upper Savannah workspace and Regional watersheds desk. It uses the native
`model.watershed_context.build_watershed_context` implementation and the normal
`Workspace.import_sources` / `Workspace.source_file` path.

## Use the included original edition

The complete original edition is included at
`source/water_context/20261013-prepared/`. Import it into the current workspace
through its regular source-import command:

```sh
python -m model.cli --workspace /path/to/current/workspace source-import \
  source/water_context/20261013-prepared/complete-sources.json
```

Its five data files preserve the exact captured context, coverage, query responses
and classified-stream geometry. The manifest connects those companions so the
operator can reconstruct the edition after workspace transfer.

## Prepare the full original edition

From the existing application directory, using the original source files already
received from the source banks:

```sh
python source_tools/prepare_watershed_context.py prepare \
  --source-context source/water_context/20261013/full-domain-water-context.json \
  --classification-coverage source/water_context/20261013/scdes-domain217-source-coverage.json \
  --membership-response source/water_context/20261013/scdes-domain217-original-objectids.json \
  --additional-huc8-response source/water_context/20261013/scdes-huc8-03060104-to-07-target-class-count.json \
  --classified-geometry source/water_context/20261012/raw/scdes-classified-streams.esri.json \
  --output-dir source/water_context/20261013-prepared \
  --workspace /path/to/current/workspace
```

Use the actual current workspace path from the running operator. For a new
workspace, add `--create-workspace`. The command prints the imported
`source_collection_id`, `source_id` and exact existing
`watershed.context.analyze` action payload.

The original coverage record names its membership response
`scdes-original-domain217-classified-objectids.json`; the received source bank
uses `scdes-domain217-original-objectids.json`. Preparation preserves the exact
13,248 source bytes while reconstructing the declared companion filename. The
original geometry's 4,978,867 bytes are likewise retained unchanged.

`complete-sources.json` is a regular `upstate.sources/v1` manifest. Its primary
document has role `SOURCE_WATER_CONTEXT`; its companions include the original
coverage, object-ID response, additional-HUC8 response and geometry. Import keeps
all original bytes in the existing workspace object store. The ordinary source
view recreates their relative filenames after workspace transfer.

The two model-input JSON files can also be prepared by omitting the three
publisher-body flags. The existing native model then calculates from those
retained inputs. The inspect output lists exactly which original query/geometry
bodies were checked. Supply `--native-network` with the retained original native network JSON or gzip.
Plain JSON is preserved as `native-network.json`; an original gzip is preserved
byte-for-byte as `native-network.json.gz`. The loader decodes that companion for
the same watershed model while the manifest, exact byte count and SHA-256 retain
the compressed original. Keep one network edition per prepared source directory.

For the retained 217-HUC domain, add this option to the same preparation command:

```sh
--native-network /actual/source/model-domain.esri.json.gz
```

Use the original source path on the receiving host. Its HUC12/ToHUC attributes
supply the existing model's native connectivity; the saved report and selection
CSVs retain the complete native state and upstream fields.

## Use the existing desk

1. Open the current workspace in the operator.
2. Open **Regional watersheds**, select the imported edition and choose
   **Build regional context**.
3. Open the completed task's regional report. The complete source domain remains
   available through the existing name, HUC8, state, priority and class filters.
4. Select Lower Tugaloo, HUC12 `030601020507`, and export the selection.
5. Reopen the saved selection from the export history after restarting the
   operator or reopening the workspace. Its original parent report and selected
   HUC IDs are retained.
6. Download its JSON and CSV, or download the full regional report. Transfer
   through the current workspace archive when moving to another operator.

The full model-domain report receives the native model's full-domain report ID.
The earlier command-line calculation also requested a particular selection, so
its report ID reflects that different selection. Both use the same regional
source rows and native scientific methods.

## Inspect or reuse a prepared edition

```sh
python source_tools/prepare_watershed_context.py inspect \
  --source-dir source/water_context/20261013-prepared
```

The inspection includes the native regional summary, exact model-input file
hashes, coverage binding, checked original publisher bodies, and source
fingerprint. Preparation is repeatable with identical bytes. A changed edition
uses a new output directory.

The loader returns `source_context`, `classification_coverage`, optional
`native_network`, `source_files`, `supporting_files` and `validation`.
`source_files` identifies the model inputs used by the existing report
fingerprint. `supporting_files` identifies the original publisher bodies
retained by the import manifest. This keeps the report identity stable when
the same model inputs acquire additional original source companions.

## Current source identities

| Original file | Bytes | SHA-256 |
| --- | ---: | --- |
| full-domain-water-context.json | 152659 | d607c93912102fbb8f28139a5d57b01b0e1886b0155ede16fc1a19d654323566 |
| scdes-domain217-source-coverage.json | 7043 | 2ed2f1bd402437d91aa8c1544d583dd5ceaf7da7e202aed1252f1b3ea47b3bcb |
| scdes-domain217-original-objectids.json | 13248 | f30b8191b0fa0d044514dbe773e86fddf07192566e1c3c4714d477db2f4ceeab |
| scdes-huc8-03060104-to-07-target-class-count.json | 11 | 618de7d9f46f3f697d827a1b6d84974760d5deda62e4e592adaa3c646602a94c |
| scdes-classified-streams.esri.json | 4978867 | daae1887ba6ac25affd85fc6e1094a81ec24130e1846bbb538cf21375bdbb394 |

Original context/model source: Slack Canvas F0C8JV7PJUV. Original publisher
geometry and query-response source: F0C8HSCBK35. The source coverage companion
retains the original SCDES query URLs, captured date and query predicates.
