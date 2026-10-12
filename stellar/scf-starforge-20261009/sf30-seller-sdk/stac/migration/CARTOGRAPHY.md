# Native QGIS publication in the migration workspace

The migration application turns an already reviewed, saved QGIS project into an editable map project, a reusable print layout, PDF and PNG. A corrected publication keeps the earlier edition, its exact source comparison and the operator's explanation. The complete migration handover carries the data, styles, project resources, print files and the publisher's original source together.

Open **Cartographic publication** in the original migration desk. The same workflow is available through the original migration command line and the migration merchant attachment. It uses the existing workspace, actor, request history and complete archive.

## Start with the selected saved project

Complete the original source intake, mapping review, destination build and native project save first. Choose the actual project from the publication inventory. Its source and style files are verified against the saved descriptors when previewing or publishing.

The selected native Python must provide QGIS 3.40 or newer, its real provider libraries and the corresponding Qt installation. The original migration entrypoint selects this Python. Native rendering and reopening run on that QGIS application's main thread; the existing application owner controls the process. The original vector and QGIS modules are retained under one coherent package identity.

A publication uses the selected saved project's layer order, provider bindings, renderer and labeling configuration. Leaving the layer selection inherited uses its saved visible layers. An explicit selection must include at least one saved layer. The panel preserves the saved drawing order.

Vector expressions are evaluated in the original project and layer expression context. The publisher records required field bindings and actual requested/resolved label font families. A missing field or invalid expression produces a retained native error so the saved map can be corrected before another edition is reviewed.

## Review the page and map

Choose A4 or A3, landscape or portrait, and 150 or 300 DPI. Enter the title, optional subtitle and the source attribution. Publication headings and attribution are literal text. Choose a complete legend and scale bar when useful.

**Saved project extent** means QGIS's saved default/initial project view, returned by `project.viewSettings().defaultViewExtent()`. Its own referenced CRS is transformed into the saved project CRS when required. This is distinct from a desktop map canvas's separately stored last view. When the project has no saved default extent, the publisher uses the selected layers' native extent union and records that fallback and its reason. An invalid nonnull saved view produces an error instead of silently selecting another area.

An explicit extent contains `xmin, ymin, xmax, ymax` in the saved project CRS. The original Decimal-aware request text remains in the plan; only the declared native coordinate and padding values become finite QGIS display numbers. The receipt retains the original requested bounds, source and project CRS, native transformed bounds and padded bounds. QGIS fits that area to the actual map frame, and the final native layout records its resulting extent and scale.

Padding can be zero through fifty percent. Native text measurement, legend sizing and page bounds determine whether the complete content fits. For a fit error, select a larger page or correct the content in a new reviewed plan. The complete earlier request and any completed output remain available.

## Save, publish and inspect the result

Preview binds the actual project file, layer source occurrences, style resources and selected print options. Saving the plan records the original request and actor. Publication first retains a native input record and its exact publisher source version, then produces the native files under the original request's output directory.

QGIS creates the print layout and writes the QGZ and QPT. The original native exporter renders PDF and PNG. Before publication, the application reopens the saved project and layout, checks provider/resource bindings and layout content, decodes the PNG and verifies the completed PDF. The full output directory is published atomically after those native files are complete. The original workspace transaction then records the completed publication.

The saved receipt includes the actual QGIS version, layout dimensions, native map extent and CRS, layer order, field and style bindings, text/font information, exporter results and every delivered file's byte count and SHA-256. Open the PNG preview and download the original files from the same authenticated application.

| Download | Delivered file | Use |
| --- | --- | --- |
| `qgz` | `map.qgz` | Original editable map with its retained print layout and relative project resources |
| `qpt` | `layout.qpt` | Native QGIS print-layout template |
| `pdf` | `map.pdf` | Complete native print export |
| `png` | `map.png` | Complete native raster export and browser preview |
| `plan` | `publication-plan.json` | Reviewed project, source/style bindings, exact canonical input and print specification |
| `receipt` | `publication-receipt.json` | Native result, source version and complete file identities |

A QGZ or QPT that uses local project resources travels with the full migration archive. The complete handover preserves their original relative data and style paths.

## Produce a corrected edition

Open the earlier publication, choose the actual corrected saved project and inspect the comparison. It lists original/current source-binding occurrences, styles, layer choices, native project CRS and print options. Repeated ambiguous source occurrences remain visible.

A corrected plan names its `predecessorPublicationId`. Save the exact comparison SHA returned by preview and a substantive review note describing the selected correction. A changed comparison must be reviewed again. The earlier publication, its input and all six downloads remain unchanged.

After publishing the correction, inspect both publications and their editable native projects. The complete archive contains the whole original revision and request history, both map editions and their corresponding publisher source records.

## Continue an interrupted original request

The browser's original mutation controller preserves an explicitly supplied revision, request ID and actor. It records that request before dispatch. The panel keeps the same complete draft and pending request under the original workspace's storage key.

| Observed state | Original continuation |
| --- | --- |
| Plan reply was lost | Read `cartography.operation` with the saved request ID, or find that plan's original request in inventory. Reuse the identical canonical spec when continuing. |
| `started` | Read the saved operation and continue its exact plan, actor, starting revision and request ID through the selected native publisher. |
| `needs-attention` | Inspect the retained native error. Restore the required original runtime/resources and continue the same request, or make an explicitly reviewed corrected plan when inputs change. |
| `output-ready` | The complete native publication exists; continue the same request so the original transaction adopts that exact result. |
| `complete` | Read the original result and download or reopen its exact files. Same-request publication returns the retained completion. |
| Original revision changed before the action was accepted | Inspect the current workspace and original request. Review the pending input against the new revision before creating a new action. |
| Request ID already belongs to a different body | Recover that original operation; a different reviewed action receives its own request identity. |

`started` records progress and does not assert that a process is still alive. The original vector destination claim serializes native reentry and releases its OS lock when the process exits. A second continuation with the same logical request waits on that same claim and reuses the completed output directory.

Plans, native inputs and publication records bind their original `softwareId` in `state.migration.software`. The complete source is retained under `migration/software/<softwareId>/stac/`. An incomplete operation runs through that retained publisher edition. A completed result remains readable after the installed application advances. Select the original archived source when resuming an older operation, rather than changing its source identity:

~~~sh
SELECTED_QGIS_PYTHON \
  /private/workspace/migration/software/ORIGINAL_SOFTWARE_ID/stac/migration/engine.py \
  --workspace /private/workspace \
  --input /private/original-publish-request.json \
  --output /private/original-publish-result.json \
  --progress
~~~

## Original command line

Use the selected QGIS Python and the existing `migration/engine.py`. Each request is one complete JSON object with `command` and `payload`.

~~~sh
SELECTED_QGIS_PYTHON migration/engine.py \
  --workspace /private/original-migration \
  --input /private/publication-command.json \
  --output /private/publication-result.json \
  --progress
~~~

Example preview input, with the actual selected project ID and source attribution substituted:

~~~json
{
  "command": "cartography.preview",
  "payload": {
    "spec": {
      "schema": "starforge.migration-publication-spec.v1",
      "projectId": "ORIGINAL_SAVED_PROJECT_ID",
      "title": "Reviewed migration map",
      "subtitle": "Selected original edition",
      "attribution": "ACTUAL_SOURCE_AND_LICENSE_ATTRIBUTION",
      "page": {"size": "A4", "orientation": "landscape", "dpi": 150},
      "map": {"extent": "project", "paddingPercent": 5},
      "legend": {"show": true, "title": "Legend"},
      "scaleBar": {"show": true},
      "predecessorPublicationId": null,
      "review": {"comparisonSha256": null, "note": ""}
    }
  }
}
~~~

| Command | Original payload |
| --- | --- |
| `cartography.inventory` | `{}` |
| `cartography.preview` | `{spec}` |
| `cartography.save-plan` | `{spec, revision, requestId, actor}` |
| `cartography.publish` | `{planId, revision, requestId, actor}` |
| `cartography.operation` | `{requestId}` |
| `cartography.publication` | `{publicationId}` |
| `cartography.download` | `{publicationId, kind}` |
| `cartography.reopen` | `{publicationId}`, or `{}` for all retained publications |

Use the reviewed workspace revision for a new mutation and retain the exact complete request. A native render's initial revision remains part of that operation's input across continuation; its completion is appended through a fresh original transaction so unrelated accepted changes survive.

The local download result contains an absolute host path and a `descriptor` whose `path` is relative to the workspace. The browser sends only that declared relative path through the original checked download endpoint. Its PNG preview receives the verified Blob from `download(path, {returnBlob: true})`.

Common source/input errors include `CARTOGRAPHY_EXTENT`, `CARTOGRAPHY_EXTENT_PRECISION`, `CARTOGRAPHY_LAYER_SELECTION` and `CARTOGRAPHY_REVIEW_REQUIRED`. Native errors identify the specific field, CRS/transform, text, legend, page-fit, resource or output problem in their retained details. `CARTOGRAPHY_NATIVE_SOFTWARE` identifies a publisher-source mismatch on an incomplete operation. Original workspace errors such as `REVISION_CHANGED` and `REQUEST_REUSED` keep their existing meaning.

## Complete baseline/correction native operation

`examples/cartography_journey.py` is a callable receiving helper and an original command-line entry. It accepts the actual two saved projects, their reviewed print options and the substantive correction note. It uses the original preview/save/publish/request/read/download/reopen APIs. Its action inputs and completed result are retained before the caller exits.

Input example:

~~~json
{
  "operationId": "ORIGINAL_MIGRATION_RECEIVING_OPERATION",
  "actor": "Named migration operator",
  "baseline": {
    "projectId": "ACTUAL_BASELINE_SAVED_PROJECT_ID",
    "title": "Baseline migration map",
    "attribution": "ACTUAL_SOURCE_AND_LICENSE_ATTRIBUTION",
    "page": {"size": "A4", "orientation": "landscape", "dpi": 150},
    "map": {"extent": "project", "paddingPercent": 5}
  },
  "corrected": {
    "projectId": "ACTUAL_CORRECTED_SAVED_PROJECT_ID",
    "title": "Corrected migration map",
    "attribution": "ACTUAL_SOURCE_AND_LICENSE_ATTRIBUTION",
    "page": {"size": "A4", "orientation": "landscape", "dpi": 150},
    "map": {"extent": "project", "paddingPercent": 5}
  },
  "correctionNote": "ACTUAL_REVIEWED_SOURCE_OR_MAPPING_CHANGE_AND_REASON"
}
~~~

~~~sh
SELECTED_QGIS_PYTHON migration/examples/cartography_journey.py \
  --workspace /private/original-migration \
  --input /private/original-publication-input.json \
  --out /private/original-receiving-operation/publications
~~~

For the existing whole migration journey, call the helper after the original baseline and corrected project builds and before its first complete export:

~~~python
from migration.examples.cartography_journey import publish_original_projects

publications = publish_original_projects(
    workspace, root / "publications",
    operation_id=config["operationId"], actor=actor,
    baseline=baseline_spec, corrected=corrected_spec,
    correction_note=reviewed_correction_note, progress=progress,
)
selected_software_id = publications["receivingSoftwareId"]
~~~

The `projectId` values come from the actual original `build_projects` result rows. Keep the selected specs and note in the original operation configuration. The helper freezes both inputs, publishes the baseline, records the actual comparison and correction note, publishes the corrected edition, recovers both original completed requests, verifies all six downloads for each edition and reopens both native publications. It preserves original data, source/mapping records, projects and earlier request/event history.

The helper's result names `receivingSoftwareId`. Pass that exact source selection to the original independent/onward receiver so the delivered application contains the complete publisher. Retain `publications/input.json`, its original `actions/`, `results/`, `reviewed-comparison.json` and `result.json` with the whole original receiving operation. They are completed operating records tied to the selected source and actual native outputs.

## Complete archive and independent reopening

The existing `receiving.export_handover` includes the original database/history and complete declared file closure. The cartography namespace contributes plans, native inputs, completed output bundles, publication receipts and exact publisher software through the existing manifest. It creates no separate private store.

The original `receiving.receive` validates the complete archive and restores the same workspace. With `native_reopen="required"`, it reopens each original project and publication in the selected QGIS Python. Its `native.publications` result includes the actual QGZ/QPT/layout/resource/file checks.

The existing `examples/receiving_journey.py` then launches the independent receiving step from the selected source inside the received archive, exports that received workspace onward, and opens the onward delivery from its own retained application. Use the helper's publisher software ID for this selection when several historical application editions are present.

Keep the original archive, returned byte count/SHA-256, full result and operating guide together. A completed original export filename is reconciled against its saved workspace/revision and file identity; a later correction gets its own completed archive.

## Source and product composition

The complete source manifest includes these additive leaves alongside the original migration, vector and QGIS engines:

- `migration/cartography.py`: reviewed plans, original journal operations, exact file closure and command API.
- `migration/cartography_native.py`: QGIS print layout, native export and full original-file reopening.
- `migration/public/cartography.mjs` and `cartography.css`: the panel mounted by the existing authenticated desk.
- `migration/CARTOGRAPHY_BROWSER.md`: exact shell mutation, draft, recovery and checked preview contract.
- `migration/examples/cartography_journey.py`: the original two-project publication continuation.
- This operating guide.

The original engine routes `cartography.*`, the original workspace validates and exports `state.migration.cartography`, and the original receiver reopens its full publication closure. All shared writes retain the same workspace transaction and source ownership.

## Primary references

The product's migration/publication use case comes from Lutra's own description of migration work and QGIS print/layout capabilities:

- [Lutra migration services](https://www.lutraconsulting.co.uk/migration-to-open-source-gis)
- [Lutra: ArcMap migration and QGIS print workflows](https://www.lutraconsulting.co.uk/blogs/arcmap-is-dead-great-time-to-switch-to-qgis)

Native implementation contracts:

- [QGIS 3.40 print-layout cookbook](https://docs.qgis.org/3.40/en/docs/pyqgis_developer_cookbook/composer.html)
- [Saved project view settings and default-view semantics](https://api.qgis.org/api/3.40/classQgsProjectViewSettings.html)
- [Referenced rectangle and its CRS](https://api.qgis.org/api/3.40/classQgsReferencedRectangle.html)
- [Native map item and saved layer styles](https://api.qgis.org/api/3.40/classQgsLayoutItemMap.html)
- [Native layout template save/load](https://api.qgis.org/api/3.40/classQgsLayout.html)
- [Native text measurement](https://api.qgis.org/api/3.40/classQgsLayoutItemLabel.html)
- [Native legend](https://api.qgis.org/api/3.40/classQgsLayoutItemLegend.html)
- [Native scale bar](https://api.qgis.org/api/3.40/classQgsLayoutItemScaleBar.html)
- [Native PDF/image exporter](https://api.qgis.org/api/3.40/classQgsLayoutExporter.html)

The completed operating result records the actual runtime version used for the selected source. The source manifest and saved publisher identity determine the exact code delivered with each publication.
