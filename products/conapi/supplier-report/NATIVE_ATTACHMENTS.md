# Join the supplier package to a native workflow delivery

The supplier report CLI produces the complete editable comparison and review bundle. The native workflow adapter produces the source edition, Analysis queries and report, and complete Analysis workspace archive. `supplier_attachments.py` joins the finished supplier files to the outer delivery using the adapter’s existing file-descriptor contract.

## Existing interfaces

The maintained native entry point is `NativeWorkflowAdapter(configuration, workspace=Path(...), progress=callback).run(original_request, stable_run_id)`. It returns `edition`, `analysis`, `files`, `archive` and `nativeIds`. Each native file descriptor contains `name`, absolute `path`, `bytes`, lowercase `sha256` and `contentType`.

The supplier export is:

```sh
node supplier-report-cli.mjs export --workspace reviewed.json --out-dir NEW_DIRECTORY --table-name supplier_feed_accepted
```

The export directory must be absent before that command. The CLI pre-generates the complete output and writes `manifest.json` last. Its source path is `products/conapi/supplier-report/supplier-report-cli.mjs` in the installed component.

The manifest schema is:

```json
{
  "format": "conapi-supplier-delivery",
  "version": 1,
  "requestId": "original business request identity",
  "comparisonId": "original source/rules comparison identity",
  "revision": 1,
  "status": "reviewed",
  "exportedAt": "the actual export timestamp",
  "files": [
    { "filename": "workspace.json", "bytes": 123, "sha256": "the actual lowercase SHA-256" }
  ]
}
```

The illustrative byte count and hash above show field positions. Receiving uses the original complete manifest emitted by the installed CLI.

The manifest excludes itself. Every declared filename is one basename. All exports contain `workspace.json`, `report.json`, `rules.json`, the complete baseline and candidate source files, `changes.csv` and `report.html`. The source files retain their original CSV or JSON format. A reviewed export also contains `accepted.csv`, `accepted.sql` and `lineage.json`.

## Native attachment binding

Import `supplier_attachment_files` from the installed supplier component. Run the supplier export into a new directory inside the same private native request workspace. Pass that completed directory to the helper:

```python
from supplier_attachments import supplier_attachment_files

# These objects and paths belong to the original installed request operation.
native_result = adapter.run(original_request, stable_run_id)
supplier_files = supplier_attachment_files(
    supplier_export_directory,
    request_workspace=native_request_workspace,
    expected_manifest_sha256=retained_supplier_manifest_sha256,
    expected_request_id=original_request["requestId"],
    reserved_names=(item["name"] for item in native_result["files"]),
)
outer_delivery_files = [*native_result["files"], *supplier_files]
```

The caller supplies the actual paths and identities retained in the current request operation. `expected_manifest_sha256` may be omitted when binding an export just generated in that operation; the returned manifest descriptor supplies its actual complete-file hash. Pass the retained hash when receiving a previously transferred package. Set `expected_request_id` when the supplier comparison has been created with the original native business request identity.

The helper keeps each original file at its existing absolute path and returns the native descriptor shape. By default its attachment names are prefixed with `Supplier_Report_`, including `Supplier_Report_manifest.json`, `Supplier_Report_workspace.json` and `Supplier_Report_report.html`. Its records join the outer handover’s file list. The original manifest bytes, native result object, Analysis archive and native identities stay with their existing owners.

The full installed supplier software component also belongs in the orchestration service’s complete source distribution, alongside its maintained Datasette and Analysis inputs. Include the component’s modules, CLI, browser assets, source examples and operating guides in that existing source inventory.

## Include the complete catalogue coverage operation

Generate the original-source catalogue coverage JSON, CSV and HTML with `catalogueCoverage`, `coverageCSV` and `coverageHTML`. Preserve the original catalogue CSV and publisher metadata alongside those outputs. Existing baseline/candidate source files already present in the supplier CLI export remain supplied by that exporter.

The helper accepts these existing complete file declarations through `additional_files`:

```python
supplier_files = supplier_attachment_files(
    supplier_export_directory,
    request_workspace=native_request_workspace,
    reserved_names=(item["name"] for item in native_result["files"]),
    additional_files=coverage_file_descriptors,
)
```

Each additional entry uses `{name, path, bytes, sha256}`. Its name is an original safe basename, its path is absolute beneath the same original request workspace, and its byte count and hash refer to the complete generated file. The helper applies the same `Supplier_Report_` prefix and reads the complete bytes before returning its descriptor. Additional report files are declared by the outer delivery; the original CLI manifest remains unchanged.

Useful complete catalogue attachments are `catalogue-coverage.json`, `catalogue-coverage.csv`, `catalogue-coverage.html`, the original `services-catalogue.csv` and the original `datapackage.json`. Include the pricing CSV as an additional original file when the comparison bundle’s baseline/candidate sources are different feeds.

## File and continuation behavior

The helper uses Python 3.11 or later on the same Linux worker as the native adapter. It streams hashes for full files, checks byte counts against the retained declaration, opens descendants without following symlinks, and rejects duplicate or colliding attachment names. It checks the complete CLI file set and the accepted-output trio for reviewed exports. All comparisons and review decisions remain functions of the supplier report module.

The helper performs no writes. Repeating it reads the same complete source files and returns the same descriptors. Preserve the completed supplier export directory for continuation and transfer. When a corrected comparison produces a successor export, use its new original CLI directory and manifest with the corresponding request or review continuation.

## Independent receiving

Receive the native Analysis archive through `adapter.receive(archive_path, sha256, destination, operation_id)` using its original archive descriptor and retained receiving operation.

Keep the supplier package’s original filenames and `manifest.json` together in its independent receiving directory. The outer attachment prefix is a transport label; the manifest records the original local filenames. Run the supplied `supplier-report-cli.mjs serve --port 8765` through Node, open the localhost address it prints, and load the adjacent `workspace.json` to continue source review and accepted-row decisions. The completed manifest includes `review.html`, the original core/UI modules and styles, this same CLI, and all component guides/helpers, so the received folder can produce its next complete export. ES module loading uses the local HTTP server. The catalogue coverage JSON retains both original CSV strings and complete source metadata so its CSV and standalone HTML report can be regenerated with the delivered module.

## Maintained native source

- [Merged native workflow adapter, PR 507](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/pull/507)
- [Exact workflow_analysis.py source](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/824efbf20a8ed14d1e80ee23324f44e87b732546/stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/workflow_analysis.py)
- [Exact native operating guide](https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace/blob/824efbf20a8ed14d1e80ee23324f44e87b732546/stellar/scf-starforge-20261009/sf30-seller-sdk/datasette-analysis/WORKFLOW_ANALYSIS.md)
