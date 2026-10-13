# Scientific source catalog and portable collections

Operation: ECO-264B-NATIVE-CATALOG-20261013

## What this adds

Investigations can use original prepared grids alongside registered inputs and model outputs. The catalog preserves each grid's inputs, preparation recipe, profile, scenario, masks and original file descriptors. The operator continues to own the Workspace, native jobs, authentication and downloads. Inventory reads compact records; a selected file is resolved and checked when it is requested.

A selected scientific collection can be exported as original files with scientific metadata, a readable inventory and portable paths. The receiving machine can verify and reopen it. Resuming a transfer reuses completed matching files, which makes moving large selected rasters practical when a session is interrupted.

The raster reader also recognizes explicit units in GDAL band and dataset metadata. Annual per-hectare outputs and derived cell-total outputs retain their distinct meanings.

## Operator walkthrough

Start the maintained operator with the existing scientific Workspace and operator state. Open its authenticated URL, select the Workspace in the top bar, and choose **Investigations**. Create a named investigation or reopen a retained one.

1. Select a prepared-grid input in the registered resources and choose **Inspect selected**. The original queue reads the complete selected file. The retained result shows dimensions, CRS, valid-cell coverage, statistics and declared units where present.
2. Inspect an existing model run to add its registered artifact members to the comparison selectors. Choose the intended original baseline and candidate. Use aligned-raster comparison for matching grids and representations; use explicit pairing and value columns for observed/predicted tables.
3. Open full source details to follow original IDs, hashes, selected models, masks, profile/scenario links and scientific method. Saved results remain attached to the source files that were inspected.
4. Use **History and export** to create the existing investigation JSON snapshot and HTML report. Reopen that investigation in the same Workspace to continue from its saved analyses.
5. When another machine needs the underlying files, create the scientific collection below. Open **OPEN.html** for its readable inventory, verify the delivered collection, then open its catalog in the analysis service.

For Bryce's walkthrough, begin beside an already completed native result. Show one prepared input, its lineage, an original model output and a comparison with compatible output from the retained candidate. Explain the measured quantity and coverage before interpreting a change in value. Finish with the saved report and the same selected collection on the receiving machine. Record the actual Workspace, run ID, artifact members and observed timings from this walkthrough in the current Eco case.

## Scientific quantities

| Representation | Unit in the current pipeline | Interpretation |
| --- | --- | --- |
| InVEST 3.20 NDR native n_total_export / p_surface_export | kg/ha/year | Annual export rate per hectare |
| InVEST 3.20 SDR native sed_export | metric tonnes/ha/year | Annual sediment export rate per hectare |
| Derived nitrogen_export / phosphorus_export | kg/pixel/year | Annual mass for each raster cell |
| Derived sediment_export | metric_tonnes/pixel/year | Annual sediment mass for each raster cell |

The native definitions come from the official [InVEST 3.20 NDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html) and [InVEST 3.20 SDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html). The current original rate_to_mass pipeline applies cell area once and retains the native source descriptor. A 30 m square cell covers 0.09 hectares; a 300 m square cell covers 9 hectares. Annual totals use the derived cell quantities over the selected valid coverage. An unweighted sum of the per-hectare raster is a different quantity.

The catalog retains the parent output's `units`, its upstream `native_units`, and its nested `native_output` separately. The reader uses the current raster's band units, band `units` tags and dataset `units` tags; it records the declarations and rejects conflicting explicit current units. `native_units` describes the upstream representation. Rasters without declarations retain an unknown unit. NDR-only and SDR-only runs preserve their actual selected models and artifacts.

NoData, masks, time periods, spatial support and coverage follow the original data. Optional raster inspection reads the actual header. Optional CSV inspection streams complete records, handles quoted multiline fields, preserves literal NA/NULL unless explicitly configured as NoData, and keeps large integer extrema exact. Scientific inspection uses declared units and retained conversion metadata.

## Files and original integration seam

Restore these paths relative to the current original application root:

| File | Purpose |
| --- | --- |
| operator/science_catalog.py | Prepared-grid provider, scientific inventory, selected lineage and native downloads |
| eco_intelligence/native_catalog.py | Portable catalog normalization, explicit root relocation, optional source inspection and raster unit declarations |
| eco_intelligence/profiling.py | Original INTEL13 profiling with the raster-unit reader correction |
| science_catalog_delivery.py | Standard-library inventory, resumable selected-file copy and receiving CLI |
| SCIENTIFIC_CATALOG.md | Operating and receiving guide |

The original profiling.py base is 13,615 bytes, SHA-256 b84d9f712b7a0adbf7e43607092d0a6de1fce52f1d4f3b07455947c52c36b725. Its computations remain the original implementation; the correction resolves raster units and records their declarations. Merge those narrow changes if the receiving profiling.py has newer edits.

Append `WorkspaceScienceCatalog(operator)` to the current E258 `dataset_providers` tuple, retaining all installed providers, provider configuration and native actions. For an existing composition site, this helper preserves its arguments:

```python
from science_catalog import WorkspaceScienceCatalog
from eco_intelligence.upstate import UpstateInvestigations

def compose_investigations(operator, *, dataset_providers=(), **options):
    return UpstateInvestigations(
        operator,
        dataset_providers=(*dataset_providers, WorkspaceScienceCatalog(operator)),
        **options,
    )
```

Attach the returned integration as `operator.science_investigations`, following the existing A66A/E258 composition. The first import uses the host's operator-directory import layout; Python's standard-library `operator` module is a different module.

The provider callback is `(workspace_key, original_workspace) -> iterable of dataset records`. E258 owns original source/run/artifact enumeration, typed views of extensionless content-addressed sources and the native gateway. A66A owns stdlib HTTP transport and queue admission. ES26's diagnostic provider stays in the existing tuple.

`WorkspaceScienceCatalog(operator, collection_specs=None)` exposes:

| Method | Result |
| --- | --- |
| datasets(workspace_key, workspace=None) / callable provider | Additional complete prepared-grid dataset descriptors |
| inventory(workspace_key) | Project, datasets, source collections, grids, profiles, scenarios, runs, native collection indices and issues |
| lineage(workspace_key, grid_id=..., run_id=...) | Selected original scientific recipe and links |
| native_record(workspace_key, kind, key) | Full selected native analysis/review/report record with its original manifest |
| resolve(workspace_key, selected_dataset_id) | Checked original selected file and its descriptor |
| download(workspace_key, selected_dataset_id) | Original operator file ticket |

The inventory indexes twelve additional native collections lazily. Dataset rows expose original grid ID, role, descriptor and lineage. Selected scenario analyses read their full analysis.json; selected spatial exports use the native inspection service. Existing operator `_ticket` supplies authenticated downloads.

The original portable application inventory must include `eco_intelligence`, the operator directory, and the root files `science_catalog_delivery.py` and `SCIENTIFIC_CATALOG.md`. E258 and the current assembly owner maintain those inventories. This utility manages selected scientific collections alongside the original full Workspace backup feature.

## Capture, export and receive

Choose exact original IDs and registered artifact members from the installed repository. Save a selection file named `selections.json` as a JSON list:

```json
[
  {"tenant_id": "ORIGINAL_WORKSPACE_KEY", "kind": "dataset", "id": "ORIGINAL_DATASET_ID"},
  {"tenant_id": "ORIGINAL_WORKSPACE_KEY", "kind": "artifact", "id": "ORIGINAL_RUN_ID", "member": "REGISTERED_ARTIFACT_MEMBER"}
]
```

Replace the uppercase values with the selected current records. Inside the authorized host, resolve the selected files through the original repository before capturing its catalog:

```python
import json
from pathlib import Path
from science_catalog_delivery import project_repository

repository = integration.engine(workspace_key).repo
selections = json.loads(Path('selections.json').read_text(encoding='utf-8'))
for selected in selections:
    if selected['tenant_id'] != workspace_key:
        raise ValueError('Select files from the current Workspace.')
    repository.path(workspace_key, selected)

catalog = project_repository(repository, [workspace_key])
Path('selected-catalog.json').write_text(
    json.dumps(catalog, ensure_ascii=False, indent=2), encoding='utf-8'
)
```

The original repository materializes a named view when a selected content-addressed source needs its scientific file extension. Resolving selected references performs that native step and checks the retained bytes. Catalog inventory alone stays a metadata read.

The configured allowed root contains the authorized Workspace directories. Place the delivery destination outside the selected source tree.

```bash
python science_catalog_delivery.py inspect selected-catalog.json \
  --allowed-root /path/to/authorized/workspaces \
  --select selections.json --output collection-preview

python science_catalog_delivery.py bundle selected-catalog.json \
  --allowed-root /path/to/authorized/workspaces \
  --select selections.json --destination received-scientific-collection

python science_catalog_delivery.py verify received-scientific-collection
```

Reissue the same bundle command to resume a transfer or reopen a completed matching collection. Copying uses chunks, a staging directory and original-byte checks before publication. Completed matching files are reused. Source changes or digest conflicts identify the affected selection. A lock prevents concurrent writers from modifying the same collection.

The completed directory contains `catalog.json`, `inventory.json`, `inventory.csv`, `OPEN.html`, `delivery.json`, `RECEIVE.md` and original files under `data/`. Registered raster masks/auxiliary metadata and shapefile companions are retained. Original record identities and scientific metadata remain in the catalog; receiving paths are relative to the delivered directory.

Open the collection through the original portable repository:

```python
from pathlib import Path
from eco_intelligence.adapters import CatalogRepository
received = Path('/path/to/received-scientific-collection')
received_repository = CatalogRepository(received / 'catalog.json', received)
```

For original catalogs from another operating system, `NativeCatalog(document, base_dir=..., root_overrides=...)` explicitly relocates tenant roots and retains original source paths as provenance. Its `records`, `artifacts`, `tenant_root` and `repository()` methods expose the original callback interface. Selected files resolve inside their configured tenant root.

## Source and focused receiving record

Authoritative original carriers: cumulative Workspace F0C8JNZTURK, INTEL13 F0C8MU0G65U, and A66A complete operator F0C8PV7JA3U. Coordination and current receiving host: [Eco project thread](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791724121853269). The source manifest records exact bytes, additive files and the profiling correction's base hash.

The completed transfer exercise used original retained INTEL files: a registered dataset and job artifact, 2 files / 3,614 bytes. It verified original identities and bytes, completed-transfer reuse, digest-conflict rejection and resumption after interruption between files. The catalog exercise covered a complete quoted CSV, exact large integer extrema, explicit NoData, JSON-safe nonfinite metadata, root relocation and tenant/symlink containment. Additional native joining and current-screen receiving results belong beside the same original run in the project thread.
