# Native preparation of the published source-water areas

This input package supplies the original SCDES surface-water intake response, the four published ARJWS/Pioneer protection polygons, and the original layer 0 and layer 2 metadata. It also supplies a source manifest, a four-receptor specification, and a local entrypoint for the installed native application.

## Prepare the existing Workspace

Materialize the two input banks under their declared project root so their relative paths agree. The geometry bank contains the full original polygon response. The native preparation bank contains the other seven files.

Run this from the project root with the interpreter already used by the application's GIS engine:

~~~sh
/opt/pyvenv/bin/python source_tools/prepare_public_source_water.py \
  --model-root /ABSOLUTE/EXISTING/APPLICATION \
  --workspace /ABSOLUTE/EXISTING/WORKSPACE \
  --out /ABSOLUTE/NATIVE/PREPARATION/OUTPUT
~~~

The default source directory is source/water_context/20261012/public-water beside the entrypoint. Supply --source-dir when the original inputs are mounted elsewhere.

The entrypoint imports sources.public-native.json through Workspace.import_sources, uses the returned immutable collection ID in the four source selectors, and calls model.receiving_waters.prepare. The installed Workspace verifies the source and metadata hashes. The output public-water-preparation.json records the actual collection ID, plan ID/state, source hashes, original feature counts, and native selection path. The four receptors use relation.method source_area.

| Public utility | Intake OBJECTID | Intake ID | Protection OBJECTIDs |
| --- | --- | --- | --- |
| Anderson Regional Joint Water System | 6 | S04101 | 11 (1500 feet), 12 (200 feet) |
| Pioneer Rural Water District | 50 | S37109 | 131 (1500 feet), 132 (200 feet) |

Use each original polygon in its published geometry. BUFFER_FT records the publisher's existing buffer attribute. Family summaries use the installed engine's overlap union. Full upstream catchment connectivity remains a separate analysis scope.

## Continue into utility maps and scenario analysis

The preparation outcome also retains original_protection_sha256, taken from the actual imported polygon body. The current designation desk's utility companion consumes that field directly:

~~~sh
/opt/pyvenv/bin/python source_tools/prepare_utility_designations.py \
  --model-root /ABSOLUTE/EXISTING/APPLICATION \
  --workspace /ABSOLUTE/EXISTING/WORKSPACE \
  --preparation /ABSOLUTE/NATIVE/PREPARATION/OUTPUT/public-water-preparation.json \
  --out /ABSOLUTE/NATIVE/UTILITY/OUTPUT
~~~

The existing companion saves and reopens ARJWS, Pioneer, and combined-utility selections. Its optional --delivery argument takes an existing complete delivery selection and writes the combined utility overlay into that selection. The combined choice supplies all four original polygons through the single drinking_water overlay slot.

The preparation also writes scenario-source-areas.json, with schema upstate.scenario-source-areas/v1. This complete native form request contains selection.zones and the original preparation identity in origin. Each of the four zones retains its exact typed source selector, utility/intake metadata, source plan ID, receptor ID, and published-polygon scope. The native scenario form's **Add prepared source areas** input imports this file. A host can call createForSourceAreas with the same request and its current workspace_key.

Choose the baseline and scenarios in that form. Its model reports the selected published polygon intersected with the baseline reporting area, retaining the source-area origin with the saved analysis. Keep family totals from the receiving-water union when protection polygons overlap. Each zone remains available individually.

## Original public sources

Public layer directory:
https://gis.des.sc.gov/gisserver/rest/services/water/Public_Water_Supply/MapServer

Full original intake response:
https://gis.des.sc.gov/gisserver/rest/services/water/Public_Water_Supply/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=true&orderByFields=OBJECTID&resultRecordCount=2000&f=json

Full original selected protection response:
https://gis.des.sc.gov/gisserver/rest/services/water/Public_Water_Supply/MapServer/2/query?objectIds=11,12,131,132&outFields=*&returnGeometry=true&orderByFields=OBJECTID&f=pjson

The four original bodies keep their captured bytes and SHA256 identities. The manifest and receptor specification use official source URLs and public record identifiers. The new local entrypoint uses the installed application's APIs and performs no network upload. Source acquisition occurred on 2026-10-12; an unstated underlying publisher dataset edition remains unstated.
