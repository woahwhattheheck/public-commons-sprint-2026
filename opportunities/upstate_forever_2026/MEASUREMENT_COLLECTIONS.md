# Complete observation collections

Receive chemistry, monitoring stations, daily discharge and companion originals as one saved collection in the original measured-data workspace. The native source parser, importer, SQLite history, eligibility rules and calibration export remain the original implementations. Collection receiving composes them; it does not create a competing planner, scientific model or native Workspace.

## Operate in the browser

The current application source includes this component and its independent catalogue declaration. Reopen the original operator to load it. For the separately distributed source archive, run `python install_measurements.py --application /path/to/original/application` from the extracted archive first. The existing Measured data view now includes **Receive a complete observation collection**. Name the collection, select the complete original files, and choose each file's interpretation. Chemistry uses `wqp`, station metadata uses `stations`, and complete USGS daily responses use `usgs-daily`. Other files, including activity exports, source documentation and binary GIS companions, are retained as `companion` without pretending to parse their scientific meaning.

Inspect all files. The inspection reports full row totals, every rejected-row count, issues, and resolved column mappings. Receive the collection. Original source identities are reused when the identical data and interpretation already exist. Source files and their exact hashes remain available after a process restart. Interrupted receiving resumes by sending the same complete collection; it neither duplicates native measurements nor overwrites analyst review choices.

Use the existing native-domain binding form, station assignments and record-review desk for actual source assignments and qualified-result decisions. Then open **Saved collections and complete study editions**, save a complete study edition, and download its ZIP. The archive contains every supplied original, all original records and histories in `project.json`, the complete accepted/excluded calibration population, all-record CSV, eligible-input CSV, native identifier edition, and an offline HTML report. The report includes the entire input population and original-source links. The full original measured workspace is included, even when it contains additional source imports beyond this collection.

## Command line

Create `collection.json` using the format below. Each SHA-256 is calculated from the actual original file, not a decoded or normalized surrogate. Paths are relative to the selected source directory. Symlink targets must remain inside it.

```json
{
  "format": "upper-savannah-measurement-collection/v1",
  "title": "Agency observations and complete source companions",
  "files": [
    {"path": "results.csv", "kind": "wqp", "sha256": "REPLACE_WITH_ACTUAL_SHA256", "mapping": {}},
    {"path": "stations.csv", "kind": "stations", "sha256": "REPLACE_WITH_ACTUAL_SHA256"},
    {"path": "activities.csv", "kind": "companion", "sha256": "REPLACE_WITH_ACTUAL_SHA256"}
  ]
}
```

```sh
node measurement_workspace/engine/cli.mjs collection-preview --workspace /original/workspace/measurement-observations --manifest collection.json --source-root ./originals
node measurement_workspace/engine/cli.mjs collection-receive --workspace /original/workspace/measurement-observations --manifest collection.json --source-root ./originals
node measurement_workspace/engine/cli.mjs collections --workspace /original/workspace/measurement-observations
node measurement_workspace/engine/cli.mjs collection-publish --workspace /original/workspace/measurement-observations --id COLLECTION_SHA256
```

Editions are stored under `measurement-observations/collections/<collection-id>/editions/<edition-id>`. Repeating publication for the same full original workspace snapshot and native identifier edition reuses its exact edition. A changed workspace produces another saved edition, preserving the previous one. Report generation operates on an independent receive of one original-engine snapshot, so all exported files agree even while another process edits the live workspace. The sender's review history and export table remain unchanged by report assembly.

## Independent receiving

Unpack the complete ZIP and follow its `RECEIVING.md`. The original `receive` command imports `project.json` into an empty measured workspace. `collection-receive` with `collection.json` and `--source-root sources` restores the complete companion collection while reusing the imported source IDs. Open the receiving application's original native source in the existing domain binder before new reach assignments. Preserved identifiers are not a substitute for the receiving application's source geometry. Reviews, original files and further independent edits remain available offline.

## Programmatic use

The original authenticated RPC accepts `/collections/preview`, `/collections/receive`, `/collections/<id>/publish`, `/collections`, and `/collections/<id>/editions/<edition>`. Preview and receive use POST with the manifest and complete files supplied as either `text` or canonical `base64`. A caller may pin `expectedId` to its reviewed preview. Binary bodies use base64; byte counts and hashes are validated before imports begin. No collection HTTP endpoint reads caller-named server filesystem paths.

The edition's `/bundle` suffix returns a JSON envelope containing complete ZIP bytes encoded as base64, filename, byte count, media type and SHA-256. This travels through the original UTF-8 RPC without corrupting binary companions. Direct file endpoints also exist for the original local HTTP server. The browser downloads the complete archive rather than a report whose relative links have been separated from their source files.

## Interpretation and compatibility

WQX2 `MeasureQualifierCode` is recognized for new imports. Explicit mapping values, including an empty string, are authoritative. Legacy portable packages keep their original resolved mappings and record identities when reopened; a newly recognized alias does not rewrite old scientific interpretations. To use a new mapping for an existing original, import an explicit new interpretation and use the existing source-version review workflow.

Censoring, detection conditions, reported values and detection/quantitation limit metadata retain their original engine behavior. In particular, “Present Above Quantification Limit” is not automatically changed into an uncensored value just because a numeric value was reported. The official WQX example defines an above-upper-limit result as a censored observation. Source metadata contradictions require an explicit analyst decision, not a blanket parser override. See EPA's [WQX Web User Guide](https://nepis.epa.gov/Exe/ZyPURL.cgi?Dockey=P101G8UE.txt) and [WQX glossary](https://cdx.epa.gov/WQXWeb/StaticPages/GlossaryWqx.htm).

## Installation and ownership

The separate source-archive installer validates the complete source inventory, selects only this family, preserves an existing `measurement_workspace/__init__.py`, and leaves Published Studies and other peer modules untouched. It accepts only identical installed files or exact original OBS12 predecessor hashes for owned-file upgrades. Source conflicts identify their exact paths. The descriptor is installed last. Interrupted partial upgrades converge on re-execution, and errors roll back this invocation's changes when those bytes are still unchanged. Reopen the original server after upgrading loaded code.

The source archives and their original guide/manifests are kept separately in the delivery history. In the source archive, `SOURCE_MANIFEST.json` describes this successor edition, while `originals/core-source-manifest.json` and `originals/bridge-source-manifest.json` identify the recovered originals.

## Source and independently received revision identities

`edition.json.workspaceRevision` and the report heading identify the retained sender snapshot. The verified calculation copy is an independent original-engine receive, which adds its native receiving event. Its actual revision is preserved as `edition.json.analysisWorkspaceRevision` and `calibration.json.workspaceRevision`; the separate `analysis-context.json` binds its actual analysis revision to `sourceWorkspaceRevision` and `sourceCollectionId`. The native calibration JSON, including its digest, stays unchanged. Neither a receiving revision nor a source record identifier is reassigned. The immutable `project.json` contains the sender revision and every original row/history; normal customer receiving advances its own revision.

Original UTF-8 BOM bytes are preserved by collection intake, the ordinary browser file picker and provider acquisition. Parser header handling remains separate from the retained original byte identity.
