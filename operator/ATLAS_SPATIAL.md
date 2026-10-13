# Inspect an atlas panel in the native spatial workbench

A completed atlas opens each individual pollutant or priority panel directly in the existing **Spatial review** workbench. The handoff resolves the original raster and vector files from that delivery; it carries the printed physical display range and original source selections.

## Operator workflow

1. Open **Map atlas → Saved releases** and select a completed release.
2. Find the map family and scenario. Under the desired panel's legend and units, select **Inspect pixels and geography**.
3. Pan and zoom the retained raster. Use **Inspect** to read original pixel values and intersecting source features. Use the existing overlay controls to inspect native fields, adjust visibility or examine full source geometry.
4. Use **Mark** to annotate locations. Give the review a title and interpretation, then use **Save review**. Saving captures the source identities, viewport, scale, filters and annotations through the original operator queue.
5. Use the existing review export controls to produce a map pack. Completed spatial reviews and exports remain available for inclusion in a later atlas delivery through the preparation form.
6. **Back to atlas and files** returns to the selected release. Reopening the same panel during the same desk session preserves its in-memory spatial view. **Open original printed sheet** opens the retained PDF for comparison.

The workbench uses the existing monochrome spatial renderer. It keeps the atlas's numerical display range and original raster values. Signed future-export panels use their retained alternative-minus-baseline raster, with the original negative and positive bounds. The PDF continues to use its original cartographic rendering.

A panel is available after its delivery is complete, when the existing native spatial catalogue contains final delivery products.

## Exact scientific handoff

The backend reads the release's retained atlas-index JSON through its stored file descriptor. It finds the requested map key and panel number in that index. The panel's workspace-relative source raster is matched to an original native spatial catalogue entry with the same file path and retained identity. The backend then describes that raster through the existing SpatialReview service.

The printed units must agree with the native raster units. The explicit labels “dimensionless”, “dimensionless (0-1)” and “dimensionless (0–1)” denote the same unit; no numerical conversion occurs. The raster band must have identity scale and offset, matching the atlas renderer's original raw-band values. The shared range is taken from the verified panel index. Signed ranges cross zero; unsigned export and priority ranges begin at zero.

The handoff retains:

- the exact primary raster and native band;
- the original physical minimum and maximum;
- the raster's native CRS and extent;
- the reporting-area boundary from the retained model grid;
- the original saved source-water, designated-water and protected-land selections used by the map, including native layer names and scalar attribute filters;
- the native receptor GeoPackage's contributing-area layer and exact receiving-water role when that panel has a receptor overlay;
- WATERLINK's retained receiving-water family-union layer, exact family filter and original analysis/plan identity when its native delivery adapter overrides a panel;
- the release, map key, atlas page, panel, original raster path/hash, baseline, alternative, source report and atlas-index identity in the review interpretation.

WATERLINK panels use the actual post-override raster recorded in the atlas index. Their appended receiving-water overlay resolves through the retained analysis GeoPackage's receiving_waters layer and exact kind=family_union/family selection. The native quantity scope and analysis/plan identities travel in the target and saved interpretation.

The spatial workbench opens **complete retained contributing-area outlines** from the receptor GeoPackage. The atlas PDF clips those outlines to the reporting area. The inspection header and review interpretation explain this extent difference; the reporting boundary and original masked priority raster are visible.

Source-water polygons, legally designated-water geometries and derived upstream areas retain separate labels. The flow uses the original source selections and legal references bound by the atlas delivery.

## Original spatial capabilities

The existing native spatial service continues to perform nearest-neighbor viewport rendering, original raster pixel/mask queries, native vector feature inspection, saved reviews and map-pack exports. Scientific calculation remains in the original native engines.

The spatial catalogue is checked again when the browser receives the target. Each selected layer matches the backend target's original hash, byte length and layer kind. A changed workspace, missing source or changed retained identity is explained before rendering. Rapidly selecting two panels keeps the most recent selection.

The atlas desk embeds the existing spatial module. Shared application navigation, the extension host, programme routes and native model engines remain on their existing interfaces.

## Source and integration

Additive model module: model/atlas_spatial.py.

Atlas provider read: POST /api/map-atlas/inspect, with authenticated body fields workspace, delivery_id, map_key and panel_index.

The registered extension reader calls the original workspace's SpatialReview instance and returns workspace_key and target. Opening the view is read-only.

The shared browser addition is an explicit atlas-panel target branch in applyTarget. It requires a complete native single-raster selection, fixed scale, source bindings and the current scientific project. Existing targets continue through their original branches.

Saving and exporting use the existing spatial.review.save and spatial.review.export actions, task history and native source binding records. The completed review and export can be selected in the next GIS release.

## Validation

Source review checked the existing SpatialReview catalogue, native raster descriptions, fixed-scale frame API, original point API, review save shape and receptor GeoPackage layer/role fields. Atlas and shared spatial browser sources parse with the V8 JavaScript parser. Native rendering and browser execution belong to the original application runtime with its retained GIS workspace.
