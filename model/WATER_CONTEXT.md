# Water and Habitat Context

Authored by TokenJunkieLabs.

This additive desk turns retained source editions into a saved, inspectable description of a selected reporting area. It covers mapped aquatic habitat, wetland inventory coverage, mapped hydrography, PAD-US inventory, authoritative stream order, and spatial relationships to supplied HUC or utility boundaries.

The calculation uses the existing scientific Workspace. It reads original retained vector bodies through the application's Fiona/GDAL environment and supports prepared NWI_CONTEXT rasters through their original class dictionary and mapping-status companion.

## Integration

Place these two complete files alongside the current application:

- model/water_context.py
- model/WATER_CONTEXT.md

The public interface is:

    from model import water_context
    catalog = water_context.catalog(workspace)
    record = water_context.build(workspace, spec)
    records = water_context.list_saved(workspace)
    reopened = water_context.get_saved(workspace, record["id"])
    map_data = water_context.preview(workspace, record["id"])
    verification = water_context.verify_all(workspace)

Each function accepts an existing Workspace instance or its root directory. GIS imports and original source verification occur during an explicit build. Catalog, list and get calls read retained JSON metadata. Preview reads its precomputed display artifact. The existing operator queue should invoke build; the source module creates no server, queue or model engine.

The core composes with the existing APIs:

- Workspace.sources(), _get("sources", collection_id), source_file(collection_id, source_id).
- Workspace._save("water-context-selections", spec), which returns a content-addressed immutable selection.
- model.rasters.native_vector_path and vector_environment, including original gzip carriers.
- model.common atomic_json, atomic_bytes, digest, identifier, describe_file, verify_file, relative_file and held.

## Selection specification

    {
      "title": "Upper Savannah water and habitat context",
      "boundary": {
        "collection_id": "<retained source collection hash>",
        "source_id": "<retained reporting/HUC/utility polygon source>",
        "layer": "<optional native layer>",
        "where": {"HUC12": "<optional exact native value>"},
        "id_field": "<optional native feature ID field>",
        "feature_ids": ["<optional selected native IDs>"]
      },
      "overlays": {
        "wetlands": {"collection_id": "<hash>", "source_id": "<NWI source>"},
        "mapping_status": {"collection_id": "<hash>", "source_id": "<NWI mapping status>"},
        "flowlines": {"collection_id": "<hash>", "source_id": "<NHD flowline source>"},
        "waterbodies": {"collection_id": "<hash>", "source_id": "<NHD waterbody source>"},
        "protected_lands": {"collection_id": "<hash>", "source_id": "<PAD-US manager inventory>"},
        "stream_order": {"collection_id": "<hash>", "source_id": "<NHD_STREAM_ORDER source>"}
      },
      "measurement_crs": "EPSG:5070",
      "relations": [
        {"kind": "huc", "collection_id": "<hash>", "source_id": "<HUC polygons>"},
        {"kind": "utility", "collection_id": "<hash>", "source_id": "<utility polygons>"}
      ]
    }

All overlays and relationship sources are optional. A polygon selection is required. References accept the same layer, equality filter, native ID field and explicit ID selection as the primary boundary. NWI mapping status uses all retained status records; its where and feature_ids filters are rejected so Digital, No_Data and unknown records participate in the same partition. Select its geographic extent through the reporting boundary. Equality filters use actual native values and field names; they do not become SQL expressions. Multiple selected reporting features are dissolved for the headline denominator.

The two NHD roles remain separately selectable even when both original entries declare role NHD. The optional stream_order selector uses an independently supplied NHD_STREAM_ORDER source and its native streamorde/streamorder field. It carries native NHDPlusID and permanent_identifier values into the tables and retains all original properties. Source capture and flow routing remain with their existing components.

If wetlands selects a prepared NWI_CONTEXT raster and mapping_status is omitted, the core uses its declared mapping_status_path companion. The paired companion must be present in that exact retained source entry. The final normalized selection records this choice.

## Result and saved files

build returns:

    {
      "schema": "upstate.water-context/v1",
      "id": "<content identity>",
      "title": "...",
      "state": "complete",
      "created_at": "...",
      "completed_at": "...",
      "selection": { "...": "normalized specification" },
      "selection_id": "<Workspace saved selection hash>",
      "summary": {
        "boundary_area_ha": 0.0,
        "wetlands": { "...": "inventory metrics" },
        "mapping_status": { "...": "coverage partition" },
        "flowlines": { "...": "mapped line metrics" },
        "waterbodies": { "...": "mapped area metrics" },
        "protected_lands": { "...": "inventory metrics" },
        "stream_order": { "...": "authoritative order metrics" }
      },
      "sources": [],
      "units": {"area": "ha", "length": "km", "percentage": "%"},
      "files": {
        "geojson": {"path": "features.geojson", "bytes": 0, "sha256": "..."},
        "archive": {"path": "context-analysis.zip", "bytes": 0, "sha256": "..."}
      }
    }

Each file descriptor is relative to:

    workspace.root / "water-context" / record["id"]

The directory contains selection.json, summary.json, summary.csv, sources.json, features.geojson, features.csv, relationships.csv, boundary-summaries.json, boundary-summaries.csv, geometry-corrections.json, preview.json, README.md, analysis-record.json and context-analysis.zip. analysis.json holds the saved build state and complete output registry.

File registry keys are selection, summary_json, summary_csv, sources, geometry_corrections, boundary_summaries_json, boundary_summaries_csv, preview, geojson, features_csv, relationships_csv, readme, portable_record and archive.

Selections live in the original Workspace's water-context-selections collection. Analysis identities include the normalized selection, source-edition identities and computation method (water-context-2 for this revision). Calling build again for a complete identity reopens its verified outputs. A failed derivation keeps its error and selected inputs, so the same operation can rebuild after the actual issue is corrected.

get_saved and list_saved preserve the saved selection for the operator's reopen controls. verify_all explicitly checks file bytes/hashes and original source views. The ZIP carries the derived analysis and native source references. Full original inputs and future reoperation travel with the scientific Workspace.

## Metric fields

Every category returns status, label, feature_count, footprint_count, area_ha, length_km, area_pct, coverage_pct and classes. Unavailable inputs use status unavailable and null metrics. A loaded empty inventory supplies zero observed inventory with its source edition still listed. Raster-derived footprint counts are distinguished from native feature counts; feature_count is null for a raster source.

NWI inventory, NHD waterbody and PAD-US headline areas are geometric unions clipped to the selected boundary. NHD mapped flowline and authoritative stream-order lengths use unions of coincident linework. Repeated coincident geometry therefore does not inflate totals.

Native classes retain their values and source field names. NWI uses WETLAND_TYPE; NHD uses ftype; PAD-US uses GAP_Sts and separately exposes manager_classes when Mang_Type/Man_Type exists; stream order uses the authoritative streamorde field. Field lookup accepts case and layer-name qualification while exported properties preserve their original names.

Class areas can overlap one another. Individual native features may appear in several boundary relationships. Per-class, per-HUC and per-utility values should be read independently; the headline total always uses the union of the selected reporting boundary and the relevant inventory.

Each per-boundary summary also retains source_boundary_area_ha, selected_overlap_area_ha, selection_share_pct and source_boundary_share_pct. selection_share_pct divides the selected overlap by the union of the reporting selection. source_boundary_share_pct divides the same overlap by the full original native polygon area. Local inventory percentages use only the selected overlap.

### NWI status partition

Let D be the union of native STATUS Digital polygons, N the union of No_Data polygons, U the union of unrecognized-status polygons, and B the selected boundary.

- Digital-only coverage is D minus N and U.
- Provider No_Data-only coverage is N minus D and U.
- Conflicting coverage is the intersection of D and N, minus U.
- Unknown coverage is B minus the preceding three disjoint regions.

The result provides covered_area_ha, unmapped_area_ha, digital_area_ha, provider_no_data_area_ha, conflicting_area_ha, unknown_area_ha, partition_total_area_ha and unknown_native_status_values. covered_area_ha and digital_area_ha both describe Digital-only coverage. coverage_pct is that area divided by the selected boundary. unmapped_area_ha is the remainder of the selected boundary, including unknown and conflicting coverage.

The wetland inventory summary also provides mapped_occurrence_area_ha, mapped_no_selected_occurrence_area_ha, and published_occurrence_outside_mapped_area_ha when both inventories are selected. The no-selected-occurrence field refers to the selected retained source and any category/feature filters. The compatibility alias mapped_no_published_occurrence_area_ha is populated only for an unfiltered selected inventory and remains qualified to that source edition and acquisition scope. A positive published NWI polygon remains visible where the separately dated status is No_Data, conflicting or unknown.

NWI includes mapped aquatic habitat such as ponds, lakes, riverine and deepwater classes. Its total area is labelled NWI mapped aquatic habitat inventory. A Digital area without a published polygon describes the selected inventory edition; field-confirmed absence requires separate observation.

### Prepared NWI_CONTEXT grids

The reader uses the entry's top-level codes, mapping_status_codes and mapping_status_path, with metadata-wrapped equivalents supported. The native source grid remains unchanged.

Occurrence code 0 represents Digital mapping with no published NWI polygon. Codes 1 through 252 retain their supplied class dictionary; 254 retains its explicit overlapping-type meaning; 255 supplies no occurrence value. Positive occurrence is independent of the mapping-status raster.

Mapping-status codes are 0 unknown, 1 Digital, 2 No_Data, 3 conflicting Digital and No_Data, and 255 outside the selected original domain. Status 255 contributes to unknown coverage if a new reporting selection extends outside that domain.

The reader uses blockwise rasterio.features.shapes, then exact intersection of the original cell footprints with the selected boundary. Raster hectares describe clipped grid-cell footprints. They can differ from pixel-centre summaries or original vector-polygon areas. No per-cell Shapely object is created for every grid cell, and no raster resampling is performed.

### Hydrography and PAD-US

Mapped flowline length includes the selected native ftype inventory, including ArtificialPath or Connector where present. The explicit native class breakdown identifies that content.

PAD-US inventory overlap preserves manager, owner, GAP status, source date and native identifiers as supplied. Manager identity alone does not determine conservation status. GAP values remain original strings, and absent classification fields remain absent. The headline is unique inventory overlap.

Utility/source-water polygons keep their supplied labels and footprint meaning. A surface-water protection buffer is represented as that source's spatial footprint. Intersections describe spatial relationships; they do not establish upstream routing, stream order, habitat condition or pollutant retention.

## Projection, geometry and map display

The default area CRS is EPSG:5070, NAD83 / Conus Albers. Configurable measurement CRSs must be projected with horizontal metre units. The operator is responsible for selecting an appropriate projected area CRS for another geography. Area uses the full projected geometry; horizontal line length uses WGS84 ellipsoidal geodesic measurement after clipping.

The vector reader uses the original Fiona/GDAL helpers. The accepted overlay collector already retains original true-curve responses and their provider-generated linear analytical representation with matching native IDs. Source Z/M and original curve evidence remain in the retained source edition. The analytical geometry uses XY.

Any required topological make_valid operation is written to geometry-corrections.json with source/feature identity and before/after WKB hashes. Original source bodies remain intact.

features.geojson contains all selected derived geometries in WGS84 longitude/latitude. Preview uses a round-robin sample of at most 2,500 display features and 30-metre topology-preserving simplification. Its truncation and simplification are explicit. Neither changes the quantitative calculation or complete export.

## Source compatibility

Implementation contracts were read from the current regional integration source bank F0C88M8KM55, including model/workspace.py and model/rasters.py, and the source context package F0C8TDR500L, including source_tools/domain_overlays.py.

Current original capture lineage distinguishes NWI, NWI_MAPPING_STATUS, NWI_CONTEXT, NHD flowline, NHD waterbody and PROTECTED_LANDS entries. The optional NHD_STREAM_ORDER role is supplied by its current source-acquisition owner.

The module is an additive consumer and calls established Workspace/source APIs. The operator extension, browser, command-line entry and source assembly are owned by the integrating desk component.
